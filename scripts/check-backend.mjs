// Garde-fou de publication : le serveur que vise le build (VITE_BACKEND_URL de .env.production,
// la même adresse que la CSP) doit répondre AVANT que le site soit mis en ligne. Sinon l'app
// publiée appellerait une adresse morte : plus de connexion persistante, de rappels ni de
// sauvegarde de secours. Cas réel (30/10/2026) : .env.production passé à api.pecule-app.com
// avant que le domaine soit créé dans Cloudflare.
//   node scripts/check-backend.mjs [fichier .env, « .env.production » par défaut]
// Vérifie GET /status : code 200, `ok: true`, et l'en-tête CORS rendu à l'app (le domaine
// mène bien au Worker de Pécule, réglé pour pecule-app.com). Lancé par
// .github/workflows/deploy.yml (job « Serveur joignable »).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const APP_ORIGIN = 'https://pecule-app.com';

/** Origine du serveur lue dans le texte d'un fichier .env, ou null. */
export const backendOriginFrom = envText => {
  const raw = /^VITE_BACKEND_URL=(.*)$/m.exec(envText)?.[1]?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' ? url.origin : null;
  } catch { return null; }
};

/** Verdict sur la réponse de /status (status, en-tête CORS, corps JSON déjà lu ou null). */
export const statusVerdict = (origin, { status, allowOrigin, body }, appOrigin = APP_ORIGIN) => {
  if (status !== 200) return { ok: false, message: `Serveur ${origin}/status : code HTTP ${status}.` };
  if (!body || body.ok !== true) return { ok: false, message: `Serveur ${origin}/status : réponse inattendue (pas de « ok: true »).` };
  if (allowOrigin !== appOrigin) {
    return { ok: false, message: `Serveur ${origin} : l'en-tête CORS ne vise pas ${appOrigin} (reçu « ${allowOrigin ?? 'aucun'} ») ; l'app ne pourrait pas lui parler.` };
  }
  return { ok: true, message: `Serveur ${origin} joignable (status 200, ok, CORS ${appOrigin}).` };
};

/** Contrôle complet. Ne lève pas : rend le verdict. `fetchImpl` remplaçable pour les tests. */
export const checkBackend = async (envText, { fetchImpl = fetch, attempts = 3, delayMs = 5000, timeoutMs = 20000, appOrigin = APP_ORIGIN } = {}) => {
  const origin = backendOriginFrom(envText);
  if (!origin) return { ok: false, message: 'VITE_BACKEND_URL absent ou invalide (https attendu) dans le fichier .env.' };
  let last = { ok: false, message: `Serveur ${origin}/status : aucune réponse.` };
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await new Promise(r => setTimeout(r, delayMs));
    try {
      const res = await fetchImpl(`${origin}/status`, { headers: { Origin: appOrigin }, signal: AbortSignal.timeout(timeoutMs) });
      let body = null;
      try { body = await res.json(); } catch { body = null; }
      last = statusVerdict(origin, { status: res.status, allowOrigin: res.headers.get('Access-Control-Allow-Origin'), body }, appOrigin);
      if (last.ok) return last;
    } catch (e) {
      const reason = e?.cause?.code || e?.cause?.message || e?.message || String(e);
      last = { ok: false, message: `Serveur ${origin}/status injoignable (${reason}). Domaine créé dans Cloudflare ? (ROADMAP.md, MAINTENANCE.md § 8)` };
    }
  }
  return last;
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = process.argv[2] || '.env.production';
  let text;
  try { text = readFileSync(file, 'utf8'); } catch { text = ''; }
  const { ok, message } = text ? await checkBackend(text) : { ok: false, message: `Fichier ${file} introuvable ou vide.` };
  (ok ? console.log : console.error)(message);
  // exitCode plutôt que process.exit() : quitter de force juste après un fetch fait planter
  // Node sous Windows (assertion libuv, code 127).
  process.exitCode = ok ? 0 : 1;
}
