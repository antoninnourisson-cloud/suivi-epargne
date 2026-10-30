// Garde-fou de la taille du démarrage : échoue (code 1) si le fichier JS principal de l'app
// (celui que charge index.html, avant tout écran) dépasse le plafond.
//   node scripts/check-bundle-size.mjs [dossier du build, « dist » par défaut]
// Même unité que l'avertissement de Vite : kB = 1 000 octets, fichier minifié, hors gzip.
// Vite ne fait qu'avertir au-delà de 500 kB : sans ce script, la CI resterait verte.
// Lancé par .github/workflows/ci.yml juste après `npm run build`.
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const LIMIT_KB = 500;

/** Chemin (relatif au build) du script module que charge index.html, ou null (balises et
 * attributs sans tenir compte de la casse, comme le navigateur). */
export const mainEntryPath = html => {
  for (const tag of html.match(/<script\b[^>]*>/gi) ?? []) {
    if (!/\btype=["']module["']/i.test(tag)) continue;
    const src = /\bsrc=["']([^"']+)["']/i.exec(tag);
    if (src) return src[1].replace(/^\.?\//, '');
  }
  return null;
};

/** Verdict pour une taille en octets : message en français, prêt à afficher. */
export const verdict = (file, bytes, limitKb = LIMIT_KB) => {
  const kb = bytes / 1000;
  const shown = `${kb.toFixed(2)} kB`;
  const margin = (limitKb - kb).toFixed(2);
  return kb > limitKb
    ? { ok: false, message: `Fichier principal trop lourd : ${file} pèse ${shown}, plafond ${limitKb} kB (dépassement de ${(kb - limitKb).toFixed(2)} kB). Chargez à la demande (import()) un module qui ne sert pas au premier écran.` }
    : { ok: true, message: `Fichier principal : ${file}, ${shown} sur ${limitKb} kB (marge ${margin} kB).` };
};

/** Contrôle d'un dossier de build. Ne lève pas : rend le verdict. */
export const checkBuild = (dir, limitKb = LIMIT_KB) => {
  let html;
  try { html = readFileSync(path.join(dir, 'index.html'), 'utf8'); } catch {
    return { ok: false, message: `Build introuvable : pas de ${path.join(dir, 'index.html')} (lancer d'abord « npm run build »).` };
  }
  const entry = mainEntryPath(html);
  if (!entry) return { ok: false, message: 'Fichier principal introuvable : aucun <script type="module" src=…> dans index.html.' };
  let bytes;
  try { bytes = statSync(path.join(dir, entry)).size; } catch {
    return { ok: false, message: `Fichier principal introuvable : ${entry} est cité par index.html mais absent du build.` };
  }
  return verdict(entry, bytes, limitKb);
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { ok, message } = checkBuild(process.argv[2] || 'dist');
  (ok ? console.log : console.error)(message);
  process.exit(ok ? 0 : 1);
}
