// ================================================
// FILE: edge/src/index.ts
// Worker « de bordure » devant GitHub Pages (route pecule-app.com/*).
//
// GitHub Pages ne permet pas de choisir ses en-têtes HTTP. Ce Worker relaie chaque
// requête telle quelle vers l'origine (fetch(request) sur une route = GitHub Pages) et
// ajoute seulement des en-têtes de sécurité à la réponse. Il ne modifie ni le contenu,
// ni le statut, ni les en-têtes de cache de l'origine.
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

const withSecurityHeaders = (res: Response): Response => {
  // Les en-têtes d'une réponse fetch() sont immuables : copie (le corps est relayé en flux,
  // sans être lu ni modifié).
  const out = new Response(res.body, res);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) out.headers.set(name, value);
  out.headers.append('Content-Security-Policy', FRAME_ANCESTORS_CSP);
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

    return withSecurityHeaders(await fetch(request));
  },
} satisfies ExportedHandler;
