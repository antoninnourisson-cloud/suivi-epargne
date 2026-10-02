// ================================================
// FILE: worker/src/index.ts
// Serveur minimal de Pécule (Cloudflare Worker). Deux rôles, et seulement deux :
//
// 1. SESSION PERSISTANTE — le flux OAuth « code » de Google délivre un refresh token
//    longue durée, impossible à obtenir côté navigateur. Il est chiffré et gardé ici ;
//    l'app échange sa session contre des jetons d'accès courts (1 h) et continue de
//    parler DIRECTEMENT à Drive. Les données financières ne transitent pas ici.
//
// 2. NOTIFICATIONS PUSH — une tâche quotidienne relit le fichier Drive (lecture seule)
//    pour calculer les rappels (échéances, révision des taux, intérêts de décembre...)
//    et les envoie, chiffrés de bout en bout, aux appareils abonnés.
//
// Stockage (KV) :
//   code:<sha256(c)>  code de connexion à usage unique, contenu CHIFFRÉ (60 s, effacé à l'échange)
//   session:<hash>    session de l'app — clé = SHA-256 du jeton, 60 jours au plus (sessions.ts)
//   sessions:<sub>    index des sessions de l'utilisateur
//   user:<sub>        refresh token Google CHIFFRÉ (AES-256-GCM, clé en secret du Worker)
//   push:<sub>        abonnements push des appareils (subscriptions.ts)
//   sent:<sub>:<k>    rappels déjà envoyés (dédoublonnage, ~400 jours)
//   health:cron       compte rendu de la dernière tâche quotidienne
// Le state OAuth n'est plus stocké : il est signé (HMAC) et lié au navigateur par cookie.
// ================================================
import { sha256b64url, encryptString, decryptString, randomToken } from './crypto';
import {
  OAUTH_SCOPES, exchangeCode, refreshAccessToken, decodeIdToken, verifyIdTokenClaims, revokeToken, readDataFile, GoogleAuthError,
} from './google';
import { sendPush, PushMessage } from './webpush';
import { fetchFiscalSources, FiscalSource } from './fiscalSources';
import { isReminderEnabled } from '../../src/lib/notificationPrefs';
import { computeReminders, applyDiscreetMode, isDiscreet, parisCivilDate } from './reminders';
import {
  allowedOrigins, isOriginAcceptable, safeReturnUrl, deriveStateKey, newOAuthState, signState, verifyState,
  readCookie, oauthCookie, clearOAuthCookie, OAUTH_COOKIE, timingSafeEqual, readJsonBody, BodyTooLargeError,
} from './security';
import {
  DAY, SessionRecord, createSession, loadSession, touchSession, deleteSession, deleteAllSessions, sessionExists,
} from './sessions';
import {
  StoredSubscription, parseSubscription, upsertSubscription, describeDevices, deviceId, readStoredList,
} from './subscriptions';

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
}

const SENT_TTL = 400 * DAY;
const RECONNECT_NOTICE_TTL = 3 * DAY;
const LOGIN_CODE_TTL = 60;       // minimum KV ; le code est effacé dès l'échange

interface UserRecord { email: string; refreshTokenEnc: string; updatedAt: number }
interface CronHealth { lastRunAt: string; ok: boolean; error?: string; usersProcessed: number }

// ---------- HTTP utilitaires ----------

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

const readSession = async (req: Request, env: Env): Promise<AuthedSession | null> => {
  const auth = req.headers.get('Authorization') || '';
  const m = /^Bearer\s+([A-Za-z0-9_-]{20,128})$/.exec(auth);
  if (!m) return null;
  const hash = await sha256b64url(m[1]);
  const session = await loadSession(env.STORE, hash);
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

const isInvalidGrant = (e: unknown) => e instanceof GoogleAuthError && e.code === 'invalid_grant';

// ---------- Stockage des abonnements ----------

const pushKey = (sub: string) => `push:${sub}`;
const readPushList = async (env: Env, sub: string): Promise<StoredSubscription[]> =>
  readStoredList(await env.STORE.get(pushKey(sub), 'json'));
const writePushList = (env: Env, sub: string, list: StoredSubscription[]) =>
  list.length === 0 ? env.STORE.delete(pushKey(sub)) : env.STORE.put(pushKey(sub), JSON.stringify(list));

/** Retire les abonnements dont la session propriétaire n'existe plus (les anciens, sans session, restent). */
const pruneOrphanSubscriptions = async (env: Env, list: StoredSubscription[]): Promise<StoredSubscription[]> => {
  const alive: StoredSubscription[] = [];
  for (const s of list) {
    if (!s.sessionHash || await sessionExists(env.STORE, s.sessionHash)) alive.push(s);
  }
  return alive;
};

/** Efface TOUT ce que le serveur sait d'un utilisateur. */
export const purgeUser = async (store: KVNamespace, sub: string, alsoSessionHash?: string): Promise<void> => {
  await deleteAllSessions(store, sub, alsoSessionHash);
  await store.delete(`user:${sub}`);
  await store.delete(pushKey(sub));
  let cursor: string | undefined;
  do {
    const page = await store.list({ prefix: `sent:${sub}:`, cursor });
    for (const k of page.keys) await store.delete(k.name);
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
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
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
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

  const { token: sessionToken } = await createSession(env.STORE, identity.sub, identity.email!);

  // La session n'apparaît jamais dans une URL : l'app reçoit un code à usage unique (dans
  // le fragment, jamais envoyé à un serveur) qu'elle échange immédiatement. Le contenu est
  // chiffré et indexé par l'empreinte du code : lire KV ne suffit pas à l'exploiter.
  const loginCode = randomToken(24);
  await env.STORE.put(`code:${await sha256b64url(loginCode)}`, await encryptString(JSON.stringify({
    session: sessionToken, access_token: tokens.access_token, expires_in: tokens.expires_in,
  }), env.ENCRYPTION_KEY), { expirationTtl: LOGIN_CODE_TTL });

  return redirect(`${state.returnUrl}#login_code=${loginCode}`);
};

const handleExchange = async (req: Request, env: Env): Promise<Response> => {
  const body = await readJsonBody(req) as { code?: unknown };
  if (typeof body.code !== 'string' || !/^[A-Za-z0-9_-]{20,64}$/.test(body.code)) return json(req, env, { error: 'INVALID_CODE' }, 400);
  const key = `code:${await sha256b64url(body.code)}`;
  const sealed = await env.STORE.get(key);
  if (!sealed) return json(req, env, { error: 'INVALID_CODE' }, 400);
  await env.STORE.delete(key);
  try {
    const record = JSON.parse(await decryptString(sealed, env.ENCRYPTION_KEY));
    return json(req, env, { session: record.session, access_token: record.access_token, expires_in: record.expires_in });
  } catch {
    return json(req, env, { error: 'INVALID_CODE' }, 400);
  }
};

const handleToken = async (req: Request, env: Env): Promise<Response> => {
  const s = await readSession(req, env);
  if (!s) return json(req, env, { error: 'REAUTH_REQUIRED' }, 401);
  try {
    const tokens = await accessTokenFor(env, s.session.sub);
    // Session glissante, plafonnée à 60 jours depuis la connexion.
    await touchSession(env.STORE, s.hash, s.session);
    return json(req, env, tokens);
  } catch (e) {
    if (isInvalidGrant(e)) {
      // Accès révoqué côté Google (ou refresh token expiré) : on efface tout.
      await purgeUser(env.STORE, s.session.sub, s.hash);
      return json(req, env, { error: 'REAUTH_REQUIRED' }, 401);
    }
    console.error('token refresh failed', e);
    return json(req, env, { error: 'UPSTREAM_ERROR' }, 502);
  }
};

const handleLogout = async (req: Request, env: Env): Promise<Response> => {
  const s = await readSession(req, env);
  if (s) {
    await deleteSession(env.STORE, s.hash, s.session.sub);
    // Les abonnements créés par cette session partent avec elle.
    const list = await readPushList(env, s.session.sub);
    const kept = list.filter(x => x.sessionHash !== s.hash);
    if (kept.length !== list.length) await writePushList(env, s.session.sub, kept);
  }
  return json(req, env, { ok: true });
};

const handleLogoutAll = async (req: Request, env: Env): Promise<Response> => {
  const s = await readSession(req, env);
  if (!s) return json(req, env, { error: 'REAUTH_REQUIRED' }, 401);
  const revoked = await deleteAllSessions(env.STORE, s.session.sub, s.hash);
  await env.STORE.delete(pushKey(s.session.sub));
  return json(req, env, { ok: true, sessionsRevoked: revoked });
};

const handleAccountDelete = async (req: Request, env: Env): Promise<Response> => {
  const s = await readSession(req, env);
  if (!s) return json(req, env, { error: 'REAUTH_REQUIRED' }, 401);
  let googleRevoked = false;
  const user = await env.STORE.get<UserRecord>(`user:${s.session.sub}`, 'json');
  if (user) {
    try {
      const res = await revokeToken(await decryptString(user.refreshTokenEnc, env.ENCRYPTION_KEY));
      googleRevoked = !!res && res.ok;
    } catch (e) { console.error('revoke failed', e); }
  }
  await purgeUser(env.STORE, s.session.sub, s.hash);
  return json(req, env, { ok: true, googleRevoked });
};

// ---------- Routes : notifications ----------

const handleSubscribe = async (req: Request, env: Env): Promise<Response> => {
  const s = await readSession(req, env);
  if (!s) return json(req, env, { error: 'REAUTH_REQUIRED' }, 401);
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
  for (const x of list) if (!(await match(x))) kept.push(x);
  if (kept.length !== list.length) await writePushList(env, sub, kept);
  return { removed: kept.length !== list.length, devices: kept.length };
};

const handleUnsubscribe = async (req: Request, env: Env): Promise<Response> => {
  const s = await readSession(req, env);
  if (!s) return json(req, env, { error: 'REAUTH_REQUIRED' }, 401);
  const body = await readJsonBody(req) as { endpoint?: unknown };
  const { devices } = await removeEndpoint(env, s.session.sub, x => x.endpoint === body.endpoint);
  return json(req, env, { ok: true, devices });
};

const handleDevices = async (req: Request, env: Env): Promise<Response> => {
  const s = await readSession(req, env);
  if (!s) return json(req, env, { error: 'REAUTH_REQUIRED' }, 401);
  const list = await readPushList(env, s.session.sub);
  return json(req, env, { devices: await describeDevices(list, s.hash) });
};

const handleRemoveDevice = async (req: Request, env: Env): Promise<Response> => {
  const s = await readSession(req, env);
  if (!s) return json(req, env, { error: 'REAUTH_REQUIRED' }, 401);
  const body = await readJsonBody(req) as { endpoint?: unknown; id?: unknown };
  if (typeof body.endpoint !== 'string' && typeof body.id !== 'string') return json(req, env, { error: 'INVALID_REQUEST' }, 400);
  const result = await removeEndpoint(env, s.session.sub, async x =>
    (typeof body.endpoint === 'string' && x.endpoint === body.endpoint)
    || (typeof body.id === 'string' && (await deviceId(x.endpoint)) === body.id));
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
  const s = await readSession(req, env);
  if (!s) return json(req, env, { error: 'REAUTH_REQUIRED' }, 401);
  const list = await readPushList(env, s.session.sub);
  const { delivered, gone } = await deliver(env, list, {
    title: 'Pécule', body: 'Les notifications fonctionnent sur cet appareil.', url: env.APP_URL, tag: 'test',
  });
  if (gone.length) await writePushList(env, s.session.sub, list.filter(x => !gone.includes(x.endpoint)));
  return json(req, env, { ok: delivered > 0, delivered });
};

// Pages officielles pour la veille fiscale (mises en cache 3 jours : une lecture par semaine
// et par appareil suffit, et le cache évite de solliciter les sites publics).
const handleFiscalSources = async (req: Request, env: Env): Promise<Response> => {
  const s = await readSession(req, env);
  if (!s) return json(req, env, { error: 'REAUTH_REQUIRED' }, 401);
  const cached = await env.STORE.get<{ fetchedAt: string; sources: FiscalSource[] }>('fiscal-sources', 'json');
  if (cached && cached.sources.some(x => x.ok)) return json(req, env, cached);
  const sources = await fetchFiscalSources();
  const payload = { fetchedAt: new Date().toISOString(), sources };
  if (sources.filter(x => x.ok).length >= 4) await env.STORE.put('fiscal-sources', JSON.stringify(payload), { expirationTtl: 3 * 86400 });
  return json(req, env, payload);
};

const handleHealth = async (req: Request, env: Env): Promise<Response> => {
  const s = await readSession(req, env);
  if (!s) return json(req, env, { error: 'REAUTH_REQUIRED' }, 401);
  const health = await env.STORE.get<CronHealth>('health:cron', 'json');
  return json(req, env, health ?? { lastRunAt: null, ok: null, usersProcessed: 0 });
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
      // Accès Google révoqué : plus rien à faire pour ce compte, on efface tout.
      await purgeUser(env.STORE, sub);
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

/** Routes appelées par fetch() depuis l'app : l'en-tête Origin, s'il est présent, doit être autorisé. */
const NAVIGATION_ROUTES = new Set(['GET /auth/start', 'GET /auth/callback']);

const rateLimited = async (limiter: RateLimit | undefined, key: string): Promise<boolean> => {
  if (!limiter) return false;
  try { return !(await limiter.limit({ key })).success; } catch { return false; }
};

const route = async (req: Request, env: Env, url: URL, r: string): Promise<Response> => {
  switch (r) {
    case 'GET /health': return handleHealth(req, env);
    case 'GET /fiscal-sources': return handleFiscalSources(req, env);
    case 'GET /auth/start': return handleAuthStart(req, env, url);
    case 'GET /auth/callback': {
      const res = await handleAuthCallback(req, env, url);
      res.headers.append('Set-Cookie', clearOAuthCookie());
      return res;
    }
    case 'POST /auth/exchange': return handleExchange(req, env);
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
      return await route(req, env, url, r);
    } catch (e) {
      if (e instanceof BodyTooLargeError) return json(req, env, { error: 'BODY_TOO_LARGE' }, 413);
      console.error('unhandled', e);
      return json(req, env, { error: 'INTERNAL' }, 500);
    }
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runDailyReminders(env));
  },
};
