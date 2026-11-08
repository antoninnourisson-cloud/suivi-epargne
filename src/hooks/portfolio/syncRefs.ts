// Références partagées par les sous-hooks de la synchronisation Drive (useDriveSync les crée
// UNE fois et les leur passe) : lues et écrites par du code asynchrone, donc jamais d'état React.
import { useRef } from 'react';
import type { WriteStamp } from '../../lib/writeStamp';
import type { SyncStatus } from '../../lib/sync/syncStatus';
import type { DriveFileInfo } from '../../services/googleDriveService';
import type { ConflictCtx, StoredSnapshot } from './syncShared';

/** Dernier état vu par les écouteurs (onglets, retour au premier plan) sans les réabonner. */
type StatusSnapshot = SyncStatus & { syncConflict: boolean; localBackup: StoredSnapshot | null; isAuthenticated: boolean };

export const useSyncRefs = (initialStatus: StatusSnapshot) => ({
  // Base de la copie hors ligne affichée : le contenu de Drive qu'elle reflète.
  offlineRef: useRef<{ fileId: string; base: string; baseWithoutView: string } | null>(null),
  // Change à chaque déconnexion : une lecture lancée avant ne doit plus rien appliquer.
  sessionGenRef: useRef(0),
  conflictRef: useRef<ConflictCtx | null>(null),
  retryTimerRef: useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
  retryAttemptRef: useRef(0),
  retrySyncRef: useRef<() => void>(() => {}),
  statusRef: useRef(initialStatus),
  // Révision Drive à laquelle correspond `persistedRef` : toujours une vraie révision lue sur
  // Drive, ou null si inconnue (la prochaine écriture compare alors le contenu d'abord).
  driveRevisionRef: useRef<string | null>(null),
  driveFileIdRef: useRef<string | null>(null),
  // Contenu canonique de ce qui est sur Drive (après chargement ou sauvegarde) : aucune
  // écriture tant que l'état n'en diffère pas. Ouvrir l'app ne réécrit donc plus le fichier.
  persistedRef: useRef<string>(''),
  // Écritures tentées depuis la dernière confirmée (les plus récentes, même fichier et même
  // révision de référence) : contenu canonique envoyé. Si le réseau coupe pendant l'envoi,
  // Drive peut avoir reçu l'une d'elles sans que la réponse arrive ; voir settleIfSame (pas
  // de faux conflit avec soi-même). Vidée à chaque écriture confirmée.
  attemptsRef: useRef<{ fileId: string; base: string | null; canon: string }[]>([]),
  // Dernière relecture (ou écriture) confirmant l'état de Drive.
  lastRemoteCheckRef: useRef(0),
  remoteCheckInFlightRef: useRef(false),
  // Signature et date de la version en tête du fichier ouvert (affichées pour un doublon).
  headStampRef: useRef<WriteStamp | null>(null),
  headSavedAtRef: useRef<string | null>(null),
  // Dernière modification faite sur cet appareil et pas encore sur Drive.
  localEditedAtRef: useRef<string | null>(null),
  // Garde-fou : tant qu'un chargement Drive n'a pas réussi, aucune sauvegarde (évite
  // d'écraser un bon fichier avec un état vide).
  hasLoadedRef: useRef(false),
  saveTimeoutRef: useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
  // Mutex d'accès à Drive : sauvegarde auto, relecture au retour dans l'app et résolution
  // de conflit ne s'entrelacent jamais (chaque écriture fait lecture de révision puis PATCH).
  saveMutexRef: useRef<Promise<unknown>>(Promise.resolve()),
  isSavingRef: useRef(false),
  // Autres fichiers les plus récents, pour les actions asynchrones.
  otherFilesRef: useRef<DriveFileInfo[]>([]),
});
export type SyncRefs = ReturnType<typeof useSyncRefs>;
