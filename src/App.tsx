// ================================================
// FILE: src/App.tsx
// ================================================
import React, { useState, useEffect, useMemo, useRef, useCallback, Suspense } from 'react';
import { SavingsAccount, PayslipRecord } from './types';
import { usePortfolioData } from './hooks/usePortfolioData';
import { useTheme } from './hooks/useTheme';
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
import { computeIncome, totalFixedCharges, computeMonthlySavingsCapacity, subscriptionsAsExpenses, computeMonthlyPay, REGULATED_RATE_GROUPS } from './lib/finance';
import { localTodayISO, parseISODate } from './lib/dates';
import { formatEUR } from './lib/format';
import { AccountsView } from './components/AccountsView';
import { lepTimelineFromData } from './lib/lep';
import { TaxNoticePanel } from './components/TaxNoticePanel';
// Importé ici (et pas dans l'écran, chargé à la demande) pour capter l'invitation d'installation dès le démarrage.
import './services/installPrompt';
import { computeBadgeCount, detectPayRaise } from './lib/projection';
import { isRestitutionMovement, type CancellingGroup } from './lib/accountOps';
import {
  type CommandError, type CommandOk, type CommandPatch, type CommandState,
  saveAccount, deleteAccount, quickAdd, planMovementDeletion, deleteMovement, cancelDeposit, removeCancellingMovements,
  recordRestitution, undoRestitution,
} from './lib/commands';
import { WhatsNewModal } from './components/WhatsNew';
import { MovedNotice } from './components/MovedNotice';
import { Logo } from './components/Logo';
import { LATEST_VERSION } from './changelog';
import { ErrorBoundary, lazyWithRetry } from './components/ErrorBoundary';
import { NAV_ITEMS, NAV_SECTIONS, VIEWS, View, navLabel } from './navigation';
import { QuickAddFab } from './components/QuickAddFab';
import { useFiscalWatch } from './hooks/useFiscalWatch';
import { FiscalWatchCard } from './components/FiscalWatchCard';
import type { FiscalProposal } from './lib/fiscalWatch';
import { DriveBackupsPanel, ServerSecurityPanel, CloudBackupPanel } from './components/SettingsPanels';
import { maybeAutoUpload } from './services/cloudBackup';
import { computeEmergencyFund, DEFAULT_EMERGENCY_MONTHS } from './lib/planning';
import { buildAgenda } from './lib/agenda';
import { TaxReturnHelper } from './components/TaxReturnHelper';
import { SoloPlanCard } from './components/SoloPlanCard';
import { MotivationSettings } from './components/motivation/MotivationSettings';
import {
  LogOut,
  Loader2, Settings as SettingsIcon, AlertTriangle, RotateCw,
  Sun, Moon, Save, WifiOff
} from 'lucide-react';

// Code-splitting : les vues lourdes (recharts, etc.) sont chargées à la demande.
const Journal = lazyWithRetry(() => import('./components/Journal').then(m => ({ default: m.Journal })));
const Agenda = lazyWithRetry(() => import('./components/Agenda').then(m => ({ default: m.Agenda })));
const Donations = lazyWithRetry(() => import('./components/Donations').then(m => ({ default: m.Donations })));
const Subscriptions = lazyWithRetry(() => import('./components/Subscriptions').then(m => ({ default: m.Subscriptions })));
const Dashboard = lazyWithRetry(() => import('./components/Dashboard').then(m => ({ default: m.Dashboard })));
const AccountUpdate = lazyWithRetry(() => import('./components/AccountUpdate').then(m => ({ default: m.AccountUpdate })));
const AssistantPilot = lazyWithRetry(() => import('./components/AssistantPilot').then(m => ({ default: m.AssistantPilot })));
const TransferManager = lazyWithRetry(() => import('./components/TransferManager').then(m => ({ default: m.TransferManager })));
const Settings = lazyWithRetry(() => import('./components/Settings').then(m => ({ default: m.Settings })));
const Yield = lazyWithRetry(() => import('./components/Yield').then(m => ({ default: m.Yield })));
const History = lazyWithRetry(() => import('./components/History').then(m => ({ default: m.History })));
const Simulator = lazyWithRetry(() => import('./components/Simulator').then(m => ({ default: m.Simulator })));
const ParentalShare = lazyWithRetry(() => import('./components/ParentalShare').then(m => ({ default: m.ParentalShare })));
const Payslips = lazyWithRetry(() => import('./components/Payslips').then(m => ({ default: m.Payslips })));

// Squelette pendant le chargement d'un écran : la mise en page ne saute pas.
const ViewLoader = () => (
  <div className="space-y-4 animate-pulse" aria-busy="true" aria-label="Chargement">
    <div className="h-24 rounded-2xl bg-slate-200/70 dark:bg-slate-800" />
    <div className="grid grid-cols-2 gap-4"><div className="h-28 rounded-2xl bg-slate-200/70 dark:bg-slate-800" /><div className="h-28 rounded-2xl bg-slate-200/70 dark:bg-slate-800" /></div>
    <div className="h-64 rounded-2xl bg-slate-200/70 dark:bg-slate-800" />
  </div>
);

const NavButton = ({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: React.ComponentType<{ className?: string }>; label: string }) => (
    <button
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`w-full h-12 flex items-center gap-3 px-4 text-sm transition-colors rounded-full ${active ? 'bg-secondary-container text-on-secondary-container font-bold' : 'font-medium text-on-surface-variant hover:bg-on-surface/8 hover:text-on-surface'}`}
    >
      <Icon className="w-5 h-5 shrink-0" aria-hidden="true" />
      {label}
    </button>
);

const VALID_VIEWS: readonly View[] = VIEWS;

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
  const [moreNavOpen, setMoreNavOpen] = useState(false);
  const [quickAddOpen, setQuickAddOpen] = useState(false);

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


  const closeDialog = () => setDialog(emptyDialog);


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

  // Impôt annuel estimé (après décote) et revenu imposable : plafonnent la réduction des dons.
  const taxEstimate = useMemo(() => {
    if (!data.workBenefits || !(data.grossAnnual > 0)) return undefined;
    const b = computeIncome({ ...dashboardConfig, extraMonthlyIncome: 0 }, data.fiscalConfig, data.workBenefits);
    return { taxDue: b.taxAmount, taxableIncome: b.netTaxableYear, beforeAllowance: b.netTaxableBeforeAllowance };
  }, [dashboardConfig, data.fiscalConfig, data.workBenefits, data.grossAnnual]);

  // Veille fiscale hebdomadaire (serveur + Workers AI, sinon Gemini) : propositions à valider.
  const fiscalWatch = useFiscalWatch(data.geminiApiKey, data.fiscalConfig, data.accounts, isAuthenticated && !data.isLoadingData && !locked);
  const applyFiscalProposal = (p: FiscalProposal) => {
    const next = p.apply({ fiscal: data.fiscalConfig, accounts: data.accounts });
    data.setFiscalConfig(next.fiscal);
    if (next.accounts !== data.accounts) data.setAccounts(next.accounts);
    addToast({ message: `${p.label} mis à jour`, kind: 'success' });
  };
  const fiscalWatchCard = (compact: boolean) => (
    <FiscalWatchCard compact={compact} proposals={fiscalWatch.proposals} running={fiscalWatch.running} checkedAt={fiscalWatch.checkedAt}
      lastError={fiscalWatch.lastError} hasKey={fiscalWatch.hasKey} canRun={fiscalWatch.canRun} source={fiscalWatch.source} runningVia={fiscalWatch.runningVia}
      serverReport={fiscalWatch.serverReport} onApply={applyFiscalProposal} onDismiss={fiscalWatch.dismiss} onRun={fiscalWatch.run} />
  );
  const askConfirm = (title: string, message: string, onConfirm: () => void | Promise<void>, danger = false) =>
    setDialog({ open: true, kind: 'confirm', title, message, danger, confirmLabel: 'Confirmer', onConfirm: () => { void onConfirm(); } });

  // Mois avant la restitution prévue du capital parental (pour la projection).
  const restitutionInMonths = useMemo(() => {
    const r = data.parentalRestitution;
    if (!r?.plannedDate || r.done) return undefined;
    const d = new Date(r.plannedDate), now = new Date();
    const months = (d.getFullYear() - now.getFullYear()) * 12 + d.getMonth() - now.getMonth();
    return months >= 0 ? months : undefined;
  }, [data.parentalRestitution]);

  // Charges fixes vues par les écrans en lecture seule (survie, objectifs, simulateur) :
  // charges saisies + abonnements actifs. Le Pilotage, lui, les affiche séparément.
  const allCharges = useMemo(
    () => [...data.expenses, ...subscriptionsAsExpenses(data.subscriptions)],
    [data.expenses, data.subscriptions]
  );

  // Objectif du mois pour la jauge « Placé ce mois-ci » : même montant que le rappel de paie.
  const { buildData, setLastView, loadDemoData } = data;
  const monthPlan = useMemo(
    () => data.paydayAmount ?? computeMonthlySavingsCapacity(buildData()),
    [data.paydayAmount, buildData]
  );
  const monthlyPay = useMemo(() => computeMonthlyPay(buildData()), [buildData]);
  // Instantané complet des données (agenda, bilan annuel).
  const fullData = useMemo(() => buildData(), [buildData]);
  const agendaNext = useMemo(() => buildAgenda(fullData).events.slice(0, 3), [fullData]);
  const lepTimeline = useMemo(() => lepTimelineFromData(fullData), [fullData]);
  // Épargne de précaution : charges fixes + argent plaisir, multipliés par le nombre de mois choisi.
  const emergency = useMemo(
    () => computeEmergencyFund(data.accounts, totalFixedCharges(data.expenses, data.subscriptions) + (data.leisureBudget || 0), data.config.emergencyMonths ?? DEFAULT_EMERGENCY_MONTHS),
    [data.accounts, data.expenses, data.subscriptions, data.leisureBudget, data.config.emergencyMonths]
  );

  // Motivation : jalons déjà montrés et points de paie validés (synchronisés sur Drive).
  const { patchConfig } = data;
  const milestonesSeenRef = useRef(data.config.milestonesSeen);
  milestonesSeenRef.current = data.config.milestonesSeen;
  const payReviewsDoneRef = useRef(data.config.payReviewsDone);
  payReviewsDoneRef.current = data.config.payReviewsDone;
  const markMilestonesSeen = useCallback((ids: string[]) => {
    patchConfig({ milestonesSeen: [...new Set([...(milestonesSeenRef.current ?? []), ...ids])] });
  }, [patchConfig]);
  const validatePayReview = useCallback((key: string) => {
    // Les 24 derniers suffisent : un point de paie ne revient jamais sur une paie plus ancienne.
    patchConfig({ payReviewsDone: [...(payReviewsDoneRef.current ?? []).filter(k => k !== key), key].slice(-24) });
  }, [patchConfig]);

  // Pastille sur l'icône de l'app installée : nombre de choses à faire.
  useEffect(() => {
    if (!isAuthenticated || data.isLoadingData) return;
    const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
    const n = computeBadgeCount(fullData);
    (n > 0 ? nav.setAppBadge?.(n) : nav.clearAppBadge?.())?.catch(() => { /* non pris en charge */ });
  }, [fullData, isAuthenticated, data.isLoadingData]);

  // Sauvegarde de secours chiffrée (serveur) : au plus une fois par semaine, si les données
  // ont changé. Attend 30 s de calme après le chargement ou la dernière modification, ne
  // bloque jamais l'écran, et ne part jamais d'un état douteux (erreur, conflit, copie locale).
  const cloudBackupReady = isAuthenticated && !locked && !data.isLoadingData && !data.syncError && !data.syncConflict
    && !data.sessionExpired && !data.appOutdated && !data.localBackup;
  useEffect(() => {
    if (!cloudBackupReady || !isBackendEnabled()) return;
    const t = setTimeout(() => { void maybeAutoUpload(fullData); }, 30_000);
    return () => clearTimeout(t);
  }, [cloudBackupReady, fullData]);

  // Hausse de salaire repérée sur les fiches de paie (proposée une seule fois par fiche).
  const payRaise = useMemo(() => {
    const r = detectPayRaise(data.payslips);
    if (!r) return null;
    try { if (localStorage.getItem(`pay_raise_seen_${r.latest.id}`)) return null; } catch { /* ignoré */ }
    return r;
  }, [data.payslips]);
  const [payRaiseHandled, setPayRaiseHandled] = useState(false);
  const dismissPayRaise = () => {
    if (payRaise) { try { localStorage.setItem(`pay_raise_seen_${payRaise.latest.id}`, '1'); } catch { /* ignoré */ } }
    setPayRaiseHandled(true);
  };
  const acceptPayRaise = () => {
    if (!payRaise) return;
    const delta = Math.round(payRaise.delta);
    if (data.paydayAmount !== undefined) data.setPaydayAmount(Math.round(data.paydayAmount + delta));
    if (data.activePayslipId !== payRaise.latest.id) data.setActivePayslipId(payRaise.latest.id);
    addToast({ message: data.paydayAmount !== undefined ? `Épargne mensuelle portée à ${formatEUR(Math.round(data.paydayAmount + delta))}` : 'Pilotage basé sur votre nouvelle fiche de paie', kind: 'success' });
    dismissPayRaise();
  };

  // Lien direct vers un écran (`?view=update`), utilisé par les notifications. Traité
  // après authentification + déverrouillage, comme le raccourci d'ajout rapide.
  const deepLinkedRef = useRef(false);

  // Changer d'écran : retour en haut, titre de l'onglet, et focus sur le titre de l'écran
  // (annoncé par les lecteurs d'écran).
  const mainRef = useRef<HTMLElement>(null);
  const firstViewRef = useRef(true);
  useEffect(() => {
    document.title = isAuthenticated ? `${navLabel(view)} · Pécule` : 'Pécule';
    const main = mainRef.current;
    if (!main) return;
    main.scrollTo({ top: 0 });
    if (firstViewRef.current) { firstViewRef.current = false; return; }
    // Le titre de l'écran (h1 ou h2) ; à défaut, la zone principale elle-même. Les écrans
    // chargés à la demande peuvent arriver après coup : on réessaie tant que le focus n'est
    // pas posé dans le nouvel écran (1,5 s au plus).
    let tries = 0;
    const t = setInterval(() => {
      tries++;
      const h = main.querySelector<HTMLElement>('h1, h2');
      if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); }
      const settled = h && document.activeElement === h;
      if (settled || tries >= 15) {
        clearInterval(t);
        if (!settled) main.focus({ preventScroll: true });
      }
    }, 100);
    return () => clearInterval(t);
  }, [view, isAuthenticated]);

  // Les écrans sont chargés à la demande : on précharge les plus utilisés une fois connecté,
  // pour éviter le petit temps de chargement à leur première ouverture.
  useEffect(() => {
    if (!isAuthenticated) return;
    const t = setTimeout(() => {
      // Préchargement facultatif : un échec (hors ligne) sera rejoué à l'ouverture de l'écran.
      for (const load of [() => import('./components/AccountUpdate'), () => import('./components/AssistantPilot'), () => import('./components/TransferManager'), () => import('./components/Yield')]) {
        load().catch(() => undefined);
      }
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
      if (!target || !VALID_VIEWS.includes(target)) return;
      // « Votre année » (notification de janvier) : l'année passe par l'adresse, lue par
      // Historique à l'ouverture, et par un événement s'il est déjà affiché.
      const year = typeof e.data.year === 'string' && /^\d{4}$/.test(e.data.year) ? e.data.year : null;
      if (year) {
        window.history.replaceState(window.history.state, '', `${window.location.pathname}?year=${year}`);
        window.dispatchEvent(new CustomEvent('pecule:open-year', { detail: Number(year) }));
      }
      deepLinkedRef.current = true;
      setView(target);
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, []);

  // Sync view from data (au premier chargement). Mise à jour fonctionnelle : on lit l'écran
  // courant sans dépendre de `view`, sinon revenir au tableau de bord relancerait l'effet
  // (avec l'ancien `lastView`) et renverrait aussitôt vers l'écran précédent.
  useEffect(() => {
    const last = data.lastView;
    if (!last || deepLinkedRef.current || !VALID_VIEWS.includes(last as View)) return;
    setView(v => (v === 'dashboard' ? last as View : v));
  }, [data.lastView]);

  useEffect(() => { setLastView(view); }, [view, setLastView]);

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
  }, [data.lastSavedAt, addToast]);

  // Init Google API — une seule fois par chargement de page : en développement, React
  // (StrictMode) rejoue les effets de montage, ce qui lançait deux initialisations
  // concurrentes (deux rafraîchissements, deux consommations du code de connexion...).
  // Les données ne sont chargées qu'une fois l'appareil déverrouillé : tant que le verrou
  // est affiché, rien de financier n'est lu ni gardé en mémoire.
  const [loadRequested, setLoadRequested] = useState(false);
  useEffect(() => {
    if (loadRequested && !locked) { setLoadRequested(false); void data.loadDriveData(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadRequested, locked]);

  const initStartedRef = useRef(false);
  useEffect(() => {
    if (initStartedRef.current) return;
    initStartedRef.current = true;
    // Mode démo (développement uniquement) : données fictives, sans Google.
    if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('demo')) {
      import('./dev/demoData').then(({ DEMO_DATA }) => { setIsApiLoaded(true); setIsAuthenticated(true); loadDemoData(DEMO_DATA); }).catch(console.error);
      return;
    }
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
              setLoadRequested(true);
            }
          } catch (e) {
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
               setLoadRequested(true);
           } else {
               try {
                   await handleAuthClick(true); // Silent
                   setIsAuthenticated(true);
                   setLoadRequested(true);
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
  }, [addToast, loadDemoData]);

  const handleLogin = async () => {
    try {
      await handleAuthClick(false);
      setIsAuthenticated(true);
      void data.loadDriveData();
    } catch (error) {
      addToast({ message: 'Échec de la connexion à Google Drive.', kind: 'error' });
    }
  };

  const handleReconnect = async () => {
    try {
      await handleAuthClick(false);
      // Chargement normal, pas « recharger l'autre version » : des modifications faites
      // pendant l'expiration de la session restent proposées (copie locale), et un conflit
      // en cours n'est jamais tranché à la place de l'utilisateur.
      void data.loadDriveData();
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
  // Tout ce qui change les soldes passe par les commandes de src/lib/commands (pures et
  // testées : elles appliquent elles-mêmes les règles du capital des parents et préparent
  // l'annulation exacte). Ici, seulement l'interface : confirmation, toasts, écriture.

  // État le plus récent pour les commandes : une confirmation ou une annulation (toast)
  // s'applique à l'état du moment, pas à celui du rendu qui l'a créée.
  const commandStateRef = useRef<CommandState>({ accounts: data.accounts, parentalRestitution: data.parentalRestitution });
  commandStateRef.current = { accounts: data.accounts, parentalRestitution: data.parentalRestitution };
  const commit = (patch: CommandPatch) => {
    commandStateRef.current = { ...commandStateRef.current, ...patch };
    if (patch.accounts) data.setAccounts(patch.accounts);
    if ('parentalRestitution' in patch) data.setParentalRestitution(patch.parentalRestitution);
  };
  const undoAction = (r: CommandOk) => ({ label: 'Annuler', onClick: () => commit(r.undo(commandStateRef.current)) });
  // Compte ou mouvement disparu entre-temps : rien à signaler (comme avant les commandes).
  const showCommandError = (e: CommandError) => { if (e.code !== 'not-found') addToast({ message: e.error, kind: 'error' }); };

  const handleSaveAccount = (acc: SavingsAccount) => {
    const r = saveAccount(commandStateRef.current, { account: acc, today: localTodayISO() });
    if (!r.ok) { showCommandError(r); return; }
    commit(r.next);
    setShowForm(false);
    setEditingAccount(undefined);
  };

  const handleDeleteMovement = (accountId: string, movementId: string) => {
    const plan = planMovementDeletion(data.accounts, accountId, movementId);
    if (!plan.ok) { showCommandError(plan); return; }
    const { movement, legs, isTransfer } = plan;
    setDialog({
      open: true, kind: 'confirm', danger: true, confirmLabel: 'Supprimer',
      title: isTransfer ? 'Supprimer le virement' : 'Supprimer le mouvement',
      message: isTransfer
        ? `« ${movement.label} » est un virement interne : les ${legs.length} lignes liées seront supprimées ensemble.`
        : `« ${movement.label} » sera supprimé.`,
      onConfirm: () => {
        const r = deleteMovement(commandStateRef.current, { accountId, movementId });
        if (!r.ok) { showCommandError(r); return; }
        commit(r.next);
        addToast({ message: r.message, action: undoAction(r) });
      },
    });
  };


  const handleRenameMovement = (accountId: string, movementId: string, currentLabel: string) => {
    const m = data.accounts.find(a => a.id === accountId)?.movements?.find(x => x.id === movementId);
    if (m && isRestitutionMovement(m)) return;
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
        // L'annulation remet le compte à sa place d'origine (voir deleteAccount).
        const r = deleteAccount(commandStateRef.current, { accountId: acc.id });
        if (!r.ok) { showCommandError(r); return; }
        commit(r.next);
        addToast({ message: r.message, action: undoAction(r) });
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
    // Garde-fou dans la commande : un retrait ne peut pas entamer la part des parents.
    const r = quickAdd(commandStateRef.current, { accountId, amount, type, label, date });
    if (!r.ok) { showCommandError(r); return undefined; }
    commit(r.next);
    addToast({ message: r.message, kind: 'success' });
    return r.movementId;
  };


  // Mode solo : plus aucun compte n'a de part parentale (après la restitution). L'écran
  // Part parentale reste accessible tant qu'un relevé de restitution existe.
  const hasParental = data.accounts.some(a => a.parentalCapital > 0);
  const showParentalScreen = hasParental || !!data.parentalRestitution?.done;

  // --- RESTITUTION DU CAPITAL PARENTAL ---
  // Retire la part des parents de chaque compte (la part propre ne bouge pas), garde un
  // relevé (montants, intérêts offerts) : voir lib/commands/restitution.
  const handleRestitution = (date: string) => {
    const r = recordRestitution(commandStateRef.current, { date });
    if (!r.ok) { showCommandError(r); return; }
    commit(r.next);
    addToast({ message: r.message, kind: 'success', action: undoAction(r) });
  };

  // Annulation depuis l'écran (après coup) : les mouvements de restitution sont retirés,
  // ce qui rend leur part aux parents.
  const handleUndoRestitution = () => {
    const r = undoRestitution(commandStateRef.current);
    if (!r.ok) return;
    commit(r.next);
    addToast({ message: r.message, kind: 'success' });
  };

  // Annule un versement enregistré depuis la liste des virements de paie : retire le
  // mouvement et rétablit solde et versements cumulés.
  const handleCancelPayDeposit = (accountId: string, movementId: string) => {
    const r = cancelDeposit(commandStateRef.current, { accountId, movementId });
    if (!r.ok) { showCommandError(r); return; }
    commit(r.next);
  };

  const handleRemoveCancelling = (groups: CancellingGroup[]) => {
    // Mouvements qui s'annulent : leur somme est nulle, les soldes ne bougent pas.
    const r = removeCancellingMovements(commandStateRef.current, groups);
    if (!r.ok) { showCommandError(r); return; }
    commit(r.next);
    addToast({ message: r.message, kind: 'success', action: undoAction(r) });
  };


  // --- RENDU ---

  // Verrou biométrique en tout premier : avant même de décider s'il faut afficher l'écran
  // de connexion ou les données, pour ne jamais laisser filtrer d'information (y compris
  // le simple fait qu'une session Google est déjà active) tant que ce n'est pas déverrouillé.
  if (locked) {
    return <AppLockScreen onUnlock={() => setLocked(false)} onForgot={async () => {
      await handleLogout().catch(() => undefined);
      try { ['gemini_api_key', 'suivi_epargne_last_save', 'last_view'].forEach(k => localStorage.removeItem(k)); } catch { /* stockage bloqué */ }
      setLocked(false);
    }} />;
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-sapin flex flex-col items-center justify-center p-4">
        <div className="bg-surface-container-low text-on-surface p-8 rounded-3xl shadow-xl max-w-md w-full text-center">
          <Logo className="w-16 h-16 mx-auto mb-6 shadow-lg" />
          <h1 className="text-[32px] leading-10 font-bold text-on-surface mb-1">Pécule</h1>
          <p className="text-sm font-bold text-indigo-700 dark:text-indigo-300 mb-4">Faites pousser votre épargne</p>
          <p className="text-slate-500 dark:text-slate-400 mb-8">Vos données sont stockées en sécurité sur votre Google Drive personnel.</p>
          {apiError ? (
            <div className="text-left bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 rounded-xl p-4">
              <p className="text-sm font-black text-rose-700 dark:text-rose-300 mb-2 flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> Impossible de charger les services Google</p>
              <p className="text-xs text-rose-700 dark:text-rose-400 mb-3">Vérifiez votre connexion (ou un bloqueur de scripts) puis réessayez.</p>
              <button onClick={() => window.location.reload()} className="w-full py-2.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-sm font-black">Recharger l'application</button>
            </div>
          ) : !isApiLoaded ? <div className="flex justify-center gap-2 text-indigo-600 font-bold"><Loader2 className="animate-spin" aria-hidden="true"/> Connexion à Google…</div> :
            <button onClick={handleLogin} className="w-full h-12 flex items-center justify-center gap-3 bg-transparent border border-outline rounded-full font-medium hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 transition-colors">Continuer avec Google</button>
          }
        </div>
        <p className="mt-4 text-xs font-bold text-emerald-50/85 flex gap-4 justify-center">
          <a href="presentation.html" className="underline underline-offset-2 hover:text-white">Découvrir Pécule</a>
          <a href="confidentialite.html" className="underline underline-offset-2 hover:text-white">Confidentialité</a>
        </p>
        <p className="mt-2 text-[11px] font-bold text-emerald-100/70">version {LATEST_VERSION}</p>
      </div>
    );
  }

  if (data.isLoadingData) return <div className="min-h-screen flex justify-center items-center flex-col gap-4 bg-slate-50 dark:bg-slate-900"><Loader2 className="animate-spin w-10 h-10 text-indigo-600"/><p className="text-slate-500 dark:text-slate-400 font-bold">Chargement de vos données…</p></div>;

  return (
    <ToastContext.Provider value={addToast}>
    <div className="min-h-screen bg-surface flex flex-col md:flex-row font-sans text-on-surface">
      <a href="#contenu" onClick={e => { e.preventDefault(); mainRef.current?.focus(); }}
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-100 focus:px-4 focus:py-2 focus:rounded-lg focus:bg-white focus:text-slate-900 focus:font-bold focus:shadow-lg">
        Aller au contenu
      </a>
      <aside className="hidden md:flex bg-surface-container-low text-on-surface w-full md:w-72 shrink-0 flex-col">
        <div className="px-7 pt-6 pb-3">
          <h1 className="text-2xl font-bold text-primary dark:text-on-surface flex items-center gap-3"><Logo className="w-9 h-9" /> Pécule</h1>
          <div className="mt-3 text-xs text-on-surface-variant font-medium flex items-center justify-between gap-2">
            <div className="flex items-center gap-2" title={data.lastSavedAt ? `Dernière écriture confirmée sur Drive : ${data.lastSavedAt.toLocaleTimeString('fr-FR')}` : undefined}>
              <div className={`w-2 h-2 rounded-full shrink-0 ${data.isOffline ? 'bg-slate-400' : data.isSaving ? 'bg-amber-500 animate-pulse' : data.syncError || data.syncConflict ? 'bg-rose-500' : 'bg-emerald-500'}`}></div>
              {data.isOffline ? 'Hors ligne' : data.isSaving ? 'Sauvegarde...' : data.syncError ? 'Erreur sync' : data.syncConflict ? 'Conflit' : data.lastSavedAt ? `Sur Drive à ${data.lastSavedAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` : 'Synchronisé'}
            </div>
            <button onClick={toggleTheme} className="p-2 -m-2 rounded-full text-on-surface-variant hover:bg-on-surface/8" title={isDark ? 'Passer en clair' : 'Passer en sombre'} aria-label={isDark ? 'Passer en clair' : 'Passer en sombre'}>
              {isDark ? <Sun className="w-4 h-4" aria-hidden="true" /> : <Moon className="w-4 h-4" aria-hidden="true" />}
            </button>
          </div>
        </div>
        <nav aria-label="Navigation principale" className="flex-1 px-3 pb-3 overflow-y-auto space-y-0.5">
          {NAV_ITEMS.filter(i => !i.section && i.key !== 'settings').map(i => <NavButton key={i.key} active={view === i.key} onClick={() => setView(i.key)} icon={i.icon} label={i.label} />)}
          {NAV_SECTIONS.map(section => (
            <React.Fragment key={section}>
              <div className="pt-5 pb-2 px-4 text-sm font-medium text-on-surface-variant">{section}</div>
              {NAV_ITEMS.filter(i => i.section === section && (i.key !== 'parental' || showParentalScreen)).map(i => <NavButton key={i.key} active={view === i.key} onClick={() => setView(i.key)} icon={i.icon} label={i.label} />)}
            </React.Fragment>
          ))}
          <div className="my-3 border-t border-outline-variant mx-4"></div>
          <NavButton active={view === 'settings'} onClick={() => setView('settings')} icon={SettingsIcon} label="Paramètres" />
        </nav>
        <div className="px-3 py-3 border-t border-outline-variant">
            <button onClick={handleLogout} className="w-full h-12 flex items-center gap-3 px-4 text-error hover:bg-error/8 rounded-full font-medium text-sm transition-colors"><LogOut className="w-5 h-5" aria-hidden="true" /> Déconnexion</button>
            <button onClick={() => setView('settings')} className="w-full mt-1 px-4 text-left text-[11px] font-medium text-on-surface-variant hover:text-on-surface" title="Historique des mises à jour dans Paramètres">Pécule · version {LATEST_VERSION}{typeof __BUILD_SHA__ !== "undefined" && __BUILD_SHA__ !== "dev" ? ` · ${__BUILD_SHA__}` : ""}</button>
        </div>
      </aside>

      {/* Header compact mobile (la sidebar est masquée en dessous de md) */}
      <header className="md:hidden sticky top-0 z-30 bg-surface-container text-on-surface px-4 h-16 flex items-center justify-between">
        <h1 className="text-[22px] font-bold text-primary dark:text-on-surface flex items-center gap-2"><Logo className="w-8 h-8" /> Pécule</h1>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5" title={data.lastSavedAt ? `Dernière écriture confirmée sur Drive : ${data.lastSavedAt.toLocaleTimeString('fr-FR')}` : undefined}>
            <div className={`w-2 h-2 rounded-full shrink-0 ${data.isOffline ? 'bg-slate-400' : data.isSaving ? 'bg-amber-500 animate-pulse' : data.syncError || data.syncConflict ? 'bg-rose-500' : 'bg-emerald-500'}`}></div>
            <span className="text-xs font-medium text-on-surface-variant">
              {data.isOffline ? 'Hors ligne' : data.isSaving ? 'Sauvegarde...' : data.syncError ? 'Erreur' : data.syncConflict ? 'Conflit' : data.lastSavedAt ? data.lastSavedAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : 'Sync'}
            </span>
          </div>
          <button onClick={toggleTheme} className="p-2.5 -m-1 rounded-full text-on-surface-variant hover:bg-on-surface/8" title="Thème" aria-label="Changer de thème">{isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}</button>
          <button onClick={() => setDialog({ open: true, kind: 'confirm', title: 'Se déconnecter ?', message: 'Les données restent sur votre Drive ; il faudra vous reconnecter avec Google.', confirmLabel: 'Se déconnecter', onConfirm: () => { void handleLogout(); } })} className="p-2.5 -m-1 rounded-full text-error hover:bg-error/8" aria-label="Se déconnecter"><LogOut className="w-4 h-4" /></button>
        </div>
      </header>

      <main ref={mainRef} id="contenu" tabIndex={-1} className="outline-none flex-1 bg-surface p-4 md:p-8 overflow-y-auto relative h-dvh pb-40 md:pb-24">

        <div className="max-w-7xl mx-auto pb-20">
            {/* --- BANNIÈRES DE SYNCHRONISATION --- */}
            {data.isOffline && (
              <div role="status" className="mb-4 inline-flex items-center gap-2 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-full px-3 py-1.5 text-xs font-bold text-slate-700 dark:text-slate-200">
                <WifiOff className="w-4 h-4 shrink-0" aria-hidden="true" /> Hors ligne : vos modifications partiront sur Drive au retour du réseau.
              </div>
            )}
            {data.appOutdated && (
              <div role="alert" className="mb-4 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-xl p-4 flex items-center justify-between gap-4">
                <div className="flex items-center gap-2 text-amber-800 dark:text-amber-300 text-sm font-bold"><AlertTriangle className="w-5 h-5 shrink-0"/> Vos données ont été enregistrées par une version plus récente de Pécule. Mettez l'app à jour : rien ne sera enregistré d'ici là.</div>
                <button onClick={() => window.location.reload()} className="bg-amber-700 hover:bg-amber-800 text-white px-4 py-2 rounded-lg font-bold text-sm shrink-0">Mettre à jour</button>
              </div>
            )}
            {data.sessionExpired && (
              <div role="alert" className="mb-4 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-xl p-4 flex items-center justify-between gap-4">
                <div className="flex items-center gap-2 text-amber-800 dark:text-amber-300 text-sm font-bold"><AlertTriangle className="w-5 h-5 shrink-0"/> Votre session Google a expiré. Reconnectez-vous pour continuer à sauvegarder.</div>
                <button onClick={handleReconnect} className="bg-amber-700 hover:bg-amber-800 text-white px-4 py-2 rounded-lg font-bold text-sm shrink-0">Se reconnecter</button>
              </div>
            )}
            {data.syncConflict && (
              <div role="alert" className="mb-4 bg-orange-50 dark:bg-orange-950/40 border border-orange-200 dark:border-orange-800 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-2 text-orange-800 dark:text-orange-300 text-sm font-bold"><AlertTriangle className="w-5 h-5 shrink-0"/> Vos données ont été modifiées sur un autre appareil. Choisissez la version à garder.</div>
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={data.forceSaveToDrive} className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg font-bold text-sm flex items-center gap-2"><Save className="w-4 h-4"/> Garder mes modifications</button>
                  <button onClick={data.reloadFromDrive} className="bg-orange-700 hover:bg-orange-800 text-white px-4 py-2 rounded-lg font-bold text-sm flex items-center gap-2"><RotateCw className="w-4 h-4"/> Recharger l'autre version</button>
                </div>
              </div>
            )}
            {data.syncError && !data.sessionExpired && !data.syncConflict && !data.isOffline && (
              <div role="alert" className="mb-4 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-xl p-3 text-rose-700 dark:text-rose-300 text-sm font-bold flex items-center justify-between gap-3">
                <span className="flex items-center gap-2"><AlertTriangle className="w-4 h-4 shrink-0"/> La dernière sauvegarde a échoué.</span>
                <button onClick={data.forceSaveToDrive} className="bg-rose-600 hover:bg-rose-700 text-white px-3 py-1.5 rounded-lg font-bold text-xs shrink-0">Réessayer</button>
              </div>
            )}
            {data.localBackup && (
              <div className="mb-4 bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-2 text-indigo-800 dark:text-indigo-300 text-sm font-bold"><AlertTriangle className="w-5 h-5 shrink-0"/> Une sauvegarde locale du {new Date(data.localBackup.savedAt).toLocaleString('fr-FR')} n'a jamais été synchronisée avec Drive et diffère de ce qui est affiché. La restaurer ?</div>
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={data.restoreLocalBackup} className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg font-bold text-sm">Restaurer cette sauvegarde</button>
                  <button onClick={data.dismissLocalBackup} className="bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 px-4 py-2 rounded-lg font-bold text-sm">Ignorer</button>
                </div>
              </div>
            )}

            <ErrorBoundary resetKey={view}>
            <Suspense fallback={<ViewLoader />}>
            {view === 'dashboard' && fiscalWatch.proposals.length > 0 && <div className="mb-6">{fiscalWatchCard(true)}</div>}
            {view === 'dashboard' && <Dashboard accounts={data.accounts} history={data.history} expenses={allCharges} fiscalConfig={data.fiscalConfig} workBenefits={data.workBenefits} onDeleteAccount={handleDeleteAccount} config={dashboardConfig} monthPlan={monthPlan} monthlyPay={monthlyPay} paydayDay={data.paydayDay} trackingStartDate={data.trackingStartDate} payRaise={payRaise && !payRaiseHandled ? { delta: payRaise.delta, period: payRaise.latest.extracted.period || '', hasFixedAmount: data.paydayAmount !== undefined } : null} onAcceptPayRaise={acceptPayRaise} onDismissPayRaise={dismissPayRaise} subscriptions={data.subscriptions} onUpdateFiscalConfig={data.setFiscalConfig} onUpdateAccounts={data.setAccounts} onOpenSettings={() => setView('settings')} recurringMovements={data.recurringMovements} onRecordRecurring={(r, date) => handleQuickAdd(r.accountId, r.amount, r.type, r.label, date)} onNavigate={setView} onAddAccount={() => { setView('accounts'); setEditingAccount(undefined); setShowForm(true); }} lastExportAt={data.config.lastExportAt} onExport={() => { data.exportData(); data.patchConfig({ lastExportAt: localTodayISO() }); }} emergency={emergency} onSetEmergencyMonths={m => data.patchConfig({ emergencyMonths: m })} agendaNext={agendaNext} lepTimeline={lepTimeline}
              payslips={data.payslips} gamification={data.config.gamification} goodMonthThreshold={data.config.goodMonthThreshold}
              milestonesSeen={data.config.milestonesSeen} payReviewsDone={data.config.payReviewsDone} rfrByYear={data.config.rfrByYear}
              restitutionDoneOn={data.parentalRestitution?.done?.date} restitutionPlannedDate={data.parentalRestitution?.plannedDate} onMarkMilestonesSeen={markMilestonesSeen} onValidatePayReview={validatePayReview} />}

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
                savingsSplit={data.savingsSplit}
                savingsSplitFrom={data.savingsSplitFrom}
                onSavingsSplitChange={(split, from) => { data.setSavingsSplit(split); data.setSavingsSplitFrom(from); }}
                onPayChecklistChange={data.setPayChecklist}
                onRecordPayDeposit={(accountId, amount) => handleQuickAdd(accountId, amount, 'IN', 'Virement de paie', localTodayISO())}
                onCancelPayDeposit={handleCancelPayDeposit}
                paydayDay={data.paydayDay}
                setPaydayDay={data.setPaydayDay}
                paydayAmount={data.paydayAmount}
                setPaydayAmount={data.setPaydayAmount}
            />}

            {view === 'transfers' && <TransferManager accounts={data.accounts} onUpdateAccountsComplex={data.updateAccountsWithMovements} onLinkedTransfer={data.executeLinkedTransfer} lastSavedAt={data.lastSavedAt} recurringMovements={data.recurringMovements} onUpdateRecurring={data.setRecurringMovements} />}
            {view === 'update' && <AccountUpdate accounts={data.accounts} onUpdateAccountsComplex={data.updateAccountsWithMovements} lastSavedAt={data.lastSavedAt} onAddAccount={() => { setView('accounts'); setEditingAccount(undefined); setShowForm(true); }} />}

            {view === 'yield' && <Yield accounts={data.accounts} fiscalConfig={data.fiscalConfig} monthPlan={monthPlan} savingsSplit={data.savingsSplit} restitutionInMonths={restitutionInMonths} />}
            {view === 'simulator' && <Simulator accounts={data.accounts} fiscalConfig={data.fiscalConfig} monthPlan={monthPlan} savingsSplit={data.savingsSplit} paydayDay={data.paydayDay} payslips={data.payslips} trackingStartDate={data.trackingStartDate} parentalRestitution={data.parentalRestitution} />}
            {view === 'history' && <History history={data.history} expensesHistory={data.expensesHistory} reviewData={fullData} />}
            {view === 'journal' && <Journal
                accounts={data.accounts}
                restitution={data.parentalRestitution}
                onDeleteMovement={handleDeleteMovement}
                trackingStartDate={data.trackingStartDate}
                onSetTrackingStart={(date) => {
                  const prev = data.trackingStartDate;
                  data.setTrackingStartDate(date);
                  addToast({ message: date ? `Suivi de l'épargne reparti du ${parseISODate(date).toLocaleDateString('fr-FR')}` : 'Point de départ retiré', kind: 'success', action: { label: 'Annuler', onClick: () => data.setTrackingStartDate(prev) } });
                }}
                onToggleAdjustment={(accountId, movementId) => {
                  data.setAccounts(prev => prev.map(a => a.id !== accountId ? a : {
                    ...a, movements: (a.movements || []).map(m => m.id !== movementId ? m : (m.kind === 'adjustment' ? { ...m, kind: undefined } : { ...m, kind: 'adjustment' })),
                  }));
                }}
                onRemoveCancelling={handleRemoveCancelling}
                onRevertRate={(accountId, entryDate) => {
                  // Annule le changement de taux sur TOUT le groupe changé ensemble (Livret A et
                  // LDDS), remet le rappel de révision et propose de revenir en arrière.
                  const source = data.accounts.find(a => a.id === accountId);
                  const group = REGULATED_RATE_GROUPS.find(g => source && g.types.includes(source.type));
                  const ids = data.accounts
                    .filter(a => a.id === accountId || (group && group.types.includes(a.type) && (a.rateHistory || []).some(h => h.date === entryDate)))
                    .map(a => a.id);
                  const before = data.accounts.filter(a => ids.includes(a.id)).map(a => ({ id: a.id, interestRate: a.interestRate, rateHistory: a.rateHistory, rateReviewedAt: a.rateReviewedAt }));
                  data.setAccounts(prev => prev.map(a => {
                    if (!ids.includes(a.id)) return a;
                    const entry = (a.rateHistory || []).find(h => h.date === entryDate);
                    if (!entry) return a;
                    const rest = (a.rateHistory || []).filter(h => h !== entry);
                    return { ...a, interestRate: entry.rate, rateHistory: rest.length > 0 ? rest : undefined,
                      rateReviewedAt: a.rateReviewedAt && a.rateReviewedAt >= entryDate ? undefined : a.rateReviewedAt };
                  }));
                  addToast({
                    message: ids.length > 1 ? `Changement de taux annulé (${ids.length} comptes)` : 'Changement de taux annulé',
                    kind: 'success',
                    action: { label: 'Rétablir', onClick: () => data.setAccounts(prev => prev.map(a => {
                      const b = before.find(x => x.id === a.id);
                      return b ? { ...a, interestRate: b.interestRate, rateHistory: b.rateHistory, rateReviewedAt: b.rateReviewedAt } : a;
                    })) },
                  });
                }}
            />}
            {view === 'agenda' && <Agenda data={fullData} onOpen={(v) => VALID_VIEWS.includes(v as View) && setView(v as View)} />}
            {view === 'parental' && <ParentalShare
                accounts={data.accounts}
                restitution={data.parentalRestitution}
                monthPlan={monthPlan}
                hasCustomSplit={!!data.savingsSplit?.length}
                onPlanRestitution={(date) => data.setParentalRestitution(prev => ({ ...prev, plannedDate: date }))}
                onRestitute={handleRestitution}
                onUndoRestitution={handleUndoRestitution}
                soloPlanSlot={data.parentalRestitution?.plannedDate && !data.parentalRestitution.done
                  ? <SoloPlanCard accounts={data.accounts} fiscalConfig={data.fiscalConfig} monthPlan={monthPlan} restitutionISO={data.parentalRestitution.plannedDate} split={data.savingsSplit} emergencyTarget={emergency?.target} />
                  : undefined}
            />}
            {view === 'donations' && <Donations donations={data.donations} onUpdate={data.setDonations} pickerApiKey={data.pickerApiKey} taxEstimate={taxEstimate} ceiling75={data.fiscalConfig.donation75Ceiling} taxHelper={<TaxReturnHelper data={fullData} estimatedNetTaxableBeforeAllowance={taxEstimate?.beforeAllowance} allowanceRate={data.fiscalConfig.standardAllowance} allowanceCap={data.fiscalConfig.standardAllowanceCap} ceiling75={data.fiscalConfig.donation75Ceiling} />} />}
            {view === 'subscriptions' && <Subscriptions subscriptions={data.subscriptions} onUpdate={data.setSubscriptions} monthlyPay={monthlyPay} />}
            {view === 'payslips' && <Payslips payslips={data.payslips} onUpdatePayslips={data.setPayslips} geminiApiKey={data.geminiApiKey} pickerApiKey={data.pickerApiKey} onApplyToPilotage={handleApplyPayslipToPilotage} activePayslipId={data.activePayslipId} onClearActivePayslip={handleClearActivePayslip} />}

            {view === 'settings' && (
                <Settings
                    payslips={data.payslips}
                    notificationPrefs={data.config.notificationPrefs}
                    onChangeNotificationPrefs={p => data.patchConfig({ notificationPrefs: p })}
                    config={data.fiscalConfig}
                    workBenefits={data.workBenefits}
                    geminiApiKey={data.geminiApiKey}
                    pickerApiKey={data.pickerApiKey}
                    onExport={() => { data.exportData(); data.patchConfig({ lastExportAt: localTodayISO() }); }}
                    onImport={data.importData}
                    backupSlot={<>
                      <DriveBackupsPanel list={data.listDriveBackups} restore={data.restoreDriveBackup} confirm={(t, m, ok) => askConfirm(t, m, ok, true)} />
                      <CloudBackupPanel getData={data.buildData} onImport={data.importData} confirm={askConfirm} />
                    </>}
                    fiscalWatchSlot={fiscalWatchCard(false)}
                    taxNoticeSlot={<TaxNoticePanel geminiApiKey={data.geminiApiKey} rfrByYear={data.config.rfrByYear || {}} householdParts={data.fiscalConfig.lepHouseholdParts}
                      onSave={(y, v) => data.patchConfig({ rfrByYear: { ...(data.config.rfrByYear || {}), [String(y)]: v } })}
                      onSetParts={parts => data.setFiscalConfig(prev => ({ ...prev, lepHouseholdParts: parts }))} />}
                    securitySlot={<ServerSecurityPanel discreet={!!data.config.discreetNotifications} onToggleDiscreet={v => data.patchConfig({ discreetNotifications: v || undefined })} confirm={askConfirm}
                      onSignedOutEverywhere={() => { setIsAuthenticated(false); data.resetData(); addToast({ message: 'Tous les appareils sont déconnectés', kind: 'success' }); }} />}
                    motivationSlot={<MotivationSettings gamification={data.config.gamification} goodMonthThreshold={data.config.goodMonthThreshold} onChange={patch => data.patchConfig(patch)} />}
                    paydayDay={data.paydayDay}
                    onOpenPayday={() => setView('pilot')}
                    onSave={(newFiscal, newBenefits, newGeminiKey, newPickerKey) => {
                       data.setFiscalConfig(newFiscal);
                       data.setWorkBenefits(newBenefits);
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
              <AccountsView
                data={data}
                setView={setView}
                editingAccount={editingAccount}
                setEditingAccount={setEditingAccount}
                showForm={showForm}
                setShowForm={setShowForm}
                handleSaveAccount={handleSaveAccount}
                handleDeleteAccount={handleDeleteAccount}
                handleDeleteMovement={handleDeleteMovement}
                handleRenameMovement={handleRenameMovement}
                hasParental={hasParental}
              />
            )}
            </Suspense>
            </ErrorBoundary>
        </div>
      </main>

      {/* Bouton d'ajout rapide flottant, masqué là où une barre d'enregistrement occupe le bas de l'écran. */}
      {data.accounts.length > 0 && view !== 'update' && view !== 'transfers' && (
        <QuickAddFab scrollRef={mainRef} resetKey={view} onClick={() => setQuickAddOpen(true)} />
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
        hidden={showParentalScreen ? [] : ['parental']}
      />

      <ToastContainer toasts={toasts} onDismiss={dismiss} />

      {/* Une fois après chaque mise à jour : ce qui a changé. */}
      <WhatsNewModal isNewUser={data.accounts.length === 0} />
      <MovedNotice />

      <Dialog state={dialog} onClose={closeDialog} />
    </div>
    </ToastContext.Provider>
  );
}

export default App;
