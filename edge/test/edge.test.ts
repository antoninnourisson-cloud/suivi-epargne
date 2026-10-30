import { describe, it, expect, afterEach, vi } from 'vitest';
import edge, { SECURITY_HEADERS, IMMUTABLE, REVALIDATE, cacheControlFor } from '../src/index';

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

  it("ne touche ni au corps, ni au statut, ni au cache de l'origine (hors 200/304)", async () => {
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

describe('en-têtes de cache', () => {
  const served = async (path: string, contentType = 'application/javascript', status = 200) => {
    vi.stubGlobal('fetch', origin({ status, headers: { 'Content-Type': contentType, 'Cache-Control': 'max-age=14400', Expires: 'Tue, 20 Oct 2026 14:00:00 GMT' } }, status === 304 ? null : 'x'));
    return call(`https://pecule-app.com${path}`);
  };

  it('fichiers hachés par Vite : un an, immutable', async () => {
    for (const path of ['/assets/index-RQF3CMlT.js', '/assets/AreaSeriesChart-BRS7Y0-C.js', '/assets/index-Dx_9aZ1q.css', '/workbox-9c191d2f.js']) {
      const res = await served(path);
      expect(res.headers.get('Cache-Control'), path).toBe(IMMUTABLE);
      expect(res.headers.get('Expires')).toBeNull();
    }
    expect((await served('/assets/index-RQF3CMlT.js', 'application/javascript', 304)).headers.get('Cache-Control')).toBe(IMMUTABLE);
  });

  it('pages, service worker, extension push, enregistrement et manifeste : revalidés à chaque fois', async () => {
    for (const path of ['/', '/index.html', '/confidentialite.html', '/sw.js', '/push-sw.js', '/share-sw.js', '/registerSW.js', '/manifest.webmanifest']) {
      expect((await served(path)).headers.get('Cache-Control'), path).toBe(REVALIDATE);
    }
    expect((await served('/presentation', 'text/html; charset=utf-8')).headers.get('Cache-Control')).toBe(REVALIDATE);
  });

  it('les autres fichiers (icônes, polices, noms non hachés) gardent le cache de l’origine', async () => {
    for (const path of ['/pwa-192x192.png', '/fonts/google-sans-flex-latin-wght.woff2', '/assets/logo.svg']) {
      expect((await served(path, 'image/png')).headers.get('Cache-Control'), path).toBe('max-age=14400');
    }
  });

  it('cacheControlFor (fonction pure)', () => {
    expect(cacheControlFor('/assets/x-12345678.js', null)).toBe(IMMUTABLE);
    expect(cacheControlFor('/assets/x-1234567.js', null)).toBeNull();
    expect(cacheControlFor('/docs/', null)).toBe(REVALIDATE);
    expect(cacheControlFor('/robots.txt', 'text/plain')).toBeNull();
  });
});

describe('cache de Cloudflare', () => {
  it('va chercher le service worker et le manifeste sans le cache de Cloudflare', async () => {
    for (const path of ['/sw.js', '/push-sw.js', '/share-sw.js', '/registerSW.js', '/manifest.webmanifest']) {
      const f = vi.fn(async () => new Response('x', { status: 200 }));
      vi.stubGlobal('fetch', f);
      await call(`https://pecule-app.com${path}`);
      expect(f, path).toHaveBeenCalledWith(expect.any(Request), { cache: 'no-store' });
    }
  });

  it('laisse le cache de Cloudflare servir les fichiers hachés et les pages', async () => {
    for (const path of ['/assets/index-AbCd1234.js', '/', '/presentation.html']) {
      const f = vi.fn(async () => new Response('x', { status: 200 }));
      vi.stubGlobal('fetch', f);
      await call(`https://pecule-app.com${path}`);
      expect(f, path).toHaveBeenCalledWith(expect.any(Request));
      expect(f.mock.calls[0], path).toHaveLength(1);
    }
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
