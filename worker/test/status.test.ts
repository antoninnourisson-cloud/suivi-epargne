// GET /status : sonde publique de la surveillance quotidienne (.github/workflows/monitor.yml).
import { describe, it, expect } from 'vitest';
import worker, { Env } from '../src/index';
import { MemoryKV } from './kvFake';

const makeEnv = (kv: MemoryKV) => ({
  STORE: kv.asKV(),
  GOOGLE_CLIENT_ID: 'client', GOOGLE_CLIENT_SECRET: 's', ENCRYPTION_KEY: 'k',
  VAPID_PUBLIC_KEY: 'p', VAPID_PRIVATE_KEY: 'q', VAPID_SUBJECT: 'https://pecule-app.com/',
  APP_URL: 'https://pecule-app.com/',
}) as Env;

const status = (env: Env) => worker.fetch(new Request('https://api.example.workers.dev/status'), env);
// Contrôle du site déjà fait il y a moins de 15 min : /status le reprend sans requête réseau.
const SITE = { checkedAt: new Date().toISOString(), ok: true, failing: [], hsts: true };
const withSite = async (kv: MemoryKV) => { await kv.put('health:site', JSON.stringify(SITE)); return kv; };

describe('GET /status', () => {
  it("répond sans session, même avant la première tâche quotidienne", async () => {
    const res = await status(makeEnv(await withSite(new MemoryKV())));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true, cron: { lastRunAt: null, ok: null }, site: SITE,
      fiscalWatch: { lastSuccessAt: null, lastFailureAt: null, ok: null }, history: [],
    });
  });

  it("ne rend que l'heure et le résultat de la tâche, sans détail", async () => {
    const kv = await withSite(new MemoryKV());
    await kv.put('health:cron', JSON.stringify({ lastRunAt: '2026-10-07T07:00:00.000Z', ok: false, error: 'détail interne', usersProcessed: 3 }));
    const body = await (await status(makeEnv(kv))).json();
    expect(body).toEqual({
      ok: true, cron: { lastRunAt: '2026-10-07T07:00:00.000Z', ok: false }, site: SITE,
      fiscalWatch: { lastSuccessAt: null, lastFailureAt: null, ok: null }, history: [],
    });
  });

  it('rend la veille fiscale du lundi et les derniers passages des crons, sans détail', async () => {
    const kv = await withSite(new MemoryKV());
    await kv.put('health:fiscal-watch', JSON.stringify({ lastSuccessAt: '2026-10-19T05:00:00.000Z', lastFailureAt: '2026-10-26T05:00:00.000Z', ok: false }));
    const history = [
      { at: '2026-10-28T07:00:00.000Z', cron: 'daily', ok: false, errors: ['drive', 'token'] },
      { at: '2026-10-26T05:00:00.000Z', cron: 'fiscal-watch', ok: false, errors: ['watch'] },
    ];
    await kv.put('health:cron-log', JSON.stringify(history));
    const body = await (await status(makeEnv(kv))).json();
    expect(body).toMatchObject({
      fiscalWatch: { lastSuccessAt: '2026-10-19T05:00:00.000Z', lastFailureAt: '2026-10-26T05:00:00.000Z', ok: false },
      history,
    });
  });
});
