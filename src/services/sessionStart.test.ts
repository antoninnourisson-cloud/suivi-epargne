// @vitest-environment jsdom
// Démarrage sans attendre les SDK Google : la session est vérifiée tout de suite en mode
// serveur, gardée hors ligne, et les scripts Google ne sont chargés qu'au premier besoin.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const backend = vi.hoisted(() => ({
  enabled: true,
  session: true,
  loginCode: null as null | (() => Promise<unknown>),
  fetchAccessToken: null as null | (() => Promise<{ access_token: string; expires_in: number }>),
  tokenCalls: 0,
}));

vi.mock('./backendService', () => ({
  isBackendEnabled: () => backend.enabled,
  hasBackendSession: () => backend.session,
  fetchAccessToken: async () => { backend.tokenCalls += 1; return backend.fetchAccessToken!(); },
  consumeLoginCode: async () => (backend.loginCode ? backend.loginCode() : null),
  saveBackendSession: () => {},
  startBackendLogin: () => {},
  backendLogout: async () => {},
}));

type Service = typeof import('./googleDriveService');
// État du module (scripts chargés, client de jeton) remis à zéro pour chaque test.
const freshService = async (): Promise<Service> => { vi.resetModules(); return import('./googleDriveService'); };
const googleScripts = () => [...document.querySelectorAll<HTMLScriptElement>('script')].map(s => s.src).filter(src => /google\.com/.test(src));
const setOnline = (online: boolean) => Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });
const storeToken = (validMs: number) => {
  localStorage.setItem('google_token', JSON.stringify({ access_token: 'old' }));
  localStorage.setItem('token_expiry', String(Date.now() + validMs));
  localStorage.setItem('auth_persistence', 'true');
};

beforeEach(() => {
  backend.enabled = true;
  backend.session = true;
  backend.loginCode = null;
  backend.fetchAccessToken = async () => ({ access_token: 'fresh', expires_in: 3600 });
  backend.tokenCalls = 0;
  localStorage.clear();
  document.head.innerHTML = '';
  delete (window as unknown as Record<string, unknown>).google;
  delete (window as unknown as Record<string, unknown>).gapi;
});
afterEach(() => { delete (navigator as unknown as Record<string, unknown>).onLine; vi.useRealTimers(); });

describe('mode serveur : aucun SDK Google au démarrage', () => {
  it('session et jeton valides : prêt tout de suite, sans script ni appel au serveur', async () => {
    storeToken(3_600_000);
    const svc = await freshService();
    expect(await svc.resumeSession()).toBe('ready');
    await svc.initGoogleApi();
    expect(backend.tokenCalls).toBe(0);
    expect(googleScripts()).toEqual([]);
  });

  it('pas de session : écran de connexion', async () => {
    backend.session = false;
    const svc = await freshService();
    expect(await svc.resumeSession()).toBe('signed-out');
  });

  it('jeton expiré : un seul appel au Worker, puis prêt', async () => {
    storeToken(-1);
    const svc = await freshService();
    expect(await svc.resumeSession()).toBe('ready');
    expect(backend.tokenCalls).toBe(1);
    expect(JSON.parse(localStorage.getItem('google_token')!).access_token).toBe('fresh');
  });

  it('hors ligne : session gardée, aucun appel réseau', async () => {
    storeToken(-1);
    setOnline(false);
    const svc = await freshService();
    expect(await svc.resumeSession()).toBe('offline');
    expect(backend.tokenCalls).toBe(0);
  });

  it('Worker injoignable : session gardée (hors ligne), pas de déconnexion', async () => {
    storeToken(-1);
    backend.fetchAccessToken = async () => { throw new TypeError('Failed to fetch'); };
    const svc = await freshService();
    expect(await svc.resumeSession()).toBe('offline');
  });

  it('session refusée par le Worker : écran de connexion', async () => {
    storeToken(-1);
    backend.fetchAccessToken = async () => { throw new Error('SESSION_EXPIRED'); };
    const svc = await freshService();
    expect(await svc.resumeSession()).toBe('signed-out');
  });

  it('retour de connexion : prêt ; échange impossible sans session : erreur réseau remontée', async () => {
    backend.session = false;
    backend.loginCode = async () => ({ access_token: 'new', expires_in: 3600, session: 's' });
    let svc = await freshService();
    // Nouvelle connexion (peut-être un autre compte) : signalée, pour oublier la copie hors ligne.
    const onNewLogin = vi.fn();
    expect(await svc.resumeSession({ onNewLogin })).toBe('ready');
    expect(onNewLogin).toHaveBeenCalledTimes(1);
    backend.loginCode = null;
    backend.session = true;
    svc = await freshService();
    const notNew = vi.fn();
    await svc.resumeSession({ onNewLogin: notNew });
    expect(notNew).not.toHaveBeenCalled();
    backend.session = false;
    backend.loginCode = async () => { throw new TypeError('Failed to fetch'); };
    svc = await freshService();
    await expect(svc.resumeSession()).rejects.toBeInstanceOf(TypeError);
  });
});

describe('sans serveur : Google Identity Services chargé à la demande', () => {
  beforeEach(() => { backend.enabled = false; backend.session = false; });

  it('le script GIS n’est inséré qu’au premier besoin, une seule fois', async () => {
    const svc = await freshService();
    expect(googleScripts()).toEqual([]);
    const first = svc.initGoogleApi();
    const second = svc.initGoogleApi();
    expect(googleScripts()).toEqual(['https://accounts.google.com/gsi/client']);
    const initTokenClient = vi.fn(() => ({ callback: '', requestAccessToken: () => {} }));
    (window as unknown as Record<string, unknown>).google = { accounts: { oauth2: { initTokenClient, revoke: () => {} } } };
    document.querySelector('script')!.dispatchEvent(new Event('load'));
    await Promise.all([first, second]);
    expect(initTokenClient).toHaveBeenCalledTimes(1);
  });

  it('script bloqué ou hors ligne : échec immédiat (erreur réseau), nouvel essai possible', async () => {
    const svc = await freshService();
    const attempt = svc.initGoogleApi();
    document.querySelector('script')!.dispatchEvent(new Event('error'));
    await expect(attempt).rejects.toBeInstanceOf(TypeError);
    expect(googleScripts()).toEqual([]); // script retiré
    void svc.initGoogleApi().catch(() => undefined);
    expect(googleScripts()).toHaveLength(1);
  });

  it('jeton expiré et GIS injoignable au démarrage : hors ligne, pas déconnecté', async () => {
    storeToken(-1);
    const svc = await freshService();
    const status = svc.resumeSession();
    await vi.waitFor(() => expect(googleScripts()).toHaveLength(1));
    document.querySelector('script')!.dispatchEvent(new Event('error'));
    expect(await status).toBe('offline');
    expect(localStorage.getItem('google_token')).not.toBeNull();
  });

  it('le Google Picker charge api.js à sa première ouverture seulement', async () => {
    storeToken(3_600_000);
    const svc = await freshService();
    expect(googleScripts()).toEqual([]);
    const opening = svc.openDrivePicker('picker-key');
    await vi.waitFor(() => expect(googleScripts()).toEqual(['https://apis.google.com/js/api.js']));
    document.querySelector('script')!.dispatchEvent(new Event('error'));
    await expect(opening).rejects.toBeInstanceOf(TypeError);
  });
});
