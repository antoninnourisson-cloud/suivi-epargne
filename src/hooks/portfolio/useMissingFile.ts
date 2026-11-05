// Fichier Drive introuvable : les choix de l'utilisateur (voir MissingFileDialog). Rien n'est
// créé sur Drive avant l'un d'eux, et chacun commence par vérifier qu'aucun fichier n'est
// réapparu (jamais de doublon). Une copie de cet appareil remplacée par un autre contenu est
// d'abord mise de côté (30 jours, chiffrée).
import { useCallback, type Dispatch, type SetStateAction } from 'react';
import { emptyData, isFromNewerApp, validateImport } from '../../lib/schema';
import { readWriteStamp, withWriteStamp, type WriteStamp } from '../../lib/writeStamp';
import type { SyncEvent } from '../../lib/sync/syncStatus';
import { setAsideVersion } from '../../services/setAsideVersions';
import { createConfigFile, findConfigFiles, getFileMeta, readConfigFile, type DriveFileInfo, type FileMeta } from '../../services/googleDriveService';
import { browserOnline } from './syncShared';
import type { PendingStore } from './localCopies';
import type { MissingFileOutcome, MissingFileStore } from './missingFile';
import type { DocumentState } from './useDocument';
import type { SyncRefs } from './syncRefs';

interface MissingDeps {
  refs: SyncRefs;
  dispatch: Dispatch<SyncEvent>;
  docState: DocumentState;
  pending: PendingStore;
  makeStamp: () => WriteStamp;
  markPersisted: (data: unknown, fileId?: string | null, canon?: string) => void;
  resetRetry: () => void;
  missingFile: MissingFileStore;
  loadDriveData: () => Promise<boolean>;
  setDriveFileId: Dispatch<SetStateAction<string | null>>;
  setOtherFiles: Dispatch<SetStateAction<DriveFileInfo[]>>;
  setOfflineDataAt: Dispatch<SetStateAction<string | null>>;
  setDataShown: Dispatch<SetStateAction<boolean>>;
  setLoadCount: Dispatch<SetStateAction<number>>;
}

export const useMissingFile = ({
  refs, dispatch, docState, pending, makeStamp, markPersisted, resetRetry, missingFile, loadDriveData,
  setDriveFileId, setOtherFiles, setOfflineDataAt, setDataShown, setLoadCount,
}: MissingDeps) => {
  const { applyData, setLastView } = docState;
  const {
    sessionGenRef, offlineRef, hasLoadedRef, driveFileIdRef, driveRevisionRef, headStampRef, headSavedAtRef, lastRemoteCheckRef,
  } = refs;

  /**
   * Recrée le fichier sur Drive avec `data`, puis ouvre l'app dessus comme après un chargement.
   * Si un fichier est réapparu entre-temps, rien n'est créé : le chargement normal reprend
   * (la copie de l'appareil y est alors proposée comme toute copie jamais envoyée).
   */
  const recreate = useCallback(async (data: object): Promise<MissingFileOutcome> => {
    const gen = sessionGenRef.current;
    try {
      const files = await findConfigFiles();
      if (gen !== sessionGenRef.current) return 'failed';
      if (files.length > 0) {
        missingFile.clear();
        await loadDriveData();
        return 'found';
      }
      const stamp = makeStamp();
      const written = withWriteStamp(data, stamp);
      const fileId = await createConfigFile(written);
      if (gen !== sessionGenRef.current) return 'failed';
      // Révision lue après la création : en cas d'échec elle reste inconnue, et la prochaine
      // sauvegarde compare d'abord le contenu de Drive (jamais d'écriture à l'aveugle).
      let meta: FileMeta | null = null;
      try { meta = await getFileMeta(fileId); } catch { meta = null; }
      applyData(written);
      const savedView = (written as { lastView?: string }).lastView;
      if (savedView) setLastView(savedView);
      markPersisted(written, fileId);
      driveFileIdRef.current = fileId;
      setDriveFileId(fileId);
      driveRevisionRef.current = meta?.headRevisionId ?? null;
      headStampRef.current = readWriteStamp(written);
      headSavedAtRef.current = meta?.modifiedTime ?? null;
      lastRemoteCheckRef.current = Date.now();
      setOtherFiles([]);
      dispatch({ type: 'outdated', value: isFromNewerApp(written) });
      hasLoadedRef.current = true;
      offlineRef.current = null;
      setOfflineDataAt(null);
      setDataShown(true);
      setLoadCount(n => n + 1);
      missingFile.clear();
      // Plus de chargement raté : les sauvegardes reprennent, avec contrôle de révision.
      dispatch({ type: 'load-start' });
      dispatch({ type: 'load-end' });
      if (browserOnline()) dispatch({ type: 'online' });
      resetRetry();
      void pending.dropIf(data).catch(() => undefined); // déjà sur Drive : plus à proposer
      return 'done';
    } catch (error) {
      console.error('Recréation du fichier Drive échouée', error);
      return 'failed';
    }
  }, [
    sessionGenRef, offlineRef, hasLoadedRef, driveFileIdRef, driveRevisionRef, headStampRef, headSavedAtRef, lastRemoteCheckRef,
    missingFile, loadDriveData, makeStamp, applyData, setLastView, markPersisted, setDriveFileId, setOtherFiles, dispatch,
    setOfflineDataAt, setDataShown, setLoadCount, resetRetry, pending,
  ]);

  /** Met la copie de l'appareil de côté (30 jours) avant qu'un autre contenu ne prenne sa place. */
  const keepDeviceCopy = useCallback(async (label: string): Promise<boolean> => {
    const copy = missingFile.copy();
    if (!copy) return true; // rien à garder
    try {
      await setAsideVersion({ reason: 'unsent', label, savedAt: copy.savedAt ?? null, data: copy.data });
      return true;
    } catch (error) {
      console.warn('Copie de l\'appareil non mise de côté', error);
      return false;
    }
  }, [missingFile]);

  /** « Restaurer la copie de cet appareil » : le fichier est recréé à partir d'elle. */
  const restoreFromDevice = useCallback(async (): Promise<MissingFileOutcome> => {
    const copy = missingFile.copy();
    if (!copy || typeof copy.data !== 'object') return 'invalid';
    return recreate(copy.data);
  }, [missingFile, recreate]);

  /** « Repartir de zéro » : un fichier vide. La copie de l'appareil est d'abord mise de côté. */
  const startOver = useCallback(async (): Promise<MissingFileOutcome> => {
    if (!await keepDeviceCopy('Copie de cet appareil avant de repartir de zéro')) return 'set-aside-failed';
    return recreate(emptyData());
  }, [keepDeviceCopy, recreate]);

  /** Une copie mensuelle Drive devient le nouveau fichier. La copie de l'appareil est d'abord mise de côté. */
  const restoreFromBackup = useCallback(async (backupId: string, label?: string): Promise<string> => {
    const raw: unknown = await readConfigFile(backupId);
    if (!raw || typeof raw !== 'object' || validateImport(raw).length > 0) throw new Error('Copie illisible');
    if (!await keepDeviceCopy(`Copie de cet appareil avant le retour à la copie${label ? ` ${label}` : ''}`)) throw new Error('SET_ASIDE_FAILED');
    const outcome = await recreate(raw);
    if (outcome === 'failed') throw new Error('Copie illisible');
    return ''; // rien à annuler ici : la copie de l'appareil est dans « Versions mises de côté »
  }, [keepDeviceCopy, recreate]);

  /** « Chercher à nouveau » (fichier sorti de la corbeille entre-temps). */
  const retryFind = useCallback(() => loadDriveData(), [loadDriveData]);

  return { restoreFromDevice, startOver, restoreFromBackup, retryFind };
};
