// ================================================
// FILE: worker/src/index.ts
// Serveur minimal de Suivi Épargne (Cloudflare Worker). Deux rôles, et seulement deux :
//
// 1. SESSION PERSISTANTE — le flux OAuth « code » de Google délivre un refresh token
//    longue durée, impossible à obtenir côté navigateur. Il est chiffré et gardé ici ;
//    l'app échange sa session contre des jetons d'accès courts (1 h) et continue de
//    parler DIRECTEMENT à Drive/Gmail. Les données financières ne transitent pas ici.
//
// 2. NOTIFICATIONS PUSH — une tâche quotidienne relit le fichier Drive (lecture seule)
//    pour calculer les rappels (échéances, révision des taux, intérêts de décembre...)
//    et les envoie, chiffrés de bout en bout, aux appareils abonnés.
//
// Stockage (KV) :
//   state:<s>        état OAuth anti-CSRF (10 min)
//   code:<c>         code de connexion à usage unique remis à l'app (2 min)
//   session:<hash>   session de l'app — clé = SHA-256 du jeton, jamais le jeton lui-même
//   user:<sub>       refresh token Google CHIFFRÉ (AES-256-GCM, clé en secret du Worker)
//   push:<sub>       abonnements push des appareils
//   sent:<sub>:<k>   rappels déjà envoyés (dédoublonnage)
// ================================================
import { randomToken, sha256b64url, encryptString, decryptString } from './crypto';
import {
  OAUTH_SCOPES, exchangeCode, refreshAccessToken, decodeIdToken, revokeToken, readDataFile, GoogleAuthError,
} from './google';
import { sendPush, PushSubscriptionJSON, PushMessage } from './webpush';
import { computeReminders } from './reminders';

export interface Env {
  STORE: KVNamespace;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;  // secret
  ENCRYPTION_KEY: string;        // secret — 32 octets base64url
  VAPID_PUBLIC_KEY: string;      // secret — point P-256 non compressé, base64url
  VAPID_PRIVATE_KEY: string;     // secret — scalaire d, base64url
  VAPID_SUBJECT: string;
  APP_URL: string;               // ex : https://<user>.github.io/suivi-epargne/
  EXTRA_ORIGINS?: string;        // origines supplémentaires autorisées (dev local), séparées par des virgules
  ALLOWED_EMAILS?: string;       // secret — comptes Google autorisés, séparés par des virgules
}

const DAY = 86_400;
const SESSION_TTL = 180 * DAY;
const MAX_SUBSCRIPTIONS = 10;

interface SessionRecord { sub: string; email: string; createdAt: number; refreshedAt: number }
interface UserRecord { email: string; refreshTokenEnc: string; updatedAt: number }

// ---------- HTTP utilitaires ----------

const allowedOrigins = (env: Env): string[] => [
  new URL(env.APP_URL).origin,
  ...(env.EXTRA_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean),
];

const corsHeaders = (req: Request, env: Env): Record<string, string> => {
  const origin = req.headers.get('Origin');
  if (!origin || !allowedOrigins(env).includes(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
};

const json = (req: Request, env: Env, data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...corsHeaders(req, env) },
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
<a href="${escapeHtml(env.APP_URL)}" style="display:inline-block;margin-top:12px;background:#4f46e5;color:white;padding:10px 16px;border-radius:10px;text-decoration:none;font-weight:600">Retour à l'app</a>
</main></body></html>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } }
  );

/** URL de retour autorisée uniquement vers l'app elle-même (pas de redirection ouverte). */
const safeReturnUrl = (candidate: string | null, env: Env): string => {
  if (!candidate) return env.APP_URL;
  try {
    const u = new URL(candidate);
    if (!allowedOrigins(env).includes(u.origin)) return env.APP_URL;
    u.hash = '';
    return u.toString();
  } catch { return env.APP_URL; }
};

const readSession = async (req: Request, env: Env): Promise<{ hash: string; session: SessionRecord } | null> => {
  const auth = req.headers.get('Authorization') || '';
  const m = /^Bearer\s+([A-Za-z0-9_-]{20,})$/.exec(auth);
  if (!m) return null;
  const hash = await sha256b64url(m[1]);
  const session = await env.STORE.get<SessionRecord>(`session:${hash}`, 'json');
  return session ? { hash, session } : null;
};

const isEmailAllowed = (email: string | undefined, env: Env): boolean => {
  // Aucune liste configurée = personne n'est autorisé. Refuser par défaut évite qu'un
  // Worker déployé sans configuration serve de relais OAuth à n'importe quel compte.
  const allowed = (env.ALLOWED_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  return !!email && allowed.includes(email.toLowerCase());
};

/** Jeton d'accès frais pour un utilisateur, à partir de son refresh token chiffré. */
const accessTokenFor = async (env: Env, sub: string): Promise<{ access_token: string; expires_in: number }> => {
  const user = await env.STORE.get<UserRecord>(`user:${sub}`, 'json');
  if (!user) throw new GoogleAuthError('invalid_grant', 'NO_USER');
  const refreshToken = await decryptString(user.refreshTokenEnc, env.ENCRYPTION_KEY);
  const tokens = await refreshAccessToken(refreshToken, env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET);
  // Google peut faire tourner le refresh token : on garde toujours le plus récent.
  if (tokens.refresh_token && tokens.refresh_token !== refreshToken) {
    await env.STORE.put(`user:${sub}`, JSON.stringify({
      ...user, refreshTokenEnc: await encryptString(tokens.refresh_token, env.ENCRYPTION_KEY), updatedAt: Date.now(),
    }));
  }
  return { access_token: tokens.access_token, expires_in: tokens.expires_in };
};

// ---------- Routes ----------

const handleAuthStart = async (req: Request, env: Env, url: URL): Promise<Response> => {
  const state = randomToken(24);
  await env.STORE.put(`state:${state}`, JSON.stringify({ returnUrl: safeReturnUrl(url.searchParams.get('return'), env) }), { expirationTtl: 600 });
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: `${url.origin}/auth/callback`,
    response_type: 'code',
    scope: OAUTH_SCOPES,
    // offline + consent : garantit la délivrance d'un refresh token à chaque connexion.
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });
  return Response.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`, 302);
};

const handleAuthCallback = async (req: Request, env: Env, url: URL): Promise<Response> => {
  const state = url.searchParams.get('state');
  const stored = state ? await env.STORE.get<{ returnUrl: string }>(`state:${state}`, 'json') : null;
  if (!state || !stored) return htmlPage(env, 'Connexion expirée', 'Cette tentative de connexion a expiré ou a déjà été utilisée. Relancez la connexion depuis l’app.');
  await env.STORE.delete(`state:${state}`);

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
  const identity = decodeIdToken(tokens.id_token);
  if (!identity.email_verified || !isEmailAllowed(identity.email, env)) {
    if (tokens.refresh_token) await revokeToken(tokens.refresh_token);
    return htmlPage(env, 'Compte non autorisé', 'Ce serveur est réservé à son propriétaire. Connectez-vous avec le compte Google configuré.', 403);
  }
  // Consentement granulaire : l'utilisateur peut décocher Drive. Sans lui l'app est inutilisable.
  if (!(tokens.scope || '').includes('drive.file')) {
    return htmlPage(env, 'Autorisation Drive manquante', 'L’accès à Google Drive est indispensable : relancez la connexion en cochant toutes les autorisations.');
  }

  const existing = await env.STORE.get<UserRecord>(`user:${identity.sub}`, 'json');
  const refreshToken = tokens.refresh_token;
  if (!refreshToken && !existing) {
    return htmlPage(env, 'Connexion incomplète', 'Google n’a pas fourni de jeton de longue durée. Relancez la connexion.', 502);
  }
  if (refreshToken) {
    await env.STORE.put(`user:${identity.sub}`, JSON.stringify({
      email: identity.email!, refreshTokenEnc: await encryptString(refreshToken, env.ENCRYPTION_KEY), updatedAt: Date.now(),
    } satisfies UserRecord));
  }

  const sessionToken = randomToken(32);
  const now = Date.now();
  await env.STORE.put(`session:${await sha256b64url(sessionToken)}`, JSON.stringify({
    sub: identity.sub, email: identity.email!, createdAt: now, refreshedAt: now,
  } satisfies SessionRecord), { expirationTtl: SESSION_TTL });

  // La session n'apparaît jamais dans une URL : l'app reçoit un code à usage unique (dans
  // le fragment, jamais envoyé à un serveur) qu'elle échange immédiatement.
  const loginCode = randomToken(24);
  await env.STORE.put(`code:${loginCode}`, JSON.stringify({
    session: sessionToken, access_token: tokens.access_token, expires_in: tokens.expires_in, email: identity.email,
  }), { expirationTtl: 120 });

  return Response.redirect(`${stored.returnUrl}#login_code=${loginCode}`, 302);
};

const handleExchange = async (req: Request, env: Env): Promise<Response> => {
  const body = await req.json().catch(() => ({})) as { code?: string };
  if (!body.code || !/^[A-Za-z0-9_-]{20,}$/.test(body.code)) return json(req, env, { error: 'INVALID_CODE' }, 400);
  const record = await env.STORE.get(`code:${body.code}`, 'json');
  if (!record) return json(req, env, { error: 'INVALID_CODE' }, 400);
  await env.STORE.delete(`code:${body.code}`);
  return json(req, env, record);
};

const handleToken = async (req: Request, env: Env): Promise<Response> => {
  const s = await readSession(req, env);
  if (!s) return json(req, env, { error: 'REAUTH_REQUIRED' }, 401);
  try {
    const tokens = await accessTokenFor(env, s.session.sub);
    // Session glissante : chaque utilisation la prolonge (au plus une écriture par jour).
    if (Date.now() - s.session.refreshedAt > DAY * 1000) {
      await env.STORE.put(`session:${s.hash}`, JSON.stringify({ ...s.session, refreshedAt: Date.now() }), { expirationTtl: SESSION_TTL });
    }
    return json(req, env, tokens);
  } catch (e) {
    if (e instanceof GoogleAuthError && e.code === 'invalid_grant') {
      // Accès révoqué côté Google (ou refresh token expiré) : la session ne vaut plus rien.
      await env.STORE.delete(`session:${s.hash}`);
      await env.STORE.delete(`user:${s.session.sub}`);
      return json(req, env, { error: 'REAUTH_REQUIRED' }, 401);
    }
    console.error('token refresh failed', e);
    return json(req, env, { error: 'UPSTREAM_ERROR' }, 502);
  }
};

const handleLogout = async (req: Request, env: Env): Promise<Response> => {
  const s = await readSession(req, env);
  if (s) await env.STORE.delete(`session:${s.hash}`);
  return json(req, env, { ok: true });
};

const isValidSubscription = (sub: any): sub is PushSubscriptionJSON => {
  try {
    return typeof sub?.endpoint === 'string' && new URL(sub.endpoint).protocol === 'https:'
      && typeof sub.keys?.p256dh === 'string' && sub.keys.p256dh.length >= 80
      && typeof sub.keys?.auth === 'string' && sub.keys.auth.length >= 16;
  } catch { return false; }
};

const handleSubscribe = async (req: Request, env: Env): Promise<Response> => {
  const s = await readSession(req, env);
  if (!s) return json(req, env, { error: 'REAUTH_REQUIRED' }, 401);
  const body = await req.json().catch(() => ({})) as { subscription?: unknown };
  if (!isValidSubscription(body.subscription)) return json(req, env, { error: 'INVALID_SUBSCRIPTION' }, 400);
  const key = `push:${s.session.sub}`;
  const subs = (await env.STORE.get<PushSubscriptionJSON[]>(key, 'json')) || [];
  const next = [...subs.filter(x => x.endpoint !== (body.subscription as PushSubscriptionJSON).endpoint), body.subscription as PushSubscriptionJSON]
    .slice(-MAX_SUBSCRIPTIONS);
  await env.STORE.put(key, JSON.stringify(next));
  return json(req, env, { ok: true, devices: next.length });
};

const handleUnsubscribe = async (req: Request, env: Env): Promise<Response> => {
  const s = await readSession(req, env);
  if (!s) return json(req, env, { error: 'REAUTH_REQUIRED' }, 401);
  const body = await req.json().catch(() => ({})) as { endpoint?: string };
  const key = `push:${s.session.sub}`;
  const subs = (await env.STORE.get<PushSubscriptionJSON[]>(key, 'json')) || [];
  const next = subs.filter(x => x.endpoint !== body.endpoint);
  if (next.length === 0) await env.STORE.delete(key); else await env.STORE.put(key, JSON.stringify(next));
  return json(req, env, { ok: true, devices: next.length });
};

/** Envoie un message à tous les appareils ; retire ceux qui n'existent plus. */
const deliver = async (env: Env, sub: string, message: PushMessage): Promise<number> => {
  const key = `push:${sub}`;
  const subs = (await env.STORE.get<PushSubscriptionJSON[]>(key, 'json')) || [];
  const vapid = { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT };
  let delivered = 0;
  const gone: string[] = [];
  for (const subscription of subs) {
    try {
      const status = await sendPush(subscription, message, vapid);
      if (status >= 200 && status < 300) delivered++;
      else if (status === 404 || status === 410) gone.push(subscription.endpoint);
      else console.error('push rejected', status, new URL(subscription.endpoint).origin);
    } catch (e) {
      console.error('push failed', e);
    }
  }
  if (gone.length) {
    const remaining = subs.filter(x => !gone.includes(x.endpoint));
    if (remaining.length === 0) await env.STORE.delete(key); else await env.STORE.put(key, JSON.stringify(remaining));
  }
  return delivered;
};

const handleTestPush = async (req: Request, env: Env): Promise<Response> => {
  const s = await readSession(req, env);
  if (!s) return json(req, env, { error: 'REAUTH_REQUIRED' }, 401);
  const delivered = await deliver(env, s.session.sub, {
    title: 'Suivi Épargne', body: 'Les notifications fonctionnent sur cet appareil.', url: env.APP_URL, tag: 'test',
  });
  return json(req, env, { ok: delivered > 0, delivered });
};

// ---------- Tâche quotidienne ----------

const remindUser = async (env: Env, sub: string, now: Date): Promise<void> => {
  const subs = await env.STORE.get<PushSubscriptionJSON[]>(`push:${sub}`, 'json');
  if (!subs || subs.length === 0) return;
  let accessToken: string;
  try {
    accessToken = (await accessTokenFor(env, sub)).access_token;
  } catch (e) {
    console.error('cannot refresh token for reminders', sub, e);
    return;
  }
  const data = await readDataFile(accessToken);
  if (!data) return;
  for (const reminder of computeReminders(data, now, env.APP_URL)) {
    const sentKey = `sent:${sub}:${reminder.key}`;
    if (await env.STORE.get(sentKey)) continue;
    // Marqué « envoyé » seulement si au moins un appareil l'a reçu : sinon on réessaie demain.
    if (await deliver(env, sub, reminder.message) > 0) {
      await env.STORE.put(sentKey, '1', { expirationTtl: 400 * DAY });
    }
  }
};

const runDailyReminders = async (env: Env): Promise<void> => {
  const now = new Date();
  let cursor: string | undefined;
  do {
    const page = await env.STORE.list({ prefix: 'push:', cursor });
    for (const k of page.keys) {
      try { await remindUser(env, k.name.slice('push:'.length), now); }
      catch (e) { console.error('reminders failed', e); }
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
};

// ---------- Point d'entrée ----------

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(req, env) });

    try {
      const route = `${req.method} ${url.pathname}`;
      switch (route) {
        case 'GET /health': return json(req, env, { ok: true });
        case 'GET /auth/start': return handleAuthStart(req, env, url);
        case 'GET /auth/callback': return handleAuthCallback(req, env, url);
        case 'POST /auth/exchange': return handleExchange(req, env);
        case 'POST /auth/logout': return handleLogout(req, env);
        case 'POST /token': return handleToken(req, env);
        case 'GET /push/vapid-public-key': return json(req, env, { key: env.VAPID_PUBLIC_KEY });
        case 'POST /push/subscribe': return handleSubscribe(req, env);
        case 'POST /push/unsubscribe': return handleUnsubscribe(req, env);
        case 'POST /push/test': return handleTestPush(req, env);
        default: return json(req, env, { error: 'NOT_FOUND' }, 404);
      }
    } catch (e) {
      console.error('unhandled', e);
      return json(req, env, { error: 'INTERNAL' }, 500);
    }
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runDailyReminders(env));
  },
};
