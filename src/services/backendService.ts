// ================================================
// FILE: src/services/backendService.ts
// Dialogue avec le Worker (worker/) : session Google persistante, notifications push,
// appareils connectés, veille fiscale du serveur (la sauvegarde de secours chiffrée est dans
// cloudBackup.ts, qui passe par `backendFetch`).
//
// Activé uniquement si VITE_BACKEND_URL est défini au build. Sans lui, l'app reste en mode
// « zéro serveur » (Google Identity Services dans le navigateur), exactement comme avant :
// le déploiement de l'app et celui du Worker sont donc indépendants.
//
// La session est un jeton opaque gardé dans le stockage local. Ce n'est PAS un jeton
// anodin : il permet d'obtenir du serveur des jetons d'accès Google (1 h), donc de lire,
// modifier ou supprimer le fichier Drive. D'où la liaison à l'appareil :
// - à la connexion, l'app crée une paire de clés ECDSA P-256 dont la partie privée est NON
//   EXPORTABLE (WebCrypto, rangée dans IndexedDB « pecule-device-key ») et envoie la clé
//   publique au serveur, qui la garde avec la session ;
// - chaque requête porte ensuite une preuve signée (en-tête X-Pecule-Proof : nonce du
//   serveur, méthode, chemin ; voir worker/src/deviceProof.ts). Le nonce arrive avec chaque
//   réponse (X-Pecule-Nonce) et ne vaut que 5 à 10 minutes : une preuve ne peut pas être
//   préparée pour plus tard. Un jeton copié SEUL (stockage local lu par une extension,
//   journal, sauvegarde partielle) ne sert donc à rien sans l'appareil ;
// - une session ouverte avant cette protection est refusée par le serveur : une
//   reconnexion, une seule fois, crée une session liée.
// Limites (SECURITY.md) : un script qui s'exécute DANS la page peut faire signer des
// requêtes tant qu'il y est, et envoyer ailleurs des preuves valables 10 minutes au plus ;
// une copie de TOUT le profil du navigateur emporte aussi la clé ; sans IndexedDB, la
// session reste non liée.
// ================================================
import { lsDel, lsGet } from '../lib/storage';
import { describeDevice } from '../lib/writeStamp';

export const BACKEND_URL: string = (import.meta.env.VITE_BACKEND_URL || '').replace(/\/+$/, '');
export const isBackendEnabled = (): boolean => BACKEND_URL !== '';

const SESSION_KEY = 'backend_session';
const PROOF_HEADER = 'X-Pecule-Proof';
const NONCE_HEADER = 'X-Pecule-Nonce';

const getSessionToken = (): string | null => lsGet(SESSION_KEY);
export const hasBackendSession = (): boolean => !!getSessionToken();

export interface AccessTokenResponse { access_token: string; expires_in: number }

/** Type d'appareil déclaré au serveur (liste des appareils connectés, alertes). */
const deviceLabel = (): string => describeDevice(typeof navigator === 'undefined' ? '' : navigator.userAgent);

// ---------- Clé de l'appareil (IndexedDB) ----------

const KEY_DB = 'pecule-device-key';
const KEY_STORE = 'keys';
const KEY_ID = 'session';

interface PublicJwk { kty: 'EC'; crv: 'P-256'; x: string; y: string }
interface DeviceKeyRecord {
  pair: CryptoKeyPair;
  jwk: PublicJwk;
  /** Empreinte SHA-256 du jeton de session auquel la clé est liée. */
  session?: string;
  /** Le serveur a accepté la clé : les requêtes peuvent être signées. */
  bound: boolean;
}

const b64url = (bytes: ArrayBuffer | Uint8Array): string => {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const sha256 = async (s: string): Promise<string> => b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));

const keyStorageAvailable = (): boolean => typeof indexedDB !== 'undefined' && !!globalThis.crypto?.subtle;

const keyDb = <T,>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest): Promise<T> =>
  new Promise((resolve, reject) => {
    const open = indexedDB.open(KEY_DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(KEY_STORE);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      try {
        const tx = db.transaction(KEY_STORE, mode);
        const req = run(tx.objectStore(KEY_STORE));
        tx.oncomplete = () => { db.close(); resolve(req.result as T); };
        tx.onerror = () => { db.close(); reject(tx.error); };
        tx.onabort = () => { db.close(); reject(tx.error); };
      } catch (e) { db.close(); reject(e); }
    };
  });

/** La clé de l'appareil n'a pas pu être lue (base occupée, connexion perdue) : elle existe peut-être. */
class KeyUnreadableError extends Error { constructor() { super('DEVICE_KEY_UNREADABLE'); } }

/**
 * Clé rangée, ou `null` s'il n'y en a pas. Lève KeyUnreadableError si la lecture échoue
 * (après un nouvel essai) : ne jamais prendre un échec passager pour « pas de clé », sinon une
 * nouvelle clé écraserait la vraie et la session serait perdue.
 */
const loadKeyRecord = async (): Promise<DeviceKeyRecord | null> => {
  if (!keyStorageAvailable()) return null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try { return (await keyDb<DeviceKeyRecord | undefined>('readonly', s => s.get(KEY_ID))) ?? null; } catch { /* nouvel essai */ }
  }
  throw new KeyUnreadableError();
};
const saveKeyRecord = (r: DeviceKeyRecord): Promise<unknown> => keyDb('readwrite', s => s.put(r, KEY_ID));
const deleteKeyRecord = async (): Promise<void> => {
  if (!keyStorageAvailable()) return;
  try { await keyDb('readwrite', s => s.delete(KEY_ID)); } catch { /* rien à effacer */ }
};

/** Nouvelle paire : clé privée NON exportable (seule la page peut s'en servir, sans la lire). */
const newKeyPair = async (): Promise<{ pair: CryptoKeyPair; jwk: PublicJwk }> => {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']) as CryptoKeyPair;
  const { x, y } = await crypto.subtle.exportKey('jwk', pair.publicKey);
  return { pair, jwk: { kty: 'EC', crv: 'P-256', x: x!, y: y! } };
};

// Dernier nonce rendu par le serveur (en mémoire seulement : au démarrage, la première
// requête est refusée avec un nonce, puis renvoyée signée).
let proofNonce: string | null = null;
const NONCE_FORMAT = /^[A-Za-z0-9_-]{43}$/;

/** Preuve « nonce.signature » pour cette requête, ou `null` sans nonce connu (le serveur en rendra un). */
const signProof = async (record: DeviceKeyRecord, method: string, path: string): Promise<string | null> => {
  const nonce = proofNonce;
  if (!nonce) return null;
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, record.pair.privateKey,
    new TextEncoder().encode(`${nonce}\n${method.toUpperCase()}\n${path}`));
  return `${nonce}.${b64url(sig)}`;
};

/** Chemin vu par le serveur (sans paramètres) : c'est lui qui est signé. */
const proofPath = (path: string): string => new URL(`${BACKEND_URL}${path}`, 'https://x.invalid').pathname;

/** Garde le nonce rendu avec une réponse (en-tête X-Pecule-Nonce). */
const rememberNonce = (res: Response): void => {
  const n = res.headers?.get?.(NONCE_HEADER);
  if (n && NONCE_FORMAT.test(n)) proofNonce = n;
};

/**
 * Refus « preuve absente » ou « nonce périmé » : le serveur rend le nonce courant, l'appareil
 * le garde. Vrai s'il faut renvoyer la requête, signée avec ce nonce.
 */
const learnNonce = async (res: Response): Promise<boolean> => {
  if (res.status !== 401) return false;
  const body = await res.clone().json().catch(() => null) as { error?: string; nonce?: unknown } | null;
  if ((body?.error !== 'PROOF_NONCE' && body?.error !== 'PROOF_REQUIRED') || typeof body.nonce !== 'string' || !NONCE_FORMAT.test(body.nonce)) return false;
  proofNonce = body.nonce;
  return true;
};

class BoundElsewhereError extends Error { constructor() { super('BOUND_ELSEWHERE'); } }

// Serveur sans liaison (version antérieure) : on ne réessaie pas à chaque requête.
const bindUnsupported = new Set<string>();
let bindInFlight: Promise<DeviceKeyRecord | null> | null = null;

const withKeyLock = <T,>(fn: () => Promise<T>): Promise<T> => {
  const locks = typeof navigator !== 'undefined' ? (navigator as Navigator & { locks?: LockManager }).locks : undefined;
  // Plusieurs onglets : une seule liaison à la fois (sinon deux clés pour une session).
  return locks ? locks.request('pecule-device-key', fn) as Promise<T> : fn();
};

/**
 * Lie la session `token` à une clé de cet appareil (connexion faite par une version de l'app
 * d'avant la liaison, ou serveur ancien au moment de la connexion). Renvoie la clé à
 * utiliser, ou `null` (pas de stockage, serveur sans liaison, réseau). Lève
 * BoundElsewhereError si la session est déjà liée à une autre clé : elle n'est plus
 * utilisable ici. Sans nonce connu, le premier essai est refusé avec un nonce, le second signé.
 */
const bindSession = (token: string, tokenHash: string): Promise<DeviceKeyRecord | null> => withKeyLock(async () => {
  const existing = await loadKeyRecord();
  if (existing?.session === tokenHash && existing.bound) return existing; // un autre onglet l'a fait
  let record: DeviceKeyRecord;
  if (existing?.session === tokenHash) record = existing;
  else {
    record = { ...(await newKeyPair()), session: tokenHash, bound: false };
    try { await saveKeyRecord(record); } catch { return null; } // stockage refusé : session non liée
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    let res: Response;
    try {
      const proof = await signProof(record, 'POST', proofPath('/auth/bind'));
      res = await fetch(`${BACKEND_URL}/auth/bind`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ key: record.jwk, ...(proof ? { proof } : {}), device: deviceLabel() }),
      });
    } catch { return null; } // hors ligne : nouvel essai à la prochaine requête
    rememberNonce(res);
    if (res.ok) {
      record = { ...record, bound: true };
      try { await saveKeyRecord(record); } catch { return null; }
      return record;
    }
    if (res.status === 409) throw new BoundElsewhereError();
    if (res.status === 404 || res.status === 405) { bindUnsupported.add(tokenHash); return null; }
    if (!(await learnNonce(res))) return null;
  }
  return null;
});

// Dernière clé liée, gardée en mémoire : pas de lecture IndexedDB à chaque requête.
let boundMemo: DeviceKeyRecord | null = null;

/** Clé avec laquelle signer les requêtes de cette session, ou `null` (requête non signée). */
const deviceKeyFor = async (token: string): Promise<DeviceKeyRecord | null> => {
  if (!keyStorageAvailable()) return null;
  const tokenHash = await sha256(token);
  if (boundMemo?.session === tokenHash) return boundMemo;
  const record = await loadKeyRecord();
  if (record?.session === tokenHash && record.bound) return (boundMemo = record);
  if (bindUnsupported.has(tokenHash)) return null;
  if (!bindInFlight) bindInFlight = bindSession(token, tokenHash).finally(() => { bindInFlight = null; });
  const bound = await bindInFlight;
  if (bound?.bound) boundMemo = bound;
  return bound;
};

const clearBackendSession = (): void => {
  lsDel(SESSION_KEY);
  boundMemo = null;
  proofNonce = null;
  void deleteKeyRecord();
};

// ---------- Requêtes ----------

const reauthResponse = () => new Response(JSON.stringify({ error: 'REAUTH_REQUIRED' }), { status: 401, headers: { 'Content-Type': 'application/json' } });

const call = async (path: string, init: RequestInit = {}, withSession = true, timeoutMs = 20_000): Promise<Response> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const token = withSession ? getSessionToken() : null;
  const method = (init.method || 'GET').toUpperCase();
  try {
    let record: DeviceKeyRecord | null = null;
    let keyUnreadable = false;
    if (token) {
      try { record = await deviceKeyFor(token); } catch (e) {
        if (e instanceof KeyUnreadableError) keyUnreadable = true; // requête non signée, voir plus bas
        else if (e instanceof BoundElsewhereError) {
          // Session liée à une autre clé que celle de cet appareil : inutilisable ici.
          clearBackendSession();
          return reauthResponse();
        } else throw e;
      }
    }
    const send = async () => {
      const proof = record ? await signProof(record, method, proofPath(path)) : null;
      const res = await fetch(`${BACKEND_URL}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(proof ? { [PROOF_HEADER]: proof } : {}),
          ...(init.headers || {}),
        },
      });
      rememberNonce(res);
      return res;
    };
    const res = await send();
    // Clé illisible pour l'instant et session liée (preuve exigée) : échec passager, traité
    // comme « hors ligne », surtout pas comme une session expirée (qui effacerait la clé).
    if (keyUnreadable && res.status === 401) {
      const body = await res.clone().json().catch(() => null) as { error?: string } | null;
      if (body?.error === 'PROOF_REQUIRED') throw new TypeError('DEVICE_KEY_UNREADABLE');
    }
    // Pas encore de nonce (démarrage) ou nonce périmé : le serveur en rend un, un seul nouvel essai.
    return record && (await learnNonce(res)) ? await send() : res;
  } catch (e: unknown) {
    // Même convention que googleDriveService : un problème réseau (y compris un délai
    // dépassé) remonte en TypeError, ce que la sauvegarde traite comme « hors ligne ».
    if ((e as { name?: string } | null)?.name === 'AbortError') throw new TypeError('BACKEND_TIMEOUT', { cause: e });
    throw e;
  } finally {
    clearTimeout(timer);
  }
};

/** Requête authentifiée (session et preuve de l'appareil) : pour cloudBackup.ts. */
export const backendFetch = (path: string, init: RequestInit = {}, timeoutMs = 20_000): Promise<Response> =>
  call(path, init, true, timeoutMs);

export interface LoginOptions {
  /** Toujours montrer le choix du compte Google (réinitialisation du verrou de l'appareil). */
  chooseAccount?: boolean;
}

/** Adresse de connexion du Worker. */
export const backendLoginUrl = (returnUrl: string, opts: LoginOptions = {}): string =>
  `${BACKEND_URL}/auth/start?return=${encodeURIComponent(returnUrl)}${opts.chooseAccount ? '&select=1' : ''}`;

/** Redirige vers la connexion Google via le Worker ; l'app est rechargée au retour. */
export const startBackendLogin = (opts: LoginOptions = {}): void => {
  window.location.assign(backendLoginUrl(window.location.origin + window.location.pathname, opts));
};

/** Clé neuve pour la connexion, déjà rangée (on sait ainsi que le stockage fonctionne), ou `null`. */
const prepareLoginKey = async (): Promise<DeviceKeyRecord | null> => {
  if (!keyStorageAvailable()) return null;
  try {
    const record: DeviceKeyRecord = { ...(await newKeyPair()), bound: false };
    await withKeyLock(() => saveKeyRecord(record));
    return record;
  } catch { return null; }
};

/**
 * Au retour de Google, le Worker renvoie vers l'app avec `#login_code=…` : un code à
 * usage unique (1 min), dans le fragment pour ne jamais être envoyé à un serveur. On
 * l'efface de l'URL AVANT l'échange, puis on l'échange contre la session, liée à la clé
 * de cet appareil.
 */
export const consumeLoginCode = async (): Promise<(AccessTokenResponse & { session: string }) | null> => {
  const match = /[#&]login_code=([A-Za-z0-9_-]+)/.exec(window.location.hash);
  if (!match) return null;
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
  const key = await prepareLoginKey();
  const res = await call('/auth/exchange', {
    method: 'POST', body: JSON.stringify({ code: match[1], ...(key ? { key: key.jwk } : {}), device: deviceLabel() }),
  }, false);
  if (!res.ok) throw new Error('LOGIN_CODE_INVALID');
  const data = await res.json();
  if (key) {
    // `bound` absent : serveur d'avant la liaison ; elle sera tentée au premier appel.
    const record: DeviceKeyRecord = { ...key, session: await sha256(String(data.session)), bound: data.bound === true };
    await withKeyLock(() => saveKeyRecord(record)).catch(() => undefined);
    boundMemo = record.bound ? record : null;
  }
  // La session n'est PAS enregistrée ici : l'appelant range d'abord le jeton d'accès, puis
  // la session (saveBackendSession). Dans l'ordre inverse, un code s'exécutant entre les
  // deux verrait « une session mais pas de jeton » et lancerait un rafraîchissement superflu.
  return { session: data.session, access_token: data.access_token, expires_in: data.expires_in };
};

export const saveBackendSession = (token: string): void => {
  localStorage.setItem(SESSION_KEY, token);
};

/** Jeton d'accès Google frais. `SESSION_EXPIRED` si le Worker exige une reconnexion. */
export const fetchAccessToken = async (): Promise<AccessTokenResponse> => {
  if (!hasBackendSession()) throw new Error('SESSION_EXPIRED');
  const res = await call('/token', { method: 'POST' });
  if (res.status === 401) {
    clearBackendSession();
    throw new Error('SESSION_EXPIRED');
  }
  if (!res.ok) throw new TypeError(`BACKEND_${res.status}`);
  return res.json();
};

export const backendLogout = async (): Promise<void> => {
  try { await call('/auth/logout', { method: 'POST' }); } catch { /* hors ligne : la session locale est effacée quand même */ }
  clearBackendSession();
};

// --- Notifications push ---

export const getVapidPublicKey = async (): Promise<string> => {
  const res = await call('/push/vapid-public-key', {}, false);
  if (!res.ok) throw new Error('VAPID_KEY_UNAVAILABLE');
  return (await res.json()).key;
};

export const registerPushSubscription = async (subscription: PushSubscriptionJSON): Promise<void> => {
  const res = await call('/push/subscribe', { method: 'POST', body: JSON.stringify({ subscription }) });
  if (res.status === 401) throw new Error('SESSION_EXPIRED');
  if (res.status === 409) throw new Error('TOO_MANY_DEVICES');
  if (!res.ok) throw new Error('SUBSCRIBE_FAILED');
};

export const unregisterPushSubscription = async (endpoint: string): Promise<void> => {
  await call('/push/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint }) });
};

export const sendTestPush = async (): Promise<boolean> => {
  const res = await call('/push/test', { method: 'POST' });
  if (!res.ok) return false;
  return !!(await res.json()).ok;
};

/**
 * Issue de l'alerte « retrait du verrou demandé » : `sent` (le serveur l'a prise en compte,
 * même si aucun autre appareil n'est abonné), `failed` (hors ligne, serveur indisponible : à
 * réessayer), `no-session` (pas de session serveur valable sur cet appareil : l'alerte
 * partira avec la session suivante).
 */
export type LockResetAlertResult = 'sent' | 'failed' | 'no-session';

/**
 * « Code oublié » sur cet appareil : le serveur prévient les AUTRES appareils (notification
 * générique : date, type d'appareil).
 */
export const notifyLockResetRequested = async (requestedAt: Date): Promise<LockResetAlertResult> => {
  if (!isBackendEnabled() || !hasBackendSession()) return 'no-session';
  try {
    const res = await call('/alert/lock-reset', { method: 'POST', body: JSON.stringify({ requestedAt: requestedAt.toISOString(), device: deviceLabel() }) });
    if (res.ok) return 'sent';
    return res.status === 401 && !(await res.clone().json().catch(() => null) as { nonce?: unknown } | null)?.nonce ? 'no-session' : 'failed';
  } catch { return 'failed'; }
};

// --- Appareils et données côté serveur ---

export interface PushDevice { id: string; host: string; createdAt: string | null; current: boolean }

const authedJson = async <T,>(path: string, init: RequestInit = {}): Promise<T> => {
  const res = await call(path, init);
  if (res.status === 401) throw new Error('SESSION_EXPIRED');
  if (!res.ok) throw new Error(`BACKEND_${res.status}`);
  return res.json() as Promise<T>;
};

/** Appareils qui reçoivent les notifications. */
export const listPushDevices = async (): Promise<PushDevice[]> =>
  (await authedJson<{ devices: PushDevice[] }>('/push/devices')).devices || [];

export const removePushDevice = async (id: string): Promise<void> => {
  await authedJson('/push/remove', { method: 'POST', body: JSON.stringify({ id }) });
};

/** Session ouverte sur un appareil (liste « Appareils connectés » de Paramètres). */
export interface ServerSession {
  id: string;
  /** Type d'appareil déclaré à la connexion (« téléphone Android (Chrome) »), ou `null`. */
  device: string | null;
  createdAt: string | null;
  /** Dernière utilisation (au jour près). */
  lastUsedAt: string;
  /** Session liée à son appareil (clé non exportable). */
  bound: boolean;
  /** Ouverte avant la liaison à l'appareil : refusée par le serveur, l'appareil doit se reconnecter. */
  legacy?: boolean;
  current: boolean;
}

export const listServerSessions = async (): Promise<ServerSession[]> =>
  (await authedJson<{ sessions: ServerSession[] }>('/auth/sessions')).sessions || [];

/** « Déconnecter cet appareil » : ferme cette session (et ses notifications) côté serveur. */
export const revokeServerSession = async (id: string): Promise<void> => {
  const r = await authedJson<{ current?: boolean }>('/auth/sessions/revoke', { method: 'POST', body: JSON.stringify({ id }) });
  if (r.current) clearBackendSession();
};

/** Ferme TOUTES les sessions (tous les appareils) et coupe toutes les notifications. */
export const logoutAllDevices = async (): Promise<number> => {
  const r = await authedJson<{ sessionsRevoked?: number }>('/auth/logout-all', { method: 'POST' });
  clearBackendSession();
  return r.sessionsRevoked ?? 0;
};

/**
 * Efface ce que le serveur garde (sessions, notifications, jeton Google) et révoque l'accès
 * Google. Les copies de secours chiffrées ne sont effacées que 7 jours plus tard (annulable
 * après reconnexion) : la date est renvoyée s'il y en a.
 */
export const deleteServerAccount = async (): Promise<{ backupsDeletionAt: string | null }> => {
  const r = await authedJson<{ backupsDeletionAt?: string }>('/account/delete', { method: 'POST' });
  clearBackendSession();
  return { backupsDeletionAt: r.backupsDeletionAt ?? null };
};

export interface ServerHealth { lastRunAt: string | null; ok: boolean | null; usersProcessed?: number; error?: string }
export const getServerHealth = async (): Promise<ServerHealth> => authedJson<ServerHealth>('/health');

// --- Veille fiscale : texte des pages officielles, téléchargé par le serveur ---
export interface FiscalSourceText { url: string; topic: string; text: string; ok: boolean }
export const getFiscalSources = async (): Promise<FiscalSourceText[]> =>
  (await authedJson<{ sources: FiscalSourceText[] }>('/fiscal-sources')).sources || [];

// --- Veille fiscale du serveur (Workers AI, chaque lundi) : worker/src/fiscalWatchJob.ts ---
export interface ServerFiscalWatch {
  checkedAt: string; model: string; ok: boolean;
  /** Forme FiscalWatchResult (src/lib/fiscalWatch.ts). */
  values: Record<string, unknown>;
  sources: { url: string; topic: string; status: string; fields: string[]; rejected: { field: string; reason: string }[]; error?: string }[];
  neuronsEstimate: number; neuronsUsed?: number;
}
/** Dernier résultat de la veille du serveur, ou `null` si elle n'a jamais tourné. */
export const getServerFiscalWatch = async (): Promise<ServerFiscalWatch | null> => {
  const res = await call('/fiscal-watch');
  if (res.status === 404) return null;
  if (res.status === 401) throw new Error('SESSION_EXPIRED');
  if (!res.ok) throw new Error(`BACKEND_${res.status}`);
  return res.json() as Promise<ServerFiscalWatch>;
};
/**
 * Lance la veille du serveur maintenant (une minute au plus). Le serveur la limite à une
 * exécution toutes les 20 h : il rend alors le dernier résultat (`null` s'il n'y en a pas).
 */
export const runServerFiscalWatch = async (): Promise<ServerFiscalWatch | null> => {
  const res = await call('/fiscal-watch/run', { method: 'POST' }, true, 120_000);
  if (res.status === 429) return ((await res.json()) as { latest?: ServerFiscalWatch }).latest ?? null;
  if (res.status === 401) throw new Error('SESSION_EXPIRED');
  if (!res.ok) throw new Error(`BACKEND_${res.status}`);
  return res.json() as Promise<ServerFiscalWatch>;
};
