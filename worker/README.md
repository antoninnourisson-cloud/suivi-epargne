# Serveur Pécule (Cloudflare Worker)

Deux fonctions, et seulement deux :

1. **Session Google persistante** — le serveur garde ton *refresh token* Google (chiffré) et
   délivre à l'app des jetons d'accès d'une heure. Tu ne te reconnectes plus, même en PWA.
2. **Notifications push** — chaque jour à 7 h UTC, il relit ton fichier Drive et t'envoie les
   rappels : échéances récurrentes, révision des taux réglementés, intérêts parentaux de
   décembre, soldes non actualisés depuis 30 jours, jour de paie, point de paie (bilan de la
   paie précédente, replié dans le rappel du jour de paie quand les deux tombent le même
   jour)… Les dates sont celles de
   Paris (heure d'été comprise). Chaque rappel n'est envoyé qu'une fois.

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

**Sans terminal pour les secrets personnels** : `npm run setup-secrets -- --generated-only` ne pose
que les clés générées, sans rien demander. Les deux autres se renseignent ensuite dans le tableau
de bord Cloudflare : Workers & Pages → `suivi-epargne-api` → Paramètres → Variables et secrets →
*Ajouter* → type **Secret**. C'est la méthode utilisée pour le déploiement actuel.

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
  sur Drive), chiffré en AES-256-GCM avec une clé stockée à part, dans les
  secrets Cloudflare ; ton e-mail et ton identifiant Google ; les empreintes des sessions ; les
  abonnements push ; des marqueurs « déjà envoyé » (~400 jours) ; l'état de la tâche
  quotidienne. Pour les notifications, il lit ton fichier de données une fois par jour et n'en
  garde rien. Il ne stocke aucune donnée financière.
- **Les sessions des appareils** sont stockées hachées (SHA-256) : une fuite du stockage ne
  permet pas de les rejouer. Elles expirent après 30 jours sans utilisation, et **60 jours au
  plus** après la connexion, même utilisées tous les jours. Les sessions d'avant cette règle
  démarrent leur compteur de 60 jours à leur première utilisation.
- **Connexion** : le `state` OAuth est signé (HMAC-SHA256, clé dérivée de `ENCRYPTION_KEY` par
  HKDF : aucun secret en plus) et lié au navigateur par un cookie `__Host-` ; l'`id_token` est
  vérifié (`aud` = notre client, `iss` = Google) ; seuls les e-mails de `ALLOWED_EMAILS` passent.
  Le code de connexion remis à l'app est stocké haché, son contenu chiffré, 60 s au plus, et
  effacé dès l'échange.
- **Origines** : seule l'app (`APP_URL`) est autorisée en production ; une requête venant d'une
  autre origine est refusée (403) avant toute lecture du stockage. L'URL de retour après
  connexion doit commencer par `APP_URL` (origine **et** chemin). Pendant le déménagement
  vers pecule-app.com, `LEGACY_APP_URL` (l'ancienne adresse github.io) est aussi acceptée.
- **Notifications** : chiffrées de bout en bout (RFC 8291). Seuls les services de push des
  navigateurs sont acceptés (FCM, Mozilla, Apple, Windows), 10 appareils au plus. Chaque
  abonnement appartient à la session qui l'a créé et disparaît avec elle. Si le fichier de
  données contient `config.discreetNotifications: true`, les textes ne contiennent aucun montant.
- **Limitation de débit** par IP (binding natif Cloudflare, sans écriture KV) : 20 requêtes/min
  sur `/auth/*` et `/account/delete`, 60/min sur `/token` et le reste. Au-delà : 429.
- **Le compromis** : la session d'un appareil est une capacité de longue durée. Un script
  malveillant qui s'exécuterait dans l'app pourrait la voler, alors qu'avant il ne pouvait
  obtenir qu'un jeton d'une heure. La CSP de l'app limite ce risque en n'autorisant que les
  origines Google et celle du Worker ; « Déconnecter tous les appareils » la révoque partout.

## API

Toutes les routes marquées 🔒 exigent `Authorization: Bearer <session>` ; sans session valide :
`401 {"error":"REAUTH_REQUIRED"}`. Corps JSON limités à 4 Ko (`413 {"error":"BODY_TOO_LARGE"}`).

| Route | Corps | Réponse |
|---|---|---|
| `GET /auth/start?return=<url>` | — | redirection vers Google |
| `GET /auth/callback` | — | redirection vers `<return>#login_code=…` |
| `POST /auth/exchange` | `{"code"}` | `{"session","access_token","expires_in"}` |
| `POST /token` 🔒 | — | `{"access_token","expires_in"}` |
| `POST /auth/logout` 🔒 | — | `{"ok":true}` (retire aussi les abonnements de cette session) |
| `POST /auth/logout-all` 🔒 | — | `{"ok":true,"sessionsRevoked":n}` (toutes les sessions + tous les abonnements) |
| `POST /account/delete` 🔒 | — | `{"ok":true,"googleRevoked":bool}` (efface tout, révoque chez Google) |
| `GET /push/vapid-public-key` | — | `{"key"}` |
| `POST /push/subscribe` 🔒 | `{"subscription":{endpoint,keys}}` | `{"ok":true,"devices":n}` ; `400 INVALID_SUBSCRIPTION`, `409 TOO_MANY_DEVICES` |
| `POST /push/unsubscribe` 🔒 | `{"endpoint"}` | `{"ok":true,"devices":n}` |
| `GET /push/devices` 🔒 | — | `{"devices":[{"id","host","createdAt","current"}]}` |
| `POST /push/remove` 🔒 | `{"id"}` ou `{"endpoint"}` | `{"ok":true,"removed":bool,"devices":n}` |
| `POST /push/test` 🔒 | — | `{"ok":bool,"delivered":n}` |
| `GET /health` 🔒 | — | `{"lastRunAt","ok","usersProcessed","error"?}` (dernière tâche quotidienne) |

## Tout révoquer d'un coup
- Dans l'app : **Supprimer mes données serveur** (`POST /account/delete`) efface tout ce que
  le serveur sait de toi et retire l'accès chez Google.
- Ou sur <https://myaccount.google.com/permissions>, retire l'accès de l'application. Le
  serveur reçoit alors `invalid_grant` à la demande suivante (ou à la tâche quotidienne) et
  efface tout : jeton, sessions, abonnements, marqueurs. Chaque appareil repasse sur l'écran
  de connexion.
- Si Google refuse le rafraîchissement pour une autre raison (panne, clé changée), la tâche
  quotidienne envoie « Reconnectez-vous à Pécule pour garder vos rappels », au plus une fois
  tous les 3 jours.

## Développement local
`npm run dev` lance `wrangler dev` avec `EXTRA_ORIGINS=http://localhost:5173` (option `--var`) :
l'app servie par Vite peut alors parler au Worker local. En production, `localhost` n'est pas
autorisé (rien dans `[vars]`). Les secrets locaux viennent de `.dev.vars`.

## Observabilité
`[observability] enabled = true` : logs et erreurs consultables dans le tableau de bord
Cloudflare (Workers & Pages → `suivi-epargne-api` → *Logs*), sans `wrangler tail`. Le compte
rendu de la tâche quotidienne est aussi lisible par l'app (`GET /health`).

## Limites de l'offre gratuite
| Ressource | Limite gratuite | Usage de Pécule |
|---|---|---|
| Requêtes Worker | 100 000 / jour | quelques dizaines |
| Écritures KV (put + delete) | 1 000 / jour | ~1 par connexion, 1 par jour et par session utilisée, 1 par rappel envoyé, 1 pour l'état de la tâche |
| Lectures KV | 100 000 / jour | quelques centaines |
| CPU | 10 ms par requête | le chiffrement push et la lecture du fichier restent en dessous ; la tâche quotidienne est un cron, plafonné pareil mais l'attente réseau ne compte pas |

Le state OAuth signé et le limiteur natif évitent des écritures KV ; une suppression de compte
efface un marqueur par rappel envoyé (quelques centaines au plus), ce qui reste dans le quota.

## Maintenance
- Voir les logs en direct : `npm run logs` (ou le tableau de bord, voir Observabilité)
- Redéployer après une modification : `npm run deploy`
- Tests : `npm test` à la racine du dépôt (le chiffrement push est vérifié contre le vecteur
  officiel de la RFC 8291 ; sessions, state OAuth, abonnements et mode discret ont leurs tests)
- `npm run setup-secrets -- --force` régénère TOUS les secrets. À éviter : ça déconnecte tous
  les appareils et oblige à réactiver les notifications partout.
