# Serveur Suivi Épargne (Cloudflare Worker)

Deux fonctions, et seulement deux :

1. **Session Google persistante** — le serveur garde ton *refresh token* Google (chiffré) et
   délivre à l'app des jetons d'accès d'une heure. Tu ne te reconnectes plus, même en PWA.
2. **Notifications push** — chaque jour à 7 h UTC, il relit ton fichier Drive et t'envoie les
   rappels : échéances récurrentes, révision des taux réglementés, intérêts parentaux de
   décembre, soldes non actualisés depuis 30 jours. Chaque rappel n'est envoyé qu'une fois.

L'app reste hébergée sur GitHub Pages. Tant que `VITE_BACKEND_URL` n'est pas défini, elle
fonctionne sans serveur, comme avant.

## Installation (une seule fois)

Toutes les commandes se lancent dans le dossier `worker/`.

### 1. Compte Cloudflare
Crée un compte gratuit sur <https://dash.cloudflare.com/sign-up>. L'offre gratuite couvre très
largement un usage personnel.

### 2. Connexion de wrangler à ton compte
```
npx wrangler login
```
Un onglet s'ouvre : autorise l'accès.

### 3. Stockage et premier déploiement
```
npx wrangler kv namespace create STORE
```
Copie l'`id` affiché dans `wrangler.toml` (ligne `id = "REMPLACER_PAR_L_ID_DU_NAMESPACE"`), puis :
```
npx wrangler deploy
```
Note l'adresse affichée, du type `https://suivi-epargne-api.<ton-sous-domaine>.workers.dev`.

### 4. Google Cloud Console
Sur <https://console.cloud.google.com/apis/credentials>, ouvre le client OAuth dont
l'identifiant commence par `763862877733-` :

- **URI de redirection autorisés** → *Ajouter un URI* :
  `https://suivi-epargne-api.<ton-sous-domaine>.workers.dev/auth/callback`, puis **Enregistrer**.
- Garde cette page ouverte : le **Code secret du client** te servira à l'étape 5.

Puis dans **Écran de consentement OAuth** (ou *Audience*), vérifie le **statut de publication** :
s'il est « En test », passe-le **« En production »**. En mode test, Google fait expirer les
refresh tokens au bout de 7 jours, ce qui annulerait l'intérêt de la session persistante.
Google affichera ensuite « application non validée » à la connexion : c'est normal pour une app
personnelle. Clique sur *Paramètres avancés → Accéder à…*.

### 5. Secrets
```
npm run setup-secrets
```
Le script génère la clé de chiffrement et les clés de notification, puis les enregistre
directement chez Cloudflare sans jamais les afficher. Il te demande ensuite deux valeurs, en
saisie masquée :
- `GOOGLE_CLIENT_SECRET` : le code secret de l'étape 4 ;
- `ALLOWED_EMAILS` : ton adresse Gmail. Le serveur refuse tout autre compte.

### 6. Relier l'app
Crée `.env.production` à la racine du dépôt :
```
VITE_BACKEND_URL=https://suivi-epargne-api.<ton-sous-domaine>.workers.dev
```
Commite et pousse : GitHub Pages reconstruit l'app en mode serveur.

### 7. Sur chaque appareil
Ouvre l'app et reconnecte-toi une dernière fois. Puis **Paramètres → Notifications → Activer**,
et **Envoyer un test**.
Sur iPhone, les notifications ne fonctionnent que si l'app est installée sur l'écran
d'accueil (Partager → *Sur l'écran d'accueil*).

## Sécurité : ce qu'il faut savoir

- **Ce que détient le serveur** : ton refresh token Google (portée : fichiers créés par l'app
  sur Drive + envoi de mails), chiffré en AES-256-GCM avec une clé stockée à part, dans les
  secrets Cloudflare. Pour les notifications, il lit ton fichier de données une fois par jour.
  Il ne stocke aucune donnée financière.
- **Les sessions des appareils** sont stockées hachées (SHA-256) : une fuite du stockage ne
  permet pas de les rejouer. Elles expirent après 180 jours sans utilisation.
- **Le compromis** : la session d'un appareil est une capacité de longue durée. Un script
  malveillant qui s'exécuterait dans l'app pourrait la voler, alors qu'avant il ne pouvait
  obtenir qu'un jeton d'une heure. La CSP de l'app limite ce risque en n'autorisant que les
  origines Google et celle du Worker.
- **Notifications** : chiffrées de bout en bout (RFC 8291). Le service de push (Google, Apple,
  Mozilla) les transporte sans pouvoir les lire.

## Tout révoquer d'un coup
Sur <https://myaccount.google.com/permissions>, retire l'accès de l'application. Le serveur
reçoit alors `invalid_grant` à la demande suivante et efface lui-même les sessions
concernées : chaque appareil repasse sur l'écran de connexion.

## Maintenance
- Voir les logs en direct : `npm run logs`
- Redéployer après une modification : `npm run deploy`
- Tests : `npm test` à la racine du dépôt (le chiffrement push est vérifié contre le vecteur
  officiel de la RFC 8291)
- `npm run setup-secrets -- --force` régénère TOUS les secrets. À éviter : ça déconnecte tous
  les appareils et oblige à réactiver les notifications partout.
