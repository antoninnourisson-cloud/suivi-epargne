// Conflits entre deux versions, fichiers en double et copies locales proposées : état du choix
// en cours, ouverture, relecture de l'autre version, résolution. Code déplacé tel quel de
// useDriveSync ; les références partagées arrivent par `refs`.
import { useState, type Dispatch, type SetStateAction } from 'react';
import { lsDel, lsGetJSON, lsSetJSON } from '../../lib/storage';
import { canonicalize, isFromNewerApp } from '../../lib/schema';
import { readWriteStamp, stampDevice } from '../../lib/writeStamp';
import type { SyncEvent } from '../../lib/sync/syncStatus';
import { setAsideVersion } from '../../services/setAsideVersions';
import { fetchRevisionContent, getFileMeta, readConfigFile, type DriveFileInfo } from '../../services/googleDriveService';
import { BACKUP_KEY, DUPLICATE_DISMISSED_KEY } from './keys';
import {
  canonicalDoc, classifySyncError, duplicateKey,
  type ConflictChoice, type ConflictCtx, type ConflictInit, type ConflictResolution, type StoredSnapshot,
} from './syncShared';
import { dropLostCopies, type PendingStore, type Mirror, type UnreadableCopy } from './localCopies';
import type { DocumentState } from './useDocument';
import type { SyncRefs } from './syncRefs';

interface ConflictDeps {
  refs: SyncRefs;
  dispatch: Dispatch<SyncEvent>;
  docState: DocumentState;
  pending: PendingStore;
  mirror: Mirror;
  markPersisted: (data: unknown, fileId?: string | null, canon?: string) => void;
  runExclusive: <T>(fn: () => Promise<T>) => Promise<T>;
  clearSyncError: () => void;
  setRetryTick: Dispatch<SetStateAction<number>>;
  setOtherFiles: Dispatch<SetStateAction<DriveFileInfo[]>>;
  setLocalBackup: Dispatch<SetStateAction<StoredSnapshot | null>>;
  unreadableCopies: UnreadableCopy[];
  setUnreadableCopies: Dispatch<SetStateAction<UnreadableCopy[]>>;
}

export const useSyncConflicts = ({
  refs, dispatch, docState, pending, mirror, markPersisted, runExclusive, clearSyncError,
  setRetryTick, setOtherFiles, setLocalBackup, unreadableCopies, setUnreadableCopies,
}: ConflictDeps) => {
  const { applyData, currentData, docRef } = docState;
  const {
    conflictRef, attemptsRef, driveRevisionRef, localEditedAtRef, headSavedAtRef, driveFileIdRef, otherFilesRef, statusRef,
  } = refs;

  // Conflit entre deux versions : état (rendu) et réf (code asynchrone), toujours ensemble.
  const [conflictCtx, setConflictState] = useState<ConflictCtx | null>(null);
  const setConflict = (c: ConflictCtx | null) => { conflictRef.current = c; setConflictState(c); };
  const syncConflict = conflictCtx?.kind === 'conflict';
  const conflictOpen = () => conflictRef.current?.kind === 'conflict';

  // --- CONFLITS ---
  /**
   * Les deux versions sont en fait identiques (même écriture faite des deux côtés, ou
   * annulée) : pas de choix à demander. Renvoie true si le conflit a été refermé.
   */
  const settleIfSame = (c: ConflictCtx): boolean => {
    if (c.kind !== 'conflict' || c.remoteStatus !== 'ready') return false;
    const remote = canonicalize(c.remoteRaw);
    if (remote === canonicalDoc(docRef.current)) {
      if (c.headIs === 'remote') {
        driveRevisionRef.current = c.headRevision;
        markPersisted(c.remoteRaw);
      }
      setConflict(null);
      return true;
    }
    // Notre propre écriture, arrivée sur Drive alors que la réponse s'est perdue (réseau
    // coupé pendant l'envoi) : la tête de Drive est exactement une version que cet appareil a
    // envoyée depuis la même révision de référence, donc un ancêtre de l'état affiché. Ce
    // n'est pas un autre appareil : elle devient la référence, et la sauvegarde auto envoie
    // la suite, avec contrôle de révision (comme « Garder la version de cet appareil »).
    const ownWrite = c.headIs === 'remote' && !!c.headRevision && !c.source.revisionId && c.source.fileId === c.fileId
      && attemptsRef.current.some(a => a.fileId === c.fileId && a.base === driveRevisionRef.current && a.canon === remote);
    if (ownWrite) {
      attemptsRef.current = [];
      driveRevisionRef.current = c.headRevision;
      markPersisted(c.remoteRaw);
      if (c.offDrive !== undefined) void pending.dropIf(c.offDrive);
      setConflict(null);
      // Le document n'a pas changé : on relance la sauvegarde auto explicitement.
      setRetryTick(t => t + 1);
      return true;
    }
    return false;
  };

  /** Relit l'autre version (tête du fichier, ou révision précise après une course d'écriture). */
  const loadConflictRemote = async () => {
    const start = conflictRef.current;
    if (!start) return;
    const c = { ...start, remoteStatus: 'loading' as const };
    setConflict(c);
    try {
      const { source } = c;
      const loaded = await runExclusive(async () => {
        if (source.revisionId) return { raw: await fetchRevisionContent(source.fileId, source.revisionId), meta: null };
        const meta = await getFileMeta(source.fileId);
        return { raw: await readConfigFile(source.fileId), meta };
      });
      if (conflictRef.current !== c) return; // résolu ou remplacé entre-temps
      if (!loaded.raw) throw new Error('EMPTY_FILE');
      // Date de Drive seulement : la signature, elle, peut être périmée (voir lib/writeStamp).
      const ready: ConflictCtx = {
        ...c, remoteRaw: loaded.raw, remoteStatus: 'ready',
        remoteSavedAt: loaded.meta?.modifiedTime ?? c.remoteSavedAt,
        headRevision: loaded.meta && c.headIs === 'remote' && source.fileId === c.fileId ? loaded.meta.headRevisionId : c.headRevision,
      };
      if (!settleIfSame(ready)) setConflict(ready);
    } catch (err) {
      console.error("Autre version illisible pour l'instant", err);
      if (conflictRef.current !== c) return;
      if (classifySyncError(err) === 'session') dispatch({ type: 'session-expired' });
      setConflict({ ...c, remoteStatus: 'error' });
    }
  };

  /**
   * Ouvre le choix entre deux versions. Rien n'est écrit tant que l'utilisateur n'a pas
   * choisi ; la version qui n'est pas en tête de Drive est gardée en quarantaine locale
   * chiffrée (proposée au prochain démarrage si l'app est fermée avant).
   */
  const openConflict = (init: ConflictInit, offDrive?: unknown) => {
    const c: ConflictCtx = {
      ...init,
      offDrive,
      localSavedAt: init.localSavedAt ?? localEditedAtRef.current,
      remoteStatus: init.remoteRaw === undefined ? 'loading' : 'ready',
    };
    if (offDrive !== undefined) pending.keep(init.fileId, offDrive);
    if (settleIfSame(c)) return;
    setConflict(c);
    if (c.remoteStatus === 'loading') void loadConflictRemote();
  };

  /**
   * Choix de l'utilisateur entre les deux versions. La version écartée est d'abord mise de
   * côté (30 jours, chiffrée) : si c'est impossible, rien ne change ('copy-failed'), sauf
   * `withoutCopy` (choix explicite). Jamais de choix à l'aveugle : l'autre version doit avoir
   * été relue ('unavailable' sinon), et une version d'une app plus récente n'est pas écrasée.
   */
  const resolveConflict = async (choice: ConflictChoice, opts?: { withoutCopy?: boolean }): Promise<ConflictResolution> => {
    const c = conflictRef.current;
    if (!c) return 'done';
    if (c.remoteStatus !== 'ready') return 'unavailable';
    if (choice === 'local' && c.kind === 'conflict' && isFromNewerApp(c.remoteRaw)) return 'unavailable';
    const remoteStamp = readWriteStamp(c.remoteRaw);
    const remoteDevice = stampDevice(remoteStamp, c.remoteSavedAt);
    const duplicate = c.kind === 'duplicate';
    // « Garder le fichier ouvert » ne remplace rien : rien à mettre de côté.
    if (!(duplicate && choice === 'local')) {
      const entry = choice === 'local'
        ? { data: c.remoteRaw, savedAt: c.remoteSavedAt ?? remoteStamp?.at ?? null, label: `Version de Drive écartée${remoteDevice ? ` (${remoteDevice})` : ''}` }
        : { data: currentData(), savedAt: c.localSavedAt, label: duplicate ? 'Fichier ouvert remplacé par l\'autre fichier' : 'Version de cet appareil écartée' };
      try {
        await setAsideVersion({ reason: 'conflict', label: entry.label, savedAt: entry.savedAt, fileId: c.fileId, data: entry.data });
      } catch (err) {
        console.warn('Version écartée non mise de côté', err);
        if (!opts?.withoutCopy) return 'copy-failed';
      }
    }
    if (conflictRef.current !== c) return 'unavailable'; // autre conflit entre-temps : nouveau choix
    const dismissThisDuplicate = () => {
      const other = otherFilesRef.current.find(f => f.id === c.source.fileId);
      if (other) lsSetJSON(DUPLICATE_DISMISSED_KEY, [...lsGetJSON<string[]>(DUPLICATE_DISMISSED_KEY, []), duplicateKey(other)].slice(-20));
      setOtherFiles(prev => prev.filter(f => f.id !== c.source.fileId));
    };
    if (choice === 'local') {
      if (duplicate) dismissThisDuplicate();
      else {
        if (c.headIs === 'remote') {
          // La sauvegarde auto réécrit notre version par-dessus la tête relue, avec contrôle.
          driveRevisionRef.current = c.headRevision;
          markPersisted(c.remoteRaw);
        }
        // La quarantaine ne perd que la copie de CE conflit (une copie locale proposée y reste).
        if (c.offDrive !== undefined) void pending.dropIf(c.offDrive);
      }
    } else {
      // Abandon explicite des modifications de cet appareil (mises de côté ci-dessus).
      mirror.cancel();
      if (c.offDrive !== undefined) void pending.dropIf(c.offDrive);
      lsDel(BACKUP_KEY);
      if (!duplicate && c.headIs === 'remote') {
        driveRevisionRef.current = c.headRevision;
        markPersisted(c.remoteRaw);
      }
      // Sinon (course d'écriture, autre fichier) la sauvegarde auto écrit cette version en
      // tête du fichier ouvert, avec contrôle de révision.
      dispatch({ type: 'outdated', value: isFromNewerApp(c.remoteRaw) });
      applyData(c.remoteRaw);
      if (duplicate) dismissThisDuplicate();
    }
    setConflict(null);
    clearSyncError();
    return 'done';
  };

  /** Compare le fichier ouvert à l'autre fichier de données trouvé sur Drive. */
  const compareDuplicate = () => {
    const other = otherFilesRef.current[0];
    const fileId = driveFileIdRef.current;
    if (!other || !fileId || conflictRef.current) return;
    openConflict({
      kind: 'duplicate', fileId, headRevision: driveRevisionRef.current, headIs: 'local',
      source: { fileId: other.id }, remoteRaw: undefined, remoteSavedAt: other.modifiedTime ?? null,
      localSavedAt: headSavedAtRef.current,
    });
  };
  /** Ferme la comparaison d'un doublon sans rien choisir (un vrai conflit, lui, reste ouvert). */
  const closeDuplicateComparison = () => {
    if (conflictRef.current?.kind === 'duplicate') setConflict(null);
  };
  /** « Ignorer » le doublon : plus signalé tant qu'il n'est pas modifié. */
  const dismissDuplicate = () => {
    const other = otherFilesRef.current[0];
    if (!other) return;
    lsSetJSON(DUPLICATE_DISMISSED_KEY, [...lsGetJSON<string[]>(DUPLICATE_DISMISSED_KEY, []), duplicateKey(other)].slice(-20));
    setOtherFiles(prev => prev.slice(1));
  };

  // La quarantaine n'est effacée que si elle contient encore cette copie (une copie de
  // conflit ou d'un autre fichier a pu prendre sa place entre-temps).
  const restoreLocalBackup = () => {
    const backup = statusRef.current.localBackup;
    if (!backup) return;
    applyData(backup.data);
    void pending.dropIf(backup.data);
    setLocalBackup(null);
  };
  const dismissLocalBackup = () => {
    const backup = statusRef.current.localBackup;
    if (backup) void pending.dropIf(backup.data);
    setLocalBackup(null);
  };

  /** « Compris » sur la bannière : les copies définitivement illisibles sont effacées. */
  const dismissUnreadableCopies = () => { dropLostCopies(unreadableCopies); setUnreadableCopies([]); };

  return {
    conflictCtx, syncConflict, setConflict, conflictOpen, openConflict, loadConflictRemote, resolveConflict,
    compareDuplicate, closeDuplicateComparison, dismissDuplicate, restoreLocalBackup, dismissLocalBackup, dismissUnreadableCopies,
  };
};
