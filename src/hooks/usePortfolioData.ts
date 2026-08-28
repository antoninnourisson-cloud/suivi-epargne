// ================================================
// FILE: src/hooks/usePortfolioData.ts
// ================================================
import { useState, useCallback, useRef, useEffect } from 'react';
import {
  GlobalAppData, SavingsAccount, Expense, PortfolioSnapshot, ExpenseSnapshot,
  FiscalConfig, WorkBenefits, AccountMovement, SavingsGoal, PayslipRecord
} from '../types';
import { 
  DEFAULT_FISCAL_CONFIG, DEFAULT_WORK_BENEFITS 
} from '../constants';
import { 
  findConfigFile, createConfigFile, readConfigFile, updateConfigFile, sendGmail,
  getFileRevision, setOnAuthLost, ConflictError 
} from '../services/googleDriveService';

// Miroir local de l'état courant : filet anti-crash, réécrit à chaque modification.
const BACKUP_KEY = 'suivi_epargne_backup';
// Quarantaine : copie de modifications qui n'ont JAMAIS atteint Drive, détectée au
// démarrage. Volontairement distincte du miroir ci-dessus, qui est écrasé en continu —
// sans cette séparation, la première saisie suivant l'ouverture détruisait la trace des
// modifications non synchronisées, et la bannière de restauration n'était qu'un one-shot
// non durable (un rechargement après cette saisie les rendait irrécupérables).
const PENDING_KEY = 'suivi_epargne_pending';

type StoredSnapshot = { savedAt: string; fileId?: string; data: GlobalAppData };

/**
 * Projette des données sur une forme canonique comparable, en appliquant les mêmes
 * valeurs par défaut que l'état du hook. Indispensable pour comparer un fichier Drive
 * (qui peut être ancien, avec des champs absents ou dans un autre ordre) à une
 * sauvegarde locale sans générer de faux « écarts ».
 *
 * `lastView` est exclu : c'est de la préférence d'affichage, pas une donnée financière,
 * et elle ne doit pas faire croire à des modifications perdues.
 */
const canonicalize = (data: GlobalAppData | null | undefined): string => {
  if (!data) return '';
  const c = data.config || ({} as GlobalAppData['config']);
  return JSON.stringify({
    accounts: (data.accounts || []).map(a => ({ ...a, movements: a.movements || [] })),
    expenses: data.expenses || [],
    history: data.history || [],
    expensesHistory: data.expensesHistory || [],
    goals: data.goals || [],
    payslips: data.payslips || [],
    activePayslipId: data.activePayslipId ?? null,
    fiscalConfig: data.fiscalConfig || null,
    workBenefits: data.workBenefits || null,
    config: {
      grossAnnual: c.grossAnnual ?? null,
      leisureBudget: c.leisureBudget ?? null,
      projectSavings: c.projectSavings ?? null,
      navigoBase: c.navigoBase ?? null,
      navigoRate: c.navigoRate ?? null,
      taxRateManual: c.taxRateManual ?? null,
      extraMonthlyIncome: c.extraMonthlyIncome ?? null,
      parentsEmail: c.parentsEmail ?? null,
      geminiApiKey: c.geminiApiKey ?? null,
      pickerApiKey: c.pickerApiKey ?? null,
    },
  });
};

// Clé de mois en heure LOCALE. `toISOString().slice(0,7)` raisonne en UTC : le 1er du
// mois à 00h30 à Paris (UTC+2), l'UTC est encore la veille, donc le snapshot du mois
// courant écrasait celui du mois précédent.
const localMonthKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const localDayKey = (d: Date) => `${localMonthKey(d)}-${String(d.getDate()).padStart(2, '0')}`;

export const usePortfolioData = (isAuthenticated: boolean) => {
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [driveFileId, setDriveFileId] = useState<string | null>(null);

  // État de synchronisation exposé à l'UI (bannières).
  const [syncError, setSyncError] = useState(false);       // échec de sauvegarde
  const [syncConflict, setSyncConflict] = useState(false); // écriture concurrente (autre appareil)
  const [sessionExpired, setSessionExpired] = useState(false);
  // Pas de connexion : on gèle simplement les sauvegardes (pas d'erreur affichée),
  // le filet de sécurité localStorage garde les modifications jusqu'au retour du réseau.
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  // Horodatage de la dernière écriture confirmée sur Drive (pas juste un état local) :
  // sert de preuve visible que la sauvegarde cloud a bien réussi, pas seulement l'affichage.
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const driveRevisionRef = useRef<string | null>(null);
  // Miroir non-réactif de driveFileId : sert à étiqueter les sauvegardes locales avec le
  // fichier (donc le compte Google) auquel elles appartiennent, depuis des effets qui ne
  // doivent pas se redéclencher quand il change.
  const driveFileIdRef = useRef<string | null>(null);
  // Sauvegarde locale trouvée au démarrage et différente de ce qui vient d'être chargé
  // depuis Drive (signe qu'une sync a échoué/été bloquée avant que l'app ne se ferme).
  const [localBackup, setLocalBackup] = useState<StoredSnapshot | null>(null);
  // Destinataire du dernier mail d'alerte parents qui a échoué (null = rien à signaler).
  const [mailError, setMailError] = useState<string | null>(null);
  
  // Données
  const [accounts, setAccounts] = useState<SavingsAccount[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [history, setHistory] = useState<PortfolioSnapshot[]>([]);
  const [expensesHistory, setExpensesHistory] = useState<ExpenseSnapshot[]>([]);
  const [goals, setGoals] = useState<SavingsGoal[]>([]);
  const [payslips, setPayslips] = useState<PayslipRecord[]>([]);
  // Fiche de paie servant de référence exacte au Pilotage Budgétaire (undefined = mode
  // estimation théorique, comportement historique).
  const [activePayslipId, setActivePayslipId] = useState<string | undefined>(undefined);

  // Configs
  const [grossAnnual, setGrossAnnual] = useState<number>(45000);
  const [leisureBudget, setLeisureBudget] = useState<number>(300);
  const [projectSavings, setProjectSavings] = useState<number>(200);
  const [navigoBase, setNavigoBase] = useState<number>(90.80);
  const [navigoRate, setNavigoRate] = useState<number>(67.24);
  const [taxRateManual, setTaxRateManual] = useState<number>(0);
  const [extraMonthlyIncome, setExtraMonthlyIncome] = useState<number>(0);
  const [fiscalConfig, setFiscalConfig] = useState<FiscalConfig>(DEFAULT_FISCAL_CONFIG);
  const [workBenefits, setWorkBenefits] = useState<WorkBenefits>(DEFAULT_WORK_BENEFITS);
  const [parentsEmail, setParentsEmail] = useState<string>('');
  const [geminiApiKey, setGeminiApiKey] = useState<string>('');
  const [pickerApiKey, setPickerApiKey] = useState<string>('');

  const [lastView, setLastViewState] = useState<string>(
    () => localStorage.getItem('last_view') || 'dashboard'
  );
  // Miroir non-réactif de `lastView` : buildData le lit ici plutôt que via l'état,
  // pour que la valeur soit incluse dans les sauvegardes Drive réelles sans que
  // changer d'onglet ne déclenche lui-même un cycle d'auto-sauvegarde.
  const lastViewRef = useRef(lastView);
  // Persiste la vue courante localement (restauration instantanée) SANS déclencher
  // une réécriture complète du fichier Drive à chaque changement d'onglet.
  const setLastView = useCallback((v: string) => {
    localStorage.setItem('last_view', v);
    lastViewRef.current = v;
    setLastViewState(v);
  }, []);

  const saveTimeoutRef = useRef<any>(null);
  // Garde-fou anti-écrasement : tant qu'un chargement Drive n'a pas réussi,
  // on n'autorise aucune sauvegarde (évite d'écraser un bon fichier avec un état vide).
  const hasLoadedRef = useRef(false);
  // Mutex d'écriture : la sauvegarde auto (debounce) et une résolution de conflit manuelle
  // (forceSaveToDrive) pouvaient partir en parallèle. Chaque appel à updateConfigFile fait
  // GET-révision puis PATCH en plusieurs allers-retours réseau ; sans sérialisation, deux
  // appels concurrents s'entrelacent et peuvent soit s'écraser silencieusement l'un l'autre,
  // soit faire réapparaître un "conflit" juste après qu'il ait été résolu par l'utilisateur
  // (l'appel encore en vol détecte après coup le changement de révision).
  // On chaîne donc tous les appels sur cette promesse pour n'en avoir jamais qu'un à la fois.
  const saveMutexRef = useRef<Promise<any>>(Promise.resolve());
  const runExclusive = useCallback(<T,>(fn: () => Promise<T>): Promise<T> => {
    const run = () => fn();
    const next = saveMutexRef.current.then(run, run);
    saveMutexRef.current = next.catch(() => {});
    return next;
  }, []);

  // La perte de session (401 non récupérable) remonte via ce callback.
  useEffect(() => {
    setOnAuthLost(() => setSessionExpired(true));
    return () => setOnAuthLost(null);
  }, []);

  // --- DÉTECTION HORS LIGNE ---
  // navigator.onLine reflète la connectivité réseau du système ; on s'en sert pour geler
  // les sauvegardes proprement (pas d'erreur affichée) plutôt que de laisser chaque tentative
  // échouer bruyamment. Le retour en ligne relance automatiquement une sauvegarde (voir
  // dépendance `isOffline` de l'effet d'auto-save ci-dessous) sans attendre une nouvelle saisie.
  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // --- CHARGEMENT ---
  const loadDriveData = useCallback(async () => {
    setIsLoadingData(true);
    setSessionExpired(false);
    setSyncConflict(false);
    setSyncError(false);
    try {
      let fileId = await findConfigFile();
      if (!fileId) {
        const defaultData: GlobalAppData = {
          accounts: [],
          expenses: [],
          history: [],
          expensesHistory: [],
          fiscalConfig: DEFAULT_FISCAL_CONFIG,
          workBenefits: DEFAULT_WORK_BENEFITS,
          config: {
            grossAnnual: 45000,
            leisureBudget: 300,
            projectSavings: 200,
            navigoBase: 90.80,
            navigoRate: 67.24,
            taxRateManual: 0,
            extraMonthlyIncome: 0,
            parentsEmail: ''
          }
        };
        fileId = await createConfigFile(defaultData);
      }
      setDriveFileId(fileId);
      const data: GlobalAppData = await readConfigFile(fileId);
      
      if (data) {
        setAccounts((data.accounts || []).map(acc => ({ ...acc, movements: acc.movements || [] })));
        setExpenses(data.expenses || []);
        setHistory(data.history || []);
        setExpensesHistory(data.expensesHistory || []);
        setGoals(data.goals || []);
        setPayslips(data.payslips || []);
        setActivePayslipId(data.activePayslipId || undefined);
        setFiscalConfig(data.fiscalConfig || DEFAULT_FISCAL_CONFIG);
        
        if (data.workBenefits) {
            setWorkBenefits(data.workBenefits);
        } else {
            const legacyNavigoBase = data.config.navigoBase || 90.80;
            const legacyNavigoRate = data.config.navigoRate || 67.24;
            setWorkBenefits({
                ...DEFAULT_WORK_BENEFITS,
                navigo: { active: true, basePrice: legacyNavigoBase, refundRate: legacyNavigoRate }
            });
        }

        if (data.config) {
          setGrossAnnual(data.config.grossAnnual ?? 45000);
          setLeisureBudget(data.config.leisureBudget ?? 300);
          setProjectSavings(data.config.projectSavings ?? 200);
          setNavigoBase(data.config.navigoBase ?? 90.80);
          setNavigoRate(data.config.navigoRate ?? 67.24);
          setTaxRateManual(data.config.taxRateManual ?? 0);
          setExtraMonthlyIncome(data.config.extraMonthlyIncome ?? 0);
          setParentsEmail(data.config.parentsEmail ?? '');
          setGeminiApiKey(data.config.geminiApiKey ?? '');
          setPickerApiKey(data.config.pickerApiKey ?? '');
        }
        if (data.lastView) setLastView(data.lastView);

        // Mémorise la révision Drive courante (détection de conflit à la sauvegarde).
        // En cas d'échec on laisse `null` : la sauvegarde auto refusera alors d'écrire
        // (voir l'effet d'auto-save) plutôt que d'écraser sans contrôle de concurrence.
        try { driveRevisionRef.current = await getFileRevision(fileId); } catch { driveRevisionRef.current = null; }

        // Détecte des modifications locales qui n'ont jamais atteint Drive (sync bloquée
        // par un conflit, une session expirée, une coupure réseau... avant fermeture).
        //
        // On compare le CONTENU canonique complet, et non plus une somme de soldes :
        // cette somme restait identique pour un virement interne, un rééquilibrage
        // part personnelle / part parentale, ou toute modification de charges, objectifs
        // et réglages — autant de cas où la sauvegarde locale était donc supprimée
        // sans alerte, et les modifications perdues silencieusement.
        try {
          const stored = localStorage.getItem(PENDING_KEY) || localStorage.getItem(BACKUP_KEY);
          if (stored) {
            const snap = JSON.parse(stored) as StoredSnapshot;
            // Une sauvegarde rattachée à un AUTRE fichier Drive appartient à un autre
            // compte Google : la proposer ici écraserait les données du compte courant.
            const sameAccount = !snap.fileId || snap.fileId === fileId;
            const diverges = canonicalize(snap.data) !== canonicalize(data);
            if (sameAccount && diverges) {
              // Mise en quarantaine : le miroir courant va être réécrit en continu, la
              // quarantaine ne bougera plus jusqu'à l'arbitrage de l'utilisateur.
              localStorage.setItem(PENDING_KEY, JSON.stringify({ ...snap, fileId }));
              setLocalBackup(snap);
            } else {
              localStorage.removeItem(PENDING_KEY);
              if (!sameAccount) localStorage.removeItem(BACKUP_KEY);
            }
          }
        } catch { /* sauvegarde illisible : on l'ignore, pas de perte supplémentaire */ }

        driveFileIdRef.current = fileId;
        // Chargement réussi : les sauvegardes automatiques sont désormais autorisées.
        hasLoadedRef.current = true;
      }
    } catch (error) {
      console.error("Erreur chargement", error);
    } finally {
      setIsLoadingData(false);
    }
  }, []);

  // Construit l'objet de données complet à partir de l'état courant.
  const buildData = useCallback((): GlobalAppData => ({
    accounts,
    expenses,
    history,
    expensesHistory,
    fiscalConfig,
    workBenefits,
    goals,
    payslips,
    activePayslipId,
    config: {
      grossAnnual, leisureBudget, projectSavings, navigoBase, navigoRate,
      taxRateManual, extraMonthlyIncome, parentsEmail, geminiApiKey, pickerApiKey
    },
    lastView: lastViewRef.current,
  }), [accounts, expenses, history, expensesHistory, fiscalConfig, workBenefits, grossAnnual,
       leisureBudget, projectSavings, navigoBase, navigoRate, taxRateManual,
       extraMonthlyIncome, parentsEmail, goals, payslips, activePayslipId, geminiApiKey, pickerApiKey]);

  // Applique un objet de données (import / rechargement) à l'état.
  const applyData = useCallback((data: GlobalAppData) => {
    setAccounts((data.accounts || []).map(acc => ({ ...acc, movements: acc.movements || [] })));
    setExpenses(data.expenses || []);
    setHistory(data.history || []);
    setExpensesHistory(data.expensesHistory || []);
    setGoals(data.goals || []);
    setPayslips(data.payslips || []);
    setActivePayslipId(data.activePayslipId || undefined);
    if (data.fiscalConfig) setFiscalConfig(data.fiscalConfig);
    if (data.workBenefits) setWorkBenefits(data.workBenefits);
    if (data.config) {
      setGrossAnnual(data.config.grossAnnual ?? 45000);
      setLeisureBudget(data.config.leisureBudget ?? 300);
      setProjectSavings(data.config.projectSavings ?? 200);
      setNavigoBase(data.config.navigoBase ?? 90.80);
      setNavigoRate(data.config.navigoRate ?? 67.24);
      setTaxRateManual(data.config.taxRateManual ?? 0);
      setExtraMonthlyIncome(data.config.extraMonthlyIncome ?? 0);
      setParentsEmail(data.config.parentsEmail ?? '');
      setGeminiApiKey(data.config.geminiApiKey ?? '');
      setPickerApiKey(data.config.pickerApiKey ?? '');
    }
  }, []);

  // Export JSON (téléchargement local de sauvegarde).
  const exportData = useCallback(() => {
    const blob = new Blob([JSON.stringify(buildData(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `suivi-epargne-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [buildData]);

  // Import JSON depuis un fichier local.
  const importData = useCallback(async (file: File): Promise<boolean> => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as GlobalAppData;
      if (!parsed || !Array.isArray(parsed.accounts)) throw new Error('Format invalide');
      applyData(parsed);
      return true;
    } catch (e) {
      console.error('Import échoué', e);
      return false;
    }
  }, [applyData]);

  // Recharge depuis Drive (résout un conflit en récupérant la dernière version distante,
  // AU PRIX de l'abandon des modifications locales non sauvegardées).
  const reloadFromDrive = useCallback(() => {
    // L'utilisateur abandonne explicitement ses modifications locales : on purge la
    // quarantaine ET le miroir, sinon le rechargement qui suit les redétecterait comme
    // divergentes et reproposerait aussitôt de restaurer ce qu'il vient de refuser.
    localStorage.removeItem(PENDING_KEY);
    localStorage.removeItem(BACKUP_KEY);
    setLocalBackup(null);
    setSyncConflict(false);
    loadDriveData();
  }, [loadDriveData]);

  // Résout un conflit en écrasant la version distante avec l'état local courant
  // (l'utilisateur choisit explicitement de garder ses modifications).
  const forceSaveToDrive = useCallback(async () => {
    if (!driveFileId) return;
    try {
      // Sérialisé (voir runExclusive) : attend qu'une sauvegarde auto déjà en vol se termine
      // avant d'écrire, pour ne jamais courir en parallèle et voir l'une écraser l'autre.
      const newRevision = await runExclusive(() => updateConfigFile(driveFileId, buildData())); // sans expectedRevision : pas de contrôle de concurrence
      driveRevisionRef.current = newRevision;
      setSyncConflict(false);
      setSyncError(false);
      setLastSavedAt(new Date());
      // L'état local est désormais sur Drive : plus rien en attente.
      localStorage.removeItem(PENDING_KEY);
      setLocalBackup(null);
    } catch (err: any) {
      if (err?.message === 'SESSION_EXPIRED') setSessionExpired(true);
      else if (err instanceof TypeError) setIsOffline(true);
      else setSyncError(true);
    }
  }, [driveFileId, buildData, runExclusive]);

  // Restaure la sauvegarde locale détectée au démarrage (l'utilisateur choisit de la garder
  // plutôt que la version Drive). Une sauvegarde normale s'enclenchera ensuite normalement.
  const restoreLocalBackup = useCallback(() => {
    if (!localBackup) return;
    applyData(localBackup.data);
    // La quarantaine a rempli son rôle : les données sont revenues dans l'état, que
    // l'auto-save va pousser sur Drive.
    localStorage.removeItem(PENDING_KEY);
    setLocalBackup(null);
  }, [localBackup, applyData]);

  const dismissLocalBackup = useCallback(() => {
    localStorage.removeItem(PENDING_KEY);
    setLocalBackup(null);
  }, []);

  // --- FILET DE SÉCURITÉ LOCAL ---
  // Miroir de l'état courant dans le navigateur : si une sauvegarde Drive reste bloquée
  // (conflit, session expirée, hors-ligne...), les modifications ne sont jamais perdues
  // silencieusement — elles restent récupérables via ce backup même après un rechargement.
  // Étiqueté avec le fichier Drive courant pour ne jamais être réappliqué à un autre
  // compte Google. Ce miroir est écrasé en continu ; ce qui doit survivre à l'arbitrage
  // de l'utilisateur vit dans PENDING_KEY (voir loadDriveData).
  useEffect(() => {
    if (!hasLoadedRef.current) return;
    try {
      const snapshot: StoredSnapshot = {
        savedAt: new Date().toISOString(),
        fileId: driveFileIdRef.current ?? undefined,
        data: buildData(),
      };
      localStorage.setItem(BACKUP_KEY, JSON.stringify(snapshot));
    } catch { /* quota localStorage dépassé : tant pis, ce n'est qu'un filet de secours */ }
  }, [buildData]);

  // --- SAUVEGARDE AUTO ---
  useEffect(() => {
    if (!isAuthenticated || !driveFileId || isLoadingData || !hasLoadedRef.current) return;
    if (syncConflict || sessionExpired) return; // on ne réécrit pas tant que non résolu
    // Hors ligne : on gèle silencieusement (le filet de sécurité local garde déjà tout).
    // `isOffline` est dans les deps ci-dessous : au retour du réseau, cet effet se
    // relance de lui-même et retente la sauvegarde sans attendre une nouvelle saisie.
    if (isOffline) return;

    setIsSaving(true);
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);

    saveTimeoutRef.current = setTimeout(async () => {
      try {
        // Sérialisé via runExclusive : si une résolution de conflit manuelle
        // (forceSaveToDrive) est en cours, on attend qu'elle se termine avant de lire
        // driveRevisionRef.current, pour ne jamais comparer contre une révision obsolète.
        const newRevision = await runExclusive(async () => {
          // Sans révision de référence, updateConfigFile écrirait SANS contrôle de
          // concurrence : une seule lecture ratée au chargement (rate-limit Drive) aurait
          // donc désactivé la détection de conflit pour toute la session, écrasant en
          // silence les modifications venues d'un autre appareil. On tente de la
          // récupérer, et on renonce à écrire si c'est impossible.
          if (!driveRevisionRef.current) {
            driveRevisionRef.current = await getFileRevision(driveFileId);
          }
          return updateConfigFile(driveFileId, buildData(), driveRevisionRef.current);
        });
        driveRevisionRef.current = newRevision;
        setSyncError(false);
        setLastSavedAt(new Date());
      } catch (err: any) {
        if (err instanceof ConflictError) {
          setSyncConflict(true); // un autre appareil a écrit : on n'écrase pas
        } else if (err?.message === 'SESSION_EXPIRED') {
          setSessionExpired(true);
        } else if (err instanceof TypeError) {
          // fetch échoue par TypeError quand la requête ne peut pas partir (réseau coupé,
          // DNS...) : navigator.onLine n'est pas toujours fiable (ex: portail captif), donc
          // on traite ce cas comme hors-ligne plutôt que comme une vraie erreur inquiétante.
          setIsOffline(true);
        } else {
          setSyncError(true);
          console.error("Erreur sauvegarde auto", err);
        }
      } finally {
        setIsSaving(false);
      }
    }, 2000);

    return () => clearTimeout(saveTimeoutRef.current);
  }, [
    accounts, expenses, history, expensesHistory, fiscalConfig, workBenefits, 
    grossAnnual, leisureBudget, projectSavings, navigoBase, navigoRate, 
    taxRateManual, extraMonthlyIncome, parentsEmail, geminiApiKey, pickerApiKey,
    isAuthenticated, driveFileId, isLoadingData,
    buildData, syncConflict, sessionExpired, goals, payslips, activePayslipId, isOffline, runExclusive
  ]);

  // Réveil périodique pour que les snapshots ci-dessous s'ouvrent sur le nouveau mois même
  // sans aucune saisie (PWA laissée ouverte, ou mois sans opération) : sans ça, ces effets
  // ne se déclenchant que sur un changement de données, l'historique pouvait sauter un mois.
  const [monthTick, setMonthTick] = useState(() => localMonthKey(new Date()));
  useEffect(() => {
    const sync = () => setMonthTick(localMonthKey(new Date()));
    const timer = setInterval(sync, 60 * 60 * 1000); // 1 h : largement suffisant
    document.addEventListener('visibilitychange', sync);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', sync); };
  }, []);

  // --- SNAPSHOT PATRIMOINE (alimente la courbe d'évolution) ---
  // Enregistre/actualise un point par mois avec le total et la part personnelle.
  // Dates en heure LOCALE (voir localMonthKey) : en UTC, une saisie le 1er du mois à
  // 00h30 heure de Paris était rattachée au mois précédent et écrasait son point.
  useEffect(() => {
    if (!hasLoadedRef.current) return;
    const total = accounts.reduce((s, a) => s + a.totalAmount, 0);
    const owned = accounts.reduce((s, a) => s + a.ownedAmount, 0);
    const now = new Date();
    const month = localMonthKey(now); // AAAA-MM
    const today = localDayKey(now);
    setHistory(prev => {
      const existing = prev.find(s => s.date.startsWith(month));
      if (existing && existing.totalAmount === total && existing.ownedAmount === owned) return prev;
      const others = prev.filter(s => !s.date.startsWith(month));
      const snapshot: PortfolioSnapshot = { date: existing ? existing.date : today, totalAmount: total, ownedAmount: owned };
      return [...others, snapshot].sort((a, b) => a.date.localeCompare(b.date));
    });
  }, [accounts, monthTick]);

  // --- SNAPSHOT CHARGES (alimente la répartition dans le temps) ---
  useEffect(() => {
    if (!hasLoadedRef.current) return;
    const total = expenses.reduce((s, e) => s + e.amount, 0);
    const now = new Date();
    const month = localMonthKey(now);
    const today = localDayKey(now);
    setExpensesHistory(prev => {
      const existing = prev.find(s => s.date.startsWith(month));
      if (existing && existing.total === total) return prev;
      const others = prev.filter(s => !s.date.startsWith(month));
      const snapshot: ExpenseSnapshot = { date: existing ? existing.date : today, total };
      return [...others, snapshot].sort((a, b) => a.date.localeCompare(b.date));
    });
  }, [expenses, monthTick]);

  // Construit et envoie l'email récapitulatif aux parents si un mouvement Livret A/LEP
  // est détecté. Factorisé pour être réutilisable par l'ajout rapide (FAB) et par les
  // actualisations de solde classiques.
  const notifyParentsIfNeeded = (updates: { account: SavingsAccount, date: string }[]) => {
    let mailBody = `
      <div style="font-family: Arial, sans-serif; color: #1e293b;">
        <h2 style="color: #4f46e5; border-bottom: 2px solid #e2e8f0; padding-bottom: 10px;">Mise à jour des comptes</h2>
        <p>Une opération a été détectée sur les livrets :</p>
        <table style="width: 100%; border-collapse: collapse; margin-top: 15px; font-size: 14px; border: 1px solid #e2e8f0;">
          <tr style="background-color: #f1f5f9; text-align: left;">
            <th style="padding: 10px; border-bottom: 1px solid #cbd5e1;">Compte</th>
            <th style="padding: 10px; border-bottom: 1px solid #cbd5e1;">Avant</th>
            <th style="padding: 10px; border-bottom: 1px solid #cbd5e1;">Après</th>
            <th style="padding: 10px; border-bottom: 1px solid #cbd5e1;">Diff</th>
          </tr>
    `;
    let shouldSendMail = false;
    const fmt = (n: number) => n.toLocaleString('fr-FR', {style:'currency', currency:'EUR'});

    updates.forEach(upd => {
       const oldAcc = accounts.find(a => a.id === upd.account.id);
       if (oldAcc) {
          const isTarget = ['Livret A', 'LEP'].includes(oldAcc.type);
          const diff = upd.account.totalAmount - oldAcc.totalAmount;
          
          if (isTarget && Math.abs(diff) > 0.001) {
             shouldSendMail = true;
             const color = diff > 0 ? '#16a34a' : '#dc2626'; // Vert/Rouge
             const sign = diff > 0 ? '+' : '';
             
             mailBody += `
                <tr style="border-bottom: 1px solid #e2e8f0;">
                  <td style="padding: 10px; vertical-align: top;">
                    <b>${oldAcc.type}</b>
                  </td>
                  <td style="padding: 10px; vertical-align: top;">
                    <b>${fmt(oldAcc.totalAmount)}</b><br/>
                    <small style="color: #64748b;">Parents: ${fmt(oldAcc.parentalCapital)}</small><br/>
                    <small style="color: #64748b;">Moi: ${fmt(oldAcc.ownedAmount)}</small>
                  </td>
                  <td style="padding: 10px; vertical-align: top;">
                    <b>${fmt(upd.account.totalAmount)}</b><br/>
                    <small style="color: #64748b;">Parents: ${fmt(upd.account.parentalCapital)}</small><br/>
                    <small style="color: #64748b;">Moi: ${fmt(upd.account.ownedAmount)}</small>
                  </td>
                  <td style="padding: 10px; vertical-align: top; color: ${color}; font-weight: bold;">
                    ${sign}${fmt(diff)}
                  </td>
                </tr>
             `;
          }
       }
    });

    mailBody += `
        </table>
        <p style="font-size: 11px; color: #94a3b8; margin-top: 20px;">
           Généré automatiquement le ${new Date().toLocaleDateString()} à ${new Date().toLocaleTimeString()}
        </p>
      </div>
    `;

    if (shouldSendMail && parentsEmail) {
        // Envoi volontairement non bloquant (la saisie ne doit pas attendre le réseau),
        // mais l'échec doit être VISIBLE : sinon un quota Gmail atteint ou un scope révoqué
        // laissait croire que les parents avaient été prévenus alors que rien n'était parti.
        setMailError(null);
        sendGmail(parentsEmail, `Mise à jour Épargne`, mailBody)
          .catch(err => {
            console.error('Envoi du mail aux parents échoué', err);
            setMailError(parentsEmail);
          });
    } else if (shouldSendMail && !parentsEmail) {
        console.warn("⚠️ Mouvement détecté mais aucun email parent configuré.");
    }
  };

  // --- LOGIQUE METIER COMPLEXE (Mouvements & Email Détaillé) ---
  const updateAccountsWithMovements = (updates: { account: SavingsAccount, date: string }[]) => {
    notifyParentsIfNeeded(updates);

    // Mise à jour de l'état
    setAccounts(prev => {
      const newAccounts = [...prev];
      updates.forEach(upd => {
        const idx = newAccounts.findIndex(a => a.id === upd.account.id);
        if (idx >= 0) {
          const oldAcc = newAccounts[idx];
          const diff = upd.account.ownedAmount - oldAcc.ownedAmount;
          if (Math.abs(diff) > 0.001) {
            const movement: AccountMovement = {
              id: crypto.randomUUID(),
              date: upd.date,
              amount: Math.abs(diff),
              label: diff > 0 ? "Actualisation (+)" : "Actualisation (-)",
              type: diff > 0 ? 'IN' : 'OUT'
            };
            newAccounts[idx] = { 
                ...upd.account, 
                movements: [...(oldAcc.movements || []), movement] 
            };
          } else {
            newAccounts[idx] = upd.account;
          }
        }
      });
      return newAccounts;
    });
  };

  const executeLinkedTransfer = (sourceId: string, destId: string, amount: number, date: string) => {
    const linkId = crypto.randomUUID();
    setAccounts(prev => {
      const next = [...prev];
      const sourceIdx = next.findIndex(a => a.id === sourceId);
      const destIdx = next.findIndex(a => a.id === destId);
      
      if (sourceIdx === -1 || destIdx === -1) return prev;
      
      const source = next[sourceIdx];
      const dest = next[destIdx];
      
      const moveOut: AccountMovement = { id: crypto.randomUUID(), date, amount, label: `Virement vers ${dest.name}`, type: 'OUT', linkId };
      next[sourceIdx] = { 
          ...source, 
          ownedAmount: source.ownedAmount - amount, 
          totalAmount: source.totalAmount - amount, 
          movements: [...(source.movements || []), moveOut] 
      };
      
      const moveIn: AccountMovement = { id: crypto.randomUUID(), date, amount, label: `Virement de ${source.name}`, type: 'IN', linkId };
      next[destIdx] = { 
          ...dest, 
          ownedAmount: dest.ownedAmount + amount, 
          totalAmount: dest.totalAmount + amount, 
          movements: [...(dest.movements || []), moveIn] 
      };
      
      return next;
    });
  };

  const resetData = () => {
      hasLoadedRef.current = false;
      driveRevisionRef.current = null;
      driveFileIdRef.current = null;
      setSyncError(false);
      setSyncConflict(false);
      setSessionExpired(false);
      setAccounts([]);
      setExpenses([]);
      setHistory([]);
      setExpensesHistory([]);
      setGoals([]);
      setPayslips([]);
      setActivePayslipId(undefined);
      setDriveFileId(null);
      // Purge des sauvegardes locales à la déconnexion : sans ça, se reconnecter avec un
      // AUTRE compte Google proposait de restaurer les données du compte précédent, et
      // accepter écrasait puis synchronisait ces données dans le Drive du nouveau compte.
      // (Les snapshots sont désormais étiquetés par fileId, ceci est la seconde barrière.)
      localStorage.removeItem(BACKUP_KEY);
      localStorage.removeItem(PENDING_KEY);
      setLocalBackup(null);
  };

  return {
    // État
    accounts, setAccounts,
    expenses, setExpenses,
    history, setHistory,
    expensesHistory, setExpensesHistory,
    goals, setGoals,
    payslips, setPayslips,
    activePayslipId, setActivePayslipId,
    fiscalConfig, setFiscalConfig,
    workBenefits, setWorkBenefits,
    grossAnnual, setGrossAnnual,
    leisureBudget, setLeisureBudget,
    projectSavings, setProjectSavings,
    navigoBase, setNavigoBase,
    navigoRate, setNavigoRate,
    taxRateManual, setTaxRateManual,
    extraMonthlyIncome, setExtraMonthlyIncome,
    parentsEmail, setParentsEmail,
    geminiApiKey, setGeminiApiKey,
    pickerApiKey, setPickerApiKey,
    lastView, setLastView,
    
    // Status
    isLoadingData,
    isSaving,
    syncError,
    syncConflict,
    sessionExpired,
    localBackup,
    lastSavedAt,
    isOffline,
    mailError,
    dismissMailError: () => setMailError(null),

    // Actions
    loadDriveData,
    reloadFromDrive,
    forceSaveToDrive,
    restoreLocalBackup,
    dismissLocalBackup,
    updateAccountsWithMovements,
    notifyParentsIfNeeded,
    executeLinkedTransfer,
    exportData,
    importData,
    resetData
  };
};