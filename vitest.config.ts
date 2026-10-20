// Tests unitaires (app + serveur) et couverture. Reprend la configuration Vite de l'app.
import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

// Cœur métier : calculs purs (src/lib), serveur (worker/src) et en-têtes (edge/src).
const CORE = '{src/lib,worker/src,edge/src}/**/*.ts';
// Ce qui protège les données : synchronisation Drive, copies locales, sauvegarde de secours,
// session serveur, verrou de l'appareil.
const DATA_SAFETY = '{src/hooks/usePortfolioData,src/services/{googleDriveService,localVault,cloudBackup,backendService,setAsideVersions,appLockService}}.ts';

export default mergeConfig(viteConfig, defineConfig({
  test: {
    // Les tests de bout en bout (Playwright) ont leur propre lanceur.
    exclude: ['node_modules/**', 'dist/**', 'dist-e2e/**', 'e2e/**', 'worker/node_modules/**', 'edge/node_modules/**'],
    // Marge pour une machine lente (couverture, sortie de veille) : les tests les plus longs
    // (séquences aléatoires, rendu jsdom) prennent 1 à 2 s en temps normal.
    testTimeout: 20_000,
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'html', 'json-summary'],
      // TOUT le code de l'app est mesuré (hooks, services, écrans, App.tsx), pas seulement le
      // cœur métier : les tests de bout en bout tournent en mode démo ou sur un faux Drive et ne
      // comptent pas dans ce chiffre. Hors mesure : les tests, le thème généré, les déclarations
      // de types, le point d'entrée (src/index.tsx), les données fictives du mode démo
      // (src/dev) et les couleurs des graphiques (src/lib/chartTheme.ts, des constantes).
      include: ['src/**/*.{ts,tsx}', 'worker/src/**/*.ts', 'edge/src/**/*.ts'],
      exclude: [
        '**/*.test.{ts,tsx}', '**/*.d.ts', 'src/theme/**', 'src/dev/**', 'src/index.tsx', 'src/lib/chartTheme.ts',
      ],
      // Seuils plancher : la couverture ne doit pas reculer. À relever au fil des tests.
      // - Les seuils globaux portent sur TOUTE l'app (écrans compris, encore peu testés en
      //   unitaire : ils le sont surtout par les tests de bout en bout). Mesuré le 19 octobre
      //   2026 : 63,7 / 53,7 / 49,4 / 66,6. Plancher fixé environ 1 point plus bas : un nouvel
      //   écran pas encore testé en unitaire ne doit pas bloquer la CI (donc les déploiements).
      // - Le cœur métier et les filets anti-perte ont leurs seuils propres, stricts (valeurs
      //   mesurées arrondies à l'unité inférieure).
      thresholds: {
        statements: 62, branches: 52, functions: 47, lines: 65,
        [CORE]: { statements: 92, branches: 81, functions: 93, lines: 95 },
        [DATA_SAFETY]: { statements: 89, branches: 81, functions: 87, lines: 94 },
      },
    },
  },
}));
