// Versions mises de côté : la version écartée lors d'un conflit entre appareils, l'état
// remplacé par une restauration ou un import, ou une copie jamais envoyée sur Drive qui a dû
// céder la quarantaine (une seule place) à une autre. Rien n'est donc jamais perdu par un choix :
// chaque version écartée reste récupérable pendant 30 jours sur cet appareil (Paramètres,
// Sauvegardes), chiffrée comme la copie locale (voir localVault), et rattachée au fichier
// Drive d'où elle vient (une reconnexion avec un autre compte Google ne la montre pas).
// La déconnexion les efface (clearSetAside), comme la copie locale. Elles passent après le
// miroir des saisies pas encore envoyées : si la place manque, les plus anciennes partent
// (storeBeforeSetAside).
import { sealJSON, openJSON } from './localVault';
import { lsGet, lsDel } from '../lib/storage';
import { storageKey } from '../lib/storageKeys';

export type SetAsideReason = 'conflict' | 'restore' | 'import' | 'recover' | 'unsent';

export interface SetAsideVersion {
  id: string;
  /** Date de mise de côté (ISO). */
  setAsideAt: string;
  reason: SetAsideReason;
  /** En clair : « Version de Drive écartée (téléphone Android) ». */
  label: string;
  /** Date d'enregistrement de cette version, si on la connaît. */
  savedAt?: string | null;
  fileId?: string;
  data: unknown;
}

const KEY = storageKey('setAside');
const SET_ASIDE_DAYS = 30;
const SET_ASIDE_MAX = 6;
const DAY_MS = 86_400_000;

const isEntry = (v: unknown): v is SetAsideVersion => {
  const e = v as Partial<SetAsideVersion> | null;
  return !!e && typeof e.id === 'string' && typeof e.setAsideAt === 'string' && !Number.isNaN(Date.parse(e.setAsideAt)) && typeof e.label === 'string';
};

/** Garde les versions de moins de 30 jours, les plus récentes d'abord, au plus 6. */
export const pruneSetAside = (list: SetAsideVersion[], nowMs: number): SetAsideVersion[] =>
  list.filter(e => nowMs - Date.parse(e.setAsideAt) < SET_ASIDE_DAYS * DAY_MS)
    .sort((a, b) => b.setAsideAt.localeCompare(a.setAsideAt))
    .slice(0, SET_ASIDE_MAX);

// Une seule lecture-écriture à la fois dans cet onglet (le chiffrement est asynchrone).
let chain: Promise<unknown> = Promise.resolve();
const exclusive = <T,>(fn: () => Promise<T>): Promise<T> => {
  const next = chain.then(fn, fn);
  chain = next.catch(() => {});
  return next;
};

/** Toutes les versions gardées. Lève si elles existent mais sont illisibles (jamais écrasées alors). */
const readAll = async (): Promise<SetAsideVersion[]> => {
  const stored = lsGet(KEY);
  if (!stored) return [];
  const value = await openJSON<unknown>(stored);
  return Array.isArray(value) ? value.filter(isEntry) : [];
};

/** Écrit la liste ; si la place manque, abandonne les plus anciennes. Renvoie ce qui a été gardé. */
const writeAll = async (list: SetAsideVersion[]): Promise<SetAsideVersion[]> => {
  if (list.length === 0) { lsDel(KEY); return []; }
  let kept = list;
  while (kept.length > 0) {
    try {
      localStorage.setItem(KEY, await sealJSON(kept));
      return kept;
    } catch {
      kept = kept.slice(0, -1); // stockage plein : on retire la plus ancienne
    }
  }
  // Rien n'a pu être écrit : la liste déjà enregistrée reste telle quelle.
  return [];
};

/**
 * Met une version de côté. Renvoie son identifiant, ou lève si elle n'a pas pu être gardée
 * (stockage bloqué ou plein) : l'appelant ne doit alors rien remplacer sans le dire.
 */
export const setAsideVersion = (entry: Omit<SetAsideVersion, 'id' | 'setAsideAt'>, nowMs = Date.now()): Promise<string> =>
  exclusive(async () => {
    let existing: SetAsideVersion[];
    try { existing = await readAll(); } catch { throw new Error('SET_ASIDE_UNREADABLE'); }
    const id = crypto.randomUUID();
    const added: SetAsideVersion = { ...entry, id, setAsideAt: new Date(nowMs).toISOString() };
    const kept = await writeAll(pruneSetAside([added, ...existing], nowMs));
    if (!kept.some(e => e.id === id)) throw new Error('SET_ASIDE_FULL');
    return id;
  });

/** Versions gardées pour ce fichier Drive (toutes si `fileId` est inconnu), les plus récentes d'abord. */
export const listSetAside = async (fileId?: string | null, nowMs = Date.now()): Promise<SetAsideVersion[]> => {
  let all: SetAsideVersion[];
  try { all = await readAll(); } catch { return []; }
  return pruneSetAside(all, nowMs).filter(e => !fileId || !e.fileId || e.fileId === fileId);
};

export const getSetAside = async (id: string): Promise<SetAsideVersion | null> => {
  try { return (await readAll()).find(e => e.id === id) ?? null; } catch { return null; }
};

/**
 * Efface toutes les versions mises de côté (déconnexion). Effacement immédiat, puis de
 * nouveau après une mise de côté en cours, qui ne doit rien laisser derrière elle.
 */
export const clearSetAside = (): Promise<void> => {
  lsDel(KEY);
  return exclusive(async () => { lsDel(KEY); });
};

/** Abandonne la plus ancienne version gardée ; false s'il n'y a rien (ou rien de lisible) à retirer. */
const dropOldestSetAside = (): Promise<boolean> =>
  exclusive(async () => {
    let all: SetAsideVersion[];
    try { all = await readAll(); } catch { return false; }
    if (all.length === 0) return false;
    const kept = [...all].sort((a, b) => b.setAsideAt.localeCompare(a.setAsideAt)).slice(0, -1);
    if (kept.length === 0) { lsDel(KEY); return true; }
    try { localStorage.setItem(KEY, await sealJSON(kept)); } catch { lsDel(KEY); }
    return true;
  });

/**
 * Écrit une donnée plus importante que les versions mises de côté (miroir des saisies pas
 * encore sur Drive, quarantaine) : si le stockage est plein, les versions mises de côté les
 * plus anciennes sont abandonnées une à une jusqu'à ce que l'écriture passe. Entre deux
 * essais, `stillWanted` peut l'annuler (une écriture plus récente l'a remplacée). Renvoie
 * true si la donnée est écrite.
 */
export const storeBeforeSetAside = async (key: string, value: string, stillWanted: () => boolean = () => true): Promise<boolean> => {
  for (let attempt = 0; attempt <= SET_ASIDE_MAX + 1; attempt++) {
    try { localStorage.setItem(key, value); return true; } catch { /* plein ou bloqué */ }
    if (!(await dropOldestSetAside()) || !stillWanted()) return false;
  }
  return false;
};

export const removeSetAside = (id: string): Promise<void> =>
  exclusive(async () => {
    let all: SetAsideVersion[];
    try { all = await readAll(); } catch { return; }
    await writeAll(all.filter(e => e.id !== id));
  });
