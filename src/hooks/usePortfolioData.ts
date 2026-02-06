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
  findConfigFile, createConfigFile, readConfigFile, updateConfigFile, sendGmail 
} from '../services/googleDriveService';

export const usePortfolioData = (isAuthenticated: boolean) => {
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
  const [parentsEmail, setParentsEmail] = useState<string>(''); // <--- NOUVEAU
  
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
        setChatHistory(data.chatHistory || []);
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
          setParentsEmail(data.config.parentsEmail ?? ''); // <--- CHARGEMENT EMAIL
        }
        if (data.lastView) setLastView(data.lastView);
        
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
          extraMonthlyIncome,
          parentsEmail // <--- SAUVEGARDE EMAIL
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
    }, 2000);

    return () => clearTimeout(saveTimeoutRef.current);
  }, [
    accounts, expenses, history, chatHistory, fiscalConfig, workBenefits, 
    grossAnnual, leisureBudget, projectSavings, navigoBase, navigoRate, 
    taxRateManual, extraMonthlyIncome, parentsEmail, lastView, isAuthenticated, driveFileId, isLoadingData
  ]);

  // --- LOGIQUE METIER COMPLEXE (Mouvements & Email) ---
  const updateAccountsWithMovements = (updates: { account: SavingsAccount, date: string }[]) => {
    // 1. Préparation de l'email avant la mise à jour d'état
    // On compare les comptes actuels (state 'accounts') avec les mises à jour demandées
    let mailBody = `
      <div style="font-family: sans-serif; color: #334155;">
        <h2 style="color: #4f46e5;">Mise à jour des comptes suivis</h2>
        <p>Bonjour,</p>
        <p>Une opération vient d'être enregistrée sur les comptes réglementés :</p>
        <table style="width: 100%; border-collapse: collapse; margin-top: 10px;">
          <tr style="background-color: #f1f5f9; text-align: left;">
            <th style="padding: 8px;">Compte</th>
            <th style="padding: 8px;">Avant</th>
            <th style="padding: 8px;">Après</th>
            <th style="padding: 8px;">Mouvement</th>
          </tr>
    `;
    let shouldSendMail = false;

    // On parcourt les updates pour construire le mail
    updates.forEach(upd => {
       const oldAcc = accounts.find(a => a.id === upd.account.id);
       if (oldAcc) {
          // On vérifie le type et si le montant total a bougé
          const isTarget = ['Livret A', 'LEP'].includes(oldAcc.type);
          const diff = upd.account.totalAmount - oldAcc.totalAmount;
          
          if (isTarget && Math.abs(diff) > 0.001) {
             shouldSendMail = true;
             const color = diff > 0 ? '#10b981' : '#f43f5e';
             const sign = diff > 0 ? '+' : '';
             mailBody += `
                <tr style="border-bottom: 1px solid #e2e8f0;">
                  <td style="padding: 8px;"><strong>${oldAcc.type}</strong></td>
                  <td style="padding: 8px;">${oldAcc.totalAmount.toFixed(2)} €</td>
                  <td style="padding: 8px;"><strong>${upd.account.totalAmount.toFixed(2)} €</strong></td>
                  <td style="padding: 8px; color: ${color}; font-weight: bold;">${sign}${diff.toFixed(2)} €</td>
                </tr>
             `;
          }
       }
    });

    mailBody += `</table><p style="font-size: 12px; color: #94a3b8; margin-top: 20px;">Email automatique - Suivi Épargne</p></div>`;

    // 2. Envoi non-bloquant
    if (shouldSendMail && parentsEmail) {
        sendGmail(parentsEmail, `Mise à jour Épargne (${new Date().toLocaleDateString()})`, mailBody);
    }

    // 3. Mise à jour de l'état (classique)
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
    parentsEmail, setParentsEmail, // Export
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