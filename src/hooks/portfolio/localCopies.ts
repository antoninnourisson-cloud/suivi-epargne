// Copies locales chiffrées (voir localVault), sans React : quarantaine (une seule place),
// miroir des saisies pas encore sur Drive, copie hors ligne du dernier état connu de Drive,
// abri des copies illisibles pour l'instant.
// Le moteur de synchronisation (useDriveSync) en crée une instance par montage.
import { lsDel, lsGet, lsGetJSON, lsSet } from '../../lib/storage';
import { canonicalize } from '../../lib/schema';
import { sealJSON, openJSON } from '../../services/localVault';
import { setAsideVersion, listSetAside, storeBeforeSetAside } from '../../services/setAsideVersions';
import type { GlobalAppData } from '../../types';
import { BACKUP_KEY, HELD_KEY, OFFLINE_KEY, PENDING_KEY } from './keys';
import type { OfflineCopy, StoredSnapshot } from './syncShared';

/** Erreur de localVault quand le stockage protégé (IndexedDB) est indisponible pour l'instant. */
const isVaultUnavailable = (err: unknown) => err instanceof Error && err.message === 'VAULT_UNAVAILABLE';

// ---------------------------------------------------------------------------
// Abri : copies jamais envoyées, illisibles pour l'instant
// ---------------------------------------------------------------------------
// Sans clé de chiffrement disponible, le miroir s'écrit en clair et la quarantaine ne peut pas
// relire ce qu'elle remplace : une copie chiffrée illisible « pour l'instant » était donc
// écrasée à la première saisie, et perdue le jour où le stockage revenait. Elle est d'abord
// déplacée ici, telle quelle (liste de copies chiffrées), puis relue à chaque chargement.

const isStringList = (v: unknown): v is string[] => Array.isArray(v) && v.every(s => typeof s === 'string');
/** Copies à l'abri (chiffrées, telles quelles). */
export const readHeldCopies = (): string[] => lsGetJSON<string[]>(HELD_KEY, [], isStringList);
/** Écrit la liste ; false si le stockage l'a refusée (plein, bloqué). */
const writeHeld = (list: string[]): boolean => {
  if (list.length === 0) { lsDel(HELD_KEY); return true; }
  const json = JSON.stringify(list);
  lsSet(HELD_KEY, json);
  return lsGet(HELD_KEY) === json;
};
/** Met une copie chiffrée à l'abri, telle quelle. false si le stockage l'a refusée. */
export const holdCopy = (stored: string): boolean => {
  const held = readHeldCopies();
  return held.includes(stored) || writeHeld([...held, stored]);
};
/** Copies à l'abri, à examiner au chargement avec les autres. */
export const heldCopies = (): StoredCopies => readHeldCopies().map(s => [HELD_KEY, s] as const);
/** Retire une copie examinée de sa place (une clé, ou l'abri), si elle y est encore. */
export const removeStoredCopy = (key: string, stored: string): void => {
  if (key === HELD_KEY) {
    const held = readHeldCopies();
    if (held.includes(stored)) writeHeld(held.filter(s => s !== stored));
  } else if (lsGet(key) === stored) lsDel(key);
};

/** Même copie : même fichier Drive et même contenu. */
export const sameCopy = (a: { fileId?: string; data: unknown }, b: { fileId?: string; data: unknown }) =>
  (a.fileId ?? null) === (b.fileId ?? null) && canonicalize(a.data) === canonicalize(b.data);

/** Met de côté (30 jours, chiffrée) une copie jamais envoyée, sauf si elle y est déjà. Lève en cas d'échec. */
export const setAsideUnsent = async (snap: StoredSnapshot) => {
  const kept = await listSetAside(snap.fileId);
  if (kept.some(e => sameCopy(e, snap))) return;
  const at = snap.savedAt && !Number.isNaN(Date.parse(snap.savedAt))
    ? ` (du ${new Date(snap.savedAt).toLocaleString('fr-FR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })})` : '';
  await setAsideVersion({ reason: 'unsent', label: `Modifications jamais envoyées sur Drive${at}`, savedAt: snap.savedAt ?? null, fileId: snap.fileId, data: snap.data });
};

/**
 * Quarantaine (une seule place). Écritures et effacements passent l'un après l'autre (le
 * chiffrement est asynchrone). `sessionGen` change à chaque déconnexion : une opération
 * lancée avant n'écrit plus rien.
 */
export const createPendingStore = (sessionGen: () => number) => {
  let chain: Promise<unknown> = Promise.resolve();
  const pendingOp = <T,>(fn: () => Promise<T>): Promise<T> => {
    const next = chain.then(fn, fn);
    chain = next.catch(() => {});
    return next;
  };
  /**
   * Contenu actuel de la quarantaine (`snap` null s'il est illisible ; `unavailable` : illisible
   * seulement pour l'instant, faute de stockage protégé).
   */
  const read = async (): Promise<{ stored: string; snap: StoredSnapshot | null; unavailable?: boolean } | null> => {
    const stored = lsGet(PENDING_KEY);
    if (!stored) return null;
    try {
      const snap = await openJSON<StoredSnapshot>(stored);
      return { stored, snap: snap && typeof snap === 'object' && snap.data ? snap : null };
    } catch (err) { return { stored, snap: null, unavailable: isVaultUnavailable(err) }; }
  };
  /**
   * Écrit `snap` dans la quarantaine. Une autre copie qui s'y trouve (autres données, ou autre
   * fichier Drive) n'est jamais écrasée sans avoir d'abord été mise de côté (« Versions mises
   * de côté », 30 jours). Exception : une copie d'un AUTRE fichier que celui ouvert
   * (`openFileId`) reste en quarantaine, seul endroit d'où elle sera proposée à son fichier ;
   * c'est alors la nouvelle copie, celle du fichier ouvert, qui est mise de côté (visible tout
   * de suite). Si la mise de côté échoue, la copie la plus récente gagne.
   */
  const replace = (snap: StoredSnapshot, openFileId: string | null): Promise<boolean> => {
    const gen = sessionGen();
    return pendingOp(async () => {
      const sealed = await sealJSON(snap);
      const current = await read();
      const prev = current?.snap ?? null;
      if (gen !== sessionGen()) return false; // déconnexion entre-temps
      // Copie illisible pour l'instant : mise à l'abri telle quelle avant d'être remplacée.
      if (current?.unavailable && lsGet(PENDING_KEY) === current.stored) holdCopy(current.stored);
      if (prev && !sameCopy(prev, snap)) {
        const keepPrev = !!prev.fileId && prev.fileId !== openFileId && snap.fileId === openFileId;
        try {
          await setAsideUnsent(keepPrev ? snap : prev);
          if (keepPrev) return true;
        } catch (err) { console.warn('Copie jamais envoyée non mise de côté', err); }
        if (gen !== sessionGen()) return false;
      }
      return storeBeforeSetAside(PENDING_KEY, sealed);
    });
  };
  /** Efface la quarantaine si elle contient encore `data` : une autre copie, elle, y reste. */
  const dropIf = (data: unknown): Promise<void> => pendingOp(async () => {
    const prev = await read();
    if (!prev?.snap || canonicalize(prev.snap.data) !== canonicalize(data)) return;
    if (lsGet(PENDING_KEY) === prev.stored) lsDel(PENDING_KEY);
  });
  /** Copie chiffrée d'une version qui n'est pas en tête de Drive, gardée jusqu'au choix de l'utilisateur. */
  const keep = (fileId: string, data: unknown) => {
    replace({ savedAt: new Date().toISOString(), fileId, data: data as GlobalAppData }, fileId)
      .catch(() => { /* reste en mémoire et dans le miroir */ });
  };
  return { read, replace, dropIf, keep };
};
export type PendingStore = ReturnType<typeof createPendingStore>;

/**
 * Miroir local chiffré : seule la dernière demande est écrite (un chiffrement plus lent ne
 * remet jamais une version plus ancienne par-dessus), et seulement si Drive n'a pas rattrapé
 * entre-temps (`persisted` : contenu canonique de Drive).
 */
export const createMirror = (fileId: () => string | null, persisted: () => string) => {
  let seq = 0;
  return {
    /** `canon` : forme canonique de `data`, si l'appelant la connaît déjà (sinon calculée une fois). */
    write(data: GlobalAppData, canon?: string) {
      const mine = ++seq;
      const snapshot: StoredSnapshot = { savedAt: new Date().toISOString(), fileId: fileId() ?? undefined, data };
      let canonical = canon;
      const wanted = () => mine === seq && (canonical ??= canonicalize(data)) !== persisted();
      // Stockage plein : les versions mises de côté les plus anciennes lui laissent la place.
      sealJSON(snapshot).then(sealed => {
        if (wanted()) return storeBeforeSetAside(BACKUP_KEY, sealed, wanted);
      }).catch(() => { /* filet de secours seulement */ });
    },
    /** Une copie en cours de chiffrement ne doit plus rien écrire. */
    cancel() { seq += 1; },
  };
};
export type Mirror = ReturnType<typeof createMirror>;

/** Copie hors ligne : seule la dernière demande est écrite, et jamais après une déconnexion. */
export const createOfflineStore = (sessionGen: () => number) => {
  let seq = 0;
  return {
    remember(fileId: string | null, data: unknown) {
      if (!fileId) return;
      const mine = ++seq;
      const gen = sessionGen();
      const copy: OfflineCopy = { savedAt: new Date().toISOString(), fileId, data };
      sealJSON(copy, { encryptedOnly: true }).then(sealed => {
        if (mine === seq && gen === sessionGen()) lsSet(OFFLINE_KEY, sealed);
      }).catch(() => { /* pas de copie hors ligne : l'app attendra le réseau */ });
    },
    /** Oublie la copie (une copie en cours de chiffrement n'écrit plus rien). */
    forget() {
      seq += 1;
      lsDel(OFFLINE_KEY);
    },
    /** Copie utilisable, ou null (absente, illisible ou incomplète). */
    async read(): Promise<OfflineCopy | null> {
      const stored = lsGet(OFFLINE_KEY);
      if (!stored) return null;
      let copy: OfflineCopy;
      try { copy = await openJSON<OfflineCopy>(stored); } catch { return null; }
      if (!copy || typeof copy.fileId !== 'string' || typeof copy.savedAt !== 'string' || !copy.data || typeof copy.data !== 'object') return null;
      return copy;
    },
  };
};
export type OfflineStore = ReturnType<typeof createOfflineStore>;

/** Copies stockées à examiner : clé et contenu (chiffré) relevé avant toute attente. */
export type StoredCopies = (readonly [string, string | null])[];

/**
 * Copie locale jamais envoyée qui n'a pas pu être relue. `lost` : définitivement (la clé de
 * l'appareil a changé ou la copie est abîmée) ; sinon, le stockage protégé du navigateur est
 * indisponible pour l'instant (la copie est mise à l'abri et sera relue plus tard).
 */
export interface UnreadableCopy { key: string; stored: string; lost: boolean }

/** Copie de l'abri redevenue lisible, différente de Drive et rattachée au fichier ouvert. */
export interface HeldReadable { stored: string; snap: StoredSnapshot }

/**
 * Copies locales jamais envoyées (quarantaine, miroir, abri) qui diffèrent de `reference`
 * (contenu canonique de Drive) : renvoie la plus récente, `candidates` compris. `clearSynced` :
 * une copie identique à Drive est effacée (elle y est déjà). Une copie rattachée à un AUTRE
 * fichier Drive appartient à un autre compte : ni proposée, ni effacée.
 * Une copie illisible n'est plus ignorée en silence : elle est renvoyée dans `unreadable`,
 * pour que l'utilisateur le sache (des modifications jamais envoyées existent, mais ne
 * peuvent pas être proposées). `held` : copies de l'abri redevenues lisibles (voir releaseHeldCopies).
 */
export const newestUnsyncedCopy = async (
  fileId: string, reference: string, candidates: StoredSnapshot[], storedCopies: StoredCopies, clearSynced: boolean,
): Promise<{ newest: StoredSnapshot | null; unreadable: UnreadableCopy[]; held: HeldReadable[] }> => {
  const found = [...candidates];
  const unreadable: UnreadableCopy[] = [];
  const held: HeldReadable[] = [];
  for (const [key, stored] of storedCopies) {
    if (!stored) continue;
    let snap: StoredSnapshot;
    try {
      snap = await openJSON<StoredSnapshot>(stored);
      if (!snap || typeof snap !== 'object' || !snap.data) throw new Error('COPY_DAMAGED');
    } catch (err) {
      unreadable.push({ key, stored, lost: !isVaultUnavailable(err) });
      continue;
    }
    if (snap.fileId && snap.fileId !== fileId) continue;
    if (canonicalize(snap.data) === reference) {
      if (clearSynced) removeStoredCopy(key, stored); // déjà sur Drive
      continue;
    }
    found.push(snap);
    if (key === HELD_KEY) held.push({ stored, snap });
  }
  const newest = found.reduce<StoredSnapshot | null>((best, s) => (!best || (s.savedAt || '') > (best.savedAt || '') ? s : best), null);
  return { newest, unreadable, held };
};

/**
 * Copies illisibles pour l'instant (stockage protégé indisponible) encore à leur place : mises
 * à l'abri AVANT que le miroir ou la quarantaine ne les réécrivent. Renvoie les copies avec leur
 * nouvelle place. Si le stockage refuse (plein), la copie reste où elle est.
 */
export const holdUnavailableCopies = (copies: UnreadableCopy[]): UnreadableCopy[] => copies.map(c => {
  if (c.lost || c.key === HELD_KEY || lsGet(c.key) !== c.stored || !holdCopy(c.stored)) return c;
  lsDel(c.key);
  return { ...c, key: HELD_KEY };
});

/**
 * Copies de l'abri redevenues lisibles : la plus récente de toutes (`newest`) est passée en
 * quarantaine par l'appelant (`newestKept` : écrite) et proposée ; les autres sont mises de côté
 * (« Versions mises de côté », 30 jours). Elles quittent alors l'abri ; en cas d'échec, elles y
 * restent et seront relues au prochain chargement.
 */
export const releaseHeldCopies = async (held: HeldReadable[], newest: StoredSnapshot | null, newestKept: boolean): Promise<void> => {
  for (const h of held) {
    if (h.snap === newest) { if (!newestKept) continue; }
    else {
      try { await setAsideUnsent(h.snap); } catch (err) { console.warn('Copie à l\'abri non mise de côté', err); continue; }
    }
    removeStoredCopy(HELD_KEY, h.stored);
  }
};

/** « Compris » : les copies définitivement illisibles encore en place sont effacées (plus rien à en tirer). */
export const dropLostCopies = (copies: UnreadableCopy[]): void => {
  for (const c of copies) if (c.lost) removeStoredCopy(c.key, c.stored);
};
