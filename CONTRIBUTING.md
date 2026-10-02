# Contribuer à Pécule

Merci de votre intérêt ! Pécule est une application personnelle, mais les signalements de bugs, les idées et les corrections sont bienvenus.

## Avant de commencer

- **Une question, une idée, un bug** : ouvrez une [issue](https://github.com/antoninnourisson-cloud/suivi-epargne/issues/new/choose). Pour une fonctionnalité importante, discutons-en avant d'écrire du code.
- **Une faille de sécurité** : ne l'ouvrez pas en public, suivez [SECURITY.md](SECURITY.md).
- **Aucune donnée réelle** dans les issues, captures ou tests : ni montants, ni fiches de paie, ni avis d'imposition. Utilisez le mode démo.

## Installer le projet

Prérequis : Node.js 22 (voir [`.nvmrc`](.nvmrc)).

```bash
npm ci
npm run dev
```

Ouvrez ensuite <http://localhost:5173/?demo=1> : l'app se charge avec des données fictives, sans compte Google, et n'écrit rien sur Drive. Le serveur (`worker/`) a ses propres instructions dans [worker/README.md](worker/README.md).

## Proposer une modification

1. Créez une branche depuis `main` (`fix/…`, `feat/…`, `docs/…`).
2. Faites des commits courts, au présent, qui disent **pourquoi** autant que quoi.
3. Avant d'ouvrir la pull request, les quatre vérifications de la CI doivent passer en local :

   ```bash
   npm run lint
   npm run typecheck
   npm test
   npm run build
   ```

4. Remplissez le modèle de pull request (ce qui change, comment vous l'avez vérifié).

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

- TypeScript strict, composants fonctionnels React, Tailwind pour le style.
- Les textes de l'interface sont en français, vouvoient l'utilisateur et évitent le jargon (« Votre part », pas « ownedAmount »).
- Accessibilité : chaque champ a un libellé, chaque bouton icône un `aria-label`, chaque modale piège le focus (composant `Modal`).
- Le fichier `.editorconfig` fixe l'indentation (2 espaces) et les fins de ligne (LF).

## Licence

En contribuant, vous acceptez que votre contribution soit publiée sous la licence du projet, [AGPL-3.0-or-later](LICENSE).
