// ================================================
// FILE: src/App.tsx
// ================================================
import React, { useState, useEffect, useMemo, lazy, Suspense } from 'react';
import { SavingsAccount, AccountMovement } from './types';
import { usePortfolioData } from './hooks/usePortfolioData';
import { useTheme } from './hooks/useTheme';
import { AccountForm } from './components/AccountForm';
import { Dialog, DialogState, emptyDialog } from './components/Dialog';
import { useToasts, ToastContainer } from './components/Toast';
import { QuickAddModal } from './components/QuickAddModal';
import { BottomNav } from './components/BottomNav';
import {
  initGoogleApi, handleAuthClick, handleSignOut, isTokenValid
} from './services/googleDriveService';
import {
  LayoutDashboard, Wallet, Trash2, Edit2, ShieldCheck,
  ArrowRightLeft, RefreshCcw, PlusCircle, Cloud, LogOut,
  Loader2, Settings as SettingsIcon, AlertTriangle, RotateCw,
  Target, Coins, LineChart, Users, Calculator, Sun, Moon, Zap, Tag, Save, WifiOff
} from 'lucide-react';

// Code-splitting : les vues lourdes (recharts, etc.) sont chargées à la demande.
const Dashboard = lazy(() => import('./components/Dashboard').then(m => ({ default: m.Dashboard })));
const AccountUpdate = lazy(() => import('./components/AccountUpdate').then(m => ({ default: m.AccountUpdate })));
const AssistantPilot = lazy(() => import('./components/AssistantPilot').then(m => ({ default: m.AssistantPilot })));
const TransferManager = lazy(() => import('./components/TransferManager').then(m => ({ default: m.TransferManager })));
const Settings = lazy(() => import('./components/Settings').then(m => ({ default: m.Settings })));
const Goals = lazy(() => import('./components/Goals').then(m => ({ default: m.Goals })));
const Yield = lazy(() => import('./components/Yield').then(m => ({ default: m.Yield })));
const History = lazy(() => import('./components/History').then(m => ({ default: m.History })));
const ParentalShare = lazy(() => import('./components/ParentalShare').then(m => ({ default: m.ParentalShare })));
const WithdrawalSimulator = lazy(() => import('./components/WithdrawalSimulator').then(m => ({ default: m.WithdrawalSimulator })));

const ViewLoader = () => (
  <div className="flex justify-center items-center py-20"><Loader2 className="animate-spin w-8 h-8 text-indigo-600" /></div>
);

const NavButton = ({ active, onClick, icon: Icon, label, highlight }: any) => (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-3 text-sm font-bold transition-all rounded-xl mb-1
        ${active ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-900/20' : 'text-slate-400 dark:text-slate-500 hover:bg-slate-800 hover:text-white'}
        ${highlight ? 'text-indigo-400' : ''}
      `}
    >
      <Icon className={`w-5 h-5 ${active ? 'text-white' : highlight ? 'text-indigo-400' : 'text-slate-500 dark:text-slate-400'}`} />
      {label}
    </button>
);

type View = 'dashboard' | 'accounts' | 'transfers' | 'pilot' | 'update' | 'settings' | 'goals' | 'yield' | 'history' | 'parental' | 'simulator';

const App: React.FC = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isApiLoaded, setIsApiLoaded] = useState(false);

  const data = usePortfolioData(isAuthenticated);
  const { isDark, toggleTheme } = useTheme();
  const { toasts, addToast, dismiss } = useToasts();

  const [view, setView] = useState<View>('dashboard');
  const [editingAccount, setEditingAccount] = useState<SavingsAccount | undefined>(undefined);
  const [showForm, setShowForm] = useState(false);
  const [dialog, setDialog] = useState<DialogState>(emptyDialog);
  const [groupSmallMovements, setGroupSmallMovements] = useState(true);
  const [moreNavOpen, setMoreNavOpen] = useState(false);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [activeTagFilter, setActiveTagFilter] = useState<string | null>(null);

  // Regroupe les mouvements < 1€ (bruit typique des PEE) en une ligne synthétique.
  type DisplayMovement = AccountMovement & { grouped?: boolean };
  const buildDisplayMovements = (movements: AccountMovement[] | undefined): DisplayMovement[] => {
    const sorted = [...(movements || [])].sort((a, b) => b.date.localeCompare(a.date));
    if (!groupSmallMovements) return sorted;
    const small = sorted.filter(m => Math.abs(m.amount) < 1);
    const large = sorted.filter(m => Math.abs(m.amount) >= 1);
    if (small.length <= 1) return sorted;
    const total = small.reduce((s, m) => s + (m.type === 'IN' ? m.amount : -m.amount), 0);
    const synthetic: DisplayMovement = {
      id: '__grouped_small__',
      date: small[0].date,
      amount: Math.abs(total),
      label: `${small.length} mouvements < 1€ (total ${total >= 0 ? '+' : '-'}${Math.abs(total).toFixed(2)}€)`,
      type: total >= 0 ? 'IN' : 'OUT',
      grouped: true,
    };
    return [...large, synthetic].sort((a, b) => b.date.localeCompare(a.date));
  };

  const closeDialog = () => setDialog(emptyDialog);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    data.accounts.forEach(a => (a.tags || []).forEach(t => set.add(t)));
    return Array.from(set).sort();
  }, [data.accounts]);

  const filteredAccounts = useMemo(() => {
    if (!activeTagFilter) return data.accounts;
    return data.accounts.filter(a => (a.tags || []).includes(activeTagFilter));
  }, [data.accounts, activeTagFilter]);

  // Sync view from data (au premier chargement)
  useEffect(() => {
      if (data.lastView && view === 'dashboard') {
          const validViews: View[] = ['dashboard', 'accounts', 'transfers', 'pilot', 'update', 'settings', 'goals', 'yield', 'history', 'parental', 'simulator'];
          if (validViews.includes(data.lastView as View)) {
              setView(data.lastView as View);
          }
      }
  }, [data.lastView]);

  useEffect(() => { data.setLastView(view); }, [view]);

  // Toast discret de confirmation quand une sauvegarde vient de réussir.
  const [wasSaving, setWasSaving] = useState(false);
  useEffect(() => {
    if (wasSaving && !data.isSaving && !data.syncError) {
      addToast({ message: 'Enregistré', kind: 'success', durationMs: 1500 });
    }
    setWasSaving(data.isSaving);
  }, [data.isSaving]);

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
  }, []);

  const handleLogin = async () => {
    try {
      await handleAuthClick(false);
      setIsAuthenticated(true);
      data.loadDriveData();
    } catch (error) {
      alert("Échec de la connexion à Google Drive.");
    }
  };

  const handleReconnect = async () => {
    try {
      await handleAuthClick(false);
      data.reloadFromDrive();
    } catch (e) {
      alert("Reconnexion échouée.");
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

  const doDeleteMovement = (accountId: string, movementId: string) => {
    const account = data.accounts.find(a => a.id === accountId);
    if (!account) return;
    const movement = account.movements?.find(m => m.id === movementId);
    if (!movement) return;
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

  const undoDeleteMovement = (accountId: string, movement: AccountMovement) => {
    data.setAccounts(prev => prev.map(acc => {
      if (acc.id !== accountId) return acc;
      let newOwned = acc.ownedAmount;
      if (movement.type === 'IN') newOwned += movement.amount; else newOwned -= movement.amount;
      return {
        ...acc,
        ownedAmount: newOwned,
        totalAmount: newOwned + acc.parentalCapital,
        movements: [...(acc.movements || []), movement],
      };
    }));
  };

  const handleDeleteMovement = (accountId: string, movementId: string) => {
    const account = data.accounts.find(a => a.id === accountId);
    const movement = account?.movements?.find(m => m.id === movementId);
    setDialog({
      open: true, kind: 'confirm', danger: true, confirmLabel: 'Supprimer',
      title: 'Supprimer le mouvement',
      message: movement ? `« ${movement.label} » sera supprimé.` : undefined,
      onConfirm: () => {
        doDeleteMovement(accountId, movementId);
        if (movement && !movement.linkId) {
          addToast({
            message: 'Mouvement supprimé',
            action: { label: 'Annuler', onClick: () => undoDeleteMovement(accountId, movement) },
          });
        }
      },
    });
  };

  const handleRenameMovement = (accountId: string, movementId: string, currentLabel: string) => {
    setDialog({
      open: true, kind: 'prompt', title: 'Renommer le mouvement', defaultValue: currentLabel, confirmLabel: 'Renommer',
      onConfirm: (newLabel) => {
        if (!newLabel) return;
        data.setAccounts(prev => prev.map(acc => (acc.id !== accountId ? acc : { ...acc, movements: acc.movements?.map(m => m.id === movementId ? { ...m, label: newLabel } : m) })));
      },
    });
  };

  const handleDeleteAccount = (acc: SavingsAccount) => {
    const isEmpty = acc.totalAmount === 0;
    setDialog({
      open: true, kind: 'confirm', danger: true, confirmLabel: 'Supprimer',
      title: `Supprimer « ${acc.name} »`,
      message: isEmpty ? 'Ce compte est vide, il sera supprimé.' : 'Ce compte contient encore un solde. Supprimer définitivement ?',
      onConfirm: () => {
        data.setAccounts(prev => prev.filter(a => a.id !== acc.id));
        addToast({
          message: `« ${acc.name} » supprimé`,
          action: { label: 'Annuler', onClick: () => data.setAccounts(prev => [...prev, acc]) },
        });
      },
    });
  };

  const handleQuickAdd = (accountId: string, amount: number, type: 'IN' | 'OUT', label: string, date: string) => {
    const account = data.accounts.find(a => a.id === accountId);
    if (!account) return;
    const delta = type === 'IN' ? amount : -amount;
    const newOwned = account.ownedAmount + delta;
    const newTotal = newOwned + account.parentalCapital;
    const movement: AccountMovement = { id: crypto.randomUUID(), date, amount, label, type };

    // Notifie les parents AVANT la mise à jour d'état (le hook compare à l'état courant).
    data.notifyParentsIfNeeded([{ account: { ...account, ownedAmount: newOwned, totalAmount: newTotal }, date }]);

    data.setAccounts(prev => prev.map(a => a.id === accountId
      ? { ...a, ownedAmount: newOwned, totalAmount: newTotal, movements: [...(a.movements || []), movement] }
      : a));

    addToast({ message: `${label} — ${account.name}`, kind: 'success' });
  };

  // --- RENDU ---

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-4">
        <div className="bg-white dark:bg-slate-800 p-8 rounded-3xl shadow-2xl max-w-md w-full text-center">
          <div className="w-16 h-16 bg-indigo-600 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg shadow-indigo-500/30">
            <RefreshCcw className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-black text-slate-900 mb-2">Suivi Épargne</h1>
          <p className="text-slate-500 dark:text-slate-400 mb-8">Vos données sont stockées en sécurité sur votre Google Drive personnel.</p>
          {!isApiLoaded ? <div className="flex justify-center gap-2 text-indigo-600 font-bold"><Loader2 className="animate-spin"/> Chargement API...</div> :
            <button onClick={handleLogin} className="w-full flex justify-center gap-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 py-4 rounded-xl font-bold hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 transition-colors">Continuer avec Google</button>
          }
        </div>
      </div>
    );
  }

  if (data.isLoadingData) return <div className="min-h-screen flex justify-center items-center flex-col gap-4"><Loader2 className="animate-spin w-10 h-10 text-indigo-600"/><p className="text-slate-500 dark:text-slate-400 font-bold">Chargement du portfolio...</p></div>;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex flex-col md:flex-row font-sans text-slate-900 dark:text-slate-100">
      <aside className="hidden md:flex bg-slate-900 text-white w-full md:w-64 flex-shrink-0 flex-col border-r border-slate-800">
        <div className="p-6 border-b border-slate-800">
          <h1 className="text-xl font-bold flex items-center gap-2"><div className="w-8 h-8 bg-indigo-600 rounded flex center justify-center items-center"><RefreshCcw className="w-4 h-4 text-white"/></div> Assistant Épargne</h1>
          <div className="mt-2 text-[10px] uppercase text-slate-400 dark:text-slate-500 font-bold tracking-wider flex items-center justify-between gap-2">
            <div className="flex items-center gap-2" title={data.lastSavedAt ? `Dernière écriture confirmée sur Drive : ${data.lastSavedAt.toLocaleTimeString('fr-FR')}` : undefined}>
              <div className={`w-2 h-2 rounded-full flex-shrink-0 ${data.isOffline ? 'bg-slate-400' : data.isSaving ? 'bg-amber-500 animate-pulse' : data.syncError || data.syncConflict ? 'bg-rose-500' : 'bg-emerald-500'}`}></div>
              {data.isOffline ? 'Hors ligne' : data.isSaving ? 'Sauvegarde...' : data.syncError ? 'Erreur sync' : data.syncConflict ? 'Conflit' : data.lastSavedAt ? `Sur Drive à ${data.lastSavedAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` : 'Synchronisé'}
            </div>
            <button onClick={toggleTheme} className="text-slate-400 hover:text-white" title={isDark ? 'Passer en clair' : 'Passer en sombre'}>
              {isDark ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>
        <nav className="flex-1 p-4 overflow-y-auto">
          <NavButton active={view === 'dashboard'} onClick={() => setView('dashboard')} icon={LayoutDashboard} label="Dashboard" />
          <NavButton active={view === 'update'} onClick={() => setView('update')} icon={RefreshCcw} label="Actualiser Solde" highlight />

          <div className="pt-6 pb-2 text-[10px] font-black text-slate-600 dark:text-slate-300 uppercase px-4 tracking-widest">Analyses</div>
          <NavButton active={view === 'pilot'} onClick={() => setView('pilot')} icon={ShieldCheck} label="Pilotage" />
          <NavButton active={view === 'goals'} onClick={() => setView('goals')} icon={Target} label="Objectifs" />
          <NavButton active={view === 'yield'} onClick={() => setView('yield')} icon={Coins} label="Rendement" />
          <NavButton active={view === 'history'} onClick={() => setView('history')} icon={LineChart} label="Historique" />
          <NavButton active={view === 'parental'} onClick={() => setView('parental')} icon={Users} label="Part Parentale" />
          <NavButton active={view === 'simulator'} onClick={() => setView('simulator')} icon={Calculator} label="Simulateur" />

          <div className="pt-6 pb-2 text-[10px] font-black text-slate-600 dark:text-slate-300 uppercase px-4 tracking-widest">Gestion</div>
          <NavButton active={view === 'accounts'} onClick={() => setView('accounts')} icon={Wallet} label="Mes Comptes" />
          <NavButton active={view === 'transfers'} onClick={() => setView('transfers')} icon={ArrowRightLeft} label="Virements" />

          <div className="my-4 border-t border-slate-800 mx-4"></div>
          <NavButton active={view === 'settings'} onClick={() => setView('settings')} icon={SettingsIcon} label="Paramètres" />
        </nav>
        <div className="p-4 border-t border-slate-800">
            <button onClick={handleLogout} className="w-full flex items-center gap-3 px-4 py-3 text-rose-400 hover:bg-rose-950/30 rounded-xl font-bold text-sm transition-colors"><LogOut className="w-5 h-5"/> Déconnexion</button>
        </div>
      </aside>

      {/* Header compact mobile (la sidebar est masquée en dessous de md) */}
      <header className="md:hidden sticky top-0 z-30 bg-slate-900 text-white px-4 py-3 flex items-center justify-between">
        <h1 className="text-base font-bold flex items-center gap-2"><div className="w-6 h-6 bg-indigo-600 rounded flex items-center justify-center"><RefreshCcw className="w-3.5 h-3.5 text-white"/></div> Assistant Épargne</h1>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5" title={data.lastSavedAt ? `Dernière écriture confirmée sur Drive : ${data.lastSavedAt.toLocaleTimeString('fr-FR')}` : undefined}>
            <div className={`w-2 h-2 rounded-full flex-shrink-0 ${data.isOffline ? 'bg-slate-400' : data.isSaving ? 'bg-amber-500 animate-pulse' : data.syncError || data.syncConflict ? 'bg-rose-500' : 'bg-emerald-500'}`}></div>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">
              {data.isOffline ? 'Hors ligne' : data.isSaving ? 'Sauvegarde...' : data.syncError ? 'Erreur' : data.syncConflict ? 'Conflit' : data.lastSavedAt ? data.lastSavedAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : 'Sync'}
            </span>
          </div>
          <button onClick={toggleTheme} className="text-slate-400" title="Thème">{isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}</button>
          <button onClick={handleLogout} className="text-rose-400" title="Déconnexion"><LogOut className="w-4 h-4" /></button>
        </div>
      </header>

      <main className="flex-1 p-4 md:p-8 overflow-y-auto relative h-screen pb-24 md:pb-8">
        <div className="absolute top-4 right-4 hidden sm:flex items-center gap-2 text-[10px] text-slate-400 dark:text-slate-500 bg-white dark:bg-slate-800 px-3 py-1 rounded-full border border-slate-200 dark:border-slate-700 shadow-sm font-mono">
            <Cloud className="w-3 h-3 text-indigo-400"/> Drive: suivi_epargne.json
        </div>

        <div className="max-w-7xl mx-auto pb-20">
            {/* --- BANNIÈRES DE SYNCHRONISATION --- */}
            {data.isOffline && (
              <div className="mb-4 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4 flex items-center gap-3">
                <WifiOff className="w-5 h-5 flex-shrink-0 text-slate-500 dark:text-slate-400" />
                <div className="text-slate-600 dark:text-slate-300 text-sm font-bold">Pas de connexion. Vos modifications sont enregistrées sur cet appareil et seront envoyées sur Drive dès le retour du réseau.</div>
              </div>
            )}
            {data.sessionExpired && (
              <div className="mb-4 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-xl p-4 flex items-center justify-between gap-4">
                <div className="flex items-center gap-2 text-amber-800 dark:text-amber-300 text-sm font-bold"><AlertTriangle className="w-5 h-5 flex-shrink-0"/> Votre session Google a expiré. Reconnectez-vous pour continuer à sauvegarder.</div>
                <button onClick={handleReconnect} className="bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded-lg font-bold text-sm flex-shrink-0">Se reconnecter</button>
              </div>
            )}
            {data.syncConflict && (
              <div className="mb-4 bg-orange-50 dark:bg-orange-950/40 border border-orange-200 dark:border-orange-800 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-2 text-orange-800 dark:text-orange-300 text-sm font-bold"><AlertTriangle className="w-5 h-5 flex-shrink-0"/> Vos données ont été modifiées sur un autre appareil. Choisissez la version à garder.</div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button onClick={data.forceSaveToDrive} className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg font-bold text-sm flex items-center gap-2"><Save className="w-4 h-4"/> Garder mes modifications</button>
                  <button onClick={data.reloadFromDrive} className="bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-lg font-bold text-sm flex items-center gap-2"><RotateCw className="w-4 h-4"/> Recharger l'autre version</button>
                </div>
              </div>
            )}
            {data.syncError && !data.sessionExpired && !data.syncConflict && !data.isOffline && (
              <div className="mb-4 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-xl p-3 text-rose-700 dark:text-rose-300 text-sm font-bold flex items-center gap-2">
                <AlertTriangle className="w-4 h-4"/> La dernière sauvegarde a échoué. Une nouvelle tentative aura lieu à la prochaine modification.
              </div>
            )}
            {data.localBackup && (
              <div className="mb-4 bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-2 text-indigo-800 dark:text-indigo-300 text-sm font-bold"><AlertTriangle className="w-5 h-5 flex-shrink-0"/> Une sauvegarde locale du {new Date(data.localBackup.savedAt).toLocaleString('fr-FR')} n'a jamais été synchronisée avec Drive et diffère de ce qui est affiché. La restaurer ?</div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button onClick={data.restoreLocalBackup} className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg font-bold text-sm">Restaurer cette sauvegarde</button>
                  <button onClick={data.dismissLocalBackup} className="bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 px-4 py-2 rounded-lg font-bold text-sm">Ignorer</button>
                </div>
              </div>
            )}

            <Suspense fallback={<ViewLoader />}>
            {view === 'dashboard' && <Dashboard accounts={data.accounts} history={data.history} expenses={data.expenses} fiscalConfig={data.fiscalConfig} onDeleteAccount={handleDeleteAccount} config={{ grossAnnual: data.grossAnnual, navigoBase: data.navigoBase, navigoRate: data.navigoRate, taxRateManual: data.taxRateManual }} />}

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

            {view === 'transfers' && <TransferManager accounts={data.accounts} onUpdateAccountsComplex={data.updateAccountsWithMovements} onLinkedTransfer={data.executeLinkedTransfer} />}
            {view === 'update' && <AccountUpdate accounts={data.accounts} onUpdateAccountsComplex={data.updateAccountsWithMovements} />}

            {view === 'goals' && <Goals
                goals={data.goals}
                onUpdateGoals={data.setGoals}
                expenses={data.expenses}
                income={{ grossAnnual: data.grossAnnual, extraMonthlyIncome: data.extraMonthlyIncome, navigoBase: data.navigoBase, navigoRate: data.navigoRate, taxRateManual: data.taxRateManual, leisureBudget: data.leisureBudget, projectSavings: data.projectSavings }}
                fiscalConfig={data.fiscalConfig}
                workBenefits={data.workBenefits}
            />}
            {view === 'yield' && <Yield accounts={data.accounts} fiscalConfig={data.fiscalConfig} />}
            {view === 'history' && <History history={data.history} expensesHistory={data.expensesHistory} />}
            {view === 'parental' && <ParentalShare accounts={data.accounts} />}
            {view === 'simulator' && <WithdrawalSimulator accounts={data.accounts} expenses={data.expenses} goals={data.goals} />}

            {view === 'settings' && (
                <Settings
                    config={data.fiscalConfig}
                    workBenefits={data.workBenefits}
                    parentsEmail={data.parentsEmail}
                    onExport={data.exportData}
                    onImport={data.importData}
                    onSave={(newFiscal, newBenefits, newEmail) => {
                       data.setFiscalConfig(newFiscal);
                       data.setWorkBenefits(newBenefits);
                       data.setParentsEmail(newEmail);
                       if (newBenefits.navigo.active) {
                           data.setNavigoBase(newBenefits.navigo.basePrice);
                           data.setNavigoRate(newBenefits.navigo.refundRate);
                       }
                    }}
                />
            )}

            {view === 'accounts' && (
              <div className="space-y-6 animate-fade-in">
                <div className="flex justify-between items-center bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700">
                  <div><h2 className="text-2xl font-black text-slate-800 dark:text-slate-100">Mes Comptes</h2><p className="text-sm text-slate-500 dark:text-slate-400 font-medium">{data.accounts.length} comptes actifs</p></div>
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
                  <>
                  {allTags.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2">
                      <Tag className="w-3.5 h-3.5 text-slate-400" />
                      <button onClick={() => setActiveTagFilter(null)} className={`text-xs font-bold px-3 py-1.5 rounded-full transition-colors ${!activeTagFilter ? 'bg-indigo-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'}`}>Tous</button>
                      {allTags.map(t => (
                        <button key={t} onClick={() => setActiveTagFilter(t === activeTagFilter ? null : t)} className={`text-xs font-bold px-3 py-1.5 rounded-full transition-colors ${activeTagFilter === t ? 'bg-indigo-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'}`}>{t}</button>
                      ))}
                    </div>
                  )}
                  <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
                    <table className="w-full text-left">
                      <thead className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700">
                        <tr><th className="px-6 py-4 text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-wider">Compte</th><th className="px-6 py-4 text-[10px] text-right text-slate-400 dark:text-slate-500 uppercase tracking-wider">Mien</th><th className="px-6 py-4 text-[10px] text-right text-slate-400 dark:text-slate-500 uppercase tracking-wider">Parents</th><th className="px-6 py-4 text-right"></th></tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {filteredAccounts.map(acc => (
                          <React.Fragment key={acc.id}>
                            <tr onClick={() => setEditingAccount(editingAccount?.id === acc.id ? undefined : acc)} className="hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer group transition-colors">
                              <td className="px-6 py-4">
                                <div className="font-bold text-slate-800 dark:text-slate-100">{acc.name}</div>
                                <div className="text-[10px] uppercase text-slate-400 dark:text-slate-500 font-bold">{acc.institution}</div>
                                {acc.tags && acc.tags.length > 0 && (
                                  <div className="flex flex-wrap gap-1 mt-1">
                                    {acc.tags.map(t => <span key={t} className="text-[9px] bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-300 px-1.5 py-0.5 rounded-full font-bold normal-case">{t}</span>)}
                                  </div>
                                )}
                              </td>
                              <td className="px-6 py-4 text-right font-black text-indigo-600 text-lg">{acc.ownedAmount.toLocaleString()} €</td>
                              <td className="px-6 py-4 text-right font-bold text-amber-500">{acc.parentalCapital.toLocaleString()} €</td>
                              <td className="px-6 py-4 text-right flex justify-end gap-2 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                                 <button onClick={(e) => { e.stopPropagation(); setEditingAccount(acc); setShowForm(true); }} className="p-2 text-indigo-600 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/40 rounded-lg hover:bg-indigo-100 dark:hover:bg-indigo-900"><Edit2 className="w-4 h-4"/></button>
                                 <button onClick={(e) => { e.stopPropagation(); handleDeleteAccount(acc); }} className="p-2 text-rose-600 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 rounded-lg hover:bg-rose-100 dark:hover:bg-rose-900"><Trash2 className="w-4 h-4"/></button>
                              </td>
                            </tr>
                            {editingAccount?.id === acc.id && !showForm && (
                               <tr className="bg-slate-50 dark:bg-slate-900 animate-in slide-in-from-top-2"><td colSpan={4} className="p-4"><div className="space-y-2 p-2">
                                 <label className="flex items-center gap-2 text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase mb-1 cursor-pointer">
                                   <input type="checkbox" checked={groupSmallMovements} onChange={e => setGroupSmallMovements(e.target.checked)} className="accent-indigo-600" />
                                   Regrouper les mouvements &lt; 1€
                                 </label>
                                 <div className="max-h-60 overflow-y-auto space-y-2">
                                 {buildDisplayMovements(acc.movements).map(m => (
                                   <div key={m.id} className={`flex justify-between items-center p-3 rounded-xl text-xs border shadow-sm ${m.grouped ? 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 italic' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700'}`}>
                                     <div className="flex items-center gap-3">
                                         <span className="text-slate-400 dark:text-slate-500 font-mono bg-slate-100 dark:bg-slate-700 px-2 py-1 rounded">{m.date}</span>
                                         <span className="font-bold text-slate-700 dark:text-slate-200">{m.label}</span>
                                         {!m.grouped && <button onClick={()=>handleRenameMovement(acc.id, m.id, m.label)} className="opacity-40 hover:opacity-100"><Edit2 className="w-3 h-3 text-slate-500 dark:text-slate-400"/></button>}
                                     </div>
                                     <div className="flex items-center gap-3">
                                         <span className={`font-mono text-sm ${m.type==='IN'?'text-emerald-600 font-bold':'text-rose-600 font-bold'}`}>{m.type==='IN'?'+':'-'}{m.amount.toLocaleString()}€</span>
                                         {!m.grouped && <button onClick={()=>handleDeleteMovement(acc.id, m.id)} className="p-1 hover:bg-rose-50 rounded text-slate-400 dark:text-slate-500 hover:text-rose-500"><Trash2 className="w-4 h-4"/></button>}
                                     </div>
                                   </div>
                                 ))}
                                 {(!acc.movements || acc.movements.length===0) && <div className="text-center text-slate-400 dark:text-slate-500 italic py-4">Aucun mouvement historique.</div>}
                                 </div>
                               </div></td></tr>
                             )}
                          </React.Fragment>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  </>
                )}
              </div>
            )}
            </Suspense>
        </div>
      </main>

      {/* Bouton d'ajout rapide flottant (mobile + desktop) */}
      {data.accounts.length > 0 && (
        <button
          onClick={() => setQuickAddOpen(true)}
          className="fixed bottom-20 md:bottom-6 right-4 z-40 w-14 h-14 rounded-full bg-indigo-600 hover:bg-indigo-700 text-white shadow-lg shadow-indigo-900/30 flex items-center justify-center transition-transform hover:scale-105"
          title="Ajout rapide"
        >
          <Zap className="w-6 h-6" />
        </button>
      )}

      <QuickAddModal
        open={quickAddOpen}
        accounts={data.accounts}
        onClose={() => setQuickAddOpen(false)}
        onSubmit={handleQuickAdd}
      />

      <BottomNav
        view={view}
        setView={setView}
        moreOpen={moreNavOpen}
        setMoreOpen={setMoreNavOpen}
        moreItems={[
          { key: 'update', label: 'Actualiser', icon: RefreshCcw },
          { key: 'goals', label: 'Objectifs', icon: Target },
          { key: 'yield', label: 'Rendement', icon: Coins },
          { key: 'history', label: 'Historique', icon: LineChart },
          { key: 'parental', label: 'Part Parentale', icon: Users },
          { key: 'simulator', label: 'Simulateur', icon: Calculator },
          { key: 'settings', label: 'Paramètres', icon: SettingsIcon },
        ]}
      />

      <ToastContainer toasts={toasts} onDismiss={dismiss} />

      <Dialog state={dialog} onClose={closeDialog} />
    </div>
  );
}

export default App;
