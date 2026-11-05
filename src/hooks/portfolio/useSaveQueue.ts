// Sauvegarde : écriture sur Drive avec contrôle de révision, récupération d'un fichier disparu,
// écritures concurrentes, sauvegarde automatique différée et envoi immédiat. Code déplacé tel
// quel de useDriveSync ; les références partagées arrivent par `refs`.
import { useEffect, useRef, type Dispatch, type SetStateAction, type MutableRefObject } from 'react';
import { lsDel, lsGet, lsSet } from '../../lib/storage';
import { canonicalize } from '../../lib/schema';
import { readWriteStamp, withWriteStamp, type WriteStamp } from '../../lib/writeStamp';
import type { SyncEvent } from '../../lib/sync/syncStatus';
import type { SyncErrorInfo } from '../../lib/syncErrors';
import type { GlobalAppData } from '../../types';
import {
  findConfigFiles, createConfigFile, readConfigFile, updateConfigFile, getFileRevision, getFileMeta,
  ConcurrentWriteError, writeMonthlyBackup, type DriveFileInfo,
} from '../../services/googleDriveService';
import { BACKUP_KEY, LAST_BACKUP_MONTH_KEY, LAST_SAVE_KEY } from './keys';
import {
  browserOnline, canonicalDoc, classifySyncError, localMonthKey, RemoteChanged, SaveSkipped,
  type ConflictInit, type SaveResult, type SyncFailure,
} from './syncShared';
import type { DocumentState } from './useDocument';
import type { SyncRefs } from './syncRefs';

interface SaveDeps {
  refs: SyncRefs;
  dispatch: Dispatch<SyncEvent>;
  docState: DocumentState;
  makeStamp: () => WriteStamp;
  markPersisted: (data: unknown, fileId?: string | null, canon?: string) => void;
  switchFile: (id: string) => void;
  mirrorCurrent: () => unknown;
  runExclusive: <T>(fn: () => Promise<T>) => Promise<T>;
  openConflict: (init: ConflictInit, offDrive?: unknown) => void;
  conflictOpen: () => boolean;
  scheduleRetry: () => void;
  resetRetry: () => void;
  failSync: (err: unknown) => SyncErrorInfo;
  clearSyncError: () => void;
  setLastSavedAt: Dispatch<SetStateAction<Date | null>>;
  setOtherFiles: Dispatch<SetStateAction<DriveFileInfo[]>>;
  hasLocalEditsRef: MutableRefObject<() => boolean>;
}

export const useSaveQueue = ({
  refs, dispatch, docState, makeStamp, markPersisted, switchFile, mirrorCurrent, runExclusive, openConflict, conflictOpen,
  scheduleRetry, resetRetry, failSync, clearSyncError, setLastSavedAt, setOtherFiles, hasLocalEditsRef,
}: SaveDeps) => {
  const { currentData, docRef } = docState;
  const {
    attemptsRef, driveRevisionRef, driveFileIdRef, persistedRef, headStampRef, headSavedAtRef, lastRemoteCheckRef,
    hasLoadedRef, statusRef, saveTimeoutRef,
  } = refs;

  const announceSave = (fileId: string, revision: string | null) =>
    lsSet(LAST_SAVE_KEY, JSON.stringify({ fileId, revision, at: Date.now() }));

  /** Copie mensuelle sur Drive, à la première sauvegarde réussie du mois (non bloquante). */
  const maybeMonthlyBackup = (data: GlobalAppData) => {
    const month = localMonthKey(new Date());
    if (lsGet(LAST_BACKUP_MONTH_KEY) === month) return;
    writeMonthlyBackup(month, data)
      .then(() => lsSet(LAST_BACKUP_MONTH_KEY, month))
      .catch(err => console.warn('Copie mensuelle Drive non créée', err));
  };

  const onSaved = (fileId: string, revision: string, saved: GlobalAppData, stamp: WriteStamp, canon?: string) => {
    attemptsRef.current = [];
    driveRevisionRef.current = revision;
    markPersisted(saved, fileId, canon);
    headStampRef.current = stamp;
    headSavedAtRef.current = stamp.at;
    lastRemoteCheckRef.current = Date.now();
    announceSave(fileId, revision);
    clearSyncError();
    resetRetry();
    if (browserOnline()) dispatch({ type: 'online' });
    setLastSavedAt(new Date());
    // Le miroir n'est effacé que si Drive a TOUT rattrapé : une saisie faite pendant cette
    // écriture n'est pas encore sur Drive, son miroir est réécrit tout de suite.
    if (canonicalDoc(docRef.current) === persistedRef.current) lsDel(BACKUP_KEY); else mirrorCurrent();
    maybeMonthlyBackup(saved);
  };

  /**
   * Course d'écriture constatée APRÈS notre PATCH (voir ConcurrentWriteError) : Drive garde
   * notre version en tête, celle de l'autre appareil est la révision juste avant (marquée
   * « Keep Forever »). Rien n'est réécrit : l'utilisateur choisit.
   */
  const onConcurrentWrite = (fileId: string, ours: GlobalAppData, err: ConcurrentWriteError, stamp: WriteStamp) => {
    driveRevisionRef.current = err.ourRevisionId;
    markPersisted(ours, fileId);
    headStampRef.current = stamp;
    headSavedAtRef.current = stamp.at;
    console.warn('Écriture concurrente détectée après sauvegarde', { ours: err.ourRevisionId, other: err.otherRevisionId });
    openConflict({
      kind: 'conflict', fileId, headRevision: err.ourRevisionId, headIs: 'local',
      source: { fileId, revisionId: err.otherRevisionId },
      // Date de cette révision inconnue ici : l'écran affiche celle de sa signature, et
      // l'appareil seulement si elle est récente (l'écriture vient d'avoir lieu).
      remoteRaw: err.otherContent, remoteSavedAt: null, localSavedAt: stamp.at,
    }, err.otherContent);
  };

  /** Classe un échec d'écriture et réagit. `ours` : la version qu'on tentait d'écrire. */
  const handleSyncFailure = (err: unknown, fileId: string, ours: GlobalAppData): SyncFailure => {
    const kind = classifySyncError(err);
    if (kind === 'conflict') {
      // Drive a changé depuis notre révision : on relit sa version pour la montrer.
      openConflict({ kind: 'conflict', fileId, headRevision: null, headIs: 'remote', source: { fileId }, remoteRaw: undefined, remoteSavedAt: null }, ours);
    } else if (kind === 'session') dispatch({ type: 'session-expired' });
    else if (kind === 'offline') { dispatch({ type: 'offline' }); scheduleRetry(); }
    else if (kind === 'error') {
      failSync(err);
      console.error('Erreur de sauvegarde', err);
    }
    // 'notfound' est traité par l'appelant (fichier retrouvé ou recréé).
    return kind;
  };

  /**
   * Révision de référence inconnue (relecture ratée au chargement) : on ne prend JAMAIS la
   * tête actuelle de Drive à l'aveugle. Son contenu doit être celui qu'on a chargé ; sinon
   * Drive a changé entre-temps, et c'est un conflit (RemoteChanged).
   */
  const ensureBaseRevision = async (fileId: string) => {
    const meta = await getFileMeta(fileId);
    const raw = await readConfigFile(fileId);
    if (canonicalize(raw) !== persistedRef.current) throw new RemoteChanged(meta, raw);
    driveRevisionRef.current = meta.headRevisionId;
  };

  /**
   * Le fichier connu a disparu (404). On cherche les fichiers de données du compte :
   * - le même fichier est encore listé : refus passager, nouvel essai, jamais d'écriture sans contrôle ;
   * - un autre existe : on l'ouvre, et s'il diffère, c'est un conflit à trancher ;
   * - aucun : on recrée le fichier avec cette version (il n'y a plus rien à doubler).
   */
  const recoverMissingFile = async (missingId: string, data: GlobalAppData): Promise<SaveResult> => {
    try {
      const files = await findConfigFiles();
      if (files.some(f => f.id === missingId)) {
        dispatch({ type: 'error', info: { reason: 'server', transient: true } });
        scheduleRetry();
        return 'failed';
      }
      const other = files[0];
      if (other) {
        const meta = await getFileMeta(other.id);
        const remote: unknown = await readConfigFile(other.id);
        switchFile(other.id);
        setOtherFiles(files.slice(1));
        driveRevisionRef.current = meta.headRevisionId;
        markPersisted(remote);
        headStampRef.current = readWriteStamp(remote);
        headSavedAtRef.current = meta.modifiedTime;
        if (canonicalize(remote) === canonicalize(data)) {
          // Ce fichier porte déjà exactement ces données : rien à écrire.
          lsDel(BACKUP_KEY);
          clearSyncError();
          resetRetry();
          return 'saved';
        }
        openConflict({ kind: 'conflict', fileId: other.id, headRevision: meta.headRevisionId, headIs: 'remote', source: { fileId: other.id }, remoteRaw: remote, remoteSavedAt: meta.modifiedTime }, data);
        return 'failed';
      }
      const stamp = makeStamp();
      const id = await createConfigFile(withWriteStamp(data, stamp));
      switchFile(id);
      onSaved(id, await getFileRevision(id), data, stamp);
      return 'saved';
    } catch (recoveryErr) {
      failSync(recoveryErr);
      console.error('Fichier Drive introuvable et récupération échouée', recoveryErr);
      return 'failed';
    }
  };

  // --- SAUVEGARDE ---
  /**
   * Écrit l'état affiché sur Drive s'il en diffère, avec contrôle de révision (et
   * vérification après coup, voir updateConfigFile). Utilisée par la sauvegarde auto et par
   * « Envoyer puis se déconnecter ».
   */
  const saveNow = async (): Promise<SaveResult> => {
    const fileId = driveFileIdRef.current;
    const s = statusRef.current;
    const skip = (r: SaveResult) => { dispatch({ type: 'saving', value: false }); return r; };
    if (!fileId || !hasLoadedRef.current || conflictOpen() || s.sessionExpired || s.appOutdated) return skip('failed');
    // Forme canonique de l'état à écrire : calculée une fois par version du document (canonicalDoc).
    const canon = canonicalDoc(docRef.current);
    const data = currentData();
    if (canon === persistedRef.current) return skip('nothing');
    const stamp = makeStamp();
    dispatch({ type: 'saving', value: true });
    try {
      const newRevision = await runExclusive(async () => {
        if (fileId !== driveFileIdRef.current || conflictOpen()) throw new SaveSkipped();
        if (canon === persistedRef.current) return null; // déjà écrite entre-temps
        if (!driveRevisionRef.current) await ensureBaseRevision(fileId);
        const base = driveRevisionRef.current;
        attemptsRef.current = [
          ...attemptsRef.current.filter(a => a.fileId === fileId && a.base === base && a.canon !== canon),
          { fileId, base, canon },
        ].slice(-5);
        return updateConfigFile(fileId, withWriteStamp(data, stamp), driveRevisionRef.current);
      });
      if (newRevision === null) return 'nothing';
      onSaved(fileId, newRevision, data, stamp, canon);
      return 'saved';
    } catch (err) {
      if (err instanceof SaveSkipped) return 'failed';
      if (err instanceof RemoteChanged) {
        openConflict({ kind: 'conflict', fileId, headRevision: err.meta.headRevisionId, headIs: 'remote', source: { fileId }, remoteRaw: err.raw, remoteSavedAt: err.meta.modifiedTime }, data);
        return 'failed';
      }
      if (err instanceof ConcurrentWriteError) { onConcurrentWrite(fileId, data, err, stamp); return 'failed'; }
      if (handleSyncFailure(err, fileId, data) === 'notfound') return recoverMissingFile(fileId, data);
      return 'failed';
    } finally {
      dispatch({ type: 'saving', value: false });
    }
  };
  const saveNowRef = useRef(saveNow);
  saveNowRef.current = saveNow;

  /**
   * « Envoyer puis se déconnecter » : écrit tout de suite ce qui n'est pas encore sur Drive
   * (avec contrôle de révision). Renvoie true si Drive est à jour. Une copie locale qui attend
   * le choix de l'utilisateur (bandeau « sauvegarde locale ») n'est jamais envoyée ainsi : false.
   */
  const flushPendingChanges = async (): Promise<boolean> => {
    if (statusRef.current.localBackup) return false;
    clearTimeout(saveTimeoutRef.current);
    const result = await saveNowRef.current();
    return result !== 'failed' && !hasLocalEditsRef.current();
  };

  return { saveNowRef, flushPendingChanges };
};

interface AutoSaveDeps {
  refs: SyncRefs;
  dispatch: Dispatch<SyncEvent>;
  docState: DocumentState;
  isAuthenticated: boolean;
  driveFileId: string | null;
  isLoadingData: boolean;
  syncConflict: boolean;
  sessionExpired: boolean;
  appOutdated: boolean;
  isOffline: boolean;
  retryTick: number;
  saveNowRef: MutableRefObject<() => Promise<SaveResult>>;
}

/** Sauvegarde automatique : 2 s après la dernière modification (effet à garder à sa place dans useDriveSync). */
export const useAutoSave = ({
  refs, dispatch, docState, isAuthenticated, driveFileId, isLoadingData, syncConflict, sessionExpired, appOutdated, isOffline, retryTick, saveNowRef,
}: AutoSaveDeps) => {
  const { doc, buildData } = docState;
  const { persistedRef, hasLoadedRef, saveTimeoutRef } = refs;
  useEffect(() => {
    const stop = () => dispatch({ type: 'saving', value: false });
    if (!isAuthenticated || !driveFileId || isLoadingData || !hasLoadedRef.current) { stop(); return; }
    if (syncConflict || sessionExpired || appOutdated || isOffline) { stop(); return; }
    // Rien de changé par rapport à Drive : pas d'écriture (ni nouvelle révision). La forme
    // canonique est mémorisée par version du document : une seule sérialisation par saisie,
    // réutilisée par le miroir et par l'écriture. Elle est calculée juste APRÈS l'effet, pas
    // dedans : après une frappe ou un clic, React exécute cet effet avant d'afficher, et la
    // sérialisation triée de tout le document (quelques ms après des années de suivi, bien
    // plus sur mobile) retardait l'affichage de la saisie.
    const check = setTimeout(() => {
      if (canonicalDoc(doc) === persistedRef.current) { stop(); return; }
      dispatch({ type: 'saving', value: true });
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(() => { void saveNowRef.current(); }, 2000);
    }, 0);
    return () => { clearTimeout(check); clearTimeout(saveTimeoutRef.current); };
  }, [doc, isAuthenticated, driveFileId, isLoadingData, buildData, syncConflict, sessionExpired, appOutdated, isOffline, retryTick, dispatch, hasLoadedRef, persistedRef, saveNowRef, saveTimeoutRef]);
};
