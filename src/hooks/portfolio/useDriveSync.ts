// Moteur de synchronisation avec le fichier Drive : chargement, sauvegarde automatique
// (contrôle de révision), conflits et doublons, copies locales (miroir, quarantaine, copie
// hors ligne), nouvelles tentatives, plusieurs onglets, relecture au retour dans l'app,
// déconnexion. Le document lui-même vit dans useDocument ; l'état de la synchronisation est
// UN objet (lib/sync/syncStatus) modifié par des transitions nommées.
//
// Règle d'or : rien n'est écrit sur Drive tant qu'un chargement n'a pas réussi, ni pendant un
// choix entre deux versions, une session expirée ou avec une version trop ancienne de l'app.
// Le code est réparti en sous-hooks par sujet : syncRefs (références partagées), useDriveLoad
// (chargement, copie hors ligne), useSaveQueue (sauvegarde, envoi), useSyncConflicts (conflits,
// doublons, copies proposées). Ce hook les compose, garde la relecture de Drive, les onglets,
// les nouvelles tentatives et la déconnexion, et expose la valeur publique.
import { useState, useCallback, useRef, useEffect, useMemo, useReducer } from 'react';
import { lsDel, lsGet } from '../../lib/storage';
import { canonicalize, emptyData, isFromNewerApp } from '../../lib/schema';
import { readWriteStamp, stampIsFromDevice } from '../../lib/writeStamp';
import { classifySyncFailure, type SyncErrorInfo } from '../../lib/syncErrors';
import { recordError } from '../../lib/errorJournal';
import { initialSyncStatus, syncReducer } from '../../lib/sync/syncStatus';
import { clearSetAside } from '../../services/setAsideVersions';
import { readConfigFile, getFileMeta, setOnAuthLost, type DriveFileInfo } from '../../services/googleDriveService';
import { BACKUP_KEY, HELD_KEY, LAST_SAVE_KEY, PENDING_KEY } from './keys';
import { resetMonthlyBackup } from './monthlyBackup';
import {
  browserOnline, canonicalDoc, classifySyncError, failureOf, LONG_PAUSE_MS, REMOTE_CHECK_THROTTLE_MS, RETRY_DELAYS_MS,
  type ConflictChoice, type StoredSnapshot, type SyncConflictView,
} from './syncShared';
import { createMirror, createOfflineStore, createPendingStore, type UnreadableCopy } from './localCopies';
import { buildConflictView, useDeviceIdentity } from './conflictView';
import { useRestoreActions } from './useRestoreActions';
import type { DocumentState } from './useDocument';
import { useSyncRefs } from './syncRefs';
import { useDriveLoad } from './useDriveLoad';
import { useAutoSave, useSaveQueue } from './useSaveQueue';
import { useSyncConflicts } from './useSyncConflicts';
import { createMissingFileStore } from './missingFile';
import { useMissingFile } from './useMissingFile';

export const useDriveSync = (isAuthenticated: boolean, docState: DocumentState) => {
  const { doc, applyData, buildData, currentData, docRef, setDoc } = docState;

  // État de synchronisation exposé à l'UI (bannières, indicateur) : un seul objet.
  const [status, dispatch] = useReducer(syncReducer, browserOnline(), initialSyncStatus);
  const [driveFileId, setDriveFileId] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [localBackup, setLocalBackup] = useState<StoredSnapshot | null>(null);
  // Copies jamais envoyées qui n'ont pas pu être relues : signalées (bannière), jamais ignorées en silence.
  const [unreadableCopies, setUnreadableCopies] = useState<UnreadableCopy[]>([]);
  // Données rechargées en silence depuis Drive (changées sur un autre appareil).
  const [remoteUpdatedAt, setRemoteUpdatedAt] = useState<number | null>(null);
  // Autres fichiers de données du compte (doublons), du plus récent au plus ancien.
  const [otherFiles, setOtherFiles] = useState<DriveFileInfo[]>([]);
  // Des données sont affichées (Drive chargé, copie hors ligne ou démo) : avant, l'écran de
  // démarrage reste affiché plutôt qu'un tableau de bord vide.
  const [dataShown, setDataShown] = useState(false);
  // Copie hors ligne affichée (date de la dernière synchronisation), en attendant un vrai
  // chargement de Drive. Les saisies restent sur l'appareil jusque-là.
  const [offlineDataAt, setOfflineDataAt] = useState<string | null>(null);
  // Chargements Drive réussis : les points mensuels sont recalculés après chacun (y compris
  // quand les saisies faites hors ligne restent affichées).
  const [loadCount, setLoadCount] = useState(0);

  // Relance la sauvegarde automatique sans modification du document (bouton « Réessayer »,
  // nouvelle tentative programmée, retour au premier plan).
  const [retryTick, setRetryTick] = useState(0);
  // Références partagées avec les sous-hooks (un seul objet, créé ici).
  const refs = useSyncRefs({ ...status, syncConflict: false, localBackup, isAuthenticated });
  const {
    offlineRef, sessionGenRef, retryTimerRef, retryAttemptRef, retrySyncRef, statusRef, driveRevisionRef, driveFileIdRef,
    persistedRef, lastRemoteCheckRef, remoteCheckInFlightRef, headStampRef, headSavedAtRef, localEditedAtRef, hasLoadedRef,
    saveTimeoutRef, saveMutexRef, isSavingRef, otherFilesRef, conflictRef,
  } = refs;
  const isLoaded = useCallback(() => hasLoadedRef.current, [hasLoadedRef]);

  const { thisDevice, deviceId, makeStamp } = useDeviceIdentity();

  // Copies locales chiffrées (une instance par montage, voir localCopies).
  const [copies] = useState(() => ({
    pending: createPendingStore(() => sessionGenRef.current),
    mirror: createMirror(() => driveFileIdRef.current, () => persistedRef.current),
    offline: createOfflineStore(() => sessionGenRef.current),
  }));
  const { pending, mirror, offline: offlineStore } = copies;
  // Fichier Drive introuvable alors que l'appareil garde des données : le choix à faire (une instance par montage).
  const [missingFile] = useState(createMissingFileStore);

  /** Des modifications affichées ne sont pas encore sur Drive (y compris sur la copie hors ligne). */
  const hasLocalEdits = () => (hasLoadedRef.current || offlineRef.current !== null) && canonicalDoc(docRef.current) !== persistedRef.current;
  /** Miroir de l'état le plus récent (sa forme canonique est déjà connue). */
  const mirrorCurrent = () => mirror.write(currentData(), canonicalDoc(docRef.current));
  const hasLocalEditsRef = useRef(hasLocalEdits);
  hasLocalEditsRef.current = hasLocalEdits;
  const mirrorCurrentRef = useRef(mirrorCurrent);
  mirrorCurrentRef.current = mirrorCurrent;


  /** Programme une nouvelle tentative (5 s, 30 s, puis toutes les 2 min). */
  const scheduleRetry = () => {
    clearTimeout(retryTimerRef.current);
    if (!browserOnline()) return; // l'événement `online` relancera
    const delay = RETRY_DELAYS_MS[Math.min(retryAttemptRef.current, RETRY_DELAYS_MS.length - 1)];
    retryAttemptRef.current += 1;
    retryTimerRef.current = setTimeout(() => retrySyncRef.current(), delay);
  };
  const resetRetry = () => { clearTimeout(retryTimerRef.current); retryAttemptRef.current = 0; };
  /** Échec à montrer : nouvel essai automatique seulement s'il est passager. */
  const failSync = (err: unknown): SyncErrorInfo => {
    const info = classifySyncFailure(failureOf(err));
    // Bug de code (et non panne de Drive) : noté dans le journal de l'appareil, comme les autres erreurs.
    if (info.reason === 'unexpected') recordError('synchronisation', err);
    dispatch({ type: 'error', info });
    if (info.transient) scheduleRetry(); else clearTimeout(retryTimerRef.current);
    return info;
  };
  const clearSyncError = () => dispatch({ type: 'error-cleared' });

  const runExclusive = useCallback(<T,>(fn: () => Promise<T>): Promise<T> => {
    const run = () => fn();
    const next = saveMutexRef.current.then(run, run);
    saveMutexRef.current = next.catch(() => {});
    return next;
  }, [saveMutexRef]);

  useEffect(() => {
    setOnAuthLost(() => dispatch({ type: 'session-expired' }));
    return () => setOnAuthLost(null);
  }, []);

  useEffect(() => {
    const on = () => {
      resetRetry();
      dispatch({ type: 'online' });
      // Chargement raté hors ligne : le réseau revient, on recharge.
      if (statusRef.current.loadFailed && statusRef.current.error?.transient !== false) retrySyncRef.current();
    };
    const off = () => dispatch({ type: 'offline' });
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); clearTimeout(retryTimerRef.current); };
    // Références stables (useSyncRefs) : l'abonnement ne doit pas être refait à chaque rendu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** `data` est désormais l'état de Drive (lu ou écrit) : référence des écritures et copie hors ligne. */
  const markPersisted = (data: unknown, fileId: string | null = driveFileIdRef.current, canon?: string) => {
    persistedRef.current = canon ?? canonicalize(data);
    offlineStore.remember(fileId, data);
  };
  const switchFile = (id: string) => { driveFileIdRef.current = id; setDriveFileId(id); };

  // Heure du dernier changement de l'état affiché (montrée en cas de conflit, où elle est
  // celle de la dernière modification faite ici). Sans comparaison coûteuse à chaque saisie.
  useEffect(() => { localEditedAtRef.current = new Date().toISOString(); }, [doc, localEditedAtRef]);

  const {
    conflictCtx, syncConflict, setConflict, conflictOpen, openConflict, loadConflictRemote, resolveConflict,
    compareDuplicate, closeDuplicateComparison, dismissDuplicate, restoreLocalBackup, dismissLocalBackup, dismissUnreadableCopies,
  } = useSyncConflicts({
    refs, dispatch, docState, pending, mirror, markPersisted, runExclusive, clearSyncError,
    setRetryTick, setOtherFiles, setLocalBackup, unreadableCopies, setUnreadableCopies,
  });
  // Dernier état vu par les écouteurs (onglets, retour au premier plan) sans les réabonner.
  statusRef.current = { ...status, syncConflict, localBackup, isAuthenticated };
  // Autres fichiers les plus récents, pour les actions asynchrones.
  otherFilesRef.current = otherFiles;

  const { saveNowRef, flushPendingChanges } = useSaveQueue({
    refs, dispatch, docState, makeStamp, markPersisted, switchFile, mirrorCurrent, runExclusive, openConflict, conflictOpen,
    scheduleRetry, resetRetry, failSync, clearSyncError, setLastSavedAt, setOtherFiles, hasLocalEditsRef,
  });

  const { loadDriveDataRef, loadDriveDataStable, loadDemoData } = useDriveLoad({
    refs, dispatch, docState, pending, offlineStore, makeStamp, markPersisted, hasLocalEdits, setConflict, openConflict,
    scheduleRetry, resetRetry, failSync, setDriveFileId, setLocalBackup, setUnreadableCopies, setOtherFiles,
    setOfflineDataAt, setDataShown, setLoadCount, missingFile,
  });
  const missingActions = useMissingFile({
    refs, dispatch, docState, pending, makeStamp, markPersisted, resetRetry, missingFile, loadDriveData: loadDriveDataStable,
    setDriveFileId, setOtherFiles, setOfflineDataAt, setDataShown, setLoadCount,
  });

  useEffect(() => { isSavingRef.current = status.saving; }, [status.saving, isSavingRef]);

  // --- COORDINATION MULTI-ONGLETS ---
  /**
   * Sauvegarde annoncée par un autre onglet. Appliquée seulement si cet onglet n'a rien en
   * attente : modifications pas encore sur Drive, écriture en cours, conflit, hors ligne,
   * session expirée ou version trop ancienne de l'app. Sinon rien n'est appliqué et la
   * révision connue reste l'ancienne : la prochaine écriture lèvera le conflit (choix
   * explicite) au lieu d'effacer nos saisies ou d'écraser celles de l'autre onglet. Une
   * révision inconnue reste inconnue : l'écriture comparera alors le contenu de Drive.
   */
  const applyAnnouncedSave = async (announcement: string | null) => {
    if (!announcement) return;
    try {
      const { fileId, revision } = JSON.parse(announcement) as { fileId?: string; revision?: string | null };
      if (!fileId || fileId !== driveFileIdRef.current) return;
      if (!revision || String(revision) === driveRevisionRef.current) return;
      const busy = () => {
        const s = statusRef.current;
        return !hasLoadedRef.current || isSavingRef.current || hasLocalEdits() || conflictOpen() || s.sessionExpired || s.offline || s.appOutdated || s.loading;
      };
      if (busy()) return;
      const remote: unknown = await readConfigFile(fileId);
      if (busy() || fileId !== driveFileIdRef.current) return;
      // Fichier écrit par une version plus récente : lecture seule, comme au chargement.
      dispatch({ type: 'outdated', value: isFromNewerApp(remote) });
      driveRevisionRef.current = String(revision);
      markPersisted(remote);
      headStampRef.current = readWriteStamp(remote);
      lastRemoteCheckRef.current = Date.now();
      if (canonicalize(remote) !== canonicalDoc(docRef.current)) applyData(remote);
    } catch { /* annonce illisible ou lecture ratée : le conflit naturel jouera */ }
  };
  const applyAnnouncedSaveRef = useRef(applyAnnouncedSave);
  applyAnnouncedSaveRef.current = applyAnnouncedSave;
  useEffect(() => {
    const listener = (e: StorageEvent) => { if (e.key === LAST_SAVE_KEY) void applyAnnouncedSaveRef.current(e.newValue); };
    window.addEventListener('storage', listener);
    return () => window.removeEventListener('storage', listener);
  }, []);

  // --- RELECTURE DE DRIVE (AUTRE APPAREIL) ---
  /**
   * Drive a-t-il changé depuis notre dernière lecture ou écriture (autre appareil) ? Une
   * lecture de métadonnées ; le contenu n'est relu que si la révision a bougé. Sans
   * modification locale en attente, la nouvelle version est chargée en silence ; sinon
   * l'écran de choix s'ouvre AVANT toute écriture.
   */
  const checkRemote = async (force = false) => {
    const fileId = driveFileIdRef.current;
    const s = statusRef.current;
    if (!fileId || !hasLoadedRef.current || conflictRef.current || remoteCheckInFlightRef.current) return;
    if (!s.isAuthenticated || s.sessionExpired || s.loading || s.loadFailed || !browserOnline()) return;
    if (!force && Date.now() - lastRemoteCheckRef.current < REMOTE_CHECK_THROTTLE_MS) return;
    remoteCheckInFlightRef.current = true;
    lastRemoteCheckRef.current = Date.now();
    try {
      await runExclusive(async () => {
        if (fileId !== driveFileIdRef.current || conflictRef.current) return;
        const meta = await getFileMeta(fileId);
        if (meta.headRevisionId === driveRevisionRef.current) return; // rien de nouveau
        const raw: unknown = await readConfigFile(fileId);
        if (fileId !== driveFileIdRef.current || conflictRef.current || !raw) return;
        if (canonicalize(raw) === persistedRef.current) { driveRevisionRef.current = meta.headRevisionId; return; }
        const stamp = readWriteStamp(raw);
        if (hasLocalEdits()) {
          openConflict({ kind: 'conflict', fileId, headRevision: meta.headRevisionId, headIs: 'remote', source: { fileId }, remoteRaw: raw, remoteSavedAt: meta.modifiedTime }, currentData());
          return;
        }
        dispatch({ type: 'outdated', value: isFromNewerApp(raw) });
        driveRevisionRef.current = meta.headRevisionId;
        markPersisted(raw);
        headStampRef.current = stamp;
        headSavedAtRef.current = meta.modifiedTime;
        applyData(raw);
        if (!stampIsFromDevice(stamp, deviceId(), meta.modifiedTime)) setRemoteUpdatedAt(Date.now());
      });
    } catch (err) {
      // Relecture impossible (réseau…) : sans conséquence, le contrôle avant écriture reste là.
      if (classifySyncError(err) === 'session') dispatch({ type: 'session-expired' });
    } finally {
      remoteCheckInFlightRef.current = false;
    }
  };
  const checkRemoteRef = useRef(checkRemote);
  checkRemoteRef.current = checkRemote;

  // --- MIROIR LOCAL (seulement tant que Drive n'est pas à jour, copie hors ligne comprise) ---
  useEffect(() => {
    if (!hasLoadedRef.current && !offlineRef.current) return;
    const timer = setTimeout(() => {
      const canon = canonicalDoc(doc);
      if (canon === persistedRef.current) { mirror.cancel(); lsDel(BACKUP_KEY); return; }
      // Chiffrée (voir localVault) ; réécrite seulement si Drive n'a pas rattrapé entre-temps.
      mirror.write(buildData(), canon);
    }, 600);
    return () => clearTimeout(timer);
  }, [doc, buildData, mirror, hasLoadedRef, offlineRef, persistedRef]);

  // --- NOUVELLES TENTATIVES ---
  /**
   * « Réessayer » : recharge si le chargement a échoué (jamais d'écriture sans données
   * chargées), sinon relance la sauvegarde automatique, avec son contrôle de révision.
   */
  const retrySync = useCallback(() => {
    clearTimeout(retryTimerRef.current);
    const s = statusRef.current;
    if (!s.isAuthenticated || s.loading || s.sessionExpired) return;
    // Fichier introuvable : rien ne se recharge tout seul (la fenêtre de choix serait refermée
    // à chaque retour dans l'app) ; « Chercher à nouveau » relance la recherche.
    if (missingFile.getSnapshot()) return;
    if (!hasLoadedRef.current || s.loadFailed) { void loadDriveDataRef.current(); return; }
    if (browserOnline()) dispatch({ type: 'online' });
    dispatch({ type: 'error-cleared' });
    setRetryTick(t => t + 1);
  }, [hasLoadedRef, loadDriveDataRef, retryTimerRef, statusRef, missingFile]);
  retrySyncRef.current = retrySync;

  // Retour au premier plan : nouvel essai si la synchro est en échec PASSAGER, sinon
  // relecture de Drive (autre appareil, autre onglet) ; en arrière-plan, le miroir est écrit
  // sans attendre (le système peut fermer l'app à tout moment). Après une longue pause, la
  // première touche ou le premier clic relit Drive avant que la saisie ne parte.
  useEffect(() => {
    const wake = () => {
      if (document.visibilityState === 'hidden') {
        if (hasLocalEditsRef.current()) mirrorCurrentRef.current();
        return;
      }
      const s = statusRef.current;
      const retryable = s.error?.transient !== false;
      if (s.loadFailed) { if (retryable) retrySync(); return; }
      if (hasLoadedRef.current && ((s.error && retryable) || (s.offline && browserOnline()))) { retrySync(); return; }
      void checkRemoteRef.current();
    };
    const onInteract = () => {
      if (hasLoadedRef.current && Date.now() - lastRemoteCheckRef.current > LONG_PAUSE_MS) void checkRemoteRef.current();
    };
    const onPageHide = () => { if (hasLocalEditsRef.current()) mirrorCurrentRef.current(); };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('focus', wake);
    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('pointerdown', onInteract, true);
    document.addEventListener('keydown', onInteract, true);
    return () => {
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('focus', wake);
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('pointerdown', onInteract, true);
      document.removeEventListener('keydown', onInteract, true);
    };
  }, [retrySync, hasLoadedRef, lastRemoteCheckRef, statusRef]);

  // --- SAUVEGARDE AUTO ---
  const { loading: isLoadingData, sessionExpired, appOutdated, offline: isOffline } = status;
  useAutoSave({
    refs, dispatch, docState, isAuthenticated, driveFileId, isLoadingData, syncConflict, sessionExpired, appOutdated, isOffline,
    retryTick, saveNowRef,
  });


  /**
   * Des saisies affichées ne sont pas encore sur Drive (ou une écriture est en cours) : un
   * rechargement de la page maintenant les ferait passer par le bandeau « sauvegarde locale »
   * au lieu de les garder à l'écran. Sert à repousser le rechargement d'une mise à jour.
   */
  const hasPendingEdits = (): boolean => isSavingRef.current || hasLocalEditsRef.current();

  /** Nouvelle connexion : la copie hors ligne de la session précédente (peut-être un autre compte) est oubliée. */
  const forgetOfflineCopy = () => offlineStore.forget();

  /**
   * Quelque chose n'est pas (ou pas sûrement) sur Drive : modifications affichées pas encore
   * écrites, copie locale proposée et pas encore tranchée, ou, si rien n'a pu être chargé,
   * copies locales jamais examinées. À vérifier avant une déconnexion.
   */
  const hasUnsyncedChanges = (): boolean => {
    if (!hasLoadedRef.current && !offlineRef.current) return !!(lsGet(PENDING_KEY) || lsGet(BACKUP_KEY) || lsGet(HELD_KEY));
    // Copie hors ligne affichée : ses saisies (miroir compris) ne sont pas sur Drive.
    return !!statusRef.current.localBackup || hasLocalEditsRef.current();
  };

  /**
   * Déconnexion : purge l'état en mémoire. Par défaut, les modifications pas encore sur
   * Drive restent dans la copie locale chiffrée, rattachée à ce fichier Drive (une
   * reconnexion avec un autre compte ne les propose pas), et seront proposées à la prochaine
   * connexion. `discardUnsynced` (« Se déconnecter sans envoyer », choix explicite) les efface
   * de cet appareil.
   */
  const resetData = (opts?: { discardUnsynced?: boolean }) => {
    resetRetry();
    clearTimeout(saveTimeoutRef.current);
    mirror.cancel(); // une copie en cours de chiffrement ne doit plus rien écrire
    if (opts?.discardUnsynced === true) { lsDel(PENDING_KEY); lsDel(BACKUP_KEY); lsDel(HELD_KEY); }
    else if (hasLocalEditsRef.current()) mirrorCurrent(); // dernières saisies (< 600 ms) comprises
    // Copie hors ligne : elle n'a plus lieu d'être sans session (et une lecture en cours ne
    // doit plus rien appliquer ni écrire).
    sessionGenRef.current += 1;
    offlineStore.forget();
    // Versions mises de côté (données complètes) : effacées aussi, comme le promet la page
    // de confidentialité (la déconnexion efface la copie locale).
    void clearSetAside();
    offlineRef.current = null;
    setOfflineDataAt(null);
    setDataShown(false);
    hasLoadedRef.current = false;
    driveRevisionRef.current = null;
    driveFileIdRef.current = null;
    persistedRef.current = '';
    headStampRef.current = null;
    headSavedAtRef.current = null;
    localEditedAtRef.current = null;
    setConflict(null);
    missingFile.clear();
    setOtherFiles([]);
    dispatch({ type: 'reset' });
    setDoc(emptyData());
    setDriveFileId(null);
    resetMonthlyBackup();
    setLocalBackup(null);
    setUnreadableCopies([]);
  };

  // Ce que l'écran de choix affiche : la version de cet appareil est toujours l'état courant.
  const conflict = useMemo<SyncConflictView | null>(
    () => (conflictCtx ? buildConflictView(conflictCtx, buildData(), headStampRef.current, thisDevice, deviceId()) : null),
    [conflictCtx, buildData, thisDevice, deviceId, headStampRef],
  );

  // Actions exposées : identité stable (le corps le plus récent est toujours appelé), pour
  // que les écrans mémoïsés ne soient pas re-rendus à chaque changement de l'état de synchro.
  const latest = useRef({ resolveConflict, loadConflictRemote, compareDuplicate, closeDuplicateComparison, dismissDuplicate, restoreLocalBackup, dismissLocalBackup, dismissUnreadableCopies, flushPendingChanges, hasPendingEdits, forgetOfflineCopy, hasUnsyncedChanges, resetData, missingActions });
  latest.current = { resolveConflict, loadConflictRemote, compareDuplicate, closeDuplicateComparison, dismissDuplicate, restoreLocalBackup, dismissLocalBackup, dismissUnreadableCopies, flushPendingChanges, hasPendingEdits, forgetOfflineCopy, hasUnsyncedChanges, resetData, missingActions };
  const actions = useMemo(() => ({
    loadDriveData: loadDriveDataStable,
    loadDemoData,
    resolveConflict: (choice: ConflictChoice, opts?: { withoutCopy?: boolean }) => latest.current.resolveConflict(choice, opts),
    /** Relance la lecture de l'autre version (bouton « Réessayer » de l'écran de choix). */
    retryConflictLoad: () => { void latest.current.loadConflictRemote(); },
    compareDuplicate: () => latest.current.compareDuplicate(),
    closeDuplicateComparison: () => latest.current.closeDuplicateComparison(),
    dismissDuplicate: () => latest.current.dismissDuplicate(),
    retrySync,
    /** Relecture immédiate de Drive (sans attendre le délai minimal). */
    checkRemote: () => checkRemoteRef.current(true),
    flushPendingChanges: () => latest.current.flushPendingChanges(),
    hasUnsyncedChanges: () => latest.current.hasUnsyncedChanges(),
    hasPendingEdits: () => latest.current.hasPendingEdits(),
    forgetOfflineCopy: () => latest.current.forgetOfflineCopy(),
    restoreLocalBackup: () => latest.current.restoreLocalBackup(),
    dismissLocalBackup: () => latest.current.dismissLocalBackup(),
    dismissUnreadableCopy: () => latest.current.dismissUnreadableCopies(),
    resetData: (opts?: { discardUnsynced?: boolean }) => latest.current.resetData(opts),
    /** Fichier Drive introuvable (voir MissingFileDialog) : ce qu'il faut montrer, et les choix. */
    missingFile: { subscribe: missingFile.subscribe, getSnapshot: missingFile.getSnapshot },
    restoreMissingFromDevice: () => latest.current.missingActions.restoreFromDevice(),
    startOverMissing: () => latest.current.missingActions.startOver(),
    restoreMissingFromBackup: (id: string, label?: string) => latest.current.missingActions.restoreFromBackup(id, label),
    retryFindMissing: () => latest.current.missingActions.retryFind(),
  }), [loadDriveDataStable, loadDemoData, retrySync, missingFile]);

  const restore = useRestoreActions(docState, { hasLoadedRef, offlineRef, driveFileIdRef });

  return {
    status,
    syncConflict,
    conflict,
    // Typé explicitement : sans fichier en double, c'est null (l'index seul ne le dit pas).
    duplicateFile: (otherFiles.length > 0 ? otherFiles[0] : null) as DriveFileInfo | null,
    localBackup,
    unreadableCopies,
    lastSavedAt,
    remoteUpdatedAt,
    dataShown,
    offlineDataAt,
    loadCount,
    isLoaded,
    actions,
    restore,
  };
};
