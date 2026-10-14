import { describe, it, expect, vi } from 'vitest';
import { checkSite, cachedSiteCheck, SITE_CHECK_KEY } from '../src/siteCheck';
import { MemoryKV } from './kvFake';

const page = (status: number, body = '<title>Pécule</title>', hsts = true) =>
  new Response(body, { status, headers: hsts ? { 'strict-transport-security': 'max-age=31536000' } : {} });

describe('contrôle du site par le serveur', () => {
  it('toutes les pages répondent et contiennent « Pécule » ; HSTS vu sur l\'accueil', async () => {
    const fetcher = vi.fn(async () => page(200)) as unknown as typeof fetch;
    const r = await checkSite('https://pecule-app.com/', fetcher, new Date('2026-10-14T07:00:00Z'));
    expect(r).toEqual({ checkedAt: '2026-10-14T07:00:00.000Z', ok: true, failing: [], hsts: true });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('signale les pages en échec, injoignables ou sans contenu attendu', async () => {
    const fetcher = (async (url: string) => {
      if (url.endsWith('presentation.html')) return page(403, 'Forbidden');
      if (url.endsWith('confidentialite.html')) throw new TypeError('réseau');
      return page(200, 'page vide', false);
    }) as unknown as typeof fetch;
    const r = await checkSite('https://pecule-app.com', fetcher);
    expect(r.ok).toBe(false);
    expect(r.failing).toEqual(['/ (200)', '/confidentialite.html (injoignable)', '/presentation.html (403)']);
    expect(r.hsts).toBe(false);
  });

  it('réutilise le dernier contrôle pendant 15 min, puis en refait un', async () => {
    const kv = new MemoryKV();
    const fetcher = vi.fn(async () => page(200)) as unknown as typeof fetch;
    const t0 = new Date('2026-10-14T07:00:00Z');
    await cachedSiteCheck(kv.asKV(), 'https://pecule-app.com/', fetcher, t0);
    await cachedSiteCheck(kv.asKV(), 'https://pecule-app.com/', fetcher, new Date(t0.getTime() + 10 * 60_000));
    expect(fetcher).toHaveBeenCalledTimes(3);
    await cachedSiteCheck(kv.asKV(), 'https://pecule-app.com/', fetcher, new Date(t0.getTime() + 16 * 60_000));
    expect(fetcher).toHaveBeenCalledTimes(6);
    expect(await kv.asKV().get(SITE_CHECK_KEY)).toContain('"ok":true');
  });
});
