// ================================================
// FILE: src/services/cloudBackup.ts
// Sauvegarde de secours chiffrée de bout en bout, gardée par le serveur (Cloudflare KV).
// Drive reste la source de vérité ; cette copie sert si le fichier Drive est abîmé ou
// supprimé. Le serveur ne reçoit que du texte chiffré : le code de secours et la clé ne
// quittent jamais l'appareil (format et dérivation : src/lib/cloudBackupCrypto.ts).
//
// Sur l'appareil (IndexedDB « pecule-cloud-backup ») : la clé dérivée, NON exportable et
// limitée au chiffrement, avec son sel et sa valeur de contrôle — jamais le code lui-même.
// Elle permet l'envoi automatique hebdomadaire sans redemander le code. Restaurer exige
// toujours de saisir le code.
// ================================================
import type { GlobalAppData } from '../types';
import { canonicalize, withoutDeviceOnlyFields } from '../lib/schema';
import {
  CloudBackupError, b64urlDecode, b64urlEncode, decryptBackup, deriveBackupKey, encryptBackup, newSalt,
  parseBackupBlob, parseRecoveryCode, sha256b64url, shouldAutoUpload, type CloudBackupBlobV1,
} from '../lib/cloudBackupCrypto';
import { BACKEND_URL, getSessionToken, hasBackendSession, isBackendEnabled } from './backendService';

export { generateRecoveryCode, CloudBackupError } from '../lib/cloudBackupCrypto';

/** Même plafond que le serveur (worker/src/index.ts, PUT /backup). */
export const MAX_BACKUP_BYTES = 2 * 1024 * 1024;

const DB_NAME = 'pecule-cloud-backup';
const STORE = 'keys';
const KEY_ID = 'current';
const STATUS_KEY = 'cloud_backup_status';

interface StoredKey { key: CryptoKey; salt: string; kcv: string; enabledAt: string }

export interface CloudBackupStatus {
  lastUploadAt?: string;
  lastHash?: string;
  lastError?: string;
  lastErrorAt?: string;
}

export type CloudBackupFailure = 'SESSION_EXPIRED' | 'OFFLINE' | 'TOO_LARGE' | 'RATE_LIMITED' | 'SERVER' | 'NOT_ENABLED' | 'NO_BACKUP'
  | 'INVALID_CODE' | 'TYPO' | 'WRONG_CODE' | 'CORRUPTED' | 'UNSUPPORTED_FORMAT' | 'UNSUPPORTED_VERSION';

export class CloudBackupFailureError extends Error {
  constructor(public readonly code: CloudBackupFailure) { super(code); this.name = 'CloudBackupFailureError'; }
}

const fail = (code: CloudBackupFailure): never => { throw new CloudBackupFailureError(code); };

/** Code d'échec lisible par l'interface, quelle que soit l'erreur levée. */
export const failureCode = (e: unknown): CloudBackupFailure =>
  e instanceof CloudBackupFailureError ? e.code
    : e instanceof CloudBackupError ? e.code
    : e instanceof TypeError ? 'OFFLINE'
    : 'SERVER';

export const FAILURE_MESSAGES: Record<CloudBackupFailure, string> = {
  SESSION_EXPIRED: 'Session serveur expirée : reconnectez-vous.',
  OFFLINE: 'Serveur injoignable (hors ligne ?).',
  TOO_LARGE: 'Données trop volumineuses pour la copie de secours (2 Mo au plus).',
  RATE_LIMITED: 'Trop de demandes : réessayez dans une minute.',
  SERVER: 'Le serveur a refusé la demande.',
  NOT_ENABLED: 'Sauvegarde de secours non activée sur cet appareil.',
  NO_BACKUP: 'Aucune copie de secours sur le serveur.',
  INVALID_CODE: 'Code incomplet ou caractère non valide (28 caractères, lettres et chiffres).',
  TYPO: 'Code mal recopié : vérifiez chaque caractère.',
  WRONG_CODE: 'Ce code ne correspond pas à cette copie.',
  CORRUPTED: 'Copie abîmée ou modifiée : elle ne peut pas être déchiffrée.',
  UNSUPPORTED_FORMAT: 'Format de copie inconnu.',
  UNSUPPORTED_VERSION: 'Copie créée par une version plus récente de Pécule : mettez l\'app à jour.',
};

// ---------- Disponibilité ----------

/** La fonction n'a de sens qu'avec le serveur et une session ouverte. */
export const isCloudBackupAvailable = (): boolean => isBackendEnabled() && hasBackendSession();

// ---------- Statut local (localStorage : dates et empreinte, rien de sensible) ----------

export const readStatus = (): CloudBackupStatus => {
  try { return JSON.parse(localStorage.getItem(STATUS_KEY) || '{}') as CloudBackupStatus; } catch { return {}; }
};
const writeStatus = (s: CloudBackupStatus): void => {
  try { localStorage.setItem(STATUS_KEY, JSON.stringify(s)); } catch { /* stockage indisponible */ }
};
const clearStatus = (): void => {
  try { localStorage.removeItem(STATUS_KEY); } catch { /* stockage indisponible */ }
};

// ---------- Clé sur l'appareil (IndexedDB) ----------

const openDb = (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
  const req = indexedDB.open(DB_NAME, 1);
  req.onupgradeneeded = () => req.result.createObjectStore(STORE);
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

const idb = async <T,>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest): Promise<T> => {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = run(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result as T);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
};

const loadKey = async (): Promise<StoredKey | null> => {
  if (typeof indexedDB === 'undefined') return null;
  try { return (await idb<StoredKey | undefined>('readonly', s => s.get(KEY_ID))) ?? null; } catch { return null; }
};
const saveKey = (k: StoredKey) => idb<unknown>('readwrite', s => s.put(k, KEY_ID));
const deleteKey = async () => {
  if (typeof indexedDB === 'undefined') return;
  await idb<unknown>('readwrite', s => s.delete(KEY_ID));
};

/** Sauvegarde de secours activée sur CET appareil ? (et depuis quand) */
export const getDeviceEnrollment = async (): Promise<{ enabledAt: string } | null> => {
  const k = await loadKey();
  return k ? { enabledAt: k.enabledAt } : null;
};

// ---------- Serveur ----------

const api = async (path: string, init: RequestInit = {}): Promise<Response> => {
  const token = getSessionToken();
  if (!token) fail('SESSION_EXPIRED');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  let res: Response;
  try {
    res = await fetch(`${BACKEND_URL}${path}`, {
      ...init,
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init.headers || {}) },
    });
  } catch {
    return fail('OFFLINE');
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 401) fail('SESSION_EXPIRED');
  if (res.status === 413) fail('TOO_LARGE');
  if (res.status === 429) fail('RATE_LIMITED');
  if (res.status === 404) fail('NO_BACKUP');
  if (!res.ok) fail('SERVER');
  return res;
};

/** Dates (AAAA-MM-JJ) des copies gardées par le serveur, la plus récente d'abord. */
export const listServerBackups = async (): Promise<string[]> => {
  const { dates } = await (await api('/backup')).json() as { dates?: string[] };
  return Array.isArray(dates) ? dates : [];
};

const fetchBlob = async (date: string): Promise<CloudBackupBlobV1> =>
  parseBackupBlob(await (await api(`/backup/${encodeURIComponent(date)}`)).json());

// ---------- Activation ----------

const readCode = (code: string): Uint8Array<ArrayBuffer> => {
  const parsed = parseRecoveryCode(code);
  if (!parsed.ok) return fail(parsed.reason === 'typo' ? 'TYPO' : 'INVALID_CODE');
  return parsed.bytes;
};

/**
 * Active la sauvegarde sur cet appareil avec un NOUVEAU code (qui vient d'être montré à
 * l'utilisateur). Nouveau sel : les copies chiffrées avec un ancien code restent lisibles
 * avec cet ancien code seulement.
 */
export const enableWithNewCode = async (code: string): Promise<void> => {
  const bytes = readCode(code);
  const salt = newSalt();
  const { key, kcv } = await deriveBackupKey(bytes, salt, ['encrypt']);
  await saveKey({ key, salt: b64urlEncode(salt), kcv, enabledAt: new Date().toISOString() });
  clearStatus();
};

/**
 * Active la sauvegarde sur un AUTRE appareil avec le code déjà en lieu sûr : on reprend le
 * sel de la copie la plus récente, et on vérifie que le code lui correspond.
 */
export const enableWithExistingCode = async (code: string): Promise<void> => {
  const bytes = readCode(code);
  const [latest] = await listServerBackups();
  if (!latest) fail('NO_BACKUP');
  const blob = await fetchBlob(latest);
  const { key, kcv } = await deriveBackupKey(bytes, b64urlDecode(blob.salt), ['encrypt']);
  if (kcv !== blob.kcv) fail('WRONG_CODE');
  await saveKey({ key, salt: blob.salt, kcv, enabledAt: new Date().toISOString() });
  clearStatus();
};

// ---------- Envoi ----------

let inFlight: Promise<void> | null = null;

/** Chiffre et envoie les données maintenant. Lève une CloudBackupFailureError en cas d'échec. */
export const uploadNow = (data: GlobalAppData): Promise<void> => {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const stored = await loadKey();
      if (!stored) fail('NOT_ENABLED');
      const { key, salt, kcv } = stored!;
      const clean = withoutDeviceOnlyFields(data);
      const hash = await sha256b64url(canonicalize(clean));
      const body = JSON.stringify(await encryptBackup(JSON.stringify(clean), key, { salt, kcv }));
      if (new TextEncoder().encode(body).length > MAX_BACKUP_BYTES) fail('TOO_LARGE');
      await api('/backup', { method: 'PUT', body });
      writeStatus({ lastUploadAt: new Date().toISOString(), lastHash: hash });
    } catch (e) {
      writeStatus({ ...readStatus(), lastError: failureCode(e), lastErrorAt: new Date().toISOString() });
      throw e;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
};

/**
 * Envoi automatique : au plus une fois par semaine, seulement si la fonction est activée
 * sur cet appareil, la session serveur ouverte et les données changées depuis le dernier
 * envoi. Silencieux : une erreur est seulement notée dans le statut (affiché dans Réglages).
 * Renvoie `true` si une copie a été envoyée.
 */
export const maybeAutoUpload = async (data: GlobalAppData, now = new Date()): Promise<boolean> => {
  try {
    if (!isCloudBackupAvailable() || inFlight) return false;
    if (!data.accounts?.length) return false; // jamais une copie vide (données pas encore chargées)
    if (!(await loadKey())) return false;
    const hash = await sha256b64url(canonicalize(withoutDeviceOnlyFields(data)));
    if (!shouldAutoUpload(readStatus(), hash, now)) return false;
    await uploadNow(data);
    return true;
  } catch {
    return false;
  }
};

// ---------- Restauration ----------

/**
 * Télécharge et déchiffre la copie du `date` avec le code saisi. Renvoie le JSON en clair,
 * à faire passer par le MÊME chemin qu'un import de fichier (validateImport + migrate).
 */
export const decryptServerBackup = async (date: string, code: string): Promise<string> => {
  const bytes = readCode(code);
  const blob = await fetchBlob(date);
  return decryptBackup(blob, bytes);
};

// ---------- Désactivation ----------

/** Efface toutes les copies du serveur, puis la clé et le statut de cet appareil. */
export const disableAndDeleteServerCopies = async (): Promise<number> => {
  const { deleted } = await (await api('/backup', { method: 'DELETE' })).json() as { deleted?: number };
  await deleteKey();
  clearStatus();
  return deleted ?? 0;
};
