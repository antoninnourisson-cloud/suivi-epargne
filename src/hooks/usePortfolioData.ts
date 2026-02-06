// ================================================
// FILE: src/hooks/usePortfolioData.ts
// ================================================
import { useState, useCallback, useRef, useEffect } from 'react';
import { 
  GlobalAppData, SavingsAccount, Expense, PortfolioSnapshot, 
  ChatMessage, FiscalConfig, WorkBenefits, AccountMovement 
} from '../types';
import { 
  DEFAULT_FISCAL_CONFIG, DEFAULT_WORK_BENEFITS 
} from '../constants';
import { 
  findConfigFile, createConfigFile, readConfigFile, updateConfigFile 
} from '../services/googleDriveService';

export const usePortfolioData = (isAuthenticated: boolean) => {
  const [isApiLoaded, setIsApiLoaded] = useState(false); // Géré par App.tsx pour l'init Google, mais on garde le status data ici
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [driveFileId, setDriveFileId] = useState<string | null>(null);
  
  // Données
  const [accounts, setAccounts] = useState<SavingsAccount[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [history, setHistory] = useState<PortfolioSnapshot[]>([]);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  
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
  
  const [lastView, setLastView] = useState<string>('dashboard');
  const saveTimeoutRef = useRef<any>(null);

  // --- CHARGEMENT ---
  const loadDriveData = useCallback(async () => {
    setIsLoadingData(true);
    try {
      let fileId = await findConfigFile();
      if (!fileId) {
        const defaultData: GlobalAppData = {
          accounts: [],
          expenses: [],
          history: [],
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
            extraMonthlyIncome: 0
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
        setChatHistory(data.chatHistory || []);
        setFiscalConfig(data.fiscalConfig || DEFAULT_FISCAL_CONFIG);
        
        // Migration Legacy Navigo vers WorkBenefits
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
        }
        if (data.lastView) setLastView(data.lastView);
        
        // Init localStorage financing
        if (data.financing) {
           localStorage.setItem('financing_interest', data.financing.interestRate.toString());
           localStorage.setItem('financing_insurance', data.financing.insuranceRate.toString());
        }
      }
    } catch (error) {
      console.error("Erreur chargement", error);
    } finally {
      setIsLoadingData(false);
    }
  }, []);

  // --- SAUVEGARDE AUTO ---
  useEffect(() => {
    if (!isAuthenticated || !driveFileId || isLoadingData) return;

    setIsSaving(true);
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);

    saveTimeoutRef.current = setTimeout(async () => {
      const dataToSave: GlobalAppData = {
        accounts,
        expenses,
        history,
        chatHistory,
        fiscalConfig,
        workBenefits,
        config: {
          grossAnnual,
          leisureBudget,
          projectSavings,
          navigoBase,
          navigoRate,
          taxRateManual,
          extraMonthlyIncome
        },
        lastView,
        financing: {
            interestRate: parseFloat(localStorage.getItem('financing_interest') || '3.5'),
            insuranceRate: parseFloat(localStorage.getItem('financing_insurance') || '0.3')
        }
      };

      try {
        await updateConfigFile(driveFileId, dataToSave);
      } catch (err) {
        console.error("Erreur sauvegarde auto", err);
      } finally {
        setIsSaving(false);
      }
    }, 2000); // Debounce de 2s

    return () => clearTimeout(saveTimeoutRef.current);
  }, [
    accounts, expenses, history, chatHistory, fiscalConfig, workBenefits, 
    grossAnnual, leisureBudget, projectSavings, navigoBase, navigoRate, 
    taxRateManual, extraMonthlyIncome, lastView, isAuthenticated, driveFileId, isLoadingData
  ]);

  // --- LOGIQUE METIER COMPLEXE (Mouvements) ---
  const updateAccountsWithMovements = (updates: { account: SavingsAccount, date: string }[]) => {
    setAccounts(prev => {
      const newAccounts = [...prev];
      updates.forEach(upd => {
        const idx = newAccounts.findIndex(a => a.id === upd.account.id);
        if (idx >= 0) {
          const oldAcc = newAccounts[idx];
          const diff = upd.account.ownedAmount - oldAcc.ownedAmount;
          if (Math.abs(diff) > 0.001) { // Floating point safety
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
      setAccounts([]);
      setExpenses([]);
      setHistory([]);
      setChatHistory([]);
      setDriveFileId(null);
  };

  return {
    // État
    accounts, setAccounts,
    expenses, setExpenses,
    history, setHistory,
    chatHistory, setChatHistory,
    fiscalConfig, setFiscalConfig,
    workBenefits, setWorkBenefits,
    grossAnnual, setGrossAnnual,
    leisureBudget, setLeisureBudget,
    projectSavings, setProjectSavings,
    navigoBase, setNavigoBase,
    navigoRate, setNavigoRate,
    taxRateManual, setTaxRateManual,
    extraMonthlyIncome, setExtraMonthlyIncome,
    lastView, setLastView,
    
    // Status
    isLoadingData,
    isSaving,
    
    // Actions
    loadDriveData,
    updateAccountsWithMovements,
    executeLinkedTransfer,
    resetData
  };
};