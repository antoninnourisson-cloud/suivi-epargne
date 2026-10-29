// @vitest-environment jsdom
// Session Google de l'appareil (useAuthSession) : démarrage (session reprise, hors ligne,
// refusée, serveur injoignable), chargement retenu tant que l'appareil est verrouillé,
// connexion, reconnexion et déconnexion. La partie Gemini et traces d'usage de la déconnexion
// est dans useAuthSession.gemini.test.ts.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useAuthSession } from './useAuthSession';
import { initGoogleApi, handleAuthClick, handleSignOut, resumeSession, hasStoredSession } from '../services/googleDriveService';
import { isBackendEnabled } from '../services/backendService';
import { disablePush } from '../services/pushService';
import { preloadStartView } from './screens';

vi.mock('../services/googleDriveService', () => ({
  initGoogleApi: vi.fn(),
  handleAuthClick: vi.fn(),
  handleSignOut: vi.fn(async () => undefined),
  resumeSession: vi.fn(),
  hasStoredSession: vi.fn(() => false),
}));
vi.mock('../services/backendService', () => ({ isBackendEnabled: vi.fn(() => true) }));
vi.mock('../services/pushService', () => ({ disablePush: vi.fn(async () => undefined) }));
vi.mock('./screens', () => ({ preloadStartView: vi.fn() }));
vi.mock('../dev/demoData', () => ({ DEMO_DATA: { demo: true } }));

type Deps = Parameters<typeof useAuthSession>[0];
type Props = { isAuthenticated: boolean; locked: boolean; resetPending?: boolean; sessionExpired?: boolean };

const never = () => new Promise<never>(() => undefined);

const setup = (initial: Props, { unsynced = false } = {}) => {
  const data = {
    loadDriveData: vi.fn(async () => true), loadDemoData: vi.fn(), resetData: vi.fn(), forgetOfflineCopy: vi.fn(),
    hasUnsyncedChanges: vi.fn(() => unsynced), setGeminiApiKey: vi.fn(),
  };
  const setIsAuthenticated = vi.fn();
  const addToast = vi.fn();
  const dialog = { open: vi.fn(), confirm: vi.fn() };
  const openLogoutDialog = vi.fn();
  const hook = renderHook((p: Props) => useAuthSession({
    isAuthenticated: p.isAuthenticated, setIsAuthenticated,
    data: { ...data, sessionExpired: p.sessionExpired ?? false } as unknown as Deps['data'],
    lock: { locked: p.locked, resetPending: p.resetPending ?? false }, addToast,
    dialog: dialog as unknown as Deps['dialog'], openLogoutDialog,
  }), { initialProps: initial });
  return { ...hook, data, setIsAuthenticated, addToast, dialog, openLogoutDialog };
};

beforeEach(() => {
  vi.mocked(resumeSession).mockImplementation(never);
  vi.mocked(initGoogleApi).mockImplementation(never);
  vi.mocked(handleAuthClick).mockResolvedValue(undefined as never);
  vi.mocked(hasStoredSession).mockReturnValue(false);
  vi.mocked(isBackendEnabled).mockReturnValue(true);
});
afterEach(() => { vi.clearAllMocks(); window.history.replaceState(null, '', '/'); });

describe('démarrage', () => {
  it('session reprise : connecté, puis données chargées seulement une fois déverrouillé', async () => {
    vi.mocked(hasStoredSession).mockReturnValue(true);
    vi.mocked(resumeSession).mockResolvedValue('ok' as never);
    const { result, rerender, data, setIsAuthenticated } = setup({ isAuthenticated: false, locked: true });
    expect(result.current.sessionPending).toBe(true);
    expect(preloadStartView).toHaveBeenCalled();
    await waitFor(() => expect(result.current.sessionPending).toBe(false));
    expect(setIsAuthenticated).toHaveBeenCalledWith(true);
    // Le verrou est encore affiché : rien de financier n'est lu.
    rerender({ isAuthenticated: true, locked: true });
    expect(data.loadDriveData).not.toHaveBeenCalled();
    rerender({ isAuthenticated: true, locked: false });
    expect(data.loadDriveData).toHaveBeenCalledWith(undefined);
    // Une seule fois : un nouveau rendu ne relance pas le chargement.
    rerender({ isAuthenticated: true, locked: false });
    expect(data.loadDriveData).toHaveBeenCalledTimes(1);
  });

  it('jeton inaccessible faute de réseau : la copie hors ligne s’ouvre sans retenter tout de suite', async () => {
    vi.mocked(resumeSession).mockResolvedValue('offline' as never);
    const { result, rerender, data } = setup({ isAuthenticated: false, locked: false });
    await waitFor(() => expect(result.current.sessionPending).toBe(false));
    rerender({ isAuthenticated: true, locked: false });
    expect(data.loadDriveData).toHaveBeenCalledWith({ startOffline: true });
  });

  it('session absente ou refusée : tout est effacé, rien n’est chargé', async () => {
    vi.mocked(resumeSession).mockResolvedValue('signed-out' as never);
    const { result, data, setIsAuthenticated } = setup({ isAuthenticated: false, locked: false });
    await waitFor(() => expect(result.current.sessionPending).toBe(false));
    expect(data.resetData).toHaveBeenCalled();
    expect(setIsAuthenticated).not.toHaveBeenCalled();
    // Le retour d'une connexion oublie la copie hors ligne de la session précédente.
    expect(vi.mocked(resumeSession).mock.calls[0][0]).toEqual({ onNewLogin: data.forgetOfflineCopy });
  });

  it('serveur injoignable au retour de connexion : message, écran de connexion', async () => {
    window.history.replaceState(null, '', '/#login_code=abc');
    vi.mocked(resumeSession).mockRejectedValue(new TypeError('Failed to fetch'));
    const { result, addToast } = setup({ isAuthenticated: false, locked: false });
    expect(result.current.sessionPending).toBe(true);
    await waitFor(() => expect(result.current.sessionPending).toBe(false));
    expect(addToast).toHaveBeenCalledWith({ message: 'Serveur injoignable — vérifiez votre connexion puis rechargez.', kind: 'error' });
  });

  it('session serveur invalide : reconnexion demandée, sans message d’erreur', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(resumeSession).mockRejectedValue(new Error('REAUTH_REQUIRED'));
    const { result, addToast } = setup({ isAuthenticated: false, locked: false });
    await waitFor(() => expect(result.current.sessionPending).toBe(false));
    expect(addToast).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it('mode démo : données fictives, sans Google', async () => {
    window.history.replaceState(null, '', '/?demo=1');
    const { result, data, setIsAuthenticated } = setup({ isAuthenticated: false, locked: false });
    await waitFor(() => expect(data.loadDemoData).toHaveBeenCalledWith({ demo: true }));
    expect(setIsAuthenticated).toHaveBeenCalledWith(true);
    expect(result.current.isApiLoaded).toBe(true);
    expect(resumeSession).not.toHaveBeenCalled();
  });
});

describe('sans serveur : Google Identity Services', () => {
  beforeEach(() => { vi.mocked(isBackendEnabled).mockReturnValue(false); });

  it('chargé quand l’écran de connexion s’affiche ; bouton prêt ensuite', async () => {
    vi.mocked(resumeSession).mockResolvedValue('signed-out' as never);
    vi.mocked(initGoogleApi).mockResolvedValue(undefined as never);
    const { result } = setup({ isAuthenticated: false, locked: false });
    expect(result.current.isApiLoaded).toBe(false);
    await waitFor(() => expect(result.current.isApiLoaded).toBe(true));
    expect(result.current.apiError).toBe(false);
  });

  it('échec du chargement (hors ligne, bloqueur) : signalé tout de suite', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(resumeSession).mockResolvedValue('signed-out' as never);
    vi.mocked(initGoogleApi).mockRejectedValue(new Error('script bloqué'));
    const { result } = setup({ isAuthenticated: false, locked: false });
    await waitFor(() => expect(result.current.apiError).toBe(true));
    expect(result.current.isApiLoaded).toBe(false);
    err.mockRestore();
  });

  it('session expirée : chargé d’avance pour que « Se reconnecter » ouvre la fenêtre', () => {
    vi.mocked(initGoogleApi).mockRejectedValue(new Error('hors ligne'));
    const { rerender } = setup({ isAuthenticated: true, locked: false });
    expect(initGoogleApi).not.toHaveBeenCalled();
    rerender({ isAuthenticated: true, locked: false, sessionExpired: true });
    expect(initGoogleApi).toHaveBeenCalledTimes(1);
  });
});

describe('connexion et reconnexion', () => {
  it('connexion : copie hors ligne oubliée, choix du compte si le verrou est à réinitialiser, puis chargement', async () => {
    const { result, data, setIsAuthenticated } = setup({ isAuthenticated: false, locked: false, resetPending: true });
    await act(async () => { await result.current.login(); });
    expect(data.forgetOfflineCopy).toHaveBeenCalled();
    expect(handleAuthClick).toHaveBeenCalledWith(false, { chooseAccount: true });
    expect(setIsAuthenticated).toHaveBeenCalledWith(true);
    expect(data.loadDriveData).toHaveBeenCalledWith();
  });

  it('connexion refusée ou fenêtre fermée : message, rien de chargé', async () => {
    vi.mocked(handleAuthClick).mockRejectedValue(new Error('popup_closed'));
    const { result, data, setIsAuthenticated, addToast } = setup({ isAuthenticated: false, locked: false });
    await act(async () => { await result.current.login(); });
    expect(setIsAuthenticated).not.toHaveBeenCalled();
    expect(data.loadDriveData).not.toHaveBeenCalled();
    expect(addToast).toHaveBeenCalledWith({ message: 'Échec de la connexion à Google Drive.', kind: 'error' });
  });

  it('reconnexion : chargement normal (les modifications locales restent proposées)', async () => {
    const { result, data, setIsAuthenticated } = setup({ isAuthenticated: true, locked: false });
    await act(async () => { await result.current.reconnect(); });
    expect(data.forgetOfflineCopy).toHaveBeenCalled();
    expect(handleAuthClick).toHaveBeenCalledWith(false, { chooseAccount: false });
    expect(data.loadDriveData).toHaveBeenCalledWith();
    expect(setIsAuthenticated).not.toHaveBeenCalled();
  });

  it('reconnexion échouée : message', async () => {
    vi.mocked(handleAuthClick).mockRejectedValue(new Error('access_denied'));
    const { result, data, addToast } = setup({ isAuthenticated: true, locked: false });
    await act(async () => { await result.current.reconnect(); });
    expect(data.loadDriveData).not.toHaveBeenCalled();
    expect(addToast).toHaveBeenCalledWith({ message: 'Reconnexion échouée.', kind: 'error' });
  });
});

describe('déconnexion', () => {
  it('avec serveur : notifications coupées AVANT de fermer la session', async () => {
    const order: string[] = [];
    vi.mocked(disablePush).mockImplementation(async () => { order.push('push'); });
    vi.mocked(handleSignOut).mockImplementation(async () => { order.push('signout'); });
    const { result, data, setIsAuthenticated } = setup({ isAuthenticated: true, locked: false });
    await act(async () => { await result.current.logout(); });
    expect(order).toEqual(['push', 'signout']);
    expect(setIsAuthenticated).toHaveBeenCalledWith(false);
    // Les modifications pas encore sur Drive restent en copie locale chiffrée.
    expect(data.resetData).toHaveBeenCalledWith({ discardUnsynced: false });
  });

  it('désabonnement en échec : la déconnexion se fait quand même ; « sans envoyer » jette les modifications', async () => {
    vi.mocked(disablePush).mockRejectedValue(new Error('hors ligne'));
    const { result, data } = setup({ isAuthenticated: true, locked: false });
    await act(async () => { await result.current.logout({ discardUnsynced: true }); });
    expect(handleSignOut).toHaveBeenCalled();
    expect(data.resetData).toHaveBeenCalledWith({ discardUnsynced: true });
  });

  it('sans serveur : pas de désabonnement push', async () => {
    vi.mocked(isBackendEnabled).mockReturnValue(false);
    const { result } = setup({ isAuthenticated: true, locked: false });
    await act(async () => { await result.current.logout(); });
    expect(disablePush).not.toHaveBeenCalled();
    expect(handleSignOut).toHaveBeenCalled();
  });

  it('modifications pas encore sur Drive : la fenêtre à deux choix s’ouvre, rien n’est fermé', () => {
    const { result, openLogoutDialog, dialog } = setup({ isAuthenticated: true, locked: false }, { unsynced: true });
    act(() => result.current.requestLogout(true));
    expect(openLogoutDialog).toHaveBeenCalled();
    expect(dialog.open).not.toHaveBeenCalled();
    expect(handleSignOut).not.toHaveBeenCalled();
  });

  it('bouton du mobile : confirmation demandée, déconnexion au « Se déconnecter »', async () => {
    const { result, dialog } = setup({ isAuthenticated: true, locked: false });
    act(() => result.current.requestLogout(true));
    const asked = dialog.open.mock.calls[0][0] as { title: string; confirmLabel: string; onConfirm: () => void };
    expect(asked).toMatchObject({ title: 'Se déconnecter ?', confirmLabel: 'Se déconnecter' });
    expect(handleSignOut).not.toHaveBeenCalled();
    await act(async () => { asked.onConfirm(); });
    await waitFor(() => expect(handleSignOut).toHaveBeenCalled());
  });

  it('ordinateur, tout est sur Drive : déconnexion directe', async () => {
    const { result, dialog } = setup({ isAuthenticated: true, locked: false });
    await act(async () => { result.current.requestLogout(false); });
    expect(dialog.open).not.toHaveBeenCalled();
    await waitFor(() => expect(handleSignOut).toHaveBeenCalled());
  });

  it('« Déconnecter tous les appareils » : cet appareil aussi, avec un message', () => {
    const { result, data, setIsAuthenticated, addToast } = setup({ isAuthenticated: true, locked: false });
    act(() => result.current.signedOutEverywhere());
    expect(setIsAuthenticated).toHaveBeenCalledWith(false);
    expect(data.resetData).toHaveBeenCalledWith();
    expect(addToast).toHaveBeenCalledWith({ message: 'Tous les appareils sont déconnectés', kind: 'success' });
  });
});
