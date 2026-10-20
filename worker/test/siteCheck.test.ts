import { describe, it, expect, vi } from 'vitest';
import { checkSite, cachedSiteCheck, mainScriptUrl, SITE_CHECK_KEY } from '../src/siteCheck';
import { MemoryKV } from './kvFake';

// index.html tel que Vite le produit (base relative './').
const INDEX = '<!doctype html><title>Pécule</title><script type="module" crossorigin src="./assets/index-Ab12.js"></script>';
const page = (status: number, body = '<title>Pécule</title>', hsts = true) =>
  new Response(body, { status, headers: hsts ? { 'strict-transport-security': 'max-age=31536000' } : {} });
const script = (status = 200, type = 'application/javascript; charset=utf-8') =>
  new Response('console.log(1)', { status, headers: { 'content-type': type } });

/** Faux site : l'accueil cite le script, qui répond selon `bundle`. */
const site = (bundle: () => Response | Promise<Response> = () => script()) => vi.fn(async (url: string) => {
  if (url.endsWith('.js')) return bundle();
  if (url.endsWith('/')) return page(200, INDEX);
  return page(200);
}) as unknown as typeof fetch & ReturnType<typeof vi.fn>;

describe('contrôle du site par le serveur', () => {
  it('toutes les pages répondent et contiennent « Pécule », le script principal se charge ; HSTS vu sur l\'accueil', async () => {
    const fetcher = site();
    const r = await checkSite('https://pecule-app.com/', fetcher, new Date('2026-10-14T07:00:00Z'));
    expect(r).toEqual({ checkedAt: '2026-10-14T07:00:00.000Z', ok: true, failing: [], hsts: true });
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(fetcher).toHaveBeenCalledWith('https://pecule-app.com/assets/index-Ab12.js', expect.anything());
  });

  it('signale les pages en échec, injoignables ou sans contenu attendu', async () => {
    const fetcher = (async (url: string) => {
      if (url.endsWith('presentation.html')) return page(403, 'Forbidden');
      if (url.endsWith('confidentialite.html')) throw new TypeError('réseau');
      return page(200, 'page vide', false);
    }) as unknown as typeof fetch;
    const r = await checkSite('https://pecule-app.com', fetcher);
    expect(r.ok).toBe(false);
    expect(r.failing).toEqual(['/ (200)', '/ (script principal introuvable)', '/confidentialite.html (injoignable)', '/presentation.html (403)']);
    expect(r.hsts).toBe(false);
  });

  describe('écran blanc : index.html répond mais le script principal ne se charge pas', () => {
    it.each([
      ['fichier manquant (404)', () => script(404, 'text/html'), '/assets/index-Ab12.js (404)'],
      ['page HTML servie à sa place', () => script(200, 'text/html; charset=utf-8'), '/assets/index-Ab12.js (type text/html)'],
      ['sans type', () => new Response('x', { status: 200 }), '/assets/index-Ab12.js (type text/plain)'],
      ['injoignable', () => { throw new TypeError('réseau'); }, '/assets/index-Ab12.js (injoignable)'],
    ])('%s', async (_label, bundle, failure) => {
      const r = await checkSite('https://pecule-app.com/', site(bundle as () => Response));
      expect(r.ok).toBe(false);
      expect(r.failing).toEqual([failure]);
    });

    it('index.html sans script principal (build cassé)', async () => {
      const fetcher = vi.fn(async () => page(200)) as unknown as typeof fetch;
      const r = await checkSite('https://pecule-app.com/', fetcher);
      expect(r.failing).toEqual(['/ (script principal introuvable)']);
    });
  });

  it('script principal : chemin relatif, absolu ou sous un dossier ; jamais une autre origine', () => {
    expect(mainScriptUrl(INDEX, 'https://pecule-app.com/')).toBe('https://pecule-app.com/assets/index-Ab12.js');
    expect(mainScriptUrl(INDEX, 'https://owner.github.io/suivi-epargne/')).toBe('https://owner.github.io/suivi-epargne/assets/index-Ab12.js');
    expect(mainScriptUrl('<script src="/x.js" type=module></script>', 'https://pecule-app.com/')).toBe('https://pecule-app.com/x.js');
    // Un script classique (pas un module) n'est pas l'app ; un script d'une autre origine non plus.
    expect(mainScriptUrl('<script src="./sw.js"></script>', 'https://pecule-app.com/')).toBeNull();
    expect(mainScriptUrl('<script type="module" src="https://evil.example/x.js"></script>', 'https://pecule-app.com/')).toBeNull();
    expect(mainScriptUrl('<script type="module">inline()</script>', 'https://pecule-app.com/')).toBeNull();
  });

  it('sous un dossier, l’échec est signalé par rapport à la racine de l’app', async () => {
    const r = await checkSite('https://owner.github.io/suivi-epargne', site(() => script(404)));
    expect(r.failing).toEqual(['/assets/index-Ab12.js (404)']);
  });

  it('réutilise le dernier contrôle pendant 15 min, puis en refait un', async () => {
    const kv = new MemoryKV();
    const fetcher = site();
    const t0 = new Date('2026-10-14T07:00:00Z');
    await cachedSiteCheck(kv.asKV(), 'https://pecule-app.com/', fetcher, t0);
    await cachedSiteCheck(kv.asKV(), 'https://pecule-app.com/', fetcher, new Date(t0.getTime() + 10 * 60_000));
    expect(fetcher).toHaveBeenCalledTimes(4);
    await cachedSiteCheck(kv.asKV(), 'https://pecule-app.com/', fetcher, new Date(t0.getTime() + 16 * 60_000));
    expect(fetcher).toHaveBeenCalledTimes(8);
    expect(await kv.asKV().get(SITE_CHECK_KEY)).toContain('"ok":true');
  });
});
