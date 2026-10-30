// Garde-fou de publication : serveur joignable avant la mise en ligne (scripts/check-backend.mjs).
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { APP_ORIGIN, backendOriginFrom, checkBackend, statusVerdict } from './check-backend.mjs';

const ENV = 'VITE_BACKEND_URL=https://api.pecule-app.com\n';
const reply = (status: number, body: unknown, allowOrigin: string | null = APP_ORIGIN) =>
  new Response(JSON.stringify(body), { status, headers: allowOrigin ? { 'Access-Control-Allow-Origin': allowOrigin } : {} });
const fast = { delayMs: 0 };

describe('check-backend', () => {
  it("lit l'origine du serveur (https seulement, chemin et barre finale ignorés)", () => {
    expect(backendOriginFrom('# commentaire\nVITE_BACKEND_URL=https://api.pecule-app.com/\r\n')).toBe('https://api.pecule-app.com');
    expect(backendOriginFrom('VITE_BACKEND_URL=http://api.pecule-app.com')).toBeNull();
    expect(backendOriginFrom('VITE_BACKEND_URL=')).toBeNull();
    expect(backendOriginFrom('AUTRE=1')).toBeNull();
  });

  it('vise bien le serveur du build publié (.env.production)', () => {
    expect(backendOriginFrom(readFileSync(new URL('../.env.production', import.meta.url), 'utf8'))).toMatch(/^https:\/\//);
  });

  it('exige 200, ok: true et le CORS de l’app', () => {
    const o = 'https://api.pecule-app.com';
    expect(statusVerdict(o, { status: 200, allowOrigin: APP_ORIGIN, body: { ok: true } }).ok).toBe(true);
    expect(statusVerdict(o, { status: 404, allowOrigin: APP_ORIGIN, body: { ok: true } }).ok).toBe(false);
    expect(statusVerdict(o, { status: 200, allowOrigin: APP_ORIGIN, body: '<html>' }).ok).toBe(false);
    expect(statusVerdict(o, { status: 200, allowOrigin: null, body: { ok: true } }).message).toMatch(/CORS/);
  });

  it("interroge /status avec l'origine de l'app", async () => {
    const fetchImpl = vi.fn(async () => reply(200, { ok: true }));
    const v = await checkBackend(ENV, { fetchImpl, ...fast });
    expect(v.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.pecule-app.com/status');
    expect((init.headers as Record<string, string>).Origin).toBe(APP_ORIGIN);
  });

  it('domaine inexistant : échec après les nouveaux essais, message qui dit quoi vérifier', async () => {
    const fetchImpl = vi.fn(async () => { throw new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } }); });
    const v = await checkBackend(ENV, { fetchImpl, attempts: 3, ...fast });
    expect(v.ok).toBe(false);
    expect(v.message).toMatch(/ENOTFOUND/);
    expect(v.message).toMatch(/Cloudflare/);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('un raté passager puis une réponse correcte : succès', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(reply(522, { error: 'x' }))
      .mockResolvedValueOnce(reply(200, { ok: true }));
    expect((await checkBackend(ENV, { fetchImpl, ...fast })).ok).toBe(true);
  });

  it('VITE_BACKEND_URL absent : échec sans appel réseau', async () => {
    const fetchImpl = vi.fn();
    expect((await checkBackend('', { fetchImpl, ...fast })).ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
