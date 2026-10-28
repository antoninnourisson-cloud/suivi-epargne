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
//   sent:<sub>:<k>    rappels déjà envoyés (dédoublonnage, ~400 jours)
//   health:cron       compte rendu de la dernière tâche quotidienne
//   health:site       dernier contrôle des pages publiques (GET /status, 15 min)
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
import { sha256b64url, encryptString, decryptString, randomToken } from './crypto';
import {
  OAUTH_SCOPES, exchangeCode, refreshAccessToken, decodeIdToken, verifyIdTokenClaims, revokeToken, readDataFile, GoogleAuthError,
} from './google';
import { sendPush, PushMessage } from './webpush';
import { fetchFiscalSources, FiscalSource } from './fiscalSources';
import { cachedSiteCheck } from './siteCheck';
import { AiRunner, FISCAL_WATCH_CRON, LATEST_KEY, FAILURE_KEY, FiscalWatchRun, runAndStoreFiscalWatch, canRunOnDemand } from './fiscalWatchJob';
import { isReminderEnabled } from '../../src/lib/notificationPrefs';
import { computeReminders, applyDiscreetMode, isDiscreet, parisCivilDate } from './reminders';
import {
  allowedOrigins, isOriginAcceptable, safeReturnUrl, deriveStateKey, newOAuthState, signState, verifyState,
  readCookie, oauthCookie, clearOAuthCookie, OAUTH_COOKIE, timingSafeEqual, readJsonBody, BodyTooLargeError,
} from './security';
import {
  DAY, SessionRecord, createSession, loadSession, touchSession, deleteSession, deleteAllSessions, sessionExists,
  bindSession, listSessions, sessionPublicId, isLegacySession,
} from './sessions';
import {
  PROOF_HEADER, NONCE_HEADER, parseDeviceKey, importDeviceKey, sameDeviceKey, verifyProof, proofNonces, sanitizeDeviceLabel,
} from './deviceProof';
import { backupsToKeep } from './backupRetention';
import {
  StoredSubscription, parseSubscription, upsertSubscription, describeDevices, deviceId, readStoredList,
} from './subscriptions';
import {
  UserRecord, USER_PREFIX, userKey, readUser, writeUser, touchUser, releaseUserIfUnused, RECENT_WRITE_GRACE_MS,
} from './userRecords';

export interface Env {
  STORE: KVNamespace;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;  // secret
  ENCRYPTION_KEY: string;        // secret — 32 octets base64url (sert aussi, via HKDF, à signer le state OAuth)
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

const SENT_TTL = 400 * DAY;
const RECONNECT_NOTICE_TTL = 3 * DAY;
const LOGIN_CODE_TTL = 60;       // minimum KV ; le code est effacé dès l'échange

interface CronHealth { lastRunAt: string; ok: boolean; error?: string; usersProcessed: number }

// ---------- HTTP utilitaires ----------

const corsHeaders = (req: Request, env: Env): Record<string, string> => {
  const origin = req.headers.get('Origin');
  if (!origin || !allowedOrigins(env).includes(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': `Authorization, Content-Type, ${PROOF_HEADER}`,
    // Sans cela, l'app (autre origine) ne pourrait pas lire le nonce rendu avec la réponse.
    'Access-Control-Expose-Headers': NONCE_HEADER,
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
};

const json = (req: Request, env: Env, data: unknown, status = 200, extra: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...corsHeaders(req, env), ...extra },
  });

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

const htmlPage = (env: Env, title: string, message: string, status = 400): Response =>
  new Response(
    `<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<body style="font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px">
<main style="max-width:420px;background:#1e293b;padding:28px;border-radius:20px">
<h1 style="font-size:20px;margin:0 0 12px">${escapeHtml(title)}</h1>
<p style="line-height:1.5;color:#94a3b8">${escapeHtml(message)}</p>
<a href="${escapeHtml(env.APP_URL)}" style="display:inline-block;margin-top:12px;background:#14532d;color:white;padding:10px 16px;border-radius:10px;text-decoration:none;font-weight:600">Retour à l'app</a>
</main></body></html>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } }
  );

const redirect = (location: string, headers: Record<string, string> = {}): Response =>
  new Response(null, { status: 302, headers: { Location: location, 'Cache-Control': 'no-store', ...headers } });

type AuthedSession = { hash: string; session: SessionRecord };

type AuthFailureCode = 'REAUTH_REQUIRED' | 'PROOF_REQUIRED' | 'PROOF_INVALID' | 'PROOF_NONCE';
/**
 * Refus d'authentification : réponse 401 avec ce code (voir le point d'entrée) et, pour une
 * preuve absente ou un nonce périmé, le nonce courant pour que l'app signe et réessaie.
 */
class AuthFailure extends Error {
  constructor(readonly code: AuthFailureCode, readonly nonce?: string) { super(code); this.name = 'AuthFailure'; }
}

/** Nonce courant à rendre avec la réponse à cette requête (en-tête X-Pecule-Nonce). */
const issuedNonces = new WeakMap<Request, string>();

/**
 * Session du porteur (en-tête Authorization), sans contrôle de la preuve, ou `null`. Une
 * session dont le compte a été retiré d'ALLOWED_EMAILS depuis la connexion est effacée.
 */
const readSession = async (req: Request, env: Env): Promise<AuthedSession | null> => {
  const auth = req.headers.get('Authorization') || '';
  const m = /^Bearer\s+([A-Za-z0-9_-]{20,128})$/.exec(auth);
  if (!m) return null;
  const hash = await sha256b64url(m[1]);
  const session = await loadSession(env.STORE, hash);
  if (!session) return null;
  if (!isEmailAllowed(session.email, env)) {
    await deleteSession(env.STORE, hash, session.sub);
    return null;
  }
  return { hash, session };
};

/**
 * Session authentifiée : jeton connu, compte toujours autorisé, session ouverte depuis la
 * liaison à l'appareil (une plus ancienne, jamais liée, exige une reconnexion : un jeton
 * copié avant la protection ne sert plus) et, si la session est liée, preuve signée par sa
 * clé sur un nonce récent du serveur (deviceProof.ts). Lève AuthFailure sinon.
 */
const requireSession = async (req: Request, env: Env): Promise<AuthedSession> => {
  const s = await readSession(req, env);
  if (!s || isLegacySession(s.session)) throw new AuthFailure('REAUTH_REQUIRED');
  if (s.session.key) {
    const nonces = await proofNonces(env.ENCRYPTION_KEY, s.hash);
    issuedNonces.set(req, nonces[0]);
    const check = await verifyProof(s.session.key, req.headers.get(PROOF_HEADER), req.method, new URL(req.url).pathname, nonces);
    if (check === 'missing') throw new AuthFailure('PROOF_REQUIRED', nonces[0]);
    if (check === 'stale') throw new AuthFailure('PROOF_NONCE', nonces[0]);
    if (check === 'invalid') throw new AuthFailure('PROOF_INVALID');
  }
  return s;
};

const isEmailAllowed = (email: string | undefined, env: Env): boolean => {
  // Aucune liste configurée = personne n'est autorisé. Refuser par défaut évite qu'un
  // Worker déployé sans configuration serve de relais OAuth à n'importe quel compte.
  const allowed = (env.ALLOWED_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  return !!email && allowed.includes(email.toLowerCase());
};

/** Jeton d'accès frais pour un utilisateur, à partir de son refresh token chiffré. */
const accessTokenFor = async (env: Env, sub: string): Promise<{ access_token: string; expires_in: number }> => {
  const user = await readUser(env.STORE, sub);
  if (!user) throw new GoogleAuthError('invalid_grant', 'NO_USER');
  const refreshToken = await decryptString(user.refreshTokenEnc, env.ENCRYPTION_KEY);
  const tokens = await refreshAccessToken(refreshToken, env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET);
  // Google peut faire tourner le refresh token : on garde toujours le plus récent. Sinon,
  // l'usage prolonge seulement la durée de vie du compte (au plus une écriture par jour).
  if (tokens.refresh_token && tokens.refresh_token !== refreshToken) {
    await writeUser(env.STORE, sub, {
      ...user, refreshTokenEnc: await encryptString(tokens.refresh_token, env.ENCRYPTION_KEY), updatedAt: Date.now(),
    });
  } else {
    await touchUser(env.STORE, sub, user);
  }
  return { access_token: tokens.access_token, expires_in: tokens.expires_in };
};

const isInvalidGrant = (e: unknown) => e instanceof GoogleAuthError && e.code === 'invalid_grant';

// ---------- Stockage des abonnements ----------

const pushKey = (sub: string) => `push:${sub}`;
const readPushList = async (env: Env, sub: string): Promise<StoredSubscription[]> =>
  readStoredList(await env.STORE.get(pushKey(sub), 'json'));
const writePushList = (env: Env, sub: string, list: StoredSubscription[]) =>
  list.length === 0 ? env.STORE.delete(pushKey(sub)) : env.STORE.put(pushKey(sub), JSON.stringify(list));

// Abonnements retirés par une AUTRE session (« Retirer » un appareil, « Déconnecter » une
// session, « Déconnecter tous les appareils ») : gardés 30 jours pour la seule alerte
// d'effacement des copies de secours. Sinon une session volée retirerait d'abord les
// appareils du propriétaire, puis demanderait l'effacement sans que personne en soit prévenu.
const RECENTLY_REMOVED_TTL = 30 * DAY;
const MAX_RECENTLY_REMOVED = 10;
const removedPushKey = (sub: string) => `push-removed:${sub}`;

const rememberRemovedSubscriptions = async (env: Env, sub: string, removed: StoredSubscription[]): Promise<void> => {
  if (removed.length === 0) return;
  const endpoints = new Set(removed.map(x => x.endpoint));
  const previous = readStoredList(await env.STORE.get(removedPushKey(sub), 'json')).filter(x => !endpoints.has(x.endpoint));
  const list = [...removed.map(x => ({ endpoint: x.endpoint, keys: x.keys })), ...previous].slice(0, MAX_RECENTLY_REMOVED);
  await env.STORE.put(removedPushKey(sub), JSON.stringify(list), { expirationTtl: RECENTLY_REMOVED_TTL });
};

/** Retire les abonnements dont la session propriétaire n'existe plus (les anciens, sans session, restent). */
const pruneOrphanSubscriptions = async (env: Env, list: StoredSubscription[]): Promise<StoredSubscription[]> => {
  const alive: StoredSubscription[] = [];
  for (const s of list) {
    if (!s.sessionHash || await sessionExists(env.STORE, s.sessionHash)) alive.push(s);
  }
  return alive;
};

const deletePrefix = async (store: KVNamespace, prefix: string): Promise<number> => {
  let cursor: string | undefined;
  let n = 0;
  do {
    const page = await store.list({ prefix, cursor });
    for (const k of page.keys) { await store.delete(k.name); n++; }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return n;
};

/**
 * Efface ce que le serveur sait d'un utilisateur (sessions, jeton Google, abonnements,
 * marqueurs « déjà envoyé »), SAUF les sauvegardes de secours chiffrées : elles doivent
 * survivre à une reconnexion forcée (accès Google révoqué ou expiré) comme à une session
 * volée. Elles ne partent que par un effacement programmé (7 jours, annulable : voir
 * scheduleBackupDeletion), ou d'elles-mêmes au bout d'un an (BACKUP_TTL) ; le serveur ne
 * peut pas les lire.
 */
const purgeUser = async (store: KVNamespace, sub: string, alsoSessionHash?: string): Promise<void> => {
  await deleteAllSessions(store, sub, alsoSessionHash);
  await store.delete(userKey(sub));
  await store.delete(pushKey(sub));
  await store.delete(removedPushKey(sub));
  await deletePrefix(store, `sent:${sub}:`);
};

// ---------- Routes : connexion ----------

const handleAuthStart = async (req: Request, env: Env, url: URL): Promise<Response> => {
  const state = newOAuthState(safeReturnUrl(url.searchParams.get('return'), env));
  const signed = await signState(state, await deriveStateKey(env.ENCRYPTION_KEY));
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: `${url.origin}/auth/callback`,
    response_type: 'code',
    scope: OAUTH_SCOPES,
    // offline + consent : garantit la délivrance d'un refresh token à chaque connexion.
    // `select=1` (réinitialisation du verrou de l'appareil, « Code oublié ») : le choix du
    // compte est toujours affiché, jamais de reprise silencieuse du compte ouvert. Google
    // n'offre pas de ressaisie forcée du mot de passe (`prompt` : none, consent,
    // select_account, combinables) :
    // https://developers.google.com/identity/protocols/oauth2/web-server#creatingclient
    access_type: 'offline',
    prompt: url.searchParams.get('select') === '1' ? 'select_account consent' : 'consent',
    // Pas d'include_granted_scopes : Google rajouterait les autorisations accordées
    // autrefois (gmail.send), donc l'écran « application non validée ».
    include_granted_scopes: 'false',
    state: signed,
  });
  // Le nonce du state est aussi posé en cookie : un state intercepté ne peut pas être
  // terminé dans un AUTRE navigateur (connexion forcée, « login CSRF »).
  return redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`, { 'Set-Cookie': oauthCookie(state.nonce) });
};

const handleAuthCallback = async (req: Request, env: Env, url: URL): Promise<Response> => {
  const state = await verifyState(url.searchParams.get('state'), await deriveStateKey(env.ENCRYPTION_KEY));
  const cookieNonce = readCookie(req, OAUTH_COOKIE);
  if (!state || !cookieNonce || !timingSafeEqual(cookieNonce, state.nonce)) {
    return htmlPage(env, 'Connexion expirée', 'Cette tentative de connexion a expiré ou a été lancée depuis un autre navigateur. Relancez la connexion depuis l’app.');
  }

  if (url.searchParams.get('error')) {
    return htmlPage(env, 'Connexion annulée', 'La connexion Google a été annulée. Vous pouvez réessayer depuis l’app.');
  }
  const code = url.searchParams.get('code');
  if (!code) return htmlPage(env, 'Connexion impossible', 'Réponse de Google incomplète.');

  let tokens;
  try {
    tokens = await exchangeCode(code, env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, `${url.origin}/auth/callback`);
  } catch (e) {
    console.error('code exchange failed', e);
    return htmlPage(env, 'Connexion impossible', 'Google a refusé l’échange du code. Vérifiez la configuration du client OAuth (URI de redirection, secret).', 502);
  }

  if (!tokens.id_token) return htmlPage(env, 'Connexion impossible', 'Identité Google manquante.', 502);
  let identity;
  try { identity = decodeIdToken(tokens.id_token); } catch { identity = null; }
  if (!identity || !verifyIdTokenClaims(identity, env.GOOGLE_CLIENT_ID)) {
    if (tokens.refresh_token) await revokeToken(tokens.refresh_token);
    return htmlPage(env, 'Connexion impossible', 'Identité Google invalide pour cette application.', 502);
  }
  if (!identity.email_verified || !isEmailAllowed(identity.email, env)) {
    if (tokens.refresh_token) await revokeToken(tokens.refresh_token);
    return htmlPage(env, 'Compte non autorisé', 'Ce serveur est réservé à son propriétaire. Connectez-vous avec le compte Google configuré.', 403);
  }
  // Consentement granulaire : l'utilisateur peut décocher Drive. Sans lui l'app est inutilisable.
  if (!(tokens.scope || '').includes('drive.file')) {
    return htmlPage(env, 'Autorisation Drive manquante', 'L’accès à Google Drive est indispensable : relancez la connexion en cochant toutes les autorisations.');
  }

  const existing = await readUser(env.STORE, identity.sub);
  const refreshToken = tokens.refresh_token;
  if (!refreshToken && !existing) {
    return htmlPage(env, 'Connexion incomplète', 'Google n’a pas fourni de jeton de longue durée. Relancez la connexion.', 502);
  }
  const record: UserRecord = refreshToken
    ? { email: identity.email!, refreshTokenEnc: await encryptString(refreshToken, env.ENCRYPTION_KEY), updatedAt: Date.now() }
    : existing!;
  // Session AVANT le compte : une déconnexion du dernier appareil (ou la tâche quotidienne)
  // qui tournerait au même moment voit déjà cette session et ne l'efface pas
  // (releaseUserIfUnused). Dans l'autre ordre, elle pourrait effacer le compte tout juste
  // écrit, et la nouvelle session serait purgée à son premier /token (NO_USER).
  const { token: sessionToken } = await createSession(env.STORE, identity.sub, identity.email!);
  // Durée de vie neuve à chaque connexion : le compte survit à toute session ouverte.
  await writeUser(env.STORE, identity.sub, record);

  // La session n'apparaît jamais dans une URL : l'app reçoit un code à usage unique (dans
  // le fragment, jamais envoyé à un serveur) qu'elle échange immédiatement. Le contenu est
  // chiffré et indexé par l'empreinte du code : lire KV ne suffit pas à l'exploiter.
  const loginCode = randomToken(24);
  await env.STORE.put(`code:${await sha256b64url(loginCode)}`, await encryptString(JSON.stringify({
    session: sessionToken, access_token: tokens.access_token, expires_in: tokens.expires_in,
  }), env.ENCRYPTION_KEY), { expirationTtl: LOGIN_CODE_TTL });

  return redirect(`${state.returnUrl}#login_code=${loginCode}`);
};

/** Clé publique d'appareil valide (forme ET point de la courbe), `null` si absente, `false` si invalide. */
const readDeviceKey = async (raw: unknown) => {
  if (raw === undefined || raw === null) return null;
  const key = parseDeviceKey(raw);
  return key && (await importDeviceKey(key)) ? key : false;
};

const handleExchange = async (req: Request, env: Env): Promise<Response> => {
  const body = await readJsonBody(req) as { code?: unknown; key?: unknown; device?: unknown };
  if (typeof body.code !== 'string' || !/^[A-Za-z0-9_-]{20,64}$/.test(body.code)) return json(req, env, { error: 'INVALID_CODE' }, 400);
  // Clé de l'appareil contrôlée AVANT de consommer le code : une clé mal formée ne coûte
  // pas la connexion.
  const deviceKey = await readDeviceKey(body.key);
  if (deviceKey === false) return json(req, env, { error: 'INVALID_KEY' }, 400);
  const key = `code:${await sha256b64url(body.code)}`;
  const sealed = await env.STORE.get(key);
  if (!sealed) return json(req, env, { error: 'INVALID_CODE' }, 400);
  await env.STORE.delete(key);
  let record: { session: string; access_token: string; expires_in: number };
  try {
    record = JSON.parse(await decryptString(sealed, env.ENCRYPTION_KEY));
  } catch {
    return json(req, env, { error: 'INVALID_CODE' }, 400);
  }
  // Session liée à l'appareil dès sa naissance (les anciennes versions de l'app n'envoient
  // pas de clé : session non liée, comme avant).
  let bound = false;
  if (deviceKey) {
    const hash = await sha256b64url(record.session);
    const session = await loadSession(env.STORE, hash);
    if (session) bound = await bindSession(env.STORE, hash, session, deviceKey, sanitizeDeviceLabel(body.device));
    // Premier nonce rendu tout de suite : la requête suivante part déjà signée.
    if (bound) issuedNonces.set(req, (await proofNonces(env.ENCRYPTION_KEY, hash))[0]);
  }
  return json(req, env, {
    session: record.session, access_token: record.access_token, expires_in: record.expires_in, ...(deviceKey ? { bound } : {}),
  });
};

/**
 * Lie à l'appareil une session ouverte depuis la protection mais restée sans clé (connexion
 * faite par une version de l'app d'avant la liaison, ou liaison manquée à l'échange). Les
 * sessions plus anciennes sont refusées (requireSession) : un jeton copié avant la
 * protection ne peut pas être lié par celui qui l'a copié. La preuve, dans le corps, porte
 * sur un nonce du serveur et montre que l'appareil détient la clé privée. Une session déjà
 * liée à une AUTRE clé est refusée (409) : l'app demande alors une reconnexion, et la
 * session inconnue reste visible dans la liste des appareils.
 */
const handleBind = async (req: Request, env: Env): Promise<Response> => {
  const s = await readSession(req, env);
  if (!s || isLegacySession(s.session)) throw new AuthFailure('REAUTH_REQUIRED');
  const body = await readJsonBody(req) as { key?: unknown; proof?: unknown; device?: unknown };
  const deviceKey = await readDeviceKey(body.key);
  if (!deviceKey) return json(req, env, { error: 'INVALID_KEY' }, 400);
  const nonces = await proofNonces(env.ENCRYPTION_KEY, s.hash);
  const check = await verifyProof(deviceKey, typeof body.proof === 'string' ? body.proof : null, 'POST', '/auth/bind', nonces);
  if (check === 'missing') throw new AuthFailure('PROOF_REQUIRED', nonces[0]);
  if (check === 'stale') throw new AuthFailure('PROOF_NONCE', nonces[0]);
  if (check !== 'ok') return json(req, env, { error: 'INVALID_PROOF' }, 400);
  if (s.session.key) {
    return sameDeviceKey(s.session.key, deviceKey)
      ? json(req, env, { ok: true, bound: true })
      : json(req, env, { error: 'BOUND_ELSEWHERE' }, 409);
  }
  const bound = await bindSession(env.STORE, s.hash, s.session, deviceKey, sanitizeDeviceLabel(body.device));
  return bound ? json(req, env, { ok: true, bound: true }) : json(req, env, { error: 'REAUTH_REQUIRED' }, 401);
};

// ---------- Routes : appareils connectés (sessions) ----------

const handleSessions = async (req: Request, env: Env): Promise<Response> => {
  const s = await requireSession(req, env);
  const sessions = await listSessions(env.STORE, s.session.sub);
  return json(req, env, {
    sessions: await Promise.all(sessions.map(async ({ hash, session }) => ({
      id: await sessionPublicId(hash),
      device: session.device ?? null,
      createdAt: session.createdAt ? new Date(session.createdAt).toISOString() : null,
      lastUsedAt: new Date(session.refreshedAt).toISOString(),
      bound: !!session.key,
      // Ouverte avant la liaison à l'appareil : refusée, l'appareil doit se reconnecter.
      legacy: isLegacySession(session),
      current: hash === s.hash,
    }))),
  });
};

/** Retire les abonnements push créés par cette session (gardés 30 jours pour l'alerte si `remember`). */
const removeSessionSubscriptions = async (env: Env, sub: string, sessionHash: string, remember = false): Promise<void> => {
  const list = await readPushList(env, sub);
  const kept = list.filter(x => x.sessionHash !== sessionHash);
  if (kept.length === list.length) return;
  await writePushList(env, sub, kept);
  if (remember) await rememberRemovedSubscriptions(env, sub, list.filter(x => x.sessionHash === sessionHash));
};

/** « Déconnecter cet appareil » : ferme une session de l'utilisateur, désignée par son identifiant public. */
const handleRevokeSession = async (req: Request, env: Env): Promise<Response> => {
  const s = await requireSession(req, env);
  const body = await readJsonBody(req) as { id?: unknown };
  if (typeof body.id !== 'string') return json(req, env, { error: 'INVALID_REQUEST' }, 400);
  let target: string | null = null;
  for (const { hash } of await listSessions(env.STORE, s.session.sub)) {
    if ((await sessionPublicId(hash)) === body.id) { target = hash; break; }
  }
  if (!target) return json(req, env, { error: 'NOT_FOUND' }, 404);
  await deleteSession(env.STORE, target, s.session.sub);
  await removeSessionSubscriptions(env, s.session.sub, target, target !== s.hash);
  await releaseUserIfUnused(env.STORE, s.session.sub);
  return json(req, env, { ok: true, current: target === s.hash });
};

const handleToken = async (req: Request, env: Env): Promise<Response> => {
  const s = await requireSession(req, env);
  try {
    const tokens = await accessTokenFor(env, s.session.sub);
    // Session glissante, plafonnée à 60 jours depuis la connexion.
    await touchSession(env.STORE, s.hash, s.session);
    return json(req, env, tokens);
  } catch (e) {
    if (isInvalidGrant(e)) {
      // Accès révoqué côté Google (ou refresh token expiré) : on efface tout, sauf la
      // sauvegarde de secours chiffrée (voir purgeUser).
      await purgeUser(env.STORE, s.session.sub, s.hash);
      return json(req, env, { error: 'REAUTH_REQUIRED' }, 401);
    }
    console.error('token refresh failed', e);
    return json(req, env, { error: 'UPSTREAM_ERROR' }, 502);
  }
};

const handleLogout = async (req: Request, env: Env): Promise<Response> => {
  // Session inconnue ou preuve fausse : rien n'est fermé, l'app efface de toute façon sa
  // session locale. Preuve absente ou nonce périmé : refus avec le nonce courant, l'app
  // signe et réessaie (sinon une déconnexion faite au démarrage laisserait la session ouverte).
  const s = await requireSession(req, env).catch(async e => {
    if (!(e instanceof AuthFailure) || e.nonce) throw e;
    // Session d'avant la liaison (refusée partout ailleurs) : la fermer ne donne rien à
    // personne, et l'ancienne version de l'app peut ainsi faire le ménage.
    const legacy = await readSession(req, env);
    return legacy && isLegacySession(legacy.session) ? legacy : null;
  });
  if (s) {
    await deleteSession(env.STORE, s.hash, s.session.sub);
    // Les abonnements créés par cette session partent avec elle.
    await removeSessionSubscriptions(env, s.session.sub, s.hash);
    // Dernier appareil déconnecté, plus aucune notification : le jeton Google ne sert plus.
    await releaseUserIfUnused(env.STORE, s.session.sub);
  }
  return json(req, env, { ok: true });
};

const handleLogoutAll = async (req: Request, env: Env): Promise<Response> => {
  const s = await requireSession(req, env);
  const revoked = await deleteAllSessions(env.STORE, s.session.sub, s.hash);
  await rememberRemovedSubscriptions(env, s.session.sub, (await readPushList(env, s.session.sub)).filter(x => x.sessionHash !== s.hash));
  await env.STORE.delete(pushKey(s.session.sub));
  // Plus aucune session ni notification : le jeton Google, l'e-mail et l'identifiant partent
  // aussi (la sauvegarde de secours chiffrée reste, comme les marqueurs « déjà envoyé »).
  await env.STORE.delete(userKey(s.session.sub));
  return json(req, env, { ok: true, sessionsRevoked: revoked });
};

const handleAccountDelete = async (req: Request, env: Env): Promise<Response> => {
  const s = await requireSession(req, env);
  let googleRevoked = false;
  const user = await env.STORE.get<UserRecord>(`user:${s.session.sub}`, 'json');
  if (user) {
    try {
      const res = await revokeToken(await decryptString(user.refreshTokenEnc, env.ENCRYPTION_KEY));
      googleRevoked = !!res && res.ok;
    } catch (e) { console.error('revoke failed', e); }
  }
  // Tout part tout de suite, SAUF les copies de secours chiffrées : leur effacement est
  // différé de 7 jours (une session volée ne doit pas pouvoir les détruire), annoncé aux
  // appareils AVANT que leurs abonnements disparaissent, et annulable après reconnexion.
  const deletion = await scheduleBackupDeletion(env, s.session.sub);
  await purgeUser(env.STORE, s.session.sub, s.hash);
  return json(req, env, { ok: true, googleRevoked, ...(deletion ? { backupsDeletionAt: deletion.purgeAt } : {}) });
};

// ---------- Routes : notifications ----------

const handleSubscribe = async (req: Request, env: Env): Promise<Response> => {
  const s = await requireSession(req, env);
  const body = await readJsonBody(req) as { subscription?: unknown };
  const subscription = parseSubscription(body.subscription);
  if (!subscription) return json(req, env, { error: 'INVALID_SUBSCRIPTION' }, 400);
  const current = await readPushList(env, s.session.sub);
  const alive = await pruneOrphanSubscriptions(env, current);
  const result = upsertSubscription(alive, subscription, s.hash);
  if (!result.ok) {
    if (alive.length !== current.length) await writePushList(env, s.session.sub, alive);
    return json(req, env, { error: result.error }, 409);
  }
  await writePushList(env, s.session.sub, result.list);
  return json(req, env, { ok: true, devices: result.list.length });
};

const removeEndpoint = async (env: Env, sub: string, match: (x: StoredSubscription) => Promise<boolean> | boolean) => {
  const list = await readPushList(env, sub);
  const kept: StoredSubscription[] = [];
  const gone: StoredSubscription[] = [];
  for (const x of list) (await match(x) ? gone : kept).push(x);
  if (gone.length) await writePushList(env, sub, kept);
  return { gone, result: { removed: gone.length > 0, devices: kept.length } };
};

const handleUnsubscribe = async (req: Request, env: Env): Promise<Response> => {
  const s = await requireSession(req, env);
  const body = await readJsonBody(req) as { endpoint?: unknown };
  // L'appareil se désabonne lui-même : il ne veut plus rien recevoir, rien n'est gardé.
  const { result } = await removeEndpoint(env, s.session.sub, x => x.endpoint === body.endpoint);
  return json(req, env, { ok: true, devices: result.devices });
};

const handleDevices = async (req: Request, env: Env): Promise<Response> => {
  const s = await requireSession(req, env);
  const list = await readPushList(env, s.session.sub);
  return json(req, env, { devices: await describeDevices(list, s.hash) });
};

const handleRemoveDevice = async (req: Request, env: Env): Promise<Response> => {
  const s = await requireSession(req, env);
  const body = await readJsonBody(req) as { endpoint?: unknown; id?: unknown };
  if (typeof body.endpoint !== 'string' && typeof body.id !== 'string') return json(req, env, { error: 'INVALID_REQUEST' }, 400);
  const { gone, result } = await removeEndpoint(env, s.session.sub, async x =>
    (typeof body.endpoint === 'string' && x.endpoint === body.endpoint)
    || (typeof body.id === 'string' && (await deviceId(x.endpoint)) === body.id));
  // Appareil d'une AUTRE session retiré : il recevra quand même, 30 jours, l'alerte
  // d'effacement des copies de secours.
  await rememberRemovedSubscriptions(env, s.session.sub, gone.filter(x => x.sessionHash !== s.hash));
  return json(req, env, { ok: true, ...result });
};

/**
 * Envoie un message à tous les appareils en parallèle. Renvoie le nombre de réceptions et
 * les endpoints disparus (404/410), à retirer par l'appelant.
 */
const deliver = async (env: Env, subs: StoredSubscription[], message: PushMessage): Promise<{ delivered: number; gone: string[] }> => {
  const vapid = { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT };
  const results = await Promise.allSettled(subs.map(s => sendPush(s, message, vapid)));
  let delivered = 0;
  const gone: string[] = [];
  results.forEach((r, i) => {
    if (r.status === 'rejected') { console.error('push failed', r.reason); return; }
    if (r.value >= 200 && r.value < 300) delivered++;
    else if (r.value === 404 || r.value === 410) gone.push(subs[i].endpoint);
    else console.error('push rejected', r.value, new URL(subs[i].endpoint).hostname);
  });
  return { delivered, gone };
};

const handleTestPush = async (req: Request, env: Env): Promise<Response> => {
  const s = await requireSession(req, env);
  const list = await readPushList(env, s.session.sub);
  const { delivered, gone } = await deliver(env, list, {
    title: 'Pécule', body: 'Les notifications fonctionnent sur cet appareil.', url: env.APP_URL, tag: 'test',
  });
  if (gone.length) await writePushList(env, s.session.sub, list.filter(x => !gone.includes(x.endpoint)));
  return json(req, env, { ok: delivered > 0, delivered });
};

/** « 20 octobre à 14:05 », heure de Paris. */
const parisDateTime = (ms: number): string =>
  new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(new Date(ms));
/** « 27 octobre », heure de Paris. */
const parisDay = (ms: number): string =>
  new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', day: 'numeric', month: 'long' }).format(new Date(ms));

/** Paramètres, carte `section` ouverte (src/components/settings/sections.ts). */
const settingsUrl = (env: Env, section: 'account' | 'data') =>
  `${env.APP_URL}${env.APP_URL.includes('?') ? '&' : '?'}view=settings&section=${section}`;

/**
 * Envoie un message à tous les appareils de l'utilisateur (sauf ceux de `exceptSession`) et
 * retire les abonnements disparus. `alsoRecentlyRemoved` : aussi aux appareils retirés par
 * une autre session depuis moins de 30 jours. Renvoie le nombre de réceptions.
 */
const alertDevices = async (
  env: Env, sub: string, message: PushMessage, opts: { exceptSession?: string; alsoRecentlyRemoved?: boolean } = {},
): Promise<number> => {
  const list = await pruneOrphanSubscriptions(env, await readPushList(env, sub));
  const targets = list.filter(x => !opts.exceptSession || x.sessionHash !== opts.exceptSession);
  const removed = opts.alsoRecentlyRemoved ? readStoredList(await env.STORE.get(removedPushKey(sub), 'json')) : [];
  const extra = removed.filter(r => !targets.some(t => t.endpoint === r.endpoint));
  if (targets.length + extra.length === 0) return 0;
  const { delivered, gone } = await deliver(env, [...targets, ...extra], message);
  if (gone.length && list.some(x => gone.includes(x.endpoint))) await writePushList(env, sub, list.filter(x => !gone.includes(x.endpoint)));
  return delivered;
};

const LOCK_ALERT_TTL = 3600;
const LOCK_RESET_MAX_AGE_MS = 7 * DAY * 1000;

/**
 * « Code oublié » sur un appareil : ses AUTRES appareils (notifications activées) sont
 * prévenus, avec un texte générique (date, type d'appareil, rien sur les données), et ce
 * qu'il faut faire si ce n'est pas le propriétaire. Une alerte par heure et par session au
 * plus. Chiffrée de bout en bout comme toutes les notifications (RFC 8291).
 */
const handleLockResetAlert = async (req: Request, env: Env): Promise<Response> => {
  const s = await requireSession(req, env);
  const body = await readJsonBody(req) as { requestedAt?: unknown; device?: unknown };
  const alertKey = `alert:lock-reset:${s.hash}`;
  if (await env.STORE.get(alertKey)) return json(req, env, { ok: true, delivered: 0, throttled: true });
  const now = Date.now();
  // Date de la demande (l'appareil était peut-être hors ligne) : acceptée si elle est
  // plausible, sinon l'heure de réception.
  const asked = typeof body.requestedAt === 'string' ? Date.parse(body.requestedAt) : NaN;
  const when = Number.isFinite(asked) && asked <= now + 5 * 60_000 && asked >= now - LOCK_RESET_MAX_AGE_MS ? asked : now;
  const device = s.session.device ?? sanitizeDeviceLabel(body.device);
  const delivered = await alertDevices(env, s.session.sub, {
    title: 'Pécule : retrait du verrou demandé',
    body: `Le ${parisDateTime(when)}, ${device ? `un appareil (${device})` : 'un de vos appareils'} a demandé à retirer le verrou de Pécule. `
      + 'Ce n\'est pas vous ? Déconnectez cet appareil dans Paramètres, rubrique « Appareils connectés ». '
      + 'Si c\'est bien le vôtre, déverrouillez Pécule dessus pour annuler la demande.',
    url: settingsUrl(env, 'account'), tag: 'lock-reset',
  }, { exceptSession: s.hash });
  await env.STORE.put(alertKey, '1', { expirationTtl: LOCK_ALERT_TTL });
  return json(req, env, { ok: true, delivered });
};

// Pages officielles pour la veille fiscale (mises en cache 3 jours : une lecture par semaine
// et par appareil suffit, et le cache évite de solliciter les sites publics).
const handleFiscalSources = async (req: Request, env: Env): Promise<Response> => {
  await requireSession(req, env);
  const cached = await env.STORE.get<{ fetchedAt: string; sources: FiscalSource[] }>('fiscal-sources', 'json');
  if (cached && cached.sources.some(x => x.ok)) return json(req, env, cached);
  const sources = await fetchFiscalSources();
  const payload = { fetchedAt: new Date().toISOString(), sources };
  if (sources.filter(x => x.ok).length >= 4) await env.STORE.put('fiscal-sources', JSON.stringify(payload), { expirationTtl: 3 * 86400 });
  return json(req, env, payload);
};

// Veille fiscale du serveur (Workers AI) : dernier résultat, et exécution à la demande
// (limitée : une toutes les 20 h après un succès, 6 h après un essai, pour le quota gratuit).
const handleFiscalWatch = async (req: Request, env: Env): Promise<Response> => {
  await requireSession(req, env);
  const latest = await env.STORE.get<FiscalWatchRun>(LATEST_KEY, 'json');
  const lastFailure = await env.STORE.get<FiscalWatchRun>(FAILURE_KEY, 'json');
  const failure = lastFailure && (!latest || lastFailure.checkedAt > latest.checkedAt) ? { lastFailure } : {};
  if (!latest) return json(req, env, { error: 'NOT_YET_RUN', ...failure }, 404);
  return json(req, env, { ...latest, ...failure });
};

const handleFiscalWatchRun = async (req: Request, env: Env): Promise<Response> => {
  await requireSession(req, env);
  if (!env.AI) return json(req, env, { error: 'AI_UNAVAILABLE' }, 503);
  if (!(await canRunOnDemand(env.STORE))) {
    const latest = await env.STORE.get<FiscalWatchRun>(LATEST_KEY, 'json');
    return json(req, env, { error: 'TOO_SOON', ...(latest ? { latest } : {}) }, 429, { 'Retry-After': '3600' });
  }
  const run = await runAndStoreFiscalWatch(env.STORE, env.AI);
  return json(req, env, run, run.ok ? 200 : 502);
};

const handleHealth = async (req: Request, env: Env): Promise<Response> => {
  await requireSession(req, env);
  const health = await env.STORE.get<CronHealth>('health:cron', 'json');
  return json(req, env, health ?? { lastRunAt: null, ok: null, usersProcessed: 0 });
};

/**
 * Sonde publique de la surveillance quotidienne (.github/workflows/monitor.yml) : le serveur
 * répond, et la dernière tâche quotidienne a-t-elle réussi ? Volontairement sans session et
 * sans détail (ni message d'erreur, ni nombre d'utilisateurs) : rien sur les utilisateurs.
 */
const handleStatus = async (req: Request, env: Env): Promise<Response> => {
  const health = await env.STORE.get<CronHealth>('health:cron', 'json');
  // Contrôle du site publié par le serveur (la surveillance GitHub est bloquée par la
  // protection anti-robots de Cloudflare) ; résultat réutilisé 15 min.
  const site = await cachedSiteCheck(env.STORE, env.APP_URL).catch(() => null);
  return json(req, env, { ok: true, cron: { lastRunAt: health?.lastRunAt ?? null, ok: health?.ok ?? null }, site });
};

// ---------- Routes : sauvegarde de secours chiffrée ----------
// L'app chiffre ses données AVANT l'envoi (AES-256-GCM, clé dérivée d'un code de secours
// que seul l'utilisateur détient : src/lib/cloudBackupCrypto.ts). Le serveur ne garde
// qu'un texte chiffré opaque : il en contrôle la forme et la taille, jamais le contenu.
//   PUT    /backup           enregistre la copie du jour (remplace celle du même jour)
//   GET    /backup           dates des copies gardées, la plus récente d'abord, et
//                            l'effacement programmé s'il y en a un
//   GET    /backup/:date     une copie (texte chiffré)
//   DELETE /backup           PROGRAMME l'effacement, dans 7 jours, des copies présentes à
//                            la date de la demande (les copies envoyées ensuite restent,
//                            jusqu'à une nouvelle demande qui les ajoute à leur tour)
//   DELETE /backup/deletion  annule cet effacement
// Une session volée ne peut donc rien détruire sur-le-champ : l'effacement est annoncé aux
// appareils (notification) et annulable pendant 7 jours ; la conservation échelonnée
// (backupRetention.ts) garde des copies anciennes qu'aucun nouvel envoi ne chasse ; les
// envois sont plafonnés par jour.

export const BACKUP_MAX_BYTES = 2 * 1024 * 1024;
export const BACKUP_DELETION_DELAY_MS = 7 * DAY * 1000;
export const BACKUP_PUTS_PER_DAY = 20;
const BACKUP_TTL = 365 * DAY;
const backupDeletionKey = (sub: string) => `backup-deletion:${sub}`;
/**
 * Effacement programmé : chaque copie concernée (date AAAA-MM-JJ) avec sa propre échéance
 * (`due`). `requestedAt` : dernière demande qui a ajouté des copies ; `purgeAt` : échéance la
 * plus tardive (toutes ces copies effacées).
 */
interface BackupDeletion { requestedAt: string; purgeAt: string; due: Record<string, string> }
// Le marqueur survit un mois à la date prévue : la tâche quotidienne a largement le temps.
const deletionTtl = (d: BackupDeletion, nowMs = Date.now()) =>
  Math.max(60, Math.ceil((Date.parse(d.purgeAt) - nowMs) / 1000) + 30 * DAY);
const backupPrefix = (sub: string) => `backup:${sub}:`;
const BACKUP_DATE = /^\d{4}-\d{2}-\d{2}$/;
const B64URL_FIELD = /^[A-Za-z0-9_-]+$/;

/** Copie reconstruite champ par champ (rien d'autre n'est stocké), ou `null` si la forme est fausse. */
const parseBackupBody = (b: Record<string, unknown>): Record<string, unknown> | null => {
  if (b.format !== 'pecule-backup' || typeof b.v !== 'number' || !Number.isInteger(b.v) || b.v < 1 || b.v > 99) return null;
  for (const k of ['salt', 'kcv', 'iv', 'ct']) if (typeof b[k] !== 'string' || !B64URL_FIELD.test(b[k] as string)) return null;
  for (const k of ['kdf', 'cipher', 'zip', 'createdAt']) if (typeof b[k] !== 'string' || (b[k] as string).length > 40) return null;
  const { format, v, kdf, cipher, zip, salt, kcv, iv, ct, createdAt } = b;
  return { format, v, kdf, cipher, zip, salt, kcv, iv, ct, createdAt };
};

const listBackupDates = async (env: Env, sub: string): Promise<string[]> => {
  const prefix = backupPrefix(sub);
  const dates: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await env.STORE.list({ prefix, cursor });
    for (const k of page.keys) dates.push(k.name.slice(prefix.length));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return dates.filter(d => BACKUP_DATE.test(d)).sort().reverse();
};

const readBackupDeletion = async (env: Env, sub: string): Promise<BackupDeletion | null> => {
  const d = await env.STORE.get<BackupDeletion>(backupDeletionKey(sub), 'json');
  return d ? { ...d, due: d.due && typeof d.due === 'object' ? d.due : {} } : null;
};

/** Écrit l'effacement programmé (`purgeAt` recalculé), ou l'efface s'il ne concerne plus aucune copie. */
const writeBackupDeletion = async (env: Env, sub: string, d: BackupDeletion, nowMs = Date.now()): Promise<BackupDeletion | null> => {
  const dues = Object.values(d.due);
  if (dues.length === 0) {
    await env.STORE.delete(backupDeletionKey(sub));
    return null;
  }
  const record: BackupDeletion = { ...d, purgeAt: dues.reduce((a, b) => (b > a ? b : a)) };
  await env.STORE.put(backupDeletionKey(sub), JSON.stringify(record), { expirationTtl: deletionTtl(record, nowMs) });
  return record;
};

/**
 * Programme l'effacement, dans 7 jours, des copies présentes maintenant, et prévient les
 * appareils. Une copie déjà programmée garde son échéance (redemander n'avance rien) ; une
 * copie envoyée depuis la demande précédente (réactivation avec un nouveau code, autre
 * appareil encore activé) est ajoutée, avec sa propre échéance à 7 jours, et les appareils
 * sont prévenus à nouveau. `null` s'il n'y a aucune copie. Les copies envoyées APRÈS cette
 * demande ne sont pas concernées.
 */
const scheduleBackupDeletion = async (env: Env, sub: string, nowMs = Date.now()): Promise<BackupDeletion | null> => {
  const existing = await readBackupDeletion(env, sub);
  const due: Record<string, string> = { ...(existing?.due ?? {}) };
  const purgeAtMs = nowMs + BACKUP_DELETION_DELAY_MS;
  const added = (await listBackupDates(env, sub)).filter(d => !(d in due));
  for (const d of added) due[d] = new Date(purgeAtMs).toISOString();
  if (added.length === 0) return existing && Object.keys(existing.due).length > 0 ? existing : null;
  const deletion = await writeBackupDeletion(env, sub, { requestedAt: new Date(nowMs).toISOString(), purgeAt: '', due }, nowMs);
  await alertDevices(env, sub, {
    title: 'Pécule : effacement des copies de secours demandé',
    body: `Le ${parisDateTime(nowMs)}, l'effacement de vos copies de secours chiffrées a été demandé. Elles seront effacées le ${parisDay(purgeAtMs)}. `
      + 'Ce n\'est pas vous ? Ouvrez Pécule (reconnectez-vous si besoin) et annulez dans Paramètres.',
    url: settingsUrl(env, 'data'), tag: 'backup-deletion',
  }, { alsoRecentlyRemoved: true });
  return deletion;
};

/** Tâche quotidienne : efface les copies dont l'effacement programmé est arrivé à échéance. */
const purgeDueBackupDeletions = async (env: Env, nowMs: number, errors: string[]): Promise<void> => {
  let cursor: string | undefined;
  do {
    const page = await env.STORE.list({ prefix: 'backup-deletion:', cursor });
    for (const k of page.keys) {
      const sub = k.name.slice('backup-deletion:'.length);
      try {
        const deletion = await readBackupDeletion(env, sub);
        if (!deletion) continue;
        const left: Record<string, string> = {};
        let changed = Object.keys(deletion.due).length === 0;
        for (const [d, at] of Object.entries(deletion.due)) {
          if (Date.parse(at) > nowMs) { left[d] = at; continue; }
          if (BACKUP_DATE.test(d)) await env.STORE.delete(`${backupPrefix(sub)}${d}`);
          changed = true;
        }
        if (changed) await writeBackupDeletion(env, sub, { ...deletion, due: left }, nowMs);
      } catch (e) {
        console.error('backup deletion failed', e);
        errors.push(e instanceof Error ? e.message : String(e));
      }
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
};

const handleBackupPut = async (req: Request, env: Env, sub: string): Promise<Response> => {
  // En plus du limiteur par IP (point d'entrée), un limiteur par compte : protège le quota
  // d'écritures KV gratuit même depuis plusieurs adresses.
  if (await rateLimited(env.API_LIMITER, `backup:${sub}`)) return json(req, env, { error: 'RATE_LIMITED' }, 429, { 'Retry-After': '60' });
  const blob = parseBackupBody(await readJsonBody(req, BACKUP_MAX_BYTES));
  if (!blob) return json(req, env, { error: 'INVALID_BACKUP' }, 400);
  const c = parisCivilDate(new Date());
  const date = `${c.year}-${String(c.month).padStart(2, '0')}-${String(c.day).padStart(2, '0')}`;
  // Plafond quotidien par compte : l'envoi automatique a lieu au plus une fois par semaine.
  const countKey = `backup-puts:${sub}:${date}`;
  const count = Number(await env.STORE.get(countKey)) || 0;
  if (count >= BACKUP_PUTS_PER_DAY) return json(req, env, { error: 'RATE_LIMITED' }, 429, { 'Retry-After': '3600' });
  await env.STORE.put(countKey, String(count + 1), { expirationTtl: 2 * DAY });
  await env.STORE.put(`${backupPrefix(sub)}${date}`, JSON.stringify(blob), { expirationTtl: BACKUP_TTL });
  // Effacement programmé : la copie du jour vient d'être remplacée par une nouvelle, qui
  // n'est plus concernée.
  const deletion = await readBackupDeletion(env, sub);
  if (deletion && date in deletion.due) {
    const due = { ...deletion.due };
    delete due[date];
    await writeBackupDeletion(env, sub, { ...deletion, due });
  }
  const dates = await listBackupDates(env, sub);
  if (!dates.includes(date)) dates.unshift(date); // liste KV parfois en retard sur l'écriture
  const keep = backupsToKeep(dates);
  for (const old of dates) if (!keep.has(old)) await env.STORE.delete(`${backupPrefix(sub)}${old}`);
  return json(req, env, { ok: true, date, dates: dates.filter(d => keep.has(d)) });
};

/** Routes /backup, ou `null` si la requête ne les concerne pas. */
const backupRoute = async (req: Request, env: Env, url: URL): Promise<Response | null> => {
  const m = /^\/backup(?:\/([^/]+))?$/.exec(url.pathname);
  if (!m) return null;
  const s = await requireSession(req, env);
  const sub = s.session.sub;
  const date = m[1];
  if (date === undefined) {
    if (req.method === 'PUT') return handleBackupPut(req, env, sub);
    if (req.method === 'GET') {
      const deletion = await readBackupDeletion(env, sub);
      return json(req, env, {
        dates: await listBackupDates(env, sub),
        ...(deletion ? { deletion: { requestedAt: deletion.requestedAt, purgeAt: deletion.purgeAt, copies: Object.keys(deletion.due).length } } : {}),
      });
    }
    if (req.method === 'DELETE') {
      const deletion = await scheduleBackupDeletion(env, sub);
      return json(req, env, deletion
        ? { ok: true, scheduled: true, purgeAt: deletion.purgeAt, copies: Object.keys(deletion.due).length }
        : { ok: true, scheduled: false, copies: 0 });
    }
  } else if (date === 'deletion') {
    // Lu par l'app à chaque ouverture (une seule lecture KV) : un effacement programmé reste
    // visible même si toutes les notifications ont été coupées.
    if (req.method === 'GET') {
      const deletion = await readBackupDeletion(env, sub);
      return json(req, env, {
        deletion: deletion ? { requestedAt: deletion.requestedAt, purgeAt: deletion.purgeAt, copies: Object.keys(deletion.due).length } : null,
      });
    }
    if (req.method === 'DELETE') {
      const cancelled = !!(await readBackupDeletion(env, sub));
      if (cancelled) await env.STORE.delete(backupDeletionKey(sub));
      return json(req, env, { ok: true, cancelled });
    }
  } else if (req.method === 'GET') {
    if (!BACKUP_DATE.test(date)) return json(req, env, { error: 'NOT_FOUND' }, 404);
    const stored = await env.STORE.get(`${backupPrefix(sub)}${date}`);
    if (!stored) return json(req, env, { error: 'NOT_FOUND' }, 404);
    return json(req, env, JSON.parse(stored));
  }
  return json(req, env, { error: 'METHOD_NOT_ALLOWED' }, 405);
};

// ---------- Tâche quotidienne ----------

const RECONNECT_MESSAGE = (env: Env): PushMessage => ({
  title: 'Pécule', body: 'Reconnectez-vous à Pécule pour garder vos rappels.', url: env.APP_URL, tag: 'reconnect',
});

const remindUser = async (env: Env, sub: string, now: Date): Promise<void> => {
  const stored = await readPushList(env, sub);
  let subs = await pruneOrphanSubscriptions(env, stored);
  const persist = async () => { if (subs.length !== stored.length) await writePushList(env, sub, subs); };
  if (subs.length === 0) { await persist(); return; }

  const send = async (message: PushMessage, sentKey: string, ttl: number) => {
    if (await env.STORE.get(sentKey)) return;
    const { delivered, gone } = await deliver(env, subs, message);
    if (gone.length) subs = subs.filter(x => !gone.includes(x.endpoint));
    // Marqué « envoyé » seulement si au moins un appareil l'a reçu : sinon on réessaie demain.
    if (delivered > 0) await env.STORE.put(sentKey, '1', { expirationTtl: ttl });
  };

  let accessToken: string;
  try {
    accessToken = (await accessTokenFor(env, sub)).access_token;
  } catch (e) {
    if (isInvalidGrant(e)) {
      // Accès Google révoqué : plus rien à faire pour ce compte, on efface tout (sauf la
      // sauvegarde de secours chiffrée, voir purgeUser).
      await purgeUser(env.STORE, sub, undefined);
      return;
    }
    console.error('cannot refresh token for reminders', e);
    await send(RECONNECT_MESSAGE(env), `sent:${sub}:reconnect`, RECONNECT_NOTICE_TTL);
    await persist();
    return;
  }
  try {
    const data = await readDataFile(accessToken);
    if (!data) return;
    let reminders = computeReminders(data, parisCivilDate(now), env.APP_URL)
      .filter(r => isReminderEnabled(r.key, data.config?.notificationPrefs));
    if (isDiscreet(data)) reminders = applyDiscreetMode(reminders);
    for (const reminder of reminders) {
      if (subs.length === 0) break;
      await send(reminder.message, `sent:${sub}:${reminder.key}`, SENT_TTL);
    }
  } finally {
    await persist();
  }
};

/**
 * Conservation du jeton Google (page de confidentialité) : après les rappels, chaque compte
 * gardé est revu. Plus de session ni de notification : il est effacé. Sinon, sans
 * notification (ceux qui en ont viennent d'être vérifiés par remindUser), un rafraîchissement
 * constate un accès retiré chez Google, et tout est alors effacé comme dans /token. Une
 * panne passagère de Google ne purge rien.
 */
const sweepUserRecords = async (env: Env, now: Date, errors: string[]): Promise<void> => {
  let cursor: string | undefined;
  do {
    const page = await env.STORE.list({ prefix: USER_PREFIX, cursor });
    for (const k of page.keys) {
      const sub = k.name.slice(USER_PREFIX.length);
      try {
        // Date.now() (et non le début de la tâche) : une connexion faite pendant les rappels
        // reste dans le délai de grâce.
        if (await releaseUserIfUnused(env.STORE, sub, Date.now(), { graceMs: RECENT_WRITE_GRACE_MS })) continue;
        if (await env.STORE.get(pushKey(sub))) continue;
        try {
          await accessTokenFor(env, sub);
        } catch (e) {
          if (isInvalidGrant(e)) await purgeUser(env.STORE, sub, undefined);
          else console.error('cannot refresh token during retention check', e);
        }
      } catch (e) {
        console.error('retention check failed', e);
        errors.push(e instanceof Error ? e.message : String(e));
      }
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
};

const runDailyReminders = async (env: Env): Promise<void> => {
  const now = new Date();
  let usersProcessed = 0;
  const errors: string[] = [];
  try {
    let cursor: string | undefined;
    do {
      const page = await env.STORE.list({ prefix: 'push:', cursor });
      for (const k of page.keys) {
        usersProcessed++;
        try { await remindUser(env, k.name.slice('push:'.length), now); }
        catch (e) { console.error('reminders failed', e); errors.push(e instanceof Error ? e.message : String(e)); }
      }
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
    await sweepUserRecords(env, now, errors);
    await purgeDueBackupDeletions(env, now.getTime(), errors);
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e));
  } finally {
    const health: CronHealth = {
      lastRunAt: now.toISOString(), ok: errors.length === 0, usersProcessed,
      ...(errors.length ? { error: `${errors.length} échec(s) : ${errors[0]}`.slice(0, 300) } : {}),
    };
    await env.STORE.put('health:cron', JSON.stringify(health));
  }
};

// ---------- Point d'entrée ----------

/** Routes ouvertes par navigation (redirection OAuth), exemptées du contrôle d'origine. Les
 *  autres sont appelées par fetch() depuis l'app : l'en-tête Origin, s'il est présent, doit être autorisé. */
const NAVIGATION_ROUTES = new Set(['GET /auth/start', 'GET /auth/callback']);

const rateLimited = async (limiter: RateLimit | undefined, key: string): Promise<boolean> => {
  if (!limiter) return false;
  try { return !(await limiter.limit({ key })).success; } catch { return false; }
};

const route = async (req: Request, env: Env, url: URL, r: string): Promise<Response> => {
  const backup = await backupRoute(req, env, url);
  if (backup) return backup;
  switch (r) {
    case 'GET /health': return handleHealth(req, env);
    case 'GET /status': return handleStatus(req, env);
    case 'GET /fiscal-sources': return handleFiscalSources(req, env);
    case 'GET /fiscal-watch': return handleFiscalWatch(req, env);
    case 'POST /fiscal-watch/run': return handleFiscalWatchRun(req, env);
    case 'GET /auth/start': return handleAuthStart(req, env, url);
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
      ctx.waitUntil(runAndStoreFiscalWatch(env.STORE, env.AI).then(
        r => console.log('fiscal watch', r.ok, Object.keys(r.values).length, 'values', r.neuronsUsed ?? r.neuronsEstimate, 'neurons'),
        e => console.error('fiscal watch failed', e),
      ));
      return;
    }
    ctx.waitUntil(runDailyReminders(env));
  },
};
