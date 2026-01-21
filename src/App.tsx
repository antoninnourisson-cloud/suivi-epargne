import React, { useState, useEffect, useCallback, useRef } from 'react';
import { SavingsAccount, PortfolioSnapshot, AccountType, Expense, GlobalAppData } from './types';
import { Dashboard } from './components/Dashboard';
import { AccountForm } from './components/AccountForm';
import { AccountUpdate } from './components/AccountUpdate';
import { Comparator } from './components/Comparator';
import { AssistantPilot } from './components/AssistantPilot';
import { TransferManager } from './components/TransferManager';
import { Financing } from './components/Financing';
import { initGoogleApi, handleAuthClick, handleSignOut, findConfigFile, createConfigFile, readConfigFile, updateConfigFile } from './services/googleDriveService';
import { 
  LayoutDashboard, 
  Wallet, 
  Trash2, 
  Edit2, 
  BarChart2, 
  ShieldCheck, 
  ArrowRightLeft, 
  CalendarClock, 
  RefreshCcw,
  Home,
  PlusCircle,
  Cloud,
  LogOut,
  Loader2,
  HardDrive
} from 'lucide-react';

const App: React.FC = () => {
  // --- ÉTATS D'AUTHENTIFICATION & SYSTÈME ---
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isApiLoaded, setIsApiLoaded] = useState(false);
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [driveFileId, setDriveFileId] = useState<string | null>(null);
  const saveTimeoutRef = useRef<any>(null);

  // --- ÉTATS DE L'APPLICATION (Valeurs par défaut) ---
  const [accounts, setAccounts] = useState<SavingsAccount[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [history, setHistory] = useState<PortfolioSnapshot[]>([]);
  
  const [grossAnnual, setGrossAnnual] = useState<number>(45000);
  const [leisureBudget, setLeisureBudget] = useState<number>(300);
  const [projectSavings, setProjectSavings] = useState<number>(200);
  const [navigoBase, setNavigoBase] = useState<number>(90.80);
  const [navigoRate, setNavigoRate] = useState<number>(67.24);
  const [taxRateManual, setTaxRateManual] = useState<number>(6.1);
  const [extraMonthlyIncome, setExtraMonthlyIncome] = useState<number>(0);

  const [view, setView] = useState<'dashboard' | 'accounts' | 'transfers' | 'comparator' | 'pilot' | 'update' | 'financing'>('dashboard');
  const [editingAccount, setEditingAccount] = useState<SavingsAccount | undefined>(undefined);
  const [showForm, setShowForm] = useState(false);
  const [maturityAlerts, setMaturityAlerts] = useState<string[]>([]);

 // --- INITIALISATION GOOGLE API & RECONNEXION AUTO ---
  useEffect(() => {
    initGoogleApi()
      .then(async () => {
        setIsApiLoaded(true);
        
        // Vérification de la session persistante
        const persisted = localStorage.getItem('auth_persistence') === 'true';
        const timestamp = parseInt(localStorage.getItem('auth_timestamp') || '0');
        const isStillValid = Date.now() - timestamp < 24 * 60 * 60 * 1000;

        if (persisted && isStillValid) {
          try {
            // Si la session est valide, on simule l'état connecté
            // Le SDK Google gérera le jeton en arrière-plan
            setIsAuthenticated(true);
            loadDriveData(); 
          } catch (e) {
            console.error("Échec de la reconnexion automatique", e);
            localStorage.removeItem('auth_persistence');
          }
        }
      })
      .catch(err => console.error("Erreur init Google API", err));
  }, []);

  // --- GESTION CONNEXION ---
  const handleLogin = async () => {
  try {
    await handleAuthClick();
    setIsAuthenticated(true);
    // On garde une trace de la connexion réussie
    localStorage.setItem('auth_persistence', 'true');
    localStorage.setItem('auth_timestamp', Date.now().toString());
    loadDriveData();
  } catch (error) {
    console.error("Erreur de connexion", error);
    alert("Échec de la connexion à Google Drive.");
  }
};

  const handleLogout = () => {
    handleSignOut();
    setIsAuthenticated(false);
    setDriveFileId(null);
    setAccounts([]); 
    // IMPORTANT : Effacer la persistance
    localStorage.removeItem('auth_persistence');
    localStorage.removeItem('auth_timestamp');
  };

  // --- CHARGEMENT DES DONNÉES DEPUIS DRIVE ---
  const loadDriveData = async () => {
    setIsLoadingData(true);
    try {
      let fileId = await findConfigFile();
      
      if (!fileId) {
        // Création du fichier par défaut s'il n'existe pas
        const defaultData: GlobalAppData = {
          accounts: [],
          expenses: [],
          history: [],
          config: {
            grossAnnual: 45000,
            leisureBudget: 300,
            projectSavings: 200,
            navigoBase: 90.80,
            navigoRate: 67.24,
            taxRateManual: 6.1,
            extraMonthlyIncome: 0
          }
        };
        fileId = await createConfigFile(defaultData);
      }

      setDriveFileId(fileId);
      const data: GlobalAppData = await readConfigFile(fileId);

      // Hydratation des états
      if (data) {
        setAccounts((data.accounts || []).map(acc => ({
  ...acc,
  movements: acc.movements || [] // Garantit que l'historique existe toujours
})));
        setExpenses(data.expenses || []);
        setHistory(data.history || []);
        if (data.config) {
          setGrossAnnual(data.config.grossAnnual ?? 45000);
          setLeisureBudget(data.config.leisureBudget ?? 300);
          setProjectSavings(data.config.projectSavings ?? 200);
          setNavigoBase(data.config.navigoBase ?? 90.80);
          setNavigoRate(data.config.navigoRate ?? 67.24);
          setTaxRateManual(data.config.taxRateManual ?? 6.1);
          setExtraMonthlyIncome(data.config.extraMonthlyIncome ?? 0);
        }
        // Restauration de la vue et autres prefs
        if (data.lastView) setView(data.lastView as any);
        if (data.goalPrompt) localStorage.setItem('goal_prompt', data.goalPrompt); // On garde un peu de localstorage pour le cache non critique
        if (data.financing) {
           localStorage.setItem('financing_interest', data.financing.interestRate.toString());
           localStorage.setItem('financing_insurance', data.financing.insuranceRate.toString());
        }
      }

    } catch (err) {
      console.error("Erreur chargement Drive", err);
      alert("Impossible de charger votre sauvegarde Drive.");
    } finally {
      setIsLoadingData(false);
    }
  };

  // --- SAUVEGARDE AUTOMATIQUE (DEBOUNCED) ---
  useEffect(() => {
    if (!isAuthenticated || !driveFileId || isLoadingData) return;

    // Annuler le précédent timer s'il y a une nouvelle modif rapide
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);

    setIsSaving(true);
    
    saveTimeoutRef.current = setTimeout(async () => {
      const dataToSave: GlobalAppData = {
        accounts,
        expenses,
        history,
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
        goalPrompt: localStorage.getItem('goal_prompt') || '',
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
    }, 2000); // Sauvegarde après 2 secondes d'inactivité

    return () => clearTimeout(saveTimeoutRef.current);
  }, [
    accounts, expenses, history, grossAnnual, leisureBudget, 
    projectSavings, navigoBase, navigoRate, taxRateManual, 
    extraMonthlyIncome, view, isAuthenticated, driveFileId
  ]);

  // --- LOGIQUE MÉTIER (HISTORIQUE & ALERTES) ---
  useEffect(() => {
    if (accounts.length === 0) return;
    const todayStr = new Date().toISOString().split('T')[0];
    
    setHistory(prev => {
      const existingIndex = prev.findIndex(h => h.date === todayStr);
      const totalAmount = accounts.reduce((sum, a) => sum + a.totalAmount, 0);
      const ownedAmount = accounts.reduce((sum, a) => sum + a.ownedAmount, 0);
      const newSnapshot: PortfolioSnapshot = { date: todayStr, totalAmount, ownedAmount };
      
      if (existingIndex >= 0) {
        if (prev[existingIndex].totalAmount === totalAmount && prev[existingIndex].ownedAmount === ownedAmount) {
            return prev;
        }
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
  setView('dashboard');
}, []);

  const handleSaveAccount = (acc: SavingsAccount) => {
    setAccounts(prev => {
      const isNew = !prev.find(a => a.id === acc.id);
      
      if (isNew && acc.ownedAmount > 0) {
        // Initialisation automatique du journal pour un nouveau compte
        acc.movements = [{
          id: crypto.randomUUID(),
          date: new Date().toISOString().split('T')[0],
          amount: acc.ownedAmount,
          label: "Solde initial",
          type: 'IN'
        }];
      }
      
      return [...prev.filter(a => a.id !== acc.id), acc];
    });
    setShowForm(false);
    setEditingAccount(undefined);
  };

  // --- RENDU LOGIN SCREEN ---
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-4">
        <div className="bg-white p-8 rounded-3xl shadow-2xl max-w-md w-full text-center">
          <div className="w-16 h-16 bg-indigo-600 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg shadow-indigo-500/30">
            <RefreshCcw className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-black text-slate-900 mb-2">Suivi Épargne</h1>
          <p className="text-slate-500 mb-8">Vos données sont stockées en sécurité sur votre Google Drive personnel.</p>
          
          {!isApiLoaded ? (
            <div className="flex items-center justify-center gap-2 text-slate-400">
               <Loader2 className="w-5 h-5 animate-spin" /> Chargement API Google...
            </div>
          ) : (
            <button 
              onClick={handleLogin}
              className="w-full flex items-center justify-center gap-3 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-bold py-4 rounded-xl transition-all shadow-sm group"
            >
              <img src="https://www.google.com/favicon.ico" alt="Google" className="w-5 h-5" />
              <span>Continuer avec Google</span>
            </button>
          )}
          <p className="mt-6 text-[10px] text-slate-400">Fichier : suivi_epargne.json</p>
        </div>
      </div>
    );
  }

  // --- RENDU LOADING SCREEN ---
  if (isLoadingData) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center">
        <Loader2 className="w-10 h-10 text-indigo-600 animate-spin mb-4" />
        <h2 className="text-lg font-bold text-slate-700">Synchronisation Drive...</h2>
        <p className="text-slate-400 text-sm">Récupération de vos données financières</p>
      </div>
    );
  }

  // --- RENDU APPLICATION PRINCIPALE ---
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col md:flex-row font-sans text-slate-900">
      <aside className="bg-slate-900 text-white w-full md:w-64 flex-shrink-0 flex flex-col border-r border-slate-800">
        <div className="p-6 border-b border-slate-800">
          <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
              <RefreshCcw className="w-5 h-5 text-white" />
            </div>
            Assistant Épargne
          </h1>
          <div className="flex items-center gap-2 mt-3">
             <span className={`w-2 h-2 rounded-full ${isSaving ? 'bg-amber-400 animate-pulse' : 'bg-emerald-400'}`}></span>
             <span className="text-[10px] text-slate-400 font-medium uppercase tracking-widest">
               {isSaving ? 'Sauvegarde...' : 'Synchronisé'}
             </span>
          </div>
        </div>
        
        <nav className="flex-1 p-4 space-y-2">
          <NavButton active={view === 'dashboard'} onClick={() => setView('dashboard')} icon={LayoutDashboard} label="Dashboard" />
          <NavButton active={view === 'update'} onClick={() => setView('update')} icon={RefreshCcw} label="Actualiser Solde" highlight />
          
          <div className="pt-4 pb-2 px-4">
            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Analyses</p>
          </div>
          <NavButton active={view === 'pilot'} onClick={() => setView('pilot')} icon={ShieldCheck} label="Pilotage" />
          <NavButton active={view === 'comparator'} onClick={() => setView('comparator')} icon={BarChart2} label="Simulation Gain" />

          <div className="pt-4 pb-2 px-4">
            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Gestion</p>
          </div>
          <NavButton active={view === 'accounts'} onClick={() => setView('accounts')} icon={Wallet} label="Mes Comptes" />
          <NavButton active={view === 'transfers'} onClick={() => setView('transfers')} icon={ArrowRightLeft} label="Virements" />

          <div className="flex-1" />
          <div className="pt-4 pb-2 px-4 border-t border-slate-800">
            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Système</p>
          </div>
          <NavButton active={view === 'financing'} onClick={() => setView('financing')} icon={Home} label="Financement" />
          <button 
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all font-bold text-sm text-rose-400 hover:bg-slate-800 hover:text-rose-300 mt-2"
          >
            <LogOut className="w-5 h-5" /> Déconnexion
          </button>
        </nav>
      </aside>

      <main className="flex-1 p-4 md:p-8 overflow-y-auto relative">
        {/* Indicateur discret de Drive */}
        <div className="absolute top-4 right-4 flex items-center gap-2 text-[10px] text-slate-400 bg-white px-3 py-1 rounded-full shadow-sm border border-slate-100">
           <Cloud className="w-3 h-3 text-indigo-400" /> Drive: suivi_epargne.json
        </div>

        {maturityAlerts.length > 0 && (
          <div className="bg-amber-100 border-l-4 border-amber-500 text-amber-700 p-4 rounded mb-8 animate-pulse flex items-center gap-3">
            <CalendarClock className="w-6 h-6" />
            <div>{maturityAlerts.map((msg, i) => <p key={i} className="text-sm font-bold">{msg}</p>)}</div>
          </div>
        )}

        {view === 'dashboard' && (
          <Dashboard 
            accounts={accounts} 
            history={history} 
            expenses={expenses}
            config={{ grossAnnual, navigoBase, navigoRate, taxRateManual }}
          />
        )}
        {view === 'pilot' && (
          <AssistantPilot 
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
          />
        )}
        {view === 'financing' && <Financing expenses={expenses} grossAnnual={grossAnnual} />}
        {view === 'comparator' && <Comparator accounts={accounts} />}
        {view === 'transfers' && <TransferManager accounts={accounts} onUpdateAccountsComplex={handleUpdateAccountsComplex} />}
        {view === 'update' && <AccountUpdate accounts={accounts} onUpdateAccountsComplex={handleUpdateAccountsComplex} />}
        
        {view === 'accounts' && (
          <div className="space-y-6">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-2xl font-black text-slate-800">Mes Comptes Épargne</h2>
                <p className="text-sm text-slate-500">{accounts.length} compte(s) actif(s)</p>
              </div>
              {!showForm && (
                <button 
                  onClick={() => { setEditingAccount(undefined); setShowForm(true); }}
                  className="bg-indigo-600 text-white px-4 py-2 rounded-xl font-bold flex items-center gap-2 hover:bg-indigo-700 transition-all shadow-lg"
                >
                  <PlusCircle className="w-5 h-5" /> Ajouter un compte
                </button>
              )}
            </div>

            {showForm ? (
              <AccountForm 
                onSave={handleSaveAccount} 
                initialData={editingAccount} 
                onCancel={() => { setShowForm(false); setEditingAccount(undefined); }} 
              />
            ) : (
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                <table className="w-full text-left">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase">Compte</th>
                      <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase text-right">Mien</th>
                      <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase text-right">Parents</th>
                      <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {accounts.map(account => (
  <React.Fragment key={account.id}>
    <tr 
      className="hover:bg-slate-50 cursor-pointer border-b border-slate-100"
      onClick={() => setEditingAccount(editingAccount?.id === account.id ? undefined : account)}
    >
      <td className="px-6 py-4">
        <div className="font-bold text-slate-900">{account.name}</div>
        <div className="text-[10px] text-slate-400 uppercase">{account.institution}</div>
      </td>
      <td className="px-6 py-4 text-right font-black text-indigo-600">{account.ownedAmount.toLocaleString()} €</td>
      <td className="px-6 py-4 text-right font-bold text-amber-500">{account.parentalCapital.toLocaleString()} €</td>
      <td className="px-6 py-4 text-right">
        <button onClick={(e) => { e.stopPropagation(); setEditingAccount(account); setShowForm(true); }} className="p-2 text-slate-400 hover:text-indigo-600"><Edit2 className="w-4 h-4" /></button>
      </td>
    </tr>
    {editingAccount?.id === account.id && !showForm && (
      <tr>
        <td colSpan={4} className="bg-slate-50 p-4">
          <div className="space-y-2">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Journal des mouvements</p>
            {account.movements?.length > 0 ? (
              [...account.movements].sort((a,b) => b.date.localeCompare(a.date)).map(m => (
                <div key={m.id} className="flex justify-between bg-white p-2 rounded-lg border border-slate-200 text-xs shadow-sm">
                  <span>{new Date(m.date).toLocaleDateString()} - <span className="font-bold">{m.label}</span></span>
                  <span className={m.type === 'IN' ? 'text-emerald-600 font-black' : 'text-rose-600 font-black'}>
                    {m.type === 'IN' ? '+' : '-'}{m.amount.toLocaleString()} €
                  </span>
                </div>
              ))
            ) : <p className="text-xs text-slate-400 italic text-center">Aucun mouvement.</p>}
          </div>
        </td>
      </tr>
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