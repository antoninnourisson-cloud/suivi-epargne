// ================================================
// FILE: worker/src/handlers/auth.ts
// Routes de connexion Google, des sessions (appareils connectés), du jeton et du compte.
// Découpé de worker/src/index.ts sans changement de comportement.
// ================================================
import { sha256b64url, encryptString, decryptWithFallback, randomToken } from '../crypto';
import { OAUTH_SCOPES, exchangeCode, decodeIdToken, verifyIdTokenClaims, revokeToken } from '../google';
import { safeReturnUrl, deriveStateKey, newOAuthState, signState, verifyState, readCookie, oauthCookie, OAUTH_COOKIE, timingSafeEqual, readJsonBody } from '../security';
import { createSession, loadSession, touchSession, deleteSession, deleteAllSessions, bindSession, listSessions, sessionPublicId, isLegacySession } from '../sessions';
import { parseDeviceKey, importDeviceKey, sameDeviceKey, verifyProof, proofNonces, sanitizeDeviceLabel } from '../deviceProof';
import { UserRecord, userKey, readUser, writeUser, releaseUserIfUnused } from '../userRecords';
import { json, htmlPage, redirect, accountLimited } from './http';
import { AuthFailure, issuedNonces, readSession, requireSession, isEmailAllowed, accessTokenFor, isInvalidGrant } from './session';
import { pushKey, readPushList, writePushList, rememberRemovedSubscriptions, purgeUser } from './pushStore';
import { scheduleBackupDeletion } from './backup';
import type { Env } from '../index';

const LOGIN_CODE_TTL = 60;       // minimum KV ; le code est effacé dès l'échange

export const handleAuthStart = async (req: Request, env: Env, url: URL): Promise<Response> => {
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

export const handleAuthCallback = async (req: Request, env: Env, url: URL): Promise<Response> => {
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

export const handleExchange = async (req: Request, env: Env): Promise<Response> => {
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
    record = JSON.parse((await decryptWithFallback(sealed, env.ENCRYPTION_KEY, env.ENCRYPTION_KEY_PREVIOUS)).plaintext);
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
export const handleBind = async (req: Request, env: Env): Promise<Response> => {
  const s = await readSession(req, env);
  if (!s || isLegacySession(s.session)) throw new AuthFailure('REAUTH_REQUIRED');
  const limited = await accountLimited(req, env, 'bind', s.session.sub);
  if (limited) return limited;
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

export const handleSessions = async (req: Request, env: Env): Promise<Response> => {
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
export const handleRevokeSession = async (req: Request, env: Env): Promise<Response> => {
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

export const handleToken = async (req: Request, env: Env): Promise<Response> => {
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

export const handleLogout = async (req: Request, env: Env): Promise<Response> => {
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

export const handleLogoutAll = async (req: Request, env: Env): Promise<Response> => {
  const s = await requireSession(req, env);
  const revoked = await deleteAllSessions(env.STORE, s.session.sub, s.hash);
  await rememberRemovedSubscriptions(env, s.session.sub, (await readPushList(env, s.session.sub)).filter(x => x.sessionHash !== s.hash));
  await env.STORE.delete(pushKey(s.session.sub));
  // Plus aucune session ni notification : le jeton Google, l'e-mail et l'identifiant partent
  // aussi (la sauvegarde de secours chiffrée reste, comme les marqueurs « déjà envoyé »).
  await env.STORE.delete(userKey(s.session.sub));
  return json(req, env, { ok: true, sessionsRevoked: revoked });
};

export const handleAccountDelete = async (req: Request, env: Env): Promise<Response> => {
  const s = await requireSession(req, env);
  let googleRevoked = false;
  const user = await env.STORE.get<UserRecord>(`user:${s.session.sub}`, 'json');
  if (user) {
    try {
      const res = await revokeToken((await decryptWithFallback(user.refreshTokenEnc, env.ENCRYPTION_KEY, env.ENCRYPTION_KEY_PREVIOUS)).plaintext);
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
