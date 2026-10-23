// @vitest-environment jsdom
// Après une nouvelle connexion, l'abonnement aux notifications de cet appareil est rattaché à
// la nouvelle session (sinon il disparaîtrait avec l'ancienne, sans prévenir).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const backend = vi.hoisted(() => ({
  enabled: true,
  register: vi.fn(async (_s: PushSubscriptionJSON) => undefined),
}));
vi.mock('./backendService', () => ({
  isBackendEnabled: () => backend.enabled,
  registerPushSubscription: backend.register,
  getVapidPublicKey: vi.fn(),
  unregisterPushSubscription: vi.fn(),
  sendTestPush: vi.fn(),
}));

import { refreshPushRegistration } from './pushService';

const subscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/x', toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/fcm/send/x', keys: { p256dh: 'p', auth: 'a' } }) };
let current: typeof subscription | null;

beforeEach(() => {
  backend.enabled = true;
  backend.register.mockReset();
  backend.register.mockResolvedValue(undefined);
  current = subscription;
  vi.stubGlobal('Notification', { permission: 'granted' });
  vi.stubGlobal('PushManager', function PushManager() { /* présent */ });
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { getRegistration: async () => ({ pushManager: { getSubscription: async () => current } }) },
  });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('refreshPushRegistration', () => {
  it('notifications activées ici : abonnement renvoyé au serveur avec la nouvelle session', async () => {
    expect(await refreshPushRegistration()).toBe(true);
    expect(backend.register).toHaveBeenCalledWith(subscription.toJSON());
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
