// Conservation du jeton Google, de l'e-mail et de l'identifiant (user:<sub>) : gardés
// seulement tant qu'ils servent (session ouverte ou notifications actives), 61 jours au plus
// sans usage, effacés à la déconnexion du dernier appareil, et accès retiré chez Google
// constaté par la tâche quotidienne même sans notification (page de confidentialité).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import worker, { Env } from '../src/index';
import { createSession } from '../src/sessions';
import { b64urlEncode, encryptString, decryptString, utf8 } from '../src/crypto';
import { USER_TTL, RECENT_WRITE_GRACE_MS, isUserInUse, releaseUserIfUnused, touchUser, writeUser } from '../src/userRecords';
import { MemoryKV, makeKeys } from './kvFake';

const APP = 'https://owner.github.io/suivi-epargne/';
const ORIGIN = 'https://owner.github.io';
const W = 'https://api.example.workers.dev';
const CLIENT = 'client-123.apps.googleusercontent.com';
const DAY_MS = 86_400_000;
const NOW = Date.parse('2026-10-14T07:00:00Z');

let kv: MemoryKV;
let env: Env;

const makeEnv = async (): Promise<Env> => {
  const vapid = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']) as CryptoKeyPair;
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', vapid.publicKey) as ArrayBuffer);
  return {
    STORE: kv.asKV(), GOOGLE_CLIENT_ID: CLIENT, GOOGLE_CLIENT_SECRET: 'secret',
    ENCRYPTION_KEY: b64urlEncode(crypto.getRandomValues(new Uint8Array(32))),
    VAPID_PUBLIC_KEY: b64urlEncode(pub), VAPID_PRIVATE_KEY: (await crypto.subtle.exportKey('jwk', vapid.privateKey)).d!,
    VAPID_SUBJECT: APP, APP_URL: APP, ALLOWED_EMAILS: 'me@example.com',
  };
};

const post = (path: string, token?: string, body?: unknown) => {
  const headers = new Headers({ Origin: ORIGIN });
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return worker.fetch(new Request(`${W}${path}`, { method: 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body) }), env);
};

const runCron = async () => {
  let p: Promise<unknown> = Promise.resolve();
  await worker.scheduled({} as ScheduledEvent, env, { waitUntil: (x: Promise<unknown>) => { p = x; } } as ExecutionContext);
  await p;
};

/** Compte gardé, à l'ancienne (sans durée de vie) sauf `ttl`. */
const seedUser = async (sub = 'u1', opts: { ttl?: boolean; touchedAt?: number } = {}) => {
  const record = { email: 'me@example.com', refreshTokenEnc: await encryptString('1//rt', env.ENCRYPTION_KEY), updatedAt: 0, ...(opts.touchedAt !== undefined ? { touchedAt: opts.touchedAt } : {}) };
  await kv.put(`user:${sub}`, JSON.stringify(record), opts.ttl ? { expirationTtl: USER_TTL } : undefined);
};

const googleRefresh = (status: number, body: object) => {
  const f = vi.fn(async (_url: string) => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', f);
  return f;
};
const googleOk = (extra: object = {}) => googleRefresh(200, { access_token: 'ya29.fresh', expires_in: 3599, ...extra });

const userExpiry = (sub = 'u1') => kv.data.get(`user:${sub}`)?.expiresAt;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  kv = new MemoryKV();
  env = await makeEnv();
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('connexion : choix du compte', () => {
  const promptOf = async (query: string) => {
    const res = await worker.fetch(new Request(`${W}/auth/start?return=${encodeURIComponent(APP)}${query}`), env);
    expect(res.status).toBe(302);
    return new URL(res.headers.get('Location')!).searchParams.get('prompt');
  };

  it('demande toujours le consentement, et le choix du compte pour « Code oublié »', async () => {
    expect(await promptOf('')).toBe('consent');
    expect(await promptOf('&select=1')).toBe('select_account consent');
    expect(await promptOf('&select=0')).toBe('consent');
  });

  it('le compte enregistré à la connexion a une durée de vie de 61 jours', async () => {
    const fakeJwt = (claims: object) => `${b64urlEncode(utf8('{"alg":"RS256"}'))}.${b64urlEncode(utf8(JSON.stringify(claims)))}.sig`;
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      access_token: 'ya29.access', expires_in: 3599, refresh_token: '1//refresh',
      scope: 'openid email https://www.googleapis.com/auth/drive.file',
      id_token: fakeJwt({ sub: 'g-42', email: 'me@example.com', email_verified: true, aud: CLIENT, iss: 'https://accounts.google.com', exp: 4_000_000_000 }),
    }), { status: 200 })));
    const start = await worker.fetch(new Request(`${W}/auth/start?return=${encodeURIComponent(APP)}`), env);
    const state = new URL(start.headers.get('Location')!).searchParams.get('state')!;
    const cookie = start.headers.get('Set-Cookie')!.split(';')[0];
    // Ordre des écritures : la session existe avant le compte (sinon une déconnexion du
    // dernier appareil au même moment pouvait effacer le compte tout juste écrit).
    const writes: string[] = [];
    const put = kv.put.bind(kv);
    vi.spyOn(kv, 'put').mockImplementation(async (key, value, opts) => { writes.push(key); return put(key, value, opts); });
    const cb = await worker.fetch(new Request(`${W}/auth/callback?state=${state}&code=abc`, { headers: { Cookie: cookie } }), env);
    expect(cb.status).toBe(302);
    expect(userExpiry('g-42')! - NOW).toBe(USER_TTL * 1000);
    const stored = await kv.get('user:g-42', 'json');
    expect(stored.touchedAt).toBe(NOW);
    expect(await decryptString(stored.refreshTokenEnc, env.ENCRYPTION_KEY)).toBe('1//refresh');
    const userWrite = writes.indexOf('user:g-42');
    expect(userWrite).toBeGreaterThan(-1);
    expect(writes.indexOf('sessions:g-42')).toBeGreaterThan(-1);
    expect(writes.indexOf('sessions:g-42')).toBeLessThan(userWrite);
    expect(writes.findIndex(k => k.startsWith('session:'))).toBeLessThan(userWrite);
  });
});

describe('durée de vie du compte', () => {
  it("/token prolonge la durée de vie au plus une fois par jour", async () => {
    googleOk();
    const { token } = await createSession(kv.asKV(), 'u1', 'me@example.com');
    await seedUser('u1', { ttl: true, touchedAt: NOW });
    const firstExpiry = userExpiry();
    const writes = kv.writes;

    expect((await post('/token', token)).status).toBe(200);
    expect(kv.writes).toBe(writes); // utilisé il y a moins d'un jour : aucune écriture
    expect(userExpiry()).toBe(firstExpiry);

    vi.setSystemTime(NOW + 2 * DAY_MS);
    expect((await post('/token', token)).status).toBe(200);
    expect(userExpiry()! - (NOW + 2 * DAY_MS)).toBe(USER_TTL * 1000);
  });

  it('garde le refresh token le plus récent, avec une durée de vie neuve', async () => {
    googleOk({ refresh_token: '1//rotated' });
    const { token } = await createSession(kv.asKV(), 'u1', 'me@example.com');
    await seedUser('u1');
    expect((await post('/token', token)).status).toBe(200);
    const stored = await kv.get('user:u1', 'json');
    expect(await decryptString(stored.refreshTokenEnc, env.ENCRYPTION_KEY)).toBe('1//rotated');
    expect(userExpiry()! - NOW).toBe(USER_TTL * 1000);
  });

  it("disparaît de lui-même après 61 jours sans usage", async () => {
    await seedUser('u1', { ttl: true, touchedAt: NOW });
    vi.setSystemTime(NOW + 60 * DAY_MS);
    expect(kv.keysWithPrefix('user:')).toEqual(['user:u1']);
    vi.setSystemTime(NOW + 61 * DAY_MS);
    expect(kv.keysWithPrefix('user:')).toEqual([]);
  });

  it('touchUser écrit un compte sans date de prolongation (comptes d’avant la règle)', async () => {
    await seedUser('u1');
    expect(userExpiry()).toBeUndefined();
    await touchUser(kv.asKV(), 'u1', await kv.get('user:u1', 'json'));
    expect(userExpiry()! - NOW).toBe(USER_TTL * 1000);
  });
});

describe('effacement quand le compte ne sert plus', () => {
  it('déconnexion du dernier appareil : jeton, e-mail et identifiant effacés', async () => {
    const a = await createSession(kv.asKV(), 'u1', 'me@example.com');
    const b = await createSession(kv.asKV(), 'u1', 'me@example.com');
    await seedUser('u1', { ttl: true });
    await kv.put('backup:u1:2026-10-01', '{}', { expirationTtl: 3600 });

    await post('/auth/logout', a.token);
    expect(kv.keysWithPrefix('user:')).toEqual(['user:u1']); // l'autre appareil s'en sert encore
    await post('/auth/logout', b.token);
    expect(kv.keysWithPrefix('user:')).toEqual([]);
    expect(kv.keysWithPrefix('backup:')).toEqual(['backup:u1:2026-10-01']); // illisible ici, gardée
  });

  it('déconnexion : un ancien abonnement sans session garde le compte (rappels encore actifs)', async () => {
    const a = await createSession(kv.asKV(), 'u1', 'me@example.com');
    await seedUser('u1', { ttl: true });
    await kv.put('push:u1', JSON.stringify([{ endpoint: 'https://fcm.googleapis.com/fcm/send/legacy', keys: await makeKeys() }]));
    await post('/auth/logout', a.token);
    expect(kv.keysWithPrefix('user:')).toEqual(['user:u1']);
  });

  it('déconnexion de tous les appareils : le compte part aussi', async () => {
    const a = await createSession(kv.asKV(), 'u1', 'me@example.com');
    await createSession(kv.asKV(), 'u1', 'me@example.com');
    await seedUser('u1', { ttl: true });
    await seedUser('u2', { ttl: true });
    expect((await post('/auth/logout-all', a.token)).status).toBe(200);
    expect(kv.keysWithPrefix('user:')).toEqual(['user:u2']);
  });

  it('isUserInUse : session vivante, abonnement ancien, ou rien', async () => {
    const store = kv.asKV();
    expect(await isUserInUse(store, 'u1')).toBe(false);
    await kv.put('push:u1', JSON.stringify([{ endpoint: 'https://fcm.googleapis.com/fcm/send/x', keys: await makeKeys(), sessionHash: 'session-disparue' }]));
    expect(await isUserInUse(store, 'u1')).toBe(false); // abonnement d'une session disparue
    const { hash } = await createSession(store, 'u2', 'me@example.com');
    expect(await isUserInUse(store, 'u2')).toBe(true);
    await kv.put('push:u3', JSON.stringify([{ endpoint: 'https://fcm.googleapis.com/fcm/send/y', keys: await makeKeys(), sessionHash: hash }]));
    expect(await isUserInUse(store, 'u3')).toBe(true);
    await writeUser(store, 'u1', { email: 'me@example.com', refreshTokenEnc: 'x', updatedAt: 0 });
    expect(await releaseUserIfUnused(store, 'u1')).toBe(true);
    expect(kv.keysWithPrefix('user:')).toEqual([]);
  });
});

describe('tâche quotidienne : conservation', () => {
  it("efface un compte qui ne sert plus, sans appeler Google (compte d'avant la règle)", async () => {
    const f = googleOk();
    await seedUser('u1'); // aucune session, aucune notification, aucune durée de vie
    await runCron();
    expect(kv.keysWithPrefix('user:')).toEqual([]);
    expect(f).not.toHaveBeenCalled();
    expect(await kv.get('health:cron', 'json')).toMatchObject({ ok: true });
  });

  it('sans notification, constate un accès retiré chez Google et efface tout sauf la sauvegarde', async () => {
    const f = googleRefresh(400, { error: 'invalid_grant' });
    await createSession(kv.asKV(), 'u1', 'me@example.com');
    await seedUser('u1', { ttl: true });
    await kv.put('backup:u1:2026-10-01', '{}', { expirationTtl: 3600 });
    await runCron();
    expect(f).toHaveBeenCalledTimes(1);
    expect(String(f.mock.calls[0][0])).toBe('https://oauth2.googleapis.com/token');
    expect(kv.keysWithPrefix('user:')).toEqual([]);
    expect(kv.keysWithPrefix('session')).toEqual([]);
    expect(kv.keysWithPrefix('backup:')).toEqual(['backup:u1:2026-10-01']);
  });

  it('connexion en cours (compte écrit à l’instant, session pas encore visible) : rien n’est effacé', async () => {
    googleOk();
    await seedUser('u1', { ttl: true, touchedAt: NOW - 60_000 }); // écrit il y a une minute
    await seedUser('u2', { ttl: true, touchedAt: NOW - RECENT_WRITE_GRACE_MS - 1 }); // hors délai
    await runCron();
    expect(kv.keysWithPrefix('user:')).toEqual(['user:u1']);
    // Hors tâche quotidienne (déconnexion), pas de délai : la connexion crée sa session d'abord.
    expect(await releaseUserIfUnused(kv.asKV(), 'u1', NOW, { graceMs: RECENT_WRITE_GRACE_MS })).toBe(false);
    expect(await releaseUserIfUnused(kv.asKV(), 'u1', NOW)).toBe(true);
  });

  it('panne passagère de Google : rien n’est effacé, et la tâche reste en bonne santé', async () => {
    googleRefresh(500, { error: 'internal_failure' });
    await createSession(kv.asKV(), 'u1', 'me@example.com');
    await seedUser('u1', { ttl: true });
    await runCron();
    expect(kv.keysWithPrefix('user:')).toEqual(['user:u1']);
    expect(await kv.get('health:cron', 'json')).toMatchObject({ ok: true });
  });

  it("accès valide : le compte d'avant la règle reçoit une durée de vie", async () => {
    googleOk();
    await createSession(kv.asKV(), 'u1', 'me@example.com');
    await seedUser('u1');
    await runCron();
    expect(userExpiry()! - NOW).toBe(USER_TTL * 1000);
  });

  it('les comptes avec notifications ne sont vérifiés qu’une fois (par les rappels)', async () => {
    const f = googleRefresh(500, { error: 'internal_failure' });
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).startsWith('https://oauth2.googleapis.com/')) return f(url);
      return new Response('', { status: 201 }); // service de push
    }));
    const { token } = await createSession(kv.asKV(), 'u1', 'me@example.com');
    await post('/push/subscribe', token, { subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/d1', keys: await makeKeys() } });
    await seedUser('u1', { ttl: true });
    await runCron();
    expect(f).toHaveBeenCalledTimes(1);
    expect(kv.keysWithPrefix('user:')).toEqual(['user:u1']);
  });
});
