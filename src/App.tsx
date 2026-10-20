// ================================================
// FILE: src/App.tsx
// ================================================
import React, { useState, useEffect, useMemo, useRef, useCallback, Suspense } from 'react';
import { SavingsAccount, PayslipRecord } from './types';
import { clearStoredDrafts } from './components/update/draft';
import { usePortfolioData } from './hooks/usePortfolioData';
import { useTheme } from './hooks/useTheme';
import { Dialog, DialogState, emptyDialog } from './components/Dialog';
import { useToasts, ToastContainer, ToastContext } from './components/Toast';
import { BottomNav } from './components/BottomNav';
import { AppLockScreen, LockResetNotice } from './components/AppLockScreen';
import { useAppLock, useLockResetCompletion } from './hooks/useAppLock';
import { lsDel, lsGet } from './lib/storage';
import {
  initGoogleApi, handleAuthClick, handleSignOut, resumeSession, hasStoredSession
} from './services/googleDriveService';
import { isBackendEnabled } from './services/backendService';
import { BootSkeleton } from './components/BootSkeleton';
import { APP_VERSION } from './appVersion';
import { whatsNewPending } from './components/whatsNewGate';
import { disablePush } from './services/pushService';
import { computeIncome, totalFixedCharges, computeMonthlySavingsCapacity, subscriptionsAsExpenses, computeMonthlyPay, REGULATED_RATE_GROUPS } from './lib/finance';
import { localTodayISO, parseISODate } from './lib/dates';
import { formatEUR } from './lib/format';
import { lepTimelineFromData } from './lib/lep';
import { computeMonthTarget } from './lib/payAdjustment';
// Importé ici (et pas dans l'écran, chargé à la demande) pour capter l'invitation d'installation dès le démarrage.
import './services/installPrompt';
import { computeBadgeCount, detectPayRaise } from './lib/projection';
import { isRestitutionMovement, type CancellingGroup } from './lib/accountOps';
import {
  type CommandError, type CommandOk, type CommandPatch, type CommandState,
  saveAccount, deleteAccount, quickAdd, planMovementDeletion, deleteMovement, cancelDeposit, removeCancellingMovements,
  recordRestitution, undoRestitution,
} from './lib/commands';
import { MovedNotice } from './components/MovedNotice';
import { Logo } from './components/Logo';
import { ErrorBoundary, lazyWithRetry } from './components/ErrorBoundary';
import { NAV_ITEMS, NAV_SECTIONS, View, isView, navLabel } from './navigation';
import { QuickAddFab } from './components/QuickAddFab';
import { useFiscalWatch } from './hooks/useFiscalWatch';
import type { FiscalProposal } from './lib/fiscalWatch';
import { syncErrorText } from './lib/syncErrors';
import { registerReloadBlocker } from './services/swUpdates';
import { computeEmergencyFund, DEFAULT_EMERGENCY_MONTHS } from './lib/planning';
import { buildAgenda } from './lib/agenda';
import { buildTaxReturnAlert } from './lib/taxReturn';
import { openSettingsSection } from './components/settings/sections';
import {
  LogOut,
  Loader2, Settings as SettingsIcon, AlertTriangle,
  Sun, Moon, WifiOff
} from 'lucide-react';
import { Button } from './components/ui';

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
const AccountsView = lazyWithRetry(() => import('./components/AccountsView').then(m => ({ default: m.AccountsView })));
// Écrans secondaires et fenêtres rarement ouvertes : hors du code de démarrage, chargés à
// leur premier affichage (chacun dans son propre <Suspense>, voir `Lazy` ci-dessous).
const FiscalWatchCard = lazyWithRetry(() => import('./components/FiscalWatchCard').then(m => ({ default: m.FiscalWatchCard })));
const DriveBackupsPanel = lazyWithRetry(() => import('./components/SettingsPanels').then(m => ({ default: m.DriveBackupsPanel })));
const CloudBackupPanel = lazyWithRetry(() => import('./components/SettingsPanels').then(m => ({ default: m.CloudBackupPanel })));
const ServerSecurityPanel = lazyWithRetry(() => import('./components/SettingsPanels').then(m => ({ default: m.ServerSecurityPanel })));
const SetAsideVersionsPanel = lazyWithRetry(() => import('./components/sync/SetAsideVersionsPanel').then(m => ({ default: m.SetAsideVersionsPanel })));
const TaxNoticePanel = lazyWithRetry(() => import('./components/TaxNoticePanel').then(m => ({ default: m.TaxNoticePanel })));
const MotivationSettings = lazyWithRetry(() => import('./components/motivation/MotivationSettings').then(m => ({ default: m.MotivationSettings })));
const TaxReturnHelper = lazyWithRetry(() => import('./components/TaxReturnHelper').then(m => ({ default: m.TaxReturnHelper })));
const SoloPlanCard = lazyWithRetry(() => import('./components/SoloPlanCard').then(m => ({ default: m.SoloPlanCard })));
const ConflictDialog = lazyWithRetry(() => import('./components/sync/ConflictDialog').then(m => ({ default: m.ConflictDialog })));
const LogoutDialog = lazyWithRetry(() => import('./components/sync/LogoutDialog').then(m => ({ default: m.LogoutDialog })));
const QuickAddModal = lazyWithRetry(() => import('./components/QuickAddModal').then(m => ({ default: m.QuickAddModal })));
const WhatsNewModal = lazyWithRetry(() => import('./components/WhatsNew').then(m => ({ default: m.WhatsNewModal })));
/** Morceau chargé à part : rien ne s'affiche à sa place le temps de son chargement. */
const Lazy = ({ children }: { children: React.ReactNode }) => <Suspense fallback={null}>{children}</Suspense>;

// Mode démo (`?demo=1`, données fictives, sans Google) : en développement, et dans le build de
// production des tests de bout en bout (__E2E_DEMO__, voir vite.config.ts). Jamais dans le
// build publié : la condition y vaut `false` et la branche est retirée du bundle.
const DEMO_ALLOWED: boolean = import.meta.env.DEV || __E2E_DEMO__;

// Écran affiché au démarrage (lien direct, sinon le dernier ouvert, sinon l'Accueil) : demandé
// dès que la session est connue, en même temps que le jeton et Drive plutôt qu'après.
const START_VIEW_LOADERS: Partial<Record<View, () => Promise<unknown>>> = {
  dashboard: () => import('./components/Dashboard'),
  update: () => import('./components/AccountUpdate'),
  pilot: () => import('./components/AssistantPilot'),
  transfers: () => import('./components/TransferManager'),
  accounts: () => import('./components/AccountsView'),
  journal: () => import('./components/Journal'),
  agenda: () => import('./components/Agenda'),
  yield: () => import('./components/Yield'),
  history: () => import('./components/History'),
  simulator: () => import('./components/Simulator'),
  settings: () => import('./components/Settings'),
};
const preloadStartView = () => {
  const linked = new URLSearchParams(window.location.search).get('view');
  const last = lsGet('last_view');
  const view = isView(linked) ? linked : isView(last) ? last : 'dashboard';
  (START_VIEW_LOADERS[view] ?? START_VIEW_LOADERS.dashboard)?.().catch(() => undefined);
};

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

const App: React.FC = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  // Bouton de connexion prêt : en mode serveur, tout de suite (redirection vers le Worker) ;
  // sans serveur, une fois Google Identity Services chargé (voir l'effet plus bas).
  const [isApiLoaded, setIsApiLoaded] = useState(() => isBackendEnabled());
  const [apiError, setApiError] = useState(false);
  // Session de l'appareil en cours de vérification au démarrage : l'écran de démarrage
  // s'affiche (plutôt que l'écran de connexion) si une session est enregistrée ou si l'on
  // revient de la connexion Google (code dans l'adresse).
  const [sessionPending, setSessionPending] = useState(() => hasStoredSession() || /[#&]login_code=/.test(window.location.hash));
  // « Quoi de neuf » (et tout l'historique) n'est chargé que s'il a quelque chose à montrer.
  const [showWhatsNew] = useState(whatsNewPending);
  // Verrou de l'appareil (biométrie et/ou PIN, propre à ce navigateur, jamais synchronisé) :
  // verrouillé à l'ouverture et à chaque passage en arrière-plan ; « Code oublié » ne le
  // retire qu'après une reconnexion Google et un chargement Drive réussi (voir useAppLock).
  const lock = useAppLock();
  const { locked, completeReset: completeLockReset } = lock;

  const data = usePortfolioData(isAuthenticated);
  // Mise à jour de l'app : jamais de rechargement tant que des saisies ne sont pas sur Drive.
  const { hasPendingEdits } = data;
  useEffect(() => registerReloadBlocker(hasPendingEdits), [hasPendingEdits]);
  const { isDark, toggleTheme } = useTheme();
  const { toasts, addToast, dismiss } = useToasts();

  const [view, setView] = useState<View>('dashboard');
  const [editingAccount, setEditingAccount] = useState<SavingsAccount | undefined>(undefined);
  const [showForm, setShowForm] = useState(false);
  const [dialog, setDialog] = useState<DialogState>(emptyDialog);
  // Choix entre deux versions (conflit entre appareils, fichier en double) et déconnexion
  // avec des modifications pas encore sur Drive.
  const [conflictDialogOpen, setConflictDialogOpen] = useState(false);
  const [logoutDialogOpen, setLogoutDialogOpen] = useState(false);
  const [moreNavOpen, setMoreNavOpen] = useState(false);
  const [quickAddOpen, setQuickAddOpen] = useState(false);

  // « Code oublié » : le verrou suspendu n'est retiré qu'à la fin d'un chargement Drive
  // réussi (reconnexion Google faite), quel que soit le chemin (connexion, reconnexion,
  // « Réessayer »). Jamais avant : la session de l'appareil avait été fermée. Règle testée
  // dans useAppLock.test.ts (shouldCompleteLockReset).
  const onLockResetCompleted = useCallback(() => {
    addToast({
      kind: 'info',
      message: 'Verrou retiré de cet appareil. Vous pouvez en définir un nouveau dans Paramètres.',
      action: { label: 'Paramètres', onClick: () => { openSettingsSection('lock'); setView('settings'); } },
    });
  }, [addToast]);
  useLockResetCompletion(
    { isLoading: data.isLoadingData, isAuthenticated, loadFailed: data.loadFailed },
    completeLockReset,
    onLockResetCompleted,
  );
  // Déverrouillage réussi : une demande de retrait du verrou en cours est annulée, et le
  // propriétaire l'apprend (elle a pu être faite par quelqu'un d'autre).
  const handleUnlock = () => {
    const cancelled = lock.unlock();
    if (!cancelled) return;
    const when = cancelled.requestedAt.toLocaleString('fr-FR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
    addToast({ kind: 'info', message: `Une demande de retrait du verrou, faite le ${when}, vient d'être annulée. Si ce n'était pas vous, gardez votre appareil avec vous.` });
  };

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
  const fiscalWatch = useFiscalWatch(data.geminiApiKey, data.fiscalConfig, data.accounts, isAuthenticated && data.dataShown && !data.isLoadingData && !locked);
  const applyFiscalProposal = (p: FiscalProposal) => {
    const next = p.apply({ fiscal: data.fiscalConfig, accounts: data.accounts });
    data.setFiscalConfig(next.fiscal);
    if (next.accounts !== data.accounts) data.setAccounts(next.accounts);
    addToast({ message: `${p.label} mis à jour`, kind: 'success' });
  };
  const fiscalWatchCard = (compact: boolean) => (
    <Lazy><FiscalWatchCard compact={compact} proposals={fiscalWatch.proposals} running={fiscalWatch.running} checkedAt={fiscalWatch.checkedAt}
      lastError={fiscalWatch.lastError} hasKey={fiscalWatch.hasKey} canRun={fiscalWatch.canRun} source={fiscalWatch.source} runningVia={fiscalWatch.runningVia}
      serverReport={fiscalWatch.serverReport} onApply={applyFiscalProposal} onDismiss={fiscalWatch.dismiss} onRun={fiscalWatch.run} /></Lazy>
  );
  // Depuis l'Accueil, le seul lien vers les Paramètres est « Importer mon avis » (LEP) :
  // il ouvre directement la carte de l'avis d'imposition.
  const navigateFromDashboard = (v: View) => {
    if (v === 'settings') openSettingsSection('tax-notice');
    setView(v);
  };
  // `confirmLabel` : dire ce que fait le bouton (« Remplacer par la copie d'août 2026 »)
  // plutôt qu'un « Confirmer » neutre, surtout pour une action qui remplace des données.
  const askConfirm = (title: string, message: string, onConfirm: () => void | Promise<void>, danger = false, confirmLabel = 'Confirmer') =>
    setDialog({ open: true, kind: 'confirm', title, message, danger, confirmLabel, onConfirm: () => { void onConfirm(); } });

  // Un conflit qui apparaît ouvre tout de suite l'écran de choix (la bannière permet de le rouvrir).
  useEffect(() => { if (data.syncConflict) setConflictDialogOpen(true); }, [data.syncConflict]);
  const hasConflictView = !!data.conflict;
  useEffect(() => { if (!hasConflictView) setConflictDialogOpen(false); }, [hasConflictView]);
  // Données rechargées en silence depuis un autre appareil : on le dit, sans interrompre.
  useEffect(() => {
    if (data.remoteUpdatedAt) addToast({ message: 'Données mises à jour depuis un autre appareil', kind: 'info' });
  }, [data.remoteUpdatedAt, addToast]);

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

  // Épargne prévue chaque mois (projections, alertes) : même montant que le rappel de paie.
  const { buildData, setLastView, loadDemoData, resetData, forgetOfflineCopy } = data;
  const monthPlan = useMemo(
    () => data.paydayAmount ?? computeMonthlySavingsCapacity(buildData()),
    [data.paydayAmount, buildData]
  );
  // Objectif de la paie en cours pour la jauge de l'Accueil : comme le Pilotage, il compte la
  // capacité et la somme en plus saisies pour cette paie (lib/payAdjustment).
  const monthGoal = useMemo(() => computeMonthTarget(buildData()).total, [buildData]);
  const monthlyPay = useMemo(() => computeMonthlyPay(buildData()), [buildData]);
  // Instantané complet des données (agenda, bilan annuel).
  const fullData = useMemo(() => buildData(), [buildData]);
  const agendaNext = useMemo(() => buildAgenda(fullData).events.slice(0, 3), [fullData]);
  const lepTimeline = useMemo(() => lepTimelineFromData(fullData), [fullData]);
  // Saison de la déclaration de revenus (avril à début juin) : rappel dans « À faire ».
  const taxReturnAlert = useMemo(() => buildTaxReturnAlert(fullData), [fullData]);
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
    if (!isAuthenticated || data.isLoadingData || !data.dataShown) return;
    const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
    const n = computeBadgeCount(fullData);
    (n > 0 ? nav.setAppBadge?.(n) : nav.clearAppBadge?.())?.catch(() => { /* non pris en charge */ });
  }, [fullData, isAuthenticated, data.isLoadingData, data.dataShown]);

  // Sauvegarde de secours chiffrée (serveur) : au plus une fois par semaine, si les données
  // ont changé. Attend 30 s de calme après le chargement ou la dernière modification, ne
  // bloque jamais l'écran, et ne part jamais d'un état douteux (erreur, conflit, copie locale,
  // copie hors ligne : seulement des données chargées de Drive). Code chargé à ce moment-là.
  const cloudBackupReady = isAuthenticated && !locked && data.dataShown && !data.offlineDataAt && !data.loadFailed && !data.isLoadingData
    && !data.syncError && !data.syncConflict && !data.sessionExpired && !data.appOutdated && !data.localBackup;
  useEffect(() => {
    if (!cloudBackupReady || !isBackendEnabled()) return;
    const t = setTimeout(() => {
      import('./services/cloudBackup').then(m => m.maybeAutoUpload(fullData)).catch(() => undefined);
    }, 30_000);
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
    const target = params.get('view');
    // Écran inconnu de cette version (lien d'une version plus récente, encore en cours de
    // mise à jour) : on laisse le lien dans l'adresse pour que la nouvelle version, chargée
    // juste après, l'ouvre.
    if (isView(target)) {
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
      const target: unknown = e.data && e.data.type === 'open-view' ? e.data.view : null;
      if (!isView(target)) return;
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
    if (!isView(last) || deepLinkedRef.current) return;
    setView(v => (v === 'dashboard' ? last : v));
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

  // Démarrage — une seule fois par chargement de page : en développement, React (StrictMode)
  // rejoue les effets de montage, ce qui lançait deux démarrages concurrents (deux
  // rafraîchissements, deux consommations du code de connexion...).
  // Aucun SDK Google n'est attendu : en mode serveur, la session est vérifiée tout de suite, et
  // l'écran de démarrage est demandé en même temps. Hors ligne, la session est gardée et l'app
  // s'ouvre sur la dernière copie connue de vos données (voir usePortfolioData).
  // Les données ne sont chargées qu'une fois l'appareil déverrouillé : tant que le verrou
  // est affiché, rien de financier n'est lu ni gardé en mémoire.
  const [loadRequested, setLoadRequested] = useState(false);
  // Le jeton n'a pas pu être obtenu faute de réseau : la copie hors ligne s'ouvre sans
  // retenter tout de suite (un nouvel essai est programmé).
  const bootOfflineRef = useRef(false);
  useEffect(() => {
    if (!loadRequested || locked) return;
    setLoadRequested(false);
    const startOffline = bootOfflineRef.current;
    bootOfflineRef.current = false;
    void data.loadDriveData(startOffline ? { startOffline } : undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadRequested, locked]);

  const initStartedRef = useRef(false);
  useEffect(() => {
    if (initStartedRef.current) return;
    initStartedRef.current = true;
    // Mode démo : données fictives, sans Google (voir DEMO_ALLOWED).
    if (DEMO_ALLOWED && new URLSearchParams(window.location.search).has('demo')) {
      import('./dev/demoData').then(({ DEMO_DATA }) => { setIsApiLoaded(true); setIsAuthenticated(true); setSessionPending(false); loadDemoData(DEMO_DATA); }).catch(console.error);
      return;
    }
    if (hasStoredSession()) preloadStartView();
    // Retour d'une connexion (peut-être avec un autre compte Google) : la copie hors ligne de
    // la session précédente est oubliée avant tout chargement.
    resumeSession({ onNewLogin: forgetOfflineCopy })
      .then(status => {
        // Session absente ou refusée : rien de l'ancienne session ne reste sur l'appareil (copie
        // hors ligne comprise), pour qu'un autre compte ne la voie jamais.
        if (status === 'signed-out') { resetData(); return; }
        bootOfflineRef.current = status === 'offline';
        setIsAuthenticated(true);
        setLoadRequested(true);
      })
      .catch(e => {
        if (e instanceof TypeError) {
          // Serveur injoignable au retour de la connexion : l'utilisateur pourra réessayer.
          addToast({ message: 'Serveur injoignable — vérifiez votre connexion puis rechargez.', kind: 'error' });
        } else {
          console.log('Session serveur invalide, reconnexion requise.', e);
        }
      })
      .finally(() => setSessionPending(false));
  }, [addToast, loadDemoData, resetData, forgetOfflineCopy]);

  // Sans serveur, le bouton de connexion a besoin de Google Identity Services : chargé
  // seulement quand l'écran de connexion s'affiche. Un échec (hors ligne, bloqueur de
  // scripts) s'affiche tout de suite au lieu d'une longue attente.
  const showLoginScreen = !isAuthenticated && !sessionPending;
  useEffect(() => {
    if (!showLoginScreen || isBackendEnabled()) return;
    if (DEMO_ALLOWED && new URLSearchParams(window.location.search).has('demo')) return;
    initGoogleApi()
      .then(() => { setApiError(false); setIsApiLoaded(true); })
      .catch(err => { console.error('Google Identity Services indisponible', err); setApiError(true); });
  }, [showLoginScreen]);
  // Sans serveur, « Se reconnecter » ouvre la fenêtre Google : GIS est chargé dès que la
  // session expire, pour que la fenêtre s'ouvre au clic sans être bloquée.
  useEffect(() => {
    if (data.sessionExpired && !isBackendEnabled()) initGoogleApi().catch(() => undefined);
  }, [data.sessionExpired]);

  const handleLogin = async () => {
    try {
      // Nouvelle connexion, peut-être avec un autre compte Google : la copie hors ligne de la
      // session précédente ne doit jamais s'afficher sous ce compte.
      data.forgetOfflineCopy();
      // Réinitialisation du verrou en attente : choix du compte et accord toujours demandés.
      await handleAuthClick(false, { chooseAccount: lock.resetPending });
      setIsAuthenticated(true);
      void data.loadDriveData();
    } catch (error) {
      addToast({ message: 'Échec de la connexion à Google Drive.', kind: 'error' });
    }
  };

  const handleReconnect = async () => {
    try {
      // Même chose : la reconnexion peut se faire avec un autre compte (elle sera réécrite au
      // prochain chargement réussi).
      data.forgetOfflineCopy();
      await handleAuthClick(false, { chooseAccount: lock.resetPending });
      // Chargement normal, pas « recharger l'autre version » : des modifications faites
      // pendant l'expiration de la session restent proposées (copie locale), et un conflit
      // en cours n'est jamais tranché à la place de l'utilisateur.
      void data.loadDriveData();
    } catch (e) {
      addToast({ message: 'Reconnexion échouée.', kind: 'error' });
    }
  };

  const handleLogout = async (opts?: { discardUnsynced?: boolean }) => {
    // Un appareil déconnecté ne doit plus recevoir de notifications (qui contiennent des
    // montants) : désabonnement AVANT de fermer la session, tant qu'elle est valide.
    if (isBackendEnabled()) await disablePush().catch(() => undefined);
    await handleSignOut();
    setIsAuthenticated(false);
    // Sauf « Se déconnecter sans envoyer », les modifications pas encore sur Drive restent en
    // copie locale chiffrée, proposée à la prochaine connexion (voir resetData).
    data.resetData({ discardUnsynced: opts?.discardUnsynced === true });
    clearStoredDrafts(); // brouillons d'« Actualiser » de cet onglet
  };

  /**
   * Déconnexion demandée par l'utilisateur : si quelque chose n'est pas encore sur Drive, deux
   * choix clairs (envoyer d'abord, ou se déconnecter sans envoyer) ou annuler, sur ordinateur
   * comme sur mobile. `alwaysConfirm` : le bouton du mobile, plus facile à toucher par
   * erreur, demande toujours confirmation.
   */
  const requestLogout = (alwaysConfirm: boolean) => {
    if (data.hasUnsyncedChanges()) {
      setLogoutDialogOpen(true);
    } else if (alwaysConfirm) {
      setDialog({ open: true, kind: 'confirm', title: 'Se déconnecter ?', message: 'Les données restent sur votre Drive ; il faudra vous reconnecter avec Google.', confirmLabel: 'Se déconnecter', onConfirm: () => { void handleLogout(); } });
    } else {
      void handleLogout();
    }
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
  const undoAction = (r: CommandOk, label = 'Annuler') => ({ label, onClick: () => commit(r.undo(commandStateRef.current)) });
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

  // Annulation depuis l'écran (après coup, confirmée dans RestitutionPanel) : les mouvements
  // de restitution sont retirés, ce qui rend leur part aux parents. « Rétablir » rejoue la
  // restitution à l'identique (même date, même relevé).
  const handleUndoRestitution = () => {
    const r = undoRestitution(commandStateRef.current);
    if (!r.ok) return;
    commit(r.next);
    addToast({ message: r.message, kind: 'success', action: undoAction(r, 'Rétablir') });
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
    return <AppLockScreen onUnlock={handleUnlock} hasUnsyncedChanges={data.hasUnsyncedChanges()}
      resetRequest={lock.resetRequest} onRequestReset={lock.requestReset} onCancelRequest={lock.cancelResetRequest}
      onForgot={({ discardUnsynced }) => lock.forgetCode(async () => {
        // Les modifications pas encore sur Drive restent en copie chiffrée, sauf choix contraire.
        await handleLogout({ discardUnsynced });
        // Ce que l'appareil garde hors de Drive : clé Gemini, dernier enregistrement, dernière vue.
        data.setGeminiApiKey('');
        ['suivi_epargne_last_save', 'last_view'].forEach(lsDel);
      })} />;
  }

  // Session enregistrée en cours de vérification : la structure de l'app tout de suite.
  if (!isAuthenticated && sessionPending) return <BootSkeleton message="Ouverture de votre session…" />;

  if (!isAuthenticated) {
    return (
      <main className="min-h-screen bg-sapin flex flex-col items-center justify-center p-4">
        <div className="bg-surface-container-low text-on-surface p-8 rounded-3xl shadow-xl max-w-md w-full text-center">
          <Logo className="w-16 h-16 mx-auto mb-6 shadow-lg" />
          <h1 className="text-[32px] leading-10 font-bold text-on-surface mb-1">Pécule</h1>
          <p className="text-sm font-bold text-indigo-700 dark:text-indigo-300 mb-4">Faites pousser votre épargne</p>
          <p className="text-slate-500 dark:text-slate-400 mb-8">Vos données sont stockées en sécurité sur votre Google Drive personnel.</p>
          {lock.resetPending && <LockResetNotice onCancel={lock.cancelReset} />}
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
        <p className="mt-2 text-[11px] font-bold text-emerald-100/70">version {APP_VERSION}</p>
      </main>
    );
  }

  // Données pas encore là (ou rechargées depuis Drive) : la structure de l'app avec des cartes
  // en attente. La copie hors ligne, elle, reste affichée pendant qu'on rejoint Drive.
  if ((data.isLoadingData && !data.offlineDataAt) || (!data.dataShown && !data.loadFailed)) return <BootSkeleton />;

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
            <button onClick={() => requestLogout(false)} className="w-full h-12 flex items-center gap-3 px-4 text-error hover:bg-error/8 rounded-full font-medium text-sm transition-colors"><LogOut className="w-5 h-5" aria-hidden="true" /> Déconnexion</button>
            <button onClick={() => { openSettingsSection('about'); setView('settings'); }} className="w-full mt-1 px-4 text-left text-[11px] font-medium text-on-surface-variant hover:text-on-surface" title="Historique des mises à jour dans Paramètres">Pécule · version {APP_VERSION}{typeof __BUILD_SHA__ !== "undefined" && __BUILD_SHA__ !== "dev" ? ` · ${__BUILD_SHA__}` : ""}</button>
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
          <button onClick={() => requestLogout(true)} className="p-2.5 -m-1 rounded-full text-error hover:bg-error/8" aria-label="Se déconnecter"><LogOut className="w-4 h-4" /></button>
        </div>
      </header>

      <main ref={mainRef} id="contenu" tabIndex={-1} className="outline-none flex-1 bg-surface p-4 md:p-8 overflow-y-auto relative h-dvh pb-40 md:pb-24">

        <div className="max-w-7xl mx-auto pb-20">
            {/* --- BANNIÈRES DE SYNCHRONISATION --- */}
            {data.offlineDataAt ? (
              // Démarrage hors ligne : dernière copie connue, saisies gardées sur l'appareil.
              <div role="status" className="mb-4 bg-surface-container-high text-on-surface rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <p className="flex items-start gap-2 text-sm">
                  <WifiOff className="w-5 h-5 shrink-0 text-on-surface-variant" aria-hidden="true" />
                  <span>
                    <strong className="font-bold">Hors ligne : données du {new Date(data.offlineDataAt).toLocaleString('fr-FR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}</strong>, la dernière fois que Pécule a pu joindre Drive.
                    {' '}Vos modifications restent sur cet appareil et partiront sur Drive au retour du réseau.
                  </span>
                </p>
                <Button variant="tonal" className="shrink-0" isLoading={data.isLoadingData} onClick={data.retrySync}>{data.isLoadingData ? 'Connexion à Drive…' : 'Réessayer'}</Button>
              </div>
            ) : data.isOffline && (
              <div role="status" className="mb-4 inline-flex flex-wrap items-center gap-2 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl px-3 py-1.5 text-xs font-bold text-slate-700 dark:text-slate-200">
                <WifiOff className="w-4 h-4 shrink-0" aria-hidden="true" /> {data.dataShown
                  ? 'Hors ligne ou Drive injoignable : vos modifications restent sur cet appareil et partiront sur Drive dès que possible.'
                  : 'Hors ligne : vos données s\'afficheront dès que Drive sera joignable.'}
                <button onClick={data.retrySync} className="underline underline-offset-2 hover:text-slate-900 dark:hover:text-white">Réessayer</button>
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
              <div role="alert" className="mb-4 bg-tertiary-container text-on-tertiary-container rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm font-medium"><AlertTriangle className="w-5 h-5 shrink-0" aria-hidden="true"/> Vos données ont changé ici et sur un autre appareil. Rien n'est enregistré tant que vous n'avez pas choisi la version à garder.</div>
                <Button variant="filled" className="shrink-0" onClick={() => setConflictDialogOpen(true)}>Comparer et choisir</Button>
              </div>
            )}
            {data.duplicateFile && !data.syncConflict && (
              <div role="status" className="mb-4 bg-surface-container text-on-surface rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm"><AlertTriangle className="w-5 h-5 shrink-0 text-on-surface-variant" aria-hidden="true"/> Un autre fichier de données Pécule existe sur votre Drive{data.duplicateFile.modifiedTime ? ` (modifié le ${new Date(data.duplicateFile.modifiedTime).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })})` : ''}. Pécule a ouvert le plus récent.</div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button variant="text" onClick={data.dismissDuplicate}>Ignorer</Button>
                  <Button variant="tonal" onClick={() => { data.compareDuplicate(); setConflictDialogOpen(true); }}>Comparer</Button>
                </div>
              </div>
            )}
            {data.syncError && !data.sessionExpired && !data.syncConflict && !data.isOffline && (
              <div role="alert" className="mb-4 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-xl p-3 text-rose-700 dark:text-rose-300 text-sm font-bold flex items-center justify-between gap-3">
                <span className="flex items-center gap-2"><AlertTriangle className="w-4 h-4 shrink-0"/> {syncErrorText(data.loadFailed ? 'load' : 'save', data.syncErrorInfo?.reason)}</span>
                {/* Recharge si le chargement a échoué, sinon réécrit avec contrôle de révision :
                    jamais d'écriture forcée ici. */}
                <button onClick={data.retrySync} className="bg-rose-600 hover:bg-rose-700 text-white px-3 py-1.5 rounded-lg font-bold text-xs shrink-0">Réessayer</button>
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
            {view === 'dashboard' && <Dashboard accounts={data.accounts} history={data.history} expenses={allCharges} fiscalConfig={data.fiscalConfig} workBenefits={data.workBenefits} onDeleteAccount={handleDeleteAccount} config={dashboardConfig} monthPlan={monthPlan} monthGoal={monthGoal} monthlyPay={monthlyPay} paydayDay={data.paydayDay} trackingStartDate={data.trackingStartDate} payRaise={payRaise && !payRaiseHandled ? { delta: payRaise.delta, period: payRaise.latest.extracted.period || '', hasFixedAmount: data.paydayAmount !== undefined } : null} onAcceptPayRaise={acceptPayRaise} onDismissPayRaise={dismissPayRaise} subscriptions={data.subscriptions} onUpdateFiscalConfig={data.setFiscalConfig} onUpdateAccounts={data.setAccounts} onOpenSettings={() => { openSettingsSection('fiscal'); setView('settings'); }} recurringMovements={data.recurringMovements} onRecordRecurring={(r, date) => handleQuickAdd(r.accountId, r.amount, r.type, r.label, date)} onNavigate={navigateFromDashboard} onAddAccount={() => { setView('accounts'); setEditingAccount(undefined); setShowForm(true); }} lastExportAt={data.config.lastExportAt} onExport={() => { data.exportData(); data.patchConfig({ lastExportAt: localTodayISO() }); }} emergency={emergency} onSetEmergencyMonths={m => data.patchConfig({ emergencyMonths: m })} agendaNext={agendaNext} lepTimeline={lepTimeline} taxReturnAlert={taxReturnAlert}
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
                payAdjustment={data.config.payAdjustment}
                onPayAdjustmentChange={next => data.patchConfig({ payAdjustment: next })}
            />}

            {view === 'transfers' && <TransferManager accounts={data.accounts} onUpdateAccountsComplex={data.updateAccountsWithMovements} onCommit={commit} onLinkedTransfer={data.executeLinkedTransfer} lastSavedAt={data.lastSavedAt} recurringMovements={data.recurringMovements} onUpdateRecurring={data.setRecurringMovements} />}
            {view === 'update' && <AccountUpdate accounts={data.accounts} onUpdateAccountsComplex={data.updateAccountsWithMovements} onCommit={commit} lastSavedAt={data.lastSavedAt} onAddAccount={() => { setView('accounts'); setEditingAccount(undefined); setShowForm(true); }} />}

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
            {view === 'agenda' && <Agenda data={fullData} onOpen={(v) => { if (!isView(v)) return; if (v === 'settings') openSettingsSection('fiscal'); setView(v); }} />}
            {view === 'parental' && <ParentalShare
                accounts={data.accounts}
                restitution={data.parentalRestitution}
                monthPlan={monthPlan}
                hasCustomSplit={!!data.savingsSplit?.length}
                onPlanRestitution={(date) => data.setParentalRestitution(prev => ({ ...prev, plannedDate: date }))}
                onRestitute={handleRestitution}
                onUndoRestitution={handleUndoRestitution}
                soloPlanSlot={data.parentalRestitution?.plannedDate && !data.parentalRestitution.done
                  ? <Lazy><SoloPlanCard accounts={data.accounts} fiscalConfig={data.fiscalConfig} monthPlan={monthPlan} restitutionISO={data.parentalRestitution.plannedDate} split={data.savingsSplit} emergencyTarget={emergency?.target} /></Lazy>
                  : undefined}
            />}
            {view === 'donations' && <Donations donations={data.donations} onUpdate={data.setDonations} pickerApiKey={data.pickerApiKey} taxEstimate={taxEstimate} ceiling75={data.fiscalConfig.donation75Ceiling} taxHelper={<Lazy><TaxReturnHelper data={fullData} estimatedNetTaxableBeforeAllowance={taxEstimate?.beforeAllowance} allowanceRate={data.fiscalConfig.standardAllowance} allowanceCap={data.fiscalConfig.standardAllowanceCap} ceiling75={data.fiscalConfig.donation75Ceiling} /></Lazy>} />}
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
                    onUndoImport={data.recoverSetAside}
                    backupSlot={<Lazy>
                      <DriveBackupsPanel list={data.listDriveBackups} restore={data.restoreDriveBackup} undo={data.recoverSetAside} confirm={(t, m, ok, label) => askConfirm(t, m, ok, true, label)} />
                      <CloudBackupPanel getData={data.buildData} onImport={data.importData} undo={data.recoverSetAside} confirm={askConfirm} />
                      <SetAsideVersionsPanel list={data.listSetAsideVersions} recover={data.recoverSetAside} confirm={askConfirm} />
                    </Lazy>}
                    fiscalWatchSlot={fiscalWatchCard(false)}
                    taxNoticeSlot={<Lazy><TaxNoticePanel geminiApiKey={data.geminiApiKey} rfrByYear={data.config.rfrByYear || {}} householdParts={data.fiscalConfig.lepHouseholdParts}
                      onSave={(y, v) => data.patchConfig({ rfrByYear: { ...(data.config.rfrByYear || {}), [String(y)]: v } })}
                      onSetParts={parts => data.setFiscalConfig(prev => ({ ...prev, lepHouseholdParts: parts }))} /></Lazy>}
                    securitySlot={<Lazy><ServerSecurityPanel discreet={!!data.config.discreetNotifications} onToggleDiscreet={v => data.patchConfig({ discreetNotifications: v || undefined })} confirm={askConfirm}
                      onSignedOutEverywhere={() => { setIsAuthenticated(false); data.resetData(); addToast({ message: 'Tous les appareils sont déconnectés', kind: 'success' }); }} /></Lazy>}
                    motivationSlot={<Lazy><MotivationSettings gamification={data.config.gamification} goodMonthThreshold={data.config.goodMonthThreshold} onChange={patch => data.patchConfig(patch)} /></Lazy>}
                    paydayDay={data.paydayDay}
                    onOpenPayday={() => setView('pilot')}
                    // Champ par champ, à partir de l'état le plus récent : une saisie ne
                    // défait jamais ce qui a changé entre-temps (veille fiscale, avis, import).
                    onUpdateFiscal={update => data.setFiscalConfig(update)}
                    onUpdateBenefits={data.updateWorkBenefits}
                    onSaveGeminiKey={data.setGeminiApiKey}
                    onSavePickerKey={key => data.setPickerApiKey(key)}
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

      {quickAddOpen && (
        <Lazy>
          <QuickAddModal
            open={quickAddOpen}
            accounts={data.accounts}
            onClose={() => setQuickAddOpen(false)}
            onSubmit={handleQuickAdd}
          />
        </Lazy>
      )}

      <BottomNav
        view={view}
        setView={setView}
        moreOpen={moreNavOpen}
        setMoreOpen={setMoreNavOpen}
        hidden={showParentalScreen ? [] : ['parental']}
      />

      <ToastContainer toasts={toasts} onDismiss={dismiss} />

      {/* Une fois après chaque mise à jour : ce qui a changé. */}
      {showWhatsNew && <Lazy><WhatsNewModal isNewUser={data.accounts.length === 0} /></Lazy>}
      <MovedNotice />

      <Dialog state={dialog} onClose={closeDialog} />
      {data.conflict && (
        <Lazy><ConflictDialog
          open={conflictDialogOpen}
          conflict={data.conflict}
          onClose={() => { setConflictDialogOpen(false); data.closeDuplicateComparison(); }}
          onResolve={data.resolveConflict}
          onRetry={data.retryConflictLoad}
          onResolved={(choice, kind) => {
            setConflictDialogOpen(false);
            addToast({
              kind: 'success',
              message: kind === 'duplicate'
                ? (choice === 'local' ? 'Fichier ouvert gardé.' : 'Contenu de l\'autre fichier repris. L\'ancien est mis de côté 30 jours (Paramètres, Sauvegardes).')
                : `${choice === 'local' ? 'Version de cet appareil gardée' : 'Version de Drive gardée'}. L'autre est mise de côté 30 jours (Paramètres, Sauvegardes).`,
            });
          }}
        /></Lazy>
      )}
      {logoutDialogOpen && <Lazy><LogoutDialog
        open={logoutDialogOpen}
        onClose={() => setLogoutDialogOpen(false)}
        canSend={!data.isOffline && !data.syncConflict && !data.sessionExpired && !data.appOutdated && !data.loadFailed && !data.localBackup}
        cannotSendReason={data.localBackup ? 'Une sauvegarde locale attend votre choix (bandeau en haut de l\'écran) : touchez « Annuler », puis restaurez-la ou ignorez-la avant d\'envoyer.'
          : data.syncConflict ? 'Un choix entre deux versions est en attente : réglez-le d\'abord pour pouvoir envoyer.'
          : data.sessionExpired ? 'Votre session Google a expiré : reconnectez-vous pour pouvoir envoyer.'
          : data.appOutdated ? 'Cette version de Pécule est trop ancienne pour enregistrer sur Drive : mettez-la à jour.'
          : data.loadFailed && !data.isOffline ? 'Vos données n\'ont pas pu être chargées depuis Drive : rien ne peut être envoyé pour l\'instant.'
          : 'Vous êtes hors ligne ou Drive est injoignable pour le moment.'}
        onSend={data.flushPendingChanges}
        onLogout={async discard => { setLogoutDialogOpen(false); await handleLogout({ discardUnsynced: discard }); }}
      /></Lazy>}
    </div>
    </ToastContext.Provider>
  );
}

export default App;
