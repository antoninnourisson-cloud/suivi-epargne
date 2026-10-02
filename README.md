# Pécule

> Faites pousser votre épargne. Tableau de bord d'épargne personnel, calibré pour la fiscalité française. Vos données restent sur **votre** Google Drive.

[![React](https://img.shields.io/badge/React-18-blue?logo=react)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-5-purple?logo=vite)](https://vitejs.dev/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-3-teal?logo=tailwindcss)](https://tailwindcss.com/)
[![Cloudflare Workers](https://img.shields.io/badge/Serveur-Cloudflare%20Workers-orange?logo=cloudflare)](https://workers.cloudflare.com/)

**App en ligne :** <https://antoninnourisson-cloud.github.io/suivi-epargne/> · [Règles de confidentialité](https://antoninnourisson-cloud.github.io/suivi-epargne/confidentialite.html)

## Présentation

Pécule (anciennement Suivi Épargne) est une application web installable (PWA) pour suivre ses comptes d'épargne, piloter son budget et anticiper sa fiscalité. Elle n'a pas de base de données : toutes les données tiennent dans un seul fichier `suivi_epargne.json`, sur le Google Drive de l'utilisateur. L'app n'a accès qu'aux fichiers qu'elle a créés (portée OAuth `drive.file`).

Un **petit serveur optionnel** (Cloudflare Worker, dossier [`worker/`](worker/)) ajoute deux choses impossibles depuis le seul navigateur : une **session Google persistante** et des **notifications push**. Sans lui, l'app fonctionne entièrement côté navigateur.

## Fonctionnalités

### Tableau de bord
- Épargne nette, répartie entre disponible, contrainte fiscale (AV/PEA récents, avec l'impôt en plus d'un retrait anticipé et la date où il devient gratuit) et bloqué (PEE, PER…).
- Évolution empilée par compte, et répartition par établissement.
- **Prélèvements des 7 prochains jours** (abonnements).
- **Placé depuis la paie** : jauge des versements depuis la dernière paie (ou du mois) face au plan d'épargne.
- **Taux d'épargne** : part de la paie mise de côté, mois par mois sur un an.
- **Projection** à 6 et 12 mois d'après le rythme réel des 90 derniers jours, avec alerte si ce rythme ralentit ou accélère fortement.
- **À faire** : les alertes regroupées dans une carte repliable :
  - plafonds des livrets ;
  - **révision des taux réglementés** (1er février / 1er août) ;
  - **éligibilité au LEP** ;
  - soldes non actualisés ;
  - comptes vides inactifs ;
  - intérêts parentaux de fin d'année.
- **Échéances récurrentes** proposées à l'enregistrement, jamais écrites sans confirmation.

### Agenda et bilan
- **Agenda** : les douze prochains mois en un écran (paies, prélèvements, révisions de taux, restitution, rendez-vous fiscaux, maturités).
- **Bilan annuel** (Historique, notification chaque début janvier) : épargne mise de côté, taux d'épargne, intérêts, meilleur mois, dons, abonnements.

### Comptes et mouvements
- Distinction entre **part propre** et **capital des parents** sur chaque compte. Le capital parental est intouchable, ses intérêts reviennent à l'utilisateur.
- **Restitution du capital parental** : date conseillée (le 1er janvier garde toute l'année d'intérêts), montants par compte, effet sur le plan de placement, rappels début décembre et le jour J, enregistrement en un clic avec récapitulatif aux parents et relevé exportable. Ensuite, l'app passe en mode solo.
- **Journal des modifications** : tous les mouvements (votre part, part des parents, valorisations), changements de taux et restitution ; suppression ou annulation depuis le journal. Il repère aussi les mouvements qui s'annulent (tests) et propose de les supprimer.
- **Corrections et point de départ** : un mouvement peut être marqué « Pas de l'épargne » (erreur de saisie, intérêts, argent en transit). Il reste dans les soldes mais sort de « Placé », du taux d'épargne et des bilans. « Repartir de zéro » fait démarrer le suivi de l'épargne à une date, sans rien effacer.
- **Recherche** dans les mouvements de tous les comptes (libellé, montant, date).
- Étiquettes, historique des mouvements, annulation d'une suppression, virements internes liés.
- **Ajout rapide** : bouton flottant ; raccourcis sur l'icône de l'app installée (ajout rapide, actualiser, virements de paie).
- **Conseil quinzaine** : un retrait de livret en cours de quinzaine signale ce que rapporterait d'attendre le 1er ou le 16.
- **Taux des livrets** mis à jour avec leur date d'effet (ex. 1,7 % au 1er août), pour tous les livrets concernés d'un coup.
- **Actualiser solde** : saisie du nouveau solde, du total affiché par la banque (la part propre en est déduite), ou ajustement « + / − x € sur ma part / celle des parents ».
- **Mouvements récurrents** mensuels (onglet Virements → Récurrents).
- **Versements cumulés** sur PEA, Assurance Vie, Crypto… : un versement est distingué d'une variation de valeur.

### Pilotage budgétaire
- Calcul du **« super net »** :
  - barème progressif ;
  - charges salariales ;
  - abattement de 10 % plafonné ;
  - Navigo, mutuelle, titres-restaurant.
- **Mode exact** : les chiffres réels d'une fiche de paie remplacent la formule.
- **Votre paie, virement par virement**, à cocher au fil des virements (montant réel modifiable, versements d'épargne enregistrés en un clic) : charges fixes saisies (un virement sortant = une ligne), abonnements mensuels (automatiques), épargne projets, argent plaisir, puis l'épargne répartie entre les comptes.
- Capacité d'épargne, stratégie de placement selon les taux et plafonds, remplissage des livrets, durée de survie.
- **Rappel du jour de paie** (notification) : toute la répartition, jusqu'à « 400 € sur le LEP, 250 € sur le Livret A », recalculée sur les soldes du moment.
- **Horloge fiscale** : maturité des PEA, PEE et Assurance Vie.

### Rendement et fiscalité
- **Rendement net** (prélèvements sociaux et frais éventuels déduits) et **projection selon la répartition** (100 % Livret A, votre répartition, 100 % Assurance Vie) sur 5, 10 ou 20 ans.
- **Intérêts attendus au 31 décembre** (année complète aux soldes actuels), dont la part produite par le capital parental.
- **Intérêts réellement acquis** selon la règle des quinzaines des livrets réglementés, à côté du rythme annualisé.
- Taux pondérés dans le temps, et part des intérêts offerte par les parents.
- Manque à gagner du cash dormant.
- **Gains nets si retrait** (PEA, Assurance Vie…) : PFU, exonération d'IR du PEA/PEE après maturité, taux réduit de l'AV après 8 ans. Ces comptes sont à fiscalité différée, il n'y a rien à déclarer tant qu'on ne retire rien.
- **Barème de l'impôt** à jour (barème 2026), anciens barèmes conservés, vérification des paramètres fiscaux chaque début d'année.
- **Plus-values latentes** et impôt si tout était retiré, plafond de versements du PEA.
- Compte à rebours avant la maturité fiscale de chaque compte.

### Autres écrans
- **Historique** mensuel du patrimoine et des charges.
- **Dons** aux associations : total par taux (66 % / 75 %), réduction d'impôt estimée, reçus fiscaux joints depuis Drive, rappel à l'ouverture de la déclaration en avril.
- **Abonnements** : rappel la veille du prélèvement, ou une semaine avant à partir de 100 €. Seuls les mensuels comptent dans les charges fixes.
- **Fiches de paie** :
  - import depuis Drive (Google Picker) ;
  - extraction par Gemini, avec nouvelles tentatives et modèles de repli en cas de saturation ;
  - relecture obligatoire, puis graphique d'évolution du net.

### Sécurité et notifications
- **Verrou de l'appareil** par biométrie (WebAuthn) ou code PIN (PBKDF2). Il se réactive dès que l'app passe en arrière-plan.
- **Pastille sur l'icône** de l'app installée : nombre de choses à faire.
- **Hausse de salaire repérée** sur les fiches de paie, avec proposition d'ajuster l'épargne.
- **Notifications push**, activables appareil par appareil. Vérification quotidienne des rappels ; chaque rappel n'est envoyé qu'une fois et ouvre l'écran concerné. Bilan du mois écoulé le 1er, rappel des relevés annuels des placements mi-janvier.
- **E-mail récapitulatif aux parents** (via Gmail) lors des mouvements sur Livret A / LEP, envoyé seulement après une sauvegarde confirmée.
- Export et import JSON complets, export CSV.
- **Quoi de neuf** : après chaque mise à jour, une fenêtre résume une fois les nouveautés ; l'historique complet est dans Paramètres.

## Identité visuelle

- **Nom** : Pécule. **Slogan** : « Faites pousser votre épargne ».
- **Logo** : une pousse qui sort d'une pièce. La source vectorielle est dans `src/components/Logo.tsx`, et les PNG dans `public/` (192, 512, `apple-touch-icon` 180).
- **Couleurs** : vert sapin `#14532d` (fond de marque, menu), or `#fbbf24`, crème `#fef3c7`, gris chauds (stone). Dans `src/index.css` (bloc `@theme`, Tailwind 4), `indigo` pointe vers l'échelle sapin, donc les classes `indigo-*` du code sont vertes.
- **Ton** : bienveillant et concret, en phrases simples.
- **Noms techniques** : le dépôt (`suivi-epargne`), l'adresse GitHub Pages (`/suivi-epargne/`), le fichier Drive (`suivi_epargne.json`) et le Worker (`suivi-epargne-api`) gardent l'ancien nom pour ne rien casser.

## Architecture

```
Navigateur (React, PWA sur GitHub Pages)
  ├── Google Drive  ← lecture/écriture directes du fichier de données
  ├── Gmail         ← e-mail aux parents
  ├── Gemini        ← extraction des fiches de paie (clé de l'utilisateur)
  └── Worker Cloudflare (optionnel)
        ├── session : refresh token chiffré → jetons d'accès d'une heure
        └── tâche quotidienne : lit le fichier Drive → notifications push
```

Les données financières ne transitent pas par le serveur, sauf la lecture quotidienne pour les notifications.

**Robustesse de la synchronisation** (`src/hooks/usePortfolioData.ts`) :
- **Contrôle de révision** Drive : aucune écriture à l'aveugle par-dessus un autre appareil.
- **Écritures sérialisées.**
- **Mise en quarantaine** locale des modifications non synchronisées.
- **Coordination entre onglets**, et mode hors-ligne.
- **Délais maximaux** sur tous les appels réseau.
- **Rechargement automatique** quand une nouvelle version de l'app est déployée, pour qu'un vieil onglet n'écrase pas des champs récents.

### Organisation du code
| Dossier | Contenu |
|---|---|
| `src/components/` | Écrans et composants d'interface |
| `src/hooks/` | État applicatif et synchronisation Drive |
| `src/lib/` | Calculs purs et testés : fiscalité, intérêts, dates, saisie des nombres |
| `src/services/` | Google (Drive, Gmail, Picker), Gemini, serveur, notifications, verrou |
| `public/` | Icônes, page de confidentialité, extension du service worker (push) |
| `worker/` | Serveur Cloudflare — voir [worker/README.md](worker/README.md) |

## Développement

Prérequis : Node.js 22+ (version de référence dans `.nvmrc`).

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # tests unitaires (app + serveur)
npm run typecheck  # vérification des types (app + serveur)
npm run lint       # ESLint (erreurs bloquantes en CI)
npm run build
```

**Mode démo** : avec `npm run dev`, ouvre <http://localhost:5173/?demo=1>. L'app se charge avec des données fictives (`src/dev/demoData.ts`), sans connexion Google : rien n'est lu ni écrit sur Drive. Ce mode n'existe qu'en développement, il est absent du build de production.

Entretien courant, invariants à respecter et procédures en cas de panne : voir [MAINTENANCE.md](MAINTENANCE.md).

En local, l'app tourne **sans serveur** par défaut. Pour la tester contre le Worker local, lance `npm run dev` dans `worker/` (sur le port 8787), et crée à la racine un fichier `.env.development.local` contenant :

```
VITE_BACKEND_URL=http://localhost:8787
```

**Configuration Google Cloud** (client OAuth « Application Web », identifiant dans `src/services/googleDriveService.ts`) :
- **Origines JavaScript autorisées** : `https://antoninnourisson-cloud.github.io` et `http://localhost:5173`.
- **URI de redirection autorisé** : `https://<worker>.workers.dev/auth/callback` (mode serveur).
- **API activées** : Google Drive, Gmail, Google Picker.
- **Écran de consentement « En production »** : en mode test, les sessions expirent après 7 jours.

## Déploiement

**Avant chaque mise à jour visible**, ajouter une entrée en tête de [`src/changelog.ts`](src/changelog.ts) (version `AAAA.MM.JJ`, titre, deux à cinq phrases simples). C'est elle qui déclenche la fenêtre « Quoi de neuf ».

Tout passe par GitHub Actions (`.github/workflows/`) :

| Workflow | Quand | Ce qu'il fait |
|---|---|---|
| `ci.yml` (Vérifications) | chaque pull request, chaque push sur `main`, chaque lundi à 6 h UTC | types (app + serveur), tests, build (tailles des fichiers dans le résumé du run), audit des dépendances de production (informatif) |
| `deploy.yml` (Déploiement GitHub Pages) | chaque push sur `main` | les vérifications de `ci.yml`, puis build, publication sur GitHub Pages, et enfin tag `v<version>` + GitHub Release avec les puces de l'entrée en tête du changelog (une seule fois par version) |
| `worker.yml` (Déploiement du serveur) | push sur `main` touchant `worker/`, `src/lib/`, `src/types.ts` ou `src/constants.ts` (ou lancement à la main) | types, tests, puis `wrangler deploy`. Sauté tant que les secrets `CLOUDFLARE_API_TOKEN` et `CLOUDFLARE_ACCOUNT_ID` n'existent pas dans le dépôt |

- **App** : l'adresse du serveur est définie dans `.env.production`. Le commit déployé est injecté au build (`__BUILD_SHA__`, « dev » en local).
- **Serveur** : automatique une fois les deux secrets ajoutés ; sinon `npm run deploy` dans `worker/`. L'installation initiale, les secrets du Worker et la révocation sont décrits dans [worker/README.md](worker/README.md).
- **Dépendances** : Dependabot propose chaque mois des mises à jour groupées (`.github/dependabot.yml`). Les versions majeures de React, Tailwind, Vite, Vitest et Recharts se font à la main.

## Sur mobile

Installe l'app sur l'écran d'accueil :
- **iPhone** : dans Safari, Partager → *Sur l'écran d'accueil*.
- **Android** : dans Chrome, menu → *Installer l'application*.

Sur iPhone, les notifications ne fonctionnent que dans l'app installée.

---

Projet personnel, non commercial.

**Licence** : Tous droits réservés — projet personnel.
