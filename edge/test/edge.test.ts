import { describe, it, expect, afterEach, vi } from 'vitest';
import edge, { SECURITY_HEADERS } from '../src/index';

const origin = (init: ResponseInit = {}, body: BodyInit | null = '<!doctype html><title>Pécule</title>') =>
  vi.fn(async (_req: Request) => new Response(body, {
    status: 200,
    ...init,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'max-age=600', ETag: '"abc"', ...(init.headers as Record<string, string> | undefined) },
  }));

const call = (url: string, init?: RequestInit) => edge.fetch(new Request(url, init));

afterEach(() => { vi.unstubAllGlobals(); });

describe('en-têtes de sécurité', () => {
  it('relaie la requête inchangée et ajoute les en-têtes', async () => {
    const f = origin();
    vi.stubGlobal('fetch', f);
    const req = new Request('https://pecule-app.com/presentation.html?x=1', { headers: { 'If-None-Match': '"zzz"' } });
    const res = await edge.fetch(req);

    expect(f).toHaveBeenCalledTimes(1);
    expect(f.mock.calls[0][0]).toBe(req);
    expect(res.status).toBe(200);
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) expect(res.headers.get(k)).toBe(v);
    expect(res.headers.get('Strict-Transport-Security')).toBe('max-age=31536000; includeSubDomains');
    expect(res.headers.get('Content-Security-Policy')).toBe("frame-ancestors 'none'");
    expect(res.headers.get('Cross-Origin-Opener-Policy')).toBe('same-origin-allow-popups');
  });

  it("ne touche ni au corps, ni au statut, ni au cache de l'origine", async () => {
    vi.stubGlobal('fetch', origin({ status: 404, statusText: 'Not Found' }, 'introuvable'));
    const res = await call('https://pecule-app.com/absent');
    expect(res.status).toBe(404);
    expect(res.statusText).toBe('Not Found');
    expect(await res.text()).toBe('introuvable');
    expect(res.headers.get('Cache-Control')).toBe('max-age=600');
    expect(res.headers.get('ETag')).toBe('"abc"');
    expect(res.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
  });

  it('relaie un 304 sans corps', async () => {
    vi.stubGlobal('fetch', origin({ status: 304 }, null));
    const res = await call('https://pecule-app.com/');
    expect(res.status).toBe(304);
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
  });

  it("ajoute frame-ancestors à une CSP de l'origine sans l'écraser", async () => {
    vi.stubGlobal('fetch', origin({ headers: { 'Content-Security-Policy': "default-src 'self'" } }));
    const res = await call('https://pecule-app.com/');
    expect(res.headers.get('Content-Security-Policy')).toBe("default-src 'self', frame-ancestors 'none'");
  });

  it('HEAD reçoit aussi les en-têtes (curl -I)', async () => {
    vi.stubGlobal('fetch', origin({}, null));
    const res = await call('https://pecule-app.com/', { method: 'HEAD' });
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('relaie les autres méthodes telles quelles', async () => {
    const upstream = new Response('ok', { status: 405 });
    const f = vi.fn(async () => upstream);
    vi.stubGlobal('fetch', f);
    const res = await call('https://pecule-app.com/', { method: 'POST', body: 'x' });
    expect(res).toBe(upstream);
    expect(res.headers.get('Strict-Transport-Security')).toBeNull();
  });
});

describe('redirection www', () => {
  it('redirige en 301 vers le domaine nu, chemin et paramètres conservés', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    const res = await call('http://www.pecule-app.com/presentation.html?a=1&b=2#x');
    expect(res.status).toBe(301);
    expect(res.headers.get('Location')).toBe('https://pecule-app.com/presentation.html?a=1&b=2');
    expect(f).not.toHaveBeenCalled();
  });

  it('garde la méthode (308) pour un POST', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const res = await call('https://www.pecule-app.com/x', { method: 'POST', body: 'x' });
    expect(res.status).toBe(308);
    expect(res.headers.get('Location')).toBe('https://pecule-app.com/x');
  });
});
