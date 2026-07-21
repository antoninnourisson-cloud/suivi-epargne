> Un tableau de bord financier personnel, sécurisé et sans serveur, taillé sur mesure pour la fiscalité française.

[![React](https://img.shields.io/badge/React-18-blue?logo=react)](https://reactjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-5-purple?logo=vite)](https://vitejs.dev/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-3-teal?logo=tailwindcss)](https://tailwindcss.com/)
[![Google Drive API](https://img.shields.io/badge/Data-Google%20Drive-green?logo=google-drive)](https://developers.google.com/drive)

## 📋 Présentation

**Suivi Épargne** est une Progressive Web App (PWA) conçue pour reprendre le contrôle de vos finances personnelles. Contrairement aux agrégateurs bancaires classiques qui stockent vos données sur leurs serveurs, cette application fonctionne en **architecture "zéro-backend"**.

Vos données financières sont stockées **uniquement sur votre propre Google Drive personnel**, dans un fichier JSON auquel vous seul avez accès (portée OAuth `drive.file` : l'app ne voit que le fichier qu'elle a créé). Le contenu n'est pas chiffré côté application ; il repose sur la sécurité de votre compte Google.

L'application est spécifiquement calibrée pour le système français, intégrant le calcul automatique du net après impôt, les plafonds des livrets réglementés (Livret A, LEP, LDDS) et la gestion des avantages salariaux.

## ✨ Fonctionnalités Clés

### 🔐 Sécurité & Confidentialité
- **Zéro Serveur Intermédiaire :** L'application tourne entièrement dans votre navigateur.
- **Stockage Privé :** Vos données restent dans votre cloud personnel (Google Drive).
- **Authentification OAuth2 :** Connexion sécurisée via votre compte Google.

### 🇫🇷 Pilotage Budgétaire "Made in France"
- **Calculateur "Super Net" :** Conversion automatique du Brut Annuel en "Net dans la poche" après impôt à la source (barème progressif intégré), charges sociales et avantages.
- **Gestion des Avantages Salariaux :** Intégration fine des tickets restaurant, mutuelle d'entreprise et remboursement Navigo pour un calcul de reste à vivre précis.
- **Stratégie de Remplissage :** Algorithme intelligent suggérant l'ordre optimal de remplissage des livrets (LEP > Livret A > LDDS) selon les taux et plafonds en vigueur.

### 📈 Suivi & Analyse
- **Tableau de Bord Unifié :** Vue globale du patrimoine, répartition par type d'actifs et historique de l'évolution.
- **Gestion des Comptes :** Suivi des soldes avec distinction de la part personnelle et du capital parental.
- **Simulateur d'Intérêts :** Projection des gains futurs sur 1 à 20 ans.
- **Gestionnaire de Virements :** Interface simplifiée pour enregistrer dépôts et virements inter-comptes.

### 🤖 Assistant & Notifications
- **Alertes Parents :** Envoi automatique d'un email récapitulatif détaillé (via votre Gmail) à un tiers lors de mouvements sur les comptes réglementés (Livret A, LEP).

## 🛠️ Architecture Technique

Le projet est une **SPA (Single Page Application)** construite avec :
- **Framework :** React 18 + TypeScript pour la robustesse.
- **Build Tool :** Vite pour la rapidité de développement.
- **Styling :** Tailwind CSS pour un design moderne et réactif.
- **État & Logique :** Hooks personnalisés (`usePortfolioData`) gérant la synchronisation, la persistance et la logique métier complexe.

**Flux de données :**
1. L'utilisateur se connecte via Google OAuth2 (popup client-side).
2. L'app obtient un token d'accès temporaire.
3. Elle cherche un fichier `suivi_epargne.json` sur le Drive de l'utilisateur via l'API Google Drive.
4. Si inexistant, elle le crée avec des données par défaut. Si existant, elle le charge en mémoire.
5. Les modifications locales sont sauvegardées automatiquement dans ce fichier (avec "debounce").
6. Pour les notifications, l'app utilise l'API Gmail avec le token de l'utilisateur pour envoyer des mails en son nom.

## 🚀 Installation & Développement Local

### Prérequis
- Node.js (v18+)
- Un compte Google Cloud Platform (pour les clés API)

### 1. Cloner le projet
```bash
git clone [https://github.com/votre-utilisateur/suivi-epargne.git](https://github.com/votre-utilisateur/suivi-epargne.git)
cd suivi-epargne
npm install

2. Configuration Google Cloud (Critique)

Pour que l'application fonctionne, vous devez créer un projet Google Cloud et obtenir un CLIENT_ID.

    Rendez-vous sur la Google Cloud Console.

    Créez un nouveau projet.

    Dans "APIs & Services" > "Library", activez les APIs suivantes :

        Google Drive API

        Gmail API (pour les notifications)

    Dans "APIs & Services" > "Credentials" :

        Créez un "OAuth client ID".

        Type d'application : "Web application".

        Ajoutez http://localhost:5173 (le port par défaut de Vite) dans "Authorized JavaScript origins".

    Copiez votre Client ID.

    Ouvrez le fichier src/services/googleDriveService.ts et remplacez la valeur de CLIENT_ID par le vôtre.

3. Lancer le serveur de développement
Bash

npm run dev

L'application sera accessible sur http://localhost:5173.

## 🌐 Déploiement sur GitHub Pages

Le projet inclut un workflow GitHub Actions (`.github/workflows/deploy.yml`) qui build et déploie automatiquement à chaque push sur `main`.

### 1. Activer GitHub Pages
Dans les paramètres du repo → **Settings → Pages → Source**, choisissez **GitHub Actions** (pas "Deploy from a branch").

### 2. Autoriser l'origine dans Google Cloud Console (étape obligatoire)
C'est la seule configuration réellement nécessaire pour que l'authentification fonctionne une fois déployé. Le `CLIENT_ID` présent dans le code est un identifiant public — ce n'est pas un secret et il n'y a rien à cacher — mais Google refuse toute requête OAuth venant d'une origine non déclarée. Sans cette étape, la connexion Google échouera silencieusement sur le site déployé.

Dans Google Cloud Console → **APIs & Services → Credentials** → votre OAuth Client ID → **Authorized JavaScript origins**, ajoutez l'URL de votre déploiement :
- Repo utilisateur/organisation (`username.github.io`) : `https://username.github.io`
- Repo de projet (`username.github.io/nom-du-repo`) : `https://username.github.io` (l'origine à autoriser est le domaine seul, sans le sous-chemin)

### 3. Pousser sur `main`
Le workflow build l'app avec des chemins relatifs (`base: './'` dans `vite.config.ts`), donc elle fonctionne aussi bien à la racine du domaine que dans un sous-dossier, sans configuration supplémentaire à connaître à l'avance.

## 📱 Utilisation sur Mobile (PWA)

L'application est une PWA. Vous pouvez l'ajouter à votre écran d'accueil sur iOS (via Safari > Partager > Sur l'écran d'accueil) ou Android (via Chrome) pour une expérience proche d'une application native.

Note : La persistance de la session Google sur mobile peut être limitée par les navigateurs. Une migration future vers un wrapper natif (Capacitor) est envisagée.
📄 Licence

Distribué sous la licence MIT. Voir LICENSE pour plus d'informations.