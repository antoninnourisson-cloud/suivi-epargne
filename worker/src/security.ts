// ================================================
// FILE: worker/src/security.ts
// Garde-fous HTTP du Worker, sans état et testables hors Cloudflare :
// - origines autorisées (CORS) et URL de retour après connexion (pas de redirection ouverte) ;
// - state OAuth signé (HMAC) au lieu d'une écriture KV, lié au navigateur par un cookie ;
// - lecture bornée des corps JSON.
// ================================================
import { b64urlDecode, b64urlEncode, randomToken, utf8 } from './crypto';

export interface OriginConfig { APP_URL: string; LEGACY_APP_URL?: string; EXTRA_ORIGINS?: string }

const extraOrigins = (env: OriginConfig): string[] =>
  (env.EXTRA_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);

/** L'app, puis son ancienne adresse pendant le déménagement (origine ET chemin, comme APP_URL). */
const appUrls = (env: OriginConfig): URL[] =>
  [env.APP_URL, env.LEGACY_APP_URL].filter((u): u is string => !!u).map(u => new URL(u));

export const allowedOrigins = (env: OriginConfig): string[] => [...appUrls(env).map(u => u.origin), ...extraOrigins(env)];

/** `true` si l'en-tête Origin est absent (client non navigateur) ou autorisé. */
export const isOriginAcceptable = (origin: string | null, env: OriginConfig): boolean =>
  origin === null || allowedOrigins(env).includes(origin);

/** Bases d'URL de retour : l'app (origine ET chemin, ex. /suivi-epargne/), et les origines de dev. */
const returnBases = (env: OriginConfig): { origin: string; prefix: string }[] => {
  const withSlash = (p: string) => (p.endsWith('/') ? p : `${p}/`);
  return [
    ...appUrls(env).map(app => ({ origin: app.origin, prefix: withSlash(app.pathname) })),
    ...extraOrigins(env).map(o => ({ origin: new URL(o).origin, prefix: '/' })),
  ];
};

/**
 * URL de retour autorisée uniquement vers l'app elle-même : même origine ET même préfixe
 * de chemin. Sur github.io, l'origine seule est partagée par tous les dépôts du compte.
 */
export const safeReturnUrl = (candidate: string | null, env: OriginConfig): string => {
  if (!candidate) return env.APP_URL;
  try {
    const u = new URL(candidate);
    if (u.username || u.password) return env.APP_URL;
    const ok = returnBases(env).some(b =>
      u.origin === b.origin && (u.pathname.startsWith(b.prefix) || `${u.pathname}/` === b.prefix));
    if (!ok) return env.APP_URL;
    u.hash = '';
    return u.toString();
  } catch { return env.APP_URL; }
};

// ---------- State OAuth signé ----------

// Clé HMAC dérivée (HKDF) de ENCRYPTION_KEY, avec une étiquette propre : aucun nouveau
// secret à poser, et la clé de chiffrement n'est jamais utilisée telle quelle pour signer.
const STATE_KEY_INFO = 'pecule/oauth-state/hmac/v1';
export const STATE_TTL_MS = 10 * 60 * 1000;
export const OAUTH_COOKIE = '__Host-pecule_oauth';

export interface OAuthState { returnUrl: string; exp: number; nonce: string }

export const deriveStateKey = async (encryptionKeyB64url: string): Promise<CryptoKey> => {
  const ikm = await crypto.subtle.importKey('raw', b64urlDecode(encryptionKeyB64url), 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: utf8(STATE_KEY_INFO) }, ikm, 256);
  return crypto.subtle.importKey('raw', bits, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
};

export const newOAuthState = (returnUrl: string, nowMs = Date.now()): OAuthState =>
  ({ returnUrl, exp: nowMs + STATE_TTL_MS, nonce: randomToken(16) });

export const signState = async (state: OAuthState, key: CryptoKey): Promise<string> => {
  const payload = b64urlEncode(utf8(JSON.stringify(state)));
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, utf8(payload)));
  return `${payload}.${b64urlEncode(sig)}`;
};

/** State valide (signature + expiration), ou `null`. La comparaison est faite par WebCrypto. */
export const verifyState = async (token: string | null, key: CryptoKey, nowMs = Date.now()): Promise<OAuthState | null> => {
  if (!token || token.length > 2048) return null;
  const m = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(token);
  if (!m) return null;
  try {
    const ok = await crypto.subtle.verify('HMAC', key, b64urlDecode(m[2]), utf8(m[1]));
    if (!ok) return null;
    const state = JSON.parse(new TextDecoder().decode(b64urlDecode(m[1]))) as OAuthState;
    if (typeof state.returnUrl !== 'string' || typeof state.nonce !== 'string' || typeof state.exp !== 'number') return null;
    if (nowMs > state.exp) return null;
    return state;
  } catch { return null; }
};

export const readCookie = (req: Request, name: string): string | null => {
  for (const part of (req.headers.get('Cookie') || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
};

export const oauthCookie = (nonce: string): string =>
  `${OAUTH_COOKIE}=${nonce}; Path=/; Max-Age=${STATE_TTL_MS / 1000}; HttpOnly; Secure; SameSite=Lax`;
export const clearOAuthCookie = (): string =>
  `${OAUTH_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;

export const timingSafeEqual = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

// ---------- Corps de requête bornés ----------

export const MAX_BODY_BYTES = 4096;

export class BodyTooLargeError extends Error { constructor() { super('BODY_TOO_LARGE'); } }

/** JSON du corps, ou `{}` s'il est vide ou invalide. Lève BodyTooLargeError au-delà de `max`. */
export const readJsonBody = async (req: Request, max = MAX_BODY_BYTES): Promise<Record<string, unknown>> => {
  const declared = Number(req.headers.get('Content-Length') || '0');
  if (declared > max) throw new BodyTooLargeError();
  const text = await req.text();
  if (utf8(text).length > max) throw new BodyTooLargeError();
  if (!text) return {};
  try {
    const v = JSON.parse(text);
    return v && typeof v === 'object' ? v : {};
  } catch { return {}; }
};
