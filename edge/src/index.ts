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
//   de suite.
// Sans ce Worker, Cloudflare imposait 4 heures à tout (réglage « Browser Cache TTL »).
//
// La politique de contenu complète (CSP) reste dans la balise <meta> d'index.html, seule
// source de vérité : ici, uniquement frame-ancestors, qu'une balise <meta> ne peut pas
// exprimer.
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

const withSecurityHeaders = (res: Response, pathname: string): Response => {
  // Les en-têtes d'une réponse fetch() sont immuables : copie (le corps est relayé en flux,
  // sans être lu ni modifié).
  const out = new Response(res.body, res);
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

    // Seules les pages et fichiers servis (GET/HEAD) reçoivent les en-têtes ; le reste est
    // relayé sans aucune modification.
    if (request.method !== 'GET' && request.method !== 'HEAD') return fetch(request);

    return withSecurityHeaders(await fetch(request), url.pathname);
  },
} satisfies ExportedHandler;
