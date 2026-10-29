// Journal des erreurs de cet appareil : les 20 dernières erreurs de l'app (écran qui plante,
// script, promesse rejetée, fichier de l'app introuvable), pour comprendre une panne après coup.
// Gardé sur l'appareil seulement (rien n'est envoyé), affiché dans Paramètres > Appareil, d'où
// on peut le copier pour le transmettre.
// Rien de personnel : seuls le moment, la version de l'app, le type d'erreur, un message
// NETTOYÉ (nombres, textes entre guillemets, adresses mail et paramètres d'adresse retirés :
// un message d'erreur peut citer un montant, un nom de compte ou un morceau de fichier) et les
// noms des composants ou fonctions en cause.
import { APP_VERSION } from '../appVersion';
import { lsDel, lsGetJSON, lsSetJSON } from './storage';
import { storageKey } from './storageKeys';

/** D'où vient l'erreur. */
export type ErrorSource = 'affichage' | 'script' | 'promesse' | 'chargement';

export interface ErrorEntry {
  /** Moment (ISO). */
  at: string;
  version: string;
  source: ErrorSource;
  /** « TypeError: … », nettoyé et tronqué. */
  message: string;
  /** Composants (erreur d'affichage) ou fonctions en cause, sans données. */
  where?: string;
  /** Répétitions immédiates de la même erreur (une boucle ne remplit pas le journal). */
  count?: number;
}

export const MAX_ENTRIES = 20;
const MAX_MESSAGE = 200;
const MAX_WHERE = 300;
const KEY = storageKey('errorJournal');

const SOURCES: readonly ErrorSource[] = ['affichage', 'script', 'promesse', 'chargement'];
const isEntry = (v: unknown): v is ErrorEntry => {
  const e = v as ErrorEntry;
  return !!e && typeof e === 'object' && typeof e.at === 'string' && typeof e.version === 'string'
    && SOURCES.includes(e.source) && typeof e.message === 'string';
};
const isJournal = (v: unknown): v is ErrorEntry[] => Array.isArray(v) && v.every(isEntry);

const truncate = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/** Dernier élément d'une adresse, sans paramètres : « assets/Agenda-x.js?v=1 » → « Agenda-x.js ». */
const fileOf = (url: string) => url.replace(/[?#].*$/, '').split('/').filter(Boolean).pop() || '';

/**
 * Message sans données personnelles : adresses réduites au nom de fichier, adresses mail,
 * textes entre guillemets et nombres masqués, première ligne seulement, tronqué.
 */
export const sanitizeMessage = (text: string): string => truncate(
  (text.split('\n')[0] ?? '')
    .replace(/\b(?:https?|blob|data|file):[^\s)'"]*/gi, m => fileOf(m) || 'adresse')
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '[courriel]')
    .replace(/"[^"]*"|'[^']*'|«[^»]*»|`[^`]*`|“[^”]*”/g, '"…"')
    .replace(/\b\d+(?:[.,\s  ]\d+)*\b/g, '#')
    .replace(/\s+/g, ' ')
    .trim(),
  MAX_MESSAGE,
);

/** Noms des composants d'une pile de composants React (« at Foo (…) » ou « in Foo »), du plus proche au plus loin. */
export const componentNames = (componentStack: string): string[] => {
  const names: string[] = [];
  for (const line of componentStack.split('\n')) {
    const m = /^\s*(?:at|in)\s+([A-Za-z_$][\w$.]*)/.exec(line);
    if (m && names[names.length - 1] !== m[1]) names.push(m[1]);
  }
  return names;
};

/** Trois premières lignes d'une pile d'appels : « fonction (fichier:ligne:colonne) », sans adresse complète. */
export const stackFrames = (stack: string): string[] => {
  const frames: string[] = [];
  for (const line of stack.split('\n')) {
    // Chrome : « at fn (url:1:2) » ou « at url:1:2 » ; Firefox, Safari : « fn@url:1:2 ».
    const m = /^\s*at\s+(?:(\S+)\s+\()?(.+?):(\d+):(\d+)\)?\s*$/.exec(line) ?? /^\s*([^@\s]*)@(.+?):(\d+):(\d+)\s*$/.exec(line);
    if (!m) continue;
    frames.push(`${m[1] || '?'} (${fileOf(m[2])}:${m[3]}:${m[4]})`);
    if (frames.length === 3) break;
  }
  return frames;
};

/** Entrée du journal pour une erreur quelconque (Error, texte, objet rejeté). */
export const toEntry = (source: ErrorSource, error: unknown, componentStack?: string | null, now: Date = new Date()): ErrorEntry => {
  const err = error instanceof Error ? error : null;
  const raw = err ? `${err.name}: ${err.message}` : typeof error === 'string' ? error : `Valeur rejetée (${error === null ? 'null' : typeof error})`;
  const where = componentStack ? componentNames(componentStack).slice(0, 6).join(' < ')
    : err?.stack ? stackFrames(err.stack).join(' < ') : '';
  return { at: now.toISOString(), version: APP_VERSION, source, message: sanitizeMessage(raw), ...(where ? { where: truncate(where, MAX_WHERE) } : {}) };
};

/** Ajoute une entrée en tête ; la même erreur répétée aussitôt est comptée au lieu d'être ajoutée. */
export const appendEntry = (journal: ErrorEntry[], entry: ErrorEntry): ErrorEntry[] => {
  const last = journal[0];
  if (last && last.message === entry.message && last.where === entry.where && last.source === entry.source && last.version === entry.version) {
    return [{ ...last, at: entry.at, count: (last.count ?? 1) + 1 }, ...journal.slice(1)];
  }
  return [entry, ...journal].slice(0, MAX_ENTRIES);
};

/** Journal de cet appareil, du plus récent au plus ancien (vide s'il est illisible). */
export const readErrorJournal = (): ErrorEntry[] => lsGetJSON<ErrorEntry[]>(KEY, [], isJournal);

export const clearErrorJournal = (): void => lsDel(KEY);

/** Note une erreur. Ne lève jamais : le journal ne doit pas devenir une source de pannes. */
export const recordError = (source: ErrorSource, error: unknown, componentStack?: string | null): void => {
  try { lsSetJSON(KEY, appendEntry(readErrorJournal(), toEntry(source, error, componentStack))); } catch { /* journal perdu */ }
};

/** Texte à copier (une erreur par paragraphe). */
export const formatErrorJournal = (journal: ErrorEntry[]): string => journal.map(e => [
  `${e.at} · version ${e.version} · ${e.source}${e.count && e.count > 1 ? ` · ×${e.count}` : ''}`,
  e.message,
  ...(e.where ? [`Où : ${e.where}`] : []),
].join('\n')).join('\n\n');

/**
 * Écoute les erreurs que rien n'a rattrapées (script, promesse rejetée). Rend la fonction qui
 * arrête l'écoute.
 */
export const installErrorJournal = (target: Pick<Window, 'addEventListener' | 'removeEventListener'> = window): (() => void) => {
  const onError = (e: ErrorEvent) => recordError('script', e.error ?? e.message);
  const onRejection = (e: PromiseRejectionEvent) => recordError('promesse', e.reason);
  target.addEventListener('error', onError);
  target.addEventListener('unhandledrejection', onRejection);
  return () => {
    target.removeEventListener('error', onError);
    target.removeEventListener('unhandledrejection', onRejection);
  };
};
