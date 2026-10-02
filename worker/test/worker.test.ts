import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import worker, { Env } from '../src/index';
import { createSession } from '../src/sessions';
import { b64urlEncode, encryptString, utf8 } from '../src/crypto';
import { MemoryKV, makeKeys } from './kvFake';

const APP = 'https://owner.github.io/suivi-epargne/';
const ORIGIN = 'https://owner.github.io';
const W = 'https://api.example.workers.dev';
const CLIENT = 'client-123.apps.googleusercontent.com';

const fakeJwt = (claims: object) =>
  `${b64urlEncode(utf8('{"alg":"RS256"}'))}.${b64urlEncode(utf8(JSON.stringify(claims)))}.sig`;

let kv: MemoryKV;
let env: Env;

const makeEnv = async (over: Partial<Env> = {}): Promise<Env> => {
  const vapid = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']) as CryptoKeyPair;
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', vapid.publicKey) as ArrayBuffer);
  return {
    STORE: kv.asKV(), GOOGLE_CLIENT_ID: CLIENT, GOOGLE_CLIENT_SECRET: 'secret',
    ENCRYPTION_KEY: b64urlEncode(crypto.getRandomValues(new Uint8Array(32))),
    VAPID_PUBLIC_KEY: b64urlEncode(pub), VAPID_PRIVATE_KEY: (await crypto.subtle.exportKey('jwk', vapid.privateKey)).d!,
    VAPID_SUBJECT: APP, APP_URL: APP, ALLOWED_EMAILS: 'me@example.com',
    ...over,
  };
};

const call = (path: string, init: RequestInit & { token?: string } = {}) => {
  const headers = new Headers(init.headers);
  if (!headers.has('Origin')) headers.set('Origin', ORIGIN);
  if (init.token) headers.set('Authorization', `Bearer ${init.token}`);
  return worker.fetch(new Request(`${W}${path}`, { ...init, headers }), env);
};
const post = (path: string, token?: string, body?: unknown) =>
  call(path, { method: 'POST', token, body: body === undefined ? undefined : JSON.stringify(body) });

const subscription = async (i: number) => ({ endpoint: `https://fcm.googleapis.com/fcm/send/device-${i}`, keys: await makeKeys() });

beforeEach(async () => { kv = new MemoryKV(); env = await makeEnv(); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('connexion OAuth', () => {
  const googleToken = (claims: object) => vi.fn(async (url: string) => {
    if (String(url).startsWith('https://oauth2.googleapis.com/token')) {
      return new Response(JSON.stringify({
        access_token: 'ya29.access', expires_in: 3599, refresh_token: '1//refresh',
        scope: 'openid email https://www.googleapis.com/auth/drive.file', id_token: fakeJwt(claims),
      }), { status: 200 });
    }
    return new Response('', { status: 200 }); // révocation
  });
  const goodClaims = { sub: 'g-42', email: 'me@example.com', email_verified: true, aud: CLIENT, iss: 'https://accounts.google.com', exp: 4_000_000_000 };

  const start = async () => {
    const res = await worker.fetch(new Request(`${W}/auth/start?return=${encodeURIComponent(APP)}`), env);
    expect(res.status).toBe(302);
    const state = new URL(res.headers.get('Location')!).searchParams.get('state')!;
    const cookie = res.headers.get('Set-Cookie')!;
    return { state, cookie };
  };

  it("n'écrit rien en KV au démarrage, et pose un cookie __Host- lié au state", async () => {
    const { cookie } = await start();
    expect(kv.writes).toBe(0);
    expect(cookie).toMatch(/^__Host-pecule_oauth=[A-Za-z0-9_-]+; Path=\/; Max-Age=600; HttpOnly; Secure; SameSite=Lax$/);
  });

  it("va jusqu'au bout, puis l'échange rend {session, access_token, expires_in} une seule fois", async () => {
    vi.stubGlobal('fetch', googleToken(goodClaims));
    const { state, cookie } = await start();
    const cb = await worker.fetch(new Request(`${W}/auth/callback?state=${state}&code=abc`, {
      headers: { Cookie: cookie.split(';')[0] },
    }), env);
    expect(cb.status).toBe(302);
    expect(cb.headers.get('Set-Cookie')).toContain('Max-Age=0');
    const loc = cb.headers.get('Location')!;
    expect(loc.startsWith(`${APP}#login_code=`)).toBe(true);
    const code = loc.split('#login_code=')[1];

    // Le code n'est stocké que haché, et son contenu chiffré.
    const codeKeys = kv.keysWithPrefix('code:');
    expect(codeKeys).toHaveLength(1);
    expect(codeKeys[0]).not.toContain(code);
    expect(kv.data.get(codeKeys[0])!.value).not.toContain('ya29');
    expect(kv.data.get(codeKeys[0])!.expiresAt! - Date.now()).toBeLessThanOrEqual(60_000);

    const ex = await post('/auth/exchange', undefined, { code });
    expect(ex.status).toBe(200);
    const body = await ex.json() as any;
    expect(Object.keys(body).sort()).toEqual(['access_token', 'expires_in', 'session']);
    expect(body.access_token).toBe('ya29.access');
    expect(kv.keysWithPrefix('code:')).toEqual([]);
    expect((await post('/auth/exchange', undefined, { code })).status).toBe(400);
    expect(kv.keysWithPrefix('sessions:')).toEqual(['sessions:g-42']);
  });

  it('refuse un callback sans le cookie du navigateur qui a lancé la connexion', async () => {
    vi.stubGlobal('fetch', googleToken(goodClaims));
    const { state } = await start();
    const cb = await worker.fetch(new Request(`${W}/auth/callback?state=${state}&code=abc`), env);
    expect(cb.status).toBe(400);
    const other = await worker.fetch(new Request(`${W}/auth/callback?state=${state}&code=abc`, { headers: { Cookie: '__Host-pecule_oauth=autre' } }), env);
    expect(other.status).toBe(400);
    expect(kv.keysWithPrefix('session:')).toEqual([]);
  });

  it("refuse un id_token émis pour un autre client, et révoque le jeton reçu", async () => {
    const f = googleToken({ ...goodClaims, aud: 'autre-client' });
    vi.stubGlobal('fetch', f);
    const { state, cookie } = await start();
    const cb = await worker.fetch(new Request(`${W}/auth/callback?state=${state}&code=abc`, { headers: { Cookie: cookie.split(';')[0] } }), env);
    expect(cb.status).toBe(502);
    expect(f.mock.calls.some(c => String(c[0]).includes('/revoke'))).toBe(true);
    expect(kv.keysWithPrefix('user:')).toEqual([]);
  });

  it("garde la liste blanche d'e-mails", async () => {
    vi.stubGlobal('fetch', googleToken({ ...goodClaims, email: 'intrus@example.com' }));
    const { state, cookie } = await start();
    const cb = await worker.fetch(new Request(`${W}/auth/callback?state=${state}&code=abc`, { headers: { Cookie: cookie.split(';')[0] } }), env);
    expect(cb.status).toBe(403);
  });

  it("ne renvoie que vers l'app (préfixe de chemin compris)", async () => {
    const res = await worker.fetch(new Request(`${W}/auth/start?return=${encodeURIComponent('https://owner.github.io/autre/')}`), env);
    const state = new URL(res.headers.get('Location')!).searchParams.get('state')!;
    const payload = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(state.split('.')[0].replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))));
    expect(payload.returnUrl).toBe(APP);
  });
});

describe('garde-fous HTTP', () => {
  it("rejette une origine inconnue avant toute lecture KV", async () => {
    env = { ...env, STORE: new Proxy({}, { get() { throw new Error('KV touché'); } }) as KVNamespace };
    for (const path of ['/token', '/auth/exchange', '/push/subscribe', '/auth/logout-all', '/account/delete']) {
      const res = await worker.fetch(new Request(`${W}${path}`, { method: 'POST', headers: { Origin: 'https://evil.example' } }), env);
      expect(res.status).toBe(403);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
    }
  });

  it("refuse localhost en production", async () => {
    const res = await worker.fetch(new Request(`${W}/token`, { method: 'POST', headers: { Origin: 'http://localhost:5173' } }), env);
    expect(res.status).toBe(403);
  });

  it('répond 429 quand le limiteur refuse', async () => {
    const seen: string[] = [];
    env = { ...env, API_LIMITER: { limit: async ({ key }: { key: string }) => { seen.push(key); return { success: false }; } } as RateLimit };
    const res = await worker.fetch(new Request(`${W}/token`, { method: 'POST', headers: { Origin: ORIGIN, 'CF-Connecting-IP': '203.0.113.7' } }), env);
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('60');
    expect(seen).toEqual(['203.0.113.7']);
  });

  it('utilise le limiteur /auth pour les routes /auth/*', async () => {
    const auth = vi.fn(async () => ({ success: false }));
    const api = vi.fn(async () => ({ success: true }));
    env = { ...env, AUTH_LIMITER: { limit: auth } as RateLimit, API_LIMITER: { limit: api } as RateLimit };
    expect((await worker.fetch(new Request(`${W}/auth/start`), env)).status).toBe(429);
    expect(auth).toHaveBeenCalledTimes(1);
    expect(api).not.toHaveBeenCalled();
  });

  it('refuse un corps de plus de 4 Ko', async () => {
    const { token } = await createSession(kv.asKV(), 'u1', 'me@example.com');
    const res = await post('/push/subscribe', token, { subscription: { endpoint: 'https://fcm.googleapis.com/' + 'a'.repeat(5000) } });
    expect(res.status).toBe(413);
  });
});

describe('déconnexions', () => {
  it('logout-all supprime toutes les sessions et abonnements de l’utilisateur, pas ceux des autres', async () => {
    const a = await createSession(kv.asKV(), 'u1', 'me@example.com');
    const b = await createSession(kv.asKV(), 'u1', 'me@example.com');
    const other = await createSession(kv.asKV(), 'u2', 'x@example.com');
    expect((await post('/push/subscribe', b.token, { subscription: await subscription(1) })).status).toBe(200);
    expect((await post('/push/subscribe', other.token, { subscription: await subscription(2) })).status).toBe(200);

    const res = await post('/auth/logout-all', a.token);
    expect(await res.json()).toEqual({ ok: true, sessionsRevoked: 2 });
    expect((await post('/token', b.token)).status).toBe(401);
    expect(kv.keysWithPrefix('session:')).toEqual([`session:${other.hash}`]);
    expect(kv.keysWithPrefix('push:')).toEqual(['push:u2']);
    expect(kv.keysWithPrefix('sessions:')).toEqual(['sessions:u2']);
  });

  it('logout-all exige une session', async () => {
    expect((await post('/auth/logout-all')).status).toBe(401);
  });

  it("logout retire les abonnements créés par cette session seulement", async () => {
    const a = await createSession(kv.asKV(), 'u1', 'me@example.com');
    const b = await createSession(kv.asKV(), 'u1', 'me@example.com');
    await post('/push/subscribe', a.token, { subscription: await subscription(1) });
    await post('/push/subscribe', b.token, { subscription: await subscription(2) });
    await post('/auth/logout', a.token);
    const list = await kv.get('push:u1', 'json');
    expect(list.map((x: any) => x.endpoint)).toEqual(['https://fcm.googleapis.com/fcm/send/device-2']);
    expect(await kv.get('sessions:u1', 'json')).toEqual([b.hash]);
  });
});

describe('appareils', () => {
  it('liste, signale le courant, et retire par id ou par endpoint', async () => {
    const a = await createSession(kv.asKV(), 'u1', 'me@example.com');
    const b = await createSession(kv.asKV(), 'u1', 'me@example.com');
    await post('/push/subscribe', a.token, { subscription: await subscription(1) });
    await post('/push/subscribe', b.token, { subscription: await subscription(2) });
    const res = await call('/push/devices', { token: a.token });
    const { devices } = await res.json() as any;
    expect(devices).toHaveLength(2);
    expect(devices.map((d: any) => [d.host, d.current])).toEqual([['fcm.googleapis.com', true], ['fcm.googleapis.com', false]]);
    expect(typeof devices[0].createdAt).toBe('string');

    expect(await (await post('/push/remove', a.token, { id: devices[1].id })).json()).toEqual({ ok: true, removed: true, devices: 1 });
    expect(await (await post('/push/remove', a.token, { endpoint: 'https://fcm.googleapis.com/fcm/send/device-1' })).json()).toEqual({ ok: true, removed: true, devices: 0 });
    expect(kv.keysWithPrefix('push:')).toEqual([]);
    expect((await post('/push/remove', a.token, {})).status).toBe(400);
  });

  it('refuse un hôte de push inconnu, et stocke un objet reconstruit', async () => {
    const { token, hash } = await createSession(kv.asKV(), 'u1', 'me@example.com');
    const keys = await makeKeys();
    expect((await post('/push/subscribe', token, { subscription: { endpoint: 'https://evil.example/x', keys } })).status).toBe(400);
    await post('/push/subscribe', token, { subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/z', keys, extra: 'x', expirationTime: null } });
    const [stored] = await kv.get('push:u1', 'json');
    expect(Object.keys(stored).sort()).toEqual(['createdAt', 'endpoint', 'keys', 'sessionHash']);
    expect(stored.sessionHash).toBe(hash);
  });

  it(`plafonne à 10 appareils (409), en ignorant ceux des sessions disparues`, async () => {
    const { token } = await createSession(kv.asKV(), 'u1', 'me@example.com');
    for (let i = 0; i < 10; i++) expect((await post('/push/subscribe', token, { subscription: await subscription(i) })).status).toBe(200);
    const res = await post('/push/subscribe', token, { subscription: await subscription(10) });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'TOO_MANY_DEVICES' });
    // Un abonnement orphelin (session expirée) ne compte plus.
    const list = await kv.get('push:u1', 'json');
    list[0].sessionHash = 'session-disparue';
    await kv.put('push:u1', JSON.stringify(list));
    expect((await post('/push/subscribe', token, { subscription: await subscription(10) })).status).toBe(200);
  });

  it("rattache un ancien abonnement sans session au prochain qui réabonne l'endpoint", async () => {
    const sub = await subscription(1);
    await kv.put('push:u1', JSON.stringify([sub]));
    const { token, hash } = await createSession(kv.asKV(), 'u1', 'me@example.com');
    await post('/push/subscribe', token, { subscription: sub });
    const list = await kv.get('push:u1', 'json');
    expect(list).toHaveLength(1);
    expect(list[0].sessionHash).toBe(hash);
  });
});

describe('suppression des données serveur', () => {
  const seed = async () => {
    await kv.put('user:u1', JSON.stringify({ email: 'me@example.com', refreshTokenEnc: await encryptString('1//rt', env.ENCRYPTION_KEY), updatedAt: 0 }));
    await kv.put('push:u1', JSON.stringify([await subscription(1)]));
    await kv.put('sent:u1:recap:2026-09', '1', { expirationTtl: 3600 });
    await kv.put('sent:u11:recap:2026-09', '1', { expirationTtl: 3600 }); // autre utilisateur au préfixe proche
  };

  it('POST /account/delete efface tout et révoque le refresh token chez Google', async () => {
    const f = vi.fn(async () => new Response('', { status: 200 }));
    vi.stubGlobal('fetch', f);
    const a = await createSession(kv.asKV(), 'u1', 'me@example.com');
    await createSession(kv.asKV(), 'u1', 'me@example.com');
    await seed();
    const res = await post('/account/delete', a.token);
    expect(await res.json()).toEqual({ ok: true, googleRevoked: true });
    expect(String((f.mock.calls[0] as any[])[0])).toBe('https://oauth2.googleapis.com/revoke');
    expect(String(((f.mock.calls[0] as any[])[1] as RequestInit).body)).toBe('token=1%2F%2Frt');
    expect([...kv.data.keys()].sort()).toEqual(['sent:u11:recap:2026-09']);
  });

  it('/token sur invalid_grant efface tout ce que le serveur sait du compte', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })));
    const a = await createSession(kv.asKV(), 'u1', 'me@example.com');
    await createSession(kv.asKV(), 'u1', 'me@example.com');
    await seed();
    expect((await post('/token', a.token)).status).toBe(401);
    expect([...kv.data.keys()].sort()).toEqual(['sent:u11:recap:2026-09']);
  });
});

describe('tâche quotidienne', () => {
  const runCron = async () => {
    let p: Promise<unknown> = Promise.resolve();
    await worker.scheduled({} as ScheduledEvent, env, { waitUntil: (x: Promise<unknown>) => { p = x; } } as ExecutionContext);
    await p;
  };

  it("purge un compte dont l'accès Google est révoqué, et écrit l'état de santé", async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })));
    const { token } = await createSession(kv.asKV(), 'u1', 'me@example.com');
    await post('/push/subscribe', token, { subscription: await subscription(1) });
    await kv.put('user:u1', JSON.stringify({ email: 'me@example.com', refreshTokenEnc: await encryptString('1//rt', env.ENCRYPTION_KEY), updatedAt: 0 }));
    await kv.put('sent:u1:x', '1', { expirationTtl: 3600 });
    await runCron();
    expect(kv.keysWithPrefix('user:')).toEqual([]);
    expect(kv.keysWithPrefix('session')).toEqual([]);
    expect(kv.keysWithPrefix('sent:')).toEqual([]);
    expect(kv.keysWithPrefix('push:')).toEqual([]);
    const health = await kv.get('health:cron', 'json');
    expect(health).toMatchObject({ ok: true, usersProcessed: 1 });
    expect(typeof health.lastRunAt).toBe('string');
  });

  it('autre échec Google : prévient de se reconnecter, au plus une fois tous les 3 jours, et retire les abonnements orphelins', async () => {
    const pushes: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).startsWith('https://oauth2.googleapis.com/')) return new Response(JSON.stringify({ error: 'internal_failure' }), { status: 500 });
      pushes.push(String(url));
      return new Response('', { status: 201 });
    }));
    const { token } = await createSession(kv.asKV(), 'u1', 'me@example.com');
    await post('/push/subscribe', token, { subscription: await subscription(1) });
    const list = await kv.get('push:u1', 'json');
    const legacy = await subscription(2);                                            // ancien, sans session : gardé
    const orphan = { ...(await subscription(3)), sessionHash: 'session-disparue' }; // session disparue : retiré
    await kv.put('push:u1', JSON.stringify([...list, legacy, orphan]));
    await kv.put('user:u1', JSON.stringify({ email: 'me@example.com', refreshTokenEnc: await encryptString('1//rt', env.ENCRYPTION_KEY), updatedAt: 0 }));

    await runCron();
    expect(pushes.sort()).toEqual([list[0].endpoint, legacy.endpoint].sort());
    expect((await kv.get('push:u1', 'json')).map((x: any) => x.endpoint)).toEqual([list[0].endpoint, legacy.endpoint]);
    expect(kv.data.get('sent:u1:reconnect')!.expiresAt! - Date.now()).toBeLessThanOrEqual(3 * 86_400_000);

    await runCron(); // le lendemain, rien de plus
    expect(pushes).toHaveLength(2);
    expect(kv.keysWithPrefix('user:')).toEqual(['user:u1']); // pas de purge sur une erreur passagère
  });

  it("GET /health exige une session et rend le dernier passage", async () => {
    expect((await call('/health')).status).toBe(401);
    const { token } = await createSession(kv.asKV(), 'u1', 'me@example.com');
    expect(await (await call('/health', { token })).json()).toEqual({ lastRunAt: null, ok: null, usersProcessed: 0 });
    await kv.put('health:cron', JSON.stringify({ lastRunAt: '2026-10-02T07:00:00.000Z', ok: true, usersProcessed: 1 }));
    expect(await (await call('/health', { token })).json()).toEqual({ lastRunAt: '2026-10-02T07:00:00.000Z', ok: true, usersProcessed: 1 });
  });
});
