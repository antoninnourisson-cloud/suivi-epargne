// Tests unitaires (app + serveur) et couverture. Reprend la configuration Vite de l'app.
import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

export default mergeConfig(viteConfig, defineConfig({
  test: {
    // Les tests de bout en bout (Playwright) ont leur propre lanceur.
    exclude: ['node_modules/**', 'dist/**', 'e2e/**', 'worker/node_modules/**', 'edge/node_modules/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'html', 'json-summary'],
      // Le cœur métier : calculs purs et serveur. Les composants sont couverts par les
      // tests de bout en bout.
      include: ['src/lib/**/*.ts', 'worker/src/**/*.ts', 'edge/src/**/*.ts'],
      exclude: ['**/*.test.ts', 'src/lib/chartTheme.ts'],
      // Seuils plancher : la couverture ne doit pas reculer. À relever au fil des tests.
      thresholds: { statements: 88, branches: 76, functions: 89, lines: 91 },
    },
  },
}));
