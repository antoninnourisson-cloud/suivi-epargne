// Plafond quotidien de neurones de la veille fiscale : total par jour UTC gardé en KV (une
// écriture par passage), passage refusé au-delà (cron du lundi, relance, « Vérifier maintenant »).
// Horloge, KV, Workers AI et pages publiques simulés.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import worker, { Env } from '../src/index';
import { createSession } from '../src/sessions';
import { MemoryKV } from './kvFake';
import {
  AiRunner, runAndStoreFiscalWatch, hasDailyBudget, dailyNeuronsKey, DAILY_BUDGET_ERROR,
  FISCAL_DAILY_CEILING, FISCAL_WATCH_BUDGET, ATTEMPT_KEY, FISCAL_WATCH_CRON,
} from '../src/fiscalWatchJob';

const MONDAY = new Date('2026-10-12T05:00:00Z');
const ORIGIN = 'https://pecule-app.com';

let kv: MemoryKV;
let ai: AiRunner;
let env: Env;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(MONDAY);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  // Chaque page publique contient du texte : l'IA est appelée pour chaque page qui a des champs.
  vi.stubGlobal('fetch', vi.fn(async () => new Response('<main>Le plafond est de 12 000 € .</main>', { status: 200 })));
  kv = new MemoryKV();
  ai = { run: vi.fn(async () => ({ response: { values: [] }, usage: { prompt_tokens: 1000, completion_tokens: 100 } })) };
  env = {
    STORE: kv.asKV(), GOOGLE_CLIENT_ID: 'c', GOOGLE_CLIENT_SECRET: 's', ENCRYPTION_KEY: 'k',
    VAPID_PUBLIC_KEY: 'p', VAPID_PRIVATE_KEY: 'q', VAPID_SUBJECT: 'https://pecule-app.com/', APP_URL: 'https://pecule-app.com/',
    AI: ai, ALLOWED_EMAILS: 'me@example.com',
  } as Env;
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const seed = async (neurons: number, at: Date = MONDAY) => { await kv.asKV().put(dailyNeuronsKey(at), String(neurons), { expirationTtl: 2 * 86400 }); };

describe('plafond quotidien de la veille fiscale', () => {
  it('le plafond laisse la place d\'un passage complet, sous le quota gratuit', () => {
    expect(FISCAL_DAILY_CEILING).toBeLessThan(10_000);
    expect(FISCAL_DAILY_CEILING).toBeGreaterThanOrEqual(FISCAL_WATCH_BUDGET);
  });

  it('un passage note ses neurones en une seule écriture de compteur, avec expiration à 2 jours', async () => {
    const before = kv.writes;
    const run = await runAndStoreFiscalWatch(kv.asKV(), ai, { now: MONDAY });
    expect(run.neuronsUsed).toBeGreaterThan(0);
    // ATTEMPT_KEY + FAILURE_KEY (résultat vide) + le compteur du jour : une seule écriture de compteur.
    expect(kv.writes - before).toBe(3);
    const entry = kv.data.get(dailyNeuronsKey(MONDAY))!;
    expect(Number(entry.value)).toBeCloseTo(run.neuronsUsed!, 0);
    expect(entry.expiresAt! - MONDAY.getTime()).toBe(2 * 86400 * 1000);
  });

  it('le total s\'additionne sur la journée, puis le passage suivant est refusé sans toucher à l\'IA ni à KV', async () => {
    await seed(2_500);
    expect(await hasDailyBudget(kv.asKV(), MONDAY)).toBe(false); // 2 500 + 6 000 > 8 000
    const writes = kv.writes;
    await expect(runAndStoreFiscalWatch(kv.asKV(), ai, { now: MONDAY })).rejects.toThrow(DAILY_BUDGET_ERROR);
    expect(ai.run).not.toHaveBeenCalled();
    expect(kv.writes).toBe(writes);
    expect(await kv.get(ATTEMPT_KEY)).toBeNull();
  });

  it('accepte un passage tant que le budget d\'un passage tient dans le plafond', async () => {
    await seed(FISCAL_DAILY_CEILING - FISCAL_WATCH_BUDGET);
    expect(await hasDailyBudget(kv.asKV(), MONDAY)).toBe(true);
    await seed(FISCAL_DAILY_CEILING - FISCAL_WATCH_BUDGET + 1);
    expect(await hasDailyBudget(kv.asKV(), MONDAY)).toBe(false);
  });

  it('repart de zéro le lendemain (jour UTC)', async () => {
    await seed(FISCAL_DAILY_CEILING + 500);
    expect(await hasDailyBudget(kv.asKV(), MONDAY)).toBe(false);
    expect(await hasDailyBudget(kv.asKV(), new Date('2026-10-13T00:00:01Z'))).toBe(true);
    // Et la clé du jour précédent expire d'elle-même.
    vi.setSystemTime(new Date('2026-10-14T05:00:00Z'));
    expect(await kv.get(dailyNeuronsKey(MONDAY))).toBeNull();
  });

  it('un compteur illisible compte pour zéro', async () => {
    await kv.asKV().put(dailyNeuronsKey(MONDAY), 'abc');
    expect(await hasDailyBudget(kv.asKV(), MONDAY)).toBe(true);
  });

  it('pas de passage sans appel à l\'IA : aucune écriture de compteur', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('indisponible', { status: 503 })));
    await runAndStoreFiscalWatch(kv.asKV(), ai, { now: MONDAY });
    expect(ai.run).not.toHaveBeenCalled();
    expect(kv.keysWithPrefix('fiscal-watch:neurons:')).toEqual([]);
  });

  it('« Vérifier maintenant » : 503 avec code et message en français quand le plafond du jour est atteint', async () => {
    const token = (await createSession(kv.asKV(), 'g-1', 'me@example.com')).token;
    await seed(7_000);
    const res = await worker.fetch(new Request('https://api.example.workers.dev/fiscal-watch/run', {
      method: 'POST', headers: { Origin: ORIGIN, Authorization: `Bearer ${token}` },
    }), env);
    expect(res.status).toBe(503);
    expect(res.headers.get('Retry-After')).toBe('3600');
    const body = await res.json() as { error: string; message: string };
    expect(body.error).toBe(DAILY_BUDGET_ERROR);
    expect(body.message).toMatch(/plafond/);
    expect(ai.run).not.toHaveBeenCalled();
  });

  it('cron du lundi : refusé quand le plafond est atteint, sans appel à l\'IA', async () => {
    await seed(FISCAL_DAILY_CEILING);
    let p: Promise<unknown> = Promise.resolve();
    await worker.scheduled({ cron: FISCAL_WATCH_CRON } as ScheduledEvent, env, { waitUntil: (x: Promise<unknown>) => { p = x; } } as ExecutionContext);
    await p;
    expect(ai.run).not.toHaveBeenCalled();
  });
});
