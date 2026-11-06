// Écrans et fenêtres chargés à la demande (code-splitting : recharts et les écrans lourds ne
// sont pas dans le code de démarrage), et leur préchargement.
import React, { Suspense, useEffect } from 'react';
import { lazyWithRetry } from '../components/ErrorBoundary';
import { lsGet } from '../lib/storage';
import { encodePlace, isView, parsePlace, placeOf } from '../navigation';
import { LAST_VIEW_KEY } from '../hooks/portfolio/keys';

export const Journal = lazyWithRetry(() => import('../components/Journal').then(m => ({ default: m.Journal })));
export const Agenda = lazyWithRetry(() => import('../components/agendaQuickAdd').then(m => ({ default: m.Agenda })));
export const Donations = lazyWithRetry(() => import('../components/Donations').then(m => ({ default: m.Donations })));
export const Subscriptions = lazyWithRetry(() => import('../components/Subscriptions').then(m => ({ default: m.Subscriptions })));
export const Wishes = lazyWithRetry(() => import('../components/Wishes').then(m => ({ default: m.Wishes })));
export const Dashboard = lazyWithRetry(() => import('../components/Dashboard').then(m => ({ default: m.Dashboard })));
export const AccountUpdate = lazyWithRetry(() => import('../components/AccountUpdate').then(m => ({ default: m.AccountUpdate })));
export const AssistantPilot = lazyWithRetry(() => import('../components/AssistantPilot').then(m => ({ default: m.AssistantPilot })));
export const TransferManager = lazyWithRetry(() => import('../components/TransferManager').then(m => ({ default: m.TransferManager })));
export const Settings = lazyWithRetry(() => import('../components/Settings').then(m => ({ default: m.Settings })));
export const Yield = lazyWithRetry(() => import('../components/Yield').then(m => ({ default: m.Yield })));
export const History = lazyWithRetry(() => import('../components/History').then(m => ({ default: m.History })));
export const Simulator = lazyWithRetry(() => import('../components/Simulator').then(m => ({ default: m.Simulator })));
export const ParentalShare = lazyWithRetry(() => import('../components/ParentalShare').then(m => ({ default: m.ParentalShare })));
export const Payslips = lazyWithRetry(() => import('../components/Payslips').then(m => ({ default: m.Payslips })));
export const AccountsView = lazyWithRetry(() => import('../components/AccountsView').then(m => ({ default: m.AccountsView })));
export const FiscalCalendar = lazyWithRetry(() => import('../components/FiscalCalendar').then(m => ({ default: m.FiscalCalendar })));
// Écrans secondaires et fenêtres rarement ouvertes : hors du code de démarrage, chargés à
// leur premier affichage (chacun dans son propre <Suspense>, voir `Lazy` ci-dessous).
export const FiscalWatchCard = lazyWithRetry(() => import('../components/FiscalWatchCard').then(m => ({ default: m.FiscalWatchCard })));
export const DriveBackupsPanel = lazyWithRetry(() => import('../components/SettingsPanels').then(m => ({ default: m.DriveBackupsPanel })));
export const CloudBackupPanel = lazyWithRetry(() => import('../components/SettingsPanels').then(m => ({ default: m.CloudBackupPanel })));
export const ServerSecurityPanel = lazyWithRetry(() => import('../components/SettingsPanels').then(m => ({ default: m.ServerSecurityPanel })));
export const SetAsideVersionsPanel = lazyWithRetry(() => import('../components/sync/SetAsideVersionsPanel').then(m => ({ default: m.SetAsideVersionsPanel })));
export const TaxNoticePanel = lazyWithRetry(() => import('../components/TaxNoticePanel').then(m => ({ default: m.TaxNoticePanel })));
export const MotivationSettings = lazyWithRetry(() => import('../components/motivation/MotivationSettings').then(m => ({ default: m.MotivationSettings })));
export const TaxReturnHelper = lazyWithRetry(() => import('../components/TaxReturnHelper').then(m => ({ default: m.TaxReturnHelper })));
export const SoloPlanCard = lazyWithRetry(() => import('../components/SoloPlanCard').then(m => ({ default: m.SoloPlanCard })));
export const YearClosingCard = lazyWithRetry(() => import('../components/year/YearClosingCard').then(m => ({ default: m.YearClosingCard })));
// Rituel « Clôture de l'année » : depuis la tâche de l'Accueil (janvier-février) et la carte de l'Historique.
export const YearClosingSheet = lazyWithRetry(() => import('../components/year/YearClosingSheet').then(m => ({ default: m.YearClosingSheet })));
export const ConflictDialog = lazyWithRetry(() => import('../components/sync/ConflictDialog').then(m => ({ default: m.ConflictDialog })));
export const LogoutDialog = lazyWithRetry(() => import('../components/sync/LogoutDialog').then(m => ({ default: m.LogoutDialog })));
export const QuickAddModal = lazyWithRetry(() => import('../components/agendaQuickAdd').then(m => ({ default: m.QuickAddModal })));
// « J'ai besoin d'argent : où le prendre ? » : depuis le bouton « Mouvement » et Comptes › Mouvements.
export const NeedMoneySheet = lazyWithRetry(() => import('../components/need/NeedMoneySheet').then(m => ({ default: m.NeedMoneySheet })));
export const RateChangesSheet = lazyWithRetry(() => import('../components/rates/RateChangesSheet').then(m => ({ default: m.RateChangesSheet })));
export const StatementImport = lazyWithRetry(() => import('../components/StatementImport').then(m => ({ default: m.StatementImport })));
// « Partager vers Pécule » : seulement quand l'app est ouverte par un partage (`?partage=`).
export const ShareTargetHost = lazyWithRetry(() => import('../components/share/ShareTargetHost').then(m => ({ default: m.ShareTargetHost })));
// « Demander à Pécule » : l'entrée de l'Accueil, et la fenêtre ouverte depuis la navigation.
export const AskPeculeEntry = lazyWithRetry(() => import('../components/ask/AskPecule').then(m => ({ default: m.AskPeculeEntry })));
export const AskPeculeSheet = lazyWithRetry(() => import('../components/ask/AskPecule').then(m => ({ default: m.AskPecule })));
// Verrou de l'app : seulement sur les appareils où il est activé.
export const AppLockScreen = lazyWithRetry(() => import('../components/AppLockScreen').then(m => ({ default: m.AppLockScreen })));
export const WhatsNewModal = lazyWithRetry(() => import('../components/WhatsNew').then(m => ({ default: m.WhatsNewModal })));

/** Morceau chargé à part : rien ne s'affiche à sa place le temps de son chargement. */
export const Lazy = ({ children }: { children: React.ReactNode }) => <Suspense fallback={null}>{children}</Suspense>;

/** Squelette pendant le chargement d'un écran : la mise en page ne saute pas. */
export const ViewLoader = () => (
  <div className="space-y-4 animate-pulse" aria-busy="true" aria-label="Chargement">
    <div className="h-24 rounded-2xl bg-surface-container-high" />
    <div className="grid grid-cols-2 gap-4"><div className="h-28 rounded-2xl bg-surface-container-high" /><div className="h-28 rounded-2xl bg-surface-container-high" /></div>
    <div className="h-64 rounded-2xl bg-surface-container-high" />
  </div>
);

// Endroit affiché au démarrage (lien direct, sinon le dernier ouvert, sinon l'Accueil) : son
// écran est demandé dès que la session est connue, en même temps que le jeton et Drive plutôt
// qu'après. Clé : écran, ou « écran/onglet » (voir encodePlace).
const START_VIEW_LOADERS: Record<string, () => Promise<unknown>> = {
  dashboard: () => import('../components/Dashboard'),
  update: () => import('../components/AccountUpdate'),
  'accounts/balances': () => import('../components/AccountsView'),
  'accounts/movements': () => import('../components/Journal'),
  'accounts/parents': () => import('../components/ParentalShare'),
  'pilot/month': () => import('../components/AssistantPilot'),
  'pilot/subscriptions': () => import('../components/Subscriptions'),
  'pilot/payslips': () => import('../components/Payslips'),
  'pilot/wishes': () => import('../components/Wishes'),
  'analyses/evolution': () => import('../components/History'),
  'analyses/yield': () => import('../components/Yield'),
  'analyses/agenda': () => import('../components/agendaQuickAdd'),
  'analyses/simulator': () => import('../components/Simulator'),
  'taxes/donations': () => import('../components/Donations'),
  'taxes/calendar': () => import('../components/FiscalCalendar'),
  settings: () => import('../components/Settings'),
};
export const preloadStartView = () => {
  const params = new URLSearchParams(window.location.search);
  const linked = params.get('view');
  const linkedPlace = isView(linked) ? placeOf(linked, params.get('tab')) : null;
  const place = linkedPlace || parsePlace(lsGet(LAST_VIEW_KEY)) || { screen: 'dashboard' as const };
  (START_VIEW_LOADERS[encodePlace(place)] ?? START_VIEW_LOADERS.dashboard)().catch(() => undefined);
};

/**
 * Les écrans sont chargés à la demande : on précharge les plus utilisés une fois connecté,
 * pour éviter le petit temps de chargement à leur première ouverture.
 */
export const usePreloadScreens = (enabled: boolean) => {
  useEffect(() => {
    if (!enabled) return;
    const t = setTimeout(() => {
      // Préchargement facultatif : un échec (hors ligne) sera rejoué à l'ouverture de l'écran.
      for (const load of [() => import('../components/AccountUpdate'), () => import('../components/AssistantPilot'), () => import('../components/TransferManager'), () => import('../components/Yield')]) {
        load().catch(() => undefined);
      }
    }, 1500);
    return () => clearTimeout(t);
  }, [enabled]);
};
