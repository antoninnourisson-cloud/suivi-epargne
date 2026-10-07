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

describe('GET /status', () => {
  it("répond sans session, même avant la première tâche quotidienne", async () => {
    const res = await status(makeEnv(new MemoryKV()));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, cron: { lastRunAt: null, ok: null } });
  });

  it("ne rend que l'heure et le résultat de la tâche, sans détail", async () => {
    const kv = new MemoryKV();
    await kv.put('health:cron', JSON.stringify({ lastRunAt: '2026-10-07T07:00:00.000Z', ok: false, error: 'détail interne', usersProcessed: 3 }));
    const body = await (await status(makeEnv(kv))).json();
    expect(body).toEqual({ ok: true, cron: { lastRunAt: '2026-10-07T07:00:00.000Z', ok: false } });
  });
});
