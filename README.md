# Suivi Épargne

> Tableau de bord d'épargne personnel, calibré pour la fiscalité française. Vos données restent sur **votre** Google Drive.

[![React](https://img.shields.io/badge/React-18-blue?logo=react)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-5-purple?logo=vite)](https://vitejs.dev/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-3-teal?logo=tailwindcss)](https://tailwindcss.com/)
[![Cloudflare Workers](https://img.shields.io/badge/Serveur-Cloudflare%20Workers-orange?logo=cloudflare)](https://workers.cloudflare.com/)

**App en ligne :** <https://antoninnourisson-cloud.github.io/suivi-epargne/> · [Règles de confidentialité](https://antoninnourisson-cloud.github.io/suivi-epargne/confidentialite.html)

## Présentation

Suivi Épargne est une application web installable (PWA) pour suivre ses comptes d'épargne, piloter son budget et anticiper sa fiscalité. Elle n'a pas de base de données : toutes les données tiennent dans un seul fichier `suivi_epargne.json`, sur le Google Drive de l'utilisateur. L'app n'a accès qu'aux fichiers qu'elle a créés (portée OAuth `drive.file`).

Un **petit serveur optionnel** (Cloudflare Worker, dossier [`worker/`](worker/)) ajoute deux choses impossibles depuis le seul navigateur : une **session Google persistante** et des **notifications push**. Sans lui, l'app fonctionne entièrement côté navigateur.

## Fonctionnalités

### Tableau de bord
- Épargne nette, répartie entre disponible, contrainte fiscale (AV/PEA récents) et bloqué (PEE, PER…).
- Évolution empilée par compte, et répartition par établissement.
- **Placé ce mois-ci** : jauge des versements du mois face au plan d'épargne.
- **Taux d'épargne** : part de la paie mise de côté, mois par mois sur un an.
- **Projection** à 6 et 12 mois d'après le rythme réel des 90 derniers jours, avec alerte si ce rythme ralentit ou accélère fortement.
- Alertes :
  - plafonds des livrets ;
  - **révision des taux réglementés** (1er février / 1er août) ;
  - **éligibilité au LEP** ;
  - soldes non actualisés ;
  - comptes vides inactifs ;
  - intérêts parentaux de fin d'année.
- **Échéances récurrentes** proposées à l'enregistrement, jamais écrites sans confirmation.

### Comptes et mouvements
- Distinction entre **part propre** et **capital des parents** sur chaque compte. Le capital parental est intouchable, ses intérêts reviennent à l'utilisateur.
- Étiquettes, historique des mouvements, annulation d'une suppression, virements internes liés.
- **Ajout rapide** : bouton flottant et raccourci sur l'icône de l'app installée.
- **Actualiser solde** : saisie du nouveau solde, ou ajustement « + / − x € sur ma part / celle des parents ».
- **Mouvements récurrents** mensuels (onglet Virements → Récurrents).
- **Versements cumulés** sur PEA, Assurance Vie, Crypto… : un versement est distingué d'une variation de valeur.

### Pilotage budgétaire
- Calcul du **« super net »** :
  - barème progressif ;
  - charges salariales ;
  - abattement de 10 % plafonné ;
  - Navigo, mutuelle, titres-restaurant.
- **Mode exact** : les chiffres réels d'une fiche de paie remplacent la formule.
- **Ta paie, virement par virement** : charges fixes saisies (un virement sortant = une ligne), abonnements mensuels (automatiques), épargne projets, argent plaisir, puis l'épargne répartie entre les comptes.
- Capacité d'épargne, stratégie de placement selon les taux et plafonds, remplissage des livrets, durée de survie.
- **Rappel du jour de paie** (notification) : toute la répartition, jusqu'à « 400 € sur le LEP, 250 € sur le Livret A », recalculée sur les soldes du moment.
- **Horloge fiscale** : maturité des PEA, PEE et Assurance Vie.

### Rendement et fiscalité
- **Intérêts réellement acquis** selon la règle des quinzaines des livrets réglementés, à côté du rythme annualisé.
- Taux pondérés dans le temps, et part des intérêts offerte par les parents.
- Manque à gagner du cash dormant.
- **Gains nets si retrait** (PEA, Assurance Vie…) : PFU, exonération d'IR du PEA/PEE après maturité, taux réduit de l'AV après 8 ans. Ces comptes sont à fiscalité différée, il n'y a rien à déclarer tant qu'on ne retire rien.
- **Plus-values latentes** et impôt si tout était retiré, plafond de versements du PEA.
- Compte à rebours avant la maturité fiscale de chaque compte.

### Autres écrans
- **Objectifs** : capacité théorique confrontée au rythme d'épargne réel.
- **Historique** mensuel du patrimoine et des charges.
- **Simulateur de retrait** : compte le moins coûteux à ponctionner (impôt, quinzaine perdue, intérêts sacrifiés), impact sur la durée de survie et sur un objectif.
- **Dons** aux associations : total par taux (66 % / 75 %), réduction d'impôt estimée, reçus fiscaux joints depuis Drive, rappel à l'ouverture de la déclaration en avril.
- **Abonnements** : rappel la veille du prélèvement, ou une semaine avant à partir de 100 €. Seuls les mensuels comptent dans les charges fixes.
- **Fiches de paie** :
  - import depuis Drive (Google Picker) ;
  - extraction par Gemini, avec nouvelles tentatives et modèles de repli en cas de saturation ;
  - relecture obligatoire, puis graphique d'évolution du net.

### Sécurité et notifications
- **Verrou de l'appareil** par biométrie (WebAuthn) ou code PIN (PBKDF2). Il se réactive dès que l'app passe en arrière-plan.
- **Notifications push**, activables appareil par appareil. Vérification quotidienne des rappels ; chaque rappel n'est envoyé qu'une fois et ouvre l'écran concerné. Bilan du mois écoulé le 1er, rappel des relevés annuels des placements mi-janvier.
- **E-mail récapitulatif aux parents** (via Gmail) lors des mouvements sur Livret A / LEP, envoyé seulement après une sauvegarde confirmée.
- Export et import JSON complets, export CSV.

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

Prérequis : Node.js 20+.

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # tests unitaires (app + serveur)
npm run typecheck  # vérification des types (app + serveur)
npm run build
```

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

- **App** : chaque push sur `main` déclenche GitHub Actions (tests, vérification des types, build, publication sur GitHub Pages). L'adresse du serveur est définie dans `.env.production`.
- **Serveur** : `npm run deploy` dans `worker/`. L'installation initiale, les secrets et la révocation sont décrits dans [worker/README.md](worker/README.md).

## Sur mobile

Installe l'app sur l'écran d'accueil :
- **iPhone** : dans Safari, Partager → *Sur l'écran d'accueil*.
- **Android** : dans Chrome, menu → *Installer l'application*.

Sur iPhone, les notifications ne fonctionnent que dans l'app installée.

---

Projet personnel, non commercial.
