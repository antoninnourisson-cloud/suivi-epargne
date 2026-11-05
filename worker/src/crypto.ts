// ================================================
// FILE: worker/src/crypto.ts
// Primitives cryptographiques (WebCrypto uniquement : disponible nativement dans les
// Workers comme dans Node, donc testable hors Cloudflare).
// ================================================

const te = new TextEncoder();
const td = new TextDecoder();

export const b64urlEncode = (bytes: Uint8Array): string => {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

export const b64urlDecode = (s: string): Uint8Array<ArrayBuffer> => {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

export const concatBytes = (...parts: (Uint8Array | number[])[]): Uint8Array => {
  const arrays = parts.map(p => (p instanceof Uint8Array ? p : Uint8Array.from(p)));
  const out = new Uint8Array(arrays.reduce((n, a) => n + a.length, 0));
  let offset = 0;
  for (const a of arrays) { out.set(a, offset); offset += a.length; }
  return out;
};

export const utf8 = (s: string): Uint8Array<ArrayBuffer> => new Uint8Array(te.encode(s));

/** Jeton aléatoire (session, state OAuth, code de connexion à usage unique). */
export const randomToken = (bytes = 32): string => b64urlEncode(crypto.getRandomValues(new Uint8Array(bytes)));

/**
 * Empreinte SHA-256. Les jetons de session ne sont stockés que HACHÉS : une fuite du
 * stockage KV ne permettrait pas de les rejouer.
 */
export const sha256b64url = async (s: string): Promise<string> =>
  b64urlEncode(new Uint8Array(await crypto.subtle.digest('SHA-256', te.encode(s))));

const importAesKey = (keyB64url: string): Promise<CryptoKey> => {
  const raw = b64urlDecode(keyB64url);
  if (raw.length !== 32) throw new Error('ENCRYPTION_KEY must be 32 bytes (base64url)');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
};

/**
 * Chiffrement au repos du refresh token Google (AES-256-GCM, IV aléatoire préfixé).
 * La clé vit dans un secret du Worker, jamais dans le stockage : lire KV seul ne suffit
 * donc pas pour obtenir un jeton exploitable.
 */
export const encryptString = async (plaintext: string, keyB64url: string): Promise<string> => {
  const key = await importAesKey(keyB64url);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, te.encode(plaintext)));
  return b64urlEncode(concatBytes(iv, ct));
};

/** Texte chiffré illisible avec la clé essayée (mauvaise clé, texte tronqué ou altéré). */
export class DecryptError extends Error {
  constructor() { super('DECRYPT_FAILED'); this.name = 'DecryptError'; }
}

export const decryptString = async (payload: string, keyB64url: string): Promise<string> => {
  const key = await importAesKey(keyB64url);
  try {
    const bytes = b64urlDecode(payload);
    if (bytes.length < 13) throw new DecryptError();
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12) }, key, bytes.slice(12));
    return td.decode(pt);
  } catch { throw new DecryptError(); }
};

/**
 * Déchiffre avec la clé courante, puis, si elle échoue, avec l'ancienne (ENCRYPTION_KEY_PREVIOUS,
 * le temps d'un changement de clé). `usedPrevious` : l'appelant peut réécrire la valeur avec la
 * clé courante. Lève DecryptError si aucune des deux ne convient ; une clé mal formée (config)
 * lève une autre erreur, qui n'est pas prise pour un jeton perdu.
 */
export const decryptWithFallback = async (
  payload: string, currentKey: string, previousKey?: string,
): Promise<{ plaintext: string; usedPrevious: boolean }> => {
  try {
    return { plaintext: await decryptString(payload, currentKey), usedPrevious: false };
  } catch (e) {
    if (!(e instanceof DecryptError) || !previousKey) throw e;
  }
  return { plaintext: await decryptString(payload, previousKey), usedPrevious: true };
};
