// Serveur : envois de notifications suivis dans /status, clé de chiffrement remplaçable, liste
// des appareils auto-réparée, en-têtes de sécurité, écritures plafonnées par compte.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { PushMessage } from '../src/webpush';

// Notifications capturées en clair ; le code HTTP du service push se pilote par endpoint.
const push = vi.hoisted(() => ({ sent: [] as string[], status: 201, byEndpoint: {} as Record<string, number> }));
vi.mock('../src/webpush', async importOriginal => ({
  ...(await importOriginal<typeof import('../src/webpush')>()),
  sendPush: async (sub: { endpoint: string }, _message: PushMessage) => {
    push.sent.push(sub.endpoint);
    return push.byEndpoint[sub.endpoint] ?? push.status;
  },
}));

import worker, { Env } from '../src/index';
import { createSession, loadSession, readSessionIndex, deleteAllSessions } from '../src/sessions';
import { b64urlEncode, encryptString, decryptString, decryptWithFallback, DecryptError } from '../src/crypto';
import { CronErrors, appendCronLog, readCronLog } from '../src/cronLog';
import { MemoryKV, makeKeys } from './kvFake';
import { AccountType } from '../../src/types';

const APP = 'https://pecule-app.com/';
const ORIGIN = 'https://pecule-app.com';
const W = 'https://api.example.workers.dev';
const newKey = () => b64urlEncode(crypto.getRandomValues(new Uint8Array(32)));
const endpoint = (name: string) => `https://fcm.googleapis.com/fcm/send/${name}`;

let kv: MemoryKV;
let env: Env;

const call = (path: string, token?: string, init: RequestInit = {}) => worker.fetch(new Request(`${W}${path}`, {
  ...init, headers: { Origin: ORIGIN, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
}), env);
const post = (path: string, token: string, body: unknown = {}) => call(path, token, { method: 'POST', body: JSON.stringify(body) });

const seedUser = async (refreshToken: string, key = env.ENCRYPTION_KEY) => kv.put('user:u1', JSON.stringify({
  email: 'me@example.com', refreshTokenEnc: await encryptString(refreshToken, key), updatedAt: 0, touchedAt: 0,
}));

let refreshSeen: string[];
let files: { id: string; modifiedTime: string; content: unknown }[];
const fakeGoogle = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.startsWith('https://oauth2.googleapis.com/token')) {
    refreshSeen.push(new URLSearchParams(String(init?.body)).get('refresh_token') ?? '');
    return new Response(JSON.stringify({ access_token: 'ya29.fresh', expires_in: 3599 }), { status: 200 });
  }
  if (url.startsWith('https://www.googleapis.com/drive/v3/files?')) {
    return new Response(JSON.stringify({ files: files.map(f => ({ id: f.id, modifiedTime: f.modifiedTime })) }), { status: 200 });
  }
  const m = url.match(/^https:\/\/www\.googleapis\.com\/drive\/v3\/files\/([^?]+)\?alt=media$/);
  if (m) return new Response(JSON.stringify(files.find(x => x.id === m[1])?.content), { status: 200 });
  throw new Error(`requête inattendue ${url}`);
});

beforeEach(async () => {
  kv = new MemoryKV();
  const vapid = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']) as CryptoKeyPair;
  env = {
    STORE: kv.asKV(), GOOGLE_CLIENT_ID: 'client', GOOGLE_CLIENT_SECRET: 'secret', ENCRYPTION_KEY: newKey(),
    VAPID_PUBLIC_KEY: b64urlEncode(new Uint8Array(await crypto.subtle.exportKey('raw', vapid.publicKey) as ArrayBuffer)),
    VAPID_PRIVATE_KEY: (await crypto.subtle.exportKey('jwk', vapid.privateKey)).d!,
    VAPID_SUBJECT: APP, APP_URL: APP, ALLOWED_EMAILS: 'me@example.com',
  };
  refreshSeen = []; files = [];
  push.sent = []; push.status = 201; push.byEndpoint = {};
  vi.stubGlobal('fetch', fakeGoogle);
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks(); fakeGoogle.mockClear(); });

const runCron = async () => {
  let p: Promise<unknown> = Promise.resolve();
  await worker.scheduled({ cron: '0 7 * * *' } as ScheduledEvent, env, { waitUntil: (x: Promise<unknown>) => { p = x; } } as ExecutionContext);
  await p;
};

// ---------- 1. Envois de notifications suivis ----------

describe('envois de notifications dans /status', () => {
  const livret = {
    id: 'la', name: 'Livret A', type: AccountType.LIVRET_A, institution: 'B', totalAmount: 1000, ownedAmount: 1000,
    parentalCapital: 0, interestRate: 3, balanceCheckedAt: '2026-09-20',
    movements: [{ id: 'm', date: '2026-09-20', amount: 10, label: 'x', type: 'IN' as const }],
  };
  const dataFile = {
    accounts: [livret], expenses: [], history: [],
    recurringMovements: [{ id: 'r1', accountId: 'la', amount: 200, type: 'IN', label: 'Épargne auto', dayOfMonth: 5, active: true }],
    config: { grossAnnual: 0, leisureBudget: 0, projectSavings: 0, taxRateManual: 0, extraMonthlyIncome: 0 },
  };
  const status = async () => (await call('/status')).json() as Promise<{
    notifications: { attempted: number; delivered: number; failed: number } | null;
    history: { cron: string; ok: boolean; errors?: string[]; notifications?: { failed: number } }[];
  }>;
  const subscribe = async (...names: string[]) => kv.put('push:u1', JSON.stringify(
    await Promise.all(names.map(async n => ({ endpoint: endpoint(n), keys: await makeKeys() })))));

  beforeEach(async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-28T07:00:00Z'));
    await seedUser('1//rt');
    files = [{ id: 'f1', modifiedTime: '2026-09-27T10:00:00Z', content: dataFile }];
  });

  // Autant d'envois que de rappels dus × appareils : on compare au nombre réellement parti.
  const sentTo = (name: string) => push.sent.filter(e => e === endpoint(name)).length;

  it('tout est reçu : envois tentés et réussis comptés, aucun échec', async () => {
    await subscribe('a', 'b');
    await runCron();
    const s = await status();
    expect(push.sent.length).toBeGreaterThan(0);
    expect(s.notifications).toEqual({ attempted: push.sent.length, delivered: push.sent.length, failed: 0 });
    expect(s.history[0]).toMatchObject({ cron: 'daily', ok: true, notifications: s.notifications });
  });

  it('un envoi refusé est compté en « notification » sans faire échouer la tâche', async () => {
    await subscribe('a', 'b');
    push.byEndpoint[endpoint('b')] = 500;
    await runCron();
    const s = await status();
    expect(sentTo('b')).toBeGreaterThan(0);
    expect(s.notifications).toEqual({ attempted: push.sent.length, delivered: sentTo('a'), failed: sentTo('b') });
    expect(s.history[0]).toMatchObject({ cron: 'daily', ok: true, errors: ['notification'] });
    expect(await kv.get('health:cron', 'json')).toMatchObject({ ok: true });
  });

  it('tous les envois refusés : le bilan le montre (la surveillance alerte)', async () => {
    await subscribe('a', 'b');
    push.status = 403;
    await runCron();
    expect(push.sent.length).toBeGreaterThan(0);
    expect((await status()).notifications).toEqual({ attempted: push.sent.length, delivered: 0, failed: push.sent.length });
  });

  it('un appareil disparu (410) n’est ni un envoi réussi ni un échec', async () => {
    await subscribe('a', 'b');
    push.byEndpoint[endpoint('b')] = 410;
    await runCron();
    const n = (await status()).notifications!;
    expect(n.failed).toBe(0);
    expect(n.delivered).toBe(sentTo('a'));
    expect(n.attempted).toBeGreaterThan(n.delivered);
  });

  it('avant tout passage : pas de bilan', async () => {
    expect((await status()).notifications).toBeNull();
  });

  it('CronErrors : les échecs d’envoi ne comptent pas parmi les erreurs de la tâche', () => {
    const errors = new CronErrors();
    errors.addNotifications({ attempted: 3, delivered: 3, failed: 0 });
    expect(errors.categories).toEqual([]);
    errors.addNotifications({ attempted: 2, delivered: 1, failed: 1 });
    expect(errors.notifications).toEqual({ attempted: 5, delivered: 4, failed: 1 });
    expect(errors.categories).toEqual(['notification']);
    expect(errors.count).toBe(0);
  });

  it('l’historique garde le bilan de chaque passage quotidien (3 passages de suite visibles)', async () => {
    for (let i = 1; i <= 4; i++) {
      await appendCronLog(kv.asKV(), {
        at: `2026-10-0${i}T07:00:00.000Z`, cron: 'daily', ok: true, errors: ['notification'],
        notifications: { attempted: 2, delivered: 1, failed: 1 },
      });
    }
    const log = await readCronLog(kv.asKV());
    expect(log.slice(0, 3).every(e => e.notifications?.failed === 1 && e.errors?.[0] === 'notification')).toBe(true);
  });
});

// ---------- 2. Clé de chiffrement remplaçable ----------

describe('ENCRYPTION_KEY_PREVIOUS', () => {
  it('decryptWithFallback : clé courante, sinon ancienne, sinon DecryptError', async () => {
    const [a, b, c] = [newKey(), newKey(), newKey()];
    const sealed = await encryptString('secret', a);
    expect(await decryptWithFallback(sealed, a, b)).toEqual({ plaintext: 'secret', usedPrevious: false });
    expect(await decryptWithFallback(sealed, b, a)).toEqual({ plaintext: 'secret', usedPrevious: true });
    await expect(decryptWithFallback(sealed, b, c)).rejects.toBeInstanceOf(DecryptError);
    await expect(decryptWithFallback(sealed, b)).rejects.toBeInstanceOf(DecryptError);
    await expect(decryptWithFallback('court', a, b)).rejects.toBeInstanceOf(DecryptError);
    // Une clé mal formée est une erreur de configuration, pas un jeton perdu.
    await expect(decryptWithFallback(sealed, 'trop-courte', a)).rejects.not.toBeInstanceOf(DecryptError);
  });

  it('jeton chiffré avec l’ancienne clé : /token répond, puis le jeton est réécrit avec la clé courante', async () => {
    const old = newKey();
    const { token } = await createSession(kv.asKV(), 'u1', 'me@example.com');
    await seedUser('1//rt-old-key', old);
    env.ENCRYPTION_KEY_PREVIOUS = old;
    const res = await post('/token', token);
    expect(res.status).toBe(200);
    expect(refreshSeen).toEqual(['1//rt-old-key']);
    const stored = (await kv.get('user:u1', 'json')).refreshTokenEnc as string;
    expect(await decryptString(stored, env.ENCRYPTION_KEY)).toBe('1//rt-old-key');
    // L'ancienne clé peut maintenant être retirée.
    delete env.ENCRYPTION_KEY_PREVIOUS;
    expect((await post('/token', token)).status).toBe(200);
  });

  it('jeton illisible avec les deux clés : comptes effacés et 401 REAUTH_REQUIRED, pas 502', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { token } = await createSession(kv.asKV(), 'u1', 'me@example.com');
    await seedUser('1//rt', newKey());
    await kv.put('push:u1', JSON.stringify([{ endpoint: endpoint('a'), keys: await makeKeys() }]));
    env.ENCRYPTION_KEY_PREVIOUS = newKey();
    const res = await post('/token', token);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'REAUTH_REQUIRED' });
    expect(kv.keysWithPrefix('user:')).toEqual([]);
    expect(kv.keysWithPrefix('session:')).toEqual([]);
    expect(kv.keysWithPrefix('push:')).toEqual([]);
    expect(refreshSeen).toEqual([]);
  });

  it('sans ancienne clé et clé changée : même réponse (reconnexion demandée)', async () => {
    const { token } = await createSession(kv.asKV(), 'u1', 'me@example.com');
    await seedUser('1//rt', newKey());
    expect((await post('/token', token)).status).toBe(401);
  });

  it('la tournée quotidienne efface aussi un compte illisible, sans erreur de tâche', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.useFakeTimers({ toFake: ['Date'] });
    await seedUser('1//rt', newKey());
    await kv.put('push:u1', JSON.stringify([{ endpoint: endpoint('a'), keys: await makeKeys() }]));
    await runCron();
    expect(kv.keysWithPrefix('user:')).toEqual([]);
    expect(kv.keysWithPrefix('push:')).toEqual([]);
    expect(await kv.get('health:cron', 'json')).toMatchObject({ ok: true });
  });
});

// ---------- 3. Liste des appareils auto-réparée ----------

describe('index des sessions auto-réparé', () => {
  it('une session valide absente de la liste y est remise à la requête suivante', async () => {
    const a = await createSession(kv.asKV(), 'u1', 'me@example.com');
    const b = await createSession(kv.asKV(), 'u1', 'me@example.com');
    // Perte simulée : deux connexions simultanées ont réécrit la liste sans b.
    await kv.put('sessions:u1', JSON.stringify([a.hash]));
    expect(await readSessionIndex(kv.asKV(), 'u1')).toEqual([a.hash]);

    await seedUser('1//rt');
    expect((await post('/token', b.token)).status).toBe(200);
    expect((await kv.get('sessions:u1', 'json')).sort()).toEqual([a.hash, b.hash].sort());
    const res = await call('/auth/sessions', a.token);
    expect(((await res.json()) as { sessions: unknown[] }).sessions).toHaveLength(2);
  });

  it('« Déconnecter tous les appareils » n’en rate plus après réparation', async () => {
    const a = await createSession(kv.asKV(), 'u1', 'me@example.com');
    const b = await createSession(kv.asKV(), 'u1', 'me@example.com');
    await kv.put('sessions:u1', JSON.stringify([a.hash]));
    await loadSession(kv.asKV(), b.hash);
    expect(await deleteAllSessions(kv.asKV(), 'u1', a.hash)).toBe(2);
    expect(kv.keysWithPrefix('session:')).toEqual([]);
  });

  it('aucune écriture KV quand la session figure déjà dans la liste', async () => {
    const a = await createSession(kv.asKV(), 'u1', 'me@example.com');
    const writes = kv.writes;
    for (let i = 0; i < 3; i++) expect(await loadSession(kv.asKV(), a.hash)).not.toBeNull();
    expect(kv.writes).toBe(writes);
  });
});

// ---------- 4. En-têtes ----------

describe('en-têtes de sécurité', () => {
  it('les réponses JSON portent nosniff', async () => {
    const res = await call('/status');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect((await call('/inconnu')).headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('les pages HTML portent nosniff, une CSP sans script, et aucun Referer', async () => {
    const res = await worker.fetch(new Request(`${W}/auth/callback`), env);
    expect(res.headers.get('Content-Type')).toContain('text/html');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Content-Security-Policy')).toBe("default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'");
    expect(res.headers.get('Referrer-Policy')).toBe('no-referrer');
    // La page n'utilise que des styles en attribut : ni script, ni feuille de style, ni image.
    const html = await res.text();
    expect(html).not.toMatch(/<script|<link|<img|<style|<iframe/i);
  });

  it('toutes les réponses du serveur imposent HTTPS (Strict-Transport-Security, comme le site)', async () => {
    const HSTS = 'max-age=31536000; includeSubDomains';
    expect((await call('/status')).headers.get('Strict-Transport-Security')).toBe(HSTS);   // JSON
    expect((await call('/inconnu')).headers.get('Strict-Transport-Security')).toBe(HSTS);  // JSON, erreur
    expect((await worker.fetch(new Request(`${W}/auth/callback`), env)).headers.get('Strict-Transport-Security')).toBe(HSTS); // page HTML
    const options = await worker.fetch(new Request(`${W}/status`, { method: 'OPTIONS', headers: { Origin: ORIGIN } }), env);
    expect(options.status).toBe(204);
    expect(options.headers.get('Strict-Transport-Security')).toBe(HSTS);                    // préparation CORS
    const start = await worker.fetch(new Request(`${W}/auth/start?return=${encodeURIComponent(APP)}`), env);
    expect(start.status).toBe(302);
    expect(start.headers.get('Strict-Transport-Security')).toBe(HSTS);                      // redirection
  });
});

// ---------- 5. Écritures plafonnées ----------

describe('écritures plafonnées par compte', () => {
  const makeLimiter = (denied: string[]) => {
    const keys: string[] = [];
    const limiter = { limit: async ({ key }: { key: string }) => { keys.push(key); return { success: !denied.some(d => key.startsWith(d)) }; } };
    return { limiter: limiter as unknown as RateLimit, keys };
  };
  const goodSub = async () => ({ endpoint: endpoint('moi'), keys: await makeKeys() });

  it('/push/subscribe, /push/remove, /alert/lock-reset : 429 par compte, sans écriture', async () => {
    const { token } = await createSession(kv.asKV(), 'u1', 'me@example.com');
    const { limiter, keys } = makeLimiter(['subscribe:', 'remove:', 'lock-reset:']);
    env.API_LIMITER = limiter;
    const writes = kv.writes;
    for (const [path, body] of [
      ['/push/subscribe', { subscription: await goodSub() }], ['/push/remove', { endpoint: endpoint('moi') }], ['/alert/lock-reset', {}],
    ] as const) {
      const res = await post(path, token, body);
      expect(res.status, path).toBe(429);
      expect(res.headers.get('Retry-After')).toBe('60');
      expect(await res.json()).toEqual({ error: 'RATE_LIMITED' });
    }
    expect(kv.writes).toBe(writes);
    expect(keys).toEqual(expect.arrayContaining(['subscribe:u1', 'remove:u1', 'lock-reset:u1']));
  });

  it("/push/unsubscribe : 429 par compte, sans écriture ; sans rien à retirer, la liste n'est pas réécrite", async () => {
    const { token } = await createSession(kv.asKV(), 'u1', 'me@example.com');
    expect((await post('/push/subscribe', token, { subscription: await goodSub() })).status).toBe(200);
    // Endpoint inconnu : réponse normale, aucune écriture dans KV.
    const before = kv.writes;
    expect(await (await post('/push/unsubscribe', token, { endpoint: endpoint('inconnu') })).json()).toEqual({ ok: true, devices: 1 });
    expect(kv.writes).toBe(before);
    const { limiter, keys } = makeLimiter(['unsubscribe:']);
    env.API_LIMITER = limiter;
    const res = await post('/push/unsubscribe', token, { endpoint: endpoint('moi') });
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('60');
    expect(kv.writes).toBe(before);
    expect(keys).toContain('unsubscribe:u1');
  });

  it('/auth/bind : 429 par compte avant tout contrôle de la preuve', async () => {
    const { token } = await createSession(kv.asKV(), 'u1', 'me@example.com');
    const { limiter, keys } = makeLimiter(['bind:']);
    env.API_LIMITER = limiter;
    expect((await post('/auth/bind', token, { key: {}, proof: 'x' })).status).toBe(429);
    expect(keys).toContain('bind:u1');
  });

  it('une route non limitée continue de répondre', async () => {
    const { token } = await createSession(kv.asKV(), 'u1', 'me@example.com');
    env.API_LIMITER = makeLimiter(['bind:']).limiter;
    const res = await post('/push/subscribe', token, { subscription: await goodSub() });
    expect(res.status).toBe(200);
  });

  it('/push/subscribe ne réécrit pas la liste si l’abonnement est identique', async () => {
    const { token } = await createSession(kv.asKV(), 'u1', 'me@example.com');
    const sub = await goodSub();
    expect((await post('/push/subscribe', token, { subscription: sub })).status).toBe(200);
    const before = await kv.get('push:u1');
    const writes = kv.writes;
    const again = await post('/push/subscribe', token, { subscription: sub });
    expect(await again.json()).toEqual({ ok: true, devices: 1 });
    expect(kv.writes).toBe(writes);
    expect(await kv.get('push:u1')).toBe(before);
    // Autre appareil : écrit.
    expect((await post('/push/subscribe', token, { subscription: { endpoint: endpoint('autre'), keys: await makeKeys() } })).status).toBe(200);
    expect(kv.writes).toBeGreaterThan(writes);
    expect(JSON.parse((await kv.get('push:u1'))!)).toHaveLength(2);
  });
});
