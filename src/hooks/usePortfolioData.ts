// ================================================
// FILE: src/hooks/usePortfolioData.ts
// ================================================
import { useState, useCallback, useRef, useEffect } from 'react';
import { 
  GlobalAppData, SavingsAccount, Expense, PortfolioSnapshot, ExpenseSnapshot,
  ChatMessage, FiscalConfig, WorkBenefits, AccountMovement, SavingsGoal 
} from '../types';
import { 
  DEFAULT_FISCAL_CONFIG, DEFAULT_WORK_BENEFITS 
} from '../constants';
import { 
  findConfigFile, createConfigFile, readConfigFile, updateConfigFile, sendGmail,
  getFileVersion, setOnAuthLost, ConflictError 
} from '../services/googleDriveService';

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
  const driveVersionRef = useRef<string | null>(null);
  // Sauvegarde locale trouvée au démarrage et différente de ce qui vient d'être chargé
  // depuis Drive (signe qu'une sync a échoué/été bloquée avant que l'app ne se ferme).
  const [localBackup, setLocalBackup] = useState<{ savedAt: string; data: GlobalAppData } | null>(null);
  
  // Données
  const [accounts, setAccounts] = useState<SavingsAccount[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [history, setHistory] = useState<PortfolioSnapshot[]>([]);
  const [expensesHistory, setExpensesHistory] = useState<ExpenseSnapshot[]>([]);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [goals, setGoals] = useState<SavingsGoal[]>([]);
  
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
          chatHistory: [],
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
        setChatHistory(data.chatHistory || []);
        setGoals(data.goals || []);
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
        }
        if (data.lastView) setLastView(data.lastView);

        // Mémorise la version Drive courante (détection de conflit à la sauvegarde).
        try { driveVersionRef.current = await getFileVersion(fileId); } catch { driveVersionRef.current = null; }

        // Détecte une sauvegarde locale (navigateur) dont le total des comptes diverge de
        // ce qui vient d'être chargé depuis Drive : signe qu'une sync a été bloquée (conflit,
        // session expirée...) avant que les modifications locales n'aient pu être écrites.
        try {
          const rawBackup = localStorage.getItem('suivi_epargne_backup');
          if (rawBackup) {
            const backup = JSON.parse(rawBackup) as { savedAt: string; data: GlobalAppData };
            const sum = (accs: SavingsAccount[]) => (accs || []).reduce((s, a) => s + (a.totalAmount || 0), 0);
            const driveSum = sum(data.accounts);
            const backupSum = sum(backup.data.accounts);
            if (Math.abs(driveSum - backupSum) > 0.01) setLocalBackup(backup);
            else localStorage.removeItem('suivi_epargne_backup');
          }
        } catch { /* backup illisible : on l'ignore, pas de perte supplémentaire */ }

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
    chatHistory,
    fiscalConfig,
    workBenefits,
    goals,
    config: {
      grossAnnual, leisureBudget, projectSavings, navigoBase, navigoRate,
      taxRateManual, extraMonthlyIncome, parentsEmail
    },
    lastView: lastViewRef.current,
  }), [accounts, expenses, history, expensesHistory, chatHistory, fiscalConfig, workBenefits, grossAnnual,
       leisureBudget, projectSavings, navigoBase, navigoRate, taxRateManual,
       extraMonthlyIncome, parentsEmail, goals]);

  // Applique un objet de données (import / rechargement) à l'état.
  const applyData = useCallback((data: GlobalAppData) => {
    setAccounts((data.accounts || []).map(acc => ({ ...acc, movements: acc.movements || [] })));
    setExpenses(data.expenses || []);
    setHistory(data.history || []);
    setExpensesHistory(data.expensesHistory || []);
    setChatHistory(data.chatHistory || []);
    setGoals(data.goals || []);
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
    setSyncConflict(false);
    loadDriveData();
  }, [loadDriveData]);

  // Résout un conflit en écrasant la version distante avec l'état local courant
  // (l'utilisateur choisit explicitement de garder ses modifications).
  const forceSaveToDrive = useCallback(async () => {
    if (!driveFileId) return;
    try {
      const newVersion = await updateConfigFile(driveFileId, buildData()); // sans expectedVersion : pas de contrôle de version
      driveVersionRef.current = newVersion;
      setSyncConflict(false);
      setSyncError(false);
      setLastSavedAt(new Date());
      localStorage.removeItem('suivi_epargne_backup');
    } catch (err: any) {
      if (err?.message === 'SESSION_EXPIRED') setSessionExpired(true);
      else if (err instanceof TypeError) setIsOffline(true);
      else setSyncError(true);
    }
  }, [driveFileId, buildData]);

  // Restaure la sauvegarde locale détectée au démarrage (l'utilisateur choisit de la garder
  // plutôt que la version Drive). Une sauvegarde normale s'enclenchera ensuite normalement.
  const restoreLocalBackup = useCallback(() => {
    if (!localBackup) return;
    applyData(localBackup.data);
    setLocalBackup(null);
  }, [localBackup, applyData]);

  const dismissLocalBackup = useCallback(() => {
    localStorage.removeItem('suivi_epargne_backup');
    setLocalBackup(null);
  }, []);

  // --- FILET DE SÉCURITÉ LOCAL ---
  // Miroir de l'état courant dans le navigateur : si une sauvegarde Drive reste bloquée
  // (conflit, session expirée, hors-ligne...), les modifications ne sont jamais perdues
  // silencieusement — elles restent récupérables via ce backup même après un rechargement.
  useEffect(() => {
    if (!hasLoadedRef.current) return;
    try { localStorage.setItem('suivi_epargne_backup', JSON.stringify({ savedAt: new Date().toISOString(), data: buildData() })); }
    catch { /* quota localStorage dépassé : tant pis, ce n'est qu'un filet de secours */ }
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
        const newVersion = await updateConfigFile(driveFileId, buildData(), driveVersionRef.current);
        driveVersionRef.current = newVersion;
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
    accounts, expenses, history, expensesHistory, chatHistory, fiscalConfig, workBenefits, 
    grossAnnual, leisureBudget, projectSavings, navigoBase, navigoRate, 
    taxRateManual, extraMonthlyIncome, parentsEmail, isAuthenticated, driveFileId, isLoadingData,
    buildData, syncConflict, sessionExpired, goals, isOffline
  ]);

  // --- SNAPSHOT PATRIMOINE (alimente la courbe d'évolution) ---
  // Enregistre/actualise un point par mois avec le total et la part personnelle.
  useEffect(() => {
    if (!hasLoadedRef.current) return;
    const total = accounts.reduce((s, a) => s + a.totalAmount, 0);
    const owned = accounts.reduce((s, a) => s + a.ownedAmount, 0);
    const month = new Date().toISOString().slice(0, 7); // AAAA-MM
    const today = new Date().toISOString().split('T')[0];
    setHistory(prev => {
      const existing = prev.find(s => s.date.startsWith(month));
      if (existing && existing.totalAmount === total && existing.ownedAmount === owned) return prev;
      const others = prev.filter(s => !s.date.startsWith(month));
      const snapshot: PortfolioSnapshot = { date: existing ? existing.date : today, totalAmount: total, ownedAmount: owned };
      return [...others, snapshot].sort((a, b) => a.date.localeCompare(b.date));
    });
  }, [accounts]);

  // --- SNAPSHOT CHARGES (alimente la répartition dans le temps) ---
  useEffect(() => {
    if (!hasLoadedRef.current) return;
    const total = expenses.reduce((s, e) => s + e.amount, 0);
    const month = new Date().toISOString().slice(0, 7);
    const today = new Date().toISOString().split('T')[0];
    setExpensesHistory(prev => {
      const existing = prev.find(s => s.date.startsWith(month));
      if (existing && existing.total === total) return prev;
      const others = prev.filter(s => !s.date.startsWith(month));
      const snapshot: ExpenseSnapshot = { date: existing ? existing.date : today, total };
      return [...others, snapshot].sort((a, b) => a.date.localeCompare(b.date));
    });
  }, [expenses]);

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
        sendGmail(parentsEmail, `Mise à jour Épargne`, mailBody);
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
      driveVersionRef.current = null;
      setSyncError(false);
      setSyncConflict(false);
      setSessionExpired(false);
      setAccounts([]);
      setExpenses([]);
      setHistory([]);
      setExpensesHistory([]);
      setChatHistory([]);
      setGoals([]);
      setDriveFileId(null);
  };

  return {
    // État
    accounts, setAccounts,
    expenses, setExpenses,
    history, setHistory,
    expensesHistory, setExpensesHistory,
    chatHistory, setChatHistory,
    goals, setGoals,
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