// ================================================
// FILE: src/App.tsx
// ================================================
// Assemblage de l'app. Chaque morceau vit dans src/app :
//  - UiProviders : toasts et fenêtre de confirmation (état à part, hors d'App) ;
//  - useAuthSession : démarrage, connexion, déconnexion ; useLockFlow : verrou de l'appareil ;
//  - useAppNavigation : écran courant, liens directs, focus ;
//  - SyncBanners, SyncStatus, SyncDialogs : tout ce qui montre la synchronisation ;
//  - ScreenRouter (mémoïsé) : l'écran courant, qui n'est re-rendu que si ses données changent ;
//  - useAccountActions, useDerivedData : actions sur les données et valeurs calculées.
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePortfolioData } from './hooks/usePortfolioData';
import { useTheme } from './hooks/useTheme';
import { useAppLock } from './hooks/useAppLock';
import { useFiscalWatch } from './hooks/useFiscalWatch';
import { LastSavedAtContext } from './hooks/useSaveFeedback';
import { BootSkeleton } from './components/BootSkeleton';
import { BottomNav } from './components/BottomNav';
import { MovedNotice } from './components/MovedNotice';
import { BackupDeletionNotice } from './components/BackupDeletionNotice';
import { QuickAddFab, QuickAddNavButton, showQuickAddFab } from './components/QuickAddFab';
import { AskNavButton } from './components/AskNavButton';
import { whatsNewPending } from './components/whatsNewGate';
import { registerReloadBlocker } from './services/swUpdates';
import { isSettledOnDrive, syncPhase } from './lib/sync/syncStatus';
// Importé ici (et pas dans l'écran, chargé à la demande) pour capter l'invitation d'installation dès le démarrage.
import './services/installPrompt';
import { UiProviders, useAddToast, useDialog, useMainUiShown } from './app/UiProviders';
import { useAuthSession } from './app/useAuthSession';
import { useLockFlow } from './app/useLockFlow';
import { useDeepLinks, useViewFocus, useViewState } from './app/useAppNavigation';
import { useDerivedData } from './app/useDerivedData';
import { useAccountActions } from './app/useAccountActions';
import { useAppBadge, useCloudBackup } from './app/useBackgroundTasks';
import { AppLockScreen, AskPeculeSheet, Lazy, QuickAddModal, WhatsNewModal, usePreloadScreens } from './app/screens';
import { openSettingsSection } from './components/settings/sections';
import { ScreenRouter, useAccountForm, useScreenData } from './app/ScreenRouter';
import { SyncBanners, useSyncToasts } from './app/SyncBanners';
import { SyncDialogsHost, useSyncDialogs } from './app/SyncDialogs';
import { LoginScreen } from './app/LoginScreen';
import { AppShell } from './app/AppShell';
import type { View } from './navigation';

// Barre du bas (mobile) mémoïsée : re-rendue seulement au changement d'écran ou du menu « Plus ».
const StableBottomNav = memo(BottomNav);

const AppRoot: React.FC = () => {
  const addToast = useAddToast();
  const dialog = useDialog();
  // Verrou de l'appareil : verrouillé à l'ouverture et à chaque passage en arrière-plan ;
  // « Code oublié » ne le retire qu'après une reconnexion Google et un chargement Drive réussi.
  const lock = useAppLock();
  const { locked } = lock;
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const data = usePortfolioData(isAuthenticated);
  // Mise à jour de l'app : jamais de rechargement tant que des saisies ne sont pas sur Drive.
  const { hasPendingEdits, buildData } = data;
  useEffect(() => registerReloadBlocker(hasPendingEdits), [hasPendingEdits]);
  const { isDark, toggleTheme } = useTheme();
  // « Quoi de neuf » (et tout l'historique) n'est chargé que s'il a quelque chose à montrer.
  const [showWhatsNew] = useState(whatsNewPending);
  // « Partager vers Pécule » : l'app a été ouverte par un partage (`?partage=`, laissé par
  // public/share-sw.js). La fenêtre de choix (ScreenRouter, chargée à la demande) ne prend le
  // fichier qu'une fois l'app déverrouillée et les données chargées.
  const [shareMarker, setShareMarker] = useState(() => new URLSearchParams(window.location.search).get('partage'));
  const endShare = useCallback(() => setShareMarker(null), []);
  const [moreNavOpen, setMoreNavOpen] = useState(false);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const openQuickAdd = useCallback(() => setQuickAddOpen(true), []);
  const closeQuickAdd = useCallback(() => setQuickAddOpen(false), []);
  // « Demander à Pécule » depuis la navigation : la fenêtre (et sa conversation) est retirée au
  // verrouillage et à la déconnexion, et ne se rouvre pas d'elle-même ensuite.
  const [askOpen, setAskOpen] = useState(false);
  if (askOpen && (locked || !isAuthenticated)) setAskOpen(false);
  const openAsk = useCallback(() => setAskOpen(true), []);
  const closeAsk = useCallback(() => setAskOpen(false), []);

  const syncDialogs = useSyncDialogs(data.syncConflict, !!data.conflict);
  const auth = useAuthSession({ isAuthenticated, setIsAuthenticated, data, lock, addToast, dialog, openLogoutDialog: syncDialogs.openLogout });
  const { view, setView, openLinkedView } = useViewState(data.lastView, data.setLastView);
  const lockFlow = useLockFlow({
    lock, load: { isLoading: data.isLoadingData, isAuthenticated, loadFailed: data.loadFailed },
    addToast, setView, logout: auth.logout,
  });
  useDeepLinks(isAuthenticated && !locked, openLinkedView, openQuickAdd);
  const mainRef = useRef<HTMLElement>(null);
  useViewFocus(view, isAuthenticated, mainRef);
  usePreloadScreens(isAuthenticated);
  useSyncToasts(data.lastSavedAt, data.remoteUpdatedAt, addToast);

  // Instantané complet des données (agenda, bilan annuel, projections) : recalculé seulement
  // quand le document change, jamais pour un changement de l'état de synchronisation.
  const fullData = useMemo(() => buildData(), [buildData]);
  const derived = useDerivedData(data.doc, fullData);
  const screenData = useScreenData(data);
  const actions = useAccountActions(data.doc, data, addToast, dialog);
  const accountForm = useAccountForm();
  // Veille fiscale hebdomadaire (serveur + Workers AI, sinon Gemini) : propositions à valider.
  const fiscalWatch = useFiscalWatch(data.geminiApiKey, data.fiscalConfig, data.accounts, isAuthenticated && data.dataShown && !data.isLoadingData && !locked);
  useAppBadge(fullData, isAuthenticated && !data.isLoadingData && data.dataShown);
  useCloudBackup(fullData, isAuthenticated && !locked && isSettledOnDrive(data.syncStatus, {
    dataShown: data.dataShown, offlineCopyShown: !!data.offlineDataAt, conflictOpen: data.syncConflict, hasLocalBackup: !!data.localBackup,
  }));

  // Données pas encore là (ou rechargées depuis Drive) : la structure de l'app avec des cartes
  // en attente. La copie hors ligne, elle, reste affichée pendant qu'on rejoint Drive.
  const booting = (data.isLoadingData && !data.offlineDataAt) || (!data.dataShown && !data.loadFailed);
  const hiddenScreens = useMemo<View[]>(() => (derived.showParentalScreen ? [] : ['parental']), [derived.showParentalScreen]);
  // Toasts et confirmations seulement par-dessus l'app ouverte (jamais sur le verrou).
  useMainUiShown(!locked && isAuthenticated && !booting);

  // Verrou en tout premier : avant même de décider s'il faut afficher l'écran de connexion ou
  // les données, pour ne jamais laisser filtrer d'information (y compris le simple fait qu'une
  // session Google est déjà active) tant que ce n'est pas déverrouillé.
  if (locked) {
    // Pendant le chargement du verrou : une surface vide, rien des données ni de la session.
    return (
      <React.Suspense fallback={<div className="min-h-screen bg-surface" aria-busy="true" />}>
        <AppLockScreen onUnlock={lockFlow.unlock} hasUnsyncedChanges={data.hasUnsyncedChanges()}
          resetRequest={lock.resetRequest} onRequestReset={lock.requestReset} onCancelRequest={lock.cancelResetRequest}
          onForgot={lockFlow.forgotCode} />
      </React.Suspense>
    );
  }
  // Session enregistrée en cours de vérification : la structure de l'app tout de suite.
  if (!isAuthenticated && auth.sessionPending) return <BootSkeleton message="Ouverture de votre session…" />;
  if (!isAuthenticated) {
    return <LoginScreen ready={auth.isApiLoaded} apiError={auth.apiError} lockResetPending={lock.resetPending} onCancelLockReset={lock.cancelReset} onLogin={() => void auth.login()} />;
  }
  if (booting) return <BootSkeleton />;

  return (
    <LastSavedAtContext.Provider value={data.lastSavedAt}>
      <AppShell
        view={view} setView={setView} showParentalScreen={derived.showParentalScreen}
        syncPhase={syncPhase(data.syncStatus, data.syncConflict, data.lastSavedAt)} lastSavedAt={data.lastSavedAt}
        isDark={isDark} onToggleTheme={toggleTheme} onRequestLogout={auth.requestLogout} mainRef={mainRef}
        navAction={<>{data.accounts.length > 0 && <QuickAddNavButton onClick={openQuickAdd} />}<AskNavButton onClick={openAsk} className={data.accounts.length > 0 ? 'mt-3' : ''} /></>}
        overlays={<>
          {/* Ajout rapide flottant (téléphone), masqué là où l'écran a déjà son propre ajout ou
              sa barre d'enregistrement (voir showQuickAddFab). Sur ordinateur : navAction. */}
          {data.accounts.length > 0 && showQuickAddFab(view) && (
            <QuickAddFab scrollRef={mainRef} resetKey={view} onClick={openQuickAdd} />
          )}
          {quickAddOpen && <Lazy><QuickAddModal open={quickAddOpen} accounts={data.accounts} onClose={closeQuickAdd} onSubmit={actions.quickAdd} /></Lazy>}
          <StableBottomNav view={view} setView={setView} moreOpen={moreNavOpen} setMoreOpen={setMoreNavOpen} hidden={hiddenScreens} onAsk={openAsk} />
          {askOpen && <Lazy><AskPeculeSheet data={fullData} geminiApiKey={data.geminiApiKey} taxEstimate={derived.taxEstimate} monthPlan={derived.monthPlan}
            onClose={closeAsk} onOpenSettings={section => { openSettingsSection(section); setView('settings'); }} /></Lazy>}
          {/* Une fois après chaque mise à jour : ce qui a changé. */}
          {showWhatsNew && <Lazy><WhatsNewModal isNewUser={data.accounts.length === 0} /></Lazy>}
          <MovedNotice />
          <SyncDialogsHost data={data} dialogs={syncDialogs} addToast={addToast} onLogout={auth.logout} />
        </>}
      >
        <SyncBanners data={data} onReconnect={() => void auth.reconnect()} onOpenConflict={syncDialogs.openConflict} />
        <BackupDeletionNotice active={data.dataShown && !data.isLoadingData} onOpenSettings={() => setView('settings')} />
        <ScreenRouter view={view} setView={setView} data={screenData} derived={derived} actions={actions}
          fiscalWatch={fiscalWatch} accountForm={accountForm} onSignedOutEverywhere={auth.signedOutEverywhere} onQuickAdd={openQuickAdd}
          shareMarker={shareMarker} shareReady={data.dataShown && !data.isLoadingData} onShareDone={endShare} />
      </AppShell>
    </LastSavedAtContext.Provider>
  );
};

const App: React.FC = () => <UiProviders><AppRoot /></UiProviders>;

export default App;
