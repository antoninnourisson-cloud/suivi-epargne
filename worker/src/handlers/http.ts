// ================================================
// FILE: worker/src/handlers/http.ts
// Réponses HTTP communes (CORS, JSON, page HTML d'erreur, redirection) et limiteurs de débit.
// Découpé de worker/src/index.ts sans changement de comportement.
// ================================================
import { allowedOrigins } from '../security';
import { PROOF_HEADER, NONCE_HEADER } from '../deviceProof';
import type { Env } from '../index';

/** Même valeur que le site (edge/src/index.ts) : HTTPS imposé un an, sous-domaines compris. */
export const HSTS = 'max-age=31536000; includeSubDomains';

export const corsHeaders = (req: Request, env: Env): Record<string, string> => {
  const origin = req.headers.get('Origin');
  if (!origin || !allowedOrigins(env).includes(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': `Authorization, Content-Type, ${PROOF_HEADER}`,
    // Sans cela, l'app (autre origine) ne pourrait pas lire le nonce rendu avec la réponse.
    'Access-Control-Expose-Headers': NONCE_HEADER,
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
};

export const json = (req: Request, env: Env, data: unknown, status = 200, extra: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Strict-Transport-Security': HSTS, ...corsHeaders(req, env), ...extra },
  });

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export const htmlPage = (env: Env, title: string, message: string, status = 400): Response =>
  new Response(
    `<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<body style="font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px">
<main style="max-width:420px;background:#1e293b;padding:28px;border-radius:20px">
<h1 style="font-size:20px;margin:0 0 12px">${escapeHtml(title)}</h1>
<p style="line-height:1.5;color:#94a3b8">${escapeHtml(message)}</p>
<a href="${escapeHtml(env.APP_URL)}" style="display:inline-block;margin-top:12px;background:#14532d;color:white;padding:10px 16px;border-radius:10px;text-decoration:none;font-weight:600">Retour à l'app</a>
</main></body></html>`,
    {
      status,
      headers: {
        'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Strict-Transport-Security': HSTS,
        // Page sans script ni image : seuls les styles en ligne (attributs style) sont permis, et
        // aucune page tierce ne peut l'afficher dans un cadre.
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
        'Referrer-Policy': 'no-referrer',
      },
    }
  );

export const redirect = (location: string, headers: Record<string, string> = {}): Response =>
  new Response(null, { status: 302, headers: { Location: location, 'Cache-Control': 'no-store', 'Strict-Transport-Security': HSTS, ...headers } });

/**
 * Limiteur par compte pour les routes qui ÉCRIVENT dans KV (en plus du limiteur par IP du
 * point d'entrée) : protège le quota d'écritures gratuit même depuis plusieurs adresses.
 * Une clé par route, pour qu'une route très sollicitée n'en bloque pas une autre. `null` si
 * la requête peut continuer, sinon la réponse 429 à renvoyer.
 */
export const accountLimited = async (req: Request, env: Env, route: string, sub: string): Promise<Response | null> =>
  (await rateLimited(env.API_LIMITER, `${route}:${sub}`))
    ? json(req, env, { error: 'RATE_LIMITED' }, 429, { 'Retry-After': '60' })
    : null;

export const rateLimited = async (limiter: RateLimit | undefined, key: string): Promise<boolean> => {
  if (!limiter) return false;
  try { return !(await limiter.limit({ key })).success; } catch { return false; }
};
