// Moteur de synchronisation avec le fichier Drive : chargement, sauvegarde automatique
// (contrôle de révision), conflits et doublons, copies locales (miroir, quarantaine, copie
// hors ligne), nouvelles tentatives, plusieurs onglets, relecture au retour dans l'app,
// déconnexion. Le document lui-même vit dans useDocument ; l'état de la synchronisation est
// UN objet (lib/sync/syncStatus) modifié par des transitions nommées.
//
// Règle d'or : rien n'est écrit sur Drive tant qu'un chargement n'a pas réussi, ni pendant un
// choix entre deux versions, une session expirée ou avec une version trop ancienne de l'app.
import { useState, useCallback, useRef, useEffect, useMemo, useReducer } from 'react';
import { lsDel, lsGet, lsSet, lsGetJSON, lsSetJSON } from '../../lib/storage';
import { canonicalize, emptyData, isFromNewerApp } from '../../lib/schema';
import { readWriteStamp, withWriteStamp, stampDevice, stampIsFromDevice, type WriteStamp } from '../../lib/writeStamp';
import { classifySyncFailure, type SyncErrorInfo } from '../../lib/syncErrors';
import { initialSyncStatus, syncReducer } from '../../lib/sync/syncStatus';
import { setAsideVersion, clearSetAside } from '../../services/setAsideVersions';
import type { GlobalAppData } from '../../types';
import {
  findConfigFiles, createConfigFile, readConfigFile, updateConfigFile, getFileRevision, getFileMeta,
  setOnAuthLost, ConcurrentWriteError, writeMonthlyBackup, fetchRevisionContent, type DriveFileInfo, type FileMeta,
} from '../../services/googleDriveService';
import { BACKUP_KEY, DUPLICATE_DISMISSED_KEY, HELD_KEY, LAST_BACKUP_MONTH_KEY, LAST_SAVE_KEY, PENDING_KEY } from './keys';
import {
  browserOnline, canonicalDoc, canonicalWithoutView, classifySyncError, duplicateKey, failureOf, localMonthKey,
  RemoteChanged, SaveSkipped, LONG_PAUSE_MS, REMOTE_CHECK_THROTTLE_MS, RETRY_DELAYS_MS,
  type ConflictChoice, type ConflictCtx, type ConflictInit, type ConflictResolution, type SaveResult,
  type StoredSnapshot, type SyncConflictView, type SyncFailure,
} from './syncShared';
import {
  createMirror, createOfflineStore, createPendingStore, dropLostCopies, heldCopies, holdUnavailableCopies, newestUnsyncedCopy, releaseHeldCopies,
  type StoredCopies, type UnreadableCopy,
} from './localCopies';
import { buildConflictView, useDeviceIdentity } from './conflictView';
import { useRestoreActions } from './useRestoreActions';
import type { DocumentState } from './useDocument';

export const useDriveSync = (isAuthenticated: boolean, docState: DocumentState) => {
  const { doc, applyData, buildData, currentData, docRef, setDoc, setLastView } = docState;

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
  // Base de la copie hors ligne affichée : le contenu de Drive qu'elle reflète.
  const offlineRef = useRef<{ fileId: string; base: string; baseWithoutView: string } | null>(null);
  // Chargements Drive réussis : les points mensuels sont recalculés après chacun (y compris
  // quand les saisies faites hors ligne restent affichées).
  const [loadCount, setLoadCount] = useState(0);
  // Change à chaque déconnexion : une lecture lancée avant ne doit plus rien appliquer.
  const sessionGenRef = useRef(0);

  // Conflit entre deux versions : état (rendu) et réf (code asynchrone), toujours ensemble.
  const [conflictCtx, setConflictState] = useState<ConflictCtx | null>(null);
  const conflictRef = useRef<ConflictCtx | null>(null);
  const setConflict = (c: ConflictCtx | null) => { conflictRef.current = c; setConflictState(c); };
  const syncConflict = conflictCtx?.kind === 'conflict';
  const conflictOpen = () => conflictRef.current?.kind === 'conflict';

  // Relance la sauvegarde automatique sans modification du document (bouton « Réessayer »,
  // nouvelle tentative programmée, retour au premier plan).
  const [retryTick, setRetryTick] = useState(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const retryAttemptRef = useRef(0);
  const retrySyncRef = useRef<() => void>(() => {});
  // Dernier état vu par les écouteurs (onglets, retour au premier plan) sans les réabonner.
  const statusRef = useRef({ ...status, syncConflict, localBackup, isAuthenticated });
  statusRef.current = { ...status, syncConflict, localBackup, isAuthenticated };

  // Révision Drive à laquelle correspond `persistedRef` : toujours une vraie révision lue sur
  // Drive, ou null si inconnue (la prochaine écriture compare alors le contenu d'abord).
  const driveRevisionRef = useRef<string | null>(null);
  const driveFileIdRef = useRef<string | null>(null);
  // Contenu canonique de ce qui est sur Drive (après chargement ou sauvegarde) : aucune
  // écriture tant que l'état n'en diffère pas. Ouvrir l'app ne réécrit donc plus le fichier.
  const persistedRef = useRef<string>('');
  // Écritures tentées depuis la dernière confirmée (les plus récentes, même fichier et même
  // révision de référence) : contenu canonique envoyé. Si le réseau coupe pendant l'envoi,
  // Drive peut avoir reçu l'une d'elles sans que la réponse arrive ; voir settleIfSame (pas
  // de faux conflit avec soi-même). Vidée à chaque écriture confirmée.
  const attemptsRef = useRef<{ fileId: string; base: string | null; canon: string }[]>([]);
  // Dernière relecture (ou écriture) confirmant l'état de Drive.
  const lastRemoteCheckRef = useRef(0);
  const remoteCheckInFlightRef = useRef(false);
  // Signature et date de la version en tête du fichier ouvert (affichées pour un doublon).
  const headStampRef = useRef<WriteStamp | null>(null);
  const headSavedAtRef = useRef<string | null>(null);
  // Dernière modification faite sur cet appareil et pas encore sur Drive.
  const localEditedAtRef = useRef<string | null>(null);
  // Garde-fou : tant qu'un chargement Drive n'a pas réussi, aucune sauvegarde (évite
  // d'écraser un bon fichier avec un état vide).
  const hasLoadedRef = useRef(false);
  const isLoaded = useCallback(() => hasLoadedRef.current, []);

  const { thisDevice, deviceId, makeStamp } = useDeviceIdentity();

  // Copies locales chiffrées (une instance par montage, voir localCopies).
  const [copies] = useState(() => ({
    pending: createPendingStore(() => sessionGenRef.current),
    mirror: createMirror(() => driveFileIdRef.current, () => persistedRef.current),
    offline: createOfflineStore(() => sessionGenRef.current),
  }));
  const { pending, mirror, offline: offlineStore } = copies;

  /** Des modifications affichées ne sont pas encore sur Drive (y compris sur la copie hors ligne). */
  const hasLocalEdits = () => (hasLoadedRef.current || offlineRef.current !== null) && canonicalDoc(docRef.current) !== persistedRef.current;
  /** Miroir de l'état le plus récent (sa forme canonique est déjà connue). */
  const mirrorCurrent = () => mirror.write(currentData(), canonicalDoc(docRef.current));

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
    dispatch({ type: 'error', info });
    if (info.transient) scheduleRetry(); else clearTimeout(retryTimerRef.current);
    return info;
  };
  const clearSyncError = () => dispatch({ type: 'error-cleared' });

  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Mutex d'accès à Drive : sauvegarde auto, relecture au retour dans l'app et résolution
  // de conflit ne s'entrelacent jamais (chaque écriture fait lecture de révision puis PATCH).
  const saveMutexRef = useRef<Promise<unknown>>(Promise.resolve());
  const runExclusive = useCallback(<T,>(fn: () => Promise<T>): Promise<T> => {
    const run = () => fn();
    const next = saveMutexRef.current.then(run, run);
    saveMutexRef.current = next.catch(() => {});
    return next;
  }, []);

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
  }, []);

  /** `data` est désormais l'état de Drive (lu ou écrit) : référence des écritures et copie hors ligne. */
  const markPersisted = (data: unknown, fileId: string | null = driveFileIdRef.current, canon?: string) => {
    persistedRef.current = canon ?? canonicalize(data);
    offlineStore.remember(fileId, data);
  };
  const switchFile = (id: string) => { driveFileIdRef.current = id; setDriveFileId(id); };

  // Heure du dernier changement de l'état affiché (montrée en cas de conflit, où elle est
  // celle de la dernière modification faite ici). Sans comparaison coûteuse à chaque saisie.
  useEffect(() => { localEditedAtRef.current = new Date().toISOString(); }, [doc]);

  // --- CHARGEMENT ---
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
  }, [applyData]);

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

  // Autres fichiers les plus récents, pour les actions asynchrones.
  const otherFilesRef = useRef(otherFiles);
  otherFilesRef.current = otherFiles;

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

  const isSavingRef = useRef(false);
  useEffect(() => { isSavingRef.current = status.saving; }, [status.saving]);

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
  }, [doc, buildData, mirror]);

  // --- NOUVELLES TENTATIVES ---
  /**
   * « Réessayer » : recharge si le chargement a échoué (jamais d'écriture sans données
   * chargées), sinon relance la sauvegarde automatique, avec son contrôle de révision.
   */
  const retrySync = useCallback(() => {
    clearTimeout(retryTimerRef.current);
    const s = statusRef.current;
    if (!s.isAuthenticated || s.loading || s.sessionExpired) return;
    if (!hasLoadedRef.current || s.loadFailed) { void loadDriveDataRef.current(); return; }
    if (browserOnline()) dispatch({ type: 'online' });
    dispatch({ type: 'error-cleared' });
    setRetryTick(t => t + 1);
  }, []);
  retrySyncRef.current = retrySync;

  // Retour au premier plan : nouvel essai si la synchro est en échec PASSAGER, sinon
  // relecture de Drive (autre appareil, autre onglet) ; en arrière-plan, le miroir est écrit
  // sans attendre (le système peut fermer l'app à tout moment). Après une longue pause, la
  // première touche ou le premier clic relit Drive avant que la saisie ne parte.
  const hasLocalEditsRef = useRef(hasLocalEdits);
  hasLocalEditsRef.current = hasLocalEdits;
  const mirrorCurrentRef = useRef(mirrorCurrent);
  mirrorCurrentRef.current = mirrorCurrent;
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
  }, [retrySync]);

  // --- SAUVEGARDE AUTO ---
  const { loading: isLoadingData, sessionExpired, appOutdated, offline: isOffline } = status;
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
  }, [doc, isAuthenticated, driveFileId, isLoadingData, buildData, syncConflict, sessionExpired, appOutdated, isOffline, retryTick]);

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
    setOtherFiles([]);
    dispatch({ type: 'reset' });
    setDoc(emptyData());
    setDriveFileId(null);
    lsDel(LAST_BACKUP_MONTH_KEY);
    setLocalBackup(null);
    setUnreadableCopies([]);
  };

  // Ce que l'écran de choix affiche : la version de cet appareil est toujours l'état courant.
  const conflict = useMemo<SyncConflictView | null>(
    () => (conflictCtx ? buildConflictView(conflictCtx, buildData(), headStampRef.current, thisDevice, deviceId()) : null),
    [conflictCtx, buildData, thisDevice, deviceId],
  );

  // Actions exposées : identité stable (le corps le plus récent est toujours appelé), pour
  // que les écrans mémoïsés ne soient pas re-rendus à chaque changement de l'état de synchro.
  /** « Compris » sur la bannière : les copies définitivement illisibles sont effacées. */
  const dismissUnreadableCopies = () => { dropLostCopies(unreadableCopies); setUnreadableCopies([]); };
  const latest = useRef({ resolveConflict, loadConflictRemote, compareDuplicate, closeDuplicateComparison, dismissDuplicate, restoreLocalBackup, dismissLocalBackup, dismissUnreadableCopies, flushPendingChanges, hasPendingEdits, forgetOfflineCopy, hasUnsyncedChanges, resetData });
  latest.current = { resolveConflict, loadConflictRemote, compareDuplicate, closeDuplicateComparison, dismissDuplicate, restoreLocalBackup, dismissLocalBackup, dismissUnreadableCopies, flushPendingChanges, hasPendingEdits, forgetOfflineCopy, hasUnsyncedChanges, resetData };
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
  }), [loadDriveDataStable, loadDemoData, retrySync]);

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
