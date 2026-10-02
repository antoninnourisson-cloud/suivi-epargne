// Règles de qualité du code (lancées en CI) : erreurs TypeScript courantes, règles des
// hooks React (dépendances oubliées = données périmées) et accessibilité de base.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'worker/node_modules', 'worker/.wrangler', 'public/push-sw.js', 'dev-dist'] },
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
  { files: ['**/*.{js,mjs,cjs}'], languageOptions: { globals: { ...globals.node } } },
  { files: ['**/*.test.ts', '**/*.test.tsx', 'worker/test/**'], rules: { '@typescript-eslint/no-explicit-any': 'off' } },
);
