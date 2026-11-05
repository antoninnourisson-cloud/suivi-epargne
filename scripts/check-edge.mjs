// Contrôle après la mise en ligne du Worker des en-têtes (edge/) : la page d'accueil du site
// doit porter l'en-tête Content-Security-Policy. Sinon le Worker n'est pas devant le site
// (route absente, enregistrements DNS pas « Proxied ») ou sa dernière version est cassée.
//   node scripts/check-edge.mjs [adresse, « https://pecule-app.com/ » par défaut]
// Variables : CHECK_ATTEMPTS (essais, 5 par défaut), CHECK_DELAY_MS (attente entre essais,
// 10 000 par défaut). Lancé par .github/workflows/deploy.yml (job « edge »), qui revient à la
// version précédente du Worker en cas d'échec. Test : scripts/check-edge.test.ts.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SITE_URL = 'https://pecule-app.com/';

/** Verdict sur la réponse de la page d'accueil (code HTTP et en-tête CSP, ou null). */
export const edgeVerdict = (url, { status, csp }) => {
  if (status !== 200) return { ok: false, message: `Site ${url} : code HTTP ${status}.` };
  if (!csp || !csp.trim()) return { ok: false, message: `Site ${url} : l'en-tête Content-Security-Policy est absent (le Worker des en-têtes ne répond pas devant le site).` };
  return { ok: true, message: `Site ${url} : Content-Security-Policy présent.` };
};

/** Contrôle complet avec quelques essais espacés. Ne lève pas. `fetchImpl` remplaçable pour les tests. */
export const checkEdge = async (url = SITE_URL, { fetchImpl = fetch, attempts = 5, delayMs = 10000, timeoutMs = 20000 } = {}) => {
  let last = { ok: false, message: `Site ${url} : aucune réponse.` };
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await new Promise(r => setTimeout(r, delayMs));
    try {
      const res = await fetchImpl(url, { headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(timeoutMs) });
      last = edgeVerdict(url, { status: res.status, csp: res.headers.get('Content-Security-Policy') });
      if (last.ok) return last;
    } catch (e) {
      const reason = e?.cause?.code || e?.cause?.message || e?.message || String(e);
      last = { ok: false, message: `Site ${url} injoignable (${reason}).` };
    }
  }
  return last;
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { ok, message } = await checkEdge(process.argv[2] || SITE_URL, {
    attempts: Number(process.env.CHECK_ATTEMPTS) || undefined,
    delayMs: Number(process.env.CHECK_DELAY_MS) || undefined,
  });
  (ok ? console.log : console.error)(message);
  // exitCode plutôt que process.exit() : voir check-backend.mjs.
  process.exitCode = ok ? 0 : 1;
}
