// Garde-fous du démarrage : échouent (code 1) si
//  1. le fichier JS principal de l'app (celui que charge index.html, avant tout écran) dépasse
//     son plafond ;
//  2. le total des fichiers JS chargés au démarrage (le principal, les préchargements de
//     index.html et tout ce qu'ils importent statiquement : React, icônes, kit d'interface…)
//     dépasse le sien. Le fichier principal seul ne dit plus tout : React vit dans un fichier
//     à part (vite.config.ts), donc un module de plus au démarrage peut se cacher ailleurs ;
//  3. un fichier censé rester CHARGÉ À LA DEMANDE se retrouve dans ce démarrage (les
//     graphiques, environ 390 kB : un import statique de plus et tout le monde les télécharge).
//   node scripts/check-bundle-size.mjs [dossier du build, « dist » par défaut]
// Même unité que l'avertissement de Vite : kB = 1 000 octets, fichier minifié, hors gzip.
// Vite ne fait qu'avertir au-delà de 500 kB : sans ce script, la CI resterait verte.
// Lancé par .github/workflows/ci.yml juste après `npm run build`.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Mesuré le 5 novembre 2026 : fichier principal 232 kB ; démarrage 586 kB en 20 fichiers.
export const LIMIT_KB = 350;
export const STARTUP_LIMIT_KB = 800;
/** Noms de fichiers (avant l'empreinte) qui ne doivent jamais faire partie du démarrage. */
export const LAZY_CHUNKS = ['charts'];

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

/** Fichiers que index.html fait précharger (`<link rel="modulepreload" href=…>`), chemins relatifs au build. */
export const preloadedPaths = html => {
  const out = [];
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    if (!/\brel=["']modulepreload["']/i.test(tag)) continue;
    const href = /\bhref=["']([^"']+)["']/i.exec(tag);
    if (href) out.push(href[1].replace(/^\.?\//, ''));
  }
  return out;
};

/** Fichiers cités par un import STATIQUE dans un code minifié (`import{a}from"./x.js"`,
 * `import"./x.js"`, `export*from"./x.js"`), noms relatifs au dossier du fichier. Les
 * `import("./x.js")` (chargement à la demande) ne sont pas comptés. */
export const staticImports = code =>
  [...code.matchAll(/\b(?:import|export)\s*(?:[^'"`;()]*?\bfrom\s*)?["']\.\/([^"'?]+\.js)["']/g)].map(m => m[1]);

/** Fichiers JS chargés au démarrage : le principal, les préchargés, et leurs imports statiques.
 * Chemins relatifs au build. Un fichier cité mais absent est ignoré (signalé ailleurs). */
export const startupFiles = (dir, html) => {
  const entry = mainEntryPath(html);
  const seen = new Set();
  const queue = [entry, ...preloadedPaths(html)].filter(Boolean);
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    let code;
    try { code = readFileSync(path.join(dir, file), 'utf8'); } catch { continue; }
    seen.add(file);
    for (const dep of staticImports(code)) queue.push(path.posix.join(path.posix.dirname(file), dep));
  }
  return [...seen];
};

/** Fichiers de LAZY_CHUNKS trouvés dans une liste de chemins (« charts-AbC123.js » → « charts »). */
export const lazyInStartup = (files, lazy = LAZY_CHUNKS) =>
  files.filter(f => lazy.some(name => new RegExp(`^${name}-[^/]*\\.js$`).test(path.posix.basename(f))));

/** Verdict pour une taille en octets : message en français, prêt à afficher. */
export const verdict = (file, bytes, limitKb = LIMIT_KB) => {
  const kb = bytes / 1000;
  const shown = `${kb.toFixed(2)} kB`;
  const margin = (limitKb - kb).toFixed(2);
  return kb > limitKb
    ? { ok: false, message: `Fichier principal trop lourd : ${file} pèse ${shown}, plafond ${limitKb} kB (dépassement de ${(kb - limitKb).toFixed(2)} kB). Chargez à la demande (import()) un module qui ne sert pas au premier écran.` }
    : { ok: true, message: `Fichier principal : ${file}, ${shown} sur ${limitKb} kB (marge ${margin} kB).` };
};

/** Verdict pour l'ensemble du démarrage (nombre de fichiers, octets au total). */
export const startupVerdict = (count, bytes, limitKb = STARTUP_LIMIT_KB) => {
  const kb = bytes / 1000;
  const shown = `${kb.toFixed(2)} kB en ${count} fichiers`;
  return kb > limitKb
    ? { ok: false, message: `Démarrage trop lourd : ${shown}, plafond ${limitKb} kB (dépassement de ${(kb - limitKb).toFixed(2)} kB). Un import statique de trop tire un gros module dans le premier écran : le chercher avec le contenu de index.html.` }
    : { ok: true, message: `Démarrage : ${shown} sur ${limitKb} kB (marge ${(limitKb - kb).toFixed(2)} kB).` };
};

/** Fichiers du mode démo (« demoData-AbC123.js », « demoStatement-….js ») trouvés dans le dossier
 * assets du build, chemins relatifs au build. */
export const demoFiles = dir => {
  try { return readdirSync(path.join(dir, 'assets')).filter(f => /^demo[^/]*.js$/i.test(f)).map(f => `assets/${f}`); } catch { return []; }
};

/** Contrôle d'un dossier de build. Ne lève pas : rend le verdict. */
export const checkBuild = (dir, limitKb = LIMIT_KB, startupLimitKb = STARTUP_LIMIT_KB) => {
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
  const main = verdict(entry, bytes, limitKb);
  const files = startupFiles(dir, html);
  const total = files.reduce((sum, f) => sum + statSync(path.join(dir, f)).size, 0);
  const startup = startupVerdict(files.length, total, startupLimitKb);
  const lazy = lazyInStartup(files);
  const verdicts = [main, startup];
  if (lazy.length) {
    verdicts.push({ ok: false, message: `Fichier à charger à la demande présent au démarrage : ${lazy.join(', ')}. Il doit rester derrière un import() (voir vite.config.ts).` });
  }
  const demo = demoFiles(dir);
  if (demo.length) {
    verdicts.push({ ok: false, message: `Mode démo présent dans le build publié : ${demo.join(', ')}. Les import() de src/dev/ doivent être repliés (src/lib/demoMode.ts).` });
  }
  return { ok: verdicts.every(v => v.ok), message: verdicts.map(v => v.message).join('\n') };
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { ok, message } = checkBuild(process.argv[2] || 'dist');
  (ok ? console.log : console.error)(message);
  process.exit(ok ? 0 : 1);
}
