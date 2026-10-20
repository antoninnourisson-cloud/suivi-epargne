// État applicatif et synchronisation avec le fichier Drive.
//
// Tout le document vit dans UN état (`doc`) : ajouter un champ ne demande plus que son type,
// sa valeur par défaut (src/lib/schema.ts) et son interface. Les setters par champ restent
// exposés pour les écrans.
import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { lsDel, lsGet, lsSet, lsGetJSON, lsSetJSON } from '../lib/storage';
import { tracksDeposits, totalFixedCharges } from '../lib/finance';
import { applyMovement, balanceChangeMovements, canWithdrawOwn } from '../lib/accountOps';
import { migrate, canonicalize, emptyData, isFromNewerApp, withoutDeviceOnlyFields, validateImport, APP_SCHEMA_VERSION } from '../lib/schema';
import { readWriteStamp, withWriteStamp, describeDevice, stampDevice, stampIsFromDevice, type WriteStamp } from '../lib/writeStamp';
import { classifySyncFailure, type FailureLike, type SyncErrorInfo } from '../lib/syncErrors';
import { sealJSON, openJSON } from '../services/localVault';
import { setAsideVersion, getSetAside, removeSetAside, listSetAside, clearSetAside, storeBeforeSetAside, type SetAsideVersion } from '../services/setAsideVersions';
import { downloadJSON } from '../services/fileDownload';
import { localTodayISO } from '../lib/dates';
import { GlobalAppData, SavingsAccount, AccountMovement, PortfolioSnapshot, ExpenseSnapshot, WorkBenefits } from '../types';
import {
  findConfigFiles, createConfigFile, readConfigFile, updateConfigFile, getFileRevision, getFileMeta,
  setOnAuthLost, ConflictError, ConcurrentWriteError, ApiError, writeMonthlyBackup, listBackups, DriveBackup,
  fetchRevisionContent, type DriveFileInfo, type FileMeta,
} from '../services/googleDriveService';

// Miroir local des modifications PAS ENCORE confirmées sur Drive (filet anti-crash). Effacé
// dès que Drive est à jour : les données ne restent pas en clair dans le navigateur au-delà
// du nécessaire.
const BACKUP_KEY = 'suivi_epargne_backup';
// Quarantaine : copie de modifications qui n'ont JAMAIS atteint Drive, détectée au
// démarrage. Distincte du miroir, qui est réécrit en continu : sans cette séparation, la
// première saisie suivant l'ouverture détruisait la trace des modifications non
// synchronisées.
const PENDING_KEY = 'suivi_epargne_pending';
// Annonce des sauvegardes aux autres onglets (l'événement `storage` ne se déclenche que
// dans les AUTRES onglets).
const LAST_SAVE_KEY = 'suivi_epargne_last_save';
// Clé Gemini : propre à l'appareil, jamais dans le fichier Drive ni dans un export.
const GEMINI_KEY = 'gemini_api_key';
const LAST_BACKUP_MONTH_KEY = 'last_drive_backup_month';
// Identifiant aléatoire de cet appareil (signature d'écriture : « cet appareil » ou un autre).
const DEVICE_ID_KEY = 'pecule_device_id';
// Fichiers de données en double déjà signalés et laissés tels quels (id@date de modification).
const DUPLICATE_DISMISSED_KEY = 'pecule_duplicate_dismissed';
// Dernier état CONFIRMÉ sur Drive (chargé ou écrit), chiffré (voir localVault) : l'app installée
// s'ouvre hors ligne sur ces données au lieu d'attendre le réseau. Effacé à la déconnexion.
const OFFLINE_KEY = 'pecule_offline_copy';

type StoredSnapshot = { savedAt: string; fileId?: string; data: GlobalAppData };
/** Copie hors ligne : `savedAt` = dernière fois que cet appareil a vu Drive à jour. */
type OfflineCopy = { savedAt: string; fileId: string; data: unknown };
/** Contenu comparable sans l'écran affiché (changer d'écran hors ligne n'est pas une modification). */
const canonicalWithoutView = (data: unknown): string =>
  data && typeof data === 'object' ? canonicalize({ ...(data as Record<string, unknown>), lastView: undefined }) : '';
type Doc = GlobalAppData;
type Config = GlobalAppData['config'];
type Updater<T> = T | ((prev: T) => T);
const resolve = <T,>(u: Updater<T>, prev: T): T => (typeof u === 'function' ? (u as (p: T) => T)(prev) : u);


const localMonthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

// Nouvelles tentatives après un échec PASSAGER (délai dépassé, Drive saturé…) alors que le
// navigateur se croit en ligne : il n'émettra jamais l'événement `online`. Un échec durable
// (droits, espace plein, fichier illisible) n'est jamais retenté seul (voir lib/syncErrors).
const RETRY_DELAYS_MS = [5_000, 30_000, 120_000];
const browserOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;
// Relecture de la révision Drive au retour dans l'app : au plus toutes les 30 s ; et, après
// 5 min sans contrôle, dès la première touche ou le premier clic (avant la première écriture).
const REMOTE_CHECK_THROTTLE_MS = 30_000;
const LONG_PAUSE_MS = 5 * 60_000;

export type SyncFailure = 'conflict' | 'session' | 'offline' | 'notfound' | 'error';
/** Classe une erreur de Drive en une seule catégorie, la même pour tous les chemins. */
const classifySyncError = (err: unknown): SyncFailure => {
  if (err instanceof ConflictError) return 'conflict';
  if (err instanceof Error && err.message === 'SESSION_EXPIRED') return 'session';
  if (err instanceof ApiError && err.status === 404) return 'notfound';
  // fetch échoue par TypeError quand la requête ne peut pas partir (réseau coupé, DNS,
  // délai) : navigator.onLine n'est pas toujours fiable (portail captif).
  if (err instanceof TypeError) return 'offline';
  return 'error';
};
const failureOf = (err: unknown): FailureLike => (typeof err === 'object' && err !== null ? err as FailureLike : {});

/** Drive a changé depuis le dernier chargement alors que la révision de référence était inconnue. */
class RemoteChanged extends Error {
  meta: FileMeta;
  raw: unknown;
  constructor(meta: FileMeta, raw: unknown) { super('REMOTE_CHANGED'); this.name = 'RemoteChanged'; this.meta = meta; this.raw = raw; }
}
/** Écriture abandonnée avant de partir (conflit ouvert, autre fichier) : pas une panne. */
class SaveSkipped extends Error { constructor() { super('SAVE_SKIPPED'); this.name = 'SaveSkipped'; } }

/** Une des deux versions montrées lors d'un conflit. */
export interface ConflictVersion {
  data: GlobalAppData;
  /** Date d'enregistrement (ISO), si connue. */
  savedAt: string | null;
  /** Appareil, en clair, si connu (« téléphone Android (Chrome) »). */
  device: string | null;
  /** Écrite depuis cet appareil (dans un autre onglet, par exemple). */
  fromThisDevice: boolean;
}

/** Ce que l'écran de choix affiche. */
export interface SyncConflictView {
  /** 'conflict' : modifiées des deux côtés ; 'duplicate' : deux fichiers de données sur Drive. */
  kind: 'conflict' | 'duplicate';
  local: ConflictVersion;
  /** null tant que l'autre version n'a pas été relue (voir `remoteStatus`). */
  remote: ConflictVersion | null;
  remoteStatus: 'loading' | 'ready' | 'error';
  /** L'autre version vient d'une version plus récente de Pécule : elle ne peut pas être écrasée d'ici. */
  remoteFromNewerApp: boolean;
}

/** Résultat d'un import : `undoId`, la version mise de côté juste avant (pour « Annuler »), si elle a pu l'être. */
export interface ImportOutcome { ok: boolean; undoId?: string }

export type ConflictChoice = 'local' | 'remote';
export type ConflictResolution = 'done' | 'copy-failed' | 'unavailable';

/**
 * Conflit en attente du choix de l'utilisateur. `headIs` : ce que porte la tête du fichier
 * Drive (`headRevision`) : notre version ('local', après une course d'écriture) ou l'autre
 * ('remote'). `source` : où relire l'autre version (révision précise, ou tête d'un fichier).
 */
type ConflictCtx = {
  kind: 'conflict' | 'duplicate';
  fileId: string;
  headRevision: string | null;
  headIs: 'local' | 'remote';
  source: { fileId: string; revisionId?: string };
  remoteRaw: unknown;
  remoteSavedAt: string | null;
  remoteStatus: 'loading' | 'ready' | 'error';
  localSavedAt: string | null;
  /** Version qui n'est pas en tête de Drive, gardée en quarantaine jusqu'au choix (voir openConflict). */
  offDrive?: unknown;
};
type ConflictInit = Omit<ConflictCtx, 'remoteStatus' | 'localSavedAt' | 'offDrive'> & { localSavedAt?: string | null };

type SaveResult = 'saved' | 'nothing' | 'failed';
const duplicateKey = (f: DriveFileInfo) => `${f.id}@${f.modifiedTime ?? ''}`;

export const usePortfolioData = (isAuthenticated: boolean) => {
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [driveFileId, setDriveFileId] = useState<string | null>(null);

  // État de synchronisation exposé à l'UI (bannières).
  const [syncError, setSyncError] = useState(false);
  // Panne passagère (nouvel essai automatique) ou durable (message clair, on attend l'utilisateur).
  const [syncErrorInfo, setSyncErrorInfo] = useState<SyncErrorInfo | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  // Le fichier vient d'une version plus récente de l'app : lecture seule jusqu'à la mise à jour.
  const [appOutdated, setAppOutdated] = useState(false);
  // Hors ligne au sens large : navigateur hors ligne, ou requête Drive impossible (délai
  // dépassé, DNS…). Dans le second cas, de nouvelles tentatives sont programmées.
  const [isOffline, setIsOffline] = useState(!browserOnline());
  // Le chargement Drive a échoué : rien n'est chargé, donc rien ne doit être écrit.
  const [loadFailed, setLoadFailed] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [localBackup, setLocalBackup] = useState<StoredSnapshot | null>(null);
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
  const statusRef = useRef({ isOffline, syncError, syncErrorInfo, syncConflict, sessionExpired, appOutdated, loadFailed, isLoadingData, localBackup, isAuthenticated });
  statusRef.current = { isOffline, syncError, syncErrorInfo, syncConflict, sessionExpired, appOutdated, loadFailed, isLoadingData, localBackup, isAuthenticated };

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

  // --- DOCUMENT ---
  const [doc, setDoc] = useState<Doc>(emptyData);
  const docRef = useRef(doc);
  docRef.current = doc;

  // --- APPAREIL ---
  const thisDevice = useMemo(() => describeDevice(typeof navigator === 'undefined' ? '' : navigator.userAgent), []);
  const deviceIdRef = useRef('');
  const deviceId = () => {
    if (!deviceIdRef.current) {
      let id = lsGet(DEVICE_ID_KEY);
      if (!id) { id = crypto.randomUUID(); lsSet(DEVICE_ID_KEY, id); }
      deviceIdRef.current = id;
    }
    return deviceIdRef.current;
  };
  const makeStamp = (): WriteStamp => ({ at: new Date().toISOString(), device: thisDevice, deviceId: deviceId() });

  const [geminiApiKey, setGeminiKeyState] = useState<string>(() => lsGet(GEMINI_KEY) || '');
  const setGeminiApiKey = useCallback((k: string) => {
    setGeminiKeyState(k);
    if (k) lsSet(GEMINI_KEY, k); else lsDel(GEMINI_KEY);
  }, []);
  /** Une ancienne version gardait la clé dans le fichier Drive : on la récupère sur l'appareil. */
  const adoptLegacyGeminiKey = (raw: unknown) => {
    const k = (raw as { config?: { geminiApiKey?: string } } | null)?.config?.geminiApiKey;
    if (k && !lsGet(GEMINI_KEY)) setGeminiApiKey(k);
  };

  const [lastView, setLastViewState] = useState<string>(() => lsGet('last_view') || 'dashboard');
  const lastViewRef = useRef(lastView);
  // Persiste la vue localement SANS déclencher de réécriture Drive à chaque changement d'onglet.
  const setLastView = useCallback((v: string) => {
    lsSet('last_view', v);
    lastViewRef.current = v;
    setLastViewState(v);
  }, []);

  // Ce qui part sur Drive : le document, sans secret d'appareil, avec la vue courante.
  const buildData = useCallback((): GlobalAppData => ({
    ...withoutDeviceOnlyFields(doc), schemaVersion: APP_SCHEMA_VERSION, lastView: lastViewRef.current,
  }), [doc]);
  /** Même chose, pour l'état le plus récent (écouteurs, fin d'écriture, déconnexion). */
  const currentData = (): GlobalAppData => ({
    ...withoutDeviceOnlyFields(docRef.current), schemaVersion: APP_SCHEMA_VERSION, lastView: lastViewRef.current,
  });
  /** Des modifications affichées ne sont pas encore sur Drive (y compris sur la copie hors ligne). */
  const hasLocalEdits = () => (hasLoadedRef.current || offlineRef.current !== null) && canonicalize(currentData()) !== persistedRef.current;

  // Miroir local chiffré : seule la dernière demande est écrite (un chiffrement plus lent
  // ne remet jamais une version plus ancienne par-dessus), et seulement si Drive n'a pas
  // rattrapé entre-temps.
  const mirrorSeqRef = useRef(0);
  const writeMirror = (data: GlobalAppData) => {
    const seq = ++mirrorSeqRef.current;
    const snapshot: StoredSnapshot = { savedAt: new Date().toISOString(), fileId: driveFileIdRef.current ?? undefined, data };
    const wanted = () => seq === mirrorSeqRef.current && canonicalize(data) !== persistedRef.current;
    // Stockage plein : les versions mises de côté les plus anciennes lui laissent la place.
    sealJSON(snapshot).then(sealed => {
      if (wanted()) return storeBeforeSetAside(BACKUP_KEY, sealed, wanted);
    }).catch(() => { /* filet de secours seulement */ });
  };
  // --- QUARANTAINE (une seule place) ---
  // Écritures et effacements passent l'un après l'autre (le chiffrement est asynchrone).
  const pendingChainRef = useRef<Promise<unknown>>(Promise.resolve());
  const pendingOp = <T,>(fn: () => Promise<T>): Promise<T> => {
    const next = pendingChainRef.current.then(fn, fn);
    pendingChainRef.current = next.catch(() => {});
    return next;
  };
  /** Contenu actuel de la quarantaine (`snap` null s'il est illisible). */
  const readPending = async (): Promise<{ stored: string; snap: StoredSnapshot | null } | null> => {
    const stored = lsGet(PENDING_KEY);
    if (!stored) return null;
    try {
      const snap = await openJSON<StoredSnapshot>(stored);
      return { stored, snap: snap && typeof snap === 'object' && snap.data ? snap : null };
    } catch { return { stored, snap: null }; }
  };
  const sameCopy = (a: { fileId?: string; data: unknown }, b: { fileId?: string; data: unknown }) =>
    (a.fileId ?? null) === (b.fileId ?? null) && canonicalize(a.data) === canonicalize(b.data);
  /** Met de côté (30 jours, chiffrée) une copie jamais envoyée, sauf si elle y est déjà. Lève en cas d'échec. */
  const setAsideUnsent = async (snap: StoredSnapshot) => {
    const kept = await listSetAside(snap.fileId);
    if (kept.some(e => sameCopy(e, snap))) return;
    const at = snap.savedAt && !Number.isNaN(Date.parse(snap.savedAt))
      ? ` (du ${new Date(snap.savedAt).toLocaleString('fr-FR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })})` : '';
    await setAsideVersion({ reason: 'unsent', label: `Modifications jamais envoyées sur Drive${at}`, savedAt: snap.savedAt ?? null, fileId: snap.fileId, data: snap.data });
  };
  /**
   * Écrit `snap` dans la quarantaine, qui n'a qu'une place. Une autre copie qui s'y trouve
   * (autres données, ou autre fichier Drive) n'est jamais écrasée sans avoir d'abord été mise
   * de côté (« Versions mises de côté », 30 jours). Exception : une copie d'un AUTRE fichier
   * que celui ouvert (`openFileId`) reste en quarantaine, seul endroit d'où elle sera proposée
   * à son fichier ; c'est alors la nouvelle copie, celle du fichier ouvert, qui est mise de
   * côté (visible tout de suite). Si la mise de côté échoue, la copie la plus récente gagne.
   */
  const replacePending = (snap: StoredSnapshot, openFileId: string | null): Promise<boolean> => {
    const gen = sessionGenRef.current;
    return pendingOp(async () => {
      const sealed = await sealJSON(snap);
      const prev = (await readPending())?.snap ?? null;
      if (gen !== sessionGenRef.current) return false; // déconnexion entre-temps
      if (prev && !sameCopy(prev, snap)) {
        const keepPrev = !!prev.fileId && prev.fileId !== openFileId && snap.fileId === openFileId;
        try {
          await setAsideUnsent(keepPrev ? snap : prev);
          if (keepPrev) return true;
        } catch (err) { console.warn('Copie jamais envoyée non mise de côté', err); }
        if (gen !== sessionGenRef.current) return false;
      }
      return storeBeforeSetAside(PENDING_KEY, sealed);
    });
  };
  /** Efface la quarantaine si elle contient encore `data` : une autre copie, elle, y reste. */
  const dropPendingIf = (data: unknown): Promise<void> => pendingOp(async () => {
    const prev = await readPending();
    if (!prev?.snap || canonicalize(prev.snap.data) !== canonicalize(data)) return;
    if (lsGet(PENDING_KEY) === prev.stored) lsDel(PENDING_KEY);
  });
  /** Copie chiffrée d'une version qui n'est pas en tête de Drive, gardée jusqu'au choix de l'utilisateur. */
  const keepPending = (fileId: string, data: unknown) => {
    replacePending({ savedAt: new Date().toISOString(), fileId, data: data as GlobalAppData }, fileId)
      .catch(() => { /* reste en mémoire et dans le miroir */ });
  };

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
    setSyncErrorInfo(info);
    setSyncError(true);
    if (info.transient) scheduleRetry(); else clearTimeout(retryTimerRef.current);
    return info;
  };
  const clearSyncError = () => { setSyncError(false); setSyncErrorInfo(null); };

  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Garde-fou : tant qu'un chargement Drive n'a pas réussi, aucune sauvegarde (évite
  // d'écraser un bon fichier avec un état vide).
  const hasLoadedRef = useRef(false);
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
    setOnAuthLost(() => setSessionExpired(true));
    return () => setOnAuthLost(null);
  }, []);

  useEffect(() => {
    const on = () => {
      resetRetry();
      setIsOffline(false);
      // Chargement raté hors ligne : le réseau revient, on recharge.
      if (statusRef.current.loadFailed && statusRef.current.syncErrorInfo?.transient !== false) retrySyncRef.current();
    };
    const off = () => setIsOffline(true);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); clearTimeout(retryTimerRef.current); };
  }, []);

  /** Remplace tout le document (chargement, import, restauration). */
  const applyData = useCallback((raw: unknown) => {
    adoptLegacyGeminiKey(raw);
    setDoc(withoutDeviceOnlyFields(migrate(raw)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Copie hors ligne : seule la dernière demande est écrite, et jamais après une déconnexion.
  const offlineSeqRef = useRef(0);
  const rememberDriveState = (fileId: string | null, data: unknown) => {
    if (!fileId) return;
    const seq = ++offlineSeqRef.current;
    const gen = sessionGenRef.current;
    const copy: OfflineCopy = { savedAt: new Date().toISOString(), fileId, data };
    sealJSON(copy).then(sealed => {
      if (seq === offlineSeqRef.current && gen === sessionGenRef.current) lsSet(OFFLINE_KEY, sealed);
    }).catch(() => { /* pas de copie hors ligne : l'app attendra le réseau */ });
  };
  /** `data` est désormais l'état de Drive (lu ou écrit) : référence des écritures et copie hors ligne. */
  const markPersisted = (data: unknown, fileId: string | null = driveFileIdRef.current) => {
    persistedRef.current = canonicalize(data);
    rememberDriveState(fileId, data);
  };
  const switchFile = (id: string) => { driveFileIdRef.current = id; setDriveFileId(id); };

  // Heure du dernier changement de l'état affiché (montrée en cas de conflit, où elle est
  // celle de la dernière modification faite ici). Sans comparaison coûteuse à chaque saisie.
  useEffect(() => { localEditedAtRef.current = new Date().toISOString(); }, [doc]);

  // --- CHARGEMENT ---
  type StoredCopies = (readonly [string, string | null])[];
  /**
   * Copies locales jamais envoyées (quarantaine, miroir) qui diffèrent de `reference` (contenu
   * canonique de Drive) : la plus récente, avec celles de `candidates`, est proposée (bannière
   * « sauvegarde locale ») et gardée en quarantaine. `clearSynced` : une copie identique à
   * Drive est effacée (elle y est déjà).
   */
  const proposeUnsynced = async (fileId: string, reference: string, candidates: StoredSnapshot[], storedCopies: StoredCopies, clearSynced: boolean) => {
    const found = [...candidates];
    for (const [key, stored] of storedCopies) {
      if (!stored) continue;
      try {
        const snap = await openJSON<StoredSnapshot>(stored);
        // Une copie rattachée à un AUTRE fichier Drive appartient à un autre compte : ni
        // proposée, ni effacée.
        if (snap.fileId && snap.fileId !== fileId) continue;
        if (canonicalize(snap.data) === reference) {
          if (clearSynced && lsGet(key) === stored) lsDel(key); // déjà sur Drive
          continue;
        }
        found.push(snap);
      } catch { /* copie illisible : laissée en place */ }
    }
    const newest = found.reduce<StoredSnapshot | null>((best, s) => (!best || (s.savedAt || '') > (best.savedAt || '') ? s : best), null);
    if (newest) {
      setLocalBackup(newest);
      try { await replacePending({ ...newest, fileId }, fileId); } catch { /* reste proposée en mémoire */ }
    }
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
    const stored = lsGet(OFFLINE_KEY);
    if (!stored) return false;
    let copy: OfflineCopy;
    try { copy = await openJSON<OfflineCopy>(stored); } catch { return false; }
    if (!copy || typeof copy.fileId !== 'string' || typeof copy.savedAt !== 'string' || !copy.data || typeof copy.data !== 'object') return false;
    const base = canonicalize(copy.data);
    // Saisies jamais envoyées : proposées comme au chargement normal, et mises en quarantaine
    // AVANT qu'une nouvelle saisie ne réécrive le miroir.
    await proposeUnsynced(copy.fileId, base, [], storedCopies, false);
    if (gen !== sessionGenRef.current || hasLoadedRef.current || offlineRef.current) return !!offlineRef.current;
    applyData(copy.data);
    setAppOutdated(isFromNewerApp(copy.data));
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
  const loadDriveData = useCallback(async (opts?: { keepUnsynced?: boolean; startOffline?: boolean }): Promise<boolean> => {
    const keepUnsynced = opts?.keepUnsynced !== false;
    const gen = sessionGenRef.current;
    const offline = offlineRef.current;
    // Relevé AVANT toute attente : le miroir peut être effacé dès que l'état affiché
    // redevient celui de Drive. (Les saisies faites sur la copie hors ligne sont traitées à part.)
    const inMemory: StoredSnapshot | null = keepUnsynced && !offline && hasLocalEdits()
      ? { savedAt: new Date().toISOString(), fileId: driveFileIdRef.current ?? undefined, data: currentData() }
      : null;
    const storedCopies: StoredCopies = keepUnsynced ? [PENDING_KEY, BACKUP_KEY].map(key => [key, lsGet(key)] as const) : [];
    clearTimeout(retryTimerRef.current);
    if (!browserOnline() || opts?.startOffline) {
      // Le navigateur se sait hors ligne (ou le jeton vient d'échouer faute de réseau,
      // `startOffline`) : rien à attendre. Le chargement reprend au retour du réseau
      // (événement `online`) ou au prochain essai programmé.
      setIsOffline(true);
      setLoadFailed(true);
      if (!offline) await openOfflineCopy(gen, storedCopies);
      scheduleRetry(); // sans effet si le navigateur est hors ligne
      return false;
    }
    setIsLoadingData(true);
    setSessionExpired(false);
    setConflict(null);
    clearSyncError();
    setLoadFailed(false);
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
        try { await replacePending({ savedAt: new Date().toISOString(), fileId: offline!.fileId, data: local! }, fileId); }
        catch { /* le miroir, rattaché au même fichier, reste en place */ }
        if (gen !== sessionGenRef.current) return false;
      }
      setAppOutdated(isFromNewerApp(raw));
      if (!keepLocal) {
        applyData(raw);
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
      if (browserOnline()) setIsOffline(false);
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
      setLoadFailed(true);
      const kind = classifySyncError(error);
      if (kind === 'session') setSessionExpired(true);
      else if (kind === 'offline' && (offlineRef.current || await openOfflineCopy(gen, storedCopies))) {
        // Réseau ou Drive injoignable : la dernière copie connue reste affichée, nouvel essai
        // programmé (ou au retour du réseau).
        setIsOffline(true);
        scheduleRetry();
      } else failSync(error);
      return false;
    } finally {
      setIsLoadingData(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyData, setLastView]);

  /** Mode démo (développement uniquement) : données fictives en mémoire, aucune écriture Drive. */
  const loadDemoData = useCallback((raw: unknown) => {
    applyData(raw);
    markPersisted(raw, null); // aucun fichier Drive : pas de copie hors ligne
    hasLoadedRef.current = true;
    setIsLoadingData(false);
    setDataShown(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyData]);

  // --- SETTERS PAR CHAMP ---
  const setters = useMemo(() => {
    const top = <K extends keyof Doc>(k: K) => (u: Updater<Doc[K]>) => setDoc(d => ({ ...d, [k]: resolve(u, d[k]) }));
    const cfg = <K extends keyof Config>(k: K) => (u: Updater<Config[K]>) => setDoc(d => ({ ...d, config: { ...d.config, [k]: resolve(u, d.config[k]) } }));
    return {
      setAccounts: top('accounts') as (u: Updater<SavingsAccount[]>) => void,
      setExpenses: top('expenses') as (u: Updater<Doc['expenses']>) => void,
      setHistory: top('history') as (u: Updater<PortfolioSnapshot[]>) => void,
      setExpensesHistory: top('expensesHistory') as (u: Updater<ExpenseSnapshot[]>) => void,
      setGoals: top('goals') as (u: Updater<NonNullable<Doc['goals']>>) => void,
      setPayslips: top('payslips') as (u: Updater<NonNullable<Doc['payslips']>>) => void,
      setRecurringMovements: top('recurringMovements') as (u: Updater<NonNullable<Doc['recurringMovements']>>) => void,
      setSubscriptions: top('subscriptions') as (u: Updater<NonNullable<Doc['subscriptions']>>) => void,
      setDonations: top('donations') as (u: Updater<NonNullable<Doc['donations']>>) => void,
      setPayChecklist: top('payChecklist'),
      setParentalRestitution: top('parentalRestitution'),
      setActivePayslipId: top('activePayslipId'),
      setFiscalConfig: top('fiscalConfig') as (u: Updater<NonNullable<Doc['fiscalConfig']>>) => void,
      setWorkBenefits: top('workBenefits') as (u: Updater<NonNullable<Doc['workBenefits']>>) => void,
      /**
       * Modifie les avantages à partir de leur état le plus récent (seuls les champs touchés
       * changent), et garde la copie du Navigo dans config (ancien format, encore lu).
       */
      updateWorkBenefits: (update: (prev: WorkBenefits) => WorkBenefits) => setDoc(d => {
        const workBenefits = update(d.workBenefits!);
        const { navigo } = workBenefits;
        return {
          ...d, workBenefits,
          config: navigo.active ? { ...d.config, navigoBase: navigo.basePrice, navigoRate: navigo.refundRate } : d.config,
        };
      }),
      setGrossAnnual: cfg('grossAnnual'),
      setLeisureBudget: cfg('leisureBudget'),
      setProjectSavings: cfg('projectSavings'),
      setNavigoBase: cfg('navigoBase') as (u: Updater<number>) => void,
      setNavigoRate: cfg('navigoRate') as (u: Updater<number>) => void,
      setTaxRateManual: cfg('taxRateManual'),
      setExtraMonthlyIncome: cfg('extraMonthlyIncome'),
      setPickerApiKey: cfg('pickerApiKey') as (u: Updater<string>) => void,
      setPaydayDay: cfg('paydayDay'),
      setPaydayAmount: cfg('paydayAmount'),
      setSavingsSplit: cfg('savingsSplit'),
      setSavingsSplitFrom: cfg('savingsSplitFrom'),
      setTrackingStartDate: cfg('trackingStartDate'),
      /** Modifie plusieurs réglages d'un coup. */
      patchConfig: (patch: Partial<Config>) => setDoc(d => ({ ...d, config: { ...d.config, ...patch } })),
    };
  }, []);

  // --- VERSIONS MISES DE CÔTÉ ---
  /** Met l'état affiché de côté (30 jours, chiffré) avant de le remplacer. Lève si c'est impossible. */
  const setAsideCurrent = (reason: SetAsideVersion['reason'], label: string) =>
    setAsideVersion({ reason, label, savedAt: new Date().toISOString(), fileId: driveFileIdRef.current ?? undefined, data: currentData() });

  // --- EXPORT / IMPORT ---
  const exportData = useCallback(() => {
    downloadJSON(`pecule-${localTodayISO()}.json`, buildData());
  }, [buildData]);

  /**
   * Import d'un fichier local. Le fichier est contrôlé avant de remplacer quoi que ce soit, et
   * les données actuelles sont d'abord mises de côté (récupérables 30 jours).
   * `requireSetAside` (restauration de la sauvegarde de secours, qui le promet) : si elles ne
   * peuvent pas l'être, rien n'est remplacé et l'erreur SET_ASIDE_FAILED est levée. Sinon
   * (import d'un fichier), la mise de côté est tentée sans bloquer l'import.
   * Renvoie l'identifiant de la version mise de côté (`undoId`) : « Annuler » la remet
   * (`recoverSetAside`).
   */
  const importData = useCallback(async (file: File, opts?: { requireSetAside?: boolean }): Promise<ImportOutcome> => {
    try {
      const parsed: unknown = JSON.parse(await file.text());
      const errors = validateImport(parsed);
      if (errors.length > 0) { console.error('Import refusé', errors); return { ok: false }; }
      let undoId: string | undefined;
      if (hasLoadedRef.current || offlineRef.current) {
        try {
          undoId = await (opts?.requireSetAside
            ? setAsideCurrent('restore', 'Vos données avant le retour à une copie de secours')
            : setAsideCurrent('import', 'Vos données avant un import'));
        } catch (err) {
          if (opts?.requireSetAside) throw new Error('SET_ASIDE_FAILED');
          console.warn('Données actuelles non mises de côté', err);
        }
      }
      const keepPicker = docRef.current.config.pickerApiKey;
      applyData(parsed);
      setDoc(d => ({ ...d, config: { ...d.config, pickerApiKey: d.config.pickerApiKey || keepPicker } }));
      return { ok: true, undoId };
    } catch (e) {
      if (e instanceof Error && e.message === 'SET_ASIDE_FAILED') throw e; // rien n'a été remplacé
      console.error('Import échoué', e);
      return { ok: false };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const onSaved = (fileId: string, revision: string, saved: GlobalAppData, stamp: WriteStamp) => {
    attemptsRef.current = [];
    driveRevisionRef.current = revision;
    markPersisted(saved, fileId);
    headStampRef.current = stamp;
    headSavedAtRef.current = stamp.at;
    lastRemoteCheckRef.current = Date.now();
    announceSave(fileId, revision);
    clearSyncError();
    resetRetry();
    if (browserOnline()) setIsOffline(false);
    setLastSavedAt(new Date());
    // Le miroir n'est effacé que si Drive a TOUT rattrapé : une saisie faite pendant cette
    // écriture n'est pas encore sur Drive, son miroir est réécrit tout de suite.
    const current = currentData();
    if (canonicalize(current) === persistedRef.current) lsDel(BACKUP_KEY); else writeMirror(current);
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
    if (remote === canonicalize(currentData())) {
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
      if (c.offDrive !== undefined) void dropPendingIf(c.offDrive);
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
      if (classifySyncError(err) === 'session') setSessionExpired(true);
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
    if (offDrive !== undefined) keepPending(init.fileId, offDrive);
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
    } else if (kind === 'session') setSessionExpired(true);
    else if (kind === 'offline') { setIsOffline(true); scheduleRetry(); }
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
        setSyncErrorInfo({ reason: 'server', transient: true });
        setSyncError(true);
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
    const skip = (r: SaveResult) => { setIsSaving(false); return r; };
    if (!fileId || !hasLoadedRef.current || conflictOpen() || s.sessionExpired || s.appOutdated) return skip('failed');
    const data = currentData();
    if (canonicalize(data) === persistedRef.current) return skip('nothing');
    const stamp = makeStamp();
    setIsSaving(true);
    try {
      const newRevision = await runExclusive(async () => {
        if (fileId !== driveFileIdRef.current || conflictOpen()) throw new SaveSkipped();
        if (canonicalize(data) === persistedRef.current) return null; // déjà écrite entre-temps
        if (!driveRevisionRef.current) await ensureBaseRevision(fileId);
        const base = driveRevisionRef.current;
        const canon = canonicalize(data);
        attemptsRef.current = [
          ...attemptsRef.current.filter(a => a.fileId === fileId && a.base === base && a.canon !== canon),
          { fileId, base, canon },
        ].slice(-5);
        return updateConfigFile(fileId, withWriteStamp(data, stamp), driveRevisionRef.current);
      });
      if (newRevision === null) return 'nothing';
      onSaved(fileId, newRevision, data, stamp);
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
      setIsSaving(false);
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
  const resolveConflict = useCallback(async (choice: ConflictChoice, opts?: { withoutCopy?: boolean }): Promise<ConflictResolution> => {
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
    const dismissDuplicate = () => {
      const other = otherFiles.find(f => f.id === c.source.fileId);
      if (other) lsSetJSON(DUPLICATE_DISMISSED_KEY, [...lsGetJSON<string[]>(DUPLICATE_DISMISSED_KEY, []), duplicateKey(other)].slice(-20));
      setOtherFiles(prev => prev.filter(f => f.id !== c.source.fileId));
    };
    if (choice === 'local') {
      if (duplicate) dismissDuplicate();
      else {
        if (c.headIs === 'remote') {
          // La sauvegarde auto réécrit notre version par-dessus la tête relue, avec contrôle.
          driveRevisionRef.current = c.headRevision;
          markPersisted(c.remoteRaw);
        }
        // La quarantaine ne perd que la copie de CE conflit (une copie locale proposée y reste).
        if (c.offDrive !== undefined) void dropPendingIf(c.offDrive);
      }
    } else {
      // Abandon explicite des modifications de cet appareil (mises de côté ci-dessus).
      mirrorSeqRef.current += 1;
      if (c.offDrive !== undefined) void dropPendingIf(c.offDrive);
      lsDel(BACKUP_KEY);
      if (!duplicate && c.headIs === 'remote') {
        driveRevisionRef.current = c.headRevision;
        markPersisted(c.remoteRaw);
      }
      // Sinon (course d'écriture, autre fichier) la sauvegarde auto écrit cette version en
      // tête du fichier ouvert, avec contrôle de révision.
      setAppOutdated(isFromNewerApp(c.remoteRaw));
      applyData(c.remoteRaw);
      if (duplicate) dismissDuplicate();
    }
    setConflict(null);
    clearSyncError();
    return 'done';
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyData, otherFiles]);

  /** Relance la lecture de l'autre version (bouton « Réessayer » de l'écran de choix). */
  const loadConflictRemoteRef = useRef(loadConflictRemote);
  loadConflictRemoteRef.current = loadConflictRemote;
  const retryConflictLoad = useCallback(() => { void loadConflictRemoteRef.current(); }, []);

  /** Compare le fichier ouvert à l'autre fichier de données trouvé sur Drive. */
  const compareDuplicate = useCallback(() => {
    const other = otherFiles[0];
    const fileId = driveFileIdRef.current;
    if (!other || !fileId || conflictRef.current) return;
    openConflict({
      kind: 'duplicate', fileId, headRevision: driveRevisionRef.current, headIs: 'local',
      source: { fileId: other.id }, remoteRaw: undefined, remoteSavedAt: other.modifiedTime ?? null,
      localSavedAt: headSavedAtRef.current,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [otherFiles]);
  /** Ferme la comparaison d'un doublon sans rien choisir (un vrai conflit, lui, reste ouvert). */
  const closeDuplicateComparison = useCallback(() => {
    if (conflictRef.current?.kind === 'duplicate') setConflict(null);
  }, []);
  /** « Ignorer » le doublon : plus signalé tant qu'il n'est pas modifié. */
  const dismissDuplicate = useCallback(() => {
    const other = otherFiles[0];
    if (!other) return;
    lsSetJSON(DUPLICATE_DISMISSED_KEY, [...lsGetJSON<string[]>(DUPLICATE_DISMISSED_KEY, []), duplicateKey(other)].slice(-20));
    setOtherFiles(prev => prev.slice(1));
  }, [otherFiles]);

  // La quarantaine n'est effacée que si elle contient encore cette copie (une copie de
  // conflit ou d'un autre fichier a pu prendre sa place entre-temps).
  const restoreLocalBackup = useCallback(() => {
    if (!localBackup) return;
    applyData(localBackup.data);
    void dropPendingIf(localBackup.data);
    setLocalBackup(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localBackup, applyData]);

  const dismissLocalBackup = useCallback(() => {
    if (localBackup) void dropPendingIf(localBackup.data);
    setLocalBackup(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localBackup]);

  const isSavingRef = useRef(false);
  useEffect(() => { isSavingRef.current = isSaving; }, [isSaving]);

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
        return !hasLoadedRef.current || isSavingRef.current || hasLocalEdits() || conflictOpen() || s.sessionExpired || s.isOffline || s.appOutdated || s.isLoadingData;
      };
      if (busy()) return;
      const remote: unknown = await readConfigFile(fileId);
      if (busy() || fileId !== driveFileIdRef.current) return;
      // Fichier écrit par une version plus récente : lecture seule, comme au chargement.
      setAppOutdated(isFromNewerApp(remote));
      driveRevisionRef.current = String(revision);
      markPersisted(remote);
      headStampRef.current = readWriteStamp(remote);
      lastRemoteCheckRef.current = Date.now();
      if (canonicalize(remote) !== canonicalize(docRef.current)) applyData(remote);
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
    if (!s.isAuthenticated || s.sessionExpired || s.isLoadingData || s.loadFailed || !browserOnline()) return;
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
        setAppOutdated(isFromNewerApp(raw));
        driveRevisionRef.current = meta.headRevisionId;
        markPersisted(raw);
        headStampRef.current = stamp;
        headSavedAtRef.current = meta.modifiedTime;
        applyData(raw);
        if (!stampIsFromDevice(stamp, deviceId(), meta.modifiedTime)) setRemoteUpdatedAt(Date.now());
      });
    } catch (err) {
      // Relecture impossible (réseau…) : sans conséquence, le contrôle avant écriture reste là.
      if (classifySyncError(err) === 'session') setSessionExpired(true);
    } finally {
      remoteCheckInFlightRef.current = false;
    }
  };
  const checkRemoteRef = useRef(checkRemote);
  checkRemoteRef.current = checkRemote;
  /** Relecture immédiate de Drive (sans attendre le délai minimal). */
  const checkRemoteNow = useCallback(() => checkRemoteRef.current(true), []);

  // --- MIROIR LOCAL (seulement tant que Drive n'est pas à jour, copie hors ligne comprise) ---
  useEffect(() => {
    if (!hasLoadedRef.current && !offlineRef.current) return;
    const timer = setTimeout(() => {
      const data = buildData();
      if (canonicalize(data) === persistedRef.current) { mirrorSeqRef.current += 1; lsDel(BACKUP_KEY); return; }
      // Chiffrée (voir localVault) ; réécrite seulement si Drive n'a pas rattrapé entre-temps.
      writeMirror(data);
    }, 600);
    return () => clearTimeout(timer);
  }, [buildData]);

  // --- NOUVELLES TENTATIVES ---
  /**
   * « Réessayer » : recharge si le chargement a échoué (jamais d'écriture sans données
   * chargées), sinon relance la sauvegarde automatique, avec son contrôle de révision.
   */
  const retrySync = useCallback(() => {
    clearTimeout(retryTimerRef.current);
    const s = statusRef.current;
    if (!s.isAuthenticated || s.isLoadingData || s.sessionExpired) return;
    if (!hasLoadedRef.current || s.loadFailed) { void loadDriveData(); return; }
    if (browserOnline()) setIsOffline(false);
    clearSyncError();
    setRetryTick(t => t + 1);
  }, [loadDriveData]);
  retrySyncRef.current = retrySync;

  // Retour au premier plan : nouvel essai si la synchro est en échec PASSAGER, sinon
  // relecture de Drive (autre appareil, autre onglet) ; en arrière-plan, le miroir est écrit
  // sans attendre (le système peut fermer l'app à tout moment). Après une longue pause, la
  // première touche ou le premier clic relit Drive avant que la saisie ne parte.
  useEffect(() => {
    const wake = () => {
      if (document.visibilityState === 'hidden') {
        if (hasLocalEdits()) writeMirror(currentData());
        return;
      }
      const s = statusRef.current;
      const retryable = s.syncErrorInfo?.transient !== false;
      if (s.loadFailed) { if (retryable) retrySync(); return; }
      if (hasLoadedRef.current && ((s.syncError && retryable) || (s.isOffline && browserOnline()))) { retrySync(); return; }
      void checkRemoteRef.current();
    };
    const onInteract = () => {
      if (hasLoadedRef.current && Date.now() - lastRemoteCheckRef.current > LONG_PAUSE_MS) void checkRemoteRef.current();
    };
    const onPageHide = () => { if (hasLocalEdits()) writeMirror(currentData()); };
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retrySync]);

  // --- SAUVEGARDE AUTO ---
  useEffect(() => {
    if (!isAuthenticated || !driveFileId || isLoadingData || !hasLoadedRef.current) { setIsSaving(false); return; }
    if (syncConflict || sessionExpired || appOutdated || isOffline) { setIsSaving(false); return; }
    // Rien de changé par rapport à Drive : pas d'écriture (ni nouvelle révision).
    if (canonicalize(buildData()) === persistedRef.current) { setIsSaving(false); return; }

    setIsSaving(true);
    clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => { void saveNowRef.current(); }, 2000);
    return () => clearTimeout(saveTimeoutRef.current);
  }, [doc, isAuthenticated, driveFileId, isLoadingData, buildData, syncConflict, sessionExpired, appOutdated, isOffline, retryTick]);

  /**
   * « Envoyer puis se déconnecter » : écrit tout de suite ce qui n'est pas encore sur Drive
   * (avec contrôle de révision). Renvoie true si Drive est à jour. Une copie locale qui attend
   * le choix de l'utilisateur (bandeau « sauvegarde locale ») n'est jamais envoyée ainsi : false.
   */
  const flushPendingChanges = useCallback(async (): Promise<boolean> => {
    if (statusRef.current.localBackup) return false;
    clearTimeout(saveTimeoutRef.current);
    const result = await saveNowRef.current();
    return result !== 'failed' && !hasLocalEdits();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Des saisies affichées ne sont pas encore sur Drive (ou une écriture est en cours) : un
   * rechargement de la page maintenant les ferait passer par le bandeau « sauvegarde locale »
   * au lieu de les garder à l'écran. Sert à repousser le rechargement d'une mise à jour.
   */
  const hasPendingEdits = useCallback((): boolean => isSavingRef.current || hasLocalEdits(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []);

  /** Nouvelle connexion : la copie hors ligne de la session précédente (peut-être un autre compte) est oubliée. */
  const forgetOfflineCopy = useCallback(() => {
    offlineSeqRef.current += 1; // une copie en cours de chiffrement ne doit plus rien écrire
    lsDel(OFFLINE_KEY);
  }, []);

  // Réveil périodique : les points mensuels s'ouvrent sur le nouveau mois même sans saisie.
  const [monthTick, setMonthTick] = useState(() => localMonthKey(new Date()));
  useEffect(() => {
    const sync = () => setMonthTick(localMonthKey(new Date()));
    const timer = setInterval(sync, 60 * 60 * 1000);
    document.addEventListener('visibilitychange', sync);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', sync); };
  }, []);

  // --- POINT MENSUEL DU PATRIMOINE ET DES CHARGES (heure locale) ---
  useEffect(() => {
    if (!hasLoadedRef.current) return;
    const total = doc.accounts.reduce((s, a) => s + a.totalAmount, 0);
    const owned = doc.accounts.reduce((s, a) => s + a.ownedAmount, 0);
    const month = monthTick;
    const today = localTodayISO();
    setDoc(d => {
      const prev = d.history || [];
      const existing = prev.find(s => s.date.startsWith(month));
      if (existing && existing.totalAmount === total && existing.ownedAmount === owned) return d;
      const others = prev.filter(s => !s.date.startsWith(month));
      const snapshot: PortfolioSnapshot = { date: existing ? existing.date : today, totalAmount: total, ownedAmount: owned };
      return { ...d, history: [...others, snapshot].sort((a, b) => a.date.localeCompare(b.date)) };
    });
  }, [doc.accounts, monthTick, loadCount]);

  useEffect(() => {
    if (!hasLoadedRef.current) return;
    const total = Math.round(totalFixedCharges(doc.expenses, doc.subscriptions || []) * 100) / 100;
    const month = monthTick;
    const today = localTodayISO();
    setDoc(d => {
      const prev = d.expensesHistory || [];
      const existing = prev.find(s => s.date.startsWith(month));
      if (existing && existing.total === total) return d;
      const others = prev.filter(s => !s.date.startsWith(month));
      const snapshot: ExpenseSnapshot = { date: existing ? existing.date : today, total };
      return { ...d, expensesHistory: [...others, snapshot].sort((a, b) => a.date.localeCompare(b.date)) };
    });
  }, [doc.expenses, doc.subscriptions, monthTick, loadCount]);

  // `cashFlow` : argent réellement versé (+) ou retiré (−) sur un compte qui suit ses
  // versements (PEA, AV…). Le reste de l'écart est une variation de valeur.
  const updateAccountsWithMovements = useCallback((updates: { account: SavingsAccount; date: string; cashFlow?: number }[]) => {
    setters.setAccounts(prev => {
      const next = [...prev];
      for (const upd of updates) {
        const idx = next.findIndex(a => a.id === upd.account.id);
        if (idx < 0) continue;
        const old = next[idx];
        const movements = balanceChangeMovements(old, upd.account, upd.date, {
          ownLabel: 'Actualisation', cashFlow: upd.cashFlow,
          splitValuation: upd.account.totalDeposits !== undefined && tracksDeposits(upd.account.type),
        });
        next[idx] = { ...upd.account, movements: [...(old.movements || []), ...movements] };
      }
      return next;
    });
  }, [setters]);

  /** Virement interne lié (sortie + entrée). Refusé (`false`) s'il entamerait la part des
   *  parents du compte source : la règle vaut pour tout appelant, pas seulement l'écran. */
  const executeLinkedTransfer = useCallback((sourceId: string, destId: string, amount: number, date: string): boolean => {
    const current = docRef.current.accounts.find(a => a.id === sourceId);
    if (!current || sourceId === destId || !canWithdrawOwn(current, amount)) return false;
    const linkId = crypto.randomUUID();
    setters.setAccounts(prev => {
      const source = prev.find(a => a.id === sourceId);
      const dest = prev.find(a => a.id === destId);
      if (!source || !dest || !canWithdrawOwn(source, amount)) return prev;
      const moveOut: AccountMovement = { id: crypto.randomUUID(), date, amount, label: `Virement vers ${dest.name}`, type: 'OUT', linkId };
      const moveIn: AccountMovement = { id: crypto.randomUUID(), date, amount, label: `Virement de ${source.name}`, type: 'IN', linkId };
      return prev.map(a => a.id === sourceId ? applyMovement(a, moveOut, 1, { trackDeposits: true })
        : a.id === destId ? applyMovement(a, moveIn, 1, { trackDeposits: true }) : a);
    });
    return true;
  }, [setters]);

  // --- COPIES MENSUELLES DRIVE ---
  const listDriveBackups = useCallback((): Promise<DriveBackup[]> => listBackups(), []);
  /**
   * Revient à une copie mensuelle. Les données actuelles sont d'abord mises de côté : la
   * restauration se défait (`recoverSetAside` avec l'identifiant renvoyé). Si elles ne
   * peuvent pas l'être, rien n'est remplacé (erreur SET_ASIDE_FAILED).
   */
  const restoreDriveBackup = useCallback(async (id: string, label?: string): Promise<string> => {
    const raw: unknown = await readConfigFile(id);
    if (validateImport(raw).length > 0) throw new Error('Copie illisible');
    let undoId: string;
    try {
      undoId = await setAsideCurrent('restore', `Vos données avant le retour à la copie${label ? ` ${label}` : ''}`);
    } catch {
      throw new Error('SET_ASIDE_FAILED');
    }
    applyData(raw);
    return undoId;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyData]);

  /** Versions mises de côté pour le fichier ouvert (les plus récentes d'abord). */
  const listSetAsideVersions = useCallback(() => listSetAside(driveFileIdRef.current), []);
  /**
   * Remet une version mise de côté. L'état actuel est mis de côté à son tour (on peut donc
   * revenir en arrière) ; false si la version est illisible ou si l'état actuel n'a pas pu
   * être gardé (rien n'est alors remplacé).
   */
  const recoverSetAside = useCallback(async (entryId: string): Promise<boolean> => {
    const entry = await getSetAside(entryId);
    if (!entry || validateImport(entry.data).length > 0) return false;
    try { await setAsideCurrent('recover', 'Vos données avant la récupération d\'une version mise de côté'); } catch { return false; }
    applyData(entry.data);
    await removeSetAside(entryId);
    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyData]);

  /**
   * Quelque chose n'est pas (ou pas sûrement) sur Drive : modifications affichées pas encore
   * écrites, copie locale proposée et pas encore tranchée, ou, si rien n'a pu être chargé,
   * copies locales jamais examinées. À vérifier avant une déconnexion.
   */
  const hasUnsyncedChanges = useCallback((): boolean => {
    if (!hasLoadedRef.current && !offlineRef.current) return !!(lsGet(PENDING_KEY) || lsGet(BACKUP_KEY));
    // Copie hors ligne affichée : ses saisies (miroir compris) ne sont pas sur Drive.
    return !!statusRef.current.localBackup || hasLocalEdits();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Déconnexion : purge l'état en mémoire. Par défaut, les modifications pas encore sur
   * Drive restent dans la copie locale chiffrée, rattachée à ce fichier Drive (une
   * reconnexion avec un autre compte ne les propose pas), et seront proposées à la prochaine
   * connexion. `discardUnsynced` (« Se déconnecter sans envoyer », choix explicite) les efface
   * de cet appareil.
   */
  const resetData = useCallback((opts?: { discardUnsynced?: boolean }) => {
    resetRetry();
    clearTimeout(saveTimeoutRef.current);
    mirrorSeqRef.current += 1; // une copie en cours de chiffrement ne doit plus rien écrire
    if (opts?.discardUnsynced === true) { lsDel(PENDING_KEY); lsDel(BACKUP_KEY); }
    else if (hasLocalEdits()) writeMirror(currentData()); // dernières saisies (< 600 ms) comprises
    // Copie hors ligne : elle n'a plus lieu d'être sans session (et une lecture en cours ne
    // doit plus rien appliquer ni écrire).
    sessionGenRef.current += 1;
    lsDel(OFFLINE_KEY);
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
    clearSyncError();
    setSessionExpired(false);
    setAppOutdated(false);
    setLoadFailed(false);
    setDoc(emptyData());
    setDriveFileId(null);
    lsDel(LAST_BACKUP_MONTH_KEY);
    setLocalBackup(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ce que l'écran de choix affiche : la version de cet appareil est toujours l'état courant.
  const conflict = useMemo<SyncConflictView | null>(() => {
    if (!conflictCtx) return null;
    const duplicate = conflictCtx.kind === 'duplicate';
    const local: ConflictVersion = duplicate
      ? { data: buildData(), savedAt: conflictCtx.localSavedAt, device: stampDevice(headStampRef.current, conflictCtx.localSavedAt), fromThisDevice: false }
      : { data: buildData(), savedAt: conflictCtx.localSavedAt, device: thisDevice, fromThisDevice: true };
    let remote: ConflictVersion | null = null;
    if (conflictCtx.remoteStatus === 'ready') {
      const stamp = readWriteStamp(conflictCtx.remoteRaw);
      remote = {
        data: migrate(conflictCtx.remoteRaw),
        savedAt: conflictCtx.remoteSavedAt ?? stamp?.at ?? null,
        device: stampDevice(stamp, conflictCtx.remoteSavedAt),
        fromThisDevice: stampIsFromDevice(stamp, deviceId(), conflictCtx.remoteSavedAt),
      };
    }
    return {
      kind: conflictCtx.kind, local, remote, remoteStatus: conflictCtx.remoteStatus,
      remoteFromNewerApp: conflictCtx.remoteStatus === 'ready' && isFromNewerApp(conflictCtx.remoteRaw),
    };
  }, [conflictCtx, buildData, thisDevice]);

  const c = doc.config;
  return {
    // Données
    accounts: doc.accounts,
    expenses: doc.expenses,
    history: doc.history,
    expensesHistory: doc.expensesHistory || [],
    goals: doc.goals || [],
    payslips: doc.payslips || [],
    recurringMovements: doc.recurringMovements || [],
    subscriptions: doc.subscriptions || [],
    donations: doc.donations || [],
    payChecklist: doc.payChecklist,
    parentalRestitution: doc.parentalRestitution,
    activePayslipId: doc.activePayslipId,
    fiscalConfig: doc.fiscalConfig!,
    workBenefits: doc.workBenefits!,
    grossAnnual: c.grossAnnual,
    leisureBudget: c.leisureBudget,
    projectSavings: c.projectSavings,
    navigoBase: c.navigoBase ?? 90.80,
    navigoRate: c.navigoRate ?? 67.24,
    taxRateManual: c.taxRateManual,
    extraMonthlyIncome: c.extraMonthlyIncome,
    pickerApiKey: c.pickerApiKey ?? '',
    paydayDay: c.paydayDay,
    paydayAmount: c.paydayAmount,
    savingsSplit: c.savingsSplit,
    savingsSplitFrom: c.savingsSplitFrom,
    trackingStartDate: c.trackingStartDate,
    config: c,
    geminiApiKey, setGeminiApiKey,
    ...setters,
    buildData,
    lastView, setLastView,

    // Statut
    isLoadingData,
    isSaving,
    syncError,
    syncErrorInfo,
    syncConflict,
    conflict,
    duplicateFile: otherFiles[0] ?? null,
    sessionExpired,
    appOutdated,
    localBackup,
    lastSavedAt,
    isOffline,
    loadFailed,
    remoteUpdatedAt,
    dataShown,
    offlineDataAt,

    // Actions
    loadDriveData,
    loadDemoData,
    resolveConflict,
    retryConflictLoad,
    compareDuplicate,
    closeDuplicateComparison,
    dismissDuplicate,
    retrySync,
    checkRemote: checkRemoteNow,
    flushPendingChanges,
    hasUnsyncedChanges,
    hasPendingEdits,
    forgetOfflineCopy,
    restoreLocalBackup,
    dismissLocalBackup,
    updateAccountsWithMovements,
    executeLinkedTransfer,
    exportData,
    importData,
    listDriveBackups,
    restoreDriveBackup,
    listSetAsideVersions,
    recoverSetAside,
    resetData,
  };
};
