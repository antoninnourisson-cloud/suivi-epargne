// ================================================
// FILE: src/App.tsx
// ================================================
import React, { useState, useEffect } from 'react';
import { SavingsAccount, AccountMovement } from './types';
import { usePortfolioData } from './hooks/usePortfolioData';
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
  initGoogleApi, handleAuthClick, handleSignOut, isTokenValid 
} from './services/googleDriveService';
import { 
  LayoutDashboard, Wallet, Trash2, Edit2, BarChart2, ShieldCheck, 
  ArrowRightLeft, RefreshCcw, Home, PlusCircle, Cloud, LogOut, 
  Loader2, BrainCircuit, Settings as SettingsIcon 
} from 'lucide-react';

const NavButton = ({ active, onClick, icon: Icon, label, highlight }: any) => (
    <button 
      onClick={onClick} 
      className={`w-full flex items-center gap-3 px-4 py-3 text-sm font-bold transition-all rounded-xl mb-1
        ${active ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-900/20' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}
        ${highlight ? 'text-indigo-400' : ''}
      `}
    >
      <Icon className={`w-5 h-5 ${active ? 'text-white' : highlight ? 'text-indigo-400' : 'text-slate-500'}`} />
      {label}
    </button>
);

const App: React.FC = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isApiLoaded, setIsApiLoaded] = useState(false);
  
  // Utilisation du Hook personnalisé pour toute la data
  const data = usePortfolioData(isAuthenticated);
  
  // UI State local (non persisté)
  const [view, setView] = useState<'dashboard' | 'accounts' | 'transfers' | 'comparator' | 'pilot' | 'update' | 'financing' | 'advisor' | 'settings'>('dashboard');
  const [editingAccount, setEditingAccount] = useState<SavingsAccount | undefined>(undefined);
  const [showForm, setShowForm] = useState(false);
  const [maturityAlerts, setMaturityAlerts] = useState<string[]>([]);

  // Sync view from data
  useEffect(() => {
      if(data.lastView && view === 'dashboard') {
          // On ne restaure la vue que si on est sur le dashboard par défaut (init)
          // Conversion safe du string en type union
          const validViews = ['dashboard', 'accounts', 'transfers', 'comparator', 'pilot', 'update', 'financing', 'advisor', 'settings'];
          if(validViews.includes(data.lastView)) {
              setView(data.lastView as any);
          }
      }
  }, [data.lastView]);

  // Update view in data when changed
  useEffect(() => {
      data.setLastView(view);
  }, [view]);

  // Init Google API
  useEffect(() => {
    initGoogleApi()
      .then(async () => {
        setIsApiLoaded(true);
        const storedToken = localStorage.getItem('google_token');
        const persistence = localStorage.getItem('auth_persistence') === 'true';
        
        if (storedToken && persistence) {
           if (isTokenValid()) {
               setIsAuthenticated(true);
               data.loadDriveData();
           } else {
               try {
                   console.log("Token expiré, refresh silencieux...");
                   await handleAuthClick(true); // Silent
                   setIsAuthenticated(true);
                   data.loadDriveData();
               } catch (e) {
                   console.log("Refresh échoué. Login requis.");
               }
           }
        }
      })
      .catch(err => console.error("Erreur init Google API", err));
  }, []); // Empty dependency array: run once

  const handleLogin = async () => {
    try {
      await handleAuthClick(false);
      setIsAuthenticated(true);
      data.loadDriveData();
    } catch (error) {
      alert("Échec de la connexion à Google Drive.");
    }
  };

  const handleLogout = () => {
    handleSignOut();
    setIsAuthenticated(false);
    data.resetData();
  };

  // --- ACTIONS METIER ---

  const handleSaveAccount = (acc: SavingsAccount) => {
    data.setAccounts(prev => {
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
    const account = data.accounts.find(a => a.id === accountId);
    if (!account) return;
    const movement = account.movements?.find(m => m.id === movementId);
    if (!movement) return;
    
    // Remplacement du confirm natif par une logique plus douce si besoin, mais confirm est ok pour suppression critique
    if (!window.confirm(`Supprimer le mouvement "${movement.label}" ?`)) return;
    
    const linkId = movement.linkId;
    data.setAccounts(prev => prev.map(acc => {
      const movToDelete = acc.movements?.find(m => m.id === movementId || (linkId && m.linkId === linkId));
      if (!movToDelete) return acc; 
      
      let newOwned = acc.ownedAmount;
      if (movToDelete.type === 'IN') newOwned -= movToDelete.amount; else newOwned += movToDelete.amount;
      
      return { 
          ...acc, 
          ownedAmount: newOwned, 
          totalAmount: newOwned + acc.parentalCapital, 
          movements: acc.movements?.filter(m => m.id !== movToDelete.id) || [] 
      };
    }));
  };

  const handleRenameMovement = (accountId: string, movementId: string, currentLabel: string) => {
      // Pour l'instant on garde prompt ici car c'est une action rare d'admin
      // Idéalement à remplacer par un input inline
      const newLabel = window.prompt("Renommer :", currentLabel);
      if (!newLabel) return;
      data.setAccounts(prev => prev.map(acc => (acc.id !== accountId ? acc : { ...acc, movements: acc.movements?.map(m => m.id === movementId ? { ...m, label: newLabel } : m) })));
  };

  // --- RENDU ---

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-4">
        <div className="bg-white p-8 rounded-3xl shadow-2xl max-w-md w-full text-center">
          <div className="w-16 h-16 bg-indigo-600 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg shadow-indigo-500/30">
            <RefreshCcw className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-black text-slate-900 mb-2">Suivi Épargne</h1>
          <p className="text-slate-500 mb-8">Vos données sont stockées en sécurité sur votre Google Drive personnel.</p>
          {!isApiLoaded ? <div className="flex justify-center gap-2 text-indigo-600 font-bold"><Loader2 className="animate-spin"/> Chargement API...</div> : 
            <button onClick={handleLogin} className="w-full flex justify-center gap-3 bg-white border border-slate-200 py-4 rounded-xl font-bold hover:bg-slate-50 text-slate-700 transition-colors">Continuer avec Google</button>
          }
        </div>
      </div>
    );
  }

  if (data.isLoadingData) return <div className="min-h-screen flex justify-center items-center flex-col gap-4"><Loader2 className="animate-spin w-10 h-10 text-indigo-600"/><p className="text-slate-500 font-bold">Déchiffrement du portfolio...</p></div>;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col md:flex-row font-sans text-slate-900">
      <aside className="bg-slate-900 text-white w-full md:w-64 flex-shrink-0 flex flex-col border-r border-slate-800">
        <div className="p-6 border-b border-slate-800">
          <h1 className="text-xl font-bold flex items-center gap-2"><div className="w-8 h-8 bg-indigo-600 rounded flex center justify-center items-center"><RefreshCcw className="w-4 h-4 text-white"/></div> Assistant Épargne</h1>
          <div className="mt-2 text-[10px] uppercase text-slate-400 font-bold tracking-wider flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${data.isSaving ? 'bg-amber-500 animate-pulse' : 'bg-emerald-500'}`}></div>
              {data.isSaving ? 'Sauvegarde...' : 'Synchronisé'}
          </div>
        </div>
        <nav className="flex-1 p-4 overflow-y-auto">
          <NavButton active={view === 'dashboard'} onClick={() => setView('dashboard')} icon={LayoutDashboard} label="Dashboard" />
          <NavButton active={view === 'update'} onClick={() => setView('update')} icon={RefreshCcw} label="Actualiser Solde" highlight />
          
          <div className="pt-6 pb-2 text-[10px] font-black text-slate-600 uppercase px-4 tracking-widest">Analyses</div>
          <NavButton active={view === 'pilot'} onClick={() => setView('pilot')} icon={ShieldCheck} label="Pilotage" />
          <NavButton active={view === 'comparator'} onClick={() => setView('comparator')} icon={BarChart2} label="Simulation Gain" />
          <NavButton active={view === 'advisor'} onClick={() => setView('advisor')} icon={BrainCircuit} label="Conseiller IA" />
          
          <div className="pt-6 pb-2 text-[10px] font-black text-slate-600 uppercase px-4 tracking-widest">Gestion</div>
          <NavButton active={view === 'accounts'} onClick={() => setView('accounts')} icon={Wallet} label="Mes Comptes" />
          <NavButton active={view === 'transfers'} onClick={() => setView('transfers')} icon={ArrowRightLeft} label="Virements" />
          
          <div className="my-4 border-t border-slate-800 mx-4"></div>
          <NavButton active={view === 'financing'} onClick={() => setView('financing')} icon={Home} label="Financement" />
          <NavButton active={view === 'settings'} onClick={() => setView('settings')} icon={SettingsIcon} label="Paramètres" />
        </nav>
        <div className="p-4 border-t border-slate-800">
            <button onClick={handleLogout} className="w-full flex items-center gap-3 px-4 py-3 text-rose-400 hover:bg-rose-950/30 rounded-xl font-bold text-sm transition-colors"><LogOut className="w-5 h-5"/> Déconnexion</button>
        </div>
      </aside>

      <main className="flex-1 p-4 md:p-8 overflow-y-auto relative h-screen">
        <div className="absolute top-4 right-4 flex items-center gap-2 text-[10px] text-slate-400 bg-white px-3 py-1 rounded-full border border-slate-200 shadow-sm font-mono">
            <Cloud className="w-3 h-3 text-indigo-400"/> Drive: suivi_epargne.json
        </div>

        <div className="max-w-7xl mx-auto pb-20">
            {view === 'dashboard' && <Dashboard accounts={data.accounts} history={data.history} expenses={data.expenses} config={{ grossAnnual: data.grossAnnual, navigoBase: data.navigoBase, navigoRate: data.navigoRate, taxRateManual: data.taxRateManual }} />}
            
            {view === 'pilot' && <AssistantPilot 
                accounts={data.accounts} 
                expenses={data.expenses} 
                onUpdateExpenses={data.setExpenses} 
                grossAnnual={data.grossAnnual} 
                setGrossAnnual={data.setGrossAnnual} 
                leisureBudget={data.leisureBudget} 
                setLeisureBudget={data.setLeisureBudget} 
                projectSavings={data.projectSavings} 
                setProjectSavings={data.setProjectSavings} 
                navigoBase={data.navigoBase} 
                setNavigoBase={data.setNavigoBase} 
                navigoRate={data.navigoRate} 
                setNavigoRate={data.setNavigoRate} 
                taxRateManual={data.taxRateManual} 
                setTaxRateManual={data.setTaxRateManual} 
                extraMonthlyIncome={data.extraMonthlyIncome} 
                setExtraMonthlyIncome={data.setExtraMonthlyIncome}
                fiscalConfig={data.fiscalConfig} 
                workBenefits={data.workBenefits} 
            />}
            
            {view === 'financing' && <Financing expenses={data.expenses} grossAnnual={data.grossAnnual} />}
            {view === 'comparator' && <Comparator accounts={data.accounts} />}
            {view === 'transfers' && <TransferManager accounts={data.accounts} onUpdateAccountsComplex={data.updateAccountsWithMovements} onLinkedTransfer={data.executeLinkedTransfer} />}
            {view === 'update' && <AccountUpdate accounts={data.accounts} onUpdateAccountsComplex={data.updateAccountsWithMovements} />}
            
            {view === 'advisor' && (
              <AIAdvisor 
                accounts={data.accounts} 
                expenses={data.expenses} 
                config={{ grossAnnual: data.grossAnnual, navigoBase: data.navigoBase, navigoRate: data.navigoRate, taxRateManual: data.taxRateManual, leisureBudget: data.leisureBudget, projectSavings: data.projectSavings, extraMonthlyIncome: data.extraMonthlyIncome }}
                chatHistory={data.chatHistory}
                onUpdateHistory={data.setChatHistory}
                fiscalConfig={data.fiscalConfig} 
                workBenefits={data.workBenefits}
              />
            )}
            
            {view === 'settings' && (
                <Settings 
                    config={data.fiscalConfig} 
                    workBenefits={data.workBenefits} 
                    onSave={(newFiscal, newBenefits) => {
                       data.setFiscalConfig(newFiscal);
                       data.setWorkBenefits(newBenefits);
                       // Rétrocompatibilité
                       if(newBenefits.navigo.active) {
                           data.setNavigoBase(newBenefits.navigo.basePrice);
                           data.setNavigoRate(newBenefits.navigo.refundRate);
                       }
                    }} 
                />
            )}

            {view === 'accounts' && (
              <div className="space-y-6 animate-fade-in">
                <div className="flex justify-between items-center bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                  <div><h2 className="text-2xl font-black text-slate-800">Mes Comptes</h2><p className="text-sm text-slate-500 font-medium">{data.accounts.length} comptes actifs</p></div>
                  {!showForm && <button onClick={() => { setEditingAccount(undefined); setShowForm(true); }} className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-3 rounded-xl font-bold flex gap-2 transition-colors shadow-lg shadow-indigo-200"><PlusCircle className="w-5 h-5"/> Ajouter un compte</button>}
                </div>
                {showForm ? (
                  <AccountForm 
                      onSave={handleSaveAccount} 
                      initialData={editingAccount} 
                      onCancel={() => { setShowForm(false); setEditingAccount(undefined); }} 
                      fiscalConfig={data.fiscalConfig} 
                  />
                ) : (
                  <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                    <table className="w-full text-left">
                      <thead className="bg-slate-50 border-b border-slate-200">
                        <tr><th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-wider">Compte</th><th className="px-6 py-4 text-[10px] text-right text-slate-400 uppercase tracking-wider">Mien</th><th className="px-6 py-4 text-[10px] text-right text-slate-400 uppercase tracking-wider">Parents</th><th className="px-6 py-4 text-right"></th></tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {data.accounts.map(acc => (
                          <React.Fragment key={acc.id}>
                            <tr onClick={() => setEditingAccount(editingAccount?.id === acc.id ? undefined : acc)} className="hover:bg-slate-50 cursor-pointer group transition-colors">
                              <td className="px-6 py-4"><div className="font-bold text-slate-800">{acc.name}</div><div className="text-[10px] uppercase text-slate-400 font-bold">{acc.institution}</div></td>
                              <td className="px-6 py-4 text-right font-black text-indigo-600 text-lg">{acc.ownedAmount.toLocaleString()} €</td>
                              <td className="px-6 py-4 text-right font-bold text-amber-500">{acc.parentalCapital.toLocaleString()} €</td>
                              <td className="px-6 py-4 text-right flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                 <button onClick={(e) => { e.stopPropagation(); setEditingAccount(acc); setShowForm(true); }} className="p-2 text-indigo-600 bg-indigo-50 rounded-lg hover:bg-indigo-100"><Edit2 className="w-4 h-4"/></button>
                                 <button onClick={(e) => { e.stopPropagation(); if(window.confirm('Supprimer définitivement ce compte ?')) data.setAccounts(prev => prev.filter(a => a.id !== acc.id)); }} className="p-2 text-rose-600 bg-rose-50 rounded-lg hover:bg-rose-100"><Trash2 className="w-4 h-4"/></button>
                              </td>
                            </tr>
                            {editingAccount?.id === acc.id && !showForm && (
                               <tr className="bg-slate-50 animate-in slide-in-from-top-2"><td colSpan={4} className="p-4"><div className="max-h-60 overflow-y-auto space-y-2 p-2">
                                 {acc.movements?.sort((a,b)=>b.date.localeCompare(a.date)).map(m => (
                                   <div key={m.id} className="flex justify-between items-center bg-white p-3 rounded-xl text-xs border border-slate-200 shadow-sm">
                                     <div className="flex items-center gap-3">
                                         <span className="text-slate-400 font-mono bg-slate-100 px-2 py-1 rounded">{m.date}</span>
                                         <span className="font-bold text-slate-700">{m.label}</span> 
                                         <button onClick={()=>handleRenameMovement(acc.id, m.id, m.label)} className="opacity-20 hover:opacity-100"><Edit2 className="w-3 h-3 text-slate-500"/></button>
                                     </div>
                                     <div className="flex items-center gap-3">
                                         <span className={`font-mono text-sm ${m.type==='IN'?'text-emerald-600 font-bold':'text-rose-600 font-bold'}`}>{m.type==='IN'?'+':'-'}{m.amount.toLocaleString()}€</span>
                                         <button onClick={()=>handleDeleteMovement(acc.id, m.id)} className="p-1 hover:bg-rose-50 rounded text-slate-300 hover:text-rose-500"><Trash2 className="w-4 h-4"/></button>
                                     </div>
                                   </div>
                                 ))}
                                 {(!acc.movements || acc.movements.length===0) && <div className="text-center text-slate-400 italic py-4">Aucun mouvement historique.</div>}
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
        </div>
      </main>
    </div>
  );
}

export default App;