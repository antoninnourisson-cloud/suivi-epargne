// État applicatif et synchronisation avec le fichier Drive.
//
// Tout le document vit dans UN état (`doc`) : ajouter un champ ne demande plus que son type,
// sa valeur par défaut (src/lib/schema.ts) et son interface. Les setters par champ restent
// exposés pour les écrans.
import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { lsDel, lsGet, lsSet } from '../lib/storage';
import { tracksDeposits, totalFixedCharges } from '../lib/finance';
import { applyMovement, balanceChangeMovements, canWithdrawOwn } from '../lib/accountOps';
import { migrate, canonicalize, emptyData, isFromNewerApp, withoutDeviceOnlyFields, validateImport, APP_SCHEMA_VERSION } from '../lib/schema';
import { sealJSON, openJSON } from '../services/localVault';
import { localTodayISO } from '../lib/dates';
import { GlobalAppData, SavingsAccount, AccountMovement, PortfolioSnapshot, ExpenseSnapshot, WorkBenefits } from '../types';
import {
  findConfigFile, createConfigFile, readConfigFile, updateConfigFile,
  getFileRevision, setOnAuthLost, ConflictError, ConcurrentWriteError, ApiError, writeMonthlyBackup, listBackups, DriveBackup,
  fetchRevisionContent,
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

type StoredSnapshot = { savedAt: string; fileId?: string; data: GlobalAppData };
/** Version d'un autre appareil écrasée par une course d'écriture (voir ConcurrentWriteError). */
type OtherVersion = { fileId: string; revisionId: string; content: unknown };
type Doc = GlobalAppData;
type Config = GlobalAppData['config'];
type Updater<T> = T | ((prev: T) => T);
const resolve = <T,>(u: Updater<T>, prev: T): T => (typeof u === 'function' ? (u as (p: T) => T)(prev) : u);


const localMonthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

// Nouvelles tentatives après un échec de requête (délai dépassé, Drive saturé…) alors que le
// navigateur se croit en ligne : il n'émettra jamais l'événement `online`.
const RETRY_DELAYS_MS = [5_000, 30_000, 120_000];
const browserOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;

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

export const usePortfolioData = (isAuthenticated: boolean) => {
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [driveFileId, setDriveFileId] = useState<string | null>(null);

  // État de synchronisation exposé à l'UI (bannières).
  const [syncError, setSyncError] = useState(false);
  const [syncConflict, setSyncConflict] = useState(false);
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
  // Relance la sauvegarde automatique sans modification du document (bouton « Réessayer »,
  // nouvelle tentative programmée, retour au premier plan).
  const [retryTick, setRetryTick] = useState(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const retryAttemptRef = useRef(0);
  const retrySyncRef = useRef<() => void>(() => {});
  // Dernier état vu par les écouteurs (onglets, retour au premier plan) sans les réabonner.
  const statusRef = useRef({ isOffline, syncError, syncConflict, sessionExpired, appOutdated, loadFailed, isLoadingData, localBackup, isAuthenticated });
  statusRef.current = { isOffline, syncError, syncConflict, sessionExpired, appOutdated, loadFailed, isLoadingData, localBackup, isAuthenticated };

  const driveRevisionRef = useRef<string | null>(null);
  const driveFileIdRef = useRef<string | null>(null);
  // Contenu canonique de ce qui est sur Drive (après chargement ou sauvegarde) : aucune
  // écriture tant que l'état n'en diffère pas. Ouvrir l'app ne réécrit donc plus le fichier.
  const persistedRef = useRef<string>('');
  // Course d'écriture constatée après coup : la version de l'autre appareil, en attente du
  // choix de l'utilisateur (bannière de conflit). `content` vaut undefined si elle n'a pas
  // encore pu être relue sur Drive.
  const otherVersionRef = useRef<OtherVersion | null>(null);

  // --- DOCUMENT ---
  const [doc, setDoc] = useState<Doc>(emptyData);
  const docRef = useRef(doc);
  docRef.current = doc;

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
  /** Des modifications affichées ne sont pas encore sur Drive. */
  const hasLocalEdits = () => hasLoadedRef.current && canonicalize(currentData()) !== persistedRef.current;

  // Miroir local chiffré : seule la dernière demande est écrite (un chiffrement plus lent
  // ne remet jamais une version plus ancienne par-dessus), et seulement si Drive n'a pas
  // rattrapé entre-temps.
  const mirrorSeqRef = useRef(0);
  const writeMirror = (data: GlobalAppData) => {
    const seq = ++mirrorSeqRef.current;
    const snapshot: StoredSnapshot = { savedAt: new Date().toISOString(), fileId: driveFileIdRef.current ?? undefined, data };
    sealJSON(snapshot).then(sealed => {
      if (seq === mirrorSeqRef.current && canonicalize(data) !== persistedRef.current) lsSet(BACKUP_KEY, sealed);
    }).catch(() => { /* filet de secours seulement */ });
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

  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Garde-fou : tant qu'un chargement Drive n'a pas réussi, aucune sauvegarde (évite
  // d'écraser un bon fichier avec un état vide).
  const hasLoadedRef = useRef(false);
  // Mutex d'écriture : sauvegarde auto et résolution de conflit manuelle ne doivent
  // jamais s'entrelacer (chaque écriture fait lecture de révision puis PATCH).
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
      if (statusRef.current.loadFailed) retrySyncRef.current(); // chargement raté hors ligne
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

  const markPersisted = (data: unknown) => { persistedRef.current = canonicalize(data); };

  // --- CHARGEMENT ---
  /**
   * Charge le fichier Drive. Les modifications locales pas encore sur Drive (quarantaine,
   * miroir, et état affiché s'il diffère) sont comparées au fichier : la plus récente qui
   * en diffère est proposée (bannière « sauvegarde locale ») et gardée en quarantaine.
   * `keepUnsynced: false` seulement pour un abandon explicite (« Recharger l'autre version »).
   */
  const loadDriveData = useCallback(async (opts?: { keepUnsynced?: boolean }) => {
    const keepUnsynced = opts?.keepUnsynced !== false;
    // Relevé AVANT toute attente : le miroir peut être effacé dès que l'état affiché
    // redevient celui de Drive.
    const inMemory: StoredSnapshot | null = keepUnsynced && hasLocalEdits()
      ? { savedAt: new Date().toISOString(), fileId: driveFileIdRef.current ?? undefined, data: currentData() }
      : null;
    const storedCopies = keepUnsynced ? [PENDING_KEY, BACKUP_KEY].map(key => [key, lsGet(key)] as const) : [];
    clearTimeout(retryTimerRef.current);
    setIsLoadingData(true);
    setSessionExpired(false);
    setSyncConflict(false);
    otherVersionRef.current = null;
    setSyncError(false);
    setLoadFailed(false);
    try {
      let fileId = await findConfigFile();
      if (!fileId) fileId = await createConfigFile(emptyData());
      setDriveFileId(fileId);
      const raw: unknown = await readConfigFile(fileId);
      if (!raw) throw new Error('EMPTY_FILE');
      setAppOutdated(isFromNewerApp(raw));
      applyData(raw);
      const savedView = (raw as { lastView?: string }).lastView;
      if (savedView) setLastView(savedView);
      markPersisted(raw);
      // Ancien fichier contenant encore la clé Gemini : une écriture la retire de Drive.
      if ((raw as { config?: { geminiApiKey?: string } }).config?.geminiApiKey) persistedRef.current = '';

      // En cas d'échec on laisse `null` : la sauvegarde auto refusera d'écrire plutôt
      // que d'écraser sans contrôle de concurrence.
      try { driveRevisionRef.current = await getFileRevision(fileId); } catch { driveRevisionRef.current = null; }

      // Modifications locales qui n'ont jamais atteint Drive (sync bloquée avant fermeture) ?
      // Les deux copies sont lues : une vieille quarantaine ne cache plus un miroir plus récent.
      const rawCanonical = canonicalize(raw);
      const candidates: StoredSnapshot[] = [];
      if (inMemory && canonicalize(inMemory.data) !== rawCanonical) candidates.push(inMemory);
      for (const [key, stored] of storedCopies) {
        if (!stored) continue;
        try {
          const snap = await openJSON<StoredSnapshot>(stored);
          // Une copie rattachée à un AUTRE fichier Drive appartient à un autre compte : ni
          // proposée, ni effacée.
          if (snap.fileId && snap.fileId !== fileId) continue;
          if (canonicalize(snap.data) === rawCanonical) {
            if (lsGet(key) === stored) lsDel(key); // déjà sur Drive
            continue;
          }
          candidates.push(snap);
        } catch { /* copie illisible : laissée en place */ }
      }
      const newest = candidates.reduce<StoredSnapshot | null>((best, s) => (!best || (s.savedAt || '') > (best.savedAt || '') ? s : best), null);
      if (newest) {
        setLocalBackup(newest);
        try { lsSet(PENDING_KEY, await sealJSON({ ...newest, fileId })); } catch { /* reste proposée en mémoire */ }
      }

      driveFileIdRef.current = fileId;
      hasLoadedRef.current = true;
      resetRetry();
    } catch (error) {
      // Un chargement raté doit être VISIBLE (sinon indiscernable d'une perte totale), et
      // rien ne sera écrit sur Drive tant qu'un chargement n'a pas réussi.
      console.error('Erreur chargement', error);
      setLoadFailed(true);
      if (classifySyncError(error) === 'session') setSessionExpired(true);
      else { setSyncError(true); scheduleRetry(); }
    } finally {
      setIsLoadingData(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyData, setLastView]);

  /** Mode démo (développement uniquement) : données fictives en mémoire, aucune écriture Drive. */
  const loadDemoData = useCallback((raw: unknown) => {
    applyData(raw);
    markPersisted(raw);
    hasLoadedRef.current = true;
    setIsLoadingData(false);
     
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

  // --- EXPORT / IMPORT ---
  const exportData = useCallback(() => {
    const blob = new Blob([JSON.stringify(buildData(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pecule-${localTodayISO()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [buildData]);

  /**
   * Import d'un fichier local. Le fichier est contrôlé avant de remplacer quoi que ce soit.
   */
  const importData = useCallback(async (file: File): Promise<boolean> => {
    try {
      const parsed: unknown = JSON.parse(await file.text());
      const errors = validateImport(parsed);
      if (errors.length > 0) { console.error('Import refusé', errors); return false; }
      const keepPicker = docRef.current.config.pickerApiKey;
      applyData(parsed);
      setDoc(d => ({ ...d, config: { ...d.config, pickerApiKey: d.config.pickerApiKey || keepPicker } }));
      return true;
    } catch (e) {
      console.error('Import échoué', e);
      return false;
    }
  }, [applyData]);

  /**
   * « Recharger l'autre version » après une course d'écriture : Drive porte NOTRE version
   * en tête, celle de l'autre appareil est dans la révision précédente. On l'applique
   * localement ; la sauvegarde auto la réécrit ensuite en tête (écriture vérifiée, à partir
   * de notre révision). Relue sur Drive si elle ne l'avait pas été au moment du conflit.
   */
  const adoptOtherVersion = useCallback(async (other: OtherVersion) => {
    try {
      const content = other.content !== undefined
        ? other.content
        : await runExclusive(() => fetchRevisionContent(other.fileId, other.revisionId));
      if (otherVersionRef.current !== other) return; // chargement ou résolution entre-temps
      otherVersionRef.current = null;
      lsDel(PENDING_KEY);
      lsDel(BACKUP_KEY);
      setLocalBackup(null);
      setAppOutdated(isFromNewerApp(content));
      applyData(content);
      setSyncError(false);
      setSyncConflict(false);
    } catch (err) {
      // Toujours rien d'écrasé : le conflit reste ouvert, on pourra réessayer.
      console.error("Version de l'autre appareil illisible", other.revisionId, err);
      if (classifySyncError(err) === 'session') setSessionExpired(true);
      else setSyncError(true);
    }
  }, [applyData, runExclusive]);

  const reloadFromDrive = useCallback(() => {
    const other = otherVersionRef.current;
    if (other && other.fileId === driveFileIdRef.current) { void adoptOtherVersion(other); return; }
    // Abandon explicite des modifications locales : on purge quarantaine ET miroir.
    lsDel(PENDING_KEY);
    lsDel(BACKUP_KEY);
    setLocalBackup(null);
    setSyncConflict(false);
    void loadDriveData({ keepUnsynced: false });
  }, [loadDriveData, adoptOtherVersion]);

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

  const onSaved = (fileId: string, revision: string, saved: GlobalAppData) => {
    driveRevisionRef.current = revision;
    markPersisted(saved);
    announceSave(fileId, revision);
    setSyncError(false);
    resetRetry();
    if (browserOnline()) setIsOffline(false);
    setLastSavedAt(new Date());
    // Le miroir n'est effacé que si Drive a TOUT rattrapé : une saisie faite pendant cette
    // écriture n'est pas encore sur Drive, son miroir est réécrit tout de suite.
    const current = currentData();
    if (canonicalize(current) === persistedRef.current) lsDel(BACKUP_KEY); else writeMirror(current);
    maybeMonthlyBackup(saved);
  };

  /**
   * Course d'écriture constatée APRÈS notre PATCH (voir ConcurrentWriteError). Rien n'est
   * réécrit automatiquement : Drive garde notre version en tête (c'est aussi l'état local),
   * la version de l'autre appareil est gardée en mémoire et dans la quarantaine locale
   * chiffrée (proposée au prochain démarrage si l'app est fermée avant de trancher), et la
   * bannière de conflit habituelle laisse l'utilisateur choisir : « Garder mes
   * modifications » réécrit la nôtre, « Recharger l'autre version » applique la sienne.
   */
  const onConcurrentWrite = (fileId: string, ours: GlobalAppData, err: ConcurrentWriteError) => {
    driveRevisionRef.current = err.ourRevisionId;
    markPersisted(ours);
    otherVersionRef.current = { fileId, revisionId: err.otherRevisionId, content: err.otherContent };
    if (err.otherContent !== undefined) {
      const snap: StoredSnapshot = { savedAt: new Date().toISOString(), fileId, data: err.otherContent as GlobalAppData };
      sealJSON(snap).then(sealed => lsSet(PENDING_KEY, sealed)).catch(() => { /* reste en mémoire et sur Drive */ });
    }
    console.warn('Écriture concurrente détectée après sauvegarde', { ours: err.ourRevisionId, other: err.otherRevisionId });
    setSyncConflict(true);
  };

  /**
   * `ours` : la version qu'on tentait d'écrire. Sur un conflit, elle est mise en quarantaine
   * locale chiffrée : elle survit à une fermeture de l'app avant que l'utilisateur tranche.
   */
  const handleSyncFailure = (err: unknown, ours?: GlobalAppData) => {
    const kind = classifySyncError(err);
    if (kind === 'conflict') {
      setSyncConflict(true);
      if (ours) {
        const snap: StoredSnapshot = { savedAt: new Date().toISOString(), fileId: driveFileIdRef.current ?? undefined, data: ours };
        sealJSON(snap).then(sealed => lsSet(PENDING_KEY, sealed)).catch(() => { /* reste en mémoire et dans le miroir */ });
      }
    } else if (kind === 'session') setSessionExpired(true);
    else if (kind === 'offline') { setIsOffline(true); scheduleRetry(); }
    else {
      // 'notfound' est traité par l'appelant (fichier retrouvé ou recréé).
      setSyncError(true);
      if (kind === 'error') scheduleRetry();
      console.error('Erreur de sauvegarde', err);
    }
    return kind;
  };

  // Résout un conflit en écrasant la version distante (choix explicite de l'utilisateur).
  const forceSaveToDrive = useCallback(async () => {
    // Jamais d'écriture sans chargement réussi : on écraserait le fichier par un état vide.
    if (!driveFileId || appOutdated || !hasLoadedRef.current) return;
    try {
      const data = buildData();
      const newRevision = await runExclusive(() => updateConfigFile(driveFileId, data)); // sans contrôle : choix explicite
      onSaved(driveFileId, newRevision, data);
      otherVersionRef.current = null;
      setSyncConflict(false);
      lsDel(PENDING_KEY);
      setLocalBackup(null);
    } catch (err) {
      handleSyncFailure(err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driveFileId, buildData, runExclusive, appOutdated]);

  const restoreLocalBackup = useCallback(() => {
    if (!localBackup) return;
    applyData(localBackup.data);
    lsDel(PENDING_KEY);
    setLocalBackup(null);
  }, [localBackup, applyData]);

  const dismissLocalBackup = useCallback(() => {
    lsDel(PENDING_KEY);
    setLocalBackup(null);
  }, []);

  const isSavingRef = useRef(false);
  useEffect(() => { isSavingRef.current = isSaving; }, [isSaving]);

  // --- COORDINATION MULTI-ONGLETS ---
  /**
   * Sauvegarde annoncée par un autre onglet. Appliquée seulement si cet onglet n'a rien en
   * attente : modifications pas encore sur Drive, écriture en cours, conflit, hors ligne,
   * session expirée ou version trop ancienne de l'app. Sinon rien n'est appliqué et la
   * révision connue reste l'ancienne : la prochaine écriture lèvera le conflit (choix
   * explicite) au lieu d'effacer nos saisies ou d'écraser celles de l'autre onglet.
   */
  const applyAnnouncedSave = async (announcement: string | null) => {
    if (!announcement) return;
    try {
      const { fileId, revision } = JSON.parse(announcement) as { fileId?: string; revision?: string | null };
      if (!fileId || fileId !== driveFileIdRef.current) return;
      if (!revision || String(revision) === driveRevisionRef.current) return;
      const busy = () => {
        const s = statusRef.current;
        return isSavingRef.current || hasLocalEdits() || s.syncConflict || s.sessionExpired || s.isOffline || s.appOutdated || s.isLoadingData;
      };
      const keepForConflict = () => {
        // Révision inconnue : la sauvegarde la relirait et écraserait l'autre onglet sans
        // contrôle. Une valeur qui ne correspond à aucune révision force le conflit.
        if (!driveRevisionRef.current) driveRevisionRef.current = 'superseded-by-other-tab';
      };
      if (busy()) { keepForConflict(); return; }
      const remote: unknown = await readConfigFile(fileId);
      if (busy() || fileId !== driveFileIdRef.current) { keepForConflict(); return; }
      // Fichier écrit par une version plus récente : lecture seule, comme au chargement.
      setAppOutdated(isFromNewerApp(remote));
      driveRevisionRef.current = String(revision);
      markPersisted(remote);
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

  // --- MIROIR LOCAL (seulement tant que Drive n'est pas à jour) ---
  useEffect(() => {
    if (!hasLoadedRef.current) return;
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
    setSyncError(false);
    setRetryTick(t => t + 1);
  }, [loadDriveData]);
  retrySyncRef.current = retrySync;

  // Retour au premier plan : nouvelle tentative si la synchro est en échec, mise à jour
  // depuis un autre onglet sinon ; en arrière-plan, le miroir est écrit sans attendre
  // (le système peut fermer l'app à tout moment).
  useEffect(() => {
    const wake = () => {
      if (document.visibilityState === 'hidden') {
        if (hasLocalEdits()) writeMirror(currentData());
        return;
      }
      const s = statusRef.current;
      if (s.loadFailed || (hasLoadedRef.current && (s.syncError || (s.isOffline && browserOnline())))) retrySync();
      else void applyAnnouncedSaveRef.current(lsGet(LAST_SAVE_KEY));
    };
    const onPageHide = () => { if (hasLocalEdits()) writeMirror(currentData()); };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('focus', wake);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('focus', wake);
      window.removeEventListener('pagehide', onPageHide);
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
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => void (async () => {
      const data = buildData();
      try {
        const newRevision = await runExclusive(async () => {
          // Sans révision de référence, l'écriture se ferait sans contrôle de concurrence :
          // on la récupère, et on renonce à écrire si c'est impossible.
          if (!driveRevisionRef.current) driveRevisionRef.current = await getFileRevision(driveFileId);
          return updateConfigFile(driveFileId, data, driveRevisionRef.current);
        });
        onSaved(driveFileId, newRevision, data);
      } catch (err) {
        if (err instanceof ConcurrentWriteError) onConcurrentWrite(driveFileId, data, err);
        else if (handleSyncFailure(err, data) === 'notfound') {
          // Fichier supprimé hors de l'app : on le retrouve ou on le recrée.
          setSyncError(false);
          try {
            const foundId = await findConfigFile();
            if (foundId && foundId !== driveFileId) {
              // Un AUTRE fichier existe : peut-être un ancien doublon. On ne l'écrase pas
              // à l'aveugle : s'il diffère, c'est un conflit à arbitrer par l'utilisateur.
              setDriveFileId(foundId);
              driveFileIdRef.current = foundId;
              const remote: unknown = await readConfigFile(foundId);
              driveRevisionRef.current = await getFileRevision(foundId).catch(() => null);
              markPersisted(remote);
              if (canonicalize(remote) !== canonicalize(data)) setSyncConflict(true);
            } else {
              const id = foundId ?? (await createConfigFile(data));
              if (id !== driveFileId) { setDriveFileId(id); driveFileIdRef.current = id; }
              const revision = foundId ? await updateConfigFile(id, data, null) : await getFileRevision(id);
              onSaved(id, revision, data);
            }
          } catch (recoveryErr) {
            setSyncError(true);
            console.error('Fichier Drive introuvable et récupération échouée', recoveryErr);
          }
        }
      } finally {
        setIsSaving(false);
      }
    })(), 2000);
    return () => clearTimeout(saveTimeoutRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, isAuthenticated, driveFileId, isLoadingData, buildData, syncConflict, sessionExpired, appOutdated, isOffline, runExclusive, retryTick]);

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
  }, [doc.accounts, monthTick]);

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
  }, [doc.expenses, doc.subscriptions, monthTick]);

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
  const restoreDriveBackup = useCallback(async (id: string) => {
    const raw: unknown = await readConfigFile(id);
    if (validateImport(raw).length > 0) throw new Error('Copie illisible');
    applyData(raw);
  }, [applyData]);

  /**
   * Quelque chose n'est pas (ou pas sûrement) sur Drive : modifications affichées pas encore
   * écrites, copie locale proposée et pas encore tranchée, ou, si rien n'a pu être chargé,
   * copies locales jamais examinées. À vérifier avant une déconnexion.
   */
  const hasUnsyncedChanges = useCallback((): boolean => {
    if (!hasLoadedRef.current) return !!(lsGet(PENDING_KEY) || lsGet(BACKUP_KEY));
    return !!statusRef.current.localBackup || hasLocalEdits();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Déconnexion : purge l'état en mémoire. Les modifications pas encore sur Drive ne sont
   * JAMAIS effacées ici : elles restent dans la copie locale chiffrée, rattachée à ce fichier
   * Drive (une reconnexion avec un autre compte ne les propose pas), et seront proposées à la
   * prochaine connexion. Seul l'utilisateur peut les abandonner (« Ignorer », « Recharger
   * l'autre version »).
   */
  const resetData = useCallback(() => {
    resetRetry();
    mirrorSeqRef.current += 1; // une copie en cours de chiffrement ne doit plus rien écrire
    if (hasLocalEdits()) writeMirror(currentData()); // dernières saisies (< 600 ms) comprises
    hasLoadedRef.current = false;
    driveRevisionRef.current = null;
    driveFileIdRef.current = null;
    otherVersionRef.current = null;
    persistedRef.current = '';
    setSyncError(false);
    setSyncConflict(false);
    setSessionExpired(false);
    setAppOutdated(false);
    setLoadFailed(false);
    setDoc(emptyData());
    setDriveFileId(null);
    lsDel(LAST_BACKUP_MONTH_KEY);
    setLocalBackup(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    syncConflict,
    sessionExpired,
    appOutdated,
    localBackup,
    lastSavedAt,
    isOffline,
    loadFailed,

    // Actions
    loadDriveData,
    loadDemoData,
    reloadFromDrive,
    forceSaveToDrive,
    retrySync,
    hasUnsyncedChanges,
    restoreLocalBackup,
    dismissLocalBackup,
    updateAccountsWithMovements,
    executeLinkedTransfer,
    exportData,
    importData,
    listDriveBackups,
    restoreDriveBackup,
    resetData,
  };
};
