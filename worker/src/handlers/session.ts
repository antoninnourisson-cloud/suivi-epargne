// ================================================
// FILE: worker/src/handlers/session.ts
// Authentification d'une requête (session, preuve d'appareil) et jeton Google d'un utilisateur.
// Découpé de worker/src/index.ts sans changement de comportement.
// ================================================
import { sha256b64url, encryptString, decryptWithFallback, DecryptError } from '../crypto';
import { refreshAccessToken, GoogleAuthError } from '../google';
import { SessionRecord, loadSession, deleteSession, isLegacySession } from '../sessions';
import { PROOF_HEADER, verifyProof, proofNonces } from '../deviceProof';
import { readUser, writeUser, touchUser } from '../userRecords';
import type { Env } from '../index';

type AuthedSession = { hash: string; session: SessionRecord };

type AuthFailureCode = 'REAUTH_REQUIRED' | 'PROOF_REQUIRED' | 'PROOF_INVALID' | 'PROOF_NONCE';
/**
 * Refus d'authentification : réponse 401 avec ce code (voir le point d'entrée) et, pour une
 * preuve absente ou un nonce périmé, le nonce courant pour que l'app signe et réessaie.
 */
export class AuthFailure extends Error {
  constructor(readonly code: AuthFailureCode, readonly nonce?: string) { super(code); this.name = 'AuthFailure'; }
}

/** Nonce courant à rendre avec la réponse à cette requête (en-tête X-Pecule-Nonce). */
export const issuedNonces = new WeakMap<Request, string>();

/**
 * Session du porteur (en-tête Authorization), sans contrôle de la preuve, ou `null`. Une
 * session dont le compte a été retiré d'ALLOWED_EMAILS depuis la connexion est effacée.
 */
export const readSession = async (req: Request, env: Env): Promise<AuthedSession | null> => {
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
export const requireSession = async (req: Request, env: Env): Promise<AuthedSession> => {
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

export const isEmailAllowed = (email: string | undefined, env: Env): boolean => {
  // Aucune liste configurée = personne n'est autorisé. Refuser par défaut évite qu'un
  // Worker déployé sans configuration serve de relais OAuth à n'importe quel compte.
  const allowed = (env.ALLOWED_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  return !!email && allowed.includes(email.toLowerCase());
};

/** Jeton d'accès frais pour un utilisateur, à partir de son refresh token chiffré. */
export const accessTokenFor = async (env: Env, sub: string): Promise<{ access_token: string; expires_in: number }> => {
  const user = await readUser(env.STORE, sub);
  if (!user) throw new GoogleAuthError('invalid_grant', 'NO_USER');
  let refreshToken: string;
  let reseal: boolean;
  try {
    const d = await decryptWithFallback(user.refreshTokenEnc, env.ENCRYPTION_KEY, env.ENCRYPTION_KEY_PREVIOUS);
    refreshToken = d.plaintext;
    reseal = d.usedPrevious;
  } catch (e) {
    // Jeton illisible avec la clé courante comme avec l'ancienne (clé changée sans conserver
    // l'ancienne) : irrécupérable. Traité comme un accès révoqué : l'appelant efface le compte
    // et l'app demande de se reconnecter (et non une panne réseau, 502).
    if (e instanceof DecryptError) throw new GoogleAuthError('invalid_grant', 'UNDECRYPTABLE_TOKEN');
    throw e;
  }
  const tokens = await refreshAccessToken(refreshToken, env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET);
  // Google peut faire tourner le refresh token : on garde toujours le plus récent. Sinon,
  // l'usage prolonge seulement la durée de vie du compte (au plus une écriture par jour).
  if ((tokens.refresh_token && tokens.refresh_token !== refreshToken) || reseal) {
    // Aussi quand le jeton n'était lisible qu'avec l'ancienne clé : réécrit avec la courante,
    // pour que ENCRYPTION_KEY_PREVIOUS puisse ensuite être retirée.
    await writeUser(env.STORE, sub, {
      ...user, refreshTokenEnc: await encryptString(tokens.refresh_token ?? refreshToken, env.ENCRYPTION_KEY), updatedAt: Date.now(),
    });
  } else {
    await touchUser(env.STORE, sub, user);
  }
  return { access_token: tokens.access_token, expires_in: tokens.expires_in };
};

export const isInvalidGrant = (e: unknown) => e instanceof GoogleAuthError && e.code === 'invalid_grant';
/** Délai dépassé, erreur 5xx de Google ou panne réseau : passager, à réessayer plus tard. */
export const isTransientGoogleError = (e: unknown) =>
  (e instanceof GoogleAuthError && (e.code === 'TIMEOUT' || /^HTTP_5\d\d$/.test(e.code))) || e instanceof TypeError;
