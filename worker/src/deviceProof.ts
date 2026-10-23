// ================================================
// FILE: worker/src/deviceProof.ts
// Session liée à l'appareil (preuve de possession, à la manière de DPoP, RFC 9449, avec le
// « nonce » du serveur de son §8).
//
// À la connexion, l'app crée une paire de clés ECDSA P-256 dont la partie privée est NON
// EXPORTABLE (WebCrypto) et envoie la clé publique, gardée avec la session. Ensuite, chaque
// requête porte l'en-tête `X-Pecule-Proof: <nonce>.<signature>`, signature de
// « nonce \n MÉTHODE \n chemin ». Le nonce vient du serveur (en-tête `X-Pecule-Nonce` de ses
// réponses) : un HMAC de la session et d'une tranche de 5 minutes, valable 5 à 10 minutes et
// imprévisible à l'avance. Une preuve ne peut donc pas être fabriquée pour plus tard.
//
// Ce que cela protège : un jeton de session copié SEUL (stockage local lu par une extension,
// journal, sauvegarde partielle) ne sert à rien sans la clé privée, qui ne peut pas être lue
// par JavaScript.
// Ce que cela ne protège PAS (SECURITY.md) : un script qui s'exécute DANS la page peut faire
// signer des requêtes tant qu'il y est, et envoyer ailleurs des preuves valables au plus
// 10 minutes ; quelqu'un qui copie TOUT le profil du navigateur emporte aussi la clé (le
// navigateur peut la garder telle quelle sur le disque).
// ================================================
import { b64urlDecode, b64urlEncode, utf8 } from './crypto';
import { timingSafeEqual } from './security';

export const PROOF_HEADER = 'X-Pecule-Proof';
export const NONCE_HEADER = 'X-Pecule-Nonce';
/** Durée d'une tranche de nonce (secondes) : le nonce courant et le précédent sont acceptés. */
export const NONCE_PERIOD_S = 300;

/** Clé publique P-256 (coordonnées base64url, 32 octets chacune). */
export interface DeviceKey { x: string; y: string }

const COORD = /^[A-Za-z0-9_-]{43}$/;

/** Clé reconstruite champ par champ depuis un JWK, ou `null` si la forme est fausse. */
export const parseDeviceKey = (raw: unknown): DeviceKey | null => {
  if (!raw || typeof raw !== 'object') return null;
  const { kty, crv, x, y } = raw as Record<string, unknown>;
  if (kty !== 'EC' || crv !== 'P-256' || typeof x !== 'string' || typeof y !== 'string') return null;
  if (!COORD.test(x) || !COORD.test(y)) return null;
  return { x, y };
};

export const sameDeviceKey = (a: DeviceKey | undefined, b: DeviceKey): boolean => !!a && a.x === b.x && a.y === b.y;

/** Clé de vérification, ou `null` si le point n'est pas sur la courbe. */
export const importDeviceKey = async (key: DeviceKey): Promise<CryptoKey | null> => {
  try {
    return await crypto.subtle.importKey(
      'jwk', { kty: 'EC', crv: 'P-256', x: key.x, y: key.y, ext: true },
      { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  } catch { return null; }
};

// ---------- Nonce du serveur ----------

// Clé HMAC dérivée (HKDF) de ENCRYPTION_KEY avec sa propre étiquette, comme celle du state
// OAuth (security.ts) : aucun nouveau secret, et la clé de chiffrement ne signe jamais rien.
const NONCE_KEY_INFO = 'pecule/proof-nonce/hmac/v1';
const nonceKeys = new Map<string, Promise<CryptoKey>>();
const nonceKey = (secret: string): Promise<CryptoKey> => {
  let k = nonceKeys.get(secret);
  if (!k) {
    k = (async () => {
      const ikm = await crypto.subtle.importKey('raw', b64urlDecode(secret), 'HKDF', false, ['deriveBits']);
      const bits = await crypto.subtle.deriveBits(
        { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: utf8(NONCE_KEY_INFO) }, ikm, 256);
      return crypto.subtle.importKey('raw', bits, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    })();
    k.catch(() => nonceKeys.delete(secret));
    nonceKeys.set(secret, k);
  }
  return k;
};

const nonceFor = async (secret: string, sessionHash: string, bucket: number): Promise<string> =>
  b64urlEncode(new Uint8Array(await crypto.subtle.sign('HMAC', await nonceKey(secret), utf8(`${sessionHash}\n${bucket}`))));

/**
 * Nonces acceptés pour cette session : [courant, précédent]. Le courant est rendu à l'app
 * avec chaque réponse ; il reste valable jusqu'à la fin de la tranche suivante (5 à 10 min).
 */
export const proofNonces = async (secret: string, sessionHash: string, nowMs = Date.now()): Promise<[string, string]> => {
  const bucket = Math.floor(nowMs / 1000 / NONCE_PERIOD_S);
  return Promise.all([nonceFor(secret, sessionHash, bucket), nonceFor(secret, sessionHash, bucket - 1)]);
};

// ---------- Preuve ----------

/** Message signé : nonce du serveur, méthode, chemin (sans paramètres). */
export const proofMessage = (nonce: string, method: string, path: string): Uint8Array<ArrayBuffer> =>
  utf8(`${nonce}\n${method.toUpperCase()}\n${path}`);

/** `stale` : nonce inconnu ou périmé (l'app reprend le nonce rendu et réessaie). */
export type ProofCheck = 'ok' | 'missing' | 'invalid' | 'stale';

/**
 * Vérifie une preuve `<nonce>.<signature>` (signature ECDSA P-256 / SHA-256 au format brut
 * r‖s de WebCrypto, 64 octets) pour cette méthode, ce chemin et l'un des nonces acceptés.
 */
export const verifyProof = async (
  key: DeviceKey, proof: string | null, method: string, path: string, nonces: readonly string[],
): Promise<ProofCheck> => {
  if (!proof) return 'missing';
  const m = /^([A-Za-z0-9_-]{43})\.([A-Za-z0-9_-]{86})$/.exec(proof);
  if (!m) return 'invalid';
  if (!nonces.some(n => timingSafeEqual(n, m[1]))) return 'stale';
  const verifier = await importDeviceKey(key);
  if (!verifier) return 'invalid';
  try {
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, verifier, b64urlDecode(m[2]), proofMessage(m[1], method, path));
    return ok ? 'ok' : 'invalid';
  } catch { return 'invalid'; }
};

/** Pour les tests et outils : signe comme le fait l'app. */
export const signProof = async (privateKey: CryptoKey, method: string, path: string, nonce: string): Promise<string> => {
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, proofMessage(nonce, method, path)));
  return `${nonce}.${b64urlEncode(sig)}`;
};

/**
 * Type d'appareil déclaré par l'app (« téléphone Android (Chrome) ») : texte court, sans
 * caractère de contrôle. Il sert seulement à l'affichage (liste des sessions, alerte).
 */
export const sanitizeDeviceLabel = (raw: unknown): string | undefined => {
  if (typeof raw !== 'string') return undefined;
  // eslint-disable-next-line no-control-regex
  const s = raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);
  return s || undefined;
};
