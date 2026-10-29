// Suivi des crons pour /status (cronLog.ts) : historique borné, catégories d'erreur sans
// message, dernier succès / dernier échec de la veille fiscale du lundi.
import { describe, it, expect, vi, afterEach } from 'vitest';
import worker, { Env } from '../src/index';
import {
  CRON_LOG_KEY, CRON_LOG_SIZE, FISCAL_WATCH_HEALTH_KEY, CronErrors, appendCronLog, categorizeCronError,
  readCronLog, recordFiscalWatchCron,
} from '../src/cronLog';
import { FISCAL_WATCH_CRON, LATEST_KEY } from '../src/fiscalWatchJob';
import { GoogleAuthError } from '../src/google';
import { MemoryKV } from './kvFake';

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('categorizeCronError', () => {
  it('range chaque erreur dans une catégorie, sans garder son texte', () => {
    expect(categorizeCronError(new GoogleAuthError('invalid_grant', 'Token has been expired'))).toBe('token');
    expect(categorizeCronError(new Error('DRIVE_LIST_403'))).toBe('drive');
    expect(categorizeCronError(new Error('DRIVE_READ_500'))).toBe('drive');
    expect(categorizeCronError(new Error('INVALID_P256_PUBLIC_KEY'))).toBe('notification');
    expect(categorizeCronError(new Error('push service down'))).toBe('notification');
    expect(categorizeCronError(new Error('KV quota'))).toBe('other');
    expect(categorizeCronError('texte libre')).toBe('other');
  });
});

describe('CronErrors', () => {
  it('garde les messages pour /health et des catégories distinctes, dans un ordre stable', () => {
    const errors = new CronErrors();
    expect(errors.count).toBe(0);
    expect(errors.categories).toEqual([]);
    errors.add(new Error('KV quota'));
    errors.add(new Error('DRIVE_READ_500'));
    errors.add(new Error('DRIVE_LIST_403'));
    errors.add('brut');
    expect(errors.count).toBe(4);
    expect(errors.messages).toEqual(['KV quota', 'DRIVE_READ_500', 'DRIVE_LIST_403', 'brut']);
    expect(errors.categories).toEqual(['drive', 'other']);
  });
});

describe('historique des crons', () => {
  it('ajoute en tête et reste borné à CRON_LOG_SIZE entrées', async () => {
    const kv = new MemoryKV();
    for (let i = 0; i < CRON_LOG_SIZE + 5; i++) {
      await appendCronLog(kv.asKV(), { at: `2026-10-${String(i + 1).padStart(2, '0')}T07:00:00.000Z`, cron: 'daily', ok: true });
    }
    const log = await readCronLog(kv.asKV());
    expect(log).toHaveLength(CRON_LOG_SIZE);
    expect(log[0].at).toBe('2026-10-15T07:00:00.000Z');
    expect(log[CRON_LOG_SIZE - 1].at).toBe('2026-10-06T07:00:00.000Z');
  });

  it("n'écrit les catégories que pour un échec, et rien d'autre que les champs prévus", async () => {
    const kv = new MemoryKV();
    await appendCronLog(kv.asKV(), { at: 'a', cron: 'daily', ok: true, errors: ['drive'] });
    await appendCronLog(kv.asKV(), { at: 'b', cron: 'daily', ok: false, errors: [] });
    await appendCronLog(kv.asKV(), { at: 'c', cron: 'daily', ok: false, errors: ['token'], detail: 'secret' } as never);
    expect(await kv.get(CRON_LOG_KEY, 'json')).toEqual([
      { at: 'c', cron: 'daily', ok: false, errors: ['token'] },
      { at: 'b', cron: 'daily', ok: false },
      { at: 'a', cron: 'daily', ok: true },
    ]);
  });

  it('ignore un historique illisible ou des entrées mal formées', async () => {
    const kv = new MemoryKV();
    await kv.put(CRON_LOG_KEY, JSON.stringify({ pas: 'un tableau' }));
    expect(await readCronLog(kv.asKV())).toEqual([]);
    await kv.put(CRON_LOG_KEY, JSON.stringify([null, { at: 1 }, { at: 'x', cron: 'daily', ok: true }]));
    expect(await readCronLog(kv.asKV())).toEqual([{ at: 'x', cron: 'daily', ok: true }]);
    await kv.put(CRON_LOG_KEY, '{cassé');
    expect(await readCronLog(kv.asKV())).toEqual([]);
  });
});

describe('recordFiscalWatchCron', () => {
  it('garde le dernier succès après un échec, et le dernier échec après un succès', async () => {
    const kv = new MemoryKV();
    await recordFiscalWatchCron(kv.asKV(), new Date('2026-10-19T05:00:00Z'), true);
    await recordFiscalWatchCron(kv.asKV(), new Date('2026-10-26T05:00:00Z'), false);
    expect(await kv.get(FISCAL_WATCH_HEALTH_KEY, 'json')).toEqual({
      lastSuccessAt: '2026-10-19T05:00:00.000Z', lastFailureAt: '2026-10-26T05:00:00.000Z', ok: false,
    });
    await recordFiscalWatchCron(kv.asKV(), new Date('2026-11-02T05:00:00Z'), true);
    expect(await kv.get(FISCAL_WATCH_HEALTH_KEY, 'json')).toEqual({
      lastSuccessAt: '2026-11-02T05:00:00.000Z', lastFailureAt: '2026-10-26T05:00:00.000Z', ok: true,
    });
    expect(await readCronLog(kv.asKV())).toEqual([
      { at: '2026-11-02T05:00:00.000Z', cron: 'fiscal-watch', ok: true },
      { at: '2026-10-26T05:00:00.000Z', cron: 'fiscal-watch', ok: false, errors: ['watch'] },
      { at: '2026-10-19T05:00:00.000Z', cron: 'fiscal-watch', ok: true },
    ]);
  });

  it('premier passage en échec : aucun succès connu', async () => {
    const kv = new MemoryKV();
    await recordFiscalWatchCron(kv.asKV(), new Date('2026-10-26T05:00:00Z'), false);
    expect(await kv.get(FISCAL_WATCH_HEALTH_KEY, 'json')).toEqual({ lastSuccessAt: null, lastFailureAt: '2026-10-26T05:00:00.000Z', ok: false });
  });
});

const makeEnv = (kv: MemoryKV, extra: Partial<Env> = {}) => ({
  STORE: kv.asKV(),
  GOOGLE_CLIENT_ID: 'client', GOOGLE_CLIENT_SECRET: 's', ENCRYPTION_KEY: 'k',
  VAPID_PUBLIC_KEY: 'p', VAPID_PRIVATE_KEY: 'q', VAPID_SUBJECT: 'https://pecule-app.com/',
  APP_URL: 'https://pecule-app.com/', ...extra,
}) as Env;

const runCron = async (env: Env, cron: string) => {
  let p: Promise<unknown> = Promise.resolve();
  await worker.scheduled({ cron } as ScheduledEvent, env, { waitUntil: (x: Promise<unknown>) => { p = x; } } as ExecutionContext);
  await p;
};

describe('crons → suivi', () => {
  it('veille du lundi sans binding AI : échec « watch » enregistré, sans exception', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-02T05:00:00Z'));
    const kv = new MemoryKV();
    await runCron(makeEnv(kv), FISCAL_WATCH_CRON);
    expect(await kv.get(FISCAL_WATCH_HEALTH_KEY, 'json')).toEqual({ lastSuccessAt: null, lastFailureAt: '2026-11-02T05:00:00.000Z', ok: false });
    expect(await readCronLog(kv.asKV())).toEqual([{ at: '2026-11-02T05:00:00.000Z', cron: 'fiscal-watch', ok: false, errors: ['watch'] }]);
  });

  it('veille du lundi : un relevé vide (aucune valeur) compte comme un échec', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('indisponible', { status: 503 }));
    const kv = new MemoryKV();
    await runCron(makeEnv(kv, { AI: { run: vi.fn() } as never }), FISCAL_WATCH_CRON);
    expect(await kv.get(FISCAL_WATCH_HEALTH_KEY, 'json')).toMatchObject({ lastSuccessAt: null, ok: false });
  });

  it('tâche quotidienne : passage ajouté à l’historique, sans message', async () => {
    const kv = new MemoryKV();
    await runCron(makeEnv(kv), '0 7 * * *');
    const log = await readCronLog(kv.asKV());
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ cron: 'daily', ok: true });
    expect(log[0]).not.toHaveProperty('errors');
  });

  it('tâche quotidienne en échec : seule la catégorie est publiée', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const kv = new MemoryKV();
    await kv.put('push:g-1', '[]');
    // Lecture KV du compte qui échoue : erreur « autre », le message reste dans health:cron.
    const get = kv.get.bind(kv);
    vi.spyOn(kv, 'get').mockImplementation(async (key: string, type?: never) => {
      if (key === 'push:g-1') throw new Error('KV indisponible pour g-1');
      return get(key, type);
    });
    await runCron(makeEnv(kv), '0 7 * * *');
    expect(await get('health:cron', 'json')).toMatchObject({ ok: false, error: expect.stringContaining('g-1') });
    const log = await readCronLog(kv.asKV());
    expect(log[0]).toMatchObject({ cron: 'daily', ok: false, errors: ['other'] });
    expect(JSON.stringify(log)).not.toContain('g-1');
  });

  it("un historique qu'on n'arrive pas à écrire ne fait pas échouer la tâche quotidienne", async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const kv = new MemoryKV();
    const put = kv.put.bind(kv);
    vi.spyOn(kv, 'put').mockImplementation(async (key, value, opts) => {
      if (key === CRON_LOG_KEY) throw new Error('KV quota');
      return put(key, value, opts);
    });
    await runCron(makeEnv(kv), '0 7 * * *');
    expect(await kv.get('health:cron', 'json')).toMatchObject({ ok: true });
  });

  it("/status reprend le dernier relevé réussi tant que le cron n'a pas été suivi", async () => {
    const kv = new MemoryKV();
    await kv.put('health:site', JSON.stringify({ checkedAt: new Date().toISOString(), ok: true, failing: [], hsts: true }));
    await kv.put(LATEST_KEY, JSON.stringify({ checkedAt: '2026-10-26T05:00:03.000Z', ok: true, values: {} }));
    const body = await (await worker.fetch(new Request('https://api.example.workers.dev/status'), makeEnv(kv))).json();
    expect(body).toMatchObject({ fiscalWatch: { lastSuccessAt: '2026-10-26T05:00:03.000Z', lastFailureAt: null, ok: true }, history: [] });
  });
});
