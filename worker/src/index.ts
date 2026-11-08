// ================================================
// FILE: worker/src/index.ts
// Serveur de Pécule (Cloudflare Worker). Il ne garde aucune donnée financière en clair ;
// l'app continue de parler DIRECTEMENT à Drive. Ses rôles :
//
// 1. SESSION PERSISTANTE (OAuth) — le flux « code » de Google délivre un refresh token
//    longue durée, impossible à obtenir côté navigateur. Il est chiffré et gardé ici ;
//    l'app échange sa session contre des jetons d'accès courts (1 h). /auth/*, /token,
//    déconnexion (un appareil ou tous) et suppression du compte.
//
// 2. NOTIFICATIONS PUSH — un cron quotidien relit le fichier Drive (lecture seule) pour
//    calculer les rappels (échéances, jour de paie, révision des taux, intérêts de
//    décembre…) et les envoie, chiffrés de bout en bout, aux appareils abonnés (/push/*).
//
// 3. VEILLE FISCALE — /fiscal-sources relaie les pages publiques de service-public.gouv.fr ;
//    un cron hebdomadaire (lundi) les fait lire par Cloudflare Workers AI et garde le
//    relevé (/fiscal-watch, fiscalWatchJob.ts). L'app propose, l'utilisateur valide.
//
// 4. SAUVEGARDE DE SECOURS — /backup garde des copies CHIFFRÉES PAR L'APP, illisibles ici.
//
// 5. SURVEILLANCE — /status, sonde publique sans détail de la surveillance quotidienne
//    (GitHub Actions) ; /health, compte rendu du dernier cron pour l'app connectée.
//
// Stockage (KV) :
//   code:<sha256(c)>  code de connexion à usage unique, contenu CHIFFRÉ (60 s, effacé à l'échange)
//   session:<hash>    session de l'app — clé = SHA-256 du jeton, 60 jours au plus (sessions.ts)
//   sessions:<sub>    index des sessions de l'utilisateur
//   user:<sub>        refresh token Google CHIFFRÉ (AES-256-GCM, clé en secret du Worker), gardé
//                     seulement tant qu'il sert, 61 jours au plus sans usage (userRecords.ts)
//   push:<sub>        abonnements push des appareils (subscriptions.ts)
//   push-removed:<sub>  abonnements retirés depuis moins de 30 jours (alerte d'effacement des copies)
//   sent:<sub>:<k>    rappels déjà envoyés (dédoublonnage, ~400 jours ; valeur SENT_MARK)
//   health:cron       compte rendu de la dernière tâche quotidienne
//   health:site       dernier contrôle des pages publiques (GET /status, 15 min)
//   health:fiscal-watch, health:cron-log  dernier succès/échec de la veille du lundi et
//                     10 derniers passages des crons, sans donnée personnelle (cronLog.ts)
//   backup:<sub>:<date>  sauvegarde de secours CHIFFRÉE PAR L'APP (illisible ici), conservation
//                     échelonnée (backupRetention.ts : 24 au plus), 1 an chacune
//   backup-deletion:<sub>  effacement des copies programmé (7 jours, annulable)
//   backup-puts:<sub>:<date>  nombre d'envois du jour (plafond quotidien)
//   alert:lock-reset:<hash>  alerte « retrait du verrou demandé » déjà envoyée (1 h)
//   fiscal-watch:*    veille fiscale hebdomadaire (Workers AI, pages publiques seulement : fiscalWatchJob.ts)
// Le state OAuth n'est pas stocké : il est signé (HMAC) et lié au navigateur par cookie.
//
// Sessions liées à l'appareil (deviceProof.ts) : une session qui porte une clé publique
// exige à chaque requête une preuve signée par la clé privée, non exportable, de l'appareil,
// sur un nonce du serveur valable 10 minutes au plus. Une session d'avant cette protection,
// jamais liée, est refusée (reconnexion). Rien de ce qu'une session volée permet ne détruit
// les copies de secours sur-le-champ : leur effacement est différé de 7 jours, annulable,
// visible dans l'app et annoncé aux appareils, y compris à ceux retirés depuis moins de
// 30 jours (push-removed:<sub>).
// ================================================
import { AiRunner, FISCAL_WATCH_CRON } from './fiscalWatchJob';
import { isOriginAcceptable, clearOAuthCookie, BodyTooLargeError } from './security';
import { NONCE_HEADER } from './deviceProof';
import { corsHeaders, json, htmlPage, rateLimited } from './handlers/http';
import { AuthFailure, issuedNonces } from './handlers/session';
import { handleAuthStart, handleAuthCallback, handleExchange, handleBind, handleSessions, handleRevokeSession, handleToken, handleLogout, handleLogoutAll, handleAccountDelete } from './handlers/auth';
import { handleSubscribe, handleUnsubscribe, handleDevices, handleRemoveDevice, handleTestPush, handleLockResetAlert } from './handlers/push';
import { handleFiscalSources, handleFiscalWatch, handleFiscalWatchRun, handleHealth, handleStatus } from './handlers/status';
import { backupRoute } from './handlers/backup';
import { runDailyReminders, runScheduledFiscalWatch, retryFiscalWatchIfFailed } from './handlers/cron';
export { BACKUP_MAX_BYTES, BACKUP_DELETION_DELAY_MS, BACKUP_PUTS_PER_DAY } from './handlers/backup';

export interface Env {
  STORE: KVNamespace;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;  // secret
  ENCRYPTION_KEY: string;        // secret — 32 octets base64url (sert aussi, via HKDF, à signer le state OAuth)
  ENCRYPTION_KEY_PREVIOUS?: string; // secret, facultatif — ancienne clé, le temps d'un changement de ENCRYPTION_KEY (MAINTENANCE.md)
  VAPID_PUBLIC_KEY: string;      // secret — point P-256 non compressé, base64url
  VAPID_PRIVATE_KEY: string;     // secret — scalaire d, base64url
  VAPID_SUBJECT: string;
  APP_URL: string;               // ex : https://pecule-app.com/
  LEGACY_APP_URL?: string;       // ancienne adresse, acceptée pendant le déménagement
  EXTRA_ORIGINS?: string;        // origines supplémentaires autorisées (dev local uniquement, [env.dev])
  ALLOWED_EMAILS?: string;       // secret — comptes Google autorisés, séparés par des virgules
  AUTH_LIMITER?: RateLimit;      // binding [[ratelimits]] — /auth/*, /account/delete
  API_LIMITER?: RateLimit;       // binding [[ratelimits]] — /token et le reste de l'API
  AI?: AiRunner;                 // binding [ai] — Workers AI, pour la veille fiscale
}

/** Routes ouvertes par navigation (redirection OAuth), exemptées du contrôle d'origine. Les
 *  autres sont appelées par fetch() depuis l'app : l'en-tête Origin, s'il est présent, doit être autorisé. */
const NAVIGATION_ROUTES = new Set(['GET /auth/start', 'GET /auth/callback']);

const route = async (req: Request, env: Env, url: URL, r: string): Promise<Response> => {
  const backup = await backupRoute(req, env, url);
  if (backup) return backup;
  switch (r) {
    case 'GET /health': return handleHealth(req, env);
    case 'GET /status': return handleStatus(req, env);
    case 'GET /fiscal-sources': return handleFiscalSources(req, env);
    case 'GET /fiscal-watch': return handleFiscalWatch(req, env);
    case 'POST /fiscal-watch/run': return handleFiscalWatchRun(req, env);
    case 'GET /auth/start': return handleAuthStart(env, url);
    case 'GET /auth/callback': {
      const res = await handleAuthCallback(req, env, url);
      res.headers.append('Set-Cookie', clearOAuthCookie());
      return res;
    }
    case 'POST /auth/exchange': return handleExchange(req, env);
    case 'POST /auth/bind': return handleBind(req, env);
    case 'GET /auth/sessions': return handleSessions(req, env);
    case 'POST /auth/sessions/revoke': return handleRevokeSession(req, env);
    case 'POST /alert/lock-reset': return handleLockResetAlert(req, env);
    case 'POST /auth/logout': return handleLogout(req, env);
    case 'POST /auth/logout-all': return handleLogoutAll(req, env);
    case 'POST /account/delete': return handleAccountDelete(req, env);
    case 'POST /token': return handleToken(req, env);
    case 'GET /push/vapid-public-key': return json(req, env, { key: env.VAPID_PUBLIC_KEY });
    case 'POST /push/subscribe': return handleSubscribe(req, env);
    case 'POST /push/unsubscribe': return handleUnsubscribe(req, env);
    case 'GET /push/devices': return handleDevices(req, env);
    case 'POST /push/remove': return handleRemoveDevice(req, env);
    case 'POST /push/test': return handleTestPush(req, env);
    default: return json(req, env, { error: 'NOT_FOUND' }, 404);
  }
};

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(req, env) });
    const r = `${req.method} ${url.pathname}`;

    // Origine refusée : réponse immédiate, sans lecture ni écriture KV.
    if (!NAVIGATION_ROUTES.has(r) && !isOriginAcceptable(req.headers.get('Origin'), env)) {
      return json(req, env, { error: 'FORBIDDEN_ORIGIN' }, 403);
    }

    const ip = req.headers.get('CF-Connecting-IP') || 'unknown';
    const isAuth = url.pathname.startsWith('/auth/') || url.pathname === '/account/delete';
    if (await rateLimited(isAuth ? env.AUTH_LIMITER : env.API_LIMITER, ip)) {
      return NAVIGATION_ROUTES.has(r)
        ? htmlPage(env, 'Trop de tentatives', 'Patientez une minute avant de réessayer.', 429)
        : json(req, env, { error: 'RATE_LIMITED' }, 429, { 'Retry-After': '60' });
    }

    try {
      const res = await route(req, env, url, r);
      // Session liée : le nonce courant part avec la réponse, pour signer la requête suivante.
      const nonce = issuedNonces.get(req);
      if (nonce) res.headers.set(NONCE_HEADER, nonce);
      return res;
    } catch (e) {
      if (e instanceof BodyTooLargeError) return json(req, env, { error: 'BODY_TOO_LARGE' }, 413);
      // Preuve absente ou nonce périmé : le nonce courant, pour que l'app signe et réessaie.
      if (e instanceof AuthFailure) {
        return json(req, env, { error: e.code, ...(e.nonce ? { nonce: e.nonce } : {}) }, 401, e.nonce ? { [NONCE_HEADER]: e.nonce } : {});
      }
      console.error('unhandled', e);
      return json(req, env, { error: 'INTERNAL' }, 500);
    }
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    // Deux crons (wrangler.toml) : la veille fiscale du lundi, et les rappels quotidiens.
    if (event.cron === FISCAL_WATCH_CRON) {
      ctx.waitUntil(runScheduledFiscalWatch(env));
      return;
    }
    // Le cron quotidien relance aussi la veille fiscale si son dernier essai a échoué.
    ctx.waitUntil(runDailyReminders(env).finally(() => retryFiscalWatchIfFailed(env)));
  },
};

