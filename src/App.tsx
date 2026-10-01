// ================================================
// FILE: src/App.tsx
// ================================================
import React, { useState, useEffect, useMemo, useRef, lazy, Suspense } from 'react';
import { SavingsAccount, AccountMovement, PayslipRecord } from './types';
import { usePortfolioData } from './hooks/usePortfolioData';
import { useTheme } from './hooks/useTheme';
import { AccountForm } from './components/AccountForm';
import { Dialog, DialogState, emptyDialog } from './components/Dialog';
import { useToasts, ToastContainer, ToastContext } from './components/Toast';
import { QuickAddModal } from './components/QuickAddModal';
import { BottomNav } from './components/BottomNav';
import { AppLockScreen } from './components/AppLockScreen';
import {
  initGoogleApi, handleAuthClick, handleSignOut, isTokenValid, completeBackendLoginIfPresent
} from './services/googleDriveService';
import { isBackendEnabled, hasBackendSession } from './services/backendService';
import { disablePush } from './services/pushService';
import { isLockEnabled } from './services/appLockService';
import { computeMaturityCountdown, depositsAfterCashFlow, computeMonthlySavingsCapacity, subscriptionsAsExpenses, computeMonthlyPay, computeRestitutionPlan, accountsAfterRestitution, computeAccruedParentalInterest } from './lib/finance';
import { localTodayISO, parseISODate } from './lib/dates';
import { formatEUR, formatSignedEUR } from './lib/format';
import { MovementSearch } from './components/MovementSearch';
import { AccountTotal } from './components/AccountTotal';
// Importé ici (et pas dans l'écran, chargé à la demande) pour capter l'invitation d'installation dès le démarrage.
import './services/installPrompt';
import {
  LayoutDashboard, Wallet, Trash2, Edit2, ShieldCheck,
  ArrowRightLeft, RefreshCcw, PlusCircle, Cloud, LogOut,
  Loader2, Settings as SettingsIcon, AlertTriangle, RotateCw,
  Coins, LineChart, Users, Sun, Moon, Zap, Tag, Save, WifiOff, FileText, Clock, CalendarClock, HandHeart, CalendarDays
} from 'lucide-react';

// Code-splitting : les vues lourdes (recharts, etc.) sont chargées à la demande.
const Agenda = lazy(() => import('./components/Agenda').then(m => ({ default: m.Agenda })));
const Donations = lazy(() => import('./components/Donations').then(m => ({ default: m.Donations })));
const Subscriptions = lazy(() => import('./components/Subscriptions').then(m => ({ default: m.Subscriptions })));
const Dashboard = lazy(() => import('./components/Dashboard').then(m => ({ default: m.Dashboard })));
const AccountUpdate = lazy(() => import('./components/AccountUpdate').then(m => ({ default: m.AccountUpdate })));
const AssistantPilot = lazy(() => import('./components/AssistantPilot').then(m => ({ default: m.AssistantPilot })));
const TransferManager = lazy(() => import('./components/TransferManager').then(m => ({ default: m.TransferManager })));
const Settings = lazy(() => import('./components/Settings').then(m => ({ default: m.Settings })));
const Yield = lazy(() => import('./components/Yield').then(m => ({ default: m.Yield })));
const History = lazy(() => import('./components/History').then(m => ({ default: m.History })));
const ParentalShare = lazy(() => import('./components/ParentalShare').then(m => ({ default: m.ParentalShare })));
const Payslips = lazy(() => import('./components/Payslips').then(m => ({ default: m.Payslips })));

const ViewLoader = () => (
  <div className="flex justify-center items-center py-20"><Loader2 className="animate-spin w-8 h-8 text-indigo-600" /></div>
);

const NavButton = ({ active, onClick, icon: Icon, label, highlight }: any) => (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-3 text-sm font-bold transition-all rounded-xl mb-1
        ${active ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-900/20' : 'text-slate-500 dark:text-slate-400 hover:bg-slate-800 hover:text-white'}
        ${highlight ? 'text-indigo-400' : ''}
      `}
    >
      <Icon className={`w-5 h-5 ${active ? 'text-white' : highlight ? 'text-indigo-400' : 'text-slate-500 dark:text-slate-400'}`} />
      {label}
    </button>
);

type View = 'dashboard' | 'accounts' | 'transfers' | 'pilot' | 'update' | 'settings' | 'yield' | 'history' | 'parental' | 'payslips' | 'subscriptions' | 'donations' | 'agenda';
const VALID_VIEWS: View[] = ['dashboard', 'accounts', 'transfers', 'pilot', 'update', 'settings', 'yield', 'history', 'parental', 'payslips', 'subscriptions', 'donations', 'agenda'];

const App: React.FC = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isApiLoaded, setIsApiLoaded] = useState(false);
  const [apiError, setApiError] = useState(false);
  // Verrou biométrique local (propre à cet appareil, jamais synchronisé) : verrouillé par
  // défaut si un credential a été enregistré sur CE navigateur, débloqué après succès de
  // la vérification WebAuthn (voir AppLockScreen / appLockService).
  const [locked, setLocked] = useState<boolean>(() => isLockEnabled());

  // Ré-active le verrou dès que l'app repasse au premier plan après avoir été masquée
  // (bouton Home, changement d'appli, écran éteint...). Sur mobile, quitter l'app ne
  // recharge pas la page — le process JS reste vivant en mémoire tant que l'OS ne le tue
  // pas — donc sans ceci, un simple aller-retour laisserait l'app déverrouillée
  // indéfiniment, ce qui viderait le verrou de son intérêt.
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden' && isLockEnabled()) {
        setLocked(true);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

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

  // Raccourci PWA "Ajouter un mouvement" (appui long sur l'icône, voir vite.config.ts) :
  // ouvre directement la modale au lieu d'atterrir sur le Dashboard nu. On attend
  // authentification + déverrouillage pour ne pas exposer la modale par-dessus l'écran de
  // login/verrou, et on nettoie l'URL ensuite pour qu'un simple reload ne la rouvre pas.
  useEffect(() => {
    if (!isAuthenticated || locked) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('action') === 'quickadd') {
      setQuickAddOpen(true);
      params.delete('action');
      const rest = params.toString();
      window.history.replaceState({}, '', window.location.pathname + (rest ? `?${rest}` : ''));
    }
  }, [isAuthenticated, locked]);

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
      label: `${small.length} mouvements < 1 € (total ${formatSignedEUR(total, 2)})`,
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

  const activePayslipRecord = useMemo(
    () => data.payslips.find(p => p.id === data.activePayslipId),
    [data.payslips, data.activePayslipId]
  );

  // Objet stable : un littéral inline invaliderait les useMemo du Dashboard
  // à chaque rendu d'App.
  const dashboardConfig = useMemo(() => ({
    grossAnnual: data.grossAnnual, navigoBase: data.navigoBase,
    navigoRate: data.navigoRate, taxRateManual: data.taxRateManual,
  }), [data.grossAnnual, data.navigoBase, data.navigoRate, data.taxRateManual]);

  // Charges fixes vues par les écrans en lecture seule (survie, objectifs, simulateur) :
  // charges saisies + abonnements actifs. Le Pilotage, lui, les affiche séparément.
  const allCharges = useMemo(
    () => [...data.expenses, ...subscriptionsAsExpenses(data.subscriptions)],
    [data.expenses, data.subscriptions]
  );

  // Objectif du mois pour la jauge « Placé ce mois-ci » : même montant que le rappel de paie.
  const monthPlan = useMemo(
    () => data.paydayAmount ?? computeMonthlySavingsCapacity(data.buildData()),
    [data.paydayAmount, data.buildData]
  );
  const monthlyPay = useMemo(() => computeMonthlyPay(data.buildData()), [data.buildData]);
  // Instantané complet des données (agenda, bilan annuel).
  const fullData = useMemo(() => data.buildData(), [data.buildData]);

  // Lien direct vers un écran (`?view=update`), utilisé par les notifications. Traité
  // après authentification + déverrouillage, comme le raccourci d'ajout rapide.
  const deepLinkedRef = useRef(false);

  // Le bouton d'ajout rapide recouvrait les montants alignés à droite : il s'efface quand
  // on fait défiler vers le bas et revient dès qu'on remonte.
  const [fabHidden, setFabHidden] = useState(false);
  const lastScrollRef = useRef(0);
  const handleMainScroll = (e: React.UIEvent<HTMLElement>) => {
    const y = e.currentTarget.scrollTop;
    const delta = y - lastScrollRef.current;
    if (Math.abs(delta) > 8) setFabHidden(delta > 0 && y > 80);
    lastScrollRef.current = y;
  };
  useEffect(() => { setFabHidden(false); lastScrollRef.current = 0; }, [view]);

  // Les écrans sont chargés à la demande : on précharge les plus utilisés une fois connecté,
  // pour éviter le petit temps de chargement à leur première ouverture.
  useEffect(() => {
    if (!isAuthenticated) return;
    const t = setTimeout(() => {
      import('./components/AccountUpdate'); import('./components/AssistantPilot');
      import('./components/TransferManager'); import('./components/Yield');
    }, 1500);
    return () => clearTimeout(t);
  }, [isAuthenticated]);
  useEffect(() => {
    if (!isAuthenticated || locked) return;
    const params = new URLSearchParams(window.location.search);
    const target = params.get('view') as View | null;
    // Écran inconnu de cette version (lien d'une version plus récente, encore en cours de
    // mise à jour) : on laisse le lien dans l'adresse pour que la nouvelle version, chargée
    // juste après, l'ouvre.
    if (target && VALID_VIEWS.includes(target)) {
      deepLinkedRef.current = true; setView(target);
      params.delete('view');
      const rest = params.toString();
      window.history.replaceState({}, '', window.location.pathname + (rest ? `?${rest}` : ''));
    }
  }, [isAuthenticated, locked]);

  // App déjà ouverte au clic sur une notification : le service worker la ramène au
  // premier plan et envoie l'écran à afficher (sans recharger la page).
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const onMessage = (e: MessageEvent) => {
      const target = e.data && e.data.type === 'open-view' ? e.data.view as View : null;
      if (target && VALID_VIEWS.includes(target)) { deepLinkedRef.current = true; setView(target); }
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, []);

  // Sync view from data (au premier chargement)
  useEffect(() => {
      if (data.lastView && view === 'dashboard' && !deepLinkedRef.current) {
          if (VALID_VIEWS.includes(data.lastView as View)) {
              setView(data.lastView as View);
          }
      }
  }, [data.lastView]);

  useEffect(() => { data.setLastView(view); }, [view]);

  // Toast discret de confirmation quand une sauvegarde vient de réussir.
  // On se cale sur `lastSavedAt`, qui n'est posé QU'APRÈS une écriture Drive confirmée :
  // se baser sur la retombée de `isSaving` affichait « Enregistré » même quand la
  // sauvegarde venait d'échouer (conflit, session expirée, hors-ligne) — c'est-à-dire
  // exactement dans les cas où l'utilisateur a besoin de savoir que rien n'est parti.
  const lastToastedSaveRef = useRef<number | null>(null);
  useEffect(() => {
    if (!data.lastSavedAt) return;
    const ts = data.lastSavedAt.getTime();
    if (lastToastedSaveRef.current === ts) return;
    // Pas de toast pour la toute première valeur observée (montage), seulement sur un vrai
    // enregistrement survenu pendant la session.
    if (lastToastedSaveRef.current !== null) {
      addToast({ message: 'Enregistré', kind: 'success', durationMs: 1500 });
    }
    lastToastedSaveRef.current = ts;
  }, [data.lastSavedAt]);

  // Init Google API — une seule fois par chargement de page : en développement, React
  // (StrictMode) rejoue les effets de montage, ce qui lançait deux initialisations
  // concurrentes (deux rafraîchissements, deux consommations du code de connexion...).
  const initStartedRef = useRef(false);
  useEffect(() => {
    if (initStartedRef.current) return;
    initStartedRef.current = true;
    initGoogleApi()
      .then(async () => {
        setIsApiLoaded(true);

        // Mode serveur (Worker configuré) : la session vit côté serveur, plus besoin du
        // rafraîchissement silencieux de GIS qui échouait souvent en PWA.
        if (isBackendEnabled()) {
          try {
            const justLoggedIn = await completeBackendLoginIfPresent();
            if (justLoggedIn || hasBackendSession()) {
              if (!justLoggedIn && !isTokenValid()) await handleAuthClick(true);
              setIsAuthenticated(true);
              data.loadDriveData();
            }
          } catch (e: any) {
            if (e instanceof TypeError) {
              // Serveur injoignable : on garde la session, l'utilisateur pourra réessayer.
              addToast({ message: 'Serveur injoignable — vérifiez votre connexion puis rechargez.', kind: 'error' });
            } else {
              console.log('Session serveur invalide, reconnexion requise.', e);
            }
          }
          return;
        }

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
      .catch(err => {
        // Le timeout d'attente des SDK Google existe précisément pour que l'UI puisse
        // afficher un vrai message (voir googleDriveService) — il n'était branché sur
        // rien : l'app restait sur "Chargement API..." pour toujours.
        console.error("Erreur init Google API", err);
        setApiError(true);
      });
  }, []);

  const handleLogin = async () => {
    try {
      await handleAuthClick(false);
      setIsAuthenticated(true);
      data.loadDriveData();
    } catch (error) {
      addToast({ message: 'Échec de la connexion à Google Drive.', kind: 'error' });
    }
  };

  const handleReconnect = async () => {
    try {
      await handleAuthClick(false);
      data.reloadFromDrive();
    } catch (e) {
      addToast({ message: 'Reconnexion échouée.', kind: 'error' });
    }
  };

  const handleLogout = async () => {
    // Un appareil déconnecté ne doit plus recevoir de notifications (qui contiennent des
    // montants) : désabonnement AVANT de fermer la session, tant qu'elle est valide.
    if (isBackendEnabled()) await disablePush().catch(() => undefined);
    await handleSignOut();
    setIsAuthenticated(false);
    data.resetData();
  };

  // --- ACTIONS METIER ---

  const handleSaveAccount = (acc: SavingsAccount) => {
    const today = localTodayISO();
    const existing = data.accounts.find(a => a.id === acc.id);

    // Garde-fou d'invariant : totalAmount DOIT valoir ownedAmount + parentalCapital.
    // Le formulaire pouvait le rompre (saisir une part personnelle supérieure au total
    // laissait la part parentale inchangée), et la première opération suivante recalculait
    // le total depuis l'invariant, faisant bondir le solde d'un coup. On normalise ici
    // plutôt que de faire confiance à la saisie.
    const owned = Number.isFinite(acc.ownedAmount) ? acc.ownedAmount : 0;
    const parental = Number.isFinite(acc.parentalCapital) ? acc.parentalCapital : 0;
    const normalized: SavingsAccount = {
      ...acc,
      ownedAmount: owned,
      parentalCapital: parental,
      totalAmount: Math.round((owned + parental) * 100) / 100,
    };

    // Un changement de solde par le formulaire d'édition doit laisser la même trace qu'une
    // actualisation ou un ajout rapide : sans ça, l'historique des mouvements ne totalisait
    // plus le solde, et les parents n'étaient pas prévenus d'un mouvement sur Livret A/LEP
    // alors qu'ils l'étaient pour la même opération saisie par les deux autres chemins.
    const ownedDiff = existing ? normalized.ownedAmount - existing.ownedAmount : 0;
    if (existing && Math.abs(ownedDiff) > 0.001) {
      data.notifyParentsIfNeeded([{ account: normalized, date: today }]);
    }

    data.setAccounts(prev => {
      const isNew = !prev.find(a => a.id === normalized.id);
      if (isNew) {
        const withInitial: SavingsAccount = normalized.ownedAmount > 0
          ? { ...normalized, movements: [{ id: crypto.randomUUID(), date: today, amount: normalized.ownedAmount, label: "Solde initial", type: 'IN' }] }
          : normalized;
        return [...prev, withInitial];
      }
      // Remplacement en place : l'ancien `filter` puis concat renvoyait le compte édité
      // en fin de liste, réordonnant l'affichage à chaque modification.
      return prev.map(a => {
        if (a.id !== normalized.id) return a;
        if (Math.abs(ownedDiff) <= 0.001) return { ...normalized, movements: a.movements || [] };
        const movement: AccountMovement = {
          id: crypto.randomUUID(),
          date: today,
          amount: Math.abs(ownedDiff),
          label: ownedDiff > 0 ? 'Correction de solde (+)' : 'Correction de solde (-)',
          type: ownedDiff > 0 ? 'IN' : 'OUT',
        };
        return { ...normalized, movements: [...(a.movements || []), movement] };
      });
    });
    setShowForm(false);
    setEditingAccount(undefined);
  };

  // Arrondi systématique à 2 décimales sur toute recomposition owned/total : les ajouts
  // successifs en flottant dérivaient (0.1+0.2...), et un compte "vidé" n'était plus
  // reconnu comme vide (totalAmount !== 0 à cause d'un résidu de 1e-13).
  const round2 = (n: number) => Math.round(n * 100) / 100;

  const doDeleteMovement = (accountId: string, movementId: string) => {
    const account = data.accounts.find(a => a.id === accountId);
    if (!account) return;
    const movement = account.movements?.find(m => m.id === movementId);
    if (!movement) return;
    const linkId = movement.linkId;
    data.setAccounts(prev => prev.map(acc => {
      // TOUTES les jambes présentes sur ce compte, pas seulement la première : si deux
      // jambes d'un même linkId vivaient sur le même compte, on n'en supprimait qu'une
      // alors que l'undo (collectMovementLegs) restaurait les deux — doublon garanti.
      const toDelete = (acc.movements || []).filter(m => m.id === movementId || (linkId && m.linkId === linkId));
      if (toDelete.length === 0) return acc;
      let newOwned = acc.ownedAmount;
      toDelete.forEach(m => {
        if (m.type === 'IN') newOwned -= m.amount; else newOwned += m.amount;
      });
      newOwned = round2(newOwned);
      const deletedIds = new Set(toDelete.map(m => m.id));
      return {
          ...acc,
          ownedAmount: newOwned,
          totalAmount: round2(newOwned + acc.parentalCapital),
          movements: acc.movements?.filter(m => !deletedIds.has(m.id)) || []
      };
    }));
  };

  // Recense TOUTES les lignes que la suppression va réellement retirer. Un virement interne
  // en compte deux (le OUT côté source et le IN côté destination, appariés par `linkId`) et
  // `doDeleteMovement` les supprime ensemble : les recenser avant permet de tout restaurer
  // d'un bloc. Sans ça, l'undo était purement et simplement désactivé pour les virements,
  // faisant de l'opération la plus destructrice de l'app la seule sans filet.
  type MovementLeg = { accountId: string; movement: AccountMovement };
  const collectMovementLegs = (accountId: string, movementId: string): MovementLeg[] => {
    const account = data.accounts.find(a => a.id === accountId);
    const movement = account?.movements?.find(m => m.id === movementId);
    if (!movement) return [];
    if (!movement.linkId) return [{ accountId, movement }];
    const legs: MovementLeg[] = [];
    data.accounts.forEach(acc => {
      (acc.movements || []).forEach(m => {
        if (m.linkId === movement.linkId) legs.push({ accountId: acc.id, movement: m });
      });
    });
    return legs;
  };

  const restoreMovementLegs = (legs: MovementLeg[]) => {
    data.setAccounts(prev => prev.map(acc => {
      const toRestore = legs.filter(l => l.accountId === acc.id);
      if (toRestore.length === 0) return acc;
      let newOwned = acc.ownedAmount;
      toRestore.forEach(({ movement }) => {
        if (movement.type === 'IN') newOwned += movement.amount; else newOwned -= movement.amount;
      });
      newOwned = round2(newOwned);
      return {
        ...acc,
        ownedAmount: newOwned,
        totalAmount: round2(newOwned + acc.parentalCapital),
        movements: [...(acc.movements || []), ...toRestore.map(l => l.movement)],
      };
    }));
  };

  const handleDeleteMovement = (accountId: string, movementId: string) => {
    const account = data.accounts.find(a => a.id === accountId);
    const movement = account?.movements?.find(m => m.id === movementId);
    const legs = collectMovementLegs(accountId, movementId);
    const isTransfer = legs.length > 1;
    setDialog({
      open: true, kind: 'confirm', danger: true, confirmLabel: 'Supprimer',
      title: isTransfer ? 'Supprimer le virement' : 'Supprimer le mouvement',
      message: movement
        ? (isTransfer
            ? `« ${movement.label} » est un virement interne : les ${legs.length} lignes liées seront supprimées ensemble.`
            : `« ${movement.label} » sera supprimé.`)
        : undefined,
      onConfirm: () => {
        doDeleteMovement(accountId, movementId);
        if (legs.length > 0) {
          addToast({
            message: isTransfer ? `Virement supprimé (${legs.length} lignes)` : 'Mouvement supprimé',
            action: { label: 'Annuler', onClick: () => restoreMovementLegs(legs) },
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
    // Position d'origine mémorisée pour que l'annulation remette le compte à sa place au
    // lieu de le renvoyer en fin de liste (même exigence que pour l'édition, cf. plus haut).
    const originalIndex = data.accounts.findIndex(a => a.id === acc.id);
    setDialog({
      open: true, kind: 'confirm', danger: true, confirmLabel: 'Supprimer',
      title: `Supprimer « ${acc.name} »`,
      message: isEmpty ? 'Ce compte est vide, il sera supprimé.' : 'Ce compte contient encore un solde. Supprimer définitivement ?',
      onConfirm: () => {
        data.setAccounts(prev => prev.filter(a => a.id !== acc.id));
        addToast({
          message: `« ${acc.name} » supprimé`,
          action: {
            label: 'Annuler',
            onClick: () => data.setAccounts(prev => {
              const next = [...prev];
              next.splice(originalIndex < 0 ? next.length : originalIndex, 0, acc);
              return next;
            }),
          },
        });
      },
    });
  };

  // Bascule le Pilotage budgétaire sur les chiffres EXACTS de cette fiche de paie (brut,
  // charges, navigo, mutuelle, titres resto, impôt réellement prélevé), à la place de la
  // formule théorique — utile pour un mois réel plutôt que pour simuler un salaire
  // hypothétique. Le brut annuel affiché est extrapolé (mois × 12, potentiellement partiel
  // — ex: début de contrat en cours de mois) ; le reste du détail n'est, lui, pas recalculé
  // du tout : ce sont les vrais montants de la fiche, verbatim.
  const handleApplyPayslipToPilotage = (p: PayslipRecord) => {
    if (p.extracted.grossAmount === undefined) return;
    const estimate = Math.round(p.extracted.grossAmount * 12);
    setDialog({
      open: true, kind: 'confirm', confirmLabel: 'Appliquer',
      title: 'Utiliser les chiffres réels de cette fiche',
      message: `Le Pilotage budgétaire affichera les montants exacts de la fiche de ${p.extracted.period || 'cette fiche'} (brut, charges, impôt réellement prélevé...) à la place de la formule théorique. Le brut annuel sera aussi mis à jour (${estimate.toLocaleString('fr-FR')} €, extrapolé), à la place de ${Math.round(data.grossAnnual).toLocaleString('fr-FR')} € actuellement.`,
      onConfirm: () => {
        data.setGrossAnnual(estimate);
        data.setActivePayslipId(p.id);
        addToast({ message: 'Pilotage basé sur votre fiche de paie réelle', kind: 'success' });
      },
    });
  };

  const handleClearActivePayslip = () => {
    data.setActivePayslipId(undefined);
    addToast({ message: 'Retour à l\'estimation théorique', kind: 'success' });
  };

  // Renvoie l'id du mouvement créé (la liste des virements de paie en a besoin pour
  // pouvoir l'annuler).
  const handleQuickAdd = (accountId: string, amount: number, type: 'IN' | 'OUT', label: string, date: string): string | undefined => {
    const account = data.accounts.find(a => a.id === accountId);
    if (!account) return undefined;
    const delta = type === 'IN' ? amount : -amount;
    const newOwned = round2(account.ownedAmount + delta);
    const newTotal = round2(newOwned + account.parentalCapital);
    const movement: AccountMovement = { id: crypto.randomUUID(), date, amount, label, type };

    // Notifie les parents AVANT la mise à jour d'état (le hook compare à l'état courant).
    data.notifyParentsIfNeeded([{ account: { ...account, ownedAmount: newOwned, totalAmount: newTotal }, date }]);

    data.setAccounts(prev => prev.map(a => a.id === accountId
      ? { ...a, ownedAmount: newOwned, totalAmount: newTotal, totalDeposits: depositsAfterCashFlow(a, delta), movements: [...(a.movements || []), movement] }
      : a));

    addToast({ message: `${label} — ${account.name}`, kind: 'success' });
    return movement.id;
  };

  // Mode solo : plus aucun compte n'a de part parentale (après la restitution). L'écran
  // Part parentale reste accessible tant qu'un relevé de restitution existe.
  const hasParental = data.accounts.some(a => a.parentalCapital > 0);
  const showParentalScreen = hasParental || !!data.parentalRestitution?.done;

  // --- RESTITUTION DU CAPITAL PARENTAL ---
  // Retire la part des parents de chaque compte (la part propre ne bouge pas), garde un
  // relevé (montants, intérêts offerts chaque année) et prévient les parents si demandé.
  const handleRestitution = (date: string, sendMail: boolean) => {
    const plan = computeRestitutionPlan(data.accounts, date);
    if (plan.total <= 0) return;
    const firstYear = Math.min(plan.interestYear, ...data.accounts
      .filter(a => a.parentalCapital > 0)
      .flatMap(a => (a.movements || []).map(m => Number(m.date.slice(0, 4))))
      .filter(y => y > 2000));
    const interestsOffered: { year: number; amount: number }[] = [];
    for (let y = firstYear; y <= plan.interestYear; y++) {
      const amount = y === plan.interestYear
        ? plan.totalInterest
        : computeAccruedParentalInterest(data.accounts, y, new Date(y + 1, 0, 1)).totalAnnualParental;
      if (amount >= 0.5) interestsOffered.push({ year: y, amount: Math.round(amount * 100) / 100 });
    }
    const previous = data.parentalRestitution;
    const before = data.accounts.map(a => ({ id: a.id, parentalCapital: a.parentalCapital }));
    let emailed = false;
    if (sendMail) {
      const rows = plan.rows.map(r => `<tr><td style="padding:4px 12px 4px 0">${r.name}</td><td style="padding:4px 0;text-align:right"><b>${formatEUR(r.amount, 2)}</b></td></tr>`).join('');
      emailed = data.queueParentsMail('Restitution de votre capital', `
        <div style="font-family: sans-serif; color: #1e293b;">
          <p>Bonjour,</p>
          <p>Voici le récapitulatif de la restitution de votre capital, retiré le ${parseISODate(date).toLocaleDateString('fr-FR')} :</p>
          <table style="border-collapse: collapse;">${rows}
            <tr><td style="padding:8px 12px 4px 0;border-top:1px solid #e2e8f0">Total</td><td style="padding:8px 0 4px;text-align:right;border-top:1px solid #e2e8f0"><b>${formatEUR(plan.total, 2)}</b></td></tr>
          </table>
        </div>`);
    }
    data.setAccounts(prev => accountsAfterRestitution(prev));
    data.setParentalRestitution({
      ...previous,
      done: { date, accounts: plan.rows.map(r => ({ accountId: r.accountId, name: r.name, amount: r.amount })), interestsOffered, emailed: emailed || undefined },
    });
    addToast({
      message: `Restitution enregistrée : ${formatEUR(plan.total)}${emailed ? ' · récapitulatif envoyé après la sauvegarde' : ''}`,
      kind: 'success',
      action: { label: 'Annuler', onClick: () => restoreParental(before, previous) },
    });
  };

  const restoreParental = (before: { id: string; parentalCapital: number }[], previous: typeof data.parentalRestitution) => {
    data.setAccounts(prev => prev.map(a => {
      const b = before.find(x => x.id === a.id);
      if (!b || b.parentalCapital <= 0) return a;
      return { ...a, parentalCapital: b.parentalCapital, totalAmount: round2(a.ownedAmount + b.parentalCapital) };
    }));
    data.setParentalRestitution(previous);
  };

  // Annulation depuis l'écran (après coup) : reconstruit à partir du relevé.
  const handleUndoRestitution = () => {
    const done = data.parentalRestitution?.done;
    if (!done) return;
    restoreParental(done.accounts.map(a => ({ id: a.accountId, parentalCapital: a.amount })), { ...data.parentalRestitution, done: undefined });
    addToast({ message: 'Restitution annulée : la part de vos parents est rétablie', kind: 'success' });
  };

  // Annule un versement enregistré depuis la liste des virements de paie : retire le
  // mouvement et rétablit solde et versements cumulés.
  const handleCancelPayDeposit = (accountId: string, movementId: string) => {
    data.setAccounts(prev => prev.map(a => {
      if (a.id !== accountId) return a;
      const m = (a.movements || []).find(x => x.id === movementId);
      if (!m) return a;
      const delta = m.type === 'IN' ? -m.amount : m.amount;
      const owned = round2(a.ownedAmount + delta);
      return {
        ...a,
        ownedAmount: owned,
        totalAmount: round2(owned + a.parentalCapital),
        totalDeposits: a.totalDeposits !== undefined ? Math.max(0, round2(a.totalDeposits + delta)) : undefined,
        movements: (a.movements || []).filter(x => x.id !== movementId),
      };
    }));
  };

  // --- RENDU ---

  // Verrou biométrique en tout premier : avant même de décider s'il faut afficher l'écran
  // de connexion ou les données, pour ne jamais laisser filtrer d'information (y compris
  // le simple fait qu'une session Google est déjà active) tant que ce n'est pas déverrouillé.
  if (locked) {
    return <AppLockScreen onUnlock={() => setLocked(false)} />;
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-4">
        <div className="bg-white dark:bg-slate-800 p-8 rounded-3xl shadow-2xl max-w-md w-full text-center">
          <div className="w-16 h-16 bg-indigo-600 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg shadow-indigo-500/30">
            <RefreshCcw className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-slate-100 mb-2">Suivi Épargne</h1>
          <p className="text-slate-500 dark:text-slate-400 mb-8">Vos données sont stockées en sécurité sur votre Google Drive personnel.</p>
          {apiError ? (
            <div className="text-left bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 rounded-xl p-4">
              <p className="text-sm font-black text-rose-700 dark:text-rose-300 mb-2 flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> Impossible de charger les services Google</p>
              <p className="text-xs text-rose-600 dark:text-rose-400 mb-3">Vérifiez votre connexion (ou un bloqueur de scripts) puis réessayez.</p>
              <button onClick={() => window.location.reload()} className="w-full py-2.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-sm font-black">Recharger l'application</button>
            </div>
          ) : !isApiLoaded ? <div className="flex justify-center gap-2 text-indigo-600 font-bold"><Loader2 className="animate-spin"/> Chargement API...</div> :
            <button onClick={handleLogin} className="w-full flex justify-center gap-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 py-4 rounded-xl font-bold hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 transition-colors">Continuer avec Google</button>
          }
        </div>
      </div>
    );
  }

  if (data.isLoadingData) return <div className="min-h-screen flex justify-center items-center flex-col gap-4 bg-slate-50 dark:bg-slate-900"><Loader2 className="animate-spin w-10 h-10 text-indigo-600"/><p className="text-slate-500 dark:text-slate-400 font-bold">Chargement de vos données…</p></div>;

  return (
    <ToastContext.Provider value={addToast}>
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex flex-col md:flex-row font-sans text-slate-900 dark:text-slate-100">
      <aside className="hidden md:flex bg-slate-900 text-white w-full md:w-64 flex-shrink-0 flex-col border-r border-slate-800">
        <div className="p-6 border-b border-slate-800">
          <h1 className="text-xl font-bold flex items-center gap-2"><div className="w-8 h-8 bg-indigo-600 rounded flex center justify-center items-center"><RefreshCcw className="w-4 h-4 text-white"/></div> Suivi Épargne</h1>
          <div className="mt-2 text-[11px] uppercase text-slate-500 dark:text-slate-400 font-bold tracking-wider flex items-center justify-between gap-2">
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
          <NavButton active={view === 'dashboard'} onClick={() => setView('dashboard')} icon={LayoutDashboard} label="Tableau de bord" />
          <NavButton active={view === 'update'} onClick={() => setView('update')} icon={RefreshCcw} label="Actualiser solde" highlight />

          <div className="pt-6 pb-2 text-[11px] font-black text-slate-600 dark:text-slate-300 uppercase px-4 tracking-widest">Analyses</div>
          <NavButton active={view === 'pilot'} onClick={() => setView('pilot')} icon={ShieldCheck} label="Pilotage" />
          <NavButton active={view === 'agenda'} onClick={() => setView('agenda')} icon={CalendarDays} label="Agenda" />
          <NavButton active={view === 'yield'} onClick={() => setView('yield')} icon={Coins} label="Rendement" />
          <NavButton active={view === 'history'} onClick={() => setView('history')} icon={LineChart} label="Historique" />
          {showParentalScreen && <NavButton active={view === 'parental'} onClick={() => setView('parental')} icon={Users} label="Part parentale" />}

          <div className="pt-6 pb-2 text-[11px] font-black text-slate-600 dark:text-slate-300 uppercase px-4 tracking-widest">Gestion</div>
          <NavButton active={view === 'accounts'} onClick={() => setView('accounts')} icon={Wallet} label="Mes comptes" />
          <NavButton active={view === 'transfers'} onClick={() => setView('transfers')} icon={ArrowRightLeft} label="Virements" />
          <NavButton active={view === 'payslips'} onClick={() => setView('payslips')} icon={FileText} label="Fiches de paie" />
          <NavButton active={view === 'subscriptions'} onClick={() => setView('subscriptions')} icon={CalendarClock} label="Abonnements" />
          <NavButton active={view === 'donations'} onClick={() => setView('donations')} icon={HandHeart} label="Dons" />

          <div className="my-4 border-t border-slate-800 mx-4"></div>
          <NavButton active={view === 'settings'} onClick={() => setView('settings')} icon={SettingsIcon} label="Paramètres" />
        </nav>
        <div className="p-4 border-t border-slate-800">
            <button onClick={handleLogout} className="w-full flex items-center gap-3 px-4 py-3 text-rose-400 hover:bg-rose-950/30 rounded-xl font-bold text-sm transition-colors"><LogOut className="w-5 h-5"/> Déconnexion</button>
        </div>
      </aside>

      {/* Header compact mobile (la sidebar est masquée en dessous de md) */}
      <header className="md:hidden sticky top-0 z-30 bg-slate-900 text-white px-4 py-3 flex items-center justify-between">
        <h1 className="text-base font-bold flex items-center gap-2"><div className="w-6 h-6 bg-indigo-600 rounded flex items-center justify-center"><RefreshCcw className="w-3.5 h-3.5 text-white"/></div> Suivi Épargne</h1>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5" title={data.lastSavedAt ? `Dernière écriture confirmée sur Drive : ${data.lastSavedAt.toLocaleTimeString('fr-FR')}` : undefined}>
            <div className={`w-2 h-2 rounded-full flex-shrink-0 ${data.isOffline ? 'bg-slate-400' : data.isSaving ? 'bg-amber-500 animate-pulse' : data.syncError || data.syncConflict ? 'bg-rose-500' : 'bg-emerald-500'}`}></div>
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">
              {data.isOffline ? 'Hors ligne' : data.isSaving ? 'Sauvegarde...' : data.syncError ? 'Erreur' : data.syncConflict ? 'Conflit' : data.lastSavedAt ? data.lastSavedAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : 'Sync'}
            </span>
          </div>
          <button onClick={toggleTheme} className="p-2.5 -m-1 text-slate-400" title="Thème" aria-label="Changer de thème">{isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}</button>
          <button onClick={handleLogout} className="p-2.5 -m-1 text-rose-400" title="Déconnexion" aria-label="Se déconnecter"><LogOut className="w-4 h-4" /></button>
        </div>
      </header>

      <main onScroll={handleMainScroll} className="flex-1 p-4 md:p-8 overflow-y-auto relative h-screen pb-40 md:pb-24">

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
            {data.mailError && (
              <div className="mb-4 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-2 text-amber-800 dark:text-amber-300 text-sm font-bold"><AlertTriangle className="w-5 h-5 flex-shrink-0"/> L'email d'alerte n'a pas pu être envoyé à {data.mailError}. Le mouvement est bien enregistré, mais vos parents n'ont pas été prévenus.</div>
                <button onClick={data.dismissMailError} className="bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 px-4 py-2 rounded-lg font-bold text-sm flex-shrink-0">J'ai compris</button>
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
            {view === 'dashboard' && <Dashboard accounts={data.accounts} history={data.history} expenses={allCharges} fiscalConfig={data.fiscalConfig} workBenefits={data.workBenefits} onDeleteAccount={handleDeleteAccount} config={dashboardConfig} monthPlan={monthPlan} monthlyPay={monthlyPay} subscriptions={data.subscriptions} onUpdateFiscalConfig={data.setFiscalConfig} onOpenSettings={() => setView('settings')} recurringMovements={data.recurringMovements} onRecordRecurring={(r, date) => handleQuickAdd(r.accountId, r.amount, r.type, r.label, date)} />}

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
                activePayslip={activePayslipRecord}
                onClearActivePayslip={handleClearActivePayslip}
                subscriptions={data.subscriptions}
                onOpenSubscriptions={() => setView('subscriptions')}
                payChecklist={data.payChecklist}
                onPayChecklistChange={data.setPayChecklist}
                onRecordPayDeposit={(accountId, amount) => handleQuickAdd(accountId, amount, 'IN', 'Virement de paie', localTodayISO())}
                onCancelPayDeposit={handleCancelPayDeposit}
                paydayDay={data.paydayDay}
                setPaydayDay={data.setPaydayDay}
                paydayAmount={data.paydayAmount}
                setPaydayAmount={data.setPaydayAmount}
            />}

            {view === 'transfers' && <TransferManager accounts={data.accounts} onUpdateAccountsComplex={data.updateAccountsWithMovements} onLinkedTransfer={data.executeLinkedTransfer} lastSavedAt={data.lastSavedAt} recurringMovements={data.recurringMovements} onUpdateRecurring={data.setRecurringMovements} />}
            {view === 'update' && <AccountUpdate accounts={data.accounts} onUpdateAccountsComplex={data.updateAccountsWithMovements} lastSavedAt={data.lastSavedAt} />}

            {view === 'yield' && <Yield accounts={data.accounts} fiscalConfig={data.fiscalConfig} />}
            {view === 'history' && <History history={data.history} expensesHistory={data.expensesHistory} reviewData={fullData} />}
            {view === 'agenda' && <Agenda data={fullData} onOpen={(v) => VALID_VIEWS.includes(v as View) && setView(v as View)} />}
            {view === 'parental' && <ParentalShare
                accounts={data.accounts}
                restitution={data.parentalRestitution}
                monthPlan={monthPlan}
                canEmailParents={!!data.parentsEmail}
                onPlanRestitution={(date) => data.setParentalRestitution(prev => ({ ...prev, plannedDate: date }))}
                onRestitute={handleRestitution}
                onUndoRestitution={handleUndoRestitution}
            />}
            {view === 'donations' && <Donations donations={data.donations} onUpdate={data.setDonations} pickerApiKey={data.pickerApiKey} />}
            {view === 'subscriptions' && <Subscriptions subscriptions={data.subscriptions} onUpdate={data.setSubscriptions} />}
            {view === 'payslips' && <Payslips payslips={data.payslips} onUpdatePayslips={data.setPayslips} geminiApiKey={data.geminiApiKey} pickerApiKey={data.pickerApiKey} onApplyToPilotage={handleApplyPayslipToPilotage} activePayslipId={data.activePayslipId} onClearActivePayslip={handleClearActivePayslip} />}

            {view === 'settings' && (
                <Settings
                    config={data.fiscalConfig}
                    workBenefits={data.workBenefits}
                    parentsEmail={data.parentsEmail}
                    geminiApiKey={data.geminiApiKey}
                    pickerApiKey={data.pickerApiKey}
                    onExport={data.exportData}
                    onImport={data.importData}
                    paydayDay={data.paydayDay}
                    onOpenPayday={() => setView('pilot')}
                    onSave={(newFiscal, newBenefits, newEmail, newGeminiKey, newPickerKey) => {
                       data.setFiscalConfig(newFiscal);
                       data.setWorkBenefits(newBenefits);
                       data.setParentsEmail(newEmail);
                       data.setGeminiApiKey(newGeminiKey);
                       data.setPickerApiKey(newPickerKey);
                       if (newBenefits.navigo.active) {
                           data.setNavigoBase(newBenefits.navigo.basePrice);
                           data.setNavigoRate(newBenefits.navigo.refundRate);
                       }
                    }}
                />
            )}

            {view === 'accounts' && (
              <div className="space-y-6 animate-fade-in">
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700">
                  <div><h2 className="text-2xl font-black text-slate-800 dark:text-slate-100">Mes comptes</h2><p className="text-sm text-slate-500 dark:text-slate-400 font-medium">{data.accounts.length} comptes actifs</p></div>
                  {!showForm && <button onClick={() => { setEditingAccount(undefined); setShowForm(true); }} className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-3 rounded-xl font-bold flex gap-2 transition-colors shadow-lg shadow-indigo-200"><PlusCircle className="w-5 h-5"/> Ajouter un compte</button>}
                </div>
                {!showForm && <MovementSearch accounts={data.accounts} />}
                {showForm ? (
                  <AccountForm
                      onSave={handleSaveAccount}
                      initialData={editingAccount}
                      onCancel={() => { setShowForm(false); setEditingAccount(undefined); }}
                      fiscalConfig={data.fiscalConfig}
                      showParental={hasParental || !!editingAccount?.parentalCapital}
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
                    <div className="overflow-x-auto">
                      <table className="w-full text-left md:min-w-[34rem]">
                        <thead className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700">
                          <tr><th className="px-6 py-4 text-[11px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-wider">Compte</th><th className="px-6 py-4 text-[11px] text-right text-slate-500 dark:text-slate-400 uppercase tracking-wider">Ma part</th><th className="hidden md:table-cell px-6 py-4 text-[11px] text-right text-slate-500 dark:text-slate-400 uppercase tracking-wider">Parents</th><th className="hidden md:table-cell px-6 py-4 text-right"></th></tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                          {filteredAccounts.map(acc => (
                            <React.Fragment key={acc.id}>
                              <tr onClick={() => setEditingAccount(editingAccount?.id === acc.id ? undefined : acc)} className="hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer group transition-colors">
                                <td className="px-4 md:px-6 py-4">
                                  <div className="font-bold text-slate-800 dark:text-slate-100">{acc.name}</div>
                                  <div className="text-[11px] uppercase text-slate-500 dark:text-slate-400 font-bold">{acc.institution}</div>
                                  {acc.tags && acc.tags.length > 0 && (
                                    <div className="flex flex-wrap gap-1 mt-1">
                                      {acc.tags.map(t => <span key={t} className="text-[11px] bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-300 px-1.5 py-0.5 rounded-full font-bold normal-case">{t}</span>)}
                                    </div>
                                  )}
                                  {(() => {
                                    // Compte à rebours de maturité fiscale (PEA/AV/PEE) : réutilise
                                    // exactement le calcul de fiscalité du capital de Rendement, pour
                                    // ne jamais annoncer un régime différent d'un écran à l'autre.
                                    const maturity = computeMaturityCountdown(acc, data.fiscalConfig);
                                    if (!maturity) return null;
                                    const label = maturity.regimeAfter === 'EXONERE_IR' ? "exonération d'IR" : 'taux réduit (7,5%)';
                                    return (
                                      <div className="mt-1 text-[11px] font-bold text-indigo-500 dark:text-indigo-400 flex items-center gap-1">
                                        <Clock className="w-3 h-3 flex-shrink-0" />
                                        Passe en {label} dans {maturity.monthsRemaining} mois
                                        {maturity.annualTaxSaving > 1 && ` (≈ ${formatEUR(maturity.annualTaxSaving, 0)} d'impôt en moins par année de gains, au retrait)`}
                                      </div>
                                    );
                                  })()}
                                  <div className="md:hidden mt-2 flex items-center gap-2">
                                    {acc.parentalCapital > 0 && <span className="text-xs font-bold text-amber-600 dark:text-amber-400 flex-1">Parents : {formatEUR(acc.parentalCapital)}</span>}
                                    <span className="flex-1" />
                                    <button onClick={(e) => { e.stopPropagation(); setEditingAccount(acc); setShowForm(true); }} aria-label={`Modifier ${acc.name}`} className="p-2.5 text-indigo-600 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/40 rounded-lg"><Edit2 className="w-4 h-4"/></button>
                                    <button onClick={(e) => { e.stopPropagation(); handleDeleteAccount(acc); }} aria-label={`Supprimer ${acc.name}`} className="p-2.5 text-rose-600 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 rounded-lg"><Trash2 className="w-4 h-4"/></button>
                                  </div>
                                </td>
                                <td className="px-4 md:px-6 py-4 text-right align-top"><div className="font-black text-indigo-600 text-lg whitespace-nowrap">{formatEUR(acc.ownedAmount)}</div><AccountTotal account={acc} /></td>
                                <td className="hidden md:table-cell px-6 py-4 text-right font-bold text-amber-500">{formatEUR(acc.parentalCapital)}</td>
                                <td className="hidden md:table-cell px-6 py-4 text-right"><div className="flex justify-end gap-2 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                                   <button onClick={(e) => { e.stopPropagation(); setEditingAccount(acc); setShowForm(true); }} className="p-2 text-indigo-600 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/40 rounded-lg hover:bg-indigo-100 dark:hover:bg-indigo-900"><Edit2 className="w-4 h-4"/></button>
                                   <button onClick={(e) => { e.stopPropagation(); handleDeleteAccount(acc); }} className="p-2 text-rose-600 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 rounded-lg hover:bg-rose-100 dark:hover:bg-rose-900"><Trash2 className="w-4 h-4"/></button>
                                </div></td>
                              </tr>
                              {editingAccount?.id === acc.id && !showForm && (
                                 <tr className="bg-slate-50 dark:bg-slate-900 animate-in slide-in-from-top-2"><td colSpan={4} className="p-4"><div className="space-y-2 p-2">
                                   <label className="flex items-center gap-2 text-[11px] font-black text-slate-500 dark:text-slate-400 uppercase mb-1 cursor-pointer">
                                     <input type="checkbox" checked={groupSmallMovements} onChange={e => setGroupSmallMovements(e.target.checked)} className="accent-indigo-600" />
                                     Regrouper les mouvements &lt; 1€
                                   </label>
                                   <div className="max-h-60 overflow-y-auto space-y-2">
                                   {buildDisplayMovements(acc.movements).map(m => (
                                     <div key={m.id} className={`flex justify-between items-center p-3 rounded-xl text-xs border shadow-sm ${m.grouped ? 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 italic' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700'}`}>
                                       <div className="flex items-center gap-3">
                                           <span className="text-slate-500 dark:text-slate-400 font-mono bg-slate-100 dark:bg-slate-700 px-2 py-1 rounded whitespace-nowrap">{m.date.split('-').reverse().join('/')}</span>
                                           <span className="font-bold text-slate-700 dark:text-slate-200">{m.label}</span>
                                           {!m.grouped && <button onClick={()=>handleRenameMovement(acc.id, m.id, m.label)} aria-label={`Renommer « ${m.label} »`} className="p-2 -m-1 opacity-60 hover:opacity-100"><Edit2 className="w-4 h-4 text-slate-500 dark:text-slate-400"/></button>}
                                       </div>
                                       <div className="flex items-center gap-3">
                                           <span className={`font-mono text-sm ${m.type==='IN'?'text-emerald-600 font-bold':'text-rose-600 font-bold'}`}>{m.type==='IN'?'+':'−'}{formatEUR(m.amount)}</span>
                                           {!m.grouped && <button onClick={()=>handleDeleteMovement(acc.id, m.id)} aria-label={`Supprimer « ${m.label} »`} className="p-2.5 -m-1 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded text-slate-500 dark:text-slate-400 hover:text-rose-500"><Trash2 className="w-4 h-4"/></button>}
                                       </div>
                                     </div>
                                   ))}
                                   {(!acc.movements || acc.movements.length===0) && <div className="text-center text-slate-500 dark:text-slate-400 italic py-4">Aucun mouvement historique.</div>}
                                   </div>
                                 </div></td></tr>
                               )}
                            </React.Fragment>
                          ))}
                        </tbody>
                      </table>
                    </div>
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
          className={`fixed bottom-20 md:bottom-6 right-4 z-40 w-14 h-14 rounded-full bg-indigo-600 hover:bg-indigo-700 text-white shadow-lg shadow-indigo-900/30 flex items-center justify-center transition-all duration-200 ${fabHidden ? 'translate-y-24 opacity-0 pointer-events-none' : 'hover:scale-105'}`}
          aria-label="Ajout rapide"
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
          { key: 'transfers', label: 'Virements', icon: ArrowRightLeft },
          { key: 'agenda', label: 'Agenda', icon: CalendarDays },
          { key: 'yield', label: 'Rendement', icon: Coins },
          { key: 'history', label: 'Historique', icon: LineChart },
          ...(showParentalScreen ? [{ key: 'parental', label: 'Part parentale', icon: Users }] : []),
          { key: 'payslips', label: 'Fiches de paie', icon: FileText },
          { key: 'subscriptions', label: 'Abonnements', icon: CalendarClock },
          { key: 'donations', label: 'Dons', icon: HandHeart },
          { key: 'settings', label: 'Paramètres', icon: SettingsIcon },
        ]}
      />

      <ToastContainer toasts={toasts} onDismiss={dismiss} />

      <Dialog state={dialog} onClose={closeDialog} />
    </div>
    </ToastContext.Provider>
  );
}

export default App;
