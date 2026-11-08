import { describe, it, expect, afterEach, vi } from 'vitest';
import edge, { REVALIDATE, cspFromHtml, stripHtmlComments } from '../src/index';

const origin = (init: ResponseInit = {}, body: BodyInit | null = '<!doctype html><title>Pécule</title>') =>
  vi.fn(async (_req: Request) => new Response(body, {
    status: 200,
    ...init,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'max-age=600', ...(init.headers as Record<string, string> | undefined) },
  }));

const call = (url: string, init?: RequestInit) => edge.fetch(new Request(url, init));

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const PAGE = `<!doctype html>
<html><head>
<!-- <meta http-equiv="Content-Security-Policy" content="default-src 'none'"> -->
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="
  default-src 'self';
  script-src 'self' https://accounts.google.com/gsi/client;
  connect-src 'self' https://api.pecule-app.com;
  object-src 'none';
">
<title>Pécule</title></head><body><script src="/assets/index-AbCd1234.js"></script></body></html>`;

const POLICY = "default-src 'self'; script-src 'self' https://accounts.google.com/gsi/client; connect-src 'self' https://api.pecule-app.com; object-src 'none'";

describe('CSP recopiée en en-tête', () => {
  it('cspFromHtml : politique sur plusieurs lignes normalisée, commentaires ignorés', () => {
    expect(cspFromHtml(PAGE)).toBe(POLICY);
    expect(cspFromHtml(`<META CONTENT='a  b;' HTTP-EQUIV='content-security-policy'>`)).toBe('a b');
  });

  it('cspFromHtml : null sans balise ou sans contenu', () => {
    expect(cspFromHtml('<!doctype html><title>x</title>')).toBeNull();
    expect(cspFromHtml('<meta name="referrer" content="no-referrer">')).toBeNull();
    expect(cspFromHtml('<meta http-equiv="Content-Security-Policy">')).toBeNull();
  });

  it('page HTML en 200 : en-tête CSP + report-uri + report-to, Reporting-Endpoints, corps identique', async () => {
    vi.stubGlobal('fetch', origin({}, PAGE));
    const res = await call('https://pecule-app.com/');
    expect(res.headers.get('Content-Security-Policy')).toBe(`${POLICY}; report-uri /csp-report; report-to csp, frame-ancestors 'none'`);
    expect(res.headers.get('Reporting-Endpoints')).toBe('csp="/csp-report"');
    expect(res.headers.get('Cache-Control')).toBe(REVALIDATE);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(PAGE);
  });

  it('page sans balise : seulement frame-ancestors, corps identique', async () => {
    vi.stubGlobal('fetch', origin({}, '<!doctype html><title>Présentation</title>'));
    const res = await call('https://pecule-app.com/presentation.html');
    expect(res.headers.get('Content-Security-Policy')).toBe("frame-ancestors 'none'");
    expect(res.headers.get('Reporting-Endpoints')).toBeNull();
    expect(await res.text()).toBe('<!doctype html><title>Présentation</title>');
  });

  it('réponse non HTML ou autre que 200 : inchangée', async () => {
    vi.stubGlobal('fetch', origin({ headers: { 'Content-Type': 'application/javascript' } }, PAGE));
    const js = await call('https://pecule-app.com/assets/index-AbCd1234.js');
    expect(js.headers.get('Content-Security-Policy')).toBe("frame-ancestors 'none'");
    expect(js.headers.get('Reporting-Endpoints')).toBeNull();
    vi.stubGlobal('fetch', origin({ status: 404 }, PAGE));
    const nf = await call('https://pecule-app.com/absent');
    expect(nf.headers.get('Content-Security-Policy')).toBe("frame-ancestors 'none'");
    expect(await nf.text()).toBe(PAGE);
  });
});

describe('POST /csp-report', () => {
  const warn = () => vi.spyOn(console, 'warn').mockImplementation(() => {});
  const report = (body: string, type = 'application/csp-report', extra: Record<string, string> = {}) =>
    call('https://pecule-app.com/csp-report', { method: 'POST', body, headers: { 'Content-Type': type, 'User-Agent': 'SecretBrowser/9', ...extra } });

  it('format historique : une ligne compacte, sans paramètres ni agent utilisateur', async () => {
    const w = warn();
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    const res = await report(JSON.stringify({ 'csp-report': {
      'document-uri': 'https://pecule-app.com/?token=abc#frag', 'violated-directive': "script-src-elem 'self'", 'effective-directive': 'script-src-elem',
      'blocked-uri': 'https://evil.example/x.js?secret=1', disposition: 'enforce', 'original-policy': 'default-src', 'source-file': 'https://pecule-app.com/a.js', 'user-agent': 'SecretBrowser/9',
    } }));
    expect(res.status).toBe(204);
    expect(f).not.toHaveBeenCalled();
    expect(w).toHaveBeenCalledTimes(1);
    const line = String(w.mock.calls[0][0]);
    expect(line).toBe('csp-violation directive=script-src-elem blocked=https://evil.example page=/ disposition=enforce');
    expect(line).not.toMatch(/token|secret|SecretBrowser|a\.js/);
  });

  it('format Reporting API : un tableau, mots-clés inline / eval / data', async () => {
    const w = warn();
    const res = await report(JSON.stringify([
      { type: 'csp-violation', user_agent: 'SecretBrowser/9', body: { documentURL: 'https://pecule-app.com/confidentialite.html?a=1', effectiveDirective: 'script-src-elem', blockedURL: 'inline', disposition: 'report' } },
      { type: 'csp-violation', body: { documentURL: 'https://pecule-app.com/', effectiveDirective: 'img-src', blockedURL: 'data:image/png;base64,AAAA', disposition: 'enforce' } },
      { type: 'csp-violation', body: { documentURL: 'https://pecule-app.com/', effectiveDirective: 'script-src', blockedURL: 'eval' } },
      { type: 'deprecation', body: { id: 'x' } },
    ]), 'application/reports+json; charset=utf-8');
    expect(res.status).toBe(204);
    expect(w.mock.calls.map(c => c[0])).toEqual([
      'csp-violation directive=script-src-elem blocked=inline page=/confidentialite.html disposition=report',
      'csp-violation directive=img-src blocked=data page=/ disposition=enforce',
      'csp-violation directive=script-src blocked=eval page=/ disposition=enforce',
    ]);
  });

  it('plus de 16 Ko : 413 ; autre type : 415 ; JSON illisible ou sans rapport : 204 sans rien noter', async () => {
    const w = warn();
    expect((await report('x'.repeat(16 * 1024 + 1))).status).toBe(413);
    expect((await report('{}', 'application/csp-report', { 'Content-Length': '99999' })).status).toBe(413);
    expect((await report('{}', 'text/plain')).status).toBe(415);
    expect((await report('pas du json')).status).toBe(204);
    expect((await report('pas du json', 'application/reports+json')).status).toBe(204);
    expect((await report('{"a":1}')).status).toBe(204);
    expect(w).not.toHaveBeenCalled();
  });

  it('valeurs inattendues : mots neutres, rien de brut dans le journal', async () => {
    const w = warn();
    await report(JSON.stringify({ 'csp-report': { 'document-uri': 'pas une adresse', 'violated-directive': '<script>alert(1)</script>', 'blocked-uri': 'ftp://h.example/p?q=1', disposition: 'autre' } }));
    expect(w.mock.calls[0][0]).toBe('csp-violation directive=inconnu blocked=ftp page=inconnu disposition=enforce');
  });

  it('les autres POST (et un PUT sur /csp-report) sont toujours relayés', async () => {
    const f = vi.fn(async () => new Response('ok', { status: 405 }));
    vi.stubGlobal('fetch', f);
    expect((await call('https://pecule-app.com/ailleurs', { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/csp-report' } })).status).toBe(405);
    expect((await call('https://pecule-app.com/csp-report', { method: 'PUT', body: '{}' })).status).toBe(405);
    expect(f).toHaveBeenCalledTimes(2);
  });
});

describe('commentaires HTML retirés en une seule passe', () => {
  it('retire chaque commentaire, et tout ce qui suit un commentaire non fermé', () => {
    expect(stripHtmlComments('a<!-- un -->b<!-- deux -->c')).toBe('abc');
    expect(stripHtmlComments('a<!-- jamais fermé <meta http-equiv="Content-Security-Policy">')).toBe('a');
    expect(stripHtmlComments('sans commentaire')).toBe('sans commentaire');
  });

  it('une balise citée dans un commentaire ne compte pas', () => {
    const html = '<!-- <meta http-equiv="Content-Security-Policy" content="default-src *"> --><meta http-equiv="Content-Security-Policy" content="default-src \'self\'">';
    expect(cspFromHtml(html)).toBe("default-src 'self'");
  });

  it('beaucoup de débuts de commentaire sans fin : réponse immédiate', () => {
    const html = '<!--'.repeat(50_000);
    const started = performance.now();
    expect(stripHtmlComments(html)).toBe('');
    expect(performance.now() - started).toBeLessThan(500);
  });
});
