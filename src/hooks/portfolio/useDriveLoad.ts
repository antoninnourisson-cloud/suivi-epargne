// Chargement : fichier Drive, copie hors ligne affichée en attendant le réseau, copies locales
// jamais envoyées proposées (quarantaine) et mode démo. Code déplacé tel quel de useDriveSync ;
// les références partagées arrivent par `refs`.
import { useCallback, useRef, type Dispatch, type SetStateAction } from 'react';
import { lsGet, lsGetJSON } from '../../lib/storage';
import { canonicalize, emptyData, isFromNewerApp } from '../../lib/schema';
import { readWriteStamp, withWriteStamp, type WriteStamp } from '../../lib/writeStamp';
import type { SyncErrorInfo } from '../../lib/syncErrors';
import type { SyncEvent } from '../../lib/sync/syncStatus';
import { createConfigFile, findConfigFiles, getFileMeta, readConfigFile, type DriveFileInfo, type FileMeta } from '../../services/googleDriveService';
import { BACKUP_KEY, DUPLICATE_DISMISSED_KEY, PENDING_KEY } from './keys';
import { browserOnline, canonicalWithoutView, classifySyncError, duplicateKey, type ConflictCtx, type ConflictInit, type StoredSnapshot } from './syncShared';
import {
  heldCopies, holdUnavailableCopies, newestUnsyncedCopy, releaseHeldCopies,
  type OfflineStore, type PendingStore, type StoredCopies, type UnreadableCopy,
} from './localCopies';
import type { DocumentState } from './useDocument';
import type { SyncRefs } from './syncRefs';

interface LoadDeps {
  refs: SyncRefs;
  dispatch: Dispatch<SyncEvent>;
  docState: DocumentState;
  pending: PendingStore;
  offlineStore: OfflineStore;
  makeStamp: () => WriteStamp;
  markPersisted: (data: unknown, fileId?: string | null, canon?: string) => void;
  hasLocalEdits: () => boolean;
  setConflict: (c: ConflictCtx | null) => void;
  openConflict: (init: ConflictInit, offDrive?: unknown) => void;
  scheduleRetry: () => void;
  resetRetry: () => void;
  failSync: (err: unknown) => SyncErrorInfo;
  setDriveFileId: Dispatch<SetStateAction<string | null>>;
  setLocalBackup: Dispatch<SetStateAction<StoredSnapshot | null>>;
  setUnreadableCopies: Dispatch<SetStateAction<UnreadableCopy[]>>;
  setOtherFiles: Dispatch<SetStateAction<DriveFileInfo[]>>;
  setOfflineDataAt: Dispatch<SetStateAction<string | null>>;
  setDataShown: Dispatch<SetStateAction<boolean>>;
  setLoadCount: Dispatch<SetStateAction<number>>;
}

export const useDriveLoad = ({
  refs, dispatch, docState, pending, offlineStore, makeStamp, markPersisted, hasLocalEdits, setConflict, openConflict,
  scheduleRetry, resetRetry, failSync, setDriveFileId, setLocalBackup, setUnreadableCopies, setOtherFiles,
  setOfflineDataAt, setDataShown, setLoadCount,
}: LoadDeps) => {
  const { applyData, currentData, setLastView } = docState;
  const {
    sessionGenRef, offlineRef, hasLoadedRef, persistedRef, driveFileIdRef, driveRevisionRef, headStampRef, headSavedAtRef,
    lastRemoteCheckRef, retryTimerRef,
  } = refs;

  /**
   * Copies locales jamais envoyées qui diffèrent de Drive : la plus récente est proposée
   * (bannière « sauvegarde locale ») et gardée en quarantaine (voir newestUnsyncedCopy).
   * Une copie illisible pour l'instant est mise à l'abri AVANT que le miroir (activé juste après)
   * ne puisse la réécrire ; une copie de l'abri redevenue lisible en sort (voir releaseHeldCopies).
   */
  const proposeUnsynced = async (fileId: string, reference: string, candidates: StoredSnapshot[], storedCopies: StoredCopies, clearSynced: boolean) => {
    const gen = sessionGenRef.current;
    const { newest, unreadable, held } = await newestUnsyncedCopy(fileId, reference, candidates, storedCopies, clearSynced);
    if (gen !== sessionGenRef.current) return; // déconnexion entre-temps : rien à écrire
    if (unreadable.length > 0) {
      const kept = holdUnavailableCopies(unreadable);
      console.warn('Copie locale jamais envoyée illisible', kept.map(u => ({ key: u.key, lost: u.lost })));
      setUnreadableCopies(kept);
    }
    let newestKept = false;
    if (newest) {
      setLocalBackup(newest);
      try { newestKept = await pending.replace({ ...newest, fileId }, fileId); } catch { /* reste proposée en mémoire */ }
    }
    if (held.length > 0 && gen === sessionGenRef.current) await releaseHeldCopies(held, newest, newestKept);
  };

  /**
   * Hors ligne (ou Drive injoignable) au démarrage : affiche le dernier état confirmé sur Drive,
   * gardé chiffré sur l'appareil, au lieu d'attendre le réseau. Les saisies restent sur
   * l'appareil (miroir) ; rien n'est écrit sur Drive avant un vrai chargement, qui décide
   * ensuite (voir loadDriveData). Renvoie false s'il n'y a pas de copie utilisable.
   */
  const openOfflineCopy = async (gen: number, storedCopies: StoredCopies): Promise<boolean> => {
    if (offlineRef.current) return true;
    if (hasLoadedRef.current) return false; // des données de Drive sont déjà affichées
    const copy = await offlineStore.read();
    if (!copy) return false;
    const base = canonicalize(copy.data);
    // Saisies jamais envoyées : proposées comme au chargement normal, et mises en quarantaine
    // AVANT qu'une nouvelle saisie ne réécrive le miroir.
    await proposeUnsynced(copy.fileId, base, [], storedCopies, false);
    if (gen !== sessionGenRef.current || hasLoadedRef.current || offlineRef.current) return !!offlineRef.current;
    applyData(copy.data);
    dispatch({ type: 'outdated', value: isFromNewerApp(copy.data) });
    const savedView = (copy.data as { lastView?: string }).lastView;
    if (savedView) setLastView(savedView);
    persistedRef.current = base;
    driveFileIdRef.current = copy.fileId;
    driveRevisionRef.current = null;
    offlineRef.current = { fileId: copy.fileId, base, baseWithoutView: canonicalWithoutView(copy.data) };
    setOfflineDataAt(copy.savedAt);
    setDataShown(true);
    return true;
  };

  /**
   * Charge le fichier Drive. Les modifications locales pas encore sur Drive (quarantaine,
   * miroir, et état affiché s'il diffère) sont comparées au fichier : la plus récente qui
   * en diffère est proposée (bannière « sauvegarde locale ») et gardée en quarantaine.
   * `keepUnsynced: false` seulement pour un abandon explicite des modifications locales.
   * Renvoie `true` si le fichier a bien été chargé (le verrou de l'appareil en dépend).
   *
   * Plusieurs fichiers de données sur Drive : le plus récemment modifié est ouvert, les
   * autres sont signalés (`duplicateFile`) et jamais modifiés sans le choix de l'utilisateur.
   *
   * Hors ligne : aucune attente, la copie hors ligne s'affiche (openOfflineCopy). Au chargement
   * suivant, les saisies faites sur cette copie restent affichées : si Drive n'a pas changé
   * entre-temps, la sauvegarde automatique les envoie (avec contrôle de révision) ; sinon
   * l'écran de choix entre les deux versions s'ouvre avant toute écriture.
   */
  const loadDriveData = async (opts?: { keepUnsynced?: boolean; startOffline?: boolean }): Promise<boolean> => {
    const keepUnsynced = opts?.keepUnsynced !== false;
    const gen = sessionGenRef.current;
    const offline = offlineRef.current;
    // Relevé AVANT toute attente : le miroir peut être effacé dès que l'état affiché
    // redevient celui de Drive. (Les saisies faites sur la copie hors ligne sont traitées à part.)
    const inMemory: StoredSnapshot | null = keepUnsynced && !offline && hasLocalEdits()
      ? { savedAt: new Date().toISOString(), fileId: driveFileIdRef.current ?? undefined, data: currentData() }
      : null;
    const storedCopies: StoredCopies = keepUnsynced ? [...[PENDING_KEY, BACKUP_KEY].map(key => [key, lsGet(key)] as const), ...heldCopies()] : [];
    clearTimeout(retryTimerRef.current);
    if (!browserOnline() || opts?.startOffline) {
      // Le navigateur se sait hors ligne (ou le jeton vient d'échouer faute de réseau,
      // `startOffline`) : rien à attendre. Le chargement reprend au retour du réseau
      // (événement `online`) ou au prochain essai programmé.
      dispatch({ type: 'load-failed', offline: true });
      if (!offline) await openOfflineCopy(gen, storedCopies);
      scheduleRetry(); // sans effet si le navigateur est hors ligne
      return false;
    }
    dispatch({ type: 'load-start' });
    setConflict(null);
    try {
      const files = await findConfigFiles();
      const head = files[0];
      const fileId = head?.id ?? await createConfigFile(withWriteStamp(emptyData(), makeStamp()));
      setDriveFileId(fileId);
      const dismissed = lsGetJSON<string[]>(DUPLICATE_DISMISSED_KEY, []);
      setOtherFiles(files.slice(1).filter(f => !dismissed.includes(duplicateKey(f))));
      // Révision lue AVANT le contenu (dans la liste, sinon par une lecture à part) : si une
      // écriture tombe entre les deux, la prochaine sauvegarde lèvera un conflit de trop,
      // jamais un écrasement. En cas d'échec on laisse `null` : la sauvegarde comparera
      // d'abord le contenu de Drive à celui-ci.
      let meta: FileMeta | null = head?.headRevisionId ? { headRevisionId: head.headRevisionId, modifiedTime: head.modifiedTime ?? null } : null;
      if (!meta) { try { meta = await getFileMeta(fileId); } catch { meta = null; } }
      const raw: unknown = await readConfigFile(fileId);
      if (!raw) throw new Error('EMPTY_FILE');
      if (gen !== sessionGenRef.current) return false; // déconnexion entre-temps
      // Copie hors ligne modifiée ici (autre chose que l'écran affiché) : ces saisies restent.
      const local = offline ? currentData() : null;
      const offlineEdited = !!offline && !!local && canonicalWithoutView(local) !== offline.baseWithoutView;
      // Copie hors ligne d'un AUTRE fichier (reconnexion avec un autre compte Google, fichier
      // recréé) : ses saisies ne sont jamais proposées pour écraser celui-ci. Elles restent en
      // quarantaine, rattachées à leur fichier, et les données de Drive s'affichent.
      const keepLocal = offlineEdited && offline!.fileId === fileId;
      if (offlineEdited && !keepLocal) {
        try { await pending.replace({ savedAt: new Date().toISOString(), fileId: offline!.fileId, data: local! }, fileId); }
        catch { /* le miroir, rattaché au même fichier, reste en place */ }
        if (gen !== sessionGenRef.current) return false;
      }
      dispatch({ type: 'outdated', value: isFromNewerApp(raw) });
      if (!keepLocal) {
        applyData(raw, { adoptLegacyGeminiKey: true });
        const savedView = (raw as { lastView?: string }).lastView;
        if (savedView) setLastView(savedView);
      }
      markPersisted(raw, fileId);
      // Ancien fichier contenant encore la clé Gemini : une écriture la retire de Drive.
      if ((raw as { config?: { geminiApiKey?: string } }).config?.geminiApiKey) persistedRef.current = '';
      driveRevisionRef.current = meta?.headRevisionId ?? null;
      headStampRef.current = readWriteStamp(raw);
      headSavedAtRef.current = meta?.modifiedTime ?? head?.modifiedTime ?? null;
      lastRemoteCheckRef.current = Date.now();

      // Modifications locales qui n'ont jamais atteint Drive (sync bloquée avant fermeture) ?
      // Les deux copies sont lues : une vieille quarantaine ne cache plus un miroir plus récent.
      // Saisies hors ligne gardées à l'écran : leur miroir n'est pas une copie à proposer.
      const rawCanonical = canonicalize(raw);
      const candidates = inMemory && canonicalize(inMemory.data) !== rawCanonical ? [inMemory] : [];
      await proposeUnsynced(fileId, rawCanonical, candidates, keepLocal ? storedCopies.filter(([key]) => key !== BACKUP_KEY) : storedCopies, true);
      if (gen !== sessionGenRef.current) return false;

      driveFileIdRef.current = fileId;
      hasLoadedRef.current = true;
      offlineRef.current = null;
      setOfflineDataAt(null);
      setDataShown(true);
      setLoadCount(n => n + 1);
      if (browserOnline()) dispatch({ type: 'online' });
      if (offline && keepLocal && local && canonicalWithoutView(raw) !== offline.baseWithoutView) {
        // Drive a changé pendant que cet appareil était hors ligne : l'utilisateur choisit la
        // version à garder, rien n'est écrit avant. Sinon la sauvegarde automatique envoie les
        // saisies faites hors ligne, avec contrôle de révision.
        openConflict({
          kind: 'conflict', fileId, headRevision: meta?.headRevisionId ?? null, headIs: 'remote',
          source: { fileId }, remoteRaw: raw, remoteSavedAt: headSavedAtRef.current,
        }, local);
      }
      resetRetry();
      return true;
    } catch (error) {
      if (gen !== sessionGenRef.current) return false;
      // Un chargement raté doit être VISIBLE (sinon indiscernable d'une perte totale), et
      // rien ne sera écrit sur Drive tant qu'un chargement n'a pas réussi.
      console.error('Erreur chargement', error);
      dispatch({ type: 'load-failed' });
      const kind = classifySyncError(error);
      if (kind === 'session') dispatch({ type: 'session-expired' });
      else if (kind === 'offline' && (offlineRef.current || await openOfflineCopy(gen, storedCopies))) {
        // Réseau ou Drive injoignable : la dernière copie connue reste affichée, nouvel essai
        // programmé (ou au retour du réseau).
        dispatch({ type: 'offline' });
        scheduleRetry();
      } else failSync(error);
      return false;
    } finally {
      dispatch({ type: 'load-end' });
    }
  };
  // Identité stable pour l'interface ; le corps le plus récent est toujours celui appelé.
  const loadDriveDataRef = useRef(loadDriveData);
  loadDriveDataRef.current = loadDriveData;
  const loadDriveDataStable = useCallback((opts?: { keepUnsynced?: boolean; startOffline?: boolean }) => loadDriveDataRef.current(opts), []);

  /** Mode démo (développement uniquement) : données fictives en mémoire, aucune écriture Drive. */
  const loadDemoData = useCallback((raw: unknown) => {
    applyData(raw);
    persistedRef.current = canonicalize(raw); // aucun fichier Drive : pas de copie hors ligne
    hasLoadedRef.current = true;
    dispatch({ type: 'load-end' });
    setDataShown(true);
  }, [applyData, dispatch, hasLoadedRef, persistedRef, setDataShown]);

  return { loadDriveDataRef, loadDriveDataStable, loadDemoData };
};
