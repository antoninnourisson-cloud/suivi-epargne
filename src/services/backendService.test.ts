// @vitest-environment jsdom
// Dialogue avec le serveur : session gardée ou effacée au bon moment, code de connexion retiré
// de l'adresse avant l'échange, panne réseau distinguée d'une session refusée (« hors ligne »
// plutôt que déconnexion), délai maximal.
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';

vi.stubEnv('VITE_BACKEND_URL', 'https://api.test/');
type Backend = typeof import('./backendService');
let api: Backend;

const json = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
let fetchMock: Mock<typeof fetch>;
const lastCall = () => fetchMock.mock.calls[fetchMock.mock.calls.length - 1] as unknown as [string, RequestInit];

beforeEach(async () => {
  vi.resetModules();
  api = await import('./backendService');
  localStorage.clear();
  fetchMock = vi.fn<typeof fetch>(async () => json(200, {}));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); window.history.replaceState(null, '', '/'); });

describe('serveur : session et jetons', () => {
  it('adresse du serveur sans barre finale ; connexion avec retour vers l’app et choix du compte', () => {
    expect(api.BACKEND_URL).toBe('https://api.test');
    expect(api.isBackendEnabled()).toBe(true);
    expect(api.backendLoginUrl('https://pecule-app.com/')).toBe('https://api.test/auth/start?return=https%3A%2F%2Fpecule-app.com%2F');
    expect(api.backendLoginUrl('https://pecule-app.com/', { chooseAccount: true })).toMatch(/&select=1$/);
  });

  it('jeton d’accès : session envoyée en Bearer ; 401 = session effacée et reconnexion demandée', async () => {
    expect(api.hasBackendSession()).toBe(false);
    await expect(api.fetchAccessToken()).rejects.toThrow('SESSION_EXPIRED');
    expect(fetchMock).not.toHaveBeenCalled();

    api.saveBackendSession('sess');
    fetchMock.mockResolvedValueOnce(json(200, { access_token: 'ya29', expires_in: 3599 }));
    expect(await api.fetchAccessToken()).toEqual({ access_token: 'ya29', expires_in: 3599 });
    expect(lastCall()[0]).toBe('https://api.test/token');
    expect((lastCall()[1].headers as Record<string, string>).Authorization).toBe('Bearer sess');

    fetchMock.mockResolvedValueOnce(json(401));
    await expect(api.fetchAccessToken()).rejects.toThrow('SESSION_EXPIRED');
    expect(api.hasBackendSession()).toBe(false);
  });

  it('serveur en panne (502) ou injoignable : « hors ligne » (TypeError), la session reste', async () => {
    api.saveBackendSession('sess');
    fetchMock.mockResolvedValueOnce(json(502));
    const err = await api.fetchAccessToken().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TypeError);
    expect((err as Error).message).toBe('BACKEND_502');
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(api.fetchAccessToken()).rejects.toBeInstanceOf(TypeError);
    expect(api.hasBackendSession()).toBe(true);
  });

  it('serveur qui ne répond pas : abandon après 20 s, en « hors ligne »', async () => {
    vi.useFakeTimers();
    api.saveBackendSession('sess');
    fetchMock.mockImplementationOnce((_url, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }));
    const pending = api.fetchAccessToken().catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(20_000);
    const err = await pending;
    expect(err).toBeInstanceOf(TypeError);
    expect((err as Error).message).toBe('BACKEND_TIMEOUT');
  });

  it('retour de connexion : le code est retiré de l’adresse AVANT l’échange, puis échangé', async () => {
    window.history.replaceState(null, '', '/?view=pilot#login_code=abc-123');
    fetchMock.mockImplementationOnce(async () => {
      // Au moment de l'échange, le code n'est déjà plus dans l'adresse.
      expect(window.location.hash).toBe('');
      return json(200, { session: 's', access_token: 'ya29', expires_in: 3599, extra: 'ignoré' });
    });
    expect(await api.consumeLoginCode()).toEqual({ session: 's', access_token: 'ya29', expires_in: 3599 });
    expect(window.location.search).toBe('?view=pilot');
    expect(JSON.parse(String(lastCall()[1].body))).toEqual({ code: 'abc-123' });
    // La session n'est pas encore enregistrée : l'appelant range d'abord le jeton.
    expect(api.hasBackendSession()).toBe(false);
  });

  it('code de connexion refusé : erreur ; pas de code : rien n’est appelé', async () => {
    expect(await api.consumeLoginCode()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    window.history.replaceState(null, '', '/#login_code=perime');
    fetchMock.mockResolvedValueOnce(json(400));
    await expect(api.consumeLoginCode()).rejects.toThrow('LOGIN_CODE_INVALID');
  });

  it('déconnexion : la session locale est effacée même hors ligne', async () => {
    api.saveBackendSession('sess');
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await api.backendLogout();
    expect(api.hasBackendSession()).toBe(false);
  });

  it('déconnecter tous les appareils / supprimer les données serveur : session effacée ; refus = erreur', async () => {
    api.saveBackendSession('sess');
    fetchMock.mockResolvedValueOnce(json(200, { ok: true, sessionsRevoked: 3 }));
    expect(await api.logoutAllDevices()).toBe(3);
    expect(api.hasBackendSession()).toBe(false);

    api.saveBackendSession('sess');
    fetchMock.mockResolvedValueOnce(json(401));
    await expect(api.deleteServerAccount()).rejects.toThrow('SESSION_EXPIRED');
    fetchMock.mockResolvedValueOnce(json(200, { ok: true }));
    await api.deleteServerAccount();
    expect(api.hasBackendSession()).toBe(false);
  });
});

describe('serveur : notifications et veille', () => {
  beforeEach(() => { api.saveBackendSession('sess'); });

  it('abonnement : erreurs traduites (session, trop d’appareils, refus)', async () => {
    const sub = { endpoint: 'https://fcm.googleapis.com/x' };
    fetchMock.mockResolvedValueOnce(json(200));
    await api.registerPushSubscription(sub);
    expect(JSON.parse(String(lastCall()[1].body))).toEqual({ subscription: sub });
    for (const [status, message] of [[401, 'SESSION_EXPIRED'], [409, 'TOO_MANY_DEVICES'], [500, 'SUBSCRIBE_FAILED']] as const) {
      fetchMock.mockResolvedValueOnce(json(status));
      await expect(api.registerPushSubscription(sub)).rejects.toThrow(message);
    }
  });

  it('clé publique, appareils, notification de test, santé du serveur', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { key: 'BPub' }));
    expect(await api.getVapidPublicKey()).toBe('BPub');
    fetchMock.mockResolvedValueOnce(json(500));
    await expect(api.getVapidPublicKey()).rejects.toThrow('VAPID_KEY_UNAVAILABLE');

    fetchMock.mockResolvedValueOnce(json(200, { devices: [{ id: 'd', host: 'fcm.googleapis.com', createdAt: null, current: true }] }));
    expect(await api.listPushDevices()).toHaveLength(1);
    fetchMock.mockResolvedValueOnce(json(200, {}));
    expect(await api.listPushDevices()).toEqual([]);
    fetchMock.mockResolvedValueOnce(json(200, { ok: true }));
    await api.removePushDevice('d');
    expect(JSON.parse(String(lastCall()[1].body))).toEqual({ id: 'd' });
    await api.unregisterPushSubscription('https://fcm.googleapis.com/x');

    fetchMock.mockResolvedValueOnce(json(200, { ok: true }));
    expect(await api.sendTestPush()).toBe(true);
    fetchMock.mockResolvedValueOnce(json(500));
    expect(await api.sendTestPush()).toBe(false);

    fetchMock.mockResolvedValueOnce(json(200, { lastRunAt: null, ok: null }));
    expect(await api.getServerHealth()).toEqual({ lastRunAt: null, ok: null });
    fetchMock.mockResolvedValueOnce(json(503));
    await expect(api.getServerHealth()).rejects.toThrow('BACKEND_503');
  });

  it('veille fiscale : sources, dernier résultat, lancement limité', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { sources: [{ url: 'u', topic: 't', text: 'x', ok: true }] }));
    expect(await api.getFiscalSources()).toHaveLength(1);

    fetchMock.mockResolvedValueOnce(json(404));
    expect(await api.getServerFiscalWatch()).toBeNull();
    fetchMock.mockResolvedValueOnce(json(401));
    await expect(api.getServerFiscalWatch()).rejects.toThrow('SESSION_EXPIRED');
    fetchMock.mockResolvedValueOnce(json(500));
    await expect(api.getServerFiscalWatch()).rejects.toThrow('BACKEND_500');
    fetchMock.mockResolvedValueOnce(json(200, { ok: true, checkedAt: 'x' }));
    expect(await api.getServerFiscalWatch()).toMatchObject({ ok: true });

    fetchMock.mockResolvedValueOnce(json(429, { latest: { ok: true, checkedAt: 'avant' } }));
    expect(await api.runServerFiscalWatch()).toMatchObject({ checkedAt: 'avant' });
    fetchMock.mockResolvedValueOnce(json(429, {}));
    expect(await api.runServerFiscalWatch()).toBeNull();
    fetchMock.mockResolvedValueOnce(json(401));
    await expect(api.runServerFiscalWatch()).rejects.toThrow('SESSION_EXPIRED');
    fetchMock.mockResolvedValueOnce(json(502));
    await expect(api.runServerFiscalWatch()).rejects.toThrow('BACKEND_502');
    fetchMock.mockResolvedValueOnce(json(200, { ok: true, checkedAt: 'maintenant' }));
    expect(await api.runServerFiscalWatch()).toMatchObject({ checkedAt: 'maintenant' });
  });
});
