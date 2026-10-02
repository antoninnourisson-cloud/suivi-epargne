import { describe, it, expect } from 'vitest';
import { htmlToText, fetchFiscalSources, FISCAL_SOURCE_URLS } from '../src/fiscalSources';

describe('sources de la veille fiscale', () => {
  it('garde le texte utile de la page', () => {
    const html = '<html><header>Menu</header><main><h1>Livret A</h1><script>x()</script><p>Le taux est de 1,7&nbsp;%.</p><nav>liens</nav></main><footer>pied</footer></html>';
    const t = htmlToText(html);
    expect(t).toContain('Livret A');
    expect(t).toContain('1,7 %');
    expect(t).not.toContain('x()');
    expect(t).not.toContain('liens');
  });
  it('ne lit que des pages officielles', () => {
    expect(FISCAL_SOURCE_URLS.every(s => /^https:\/\/www\.(service-public|economie)\.gouv\.fr\//.test(s.url))).toBe(true);
  });
  it('signale une page injoignable sans tout faire échouer', async () => {
    const fake = (async (u: string) => (u.includes('F2365') ? new Response('<main>ok 1,7 %</main>') : new Response('', { status: 503 }))) as unknown as typeof fetch;
    const r = await fetchFiscalSources(fake);
    expect(r.find(x => x.url.includes('F2365'))?.ok).toBe(true);
    expect(r.filter(x => !x.ok).length).toBe(FISCAL_SOURCE_URLS.length - 1);
  });
});
