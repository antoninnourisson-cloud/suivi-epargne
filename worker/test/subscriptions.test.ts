import { describe, it, expect } from 'vitest';
import {
  isAllowedPushEndpoint, parseSubscription, upsertSubscription, describeDevices, deviceId, MAX_SUBSCRIPTIONS, StoredSubscription,
} from '../src/subscriptions';
import { b64urlEncode } from '../src/crypto';
import { makeKeys } from './kvFake';

describe('hôtes de push autorisés', () => {
  it.each([
    'https://fcm.googleapis.com/fcm/send/abc',
    'https://updates.push.services.mozilla.com/wpush/v2/abc',
    'https://web.push.apple.com/QH2abc',
    'https://api.push.apple.com/3/device/abc',
    'https://wns2-par02p.notify.windows.com/w/?token=abc',
  ])('accepte %s', url => expect(isAllowedPushEndpoint(url)).toBe(true));

  it.each([
    'http://fcm.googleapis.com/fcm/send/abc',           // pas https
    'https://fcm.googleapis.com:8443/fcm/send/abc',     // port
    'https://evil.example/fcm.googleapis.com',
    'https://fcm.googleapis.com.evil.example/x',
    'https://evilpush.apple.com/x',                     // suffixe sans point
    'https://push.apple.com/x',                         // suffixe nu
    'https://user:pw@fcm.googleapis.com/x',
    'https://169.254.169.254/latest',
    'pas une url',
    `https://fcm.googleapis.com/${'a'.repeat(1100)}`,   // > 1024
  ])('refuse %s', url => expect(isAllowedPushEndpoint(url)).toBe(false));

  it('refuse un endpoint qui n’est pas une chaîne', () => expect(isAllowedPushEndpoint(42)).toBe(false));
});

describe('parseSubscription', () => {
  it('reconstruit exactement {endpoint, keys:{p256dh, auth}} et ignore le reste', async () => {
    const keys = await makeKeys();
    const parsed = parseSubscription({
      endpoint: 'https://fcm.googleapis.com/fcm/send/abc', expirationTime: null, keys: { ...keys, extra: 'x' }, evil: { a: 1 },
    });
    expect(parsed).toEqual({ endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys });
    expect(Object.keys(parsed!)).toEqual(['endpoint', 'keys']);
    expect(Object.keys(parsed!.keys)).toEqual(['p256dh', 'auth']);
  });

  it('refuse des clés invalides ou trop longues', async () => {
    const keys = await makeKeys();
    const ep = 'https://fcm.googleapis.com/fcm/send/abc';
    expect(parseSubscription({ endpoint: ep, keys: { ...keys, p256dh: 'A'.repeat(300) } })).toBeNull();
    expect(parseSubscription({ endpoint: ep, keys: { ...keys, p256dh: keys.p256dh.slice(0, 40) } })).toBeNull();
    expect(parseSubscription({ endpoint: ep, keys: { ...keys, auth: b64urlEncode(new Uint8Array(8)) } })).toBeNull();
    expect(parseSubscription({ endpoint: ep, keys: { ...keys, auth: 'p@s b64!' } })).toBeNull();
    expect(parseSubscription({ endpoint: ep, keys: { p256dh: 1, auth: 2 } })).toBeNull();
    expect(parseSubscription({ endpoint: ep })).toBeNull();
    expect(parseSubscription({ endpoint: 'https://evil.example/x', keys })).toBeNull();
    expect(parseSubscription(null)).toBeNull();
  });
});

describe('upsertSubscription', () => {
  const sub = (i: number, keys: { p256dh: string; auth: string }) => ({ endpoint: `https://fcm.googleapis.com/fcm/send/${i}`, keys });

  it('rattache à la session, garde la date de création, et remplace le même endpoint', async () => {
    const keys = await makeKeys();
    const legacy: StoredSubscription[] = [{ ...sub(1, keys) }]; // ancien abonnement, sans session
    const r = upsertSubscription(legacy, sub(1, keys), 'sessA', 5_000);
    expect(r.ok && r.list).toEqual([{ ...sub(1, keys), sessionHash: 'sessA', createdAt: 5_000 }]);
    const again = upsertSubscription(r.ok ? r.list : [], sub(1, keys), 'sessB', 9_000);
    expect(again.ok && again.list).toEqual([{ ...sub(1, keys), sessionHash: 'sessB', createdAt: 5_000 }]);
  });

  it(`plafonne à ${MAX_SUBSCRIPTIONS} appareils, sans évincer les existants`, async () => {
    const keys = await makeKeys();
    let list: StoredSubscription[] = [];
    for (let i = 0; i < MAX_SUBSCRIPTIONS; i++) {
      const r = upsertSubscription(list, sub(i, keys), 's', i);
      expect(r.ok).toBe(true);
      if (r.ok) list = r.list;
    }
    expect(upsertSubscription(list, sub(99, keys), 's')).toEqual({ ok: false, error: 'TOO_MANY_DEVICES' });
    // Réabonner un appareil déjà connu reste possible.
    expect(upsertSubscription(list, sub(3, keys), 's').ok).toBe(true);
  });

  it("décrit les appareils sans exposer l'endpoint", async () => {
    const keys = await makeKeys();
    const list: StoredSubscription[] = [
      { ...sub(1, keys), sessionHash: 'me', createdAt: Date.UTC(2026, 9, 1) },
      { endpoint: 'https://web.push.apple.com/xyz', keys },
    ];
    const d = await describeDevices(list, 'me');
    expect(d).toEqual([
      { id: await deviceId(sub(1, keys).endpoint), host: 'fcm.googleapis.com', createdAt: '2026-10-01T00:00:00.000Z', current: true },
      { id: await deviceId('https://web.push.apple.com/xyz'), host: 'web.push.apple.com', createdAt: null, current: false },
    ]);
    expect(JSON.stringify(d)).not.toContain('/fcm/send/');
  });
});
