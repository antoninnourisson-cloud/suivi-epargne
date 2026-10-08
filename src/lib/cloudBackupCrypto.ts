// ================================================
// FILE: src/lib/cloudBackupCrypto.ts
// Sauvegarde de secours chiffrée de bout en bout (copie gardée par le serveur Cloudflare).
// Fonctions pures (WebCrypto seulement, ni réseau ni stockage) : code de secours, dérivation
// de clé, format de la copie chiffrée.
//
// - Code de secours : 128 bits aléatoires, écrits en base32 Crockford (26 caractères) + 2
//   caractères de contrôle (CRC-16) = 28 caractères, affichés en 7 groupes de 4. Le contrôle
//   distingue une faute de frappe d'un mauvais code, sans jamais toucher au serveur.
// - Dérivation : HKDF-SHA-256 (le code a déjà 128 bits d'entropie : pas besoin d'un
//   étirement lent type PBKDF2), sel aléatoire de 16 octets propre à l'activation, stocké
//   avec chaque copie. Deux sorties séparées par leur étiquette : la clé AES-256-GCM, et une
//   valeur de contrôle (kcv) qui dit « mauvais code » avant toute tentative de déchiffrement.
// - Copie (format v1) : JSON { format, v, kdf, cipher, zip, salt, kcv, iv, ct, createdAt }.
//   L'en-tête entier est authentifié (données associées de GCM) : le modifier rend la copie
//   illisible, comme modifier le texte chiffré.
// ================================================

const BACKUP_FORMAT = 'pecule-backup';
const BACKUP_VERSION = 1;
const KDF = 'HKDF-SHA256';
const CIPHER = 'AES-256-GCM';
const KEY_INFO = 'pecule/cloud-backup/v1/aes-gcm-key';
const CHECK_INFO = 'pecule/cloud-backup/v1/key-check';

export type Zip = 'gzip' | 'none';

export interface CloudBackupBlobV1 {
  format: typeof BACKUP_FORMAT;
  v: 1;
  kdf: typeof KDF;
  cipher: typeof CIPHER;
  zip: Zip;
  salt: string;      // base64url, 16 octets
  kcv: string;       // base64url, 16 octets — valeur de contrôle de la clé
  iv: string;        // base64url, 12 octets
  ct: string;        // base64url — texte chiffré + étiquette GCM
  createdAt: string; // ISO 8601
}

export type CloudBackupErrorCode = 'UNSUPPORTED_FORMAT' | 'UNSUPPORTED_VERSION' | 'WRONG_CODE' | 'CORRUPTED' | 'INVALID_CODE';

export class CloudBackupError extends Error {
  constructor(public readonly code: CloudBackupErrorCode) { super(code); this.name = 'CloudBackupError'; }
}

// ---------- base64url ----------

export const b64urlEncode = (bytes: Uint8Array): string => {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

export const b64urlDecode = (s: string): Uint8Array<ArrayBuffer> => {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new CloudBackupError('CORRUPTED');
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

const utf8 = (s: string): Uint8Array<ArrayBuffer> => {
  const enc = new TextEncoder().encode(s);
  const out = new Uint8Array(enc.length);
  out.set(enc);
  return out;
};

// ---------- Code de secours ----------

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // base32 Crockford (ni I, L, O, U)
const RECOVERY_CODE_BYTES = 16;
const DATA_CHARS = 26;  // ceil(128 / 5)
const CHECK_CHARS = 2;  // 10 bits de CRC-16

/** CRC-16/CCITT-FALSE : détecte toute faute d'un caractère et les inversions courantes. */
const crc16 = (bytes: Uint8Array): number => {
  let crc = 0xffff;
  for (const b of bytes) {
    crc ^= b << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc;
};

const toBase32 = (bytes: Uint8Array): string => {
  let bits = 0, value = 0, out = '';
  for (const b of bytes) {
    value = (value << 8) | b; bits += 8;
    while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
};

/** Code lisible (7 groupes de 4) à partir des 16 octets. */
export const formatRecoveryCode = (bytes: Uint8Array): string => {
  if (bytes.length !== RECOVERY_CODE_BYTES) throw new CloudBackupError('INVALID_CODE');
  const check = crc16(bytes) >>> 6; // 10 bits de poids fort
  const raw = toBase32(bytes) + ALPHABET[check >>> 5] + ALPHABET[check & 31];
  return raw.match(/.{4}/g)!.join('-');
};

/** Nouveau code de secours (aléatoire cryptographique). */
export const generateRecoveryCode = (): { code: string; bytes: Uint8Array<ArrayBuffer> } => {
  const bytes = crypto.getRandomValues(new Uint8Array(RECOVERY_CODE_BYTES));
  return { code: formatRecoveryCode(bytes), bytes };
};

export type ParsedCode = { ok: true; bytes: Uint8Array<ArrayBuffer> } | { ok: false; reason: 'length' | 'chars' | 'typo' };

/**
 * Relit un code saisi : majuscules ou minuscules, tirets et espaces facultatifs, et les
 * confusions habituelles corrigées (O → 0, I et L → 1). `typo` = contrôle faux.
 */
export const parseRecoveryCode = (input: string): ParsedCode => {
  const s = input.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (s.length !== DATA_CHARS + CHECK_CHARS) return { ok: false, reason: 'length' };
  const vals: number[] = [];
  for (const c of s) {
    const v = ALPHABET.indexOf(c);
    if (v < 0) return { ok: false, reason: 'chars' };
    vals.push(v);
  }
  const bytes = new Uint8Array(RECOVERY_CODE_BYTES);
  let bits = 0, value = 0, n = 0;
  for (const v of vals.slice(0, DATA_CHARS)) {
    value = (value << 5) | v; bits += 5;
    if (bits >= 8) { bytes[n++] = (value >>> (bits - 8)) & 0xff; bits -= 8; value &= (1 << bits) - 1; }
  }
  if (value !== 0) return { ok: false, reason: 'typo' }; // bits de remplissage non nuls
  const check = (vals[DATA_CHARS] << 5) | vals[DATA_CHARS + 1];
  if (check !== crc16(bytes) >>> 6) return { ok: false, reason: 'typo' };
  return { ok: true, bytes };
};

// ---------- Dérivation ----------

export const newSalt = (): Uint8Array<ArrayBuffer> => crypto.getRandomValues(new Uint8Array(16));

/**
 * Clé AES-256-GCM (non exportable) et valeur de contrôle, dérivées du code et du sel.
 * `usages` permet de garder sur l'appareil une clé qui ne sait QUE chiffrer.
 */
export const deriveBackupKey = async (
  codeBytes: Uint8Array<ArrayBuffer>, salt: Uint8Array<ArrayBuffer>, usages: KeyUsage[] = ['encrypt', 'decrypt'],
): Promise<{ key: CryptoKey; kcv: string }> => {
  const ikm = await crypto.subtle.importKey('raw', codeBytes, 'HKDF', false, ['deriveKey', 'deriveBits']);
  const key = await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: utf8(KEY_INFO) }, ikm, { name: 'AES-GCM', length: 256 }, false, usages);
  const check = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info: utf8(CHECK_INFO) }, ikm, 128);
  return { key, kcv: b64urlEncode(new Uint8Array(check)) };
};

// ---------- Compression (facultative : dépend du navigateur) ----------

const pipe = async (bytes: Uint8Array<ArrayBuffer>, stream: CompressionStream | DecompressionStream): Promise<Uint8Array<ArrayBuffer>> =>
  new Uint8Array(await new Response(new Response(bytes).body!.pipeThrough(stream)).arrayBuffer());

const canGzip = (): boolean => typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';

// ---------- Format de la copie ----------

const aad = (h: Omit<CloudBackupBlobV1, 'iv' | 'ct'>): Uint8Array<ArrayBuffer> =>
  utf8(JSON.stringify([h.format, h.v, h.kdf, h.cipher, h.zip, h.salt, h.kcv, h.createdAt]));

/** Chiffre `plaintext` (le JSON des données) en une copie au format v1. */
export const encryptBackup = async (
  plaintext: string, key: CryptoKey, header: { salt: string; kcv: string }, now = new Date(), zip: Zip = canGzip() ? 'gzip' : 'none',
): Promise<CloudBackupBlobV1> => {
  const h = {
    format: BACKUP_FORMAT, v: BACKUP_VERSION, kdf: KDF, cipher: CIPHER, zip,
    salt: header.salt, kcv: header.kcv, createdAt: now.toISOString(),
  } as const;
  const raw = utf8(plaintext);
  const body = zip === 'gzip' ? await pipe(raw, new CompressionStream('gzip')) : raw;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(h) }, key, body));
  return { ...h, iv: b64urlEncode(iv), ct: b64urlEncode(ct) };
};

const B64URL = /^[A-Za-z0-9_-]+$/;

/** Contrôle la forme d'une copie reçue du serveur. Lève UNSUPPORTED_FORMAT / _VERSION. */
export const parseBackupBlob = (raw: unknown): CloudBackupBlobV1 => {
  if (!raw || typeof raw !== 'object' || (raw as { format?: unknown }).format !== BACKUP_FORMAT) throw new CloudBackupError('UNSUPPORTED_FORMAT');
  const b = raw as Record<string, unknown>;
  if (b.v !== BACKUP_VERSION) throw new CloudBackupError('UNSUPPORTED_VERSION');
  if (b.kdf !== KDF || b.cipher !== CIPHER || (b.zip !== 'gzip' && b.zip !== 'none')) throw new CloudBackupError('UNSUPPORTED_FORMAT');
  for (const k of ['salt', 'kcv', 'iv', 'ct'] as const) {
    if (typeof b[k] !== 'string' || !B64URL.test(b[k] as string)) throw new CloudBackupError('CORRUPTED');
  }
  if (typeof b.createdAt !== 'string') throw new CloudBackupError('CORRUPTED');
  return {
    format: BACKUP_FORMAT, v: 1, kdf: KDF, cipher: CIPHER, zip: b.zip as Zip,
    salt: b.salt as string, kcv: b.kcv as string, iv: b.iv as string, ct: b.ct as string, createdAt: b.createdAt,
  };
};

/** Le code correspond-il à cette copie ? (sans déchiffrer) */
export const codeMatchesBlob = async (codeBytes: Uint8Array<ArrayBuffer>, blob: CloudBackupBlobV1): Promise<boolean> => {
  const { kcv } = await deriveBackupKey(codeBytes, b64urlDecode(blob.salt), ['decrypt']);
  return kcv === blob.kcv;
};

/**
 * Déchiffre une copie avec le code de secours. Erreurs propres :
 * WRONG_CODE (le code ne correspond pas), CORRUPTED (copie modifiée ou abîmée),
 * UNSUPPORTED_FORMAT / UNSUPPORTED_VERSION.
 */
export const decryptBackup = async (raw: unknown, codeBytes: Uint8Array<ArrayBuffer>): Promise<string> => {
  const blob = parseBackupBlob(raw);
  const salt = b64urlDecode(blob.salt);
  const { key, kcv } = await deriveBackupKey(codeBytes, salt, ['decrypt']);
  if (kcv !== blob.kcv) throw new CloudBackupError('WRONG_CODE');
  let body: Uint8Array<ArrayBuffer>;
  try {
    body = new Uint8Array(await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: b64urlDecode(blob.iv), additionalData: aad(blob) }, key, b64urlDecode(blob.ct)));
  } catch {
    throw new CloudBackupError('CORRUPTED');
  }
  try {
    const plain = blob.zip === 'gzip' ? await pipe(body, new DecompressionStream('gzip')) : body;
    return new TextDecoder('utf-8', { fatal: true }).decode(plain);
  } catch {
    throw new CloudBackupError('CORRUPTED');
  }
};

/** Empreinte SHA-256 (base64url) : sert à savoir si les données ont changé depuis le dernier envoi. */
export const sha256b64url = async (s: string): Promise<string> =>
  b64urlEncode(new Uint8Array(await crypto.subtle.digest('SHA-256', utf8(s))));

/** Une copie automatique par semaine au plus, et seulement si les données ont changé. */
export const AUTO_UPLOAD_INTERVAL_MS = 7 * 24 * 3600 * 1000;
export const shouldAutoUpload = (
  status: { lastUploadAt?: string; lastHash?: string } | null, currentHash: string, now: Date,
): boolean => {
  if (!status?.lastUploadAt) return true;
  if (status.lastHash === currentHash) return false;
  const last = Date.parse(status.lastUploadAt);
  return !Number.isFinite(last) || now.getTime() - last >= AUTO_UPLOAD_INTERVAL_MS;
};
