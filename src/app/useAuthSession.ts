// Session Google de l'appareil : démarrage (session enregistrée, retour de connexion, mode
// démo), connexion, reconnexion, déconnexion. Les données ne sont chargées qu'une fois
// l'appareil déverrouillé : tant que le verrou est affiché, rien de financier n'est lu ni gardé
// en mémoire.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { initGoogleApi, handleAuthClick, handleSignOut, resumeSession, hasStoredSession } from '../services/googleDriveService';
import { isBackendEnabled } from '../services/backendService';
import { disablePush } from '../services/pushService';
import { setGeminiModelOverride } from '../services/geminiService';
import { clearStoredDrafts } from '../components/update/draft';
import { clearTraces } from '../lib/storageKeys';
import type { PortfolioData } from '../hooks/usePortfolioData';
import { preloadStartView } from './screens';
import type { AddToast, DialogApi } from './UiProviders';

// Mode démo (`?demo=1`, données fictives, sans Google) : en développement, et dans le build de
// production des tests de bout en bout (__E2E_DEMO__, voir vite.config.ts). Jamais dans le
// build publié : la condition y vaut `false` et la branche est retirée du bundle.
const DEMO_ALLOWED: boolean = import.meta.env.DEV || __E2E_DEMO__;
const demoRequested = () => DEMO_ALLOWED && new URLSearchParams(window.location.search).has('demo');

interface AuthDeps {
  isAuthenticated: boolean;
  setIsAuthenticated: Dispatch<SetStateAction<boolean>>;
  data: Pick<PortfolioData, 'loadDriveData' | 'loadDemoData' | 'resetData' | 'forgetOfflineCopy' | 'hasUnsyncedChanges' | 'sessionExpired' | 'setGeminiApiKey'>;
  lock: { locked: boolean; resetPending: boolean };
  addToast: AddToast;
  dialog: DialogApi;
  /** Ouvre la fenêtre « modifications pas encore sur Drive ». */
  openLogoutDialog: () => void;
}

export const useAuthSession = ({ isAuthenticated, setIsAuthenticated, data, lock, addToast, dialog, openLogoutDialog }: AuthDeps) => {
  // Bouton de connexion prêt : en mode serveur, tout de suite (redirection vers le Worker) ;
  // sans serveur, une fois Google Identity Services chargé (voir l'effet plus bas).
  const [isApiLoaded, setIsApiLoaded] = useState(() => isBackendEnabled());
  const [apiError, setApiError] = useState(false);
  // Session de l'appareil en cours de vérification au démarrage : l'écran de démarrage
  // s'affiche (plutôt que l'écran de connexion) si une session est enregistrée ou si l'on
  // revient de la connexion Google (code dans l'adresse).
  const [sessionPending, setSessionPending] = useState(() => hasStoredSession() || /[#&]login_code=/.test(window.location.hash));
  const { loadDriveData, loadDemoData, resetData, forgetOfflineCopy, hasUnsyncedChanges, sessionExpired, setGeminiApiKey } = data;
  // Déconnexion : la clé Gemini (son quota, sa facturation) et le modèle choisi ne restent pas
  // sur un appareil déconnecté, peut-être partagé. Ils se ressaisissent dans les Paramètres.
  const forgetGemini = useCallback(() => { setGeminiApiKey(''); setGeminiModelOverride(''); }, [setGeminiApiKey]);
  const { locked, resetPending } = lock;

  // Chargement demandé au démarrage, lancé dès que l'appareil est déverrouillé. `startOffline` :
  // le jeton n'a pas pu être obtenu faute de réseau, la copie hors ligne s'ouvre sans retenter
  // tout de suite (un nouvel essai est programmé).
  const pendingLoadRef = useRef<{ startOffline: boolean } | null>(null);
  useEffect(() => {
    const pending = pendingLoadRef.current;
    if (!isAuthenticated || locked || !pending) return;
    pendingLoadRef.current = null;
    void loadDriveData(pending.startOffline ? { startOffline: true } : undefined);
  }, [isAuthenticated, locked, loadDriveData]);

  // Démarrage — une seule fois par chargement de page : en développement, React (StrictMode)
  // rejoue les effets de montage, ce qui lançait deux démarrages concurrents (deux
  // rafraîchissements, deux consommations du code de connexion...).
  // Aucun SDK Google n'est attendu : en mode serveur, la session est vérifiée tout de suite, et
  // l'écran de démarrage est demandé en même temps. Hors ligne, la session est gardée et l'app
  // s'ouvre sur la dernière copie connue de vos données (voir usePortfolioData).
  const initStartedRef = useRef(false);
  useEffect(() => {
    if (initStartedRef.current) return;
    initStartedRef.current = true;
    if (demoRequested()) {
      import('../dev/demoData').then(({ DEMO_DATA }) => { setIsApiLoaded(true); setIsAuthenticated(true); setSessionPending(false); loadDemoData(DEMO_DATA); }).catch(console.error);
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
        pendingLoadRef.current = { startOffline: status === 'offline' };
        setIsAuthenticated(true);
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
  }, [addToast, loadDemoData, resetData, forgetOfflineCopy, setIsAuthenticated]);

  // Sans serveur, le bouton de connexion a besoin de Google Identity Services : chargé
  // seulement quand l'écran de connexion s'affiche. Un échec (hors ligne, bloqueur de
  // scripts) s'affiche tout de suite au lieu d'une longue attente.
  const showLoginScreen = !isAuthenticated && !sessionPending;
  useEffect(() => {
    if (!showLoginScreen || isBackendEnabled() || demoRequested()) return;
    initGoogleApi()
      .then(() => { setApiError(false); setIsApiLoaded(true); })
      .catch(err => { console.error('Google Identity Services indisponible', err); setApiError(true); });
  }, [showLoginScreen]);
  // Sans serveur, « Se reconnecter » ouvre la fenêtre Google : GIS est chargé dès que la
  // session expire, pour que la fenêtre s'ouvre au clic sans être bloquée.
  useEffect(() => {
    if (sessionExpired && !isBackendEnabled()) initGoogleApi().catch(() => undefined);
  }, [sessionExpired]);

  const login = useCallback(async () => {
    try {
      // Nouvelle connexion, peut-être avec un autre compte Google : la copie hors ligne de la
      // session précédente ne doit jamais s'afficher sous ce compte.
      forgetOfflineCopy();
      // Réinitialisation du verrou en attente : choix du compte et accord toujours demandés.
      await handleAuthClick(false, { chooseAccount: resetPending });
      setIsAuthenticated(true);
      void loadDriveData();
    } catch {
      addToast({ message: 'Échec de la connexion à Google Drive.', kind: 'error' });
    }
  }, [forgetOfflineCopy, resetPending, setIsAuthenticated, loadDriveData, addToast]);

  const reconnect = useCallback(async () => {
    try {
      // Même chose : la reconnexion peut se faire avec un autre compte (elle sera réécrite au
      // prochain chargement réussi).
      forgetOfflineCopy();
      await handleAuthClick(false, { chooseAccount: resetPending });
      // Chargement normal, pas « recharger l'autre version » : des modifications faites
      // pendant l'expiration de la session restent proposées (copie locale), et un conflit
      // en cours n'est jamais tranché à la place de l'utilisateur.
      void loadDriveData();
    } catch {
      addToast({ message: 'Reconnexion échouée.', kind: 'error' });
    }
  }, [forgetOfflineCopy, resetPending, loadDriveData, addToast]);

  const logout = useCallback(async (opts?: { discardUnsynced?: boolean }) => {
    // Un appareil déconnecté ne doit plus recevoir de notifications (qui contiennent des
    // montants) : désabonnement AVANT de fermer la session, tant qu'elle est valide.
    if (isBackendEnabled()) await disablePush().catch(() => undefined);
    await handleSignOut();
    setIsAuthenticated(false);
    // Sauf « Se déconnecter sans envoyer », les modifications pas encore sur Drive restent en
    // copie locale chiffrée, proposée à la prochaine connexion (voir resetData).
    resetData({ discardUnsynced: opts?.discardUnsynced === true });
    clearStoredDrafts(); // brouillons d'« Actualiser » de cet onglet
    forgetGemini();
    // Traces d'usage liées aux données (dernière vue, identifiants de compte ou de fichier,
    // choix de l'Accueil… : registre lib/storageKeys) : elles ne passent pas au compte Google
    // qui se connectera ensuite sur cet appareil, peut-être partagé. « Code oublié » passe
    // par cette déconnexion : même effacement.
    clearTraces();
  }, [setIsAuthenticated, resetData, forgetGemini]);

  /**
   * Déconnexion demandée par l'utilisateur : si quelque chose n'est pas encore sur Drive, deux
   * choix clairs (envoyer d'abord, ou se déconnecter sans envoyer) ou annuler, sur ordinateur
   * comme sur mobile. `alwaysConfirm` : le bouton du mobile, plus facile à toucher par
   * erreur, demande toujours confirmation.
   */
  const requestLogout = useCallback((alwaysConfirm: boolean) => {
    if (hasUnsyncedChanges()) openLogoutDialog();
    else if (alwaysConfirm) {
      dialog.open({ kind: 'confirm', title: 'Se déconnecter ?', message: 'Les données restent sur votre Drive ; il faudra vous reconnecter avec Google.', confirmLabel: 'Se déconnecter', onConfirm: () => { void logout(); } });
    } else void logout();
  }, [hasUnsyncedChanges, openLogoutDialog, dialog, logout]);

  /** « Déconnecter tous les appareils » (Paramètres) : cet appareil l'est aussi. */
  const signedOutEverywhere = useCallback(() => {
    setIsAuthenticated(false);
    resetData();
    forgetGemini();
    clearTraces();
    addToast({ message: 'Tous les appareils sont déconnectés', kind: 'success' });
  }, [setIsAuthenticated, resetData, addToast, forgetGemini]);

  return { isApiLoaded, apiError, sessionPending, login, reconnect, logout, requestLogout, signedOutEverywhere };
};
