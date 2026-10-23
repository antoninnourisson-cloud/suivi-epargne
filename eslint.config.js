// Règles de qualité du code (lancées en CI) : erreurs TypeScript courantes, règles des
// hooks React (dépendances oubliées = données périmées) et accessibilité de base.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import globals from 'globals';

/**
 * Palettes numérotées livrées par Tailwind 4.3 (node_modules/tailwindcss/theme.css), et
 * utilitaires qui acceptent une couleur. Partagés avec src/components/paletteGuard.test.ts,
 * qui vérifie qu'ils couvrent tout ce que la version installée de Tailwind sait produire.
 */
export const PALETTE_COLORS = 'slate|gray|zinc|neutral|stone|mauve|mist|olive|taupe|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose';
const PALETTE_UTILITIES = 'bg|text|text-shadow|border(-([trblxyse]|b[se]))?|divide|ring|ring-offset|inset-ring|shadow|inset-shadow|drop-shadow|outline|accent|fill|stroke|from|via|to|decoration|placeholder|caret|scrollbar-(thumb|track)|mask-([trblxy]|linear|radial|conic)-(from|to)';
/** Classe de palette brute (bg-slate-800, drop-shadow-indigo-500…), sans ses bornes. */
export const PALETTE_CLASS = `(${PALETTE_UTILITIES})-(${PALETTE_COLORS})-(50|[1-9]00|950)`;
/**
 * En sélecteur esquery (motif sans barre oblique), bornée par un caractère hors classe : la
 * variante (dark:, hover:…) et les suffixes (/30, !) sont donc pris aussi.
 */
const LEGACY_PALETTE = `/(^|[^a-zA-Z0-9_-])${PALETTE_CLASS}([^a-zA-Z0-9_-]|$)/`;

export default tseslint.config(
  { ignores: ['dist', 'dist-e2e', 'node_modules', 'worker/node_modules', 'worker/.wrangler', 'edge/node_modules', 'edge/.wrangler', 'public/push-sw.js', 'dev-dist'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { ecmaVersion: 2022, globals: { ...globals.browser, ...globals.node } },
    plugins: { 'react-hooks': reactHooks, 'jsx-a11y': jsxA11y },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-irregular-whitespace': ['error', { skipStrings: true, skipTemplates: true, skipRegExps: true, skipComments: true }],
      'jsx-a11y/alt-text': 'error',
      'jsx-a11y/anchor-is-valid': 'error',
      'jsx-a11y/no-autofocus': 'off',
      'jsx-a11y/label-has-associated-control': 'off',
    },
  },
  // Règles qui lisent les types : une promesse oubliée (ni attendue ni rattrapée) est le
  // bug typique d'une synchronisation, une erreur réseau passerait alors en silence.
  {
    files: ['src/**/*.{ts,tsx}', 'worker/src/**/*.ts', 'edge/src/**/*.ts'],
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: { attributes: false } }],
      '@typescript-eslint/await-thenable': 'error',
    },
  },
  { files: ['**/*.{js,mjs,cjs}'], languageOptions: { globals: { ...globals.node } } },
  // Tests de bout en bout : `test` vient de e2e/fixtures.ts, qui coupe tout appel au vrai serveur.
  {
    files: ['e2e/**/*.spec.ts'],
    rules: {
      'no-restricted-imports': ['error', { paths: [{
        name: '@playwright/test', importNames: ['test'],
        message: "Importer test depuis './fixtures' (garde-fou : aucun appel au vrai serveur).",
      }] }],
    },
  },
  // Material 3 : couleurs par rôles du thème seulement (src/theme/m3.css, généré). Une classe
  // de palette brute (bg-slate-800, dark:text-indigo-300, border-l-rose-200…) ne suit ni le
  // thème sombre ni les rôles ; elle est refusée dans l'interface (chaînes et gabarits).
  // Aucun fichier exempté. Le même motif est vérifié dans tout src par
  // src/components/paletteGuard.test.ts. En plus, src/index.css retire ces palettes du thème :
  // une classe brute qui passerait ici ne produirait de toute façon aucun style.
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['**/*.test.ts', '**/*.test.tsx'],
    rules: {
      'no-restricted-syntax': ['error', ...[['Literal', 'value'], ['TemplateElement', 'value.raw']].map(([node, attr]) => ({
        selector: `${node}[${attr}=${LEGACY_PALETTE}]`,
        message: 'Classe de palette brute : utiliser un rôle de couleur du thème (bg-surface-container, text-on-surface-variant, text-primary, text-gain, bg-error-container…) ou un composant de src/components/ui.',
      }))],
    },
  },
  { files: ['**/*.test.ts', '**/*.test.tsx', 'worker/test/**', 'edge/test/**'], rules: { '@typescript-eslint/no-explicit-any': 'off' } },
);
