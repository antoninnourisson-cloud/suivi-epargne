// État de la synchronisation avec Drive : UN objet, modifié par des transitions nommées
// (syncReducer), et ce que l'interface en déduit (indicateur, envoi possible, sauvegarde de
// secours). Fonctions pures, sans React ni stockage.
//
// Les faits suivis sont indépendants les uns des autres (un fichier d'une version plus
// récente peut être lu hors ligne ; un chargement raté peut venir d'une session expirée) :
// ils restent donc des champs séparés. Là où une seule situation compte (l'indicateur de la
// barre latérale), `syncPhase` les ramène à un état unique, dans un ordre de priorité fixe.
import type { SyncErrorInfo } from '../syncErrors';

export interface SyncStatus {
  /** Chargement Drive en cours. */
  loading: boolean;
  /** Écriture programmée ou en cours. */
  saving: boolean;
  /** Navigateur hors ligne, ou Drive injoignable (de nouveaux essais sont programmés). */
  offline: boolean;
  /** Le dernier chargement a échoué : rien n'est écrit sur Drive tant qu'un chargement n'a pas réussi. */
  loadFailed: boolean;
  /** Session Google expirée : reconnexion demandée, aucune écriture. */
  sessionExpired: boolean;
  /** Fichier écrit par une version plus récente de l'app : lecture seule jusqu'à la mise à jour. */
  appOutdated: boolean;
  /** Échec à montrer : passager (nouvel essai automatique) ou durable (on attend l'utilisateur). */
  error: SyncErrorInfo | null;
}

export type SyncEvent =
  /** Nouveau chargement : session, échec et erreur précédents sont oubliés. */
  | { type: 'load-start' }
  | { type: 'load-end' }
  /** Chargement impossible (`offline` : faute de réseau). */
  | { type: 'load-failed'; offline?: boolean }
  | { type: 'offline' }
  | { type: 'online' }
  | { type: 'session-expired' }
  | { type: 'error'; info: SyncErrorInfo }
  | { type: 'error-cleared' }
  | { type: 'saving'; value: boolean }
  | { type: 'outdated'; value: boolean }
  /** Déconnexion : plus rien à signaler (le réseau, lui, reste ce qu'il est). */
  | { type: 'reset' };

export const initialSyncStatus = (online: boolean): SyncStatus => ({
  loading: false, saving: false, offline: !online, loadFailed: false, sessionExpired: false, appOutdated: false, error: null,
});

/** Transition d'état. Renvoie le même objet quand rien ne change (pas de nouveau rendu). */
export const syncReducer = (s: SyncStatus, e: SyncEvent): SyncStatus => {
  switch (e.type) {
    case 'load-start':
      return { ...s, loading: true, sessionExpired: false, loadFailed: false, error: null };
    case 'load-end':
      return s.loading ? { ...s, loading: false } : s;
    case 'load-failed':
      return s.loadFailed && (!e.offline || s.offline) ? s : { ...s, loadFailed: true, offline: s.offline || !!e.offline };
    case 'offline':
      return s.offline ? s : { ...s, offline: true };
    case 'online':
      return s.offline ? { ...s, offline: false } : s;
    case 'session-expired':
      return s.sessionExpired ? s : { ...s, sessionExpired: true };
    case 'error':
      return { ...s, error: e.info };
    case 'error-cleared':
      return s.error ? { ...s, error: null } : s;
    case 'saving':
      return s.saving === e.value ? s : { ...s, saving: e.value };
    case 'outdated':
      return s.appOutdated === e.value ? s : { ...s, appOutdated: e.value };
    case 'reset':
      return { ...s, loadFailed: false, sessionExpired: false, appOutdated: false, error: null };
  }
};

/** Pourquoi rien n'est envoyé sur Drive alors que le réseau est là (voir SyncStatus). */
export type SyncBlockReason = 'session' | 'outdated' | 'load-failed';

/** Ce que montre l'indicateur de synchronisation : une seule situation à la fois. */
export type SyncPhase =
  | { kind: 'offline' }
  /** Envoi arrêté jusqu'à une action de l'utilisateur : jamais « Synchronisé » dans ce cas. */
  | { kind: 'blocked'; reason: SyncBlockReason }
  | { kind: 'saving' }
  | { kind: 'error' }
  | { kind: 'conflict' }
  | { kind: 'saved'; at: Date }
  | { kind: 'idle' };

/**
 * Priorité : hors ligne, envoi arrêté (session expirée, fichier d'une version plus récente,
 * chargement raté), écriture en cours, erreur, choix en attente, puis dernière écriture
 * confirmée. Un envoi arrêté passe avant la dernière écriture : sans cela, l'indicateur
 * resterait vert (« Synchronisé ») pendant que les saisies s'accumulent sur l'appareil.
 */
export const syncPhase = (s: SyncStatus, conflictOpen: boolean, lastSavedAt: Date | null): SyncPhase =>
  s.offline ? { kind: 'offline' }
  : s.sessionExpired ? { kind: 'blocked', reason: 'session' }
  : s.appOutdated ? { kind: 'blocked', reason: 'outdated' }
  : s.loadFailed ? { kind: 'blocked', reason: 'load-failed' }
  : s.saving ? { kind: 'saving' }
  : s.error ? { kind: 'error' }
  : conflictOpen ? { kind: 'conflict' }
  : lastSavedAt ? { kind: 'saved', at: lastSavedAt }
  : { kind: 'idle' };

/** Pourquoi « Envoyer puis se déconnecter » est impossible maintenant (null : possible). */
export type SendBlocker = 'local-backup' | 'conflict' | 'session' | 'outdated' | 'load-failed' | 'offline';

export const sendBlocker = (s: SyncStatus, o: { conflictOpen: boolean; hasLocalBackup: boolean }): SendBlocker | null => {
  if (o.hasLocalBackup) return 'local-backup';
  if (o.conflictOpen) return 'conflict';
  if (s.sessionExpired) return 'session';
  if (s.appOutdated) return 'outdated';
  if (s.loadFailed && !s.offline) return 'load-failed';
  if (s.offline || s.loadFailed) return 'offline';
  return null;
};

/**
 * Les données affichées sont celles de Drive, sans rien en suspens (ni erreur, ni choix, ni
 * copie locale ou hors ligne) : seule situation d'où part la sauvegarde de secours chiffrée.
 */
export const isSettledOnDrive = (s: SyncStatus, o: { dataShown: boolean; offlineCopyShown: boolean; conflictOpen: boolean; hasLocalBackup: boolean }): boolean =>
  o.dataShown && !o.offlineCopyShown && !s.loadFailed && !s.loading && !s.error && !o.conflictOpen
  && !s.sessionExpired && !s.appOutdated && !o.hasLocalBackup;
