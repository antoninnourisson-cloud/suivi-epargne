// Copie mensuelle du fichier sur Drive (une par mois), tentée après une sauvegarde réussie.
//
// Le mois n'est noté qu'après une réussite ; sans autre garde, un échec relançait la liste des
// copies puis la création à CHAQUE sauvegarde suivante. L'essai est donc noté : au plus un par
// jour (sauf « Réessayer maintenant »). On garde aussi la date de la dernière copie réussie :
// si aucune n'a réussi depuis plus de 45 jours, les Paramètres le disent clairement
// (voir DriveBackupsPanel) au lieu d'un simple console.warn que personne ne lit.
import { lsDel, lsGet, lsGetJSON, lsSet, lsSetJSON } from '../../lib/storage';
import { storageKey } from '../../lib/storageKeys';
import { localMonthKey, formatISODay, daysBetween } from '../../lib/dates';
import { writeMonthlyBackup } from '../../services/googleDriveService';
import { LAST_BACKUP_MONTH_KEY } from './keys';

/** Au-delà de ce nombre de jours sans copie réussie, un message s'affiche dans les Paramètres. */
export const BACKUP_STALE_DAYS = 45;

const STATE_KEY = storageKey('monthlyBackupState');

interface BackupState {
  /** Dernière copie réussie (ISO). */
  lastOkAt?: string;
  /** Jour (AAAA-MM-JJ) du dernier essai : un seul essai automatique par jour. */
  lastTryDay?: string;
  /** Premier échec depuis la dernière réussite (ISO) : absent = aucun problème connu. */
  firstFailAt?: string;
}

const isState = (v: unknown): v is BackupState => {
  if (!v || typeof v !== 'object') return false;
  const s = v as Record<string, unknown>;
  return ['lastOkAt', 'lastTryDay', 'firstFailAt'].every(k => s[k] === undefined || typeof s[k] === 'string');
};
const readState = (): BackupState => lsGetJSON<BackupState>(STATE_KEY, {}, isState);

const listeners = new Set<() => void>();
const writeState = (state: BackupState) => {
  lsSetJSON(STATE_KEY, state);
  listeners.forEach(l => l());
};
/** Prévient quand l'état de la copie change (pour l'affichage). Renvoie la fonction qui arrête l'écoute. */
export const subscribeMonthlyBackup = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

/** Oublie tout (changement de compte, déconnexion) : l'état d'un autre compte n'a pas de sens ici. */
export const resetMonthlyBackup = (): void => {
  lsDel(LAST_BACKUP_MONTH_KEY);
  lsDel(STATE_KEY);
  listeners.forEach(l => l());
};

let inFlight: Promise<boolean> | null = null;

/**
 * Tente la copie du mois. Renvoie true si le mois est couvert (copie créée ou déjà là), false
 * si elle n'a pas pu être faite ou n'a pas été tentée (déjà essayée aujourd'hui).
 * `force` : « Réessayer maintenant », sans attendre le lendemain.
 */
export const attemptMonthlyBackup = (data: unknown, opts: { force?: boolean; now?: Date } = {}): Promise<boolean> => {
  const now = opts.now ?? new Date();
  const month = localMonthKey(now);
  if (lsGet(LAST_BACKUP_MONTH_KEY) === month) return Promise.resolve(true);
  if (inFlight) return inFlight;
  const today = formatISODay(now);
  const state = readState();
  if (!opts.force && state.lastTryDay === today) return Promise.resolve(false);
  writeState({ ...state, lastTryDay: today });
  const run = (async () => {
    try {
      await writeMonthlyBackup(month, data);
      lsSet(LAST_BACKUP_MONTH_KEY, month);
      writeState({ lastOkAt: now.toISOString(), lastTryDay: today });
      return true;
    } catch (err) {
      console.warn('Copie mensuelle Drive non créée', err);
      writeState({ ...readState(), firstFailAt: readState().firstFailAt ?? now.toISOString() });
      return false;
    }
  })();
  inFlight = run.finally(() => { inFlight = null; });
  return inFlight;
};

export interface MonthlyBackupProblem {
  /** Date de la dernière copie réussie. */
  since: Date;
  /** true : seul le mois est connu (copies faites avant que la date soit notée) ; `since` = 1er du mois. */
  monthOnly: boolean;
}

/**
 * Le problème à montrer, ou null : un échec est noté ET aucune copie n'a réussi depuis plus de
 * BACKUP_STALE_DAYS jours. Sans date de réussite notée, on part du mois de la dernière copie
 * (anciennes versions de l'app), à défaut du premier échec.
 */
export const monthlyBackupProblem = (now: Date = new Date()): MonthlyBackupProblem | null => {
  const state = readState();
  if (!state.firstFailAt) return null;
  let since: Date;
  let monthOnly = false;
  if (state.lastOkAt) since = new Date(state.lastOkAt);
  else {
    const month = lsGet(LAST_BACKUP_MONTH_KEY);
    const m = month ? /^(\d{4})-(\d{2})$/.exec(month) : null;
    if (m) { since = new Date(Number(m[1]), Number(m[2]) - 1, 1); monthOnly = true; }
    else since = new Date(state.firstFailAt);
  }
  if (Number.isNaN(since.getTime())) return null;
  return daysBetween(since, now) > BACKUP_STALE_DAYS ? { since, monthOnly } : null;
};

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

/** « La copie mensuelle sur Drive n'a pas pu être faite depuis le 3 octobre. Pécule réessaie chaque jour. » */
export const monthlyBackupMessage = (p: MonthlyBackupProblem, now: Date = new Date()): string => {
  const year = p.since.getFullYear() === now.getFullYear() ? '' : ` ${p.since.getFullYear()}`;
  const month = MONTHS[p.since.getMonth()];
  const when = p.monthOnly ? `${month}${year}` : `le ${p.since.getDate() === 1 ? '1er' : p.since.getDate()} ${month}${year}`;
  return `La copie mensuelle sur Drive n'a pas pu être faite depuis ${when}. Pécule réessaie chaque jour.`;
};
