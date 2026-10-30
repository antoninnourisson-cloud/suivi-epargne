# Serveur Pécule (Cloudflare Worker)

Ce que le serveur fait, et seulement ça :

1. **Session Google persistante** — le serveur garde ton *refresh token* Google (chiffré) et
   délivre à l'app des jetons d'accès d'une heure. Tu ne te reconnectes plus, même en PWA.
2. **Notifications push** — chaque jour à 7 h UTC, il relit ton fichier Drive et t'envoie les
   rappels : échéances récurrentes, révision des taux réglementés, intérêts parentaux de
   décembre, soldes à revérifier compte par compte (compte courant après 30 jours, livrets après
   90, placements à relevé annuel après 400), jour de paie, point de paie (bilan de la
   paie précédente, replié dans le rappel du jour de paie quand les deux tombent le même
   jour), clôture de l'année écoulée début janvier (une seule notification, rien une fois
   l'année clôturée dans l'app ; les paramètres fiscaux de fin janvier en sont une étape et ne
   sont notifiés à part qu'une fois l'année clôturée)… Les dates sont celles de
   Paris (heure d'été comprise). Chaque rappel n'est envoyé qu'une fois.
3. **Sauvegarde de secours chiffrée** (facultative, `PUT/GET/DELETE /backup`) : l'app chiffre ses
   données avec une clé dérivée d'un code de secours que le serveur ne reçoit jamais ; il garde
   les copies récentes et au moins une par mois sur un an (`src/backupRetention.ts`), sans
   pouvoir les lire, et ne les efface jamais sur-le-champ (7 jours de délai, annulable).
4. **Veille fiscale hebdomadaire**, détaillée ci-dessous.

La **veille fiscale** (`src/fiscalWatchJob.ts`) : chaque lundi à 5 h UTC,
le serveur relit 10 pages officielles (`src/fiscalSources.ts`) : 9 de service-public.gouv.fr,
dont le remboursement des transports par l'employeur, et celle de l'INSEE sur l'inflation, et
fait relever par **Cloudflare Workers AI** (`@cf/meta/llama-3.3-70b-instruct-fp8-fast`, mode
JSON, température 0, une page par appel) les taux, plafonds, prélèvements sociaux, décote,
barème, inflation annuelle et dernière année de l'exonération du transport. Chaque valeur doit
figurer dans le texte de la page (nombre suivi de « % » ou « € », ou année écrite dans la page
pour l'inflation et le transport), sinon elle est écartée. Aucune donnée d'utilisateur n'est envoyée au modèle. Le résultat est
gardé en KV (`fiscal-watch:latest`) ; l'app le compare à ses paramètres et **propose** les
écarts (jamais appliqués d'office), et Paramètres → Veille fiscale → *Détail du relevé* montre
chaque valeur avec la phrase de la page. À l'ouverture, l'app relance la veille si le dernier
relevé manque ou date de plus de 8 jours (`POST /fiscal-watch/run`, bridé) ; sans relevé
récent, elle revient à Gemini (clé de l'appareil).

L'app reste hébergée sur GitHub Pages (derrière Cloudflare et le Worker des en-têtes `edge/`,
qui n'a rien à voir avec ce serveur). Tant que `VITE_BACKEND_URL` n'est pas défini, elle
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
- `ALLOWED_EMAILS` : l'adresse de ton compte Google. Le serveur refuse tout autre compte.

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
  secrets Cloudflare ; ton e-mail et ton identifiant Google (tous trois gardés seulement tant
  qu'une session ou une notification s'en sert : effacés à la déconnexion du dernier appareil,
  et 61 jours au plus sans usage, voir `src/userRecords.ts`) ; les empreintes des sessions ; les
  abonnements push ; des marqueurs « déjà envoyé » (~400 jours) ; l'état de la tâche
  quotidienne ; si tu l'as activée, tes sauvegardes de secours **chiffrées par l'app**
  (illisibles pour lui) ; et des données publiques : le dernier relevé de la veille fiscale
  (`fiscal-watch:*`) et le texte des pages officielles en cache (`fiscal-sources`, 3 jours).
  Pour les notifications, il lit ton fichier de données une fois par jour et n'en garde rien.
  Il ne stocke aucune donnée financière lisible.
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
- **Session liée à l'appareil** (`src/deviceProof.ts`) : à la connexion, l'app crée une paire
  de clés ECDSA P-256 dont la partie privée est **non exportable** et envoie la clé publique,
  gardée avec la session. Chaque requête porte ensuite `X-Pecule-Proof: <nonce>.<signature>`
  (signature de « nonce, méthode, chemin »). Le nonce est un HMAC de la session et d'une
  tranche de 5 minutes, rendu avec chaque réponse (`X-Pecule-Nonce`) et accepté 5 à 10 minutes :
  une preuve ne peut pas être préparée pour plus tard. Sans nonce ou avec un nonce périmé :
  `401 PROOF_REQUIRED` / `PROOF_NONCE` avec le nonce courant, l'app signe et réessaie une fois.
  Un jeton de session copié SEUL ne sert donc à rien sans l'appareil (une copie du profil
  entier du navigateur emporte la clé). Les sessions ouvertes avant cette protection et jamais
  liées sont refusées (`REAUTH_REQUIRED`, une reconnexion) ; une session récente restée sans
  clé (app d'avant la liaison) se lie à la première clé qui prouve sa possession
  (`POST /auth/bind`) ; une autre clé est ensuite refusée (`409 BOUND_ELSEWHERE`).
  Retirer une adresse d'`ALLOWED_EMAILS` ferme aussi ses sessions déjà ouvertes.
- **Effacement des copies de secours** : seulement programmé (7 jours, annulable,
  `GET /backup/deletion` lu par l'app à chaque ouverture). La notification part aussi vers les
  appareils retirés par une autre session depuis moins de 30 jours (`push-removed:<sub>`).
- **Le compromis qui reste** : un script malveillant qui s'exécuterait DANS l'app peut faire
  signer des requêtes tant qu'il y est (la clé est utilisable, pas lisible), et envoyer
  ailleurs des preuves valables 10 minutes au plus. La CSP de l'app
  limite les scripts aux fichiers Google exacts ; « Appareils connectés » (Paramètres) montre
  chaque session et permet d'en déconnecter une ; « Déconnecter tous les appareils » les révoque
  toutes.
- **Rien n'est détruit sur-le-champ** : « Désactiver » la sauvegarde de secours et « Supprimer
  mes données serveur » PROGRAMMENT l'effacement des copies chiffrées présentes, dans 7 jours (les copies envoyées ensuite restent ; annulable :
  `DELETE /backup/deletion`), annoncé par notification aux appareils ; la tâche quotidienne
  l'exécute à l'échéance. Les envois sont plafonnés (20 par jour et par compte, une copie par
  jour) et la conservation échelonnée garde des copies anciennes qu'aucun envoi ne chasse.
- **Alerte « retrait du verrou demandé »** : quand « Code oublié » est demandé sur un appareil,
  ses autres appareils reçoivent une notification (date, type d'appareil, ce qu'il faut faire),
  une fois par heure au plus (`POST /alert/lock-reset`).
- **Journaux** : seulement les messages écrits par le serveur (échecs, sans adresse IP ni
  jeton). Les journaux d'appels de Cloudflare, qui noteraient chaque requête avec ses en-têtes
  (donc l'adresse IP), sont désactivés (`wrangler.toml` : `invocation_logs = false`).

## API

Toutes les routes marquées 🔒 exigent `Authorization: Bearer <session>` et, pour une session liée
à l'appareil, l'en-tête `X-Pecule-Proof` (signé sur le nonce de l'en-tête `X-Pecule-Nonce` des
réponses) ; sinon `401` avec `REAUTH_REQUIRED` (session inconnue, ou d'avant la liaison),
`PROOF_REQUIRED` ou `PROOF_NONCE` (+ `nonce` à signer), ou `PROOF_INVALID`. Corps JSON lus en flux et limités à 4 Ko,
2 Mo pour `PUT /backup` (`413 {"error":"BODY_TOO_LARGE"}`, dès la limite dépassée).

| Route | Corps | Réponse |
|---|---|---|
| `GET /auth/start?return=<url>` | — | redirection vers Google |
| `GET /auth/callback` | — | redirection vers `<return>#login_code=…` |
| `POST /auth/exchange` | `{"code","key"?,"device"?}` (`key` : JWK P-256 public) | `{"session","access_token","expires_in","bound"?}` ; `400 INVALID_KEY` |
| `POST /auth/bind` 🔒 | `{"key","proof","device"?}` | `{"ok":true,"bound":true}` ; `409 BOUND_ELSEWHERE` (session récente restée sans clé ; les sessions d'avant la liaison : `401 REAUTH_REQUIRED`) |
| `GET /auth/sessions` 🔒 | — | `{"sessions":[{"id","device","createdAt","lastUsedAt","bound","legacy","current"}]}` |
| `POST /auth/sessions/revoke` 🔒 | `{"id"}` | `{"ok":true,"current":bool}` (ferme la session et ses abonnements) ; `404` |
| `POST /alert/lock-reset` 🔒 | `{"requestedAt","device"?}` | `{"ok":true,"delivered":n}` (alerte aux AUTRES appareils, une par heure au plus) |
| `POST /token` 🔒 | — | `{"access_token","expires_in"}` |
| `POST /auth/logout` 🔒 | — | `{"ok":true}` (retire aussi les abonnements de cette session) |
| `POST /auth/logout-all` 🔒 | — | `{"ok":true,"sessionsRevoked":n}` (toutes les sessions + tous les abonnements) |
| `POST /account/delete` 🔒 | — | `{"ok":true,"googleRevoked":bool,"backupsDeletionAt"?}` (efface tout, révoque chez Google ; copies de secours effacées 7 jours plus tard) |
| `GET /push/vapid-public-key` | — | `{"key"}` |
| `POST /push/subscribe` 🔒 | `{"subscription":{endpoint,keys}}` | `{"ok":true,"devices":n}` ; `400 INVALID_SUBSCRIPTION`, `409 TOO_MANY_DEVICES` |
| `POST /push/unsubscribe` 🔒 | `{"endpoint"}` | `{"ok":true,"devices":n}` |
| `GET /push/devices` 🔒 | — | `{"devices":[{"id","host","createdAt","current"}]}` |
| `POST /push/remove` 🔒 | `{"id"}` ou `{"endpoint"}` | `{"ok":true,"removed":bool,"devices":n}` |
| `POST /push/test` 🔒 | — | `{"ok":bool,"delivered":n}` |
| `GET /status` | — | `{"ok","cron":{"lastRunAt","ok"},"site":{"checkedAt","ok","failing","hsts"},"fiscalWatch":{"lastSuccessAt","lastFailureAt","ok"},"history":[…10 passages des crons, catégories d'erreur seulement]}` (clés KV `health:fiscal-watch` et `health:cron-log` ; surveillance, sans donnée personnelle ; `site` : pages publiques, et script principal cité par `index.html` qui doit répondre 200 en JavaScript, pour repérer un écran blanc) |
| `PUT /backup` 🔒 | copie chiffrée (≤ 2 Mo) | `{"date","dates"}` ; conservation échelonnée (24 copies au plus) ; `429` au-delà de 20 envois par jour |
| `GET /backup` 🔒 | — | `{"dates","deletion"?}` ; `GET /backup/:date` : la copie chiffrée |
| `DELETE /backup` 🔒 | — | programme l'effacement, dans 7 jours, des copies présentes ; une nouvelle demande ajoute les copies envoyées depuis (chacune garde sa propre échéance ; `purgeAt` = la plus tardive) : `{"ok","scheduled","purgeAt","copies"}` |
| `GET /backup/deletion` 🔒 | — | `{"deletion":{"requestedAt","purgeAt","copies"}}`, ou `{"deletion":null}` (lu par l'app à chaque ouverture) |
| `DELETE /backup/deletion` 🔒 | — | annule l'effacement programmé : `{"ok","cancelled"}` |
| `GET /health` 🔒 | — | `{"lastRunAt","ok","usersProcessed","error"?}` (dernière tâche quotidienne) |
| `GET /fiscal-sources` 🔒 | — | `{"fetchedAt","sources":[{url,topic,text,ok}]}` (texte des pages officielles, cache 3 jours) |
| `GET /fiscal-watch` 🔒 | — | dernier relevé : `{"checkedAt","model","ok","values","sources":[{url,topic,status,fields,rejected}],"neuronsEstimate","neuronsUsed"?}` ; `404 NOT_YET_RUN` avant le premier |
| `POST /fiscal-watch/run` 🔒 | — | relance la veille (≤ 1 min) ; `429 TOO_SOON` (+ `latest`) moins de 20 h après un succès ou 6 h après un essai ; `502` si aucune valeur relevée ; `503 AI_UNAVAILABLE` sans binding |

## Tout révoquer d'un coup
- Dans l'app : **Supprimer mes données serveur** (`POST /account/delete`) efface tout ce que
  le serveur sait de toi et retire l'accès chez Google ; les sauvegardes de secours chiffrées
  suivent 7 jours plus tard (annulable en se reconnectant).
- Ou sur <https://myaccount.google.com/permissions>, retire l'accès de l'application. Le
  serveur reçoit alors `invalid_grant` à la demande suivante (ou à la tâche quotidienne) et
  efface tout : jeton, sessions, abonnements, marqueurs. Chaque appareil repasse sur l'écran
  de connexion. Seules les sauvegardes de secours chiffrées restent (illisibles, effacées au
  bout d'un an), pour pouvoir encore restaurer après reconnexion ; « Désactiver » ou
  « Supprimer mes données serveur » programment leur effacement (7 jours, annulable).
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
rendu de la tâche quotidienne est aussi lisible par l'app (`GET /health`). La veille fiscale
journalise `fiscal watch <ok> <n> values <neurones> neurons` ; sa consommation réelle est
visible dans le tableau de bord (AI → Workers AI).

## Limites de l'offre gratuite
| Ressource | Limite gratuite | Usage de Pécule |
|---|---|---|
| Requêtes Worker | 100 000 / jour | quelques dizaines |
| Écritures KV (put + delete) | 1 000 / jour | ~1 par connexion, 1 par jour et par session utilisée, 1 par rappel envoyé, 1 pour l'état de la tâche |
| Lectures KV | 100 000 / jour | quelques centaines |
| Workers AI | 10 000 neurones / jour | une veille (10 pages) ≈ 2 000 à 2 500 neurones (plafond codé : 6 000, pire cas estimé ≈ 3 500), une fois par semaine |
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
