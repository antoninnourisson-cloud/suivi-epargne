// Tests unitaires (app + serveur) et couverture. Reprend la configuration Vite de l'app.
import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.ts';

// Cœur métier : calculs purs (src/lib), serveur (worker/src) et en-têtes (edge/src).
const CORE = '{src/lib,worker/src,edge/src}/**/*.ts';
// Ce qui protège les données : synchronisation Drive (façade usePortfolioData et ses morceaux
// dans src/hooks/portfolio), copies locales, sauvegarde de secours, session serveur, verrou
// de l'appareil, et autour d'eux dans src/app : les actions qui écrivent les comptes et les
// mouvements (useAccountActions) et la session Google de l'appareil (useAuthSession).
const DATA_SAFETY = '{src/hooks/usePortfolioData,src/hooks/portfolio/*,src/services/{googleDriveService,drive/*,localVault,cloudBackup,backendService,setAsideVersions,appLockService},src/app/{useAccountActions,useAuthSession}}.ts';

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
      // - Les seuils globaux portent sur TOUTE l'app (écrans compris). Mesuré le 5 novembre
      //   2026 : 86,9 / 81,8 / 79,7 / 90,1 (le 23 octobre : 81,7 / 75,0 / 73,1 / 85,0). Plancher
      //   = mesure arrondie à l'unité inférieure, un point de moins quand il resterait moins de
      //   0,3 point de marge (les tests fast-check tirent des cas au hasard, la mesure bouge un
      //   peu) : un nouvel écran arrive avec ses tests unitaires (React Testing Library), sinon
      //   la CI (donc le déploiement) s'arrête.
      // - Le cœur métier et les filets anti-perte ont leurs seuils propres, stricts, même règle.
      //   Mesurés le 5 novembre 2026 : cœur 97,1 / 91,6 / 97,8 / 98,6 ; filets 91,9 / 83,7 /
      //   90,6 / 96,2 (calcul : coverage-summary.json agrégé selon CORE et DATA_SAFETY).
      thresholds: {
        statements: 86, branches: 81, functions: 79, lines: 89,
        [CORE]: { statements: 96, branches: 91, functions: 97, lines: 98 },
        [DATA_SAFETY]: { statements: 91, branches: 83, functions: 90, lines: 96 },
      },
    },
  },
}));
