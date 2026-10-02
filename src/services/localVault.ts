// Chiffrement de la copie locale temporaire (modifications pas encore sur Drive). La clé
// AES-GCM est créée dans le navigateur, NON exportable, et rangée dans IndexedDB : lire les
// fichiers du navigateur sur le disque ne suffit plus pour lire vos montants. Si le
// navigateur ne le permet pas (mode privé, vieux navigateur), la copie reste lisible comme
// avant, plutôt que de perdre le filet de sécurité.
const DB_NAME = 'pecule-vault';
const STORE = 'keys';
const KEY_ID = 'local-backup';
const PREFIX = 'enc1:';

const b64 = (buf: ArrayBuffer | Uint8Array) => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
};
const unb64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));

const openDb = (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
  const req = indexedDB.open(DB_NAME, 1);
  req.onupgradeneeded = () => req.result.createObjectStore(STORE);
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

let keyPromise: Promise<CryptoKey | null> | null = null;
const getKey = (): Promise<CryptoKey | null> => {
  if (keyPromise) return keyPromise;
  keyPromise = (async () => {
    if (typeof indexedDB === 'undefined' || !globalThis.crypto?.subtle) return null;
    try {
      const db = await openDb();
      const existing = await new Promise<CryptoKey | undefined>((resolve, reject) => {
        const r = db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY_ID);
        r.onsuccess = () => resolve(r.result as CryptoKey | undefined);
        r.onerror = () => reject(r.error);
      });
      if (existing) return existing;
      const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(key, KEY_ID);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      return key;
    } catch {
      return null;
    }
  })();
  return keyPromise;
};

/** Valeur à ranger dans localStorage : chiffrée si possible. */
export const sealJSON = async (value: unknown): Promise<string> => {
  const json = JSON.stringify(value);
  const key = await getKey();
  if (!key) return json;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(json));
  return `${PREFIX}${b64(iv)}.${b64(ct)}`;
};

/** Relit une valeur rangée par `sealJSON` (ou une ancienne copie en clair). */
export const openJSON = async <T,>(stored: string): Promise<T> => {
  if (!stored.startsWith(PREFIX)) return JSON.parse(stored) as T;
  const key = await getKey();
  if (!key) throw new Error('VAULT_UNAVAILABLE');
  const [iv, ct] = stored.slice(PREFIX.length).split('.');
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, key, unb64(ct));
  return JSON.parse(new TextDecoder().decode(plain)) as T;
};
