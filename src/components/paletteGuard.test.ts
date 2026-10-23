// @vitest-environment node
// Garde-fou Material 3 pour TOUTE l'app (src, hors tests) : une classe de palette brute
// (bg-slate-800, text-indigo-700, border-rose-200…) ne s'adapte pas au thème sombre ni aux
// rôles de couleur. Elle est refusée partout, sans exception : utiliser un rôle du thème
// (bg-surface-container, text-on-surface-variant, text-gain, bg-loss-container…, voir
// src/theme/m3.css) ou un composant de src/components/ui. Trois barrières : le lint
// (eslint.config.js) pendant l'écriture, ce test sur les sources, et src/index.css qui retire
// les palettes du thème (une classe brute ne produit alors aucun style).
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import { __unstable__loadDesignSystem } from 'tailwindcss';
import twColors from 'tailwindcss/colors';

const SRC = fileURLToPath(new URL('../', import.meta.url));

type Block = { files?: string[]; rules?: Record<string, unknown> };
type LintConfig = { default: Block[]; PALETTE_COLORS: string; PALETTE_CLASS: string };
// Chemin en variable : la configuration du lint est un module JavaScript sans types.
const CONFIG = '../../eslint.config.js';
const { default: eslintConfig, PALETTE_COLORS, PALETTE_CLASS }: LintConfig = await import(/* @vite-ignore */ CONFIG);

/** Même motif que le lint : classe de palette numérotée, quelle que soit sa variante (dark:, hover:…). */
const RAW_PALETTE = new RegExp(`(?<![a-zA-Z0-9_-])${PALETTE_CLASS}(?![a-zA-Z0-9_-])`, 'g');
const rawClasses = (text: string) => text.match(RAW_PALETTE) ?? [];

const sources = readdirSync(SRC, { recursive: true })
  .map(f => String(f).split(sep).join('/'))
  .filter(f => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.endsWith('.d.ts'))
  .sort();
const counts = new Map(sources.map(f => [f, rawClasses(readFileSync(SRC + f, 'utf8')).length]));

/** Tailwind tel que l'app le compile (feuille donnée), pour lister ce qu'il sait produire. */
const require = createRequire(import.meta.url);
const loadTailwind = (css: string) => __unstable__loadDesignSystem(css, {
  base: SRC,
  loadStylesheet: async (id: string, base: string) => {
    const path = id === 'tailwindcss' ? require.resolve('tailwindcss/index.css') : resolve(base, id);
    return { path, base: dirname(path), content: readFileSync(path, 'utf8') };
  },
});
/** Palettes numérotées de la version installée de Tailwind (slate, gray, mauve…). */
const stockPalettes = Object.entries(twColors).filter(([, v]) => typeof v === 'object').map(([k]) => k).sort();

describe('palette brute (Material 3)', () => {
  it('reconnaît les classes brutes, avec ou sans variante, et pas les rôles du thème', () => {
    const sample = 'bg-slate-800 dark:hover:text-indigo-300 border-l-rose-200 shadow-amber-600/30 bg-surface-container text-on-gain-container text-primary';
    expect(rawClasses(sample)).toEqual(['bg-slate-800', 'text-indigo-300', 'border-l-rose-200', 'shadow-amber-600']);
  });

  it('reconnaît aussi les palettes et utilitaires récents de Tailwind 4', () => {
    const recent = ['bg-mauve-800', 'text-taupe-700', 'ring-mist-200', 'from-olive-100', 'border-s-slate-200', 'border-e-gray-200', 'border-bs-red-300',
      'inset-ring-slate-200', 'drop-shadow-slate-500', 'inset-shadow-indigo-500', 'text-shadow-rose-300', 'mask-t-from-red-500',
      'mask-radial-to-blue-200', 'scrollbar-thumb-zinc-400'];
    for (const c of recent) expect(rawClasses(` ${c} `), c).toEqual([c]);
  });

  it('couvre toutes les palettes et tous les utilitaires de couleur de la version installée', async () => {
    expect(PALETTE_COLORS.split('|').sort()).toEqual(stockPalettes);
    // Chaque classe de couleur que Tailwind sait produire, sur deux palettes témoins.
    const tailwind = await loadTailwind('@import "tailwindcss";');
    const colourClasses = tailwind.getClassList().map(([c]) => c).filter(c => /-(red|taupe)-500$/.test(c));
    expect(colourClasses.length).toBeGreaterThan(60);
    expect(colourClasses.filter(c => rawClasses(c).length === 0), 'utilitaire de couleur inconnu du lint').toEqual([]);
  });

  it('trouve bien les sources de l’app', () => {
    expect(counts.has('App.tsx')).toBe(true);
    expect(counts.has('components/Dashboard.tsx')).toBe(true);
    expect(counts.has('app/LoginScreen.tsx')).toBe(true);
  });

  it('aucune classe brute dans les sources (aucun fichier exempté)', () => {
    const offenders = [...counts].filter(([, n]) => n > 0).map(([f, n]) => `${f} (${n})`);
    expect(offenders, 'utiliser un rôle de couleur du thème (src/theme/m3.css) ou un composant ui/').toEqual([]);
  });

  it('le thème ne rebranche plus aucune échelle de palette (indigo, slate, gray…)', () => {
    const theme = readFileSync(SRC + 'theme/m3.css', 'utf8');
    expect(theme).not.toMatch(new RegExp(`--color-(?:${PALETTE_COLORS})-\\d`));
    const css = readFileSync(SRC + 'index.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''); // règles, hors commentaires
    expect(rawClasses(css),'plus de sélecteur sur une classe de palette dans index.css').toEqual([]);
  });

  it('avec la feuille de l’app, Tailwind ne produit plus aucune classe de palette brute', async () => {
    const tailwind = await loadTailwind(readFileSync(SRC + 'index.css', 'utf8'));
    const leftovers = tailwind.getClassList().map(([c]) => c).filter(c => new RegExp(`-(?:${PALETTE_COLORS})-\\d`).test(c));
    expect(leftovers).toEqual([]);
    const [raw, drop, role, white, scrim, sapin] = tailwind.candidatesToCss(
      ['bg-slate-800', 'drop-shadow-taupe-500', 'bg-surface-container', 'text-white', 'bg-black/50', 'bg-sapin']);
    expect([raw, drop]).toEqual([null, null]);
    for (const kept of [role, white, scrim, sapin]) expect(kept).toBeTruthy();
  });
});

describe('règle de lint « palette brute » (eslint.config.js)', () => {
  const block = eslintConfig.find(c => c.rules && 'no-restricted-syntax' in c.rules);
  const lint = (code: string) => new Linter({ configType: 'flat' }).verify(code, [{
    files: ['**/*.tsx'],
    languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
    rules: { 'no-restricted-syntax': block!.rules!['no-restricted-syntax'] as Linter.RuleEntry },
  }], 'src/components/Exemple.tsx').map(m => m.line);

  it('s’applique à l’interface (src/components, src/app, App.tsx)', () => {
    expect(block?.files).toEqual(['src/**/*.{ts,tsx}']);
  });

  it('refuse une classe brute dans un attribut, une chaîne ou un gabarit', () => {
    expect(lint([
      'export const A = () => <p className="p-2 bg-slate-800">x</p>;',
      'export const b = (on: boolean) => `flex ${on ? "a" : ""} dark:hover:text-indigo-300/80`;',
      "export const c = 'border-l-rose-200!';",
      'export const D = () => <p className="drop-shadow-slate-500 p-1">x</p>;',
      "export const e = 'inset-ring-mauve-200 border-s-taupe-300';",
    ].join('\n'))).toEqual([1, 2, 3, 4, 5]);
  });

  it('laisse passer les rôles du thème et les mots qui y ressemblent', () => {
    expect(lint([
      'export const A = () => <p className="bg-surface-container text-on-surface-variant text-gain bg-loss-container">x</p>;',
      "export const b = 'toast-slate-50 bg-slate-5000 text-white/85 bg-sapin drop-shadow-md inset-shadow-sm';",
    ].join('\n'))).toEqual([]);
  });
});
