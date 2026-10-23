// Tests unitaires (app + serveur) et couverture. Reprend la configuration Vite de l'app.
import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

// Cœur métier : calculs purs (src/lib), serveur (worker/src) et en-têtes (edge/src).
const CORE = '{src/lib,worker/src,edge/src}/**/*.ts';
// Ce qui protège les données : synchronisation Drive (façade usePortfolioData et ses morceaux
// dans src/hooks/portfolio), copies locales, sauvegarde de secours, session serveur, verrou
// de l'appareil.
const DATA_SAFETY = '{src/hooks/usePortfolioData,src/hooks/portfolio/*,src/services/{googleDriveService,localVault,cloudBackup,backendService,setAsideVersions,appLockService}}.ts';

// Les tests de bout en bout (Playwright) ont leur propre lanceur.
const EXCLUDE = ['node_modules/**', 'dist/**', 'dist-e2e/**', 'e2e/**', 'worker/node_modules/**', 'edge/node_modules/**'];
// Calculs purs et serveur : chacun son groupe (voir `projects`).
const CALC_TESTS = ['src/lib/**/*.test.ts', 'src/*.test.ts'];
const SERVER_TESTS = ['worker/test/**/*.test.ts', 'edge/test/**/*.test.ts'];

export default mergeConfig(viteConfig, defineConfig({
  test: {
    exclude: EXCLUDE,
    // Marge pour une machine lente (couverture, sortie de veille) : les tests les plus longs
    // (séquences aléatoires, rendu jsdom) prennent 1 à 2 s en temps normal.
    testTimeout: 20_000,
    // Trois groupes, réglés différemment. Sur une machine lente ou chargée, lancer un
    // environnement jsdom par fichier sur TOUS les cœurs à la fois faisait dépasser le délai de
    // démarrage d'un processus (« Failed to start forks worker ») : des fichiers étaient sautés
    // (dont la synchronisation Drive) alors que le résumé affichait « passed ».
    // - calculs (src/lib) : fonctions pures, sans navigateur simulé ; un processus sert
    //   plusieurs fichiers (isolate: false), bien plus rapide au démarrage ;
    // - serveur (worker, edge) : isolés (ils remplacent fetch, l'horloge, le stockage) ;
    // - écrans (composants, hooks, services) : isolés, sur la moitié des cœurs au plus, lancés
    //   APRÈS les deux autres groupes (sequence.groupOrder) pour ne pas se disputer les cœurs.
    //   Ce groupe prend TOUT test qui n'est pas dans les deux autres : un nouveau dossier de
    //   tests ne peut pas être oublié en silence (réglage le plus prudent : isolé).
    projects: [
      { extends: true, test: { name: 'calculs', include: CALC_TESTS, isolate: false } },
      { extends: true, test: { name: 'serveur', include: SERVER_TESTS } },
      {
        extends: true,
        test: {
          name: 'écrans', include: ['**/*.test.{ts,tsx}'], exclude: [...EXCLUDE, ...CALC_TESTS, ...SERVER_TESTS],
          maxWorkers: '50%', sequence: { groupOrder: 1 },
        },
      },
    ],
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
      // - Les seuils globaux portent sur TOUTE l'app (écrans compris). Mesuré le 23 octobre
      //   2026 : 81,7 / 75,0 / 73,1 / 85,0 (le 19 octobre : 63,7 / 53,7 / 49,4 / 66,6). Plancher
      //   = mesure arrondie à l'unité inférieure : un nouvel écran arrive avec ses tests
      //   unitaires (React Testing Library), sinon la CI (donc le déploiement) s'arrête.
      // - Le cœur métier et les filets anti-perte ont leurs seuils propres, stricts (valeurs
      //   mesurées arrondies à l'unité inférieure).
      thresholds: {
        statements: 81, branches: 74, functions: 73, lines: 85,
        [CORE]: { statements: 92, branches: 81, functions: 93, lines: 95 },
        [DATA_SAFETY]: { statements: 89, branches: 81, functions: 87, lines: 94 },
      },
    },
  },
}));
