// Contrôle des en-têtes après déploiement (scripts/check-edge.mjs).
import { describe, expect, it, vi } from 'vitest';
import { SITE_URL, checkEdge, edgeVerdict } from './check-edge.mjs';

const reply = (status: number, csp: string | null) =>
  new Response('<html></html>', { status, headers: csp ? { 'Content-Security-Policy': csp } : {} });
const fast = { delayMs: 0 };

describe('check-edge', () => {
  it('exige 200 et un Content-Security-Policy non vide', () => {
    expect(edgeVerdict(SITE_URL, { status: 200, csp: "default-src 'self'" }).ok).toBe(true);
    expect(edgeVerdict(SITE_URL, { status: 200, csp: null }).ok).toBe(false);
    expect(edgeVerdict(SITE_URL, { status: 200, csp: '  ' }).ok).toBe(false);
    expect(edgeVerdict(SITE_URL, { status: 503, csp: "default-src 'self'" }).message).toMatch(/503/);
  });

  it('réussit dès qu\'un essai passe (en-têtes pas encore propagés au premier)', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(reply(200, null)).mockResolvedValue(reply(200, "default-src 'self'"));
    expect((await checkEdge(SITE_URL, { fetchImpl, ...fast })).ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('échoue après tous les essais, réseau coupé compris', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('réseau'));
    const v = await checkEdge(SITE_URL, { fetchImpl, attempts: 3, ...fast });
    expect(v.ok).toBe(false);
    expect(v.message).toMatch(/injoignable/);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const noCsp = vi.fn().mockResolvedValue(reply(200, null));
    expect((await checkEdge(SITE_URL, { fetchImpl: noCsp, attempts: 2, ...fast })).ok).toBe(false);
    expect(noCsp).toHaveBeenCalledTimes(2);
  });
});
