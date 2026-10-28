// Chemins nominaux du serveur : jeton d'accès renvoyé
// par /token (l'appel que l'app fait toutes les heures), rotation du refresh token par Google,
// et tournée quotidienne des rappels réussie (mode discret, dédoublonnage, appareil injoignable).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { PushMessage } from '../src/webpush';

// Les notifications envoyées sont capturées en clair (le vrai chiffrement est testé dans
// webpush.test.ts) ; le code HTTP du service push est piloté par le test.
const push = vi.hoisted(() => ({ sent: [] as { endpoint: string; message: PushMessage }[], status: 201 }));
vi.mock('../src/webpush', async importOriginal => ({
  ...(await importOriginal<typeof import('../src/webpush')>()),
  sendPush: async (sub: { endpoint: string }, message: PushMessage) => { push.sent.push({ endpoint: sub.endpoint, message }); return push.status; },
}));

import worker, { Env } from '../src/index';
import { createSession, loadSession } from '../src/sessions';
import { b64urlEncode, decryptString, encryptString } from '../src/crypto';
import { MemoryKV, makeKeys } from './kvFake';
import { AccountType } from '../../src/types';

const APP = 'https://owner.github.io/suivi-epargne/';
const ORIGIN = 'https://owner.github.io';
const W = 'https://api.example.workers.dev';
const DAY = 86_400_000;

let kv: MemoryKV;
let env: Env;

const post = (path: string, token: string) => worker.fetch(new Request(`${W}${path}`, {
  method: 'POST', headers: { Origin: ORIGIN, Authorization: `Bearer ${token}` },
}), env);

const seedUser = async (refreshToken: string) => kv.put('user:u1', JSON.stringify({
  email: 'me@example.com', refreshTokenEnc: await encryptString(refreshToken, env.ENCRYPTION_KEY), updatedAt: 0, touchedAt: 0,
}));
const storedRefreshToken = async () => decryptString((await kv.get('user:u1', 'json')).refreshTokenEnc, env.ENCRYPTION_KEY);

// Google : jeton (avec rotation éventuelle du refresh token) et un fichier de données sur Drive.
interface GoogleFake { refreshSeen: string[]; rotateTo: string | null; tokenStatus: number; files: { id: string; modifiedTime: string; content: unknown }[]; listQueries: string[] }
let google: GoogleFake;
const fakeGoogle = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.startsWith('https://oauth2.googleapis.com/token')) {
    google.refreshSeen.push(new URLSearchParams(String(init?.body)).get('refresh_token') ?? '');
    if (google.tokenStatus !== 200) return new Response(JSON.stringify({ error: 'internal_failure' }), { status: google.tokenStatus });
    return new Response(JSON.stringify({
      access_token: 'ya29.fresh', expires_in: 3599, ...(google.rotateTo ? { refresh_token: google.rotateTo } : {}),
    }), { status: 200 });
  }
  if (url.startsWith('https://www.googleapis.com/drive/v3/files?')) {
    google.listQueries.push(decodeURIComponent(url));
    // Comme Drive : l'ordre demandé est respecté.
    const byModified = url.includes(encodeURIComponent('modifiedTime desc')) || url.includes('modifiedTime%20desc');
    const files = byModified ? [...google.files].sort((a, b) => b.modifiedTime.localeCompare(a.modifiedTime)) : google.files;
    return new Response(JSON.stringify({ files: files.map(f => ({ id: f.id, modifiedTime: f.modifiedTime })) }), { status: 200 });
  }
  const m = url.match(/^https:\/\/www\.googleapis\.com\/drive\/v3\/files\/([^?]+)\?alt=media$/);
  if (m) {
    const f = google.files.find(x => x.id === m[1]);
    return f ? new Response(JSON.stringify(f.content), { status: 200 }) : new Response('', { status: 404 });
  }
  throw new Error(`requête inattendue ${url}`);
});

beforeEach(async () => {
  kv = new MemoryKV();
  const vapid = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']) as CryptoKeyPair;
  env = {
    STORE: kv.asKV(), GOOGLE_CLIENT_ID: 'client-123.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'secret',
    ENCRYPTION_KEY: b64urlEncode(crypto.getRandomValues(new Uint8Array(32))),
    VAPID_PUBLIC_KEY: b64urlEncode(new Uint8Array(await crypto.subtle.exportKey('raw', vapid.publicKey) as ArrayBuffer)),
    VAPID_PRIVATE_KEY: (await crypto.subtle.exportKey('jwk', vapid.privateKey)).d!,
    VAPID_SUBJECT: APP, APP_URL: APP, ALLOWED_EMAILS: 'me@example.com',
  };
  google = { refreshSeen: [], rotateTo: null, tokenStatus: 200, files: [], listQueries: [] };
  push.sent = [];
  push.status = 201;
  vi.stubGlobal('fetch', fakeGoogle);
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); fakeGoogle.mockClear(); });

describe('POST /token', () => {
  it('renvoie un jeton d’accès frais et prolonge la session (au plus une écriture par jour)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-01T08:00:00Z'));
    const { token, hash } = await createSession(kv.asKV(), 'u1', 'me@example.com');
    await seedUser('1//rt-initial');
    const before = (await loadSession(kv.asKV(), hash))!.refreshedAt;

    vi.setSystemTime(new Date('2026-10-03T08:00:00Z'));
    const res = await post('/token', token);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ access_token: 'ya29.fresh', expires_in: 3599 });
    expect(google.refreshSeen).toEqual(['1//rt-initial']);
    const after = (await loadSession(kv.asKV(), hash))!.refreshedAt;
    expect(after).toBeGreaterThan(before);
    expect(after).toBe(Date.parse('2026-10-03T08:00:00Z'));
    // Le refresh token n'a pas tourné : il reste le même.
    expect(await storedRefreshToken()).toBe('1//rt-initial');

    // Un second appel le même jour n'écrit plus rien en KV.
    const writes = kv.writes;
    expect((await post('/token', token)).status).toBe(200);
    expect(kv.writes).toBe(writes);
  });

  it('rotation du refresh token par Google : le nouveau est gardé (chiffré) et sert ensuite', async () => {
    const { token } = await createSession(kv.asKV(), 'u1', 'me@example.com');
    await seedUser('1//rt-old');
    google.rotateTo = '1//rt-new';
    expect((await post('/token', token)).status).toBe(200);
    expect(await storedRefreshToken()).toBe('1//rt-new');
    expect(JSON.stringify(await kv.get('user:u1', 'json'))).not.toContain('rt-new');

    google.rotateTo = null;
    expect((await post('/token', token)).status).toBe(200);
    expect(google.refreshSeen).toEqual(['1//rt-old', '1//rt-new']);
  });

  it('Google en panne : 502 UPSTREAM_ERROR, rien n’est effacé', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { token } = await createSession(kv.asKV(), 'u1', 'me@example.com');
    await seedUser('1//rt');
    google.tokenStatus = 500;
    const res = await post('/token', token);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'UPSTREAM_ERROR' });
    expect(kv.keysWithPrefix('user:')).toEqual(['user:u1']);
    expect(kv.keysWithPrefix('session:')).toHaveLength(1);
  });
});

describe('tournée quotidienne des rappels', () => {
  const livret = {
    id: 'la', name: 'Livret A', type: AccountType.LIVRET_A, institution: 'B',
    totalAmount: 1000, ownedAmount: 1000, parentalCapital: 0, interestRate: 3,
    movements: [{ id: 'm', date: '2026-09-20', amount: 10, label: 'x', type: 'IN' as const }],
    balanceCheckedAt: '2026-09-20',
  };
  const dataFile = (config: Record<string, unknown> = {}) => ({
    accounts: [livret], expenses: [], history: [],
    recurringMovements: [{ id: 'r1', accountId: 'la', amount: 200, type: 'IN', label: 'Épargne auto', dayOfMonth: 5, active: true }],
    config: { grossAnnual: 0, leisureBudget: 0, projectSavings: 0, taxRateManual: 0, extraMonthlyIncome: 0, ...config },
  });
  const runCron = async () => {
    let p: Promise<unknown> = Promise.resolve();
    await worker.scheduled({ cron: '0 7 * * *' } as ScheduledEvent, env, { waitUntil: (x: Promise<unknown>) => { p = x; } } as ExecutionContext);
    await p;
  };
  const subscribeDevice = async () => {
    const sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/device-1', keys: await makeKeys() };
    await kv.put('push:u1', JSON.stringify([sub]));
    return sub;
  };

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-28T07:00:00Z'));
    await seedUser('1//rt');
  });

  it('envoie le rappel dû avec son montant, une seule fois par jour', async () => {
    await subscribeDevice();
    google.files = [{ id: 'f1', modifiedTime: '2026-09-27T10:00:00Z', content: dataFile() }];
    await runCron();
    expect(push.sent).toHaveLength(1);
    expect(push.sent[0].message.body).toMatch(/200/);
    expect(push.sent[0].message.body).toContain('Livret A');
    expect(kv.keysWithPrefix('sent:u1:')).toEqual(['sent:u1:recurring:r1:2026-09']);
    expect(await kv.get('health:cron', 'json')).toMatchObject({ ok: true, usersProcessed: 1 });

    await runCron(); // même jour : déjà envoyé
    expect(push.sent).toHaveLength(1);
  });

  it('mode discret : aucun montant ni nom de compte sur l’écran verrouillé', async () => {
    await subscribeDevice();
    google.files = [{ id: 'f1', modifiedTime: '2026-09-27T10:00:00Z', content: dataFile({ discreetNotifications: true }) }];
    await runCron();
    expect(push.sent).toHaveLength(1);
    const { title, body } = push.sent[0].message;
    expect(`${title} ${body}`).not.toMatch(/\d+\s?€|200|Livret A/);
    expect(kv.keysWithPrefix('sent:u1:')).toEqual(['sent:u1:recurring:r1:2026-09']);
  });

  it('rappel désactivé dans les préférences : rien n’est envoyé', async () => {
    await subscribeDevice();
    google.files = [{ id: 'f1', modifiedTime: '2026-09-27T10:00:00Z', content: dataFile({ notificationPrefs: { recurring: false } }) }];
    await runCron();
    expect(push.sent).toHaveLength(0);
    expect(kv.keysWithPrefix('sent:')).toEqual([]);
  });

  it('aucun appareil n’a reçu la notification : pas marquée envoyée, nouvel essai le lendemain', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await subscribeDevice();
    google.files = [{ id: 'f1', modifiedTime: '2026-09-27T10:00:00Z', content: dataFile() }];
    push.status = 500;
    await runCron();
    expect(push.sent).toHaveLength(1);
    expect(kv.keysWithPrefix('sent:')).toEqual([]);
    push.status = 201;
    vi.setSystemTime(new Date(Date.parse('2026-09-28T07:00:00Z') + DAY));
    await runCron();
    expect(push.sent).toHaveLength(2);
    expect(kv.keysWithPrefix('sent:u1:')).toEqual(['sent:u1:recurring:r1:2026-09']);
  });

  it('appareil désabonné (410) : retiré de la liste', async () => {
    await subscribeDevice();
    google.files = [{ id: 'f1', modifiedTime: '2026-09-27T10:00:00Z', content: dataFile() }];
    push.status = 410;
    await runCron();
    expect(kv.keysWithPrefix('push:')).toEqual([]);
    expect(kv.keysWithPrefix('sent:')).toEqual([]);
  });

  it('fichiers en double sur Drive : les rappels viennent du plus récemment modifié, comme dans l’app', async () => {
    await subscribeDevice();
    google.files = [
      { id: 'ancien', modifiedTime: '2026-08-01T10:00:00Z', content: { ...dataFile(), recurringMovements: [] } },
      { id: 'recent', modifiedTime: '2026-09-27T10:00:00Z', content: dataFile() },
    ];
    await runCron();
    expect(google.listQueries[0]).toContain('orderBy=modifiedTime desc');
    expect(push.sent).toHaveLength(1);
    expect(kv.keysWithPrefix('sent:u1:')).toEqual(['sent:u1:recurring:r1:2026-09']);
  });

  it('aucun fichier de données : rien n’est envoyé, la tournée reste saine', async () => {
    await subscribeDevice();
    await runCron();
    expect(push.sent).toHaveLength(0);
    expect(await kv.get('health:cron', 'json')).toMatchObject({ ok: true });
  });
});
