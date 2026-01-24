// ================================================
// FILE: src/App.tsx
// ================================================
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { SavingsAccount, PortfolioSnapshot, AccountType, Expense, GlobalAppData, AccountMovement, ChatMessage, FiscalConfig, WorkBenefits } from './types';
import { DEFAULT_FISCAL_CONFIG, DEFAULT_WORK_BENEFITS } from './constants'; 
import { Dashboard } from './components/Dashboard';
import { AccountForm } from './components/AccountForm';
import { AccountUpdate } from './components/AccountUpdate';
import { Comparator } from './components/Comparator';
import { AssistantPilot } from './components/AssistantPilot';
import { TransferManager } from './components/TransferManager';
import { Financing } from './components/Financing';
import { AIAdvisor } from './components/AIAdvisor';
import { Settings } from './components/Settings';
import { 
  initGoogleApi, 
  handleAuthClick, 
  handleSignOut, 
  findConfigFile, 
  createConfigFile, 
  readConfigFile, 
  updateConfigFile,
  isTokenValid // <--- IMPORT CRUCIAL
} from './services/googleDriveService';
import { 
  LayoutDashboard, 
  Wallet, 
  Trash2, 
  Edit2, 
  BarChart2, 
  ShieldCheck, 
  ArrowRightLeft, 
  RefreshCcw,
  Home,
  PlusCircle,
  Cloud,
  LogOut,
  Loader2,
  BrainCircuit,
  Settings as SettingsIcon
} from 'lucide-react';

const App: React.FC = () => {
  // --- 1. ÉTATS (STATE) ---
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isApiLoaded, setIsApiLoaded] = useState(false);
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [driveFileId, setDriveFileId] = useState<string | null>(null);
  const saveTimeoutRef = useRef<any>(null);

  const [accounts, setAccounts] = useState<SavingsAccount[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [history, setHistory] = useState<PortfolioSnapshot[]>([]);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  
  const [grossAnnual, setGrossAnnual] = useState<number>(45000);
  const [leisureBudget, setLeisureBudget] = useState<number>(300);
  const [projectSavings, setProjectSavings] = useState<number>(200);
  const [navigoBase, setNavigoBase] = useState<number>(90.80);
  const [navigoRate, setNavigoRate] = useState<number>(67.24);
  const [taxRateManual, setTaxRateManual] = useState<number>(0); // 0 = Auto
  const [extraMonthlyIncome, setExtraMonthlyIncome] = useState<number>(0);
  
  const [fiscalConfig, setFiscalConfig] = useState<FiscalConfig>(DEFAULT_FISCAL_CONFIG);
  const [workBenefits, setWorkBenefits] = useState<WorkBenefits>(DEFAULT_WORK_BENEFITS);

  const [view, setView] = useState<'dashboard' | 'accounts' | 'transfers' | 'comparator' | 'pilot' | 'update' | 'financing' | 'advisor' | 'settings'>('dashboard');
  const [editingAccount, setEditingAccount] = useState<SavingsAccount | undefined>(undefined);
  const [showForm, setShowForm] = useState(false);
  const [maturityAlerts, setMaturityAlerts] = useState<string[]>([]);

  // --- 2. FONCTION DE CHARGEMENT ---
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
        
        if (data.fiscalConfig) setFiscalConfig(data.fiscalConfig);
        else setFiscalConfig(DEFAULT_FISCAL_CONFIG);
        
        if (data.workBenefits) {
            setWorkBenefits(data.workBenefits);
        } else {
            // Migration douce legacy
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
        if (data.lastView) setView(data.lastView as any);
        if (data.financing) {
           localStorage.setItem('financing_interest', data.financing.interestRate.toString());
           localStorage.setItem('financing_insurance', data.financing.insuranceRate.toString());
        }
      }
    } catch (err) {
      alert("Impossible de charger votre sauvegarde Drive.");
    } finally {
      setIsLoadingData(false);
    }
  }, []);

  const handleLogin = async () => {
    try {
      await handleAuthClick(false); // False = Popup si besoin
      setIsAuthenticated(true);
      loadDriveData();
    } catch (error) {
      alert("Échec de la connexion à Google Drive.");
    }
  };

  const handleLogout = () => {
    handleSignOut();
    setIsAuthenticated(false);
    setDriveFileId(null);
    setAccounts([]); 
    setChatHistory([]);
    localStorage.removeItem('auth_persistence');
    localStorage.removeItem('auth_timestamp');
    localStorage.removeItem('token_expiry');
  };

  // --- 3. INITIALISATION & SILENT REFRESH ---
  useEffect(() => {
    initGoogleApi()
      .then(async () => {
        setIsApiLoaded(true);
        
        const storedToken = localStorage.getItem('google_token');
        const persistence = localStorage.getItem('auth_persistence') === 'true';

        if (storedToken && persistence) {
           if (isTokenValid()) {
               setIsAuthenticated(true);
               loadDriveData();
           } 
           else {
               try {
                   console.log("Token expiré, refresh silencieux...");
                   await handleAuthClick(true); // True = Silent
                   setIsAuthenticated(true);
                   loadDriveData();
               } catch (e) {
                   console.log("Refresh silencieux échoué. Login requis.");
               }
           }
        }
      })
      .catch(err => console.error("Erreur init Google API", err));
  }, [loadDriveData]);

  // --- 4. SAUVEGARDE AUTO ---
  useEffect(() => {
    if (!isAuthenticated || !driveFileId || isLoadingData) return;
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);

    setIsSaving(true);
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
        lastView: view,
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
  }, [accounts, expenses, history, chatHistory, fiscalConfig, workBenefits, grossAnnual, leisureBudget, projectSavings, navigoBase, navigoRate, taxRateManual, extraMonthlyIncome, view, isAuthenticated, driveFileId, isLoadingData]);

  // --- 5. UPDATES LOCAUX ---
  useEffect(() => {
    if (accounts.length === 0) return;
    const todayStr = new Date().toISOString().split('T')[0];
    
    setHistory(prev => {
      const existingIndex = prev.findIndex(h => h.date === todayStr);
      const totalAmount = accounts.reduce((sum, a) => sum + a.totalAmount, 0);
      const ownedAmount = accounts.reduce((sum, a) => sum + a.ownedAmount, 0);
      const newSnapshot: PortfolioSnapshot = { date: todayStr, totalAmount, ownedAmount };
      
      if (existingIndex >= 0) {
        if (prev[existingIndex].totalAmount === totalAmount && prev[existingIndex].ownedAmount === ownedAmount) return prev;
        const newHistory = [...prev];
        newHistory[existingIndex] = newSnapshot;
        return newHistory;
      } else {
        return [...prev, newSnapshot].sort((a, b) => a.date.localeCompare(b.date));
      }
    });

    const alerts: string[] = [];
    accounts.forEach(acc => {
      const today = new Date();
      if (acc.type === AccountType.PEE && acc.contractEndDate && new Date(acc.contractEndDate) <= today) {
        alerts.push(`Disponibilité PEE pour "${acc.name}" : Contrat terminé !`);
      }
    });
    setMaturityAlerts(alerts);
  }, [accounts]);

  const handleUpdateSettings = (newFiscal: FiscalConfig, newBenefits: WorkBenefits) => {
       setFiscalConfig(newFiscal);
       setWorkBenefits(newBenefits);
       if(newBenefits.navigo.active) {
           setNavigoBase(newBenefits.navigo.basePrice);
           setNavigoRate(newBenefits.navigo.refundRate);
       }
       alert("Paramètres mis à jour !");
  };

  const handleUpdateAccountsComplex = useCallback((updates: { account: SavingsAccount, date: string }[]) => {
    setAccounts(prev => {
      const newAccounts = [...prev];
      updates.forEach(upd => {
        const idx = newAccounts.findIndex(a => a.id === upd.account.id);
        if (idx >= 0) {
          const oldAcc = newAccounts[idx];
          const diff = upd.account.ownedAmount - oldAcc.ownedAmount;
          if (diff !== 0) {
            const movement: AccountMovement = {
              id: crypto.randomUUID(),
              date: upd.date,
              amount: Math.abs(diff),
              label: diff > 0 ? "Actualisation (+)" : "Actualisation (-)",
              type: diff > 0 ? 'IN' : 'OUT'
            };
            newAccounts[idx] = { ...upd.account, movements: [...(oldAcc.movements || []), movement] };
          } else {
            newAccounts[idx] = upd.account;
          }
        }
      });
      return newAccounts;
    });
    setView('dashboard');
  }, []);

  const handleLinkedTransfer = (sourceId: string, destId: string, amount: number, date: string) => {
    const linkId = crypto.randomUUID();
    setAccounts(prev => {
      const next = [...prev];
      const sourceIdx = next.findIndex(a => a.id === sourceId);
      const destIdx = next.findIndex(a => a.id === destId);
      if (sourceIdx === -1 || destIdx === -1) return prev;
      const source = next[sourceIdx];
      const dest = next[destIdx];
      const moveOut: AccountMovement = { id: crypto.randomUUID(), date, amount, label: `Virement vers ${dest.name}`, type: 'OUT', linkId };
      next[sourceIdx] = { ...source, ownedAmount: source.ownedAmount - amount, totalAmount: source.totalAmount - amount, movements: [...(source.movements || []), moveOut] };
      const moveIn: AccountMovement = { id: crypto.randomUUID(), date, amount, label: `Virement de ${source.name}`, type: 'IN', linkId };
      next[destIdx] = { ...dest, ownedAmount: dest.ownedAmount + amount, totalAmount: dest.totalAmount + amount, movements: [...(dest.movements || []), moveIn] };
      return next;
    });
    setView('dashboard');
  };

  const handleSaveAccount = (acc: SavingsAccount) => {
    setAccounts(prev => {
      const isNew = !prev.find(a => a.id === acc.id);
      if (isNew && acc.ownedAmount > 0) {
        acc.movements = [{ id: crypto.randomUUID(), date: new Date().toISOString().split('T')[0], amount: acc.ownedAmount, label: "Solde initial", type: 'IN' }];
      }
      return [...prev.filter(a => a.id !== acc.id), acc];
    });
    setShowForm(false);
    setEditingAccount(undefined);
  };

  const handleDeleteMovement = (accountId: string, movementId: string) => {
    const account = accounts.find(a => a.id === accountId);
    if (!account) return;
    const movement = account.movements?.find(m => m.id === movementId);
    if (!movement) return;
    const linkId = movement.linkId;
    if (!confirm(`Supprimer ?`)) return;
    setAccounts(prev => prev.map(acc => {
      const movToDelete = acc.movements?.find(m => m.id === movementId || (linkId && m.linkId === linkId));
      if (!movToDelete) return acc; 
      let newOwned = acc.ownedAmount;
      if (movToDelete.type === 'IN') newOwned -= movToDelete.amount; else newOwned += movToDelete.amount;
      return { ...acc, ownedAmount: newOwned, totalAmount: newOwned + acc.parentalCapital, movements: acc.movements?.filter(m => m.id !== movToDelete.id) || [] };
    }));
  };
  
  const handleRenameMovement = (accountId: string, movementId: string, currentLabel: string) => {
    const newLabel = window.prompt("Renommer :", currentLabel);
    if (!newLabel) return;
    setAccounts(prev => prev.map(acc => (acc.id !== accountId ? acc : { ...acc, movements: acc.movements?.map(m => m.id === movementId ? { ...m, label: newLabel } : m) })));
  };

  // --- 6. RENDU (JSX) ---
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-4">
        <div className="bg-white p-8 rounded-3xl shadow-2xl max-w-md w-full text-center">
          <div className="w-16 h-16 bg-indigo-600 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg shadow-indigo-500/30">
            <RefreshCcw className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-black text-slate-900 mb-2">Suivi Épargne</h1>
          <p className="text-slate-500 mb-8">Vos données sont stockées en sécurité sur votre Google Drive personnel.</p>
          {!isApiLoaded ? <div className="flex justify-center gap-2"><Loader2 className="animate-spin"/> Chargement API...</div> : 
            <button onClick={handleLogin} className="w-full flex justify-center gap-3 bg-white border border-slate-200 py-4 rounded-xl font-bold hover:bg-slate-50">Continuer avec Google</button>
          }
        </div>
      </div>
    );
  }

  if (isLoadingData) return <div className="min-h-screen flex justify-center items-center"><Loader2 className="animate-spin w-10 h-10 text-indigo-600"/></div>;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col md:flex-row font-sans text-slate-900">
      <aside className="bg-slate-900 text-white w-full md:w-64 flex-shrink-0 flex flex-col border-r border-slate-800">
        <div className="p-6 border-b border-slate-800">
          <h1 className="text-xl font-bold flex items-center gap-2"><div className="w-8 h-8 bg-indigo-600 rounded flex center"><RefreshCcw className="w-4 h-4 text-white"/></div> Assistant Épargne</h1>
          <div className="mt-2 text-[10px] uppercase text-slate-400">{isSaving ? 'Sauvegarde...' : 'Synchronisé'}</div>
        </div>
        <nav className="flex-1 p-4 space-y-2">
          <NavButton active={view === 'dashboard'} onClick={() => setView('dashboard')} icon={LayoutDashboard} label="Dashboard" />
          <NavButton active={view === 'update'} onClick={() => setView('update')} icon={RefreshCcw} label="Actualiser Solde" highlight />
          <div className="pt-4 text-[10px] font-bold text-slate-500 uppercase px-4">Analyses</div>
          <NavButton active={view === 'pilot'} onClick={() => setView('pilot')} icon={ShieldCheck} label="Pilotage" />
          <NavButton active={view === 'comparator'} onClick={() => setView('comparator')} icon={BarChart2} label="Simulation Gain" />
          <NavButton active={view === 'advisor'} onClick={() => setView('advisor')} icon={BrainCircuit} label="Conseiller IA" />
          <div className="pt-4 text-[10px] font-bold text-slate-500 uppercase px-4">Gestion</div>
          <NavButton active={view === 'accounts'} onClick={() => setView('accounts')} icon={Wallet} label="Mes Comptes" />
          <NavButton active={view === 'transfers'} onClick={() => setView('transfers')} icon={ArrowRightLeft} label="Virements" />
          <div className="flex-1" />
          <NavButton active={view === 'financing'} onClick={() => setView('financing')} icon={Home} label="Financement" />
          <NavButton active={view === 'settings'} onClick={() => setView('settings')} icon={SettingsIcon} label="Paramètres" />
          <button onClick={handleLogout} className="w-full flex items-center gap-3 px-4 py-3 text-rose-400 hover:bg-slate-800 font-bold text-sm mt-2"><LogOut className="w-5 h-5"/> Déconnexion</button>
        </nav>
      </aside>

      <main className="flex-1 p-4 md:p-8 overflow-y-auto relative">
        <div className="absolute top-4 right-4 flex items-center gap-2 text-[10px] text-slate-400 bg-white px-3 py-1 rounded-full border border-slate-100"><Cloud className="w-3 h-3 text-indigo-400"/> Drive: suivi_epargne.json</div>
        
        {maturityAlerts.length > 0 && <div className="bg-amber-100 border-l-4 border-amber-500 text-amber-700 p-4 rounded mb-8 animate-pulse">{maturityAlerts.join(' | ')}</div>}

        {view === 'dashboard' && <Dashboard accounts={accounts} history={history} expenses={expenses} config={{ grossAnnual, navigoBase, navigoRate, taxRateManual }} />}
        
        {view === 'pilot' && <AssistantPilot 
            accounts={accounts} 
            expenses={expenses} 
            onUpdateExpenses={setExpenses} 
            grossAnnual={grossAnnual} 
            setGrossAnnual={setGrossAnnual} 
            leisureBudget={leisureBudget} 
            setLeisureBudget={setLeisureBudget} 
            projectSavings={projectSavings} 
            setProjectSavings={setProjectSavings} 
            navigoBase={navigoBase} 
            setNavigoBase={setNavigoBase} 
            navigoRate={navigoRate} 
            setNavigoRate={setNavigoRate} 
            taxRateManual={taxRateManual} 
            setTaxRateManual={setTaxRateManual} 
            extraMonthlyIncome={extraMonthlyIncome} 
            setExtraMonthlyIncome={setExtraMonthlyIncome}
            fiscalConfig={fiscalConfig} 
            workBenefits={workBenefits} 
        />}
        
        {view === 'financing' && <Financing expenses={expenses} grossAnnual={grossAnnual} />}
        {view === 'comparator' && <Comparator accounts={accounts} fiscalConfig={fiscalConfig} />}
        
        {view === 'transfers' && <TransferManager accounts={accounts} onUpdateAccountsComplex={handleUpdateAccountsComplex} onLinkedTransfer={handleLinkedTransfer} />}
        
        {view === 'update' && <AccountUpdate accounts={accounts} onUpdateAccountsComplex={handleUpdateAccountsComplex} />}
        
        {view === 'advisor' && (
          <AIAdvisor 
            accounts={accounts} 
            expenses={expenses} 
            config={{ grossAnnual, navigoBase, navigoRate, taxRateManual, leisureBudget, projectSavings, extraMonthlyIncome }}
            chatHistory={chatHistory}
            onUpdateHistory={setChatHistory}
            fiscalConfig={fiscalConfig} 
            workBenefits={workBenefits}
          />
        )}

        {view === 'settings' && (
            <Settings config={fiscalConfig} workBenefits={workBenefits} onSave={handleUpdateSettings} />
        )}
        
        {view === 'accounts' && (
          <div className="space-y-6">
            <div className="flex justify-between items-center">
              <div><h2 className="text-2xl font-black text-slate-800">Mes Comptes</h2><p className="text-sm text-slate-500">{accounts.length} actifs</p></div>
              {!showForm && <button onClick={() => { setEditingAccount(undefined); setShowForm(true); }} className="bg-indigo-600 text-white px-4 py-2 rounded-xl font-bold flex gap-2"><PlusCircle className="w-5 h-5"/> Ajouter</button>}
            </div>
            {showForm ? (
              <AccountForm 
                  onSave={handleSaveAccount} 
                  initialData={editingAccount} 
                  onCancel={() => { setShowForm(false); setEditingAccount(undefined); }} 
                  fiscalConfig={fiscalConfig} 
              />
            ) : (
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                <table className="w-full text-left">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr><th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase">Compte</th><th className="px-6 py-4 text-[10px] text-right text-slate-400 uppercase">Mien</th><th className="px-6 py-4 text-[10px] text-right text-slate-400 uppercase">Parents</th><th className="px-6 py-4 text-right"></th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {accounts.map(acc => (
                      <React.Fragment key={acc.id}>
                        <tr onClick={() => setEditingAccount(editingAccount?.id === acc.id ? undefined : acc)} className="hover:bg-slate-50 cursor-pointer group">
                          <td className="px-6 py-4"><div className="font-bold">{acc.name}</div><div className="text-[10px] uppercase text-slate-400">{acc.institution}</div></td>
                          <td className="px-6 py-4 text-right font-black text-indigo-600">{acc.ownedAmount.toLocaleString()} €</td>
                          <td className="px-6 py-4 text-right font-bold text-amber-500">{acc.parentalCapital.toLocaleString()} €</td>
                          <td className="px-6 py-4 text-right flex justify-end gap-2 opacity-0 group-hover:opacity-100">
                             <button onClick={(e) => { e.stopPropagation(); setEditingAccount(acc); setShowForm(true); }} className="p-2 text-indigo-600 bg-indigo-50 rounded"><Edit2 className="w-4 h-4"/></button>
                             <button onClick={(e) => { e.stopPropagation(); if(confirm('Supprimer ?')) setAccounts(prev => prev.filter(a => a.id !== acc.id)); }} className="p-2 text-red-600 bg-red-50 rounded"><Trash2 className="w-4 h-4"/></button>
                          </td>
                        </tr>
                        {editingAccount?.id === acc.id && !showForm && (
                           <tr className="bg-slate-50"><td colSpan={4} className="p-4"><div className="max-h-60 overflow-y-auto space-y-1">
                             {acc.movements?.sort((a,b)=>b.date.localeCompare(a.date)).map(m => (
                               <div key={m.id} className="flex justify-between bg-white p-2 rounded text-xs border border-slate-200">
                                 <div><span className="text-slate-400 mr-2">{m.date}</span><span className="font-bold">{m.label}</span> <button onClick={()=>handleRenameMovement(acc.id, m.id, m.label)}><Edit2 className="w-3 h-3 text-slate-300 hover:text-indigo-500"/></button></div>
                                 <div className="flex gap-2"><span className={m.type==='IN'?'text-emerald-600 font-bold':'text-rose-600 font-bold'}>{m.type==='IN'?'+':'-'}{m.amount}€</span><button onClick={()=>handleDeleteMovement(acc.id, m.id)}><Trash2 className="w-3 h-3 text-slate-300 hover:text-red-500"/></button></div>
                               </div>
                             ))}
                             {(!acc.movements || acc.movements.length===0) && <div className="text-center text-slate-400 italic">Aucun mouvement.</div>}
                           </div></td></tr>
                        )}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
};

const NavButton = ({ active, onClick, icon: Icon, label, highlight }: any) => (
  <button onClick={onClick} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all font-bold text-sm ${active ? 'bg-indigo-600 text-white shadow-lg' : highlight ? 'text-indigo-400 bg-indigo-600/10' : 'text-slate-400 hover:bg-slate-800'}`}>
    <Icon className="w-5 h-5" /> {label}
  </button>
);

export default App;