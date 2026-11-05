# Contribuer à Pécule

Merci de votre intérêt ! Pécule est une application personnelle, mais les signalements de bugs, les idées et les corrections sont bienvenus.

## Avant de commencer

- **Une question, une idée, un bug** : ouvrez une [issue](https://github.com/antoninnourisson-cloud/suivi-epargne/issues/new/choose). Pour une fonctionnalité importante, discutons-en avant d'écrire du code.
- **Une faille de sécurité** : ne l'ouvrez pas en public, suivez [SECURITY.md](SECURITY.md).
- **Le reste** : [contact@pecule-app.com](mailto:contact@pecule-app.com). Les échanges autour du projet suivent le [code de conduite](CODE_OF_CONDUCT.md).
- **Aucune donnée réelle** dans les issues, captures ou tests : ni montants, ni fiches de paie, ni avis d'imposition. Utilisez le mode démo.

## Installer le projet

Prérequis : Node.js 24 ou plus (version de référence dans [`.nvmrc`](.nvmrc)).

```bash
npm ci
npm run dev
```

Ouvrez ensuite <http://localhost:5173/?demo=1> : l'app se charge avec des données fictives, sans compte Google, et n'écrit rien sur Drive. Le serveur (`worker/`) a ses propres instructions dans [worker/README.md](worker/README.md).

## Proposer une modification

1. Créez une branche depuis `main` (`fix/…`, `feat/…`, `docs/…`).
2. Faites des commits courts, au présent, qui disent **pourquoi** autant que quoi.
3. Avant d'ouvrir la pull request, les vérifications de la CI doivent passer en local :

   ```bash
   npm ci --prefix worker && npm ci --prefix edge   # une fois : nécessaires au typecheck
   npm run lint            # ESLint, règles d'accessibilité comprises
   npm run typecheck       # app + serveur + edge
   npm run test:coverage   # tests Vitest et seuils de couverture
   npm run e2e             # tests de bout en bout (Playwright : mode démo et faux Drive)
   npm run build
   ```

   Pour `npm run e2e`, en local, les tests utilisent **Google Chrome installé** sur la machine (rien à télécharger) ; seule la CI utilise le Chromium de Playwright. Il tourne sur le serveur de développement : `npm run e2e` lance tous les parcours (long), un seul fichier se lance avec `npx playwright test e2e/simulator.spec.ts --project=mobile`. La CI, elle, teste le **build de production** (`E2E_TARGET=build`) : lancez-le avant une pull request qui touche au service worker, à la sécurité ou au chargement. Un nouvel écran ou un nouveau parcours ajoute son test dans `e2e/` : il tourne au format téléphone ; un parcours propre à l'ordinateur (menu latéral, clavier, grande largeur) porte `{ tag: '@ordinateur' }`. Voir [Stratégie de test](#stratégie-de-test).

4. Remplissez le modèle de pull request (ce qui change, comment vous l'avez vérifié).

## Stratégie de test

Chaque couche a son outil ; un test se place dans la couche la plus basse qui peut l'attraper.

| Ce qu'on vérifie | Où | Outil |
|---|---|---|
| **Calculs** (soldes, intérêts, fiscalité, paie, simulateur) | `src/lib/*.test.ts` | Vitest, groupe « calculs » : fonctions pures, sans écran. Les propriétés (le total reste égal à part propre plus part des parents, un intérêt ne devient jamais négatif…) sont vérifiées sur des milliers de cas tirés au hasard avec **fast-check** (`src/lib/finance/*.properties.test.ts`) |
| **Anciens fichiers de données** | `src/lib/__fixtures__/` | un fichier d'exemple par époque du format, passé par `migrate()` et comparé à un instantané ; un test échoue si le format de l'app dépasse le plus récent (voir `src/lib/schema.fixtures.test.ts`) |
| **Écrans, hooks, services** | `src/**/*.test.tsx`, `src/services/*.test.ts` | Vitest, groupe « écrans », avec React Testing Library ; les services parlent à de faux navigateurs et serveurs (`vi.mock`, `vi.stubGlobal`) |
| **Serveur** (`worker/`) et **en-têtes** (`edge/`) | `worker/test/`, `edge/test/` | Vitest, groupe « serveur », avec un faux KV en mémoire (`worker/test/kvFake.ts`) : aucun appel réseau |
| **Parcours complets** dans un vrai navigateur | `e2e/*.spec.ts` | Playwright. Surtout en **mode démo** (`?demo=1`, données fictives, rien d'écrit sur Drive) ; la synchronisation, les conflits, le hors ligne et la session expirée tournent **sans démo contre un faux Drive** en mémoire (`e2e/fakeDrive.ts`, interceptions `page.route`) |
| **Accessibilité** | `e2e/accessibility.spec.ts` (WCAG 2 A et AA), `e2e/contrast.spec.ts` (contrastes, clair et sombre) | axe-core injecté dans les écrans et les feuilles principales ; un nouvel écran s'ajoute à leur liste |

Règles :
- **Un test de bout en bout importe `test` depuis `e2e/fixtures.ts`**, pas depuis `@playwright/test` (règle ESLint) : il coupe tout appel au vrai serveur.
- **Où ça tourne.** En local, Playwright utilise le serveur de développement (port 5173). En CI, il construit et teste le **build de production** (`E2E_TARGET=build`, port 4173 : CSP de production, service worker, minification), puis repasse `e2e/production.spec.ts` sur `dist`, le dossier que `deploy.yml` publie. Lancez `E2E_TARGET=build npx playwright test <fichier> --project=mobile` pour reproduire la CI. Un seul serveur à la fois : ne lancez pas les deux cibles en parallèle sur la même machine.
- **Tests instables.** La CI relance une fois un test qui échoue ; s'il réussit à la seconde fois, il n'est pas « vert » pour autant : un avertissement « instable » est posé sur l'exécution et listé dans son résumé (`scripts/playwright-flaky-reporter.mjs`). Le corriger (attente d'un état plutôt que d'un délai, donnée figée), ne pas augmenter les relances.
- **Couverture.** Les seuils de la CI sont dans `vitest.config.ts` ; `npm run test:coverage` donne la mesure. Un seuil se relève, jamais ne se baisse. Un nouvel écran arrive avec ses tests unitaires.

### Un test qui dépend de la date

Ne jamais compter sur la date du jour : un test vert en octobre peut échouer en janvier (le simulateur, les rappels fiscaux et les taux changent à des dates précises). On fige l'horloge.
- **Playwright** : `await page.clock.setFixedTime(new Date('2026-11-05T10:00:00'));` avant `page.goto`. La date est figée, les minuteries restent réelles (`page.clock.install` fige aussi les minuteries : à réserver aux tests qui les pilotent). Pour vérifier les deux côtés d'une règle (janvier et hors janvier), faites une boucle de tests avec une date par cas, comme dans `e2e/simulator.spec.ts`. N'écrivez pas de `new Date()` dans le test pour construire une valeur attendue : écrivez la valeur en dur avec la date figée.
- **Vitest** : `vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-05T10:00:00'));`, puis `vi.useRealTimers()` dans `afterEach`. Mieux : passer la date en paramètre de la fonction (`now: Date = new Date()`, comme `shouldSuggestStrongerPin`), et donner au test une date fixe.
- Fuseau : Playwright tourne en `Europe/Paris` ; Vitest suit le fuseau de la machine. Pour un test Vitest, choisissez une heure en milieu de journée (midi) ou écrivez le fuseau dans la date (`'2026-11-05T12:00:00+01:00'`), afin que le jour ne change pas d'une machine à l'autre.

## Les règles du projet

Elles sont détaillées dans [MAINTENANCE.md](MAINTENANCE.md) (§ 1, *Invariants à ne pas casser*). Les plus importantes :

- **Soldes** : tout changement de solde passe par `src/lib/accountOps.ts`. Le total d'un compte est toujours la part propre plus la part des parents.
- **Capital des parents** : il ne peut jamais être retiré par l'utilisateur. Toute nouvelle façon de retirer de l'argent doit le vérifier.
- **Fichier de données** : tout ce qui entre passe par `migrate()` (`src/lib/schema.ts`), et les champs inconnus sont conservés. Un changement de format augmente `APP_SCHEMA_VERSION` et ajoute une migration testée.
- **Calculs** : les calculs financiers sont des fonctions pures dans `src/lib/`, testées dans `src/lib/*.test.ts`. Pas de calcul métier dans les composants.
- **Chiffres fiscaux** : chaque valeur (taux, plafond, barème) cite sa source officielle (service-public.gouv.fr, impots.gouv.fr, Légifrance) dans le code ou la PR.
- **Secrets** : aucune clé ni aucun jeton dans le code. La clé Gemini reste sur l'appareil.
- **Changelog** : toute modification visible ajoute une entrée **en tête** de `src/changelog.ts` (version `AAAA.MM.JJ`, suffixe `-2`, `-3`… le même jour, jamais dans le futur), en phrases simples et sans jargon.

## Style

- TypeScript strict, composants fonctionnels React, Tailwind 4 pour le style.
- Design Material 3 Expressive : réutilisez les composants de `src/components/ui/` (Card, StatTile, TextField, Tabs…) et les rôles de couleur Material (`bg-surface-container`, `text-on-surface-variant`…). La palette se régénère avec `npm run theme` (`scripts/m3-theme.mjs` → `src/theme/m3.css`), jamais à la main. Aucune classe de palette brute (`bg-slate-800`, `text-indigo-700`…) : `npm run lint` la refuse. Police : Google Sans Flex, hébergée avec l'app.
- Les textes de l'interface sont en français, vouvoient l'utilisateur et évitent le jargon (« Votre part », pas « ownedAmount »).
- Accessibilité : chaque champ a un libellé, chaque bouton icône un `aria-label`, chaque modale piège le focus (composant `Modal`).
- Le fichier `.editorconfig` fixe l'indentation (2 espaces) et les fins de ligne (LF).

## Licence

En contribuant, vous acceptez que votre contribution soit publiée sous la licence du projet, [AGPL-3.0-or-later](LICENSE).
