import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import worker, { Env, BACKUP_MAX_BYTES, BACKUP_PUTS_PER_DAY, BACKUP_DELETION_DELAY_MS } from '../src/index';
import { BACKUP_MAX_COPIES } from '../src/backupRetention';
import { makeKeys } from './kvFake';
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
    VAPID_PUBLIC_KEY: 'x', VAPID_PRIVATE_KEY: 'x', VAPID_SUBJECT: APP, APP_URL: APP, ALLOWED_EMAILS: 'me@example.com, x@example.com',
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

  it('conservation échelonnée : un envoi par jour pendant des semaines ne chasse pas les copies anciennes', async () => {
    const { token } = await createSession(kv.asKV(), 'u1', 'me@example.com');
    vi.useFakeTimers({ now: new Date('2026-06-01T10:00:00Z'), toFake: ['Date'] });
    // Une copie hebdomadaire de juin à août (les bonnes copies)…
    for (let i = 0; i < 13; i++) {
      vi.setSystemTime(new Date(Date.UTC(2026, 5, 1 + i * 7, 10)));
      expect((await put(token, blob({ createdAt: `bonne ${i}` }))).status).toBe(200);
    }
    // … puis 40 jours d'envois quotidiens (session volée qui envoie des copies illisibles).
    for (let i = 0; i < 40; i++) {
      vi.setSystemTime(new Date(Date.UTC(2026, 8, 1 + i, 10)));
      expect((await put(token, blob({ createdAt: `illisible ${i}` }))).status).toBe(200);
    }
    // Deux envois le même jour : le second remplace le premier.
    expect((await put(token, blob({ createdAt: 'dernière' }))).status).toBe(200);
    const { dates } = await (await call('/backup', { token })).json() as { dates: string[] };
    expect(dates.length).toBeLessThanOrEqual(BACKUP_MAX_COPIES);
    expect(dates[0]).toBe('2026-10-10');
    // Les premières copies de juin, juillet et août sont toujours là.
    expect(dates).toEqual(expect.arrayContaining(['2026-06-01', '2026-07-06', '2026-08-03']));
    expect(((await (await call('/backup/2026-06-01', { token })).json()) as any).createdAt).toBe('bonne 0');
    expect(((await (await call('/backup/2026-10-10', { token })).json()) as any).createdAt).toBe('dernière');
    expect(kv.keysWithPrefix('backup:u1:')).toHaveLength(dates.length);
  });

  it(`plafonne les envois à ${BACKUP_PUTS_PER_DAY} par jour et par compte`, async () => {
    const { token } = await createSession(kv.asKV(), 'u1', 'me@example.com');
    vi.useFakeTimers({ now: new Date('2026-10-07T10:00:00Z'), toFake: ['Date'] });
    for (let i = 0; i < BACKUP_PUTS_PER_DAY; i++) expect((await put(token, blob())).status).toBe(200);
    const refused = await put(token, blob());
    expect(refused.status).toBe(429);
    vi.setSystemTime(new Date('2026-10-08T10:00:00Z'));
    expect((await put(token, blob())).status).toBe(200);
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

  const runCron = async () => {
    let p: Promise<unknown> = Promise.resolve();
    await worker.scheduled({} as ScheduledEvent, env, { waitUntil: (x: Promise<unknown>) => { p = x; } } as ExecutionContext);
    await p;
  };
  const pushOk = () => {
    const sent: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).startsWith('https://fcm.googleapis.com/')) { sent.push(String(url)); return new Response('', { status: 201 }); }
      return new Response('', { status: 200 });
    }));
    return sent;
  };
  const withVapid = async () => {
    const vapid = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']) as CryptoKeyPair;
    const pub = new Uint8Array(await crypto.subtle.exportKey('raw', vapid.publicKey) as ArrayBuffer);
    env = { ...env, VAPID_PUBLIC_KEY: b64urlEncode(pub), VAPID_PRIVATE_KEY: (await crypto.subtle.exportKey('jwk', vapid.privateKey)).d! };
  };

  it('DELETE /backup programme l’effacement (7 jours), prévient les appareils, et la tâche quotidienne efface ensuite', async () => {
    await withVapid();
    const sent = pushOk();
    const { token, hash } = await createSession(kv.asKV(), 'u1', 'me@example.com');
    await kv.put('push:u1', JSON.stringify([{ endpoint: 'https://fcm.googleapis.com/fcm/send/autre', keys: await makeKeys(), sessionHash: hash }]));
    await seed();
    vi.useFakeTimers({ now: new Date('2026-10-07T10:00:00Z'), toFake: ['Date'] });
    const res = await call('/backup', { method: 'DELETE', token });
    expect(await res.json()).toEqual({ ok: true, scheduled: true, purgeAt: '2026-10-14T10:00:00.000Z', copies: 2 });
    expect(sent).toEqual(['https://fcm.googleapis.com/fcm/send/autre']);
    // Rien n'est encore effacé ; l'effacement prévu est visible.
    expect(kv.keysWithPrefix('backup:u1:')).toHaveLength(2);
    expect(await (await call('/backup', { token })).json()).toEqual({
      dates: ['2026-10-07', '2026-10-01'], deletion: { requestedAt: '2026-10-07T10:00:00.000Z', purgeAt: '2026-10-14T10:00:00.000Z', copies: 2 },
    });
    // Redemander sans nouvelle copie ne change pas la date et ne renvoie pas d'alerte.
    vi.setSystemTime(new Date('2026-10-07T11:00:00Z'));
    expect(await (await call('/backup', { method: 'DELETE', token })).json()).toEqual({ ok: true, scheduled: true, purgeAt: '2026-10-14T10:00:00.000Z', copies: 2 });
    expect(sent).toHaveLength(1);
    // Une copie envoyée ensuite (réactivation, autre appareil) n'est pas concernée, même si
    // elle remplace celle du jour de la demande.
    expect((await put(token, blob({ createdAt: 'nouvelle du 7' }))).status).toBe(200);
    expect(((await (await call('/backup', { token })).json()) as any).deletion.copies).toBe(1);
    vi.setSystemTime(new Date('2026-10-09T10:00:00Z'));
    expect((await put(token, blob({ createdAt: 'nouvelle du 9' }))).status).toBe(200);

    await runCron(); // avant l'échéance : rien
    expect(kv.keysWithPrefix('backup:u1:')).toEqual(['backup:u1:2026-10-01', 'backup:u1:2026-10-07', 'backup:u1:2026-10-09']);
    vi.setSystemTime(new Date(Date.parse('2026-10-07T10:00:00Z') + BACKUP_DELETION_DELAY_MS + 1000));
    await runCron();
    // Seule la copie d'avant la demande, jamais remplacée, est effacée.
    expect(kv.keysWithPrefix('backup:u1:')).toEqual(['backup:u1:2026-10-07', 'backup:u1:2026-10-09']);
    expect(kv.keysWithPrefix('backup:u11:')).toEqual(['backup:u11:2026-10-07']);
    expect(kv.keysWithPrefix('backup-deletion:')).toEqual([]);
  });

  it('une nouvelle demande ajoute les copies envoyées depuis la précédente, chacune avec son échéance, et prévient à nouveau', async () => {
    await withVapid();
    const sent = pushOk();
    const { token, hash } = await createSession(kv.asKV(), 'u1', 'me@example.com');
    await kv.put('push:u1', JSON.stringify([{ endpoint: 'https://fcm.googleapis.com/fcm/send/autre', keys: await makeKeys(), sessionHash: hash }]));
    await seed();
    vi.useFakeTimers({ now: new Date('2026-10-07T10:00:00Z'), toFake: ['Date'] });
    await call('/backup', { method: 'DELETE', token }); // copies du 1er et du 7, échéance le 14
    expect((await put(token, blob({ createdAt: 'nouvelle du 7' }))).status).toBe(200); // remplace celle du 7
    vi.setSystemTime(new Date('2026-10-09T10:00:00Z'));
    expect((await put(token, blob({ createdAt: 'du 9' }))).status).toBe(200);
    // Deuxième demande (réactivé avec un nouveau code, puis « Désactiver » ou « Supprimer mes
    // données serveur ») : les copies du 7 (nouvelle) et du 9 sont ajoutées, échéance le 16.
    expect(await (await call('/backup', { method: 'DELETE', token })).json()).toEqual({ ok: true, scheduled: true, purgeAt: '2026-10-16T10:00:00.000Z', copies: 3 });
    expect(sent).toHaveLength(2);
    vi.setSystemTime(new Date('2026-10-10T10:00:00Z'));
    expect((await put(token, blob({ createdAt: 'du 10, après la demande' }))).status).toBe(200);

    vi.setSystemTime(new Date('2026-10-14T10:00:01Z'));
    await runCron(); // première échéance : seule la copie du 1er part
    expect(kv.keysWithPrefix('backup:u1:')).toEqual(['backup:u1:2026-10-07', 'backup:u1:2026-10-09', 'backup:u1:2026-10-10']);
    expect(((await (await call('/backup', { token })).json()) as any).deletion).toEqual({ requestedAt: '2026-10-09T10:00:00.000Z', purgeAt: '2026-10-16T10:00:00.000Z', copies: 2 });
    vi.setSystemTime(new Date('2026-10-16T10:00:01Z'));
    await runCron(); // seconde échéance : aucune copie d'avant la seconde demande ne reste
    expect(kv.keysWithPrefix('backup:u1:')).toEqual(['backup:u1:2026-10-10']);
    expect(kv.keysWithPrefix('backup-deletion:')).toEqual([]);
  });

  it('l’effacement programmé s’annule (DELETE /backup/deletion), et les envois reprennent', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })));
    const { token } = await createSession(kv.asKV(), 'u1', 'me@example.com');
    await seed();
    await call('/backup', { method: 'DELETE', token });
    expect(await (await call('/backup/deletion', { method: 'DELETE', token })).json()).toEqual({ ok: true, cancelled: true });
    expect(await (await call('/backup/deletion', { method: 'DELETE', token })).json()).toEqual({ ok: true, cancelled: false });
    expect((await put(token, blob())).status).toBe(200);
    await runCron();
    expect(kv.keysWithPrefix('backup:u1:').length).toBeGreaterThanOrEqual(2);
    // Sans copie, rien n'est programmé.
    const other = await createSession(kv.asKV(), 'u2', 'x@example.com');
    expect(await (await call('/backup', { method: 'DELETE', token: other.token })).json()).toEqual({ ok: true, scheduled: false, copies: 0 });
  });

  it('POST /account/delete efface le reste tout de suite, mais seulement PROGRAMME l’effacement des copies', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 200 })));
    const { token } = await createSession(kv.asKV(), 'u1', 'me@example.com');
    await seed();
    const res = await call('/account/delete', { method: 'POST', token });
    expect(res.status).toBe(200);
    expect(typeof ((await res.json()) as any).backupsDeletionAt).toBe('string');
    expect(kv.keysWithPrefix('backup:u1:')).toHaveLength(2);
    expect(kv.keysWithPrefix('backup-deletion:')).toEqual(['backup-deletion:u1']);
    expect(kv.keysWithPrefix('user:')).toEqual([]);
    expect(kv.keysWithPrefix('session')).toEqual([]);
    // Reconnexion (nouvelle session) : l'effacement est visible et annulable.
    const again = await createSession(kv.asKV(), 'u1', 'me@example.com');
    expect(((await (await call('/backup', { token: again.token })).json()) as any).deletion).toBeDefined();
    expect(await (await call('/backup/deletion', { method: 'DELETE', token: again.token })).json()).toEqual({ ok: true, cancelled: true });
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
