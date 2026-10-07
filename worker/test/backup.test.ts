import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import worker, { Env, BACKUP_KEEP, BACKUP_MAX_BYTES } from '../src/index';
import { createSession } from '../src/sessions';
import { b64urlEncode, encryptString } from '../src/crypto';
import { MemoryKV } from './kvFake';

const APP = 'https://pecule-app.com/';
const ORIGIN = 'https://pecule-app.com';
const W = 'https://api.example.workers.dev';

let kv: MemoryKV;
let env: Env;

const call = (path: string, init: RequestInit & { token?: string } = {}) => {
  const headers = new Headers(init.headers);
  if (!headers.has('Origin')) headers.set('Origin', ORIGIN);
  if (init.token) headers.set('Authorization', `Bearer ${init.token}`);
  return worker.fetch(new Request(`${W}${path}`, { ...init, headers }), env);
};

const blob = (over: Record<string, unknown> = {}) => ({
  format: 'pecule-backup', v: 1, kdf: 'HKDF-SHA256', cipher: 'AES-256-GCM', zip: 'gzip',
  salt: 'c2FsdHNhbHRzYWx0c2FsdA', kcv: 'a2N2a2N2a2N2a2N2a2N2aw', iv: 'aXZpdml2aXZpdml2', ct: 'Y2lwaGVydGV4dA',
  createdAt: '2026-10-07T10:00:00.000Z', ...over,
});
const put = (token: string | undefined, body: unknown) =>
  call('/backup', { method: 'PUT', token, body: typeof body === 'string' ? body : JSON.stringify(body) });

beforeEach(async () => {
  kv = new MemoryKV();
  env = {
    STORE: kv.asKV(), GOOGLE_CLIENT_ID: 'client', GOOGLE_CLIENT_SECRET: 'secret',
    ENCRYPTION_KEY: b64urlEncode(crypto.getRandomValues(new Uint8Array(32))),
    VAPID_PUBLIC_KEY: 'x', VAPID_PRIVATE_KEY: 'x', VAPID_SUBJECT: APP, APP_URL: APP, ALLOWED_EMAILS: 'me@example.com',
  };
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('sauvegarde de secours : authentification', () => {
  it('toutes les routes exigent une session', async () => {
    expect((await put(undefined, blob())).status).toBe(401);
    expect((await call('/backup')).status).toBe(401);
    expect((await call('/backup/2026-10-07')).status).toBe(401);
    expect((await call('/backup', { method: 'DELETE' })).status).toBe(401);
    expect((await call('/backup', { token: 'jeton-inconnu-jeton-inconnu' })).status).toBe(401);
    expect(kv.keysWithPrefix('backup:')).toEqual([]);
  });

  it('rejette une origine inconnue avant toute lecture KV', async () => {
    env = { ...env, STORE: new Proxy({}, { get() { throw new Error('KV touché'); } }) as KVNamespace };
    const res = await worker.fetch(new Request(`${W}/backup`, { method: 'PUT', headers: { Origin: 'https://evil.example' }, body: '{}' }), env);
    expect(res.status).toBe(403);
  });

  it('autorise PUT et DELETE en CORS pour l’app', async () => {
    const res = await worker.fetch(new Request(`${W}/backup`, { method: 'OPTIONS', headers: { Origin: ORIGIN } }), env);
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('PUT');
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('DELETE');
  });

  it("un utilisateur ne voit pas les copies d'un autre", async () => {
    const a = await createSession(kv.asKV(), 'u1', 'me@example.com');
    const b = await createSession(kv.asKV(), 'u2', 'x@example.com');
    vi.useFakeTimers({ now: new Date('2026-10-07T10:00:00Z'), toFake: ['Date'] });
    expect((await put(a.token, blob())).status).toBe(200);
    expect(await (await call('/backup', { token: b.token })).json()).toEqual({ dates: [] });
    expect((await call('/backup/2026-10-07', { token: b.token })).status).toBe(404);
  });
});

describe('sauvegarde de secours : envoi et lecture', () => {
  it('stocke la copie du jour (date de Paris), la liste et la rend telle quelle', async () => {
    const { token } = await createSession(kv.asKV(), 'u1', 'me@example.com');
    vi.useFakeTimers({ now: new Date('2026-10-07T22:30:00Z'), toFake: ['Date'] }); // 00:30 à Paris le 8
    const res = await put(token, { ...blob(), extra: 'non stocké' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, date: '2026-10-08', dates: ['2026-10-08'] });
    expect(kv.keysWithPrefix('backup:')).toEqual(['backup:u1:2026-10-08']);
    expect(kv.data.get('backup:u1:2026-10-08')!.expiresAt! - Date.now()).toBe(365 * 86_400_000);

    expect(await (await call('/backup', { token })).json()).toEqual({ dates: ['2026-10-08'] });
    expect(await (await call('/backup/2026-10-08', { token })).json()).toEqual(blob());
    expect((await call('/backup/2026-10-09', { token })).status).toBe(404);
    expect((await call('/backup/..%2Fuser', { token })).status).toBe(404);
  });

  it('refuse une forme invalide (400) et un corps de plus de 2 Mo (413)', async () => {
    const { token } = await createSession(kv.asKV(), 'u1', 'me@example.com');
    expect((await put(token, 'pas du json')).status).toBe(400);
    expect((await put(token, blob({ format: 'autre' }))).status).toBe(400);
    expect((await put(token, blob({ ct: 'pas du base64 !' }))).status).toBe(400);
    expect((await put(token, blob({ iv: 12 }))).status).toBe(400);
    expect((await put(token, blob({ v: 0 }))).status).toBe(400);
    expect((await put(token, blob({ ct: 'A'.repeat(BACKUP_MAX_BYTES) }))).status).toBe(413);
    expect((await put(token, blob({ ct: 'A'.repeat(BACKUP_MAX_BYTES - 1000) }))).status).toBe(200);
    expect((await call('/backup/2026-10-07', { method: 'PUT', token })).status).toBe(405);
  });

  it(`garde les ${BACKUP_KEEP} copies les plus récentes, une par jour`, async () => {
    const { token } = await createSession(kv.asKV(), 'u1', 'me@example.com');
    vi.useFakeTimers({ now: new Date('2026-09-01T10:00:00Z'), toFake: ['Date'] });
    for (let i = 0; i < 10; i++) {
      vi.setSystemTime(new Date(Date.UTC(2026, 8, 1 + i * 7, 10)));
      expect((await put(token, blob({ createdAt: `copie ${i}` }))).status).toBe(200);
    }
    // Deux envois le même jour : le second remplace le premier.
    expect((await put(token, blob({ createdAt: 'dernière' }))).status).toBe(200);
    const { dates } = await (await call('/backup', { token })).json() as { dates: string[] };
    expect(dates).toHaveLength(BACKUP_KEEP);
    expect(dates[0]).toBe('2026-11-03');
    expect(dates.at(-1)).toBe('2026-09-15');
    expect(kv.keysWithPrefix('backup:u1:')).toHaveLength(BACKUP_KEEP);
    expect(((await (await call('/backup/2026-11-03', { token })).json()) as any).createdAt).toBe('dernière');
  });

  it('applique un limiteur par compte sur les envois', async () => {
    const { token } = await createSession(kv.asKV(), 'u1', 'me@example.com');
    const keys: string[] = [];
    env = { ...env, API_LIMITER: { limit: async ({ key }: { key: string }) => { keys.push(key); return { success: !key.startsWith('backup:') }; } } as RateLimit };
    const res = await put(token, blob());
    expect(res.status).toBe(429);
    expect(keys).toContain('backup:u1');
    expect(kv.keysWithPrefix('backup:')).toEqual([]);
  });
});

describe('sauvegarde de secours : suppression', () => {
  const seed = async () => {
    await kv.put('backup:u1:2026-10-01', JSON.stringify(blob()));
    await kv.put('backup:u1:2026-10-07', JSON.stringify(blob()));
    await kv.put('backup:u11:2026-10-07', JSON.stringify(blob())); // autre utilisateur au préfixe proche
    await kv.put('user:u1', JSON.stringify({ email: 'me@example.com', refreshTokenEnc: await encryptString('1//rt', env.ENCRYPTION_KEY), updatedAt: 0 }));
  };

  it('DELETE /backup efface toutes les copies du compte, pas celles des autres', async () => {
    const { token } = await createSession(kv.asKV(), 'u1', 'me@example.com');
    await seed();
    expect(await (await call('/backup', { method: 'DELETE', token })).json()).toEqual({ ok: true, deleted: 2 });
    expect(kv.keysWithPrefix('backup:')).toEqual(['backup:u11:2026-10-07']);
  });

  it('POST /account/delete efface aussi les copies de secours', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 200 })));
    const { token } = await createSession(kv.asKV(), 'u1', 'me@example.com');
    await seed();
    expect((await call('/account/delete', { method: 'POST', token })).status).toBe(200);
    expect(kv.keysWithPrefix('backup:')).toEqual(['backup:u11:2026-10-07']);
    expect(kv.keysWithPrefix('user:')).toEqual([]);
  });

  it('un accès Google révoqué (purge automatique) garde les copies chiffrées', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })));
    const { token } = await createSession(kv.asKV(), 'u1', 'me@example.com');
    await seed();
    expect((await call('/token', { method: 'POST', token })).status).toBe(401);
    expect(kv.keysWithPrefix('user:')).toEqual([]);
    expect(kv.keysWithPrefix('backup:u1:')).toEqual(['backup:u1:2026-10-01', 'backup:u1:2026-10-07']);
  });
});
