// Relance quotidienne de la veille fiscale après un échec : une fois par jour au plus, 6 fois par
// semaine au plus, jusqu'au premier succès. Horloge et KV simulés, pages publiques simulées.
import { describe, it, expect, vi, afterEach } from 'vitest';
import worker, { Env } from '../src/index';
import { MemoryKV } from './kvFake';
import { FISCAL_WATCH_HEALTH_KEY, recordFiscalWatchCron } from '../src/cronLog';
import { FISCAL_WATCH_CRON, LATEST_KEY, RETRIES_KEY, ATTEMPT_KEY, isFiscalRetryDue } from '../src/fiscalWatchJob';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

const makeEnv = (kv: MemoryKV, ai: unknown = { run: vi.fn() }) => ({
  STORE: kv.asKV(),
  GOOGLE_CLIENT_ID: 'client', GOOGLE_CLIENT_SECRET: 's', ENCRYPTION_KEY: 'k',
  VAPID_PUBLIC_KEY: 'p', VAPID_PRIVATE_KEY: 'q', VAPID_SUBJECT: 'https://pecule-app.com/',
  APP_URL: "https://pecule-app.com/", AI: ai ?? undefined,
}) as unknown as Env;

const runCron = async (env: Env, cron: string) => {
  let p: Promise<unknown> = Promise.resolve();
  await worker.scheduled({ cron } as ScheduledEvent, env, { waitUntil: (x: Promise<unknown>) => { p = x; } } as ExecutionContext);
  await p;
};

/** Pages officielles indisponibles : chaque passage de la veille échoue. */
const pagesDown = () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('indisponible', { status: 503 }));
};

const at = (iso: string) => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(iso)); };

describe('relance de la veille fiscale', () => {
  it('ne relance pas le jour même de l\'échec du lundi, puis relance le lendemain', async () => {
    pagesDown();
    const kv = new MemoryKV();
    const ai = { run: vi.fn() };
    const env = makeEnv(kv, ai);
    at('2026-11-02T05:00:00Z');
    await runCron(env, FISCAL_WATCH_CRON);
    expect(await kv.get(RETRIES_KEY)).toBeNull();

    at('2026-11-02T07:00:00Z'); // lundi, cron quotidien : déjà essayé aujourd'hui
    await runCron(env, '0 7 * * *');
    expect(await kv.get(RETRIES_KEY)).toBeNull();

    at('2026-11-03T07:00:00Z'); // mardi : relance
    await runCron(env, '0 7 * * *');
    expect(await kv.get(RETRIES_KEY, 'json')).toEqual(['2026-11-03T07:00:00.000Z']);
    expect(await kv.get(FISCAL_WATCH_HEALTH_KEY, 'json')).toMatchObject({ lastFailureAt: '2026-11-03T07:00:00.000Z', ok: false });
  });

  it('au plus une relance par jour, au plus 6 par semaine', async () => {
    pagesDown();
    const kv = new MemoryKV();
    const env = makeEnv(kv);
    at('2026-11-02T05:00:00Z');
    await runCron(env, FISCAL_WATCH_CRON);
    // Deux passages le même jour : une seule relance.
    at('2026-11-03T07:00:00Z');
    await runCron(env, '0 7 * * *');
    await runCron(env, '0 7 * * *');
    expect((await kv.get(RETRIES_KEY, 'json')).length).toBe(1);
    // Les jours suivants : 6 relances au total, pas de 7e dans la semaine.
    for (let d = 4; d <= 10; d++) {
      at(`2026-11-${String(d).padStart(2, '0')}T07:00:00Z`);
      await runCron(env, '0 7 * * *');
    }
    expect((await kv.get(RETRIES_KEY, 'json')).length).toBe(6);
    // 7 jours après la première relance, une place se libère.
    at('2026-11-11T07:00:00Z');
    await runCron(env, '0 7 * * *');
    expect((await kv.get(RETRIES_KEY, 'json')).length).toBe(6);
    expect((await kv.get(RETRIES_KEY, 'json'))[5]).toBe('2026-11-11T07:00:00.000Z');
  });

  it('ne relance pas si le dernier essai a réussi, ni sans binding AI', async () => {
    const spy = pagesDown();
    const kv = new MemoryKV();
    at('2026-11-02T05:00:00Z');
    await recordFiscalWatchCron(kv.asKV(), new Date(), true);
    at('2026-11-03T07:00:00Z');
    await runCron(makeEnv(kv), '0 7 * * *');
    expect(await kv.get(RETRIES_KEY)).toBeNull();

    const kv2 = new MemoryKV();
    at('2026-11-02T05:00:00Z');
    await recordFiscalWatchCron(kv2.asKV(), new Date(), false);
    at('2026-11-03T07:00:00Z');
    await runCron(makeEnv(kv2, null), '0 7 * * *');
    expect(await kv2.get(RETRIES_KEY)).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it('une exécution à la demande récente (essai en cours ou succès plus récent) empêche la relance', async () => {
    const kv = new MemoryKV();
    at('2026-11-02T05:00:00Z');
    await recordFiscalWatchCron(kv.asKV(), new Date(), false);
    at('2026-11-03T07:00:00Z');
    expect(await isFiscalRetryDue(kv.asKV())).toBe(true);
    await kv.put(ATTEMPT_KEY, 'x', { expirationTtl: 3600 });
    expect(await isFiscalRetryDue(kv.asKV())).toBe(false);
    await kv.delete(ATTEMPT_KEY);
    await kv.put(LATEST_KEY, JSON.stringify({ checkedAt: '2026-11-02T18:00:00.000Z', ok: true }));
    expect(await isFiscalRetryDue(kv.asKV())).toBe(false);
  });

  it('les relances s\'arrêtent au premier succès', async () => {
    const kv = new MemoryKV();
    at('2026-11-02T05:00:00Z');
    await recordFiscalWatchCron(kv.asKV(), new Date(), false);
    at('2026-11-03T07:00:00Z');
    await recordFiscalWatchCron(kv.asKV(), new Date(), true);
    at('2026-11-04T07:00:00Z');
    expect(await isFiscalRetryDue(kv.asKV())).toBe(false);
  });
});
