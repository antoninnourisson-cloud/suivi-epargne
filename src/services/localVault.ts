// Chiffrement des copies gardées sur l'appareil (stockage local du navigateur) : la copie
// hors ligne (dernier état connu de Drive), le miroir des modifications pas encore envoyées
// et les versions mises de côté. Chiffrement AES-GCM avec une clé créée dans le navigateur,
// NON EXPORTABLE (aucun script ne peut la lire, seulement s'en servir), propre à l'appareil.
//
// Où vit la clé, honnêtement : dans IndexedDB (base « pecule-vault »), donc dans le même
// profil du navigateur, sur le même disque que les copies. Le navigateur peut y garder la
// clé brute : « non exportable » ne limite que le JavaScript. Ce chiffrement protège donc
// contre la lecture du SEUL stockage local (outil, extension ou copie qui ne prend que
// localStorage), PAS contre quelqu'un (ou un logiciel malveillant) qui copie tout le profil
// du navigateur, ni contre un script qui s'exécuterait dans la page.
//
// Sans clé (IndexedDB bloquée ou indisponible, cas rare) : la copie hors ligne, simple double
// du dernier état connu de Drive, n'est pas écrite (`encryptedOnly`) ; l'app attend alors le
// réseau. Les copies qu'on ne retrouverait nulle part ailleurs (modifications pas encore
// envoyées, quarantaine, versions mises de côté) sont écrites en clair plutôt que perdues,
// jusqu'à ce que Drive les ait rattrapées ; la page de confidentialité le dit. Les tests
// unitaires (jsdom sans IndexedDB) écrivent en clair partout : la condition
// `import.meta.env.MODE === 'test'` est retirée du build publié. Les copies en clair restent
// lisibles, puis sont réécrites chiffrées dès que la clé est là.
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
      // Première clé : « lire ou écrire » dans UNE transaction en écriture. Deux onglets ouverts
      // pour la première fois en même temps créaient chacun leur clé, la dernière écrasant
      // l'autre : les copies chiffrées par le premier devenaient illisibles. Les transactions en
      // écriture sur le même magasin passent l'une après l'autre : le second onglet trouve la
      // clé du premier et la reprend (la sienne est jetée).
      const fresh = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      return await new Promise<CryptoKey>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        const store = tx.objectStore(STORE);
        let key: CryptoKey = fresh;
        const r = store.get(KEY_ID);
        r.onsuccess = () => {
          if (r.result) key = r.result as CryptoKey;
          else store.put(fresh, KEY_ID);
        };
        tx.oncomplete = () => resolve(key);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } catch {
      return null;
    }
  })();
  // Échec passager (base occupée) : un nouvel essai au prochain appel plutôt qu'un refus définitif.
  void keyPromise.then(k => { if (!k) keyPromise = null; });
  return keyPromise;
};

/** Tests unitaires seulement (jsdom sans IndexedDB) : retiré du build publié. */
const plaintextAllowedForTests = (): boolean => import.meta.env.MODE === 'test' && typeof indexedDB === 'undefined';

export interface SealOptions {
  /**
   * Copie qui existe déjà ailleurs (la copie hors ligne, double de Drive) : jamais en clair.
   * Lève `VAULT_UNAVAILABLE` si le navigateur ne peut pas garder la clé ; rien n'est écrit.
   */
  encryptedOnly?: boolean;
}

/**
 * Valeur à ranger dans localStorage, chiffrée. Sans clé : en clair pour une copie qu'on ne
 * retrouverait nulle part ailleurs (perdre des modifications serait pire), refus
 * (`VAULT_UNAVAILABLE`) avec `encryptedOnly`.
 */
export const sealJSON = async (value: unknown, options: SealOptions = {}): Promise<string> => {
  const json = JSON.stringify(value);
  const key = await getKey();
  if (!key) {
    if (!options.encryptedOnly || plaintextAllowedForTests()) return json;
    throw new Error('VAULT_UNAVAILABLE');
  }
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(json));
  return `${PREFIX}${b64(iv)}.${b64(ct)}`;
};

/** Relit une valeur rangée par `sealJSON` (ou une ancienne copie en clair, d'avant le chiffrement). */
export const openJSON = async <T,>(stored: string): Promise<T> => {
  if (!stored.startsWith(PREFIX)) return JSON.parse(stored) as T;
  const key = await getKey();
  if (!key) throw new Error('VAULT_UNAVAILABLE');
  const [iv, ct] = stored.slice(PREFIX.length).split('.');
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, key, unb64(ct));
  return JSON.parse(new TextDecoder().decode(plain)) as T;
};
