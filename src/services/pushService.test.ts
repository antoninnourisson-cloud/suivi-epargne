// @vitest-environment jsdom
// Notifications de cet appareil : état affiché, activation (autorisation, clé du serveur,
// réabonnement), désinscription, et rattachement à la nouvelle session après une reconnexion
// (sinon l'abonnement disparaîtrait avec l'ancienne, sans prévenir).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const backend = vi.hoisted(() => ({
  enabled: true,
  register: vi.fn(async (_s: PushSubscriptionJSON) => undefined),
  vapid: vi.fn(async () => 'AQID'), // octets 1, 2, 3 en base64url
  unregister: vi.fn(async (_endpoint: string) => undefined),
}));
vi.mock('./backendService', () => ({
  isBackendEnabled: () => backend.enabled,
  registerPushSubscription: backend.register,
  getVapidPublicKey: backend.vapid,
  unregisterPushSubscription: backend.unregister,
  sendTestPush: vi.fn(),
}));

import { refreshPushRegistration, getPushState, enablePush, disablePush } from './pushService';

const endpoint = 'https://fcm.googleapis.com/fcm/send/x';
const makeSubscription = (key?: number[]) => ({
  endpoint,
  unsubscribe: vi.fn(async () => true),
  options: { applicationServerKey: key ? new Uint8Array(key).buffer : null },
  toJSON: () => ({ endpoint, keys: { p256dh: 'p', auth: 'a' } }),
});
type Sub = ReturnType<typeof makeSubscription>;

let subscription: Sub;
let current: Sub | null;
let registration: { pushManager: { getSubscription: () => Promise<Sub | null>; subscribe: ReturnType<typeof vi.fn> } } | undefined;
const subscribe = vi.fn();

beforeEach(() => {
  backend.enabled = true;
  backend.register.mockReset();
  backend.register.mockResolvedValue(undefined);
  backend.vapid.mockReset();
  backend.vapid.mockResolvedValue('AQID');
  backend.unregister.mockReset();
  backend.unregister.mockResolvedValue(undefined);
  subscription = makeSubscription();
  current = subscription;
  subscribe.mockReset();
  subscribe.mockImplementation(async () => subscription);
  registration = { pushManager: { getSubscription: async () => current, subscribe } };
  vi.stubGlobal('Notification', { permission: 'granted', requestPermission: vi.fn(async () => 'granted') });
  vi.stubGlobal('PushManager', function PushManager() { /* présent */ });
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { getRegistration: async () => registration },
  });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('refreshPushRegistration', () => {
  it('notifications activées ici : abonnement renvoyé au serveur avec la nouvelle session', async () => {
    expect(await refreshPushRegistration()).toBe(true);
    expect(backend.register).toHaveBeenCalledWith(subscription.toJSON());
    // Le même abonnement est rattaché à la nouvelle session : aucun nouvel abonnement.
    expect(subscribe).not.toHaveBeenCalled();
  });

  it('rien à faire sans abonnement, sans permission ou sans serveur', async () => {
    current = null;
    expect(await refreshPushRegistration()).toBe(false);
    current = subscription;
    vi.stubGlobal('Notification', { permission: 'default' });
    expect(await refreshPushRegistration()).toBe(false);
    vi.stubGlobal('Notification', { permission: 'granted' });
    backend.enabled = false;
    expect(await refreshPushRegistration()).toBe(false);
    expect(backend.register).not.toHaveBeenCalled();
  });

  it('échec du serveur : silencieux', async () => {
    backend.register.mockRejectedValue(new Error('TOO_MANY_DEVICES'));
    expect(await refreshPushRegistration()).toBe(false);
  });
});

describe('getPushState', () => {
  it('sans serveur configuré : indisponible', async () => {
    backend.enabled = false;
    expect(await getPushState()).toBe('unavailable');
  });

  it('navigateur sans notifications : non pris en charge', async () => {
    vi.stubGlobal('Notification', undefined);
    delete (globalThis as Record<string, unknown>).Notification;
    expect(await getPushState()).toBe('unsupported');
  });

  it('autorisation refusée dans le navigateur : refusé', async () => {
    vi.stubGlobal('Notification', { permission: 'denied' });
    expect(await getPushState()).toBe('denied');
  });

  it("sans service worker : non pris en charge ; sinon activé ou désactivé selon l'abonnement", async () => {
    registration = undefined;
    expect(await getPushState()).toBe('unsupported');
    registration = { pushManager: { getSubscription: async () => current, subscribe } };
    expect(await getPushState()).toBe('enabled');
    current = null;
    expect(await getPushState()).toBe('disabled');
  });
});

describe('enablePush', () => {
  it('abonnement réussi : clé du serveur utilisée, abonnement envoyé au serveur', async () => {
    current = null;
    await enablePush();
    const options = subscribe.mock.calls[0][0] as { userVisibleOnly: boolean; applicationServerKey: Uint8Array };
    expect(options.userVisibleOnly).toBe(true);
    expect(Array.from(options.applicationServerKey)).toEqual([1, 2, 3]);
    expect(backend.register).toHaveBeenCalledWith(subscription.toJSON());
  });

  it("autorisation refusée : erreur, rien n'est demandé ni envoyé au serveur", async () => {
    vi.stubGlobal('Notification', { permission: 'default', requestPermission: vi.fn(async () => 'denied') });
    await expect(enablePush()).rejects.toThrow('PERMISSION_DENIED');
    expect(backend.vapid).not.toHaveBeenCalled();
    expect(subscribe).not.toHaveBeenCalled();
    expect(backend.register).not.toHaveBeenCalled();
  });

  it('sans service worker : erreur claire', async () => {
    registration = undefined;
    await expect(enablePush()).rejects.toThrow('NO_SERVICE_WORKER');
  });

  it('abonnement déjà valable pour la clé du serveur : gardé tel quel, renvoyé au serveur', async () => {
    subscription = makeSubscription([1, 2, 3]);
    current = subscription;
    await enablePush();
    expect(subscribe).not.toHaveBeenCalled();
    expect(subscription.unsubscribe).not.toHaveBeenCalled();
    expect(backend.register).toHaveBeenCalledTimes(1);
  });

  it("clé du serveur changée : l'ancien abonnement est supprimé puis refait", async () => {
    const old = makeSubscription([9, 9, 9]);
    current = old;
    await enablePush();
    expect(old.unsubscribe).toHaveBeenCalledTimes(1);
    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(backend.register).toHaveBeenCalledWith(subscription.toJSON());
  });

  it("échec du serveur : l'erreur remonte à l'écran", async () => {
    current = null;
    backend.register.mockRejectedValue(new Error('TOO_MANY_DEVICES'));
    await expect(enablePush()).rejects.toThrow('TOO_MANY_DEVICES');
  });
});

describe('disablePush', () => {
  it("désinscription : le serveur est prévenu d'abord, puis l'abonnement local est supprimé", async () => {
    const order: string[] = [];
    backend.unregister.mockImplementation(async () => { order.push('serveur'); });
    subscription.unsubscribe.mockImplementation(async () => { order.push('local'); return true; });
    await disablePush();
    expect(backend.unregister).toHaveBeenCalledWith(endpoint);
    expect(order).toEqual(['serveur', 'local']);
  });

  it("serveur injoignable : l'abonnement local est quand même supprimé", async () => {
    backend.unregister.mockRejectedValue(new Error('hors ligne'));
    await disablePush();
    expect(subscription.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('rien à désinscrire sans abonnement ni service worker', async () => {
    current = null;
    await disablePush();
    registration = undefined;
    await disablePush();
    expect(backend.unregister).not.toHaveBeenCalled();
  });
});
