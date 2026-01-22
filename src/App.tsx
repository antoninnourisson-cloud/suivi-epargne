import React, { useState, useEffect, useCallback } from 'react';
import { SavingsAccount, AccountType, Expense, GlobalAppData, ChatMessage } from './types';
import { Dashboard } from './components/Dashboard';
import { AccountForm } from './components/AccountForm';
import { AccountUpdate } from './components/AccountUpdate';
import { Comparator } from './components/Comparator';
import { AssistantPilot } from './components/AssistantPilot';
import { TransferManager } from './components/TransferManager';
import { Financing } from './components/Financing';
import { AIAdvisor } from './components/AIAdvisor';
import { initGoogleApi, handleAuthClick, handleSignOut, findConfigFile, createConfigFile, readConfigFile, updateConfigFile } from './services/googleDriveService';
import { LayoutDashboard, Wallet, BarChart2, TrendingUp, ArrowRightLeft, Target, Bot, LogOut, RefreshCw } from 'lucide-react';
import { TAX_BRACKETS, STANDARD_ALLOWANCE, SALARY_CHARGES_RATE } from './constants';

function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [accounts, setAccounts] = useState<SavingsAccount[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [config, setConfig] = useState<any>({ grossAnnual: 0, partnerSalary: 0 });
  const [showAddAccount, setShowAddAccount] = useState(false);
  const [editingAccount, setEditingAccount] = useState<SavingsAccount | null>(null);
  const [updatingAccount, setUpdatingAccount] = useState<SavingsAccount | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [driveFileId, setDriveFileId] = useState<string | null>(null);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);

  useEffect(() => {
    const init = async () => {
      try {
        await initGoogleApi();
        const token = (window as any).gapi.client.getToken();
        if (token) setIsAuthenticated(true);
      } catch (error) {
        console.error("Erreur init Google API", error);
      }
    };
    init();
  }, []);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const fileId = await findConfigFile();
      if (fileId) {
        setDriveFileId(fileId);
        const data: GlobalAppData = await readConfigFile(fileId);
        if (data) {
          setAccounts(data.accounts || []);
          setExpenses(data.expenses || []);
          setConfig(data.config || { grossAnnual: 0 });
          // CORRECTION : On lit 'history' depuis le fichier et on le met dans le state 'chatHistory'
          setChatHistory(data.history || []); 
        }
      }
    } catch (error) {
      console.error("Erreur chargement", error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) loadData();
  }, [isAuthenticated, loadData]);

  const saveData = async (newAccounts = accounts, newExpenses = expenses, newConfig = config, newHistory = chatHistory) => {
    if (!isAuthenticated) return;
    try {
      // CORRECTION : On mappe le state 'newHistory' vers la propriété 'history' attendue par GlobalAppData
      const data: GlobalAppData = { 
        accounts: newAccounts, 
        expenses: newExpenses, 
        config: newConfig,
        history: newHistory // <--- C'est ici que ça bloquait
      };
      
      if (driveFileId) {
        await updateConfigFile(driveFileId, data);
      } else {
        const newId = await createConfigFile(data);
        setDriveFileId(newId);
      }
    } catch (error) {
      console.error("Erreur sauvegarde", error);
    }
  };

  const handleSaveAccount = (account: SavingsAccount) => {
    const newAccounts = editingAccount 
      ? accounts.map(a => a.id === account.id ? account : a)
      : [...accounts, account];
    setAccounts(newAccounts);
    saveData(newAccounts);
    setShowAddAccount(false);
    setEditingAccount(null);
  };

  const handleDeleteAccount = (id: string) => {
    const newAccounts = accounts.filter(a => a.id !== id);
    setAccounts(newAccounts);
    saveData(newAccounts);
  };

  const handleUpdateConfig = (newConfig: any) => {
    setConfig(newConfig);
    saveData(accounts, expenses, newConfig);
  };

  const handleUpdateExpenses = (newExpenses: Expense[]) => {
    setExpenses(newExpenses);
    saveData(accounts, newExpenses);
  };

  // =========================================================================
  // CALCULS OMNISCIENTS
  // =========================================================================
  const grossAnnual = Number(config.grossAnnual) || 0;
  const monthlyGross = grossAnnual / 12;
  const netMonthlyBeforeTax = monthlyGross * (1 - SALARY_CHARGES_RATE);
  
  const taxableIncome = grossAnnual * (1 - STANDARD_ALLOWANCE);
  let estimatedTax = 0;
  let remainingIncome = taxableIncome;
  let prevLimit = 0;
  
  for (const bracket of TAX_BRACKETS) {
    const range = Math.min(remainingIncome, bracket.limit - prevLimit);
    if (range <= 0) break;
    estimatedTax += range * bracket.rate;
    remainingIncome -= range;
    prevLimit = bracket.limit;
  }
  
  const monthlyTax = estimatedTax / 12;
  const superNetMonthly = netMonthlyBeforeTax - monthlyTax;

  const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);
  const resteAVivre = superNetMonthly - totalExpenses;

  const isParentAccount = (name: string) => /parent|papa|maman|usufruit/i.test(name);

  const totalParent = accounts
    .filter(a => isParentAccount(a.name))
    .reduce((sum, a) => sum + a.ownedAmount, 0);

  const totalMine = accounts
    .filter(a => !isParentAccount(a.name))
    .reduce((sum, a) => sum + a.ownedAmount, 0);

  const myLiquidities = accounts
    .filter(a => !isParentAccount(a.name))
    .filter(a => !a.contractEndDate)
    .filter(a => ![AccountType.IMMOBILIER, AccountType.PER, AccountType.PEE].includes(a.type))
    .reduce((sum, a) => sum + a.ownedAmount, 0);

  const runway = totalExpenses > 0 
    ? (myLiquidities / totalExpenses).toFixed(1) 
    : "Infini";

  const computedFinancials = {
    grossAnnual,
    netMonthlyBeforeTax,
    superNetMonthly,
    totalExpenses,
    resteAVivre,
    totalParent,
    totalMine,
    myLiquidities,
    runway
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center space-y-4">
          <h1 className="text-3xl font-bold text-slate-800">Mon Suivi Épargne</h1>
          <button onClick={handleAuthClick} className="px-6 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 flex items-center gap-2 mx-auto">
            <LogOut className="w-5 h-5" /> Se connecter avec Google
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex">
      <aside className="w-64 bg-white border-r border-slate-200 fixed h-full z-10">
        <div className="p-6">
          <h1 className="text-xl font-bold text-indigo-600 flex items-center gap-2">
            <Wallet className="w-6 h-6" /> Mon Épargne
          </h1>
        </div>
        <nav className="mt-6 px-4 space-y-2">
          {[
            { id: 'dashboard', icon: LayoutDashboard, label: 'Vue d\'ensemble' },
            { id: 'pilot', icon: Target, label: 'Pilotage Budget' },
            { id: 'compare', icon: TrendingUp, label: 'Comparateur' },
            { id: 'transfers', icon: ArrowRightLeft, label: 'Transferts' },
            { id: 'financing', icon: BarChart2, label: 'Financement' },
            { id: 'advisor', icon: Bot, label: 'Conseiller IA' },
          ].map(item => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                activeTab === item.id ? 'bg-indigo-50 text-indigo-600 font-medium' : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              <item.icon className="w-5 h-5" /> {item.label}
            </button>
          ))}
        </nav>
        <div className="absolute bottom-0 w-full p-4 border-t border-slate-100">
          <button onClick={handleSignOut} className="flex items-center gap-2 text-slate-500 hover:text-red-600 text-sm w-full px-4 py-2">
            <LogOut className="w-4 h-4" /> Déconnexion
          </button>
        </div>
      </aside>

      <main className="flex-1 ml-64 p-8 overflow-auto">
        <div className="max-w-7xl mx-auto space-y-8">
          <div className="flex justify-between items-center">
             <h2 className="text-2xl font-bold text-slate-800">
               {activeTab === 'dashboard' && 'Vue d\'ensemble'}
               {activeTab === 'pilot' && 'Pilotage Budgétaire'}
               {activeTab === 'compare' && 'Comparateur de Livrets'}
               {activeTab === 'transfers' && 'Gestion des Transferts'}
               {activeTab === 'financing' && 'Capacité d\'Emprunt'}
               {activeTab === 'advisor' && 'Conseiller Personnel'}
             </h2>
             <button onClick={() => loadData()} className="p-2 text-slate-400 hover:text-indigo-600">
               <RefreshCw className={`w-5 h-5 ${isLoading ? 'animate-spin' : ''}`} />
             </button>
          </div>

          {activeTab === 'dashboard' && (
            <Dashboard 
              accounts={accounts} 
              onAddAccount={() => setShowAddAccount(true)}
              onEditAccount={(acc) => { setEditingAccount(acc); setShowAddAccount(true); }}
              onUpdateAccount={(acc) => setUpdatingAccount(acc)}
              onDeleteAccount={handleDeleteAccount}
            />
          )}

          {activeTab === 'pilot' && (
            <AssistantPilot 
              config={config} 
              expenses={expenses}
              onUpdateConfig={handleUpdateConfig}
              onUpdateExpenses={handleUpdateExpenses}
            />
          )}

          {activeTab === 'compare' && <Comparator accounts={accounts} />}
          
          {activeTab === 'transfers' && (
            <TransferManager 
              accounts={accounts} 
              onUpdateAccounts={(newAccs) => { setAccounts(newAccs); saveData(newAccs); }} 
            />
          )}
          
          {activeTab === 'financing' && <Financing accounts={accounts} />}

          {activeTab === 'advisor' && (
            <div className="max-w-4xl mx-auto">
              <AIAdvisor 
                accounts={accounts} 
                expenses={expenses} 
                config={config} 
                history={chatHistory} 
                onSaveHistory={(newHistory) => {
                  setChatHistory(newHistory);
                  saveData(accounts, expenses, config, newHistory);
                }}
                computedData={computedFinancials}
              />
            </div>
          )}
        </div>
      </main>

      {showAddAccount && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-xl w-full max-w-md">
            <h3 className="text-lg font-bold mb-4">{editingAccount ? 'Modifier' : 'Nouveau Compte'}</h3>
            <AccountForm 
              initialData={editingAccount || undefined}
              onSave={handleSaveAccount}
              onCancel={() => { setShowAddAccount(false); setEditingAccount(null); }}
            />
          </div>
        </div>
      )}

      {updatingAccount && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-xl w-full max-w-md">
            <AccountUpdate 
              account={updatingAccount}
              onUpdate={(updated) => {
                const newAccounts = accounts.map(a => a.id === updated.id ? updated : a);
                setAccounts(newAccounts);
                saveData(newAccounts);
                setUpdatingAccount(null);
              }}
              onCancel={() => setUpdatingAccount(null)}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default App;