// ================================================
// FILE: edge/src/index.ts
// Worker « de bordure » devant GitHub Pages (route pecule-app.com/*).
//
// GitHub Pages ne permet pas de choisir ses en-têtes HTTP. Ce Worker relaie chaque
// requête telle quelle vers l'origine (fetch(request) sur une route = GitHub Pages) et
// ajoute des en-têtes de sécurité à la réponse. Il ne modifie ni le contenu, ni le statut.
//
// Cache (réponses 200 et 304 seulement ; le reste garde l'en-tête de l'origine) :
// - fichiers au nom haché par Vite (/assets/nom-HASH.js, workbox-HASH.js) : un an,
//   « immutable » : leur contenu ne change jamais sous le même nom ;
// - pages HTML, service worker (sw.js), ses extensions (push-sw.js et share-sw.js, importées
//   par sw.js, donc servies par le cache HTTP : voir updateViaCache), registerSW.js et le
//   manifeste : « no-cache », revalidés à chaque fois, pour qu'une mise à jour arrive tout
//   de suite ; le service worker et le manifeste ne passent pas non plus par le cache de
//   Cloudflare (fetch en « no-store »).
// Sans ce Worker, Cloudflare imposait 4 heures à tout (réglage « Browser Cache TTL »).
//
// Politique de contenu (CSP) : la balise <meta> d'index.html reste la seule source de vérité
// (Vite y écrit l'adresse du serveur à la construction, que ce Worker ne connaît pas). Pour
// une page HTML en 200 qui porte cette balise, le Worker en recopie la politique telle quelle
// dans un en-tête HTTP (le corps est lu en entier, quelques ko, puis renvoyé à l'identique),
// avec « report-uri /csp-report » et « report-to csp » (+ Reporting-Endpoints) pour recevoir
// les violations. Une page sans balise (presentation.html, confidentialite.html) ou toute
// autre réponse garde son corps tel quel. frame-ancestors, qu'une balise <meta> ne peut pas
// exprimer, reste un en-tête séparé, ajouté dans tous les cas.
//
// POST /csp-report : reçoit les rapports du navigateur (application/csp-report ou
// application/reports+json), traités ici, jamais relayés. Une ligne console.warn par
// violation, avec seulement : la règle, le site bloqué (origine seule, ou inline / eval / data),
// le chemin de la page (sans paramètres) et la disposition. Ni adresse complète, ni agent
// utilisateur, ni IP. Réponse 204 ; plus de 16 Ko : 413 ; autre type de contenu : 415.
// Tout autre POST, PUT... est relayé sans modification.
// ================================================

const CANONICAL_HOST = 'pecule-app.com';

export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  // Un an, sous-domaines compris. Pas encore de « preload » : l'inscription dans les
  // navigateurs est quasi irréversible, à décider plus tard.
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  // Anti-clickjacking : l'app ne doit jamais être affichée dans une iframe.
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  // « same-origin » casserait la fenêtre de connexion Google (Google Identity Services
  // communique avec l'app par la fenêtre surgissante) : Google recommande cette valeur.
  'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
};

/** Ajouté (pas remplacé) : si l'origine envoyait un jour sa propre CSP, les deux s'appliqueraient. */
const FRAME_ANCESTORS_CSP = "frame-ancestors 'none'";

export const IMMUTABLE = 'public, max-age=31536000, immutable';
export const REVALIDATE = 'no-cache';

// Nom haché par Vite : « nom-XXXXXXXX.ext » (8 caractères base64url ; le nom peut contenir des tirets).
const HASHED_ASSET = /^\/assets\/[^/]+-[A-Za-z0-9_-]{8}\.[a-z0-9]+$/;
const HASHED_WORKBOX = /^\/workbox-[0-9a-f]{8}\.js$/;
const ALWAYS_FRESH = new Set(['/sw.js', '/push-sw.js', '/share-sw.js', '/registerSW.js', '/manifest.webmanifest']);

/** En-tête Cache-Control à imposer pour ce chemin, ou `null` pour garder celui de l'origine. */
export const cacheControlFor = (pathname: string, contentType: string | null): string | null => {
  if (HASHED_ASSET.test(pathname) || HASHED_WORKBOX.test(pathname)) return IMMUTABLE;
  if (ALWAYS_FRESH.has(pathname) || pathname.endsWith('/') || pathname.endsWith('.html')) return REVALIDATE;
  if ((contentType || '').startsWith('text/html')) return REVALIDATE;
  return null;
};

const CSP_REPORT_PATH = '/csp-report';
const CSP_REPORT_MAX_BYTES = 16 * 1024;
const CSP_REPORT_MAX_ENTRIES = 20;

/** Politique de la balise <meta http-equiv="Content-Security-Policy">, espaces normalisés, ou `null`. */
export const cspFromHtml = (html: string): string | null => {
  // Les commentaires peuvent citer la balise sans qu'elle s'applique.
  for (const tag of html.replace(/<!--[\s\S]*?-->/g, '').match(/<meta\b[^>]*>/gi) ?? []) {
    if (!/\bhttp-equiv\s*=\s*["']?content-security-policy["'\s/>]/i.test(tag)) continue;
    const content = /\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag);
    const policy = (content?.[1] ?? content?.[2] ?? '').replace(/\s+/g, ' ').trim().replace(/;$/, '').trim();
    return policy || null;
  }
  return null;
};

const withSecurityHeaders = (res: Response, pathname: string, body: BodyInit | null = res.body, csp: string | null = null): Response => {
  // Les en-têtes d'une réponse fetch() sont immuables : copie (hors CSP, le corps est relayé
  // en flux, sans être lu ni modifié).
  const out = new Response(body, res);
  if (csp) {
    out.headers.append('Content-Security-Policy', `${csp}; report-uri ${CSP_REPORT_PATH}; report-to csp`);
    out.headers.set('Reporting-Endpoints', `csp="${CSP_REPORT_PATH}"`);
  }
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) out.headers.set(name, value);
  out.headers.append('Content-Security-Policy', FRAME_ANCESTORS_CSP);
  if (res.status === 200 || res.status === 304) {
    const cache = cacheControlFor(pathname, res.headers.get('Content-Type'));
    if (cache) {
      out.headers.set('Cache-Control', cache);
      // Un « Expires » de l'origine contredirait la nouvelle durée (Cache-Control l'emporte,
      // mais autant ne rien laisser d'ambigu).
      out.headers.delete('Expires');
    }
  }
  return out;
};

/** Adresse bloquée réduite à son site, ou à un mot (inline, eval, data...). */
const blockedSite = (raw: unknown): string => {
  if (typeof raw !== 'string' || !raw) return 'inconnu';
  if (/^data:/i.test(raw)) return 'data';
  if (/^[a-z-]{1,20}$/i.test(raw)) return raw.toLowerCase();
  try {
    const u = new URL(raw);
    return ['http:', 'https:', 'ws:', 'wss:'].includes(u.protocol) ? u.origin : u.protocol.slice(0, -1).slice(0, 20);
  } catch {
    return 'inconnu';
  }
};

const pathOf = (raw: unknown): string => {
  if (typeof raw !== 'string') return 'inconnu';
  try { return new URL(raw).pathname.slice(0, 100); } catch { return 'inconnu'; }
};

const directiveOf = (raw: unknown): string => {
  const first = typeof raw === 'string' ? raw.trim().split(/\s+/)[0] : '';
  return /^[a-z-]{1,40}$/.test(first) ? first : 'inconnu';
};

const logViolation = (v: Record<string, unknown>): void => {
  const directive = directiveOf(v['effective-directive'] ?? v.effectiveDirective ?? v['violated-directive'] ?? v.violatedDirective);
  const disposition = v.disposition === 'report' ? 'report' : 'enforce';
  console.warn(`csp-violation directive=${directive} blocked=${blockedSite(v['blocked-uri'] ?? v.blockedURL)} page=${pathOf(v['document-uri'] ?? v.documentURL)} disposition=${disposition}`);
};

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

const handleCspReport = async (request: Request): Promise<Response> => {
  const type = (request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/csp-report' && type !== 'application/reports+json') return new Response(null, { status: 415 });
  if (Number(request.headers.get('Content-Length')) > CSP_REPORT_MAX_BYTES) return new Response(null, { status: 413 });
  const raw = await request.arrayBuffer();
  if (raw.byteLength > CSP_REPORT_MAX_BYTES) return new Response(null, { status: 413 });
  try {
    const data: unknown = JSON.parse(new TextDecoder().decode(raw));
    if (type === 'application/csp-report') {
      if (isRecord(data) && isRecord(data['csp-report'])) logViolation(data['csp-report']);
    } else if (Array.isArray(data)) {
      for (const entry of data.slice(0, CSP_REPORT_MAX_ENTRIES)) {
        if (isRecord(entry) && entry.type === 'csp-violation' && isRecord(entry.body)) logViolation(entry.body);
      }
    }
  } catch {
    // JSON illisible : rien à noter.
  }
  return new Response(null, { status: 204 });
};

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // www.pecule-app.com → https://pecule-app.com, chemin et paramètres conservés.
    if (url.hostname === `www.${CANONICAL_HOST}`) {
      url.protocol = 'https:';
      url.hostname = CANONICAL_HOST;
      url.port = '';
      url.hash = ''; // jamais envoyé par un navigateur, qui reporte lui-même l'ancre d'origine
      const safe = request.method === 'GET' || request.method === 'HEAD';
      // 308 pour les autres méthodes : le navigateur garde la méthode et le corps.
      return new Response(null, { status: safe ? 301 : 308, headers: { Location: url.toString() } });
    }

    if (request.method === 'POST' && url.pathname === CSP_REPORT_PATH) return handleCspReport(request);

    // Seules les pages et fichiers servis (GET/HEAD) reçoivent les en-têtes ; le reste est
    // relayé sans aucune modification.
    if (request.method !== 'GET' && request.method !== 'HEAD') return fetch(request);

    // Service worker et manifeste : jamais pris dans le cache de Cloudflare non plus (il
    // gardait sw.js 10 minutes, la durée donnée par GitHub Pages, et retardait d'autant la
    // mise à jour des apps installées, 30 octobre 2026).
    const upstream = ALWAYS_FRESH.has(url.pathname) ? await fetch(request, { cache: 'no-store' }) : await fetch(request);
    // Page HTML en 200 : lue en entier pour recopier la CSP de sa balise <meta> (quelques ko).
    if (request.method === 'GET' && upstream.status === 200 && (upstream.headers.get('Content-Type') || '').toLowerCase().startsWith('text/html')) {
      const text = await upstream.text();
      return withSecurityHeaders(upstream, url.pathname, text, cspFromHtml(text));
    }
    return withSecurityHeaders(upstream, url.pathname);
  },
} satisfies ExportedHandler;
