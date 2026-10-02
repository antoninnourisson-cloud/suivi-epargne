# Maintenance de Pécule

Ce document rassemble ce qu'il faut savoir pour faire vivre l'app sans la casser : les règles à ne jamais enfreindre, la marche à suivre pour publier une mise à jour, où sont rangés les secrets, le calendrier de l'année et quoi faire quand quelque chose tombe en panne.

Voir aussi : [README.md](README.md) (fonctionnement général), [worker/README.md](worker/README.md) (serveur), [ROADMAP.md](ROADMAP.md) (pistes et notes techniques).

## 1. Invariants à ne pas casser

### Soldes et mouvements
- **Tout changement de solde passe par [`src/lib/accountOps.ts`](src/lib/accountOps.ts)** (`applyMovement`, `snapshotBalances`, `restoreBalances`). Ne jamais modifier `ownedAmount`, `parentalCapital`, `totalAmount` ou `totalDeposits` à la main ailleurs : ce calcul était autrefois recopié à six endroits et dérivait. Le total est toujours égal à part propre + part des parents, au centime.
- **Les `kind` de mouvement** :
  - pas de `kind` : versement ou retrait réel de l'utilisateur ;
  - `valuation` : variation de valeur (intérêts, plus-values) ;
  - `parental` : part des parents (ajout, correction, restitution) ;
  - `adjustment` : correction, « Pas de l'épargne ».
- **`isSavingsFlow`** ([`src/lib/finance/savings.ts`](src/lib/finance/savings.ts)) décide de ce qui compte comme épargne : seulement les mouvements sans `kind`, hors solde initial, et postérieurs à `config.trackingStartDate` (« Repartir de zéro »). « Placé », le taux d'épargne, la projection et les bilans en dépendent : tout nouveau calcul d'épargne doit passer par cette fonction.
- Un mouvement de restitution (`isRestitutionMovement`) ne se supprime ni ne se renomme à la main.

### Capital des parents
- **Le capital des parents est intouchable** : il n'est jamais proposé comme source d'un retrait ni compté dans l'épargne de l'utilisateur.
- **Ses intérêts appartiennent à l'utilisateur** : les parents les lui offrent en fin d'année. Les calculs d'intérêts (`computeParentalInterest`, `computeAccruedParentalInterest`) distinguent la part produite par ce capital, mais elle revient à l'utilisateur.
- **Restitution prévue vers le 1er janvier 2027** (le 1er janvier garde toute l'année d'intérêts). Une fois enregistrée, l'app passe en **mode solo** : plus de part parentale, plus d'e-mails aux parents. Le code lié aux parents doit continuer à fonctionner sans erreur quand le capital parental vaut zéro partout.

### Fichier de données
- **Un seul point d'entrée : `migrate()`** dans [`src/lib/schema.ts`](src/lib/schema.ts). Tout ce qui entre dans l'app (chargement Drive, import, restauration locale, synchronisation entre onglets, lecture par le Worker) passe par lui. Une nouvelle forme de données = une migration dans `migrate()`, nulle part ailleurs.
- **`APP_SCHEMA_VERSION`** : à augmenter **seulement** quand un changement rend le fichier dangereux pour une ancienne version de l'app (par exemple un champ dont le sens change). Les anciens clients refusent alors d'écrire et demandent une mise à jour. Ajouter un champ facultatif ne demande pas d'augmenter la version.
- **Les champs inconnus sont conservés** : `migrate()` garde tout ce qu'il ne connaît pas (`...rest`). Une version de l'app ne doit jamais effacer ce qu'une version plus récente a ajouté. Ne pas réécrire le fichier à partir d'une liste blanche de champs.
- **La clé Gemini reste sur l'appareil** : `withoutDeviceOnlyFields()` la retire de tout ce qui sort (fichier Drive, export, sauvegarde) et `canonicalize()` l'ignore. Ne jamais l'écrire sur Drive ni l'envoyer au Worker.

### Divers
- Ne jamais révoquer le jeton Google côté navigateur en mode serveur (cela déconnecterait tous les appareils, voir ROADMAP).
- Le nom technique `suivi-epargne` (dépôt, adresse, fichier Drive `suivi_epargne.json`, Worker `suivi-epargne-api`) ne change pas.

## 2. Publier une mise à jour

1. **Changelog** : ajouter une entrée **en tête** de [`src/changelog.ts`](src/changelog.ts) :
   - `version` au format `AAAA.MM.JJ`, avec `-2`, `-3`… pour plusieurs mises à jour le même jour ;
   - `date` = la même date au format `AAAA-MM-JJ` ;
   - un titre, et de 1 à 6 phrases simples (`items`).
   Le test `src/changelog.test.ts` vérifie le format, l'ordre et l'unicité.
2. **Tests** : `npm run typecheck` et `npm test` (app + serveur).
3. **Push sur `main`** :
   - `deploy.yml` revérifie tout, publie l'app sur GitHub Pages, puis crée le tag `v<version>` et la GitHub Release correspondante (avec les puces du changelog) ;
   - `worker.yml` redéploie le Worker **automatiquement** si `worker/`, `src/lib/`, `src/types.ts` ou `src/constants.ts` ont changé, **dès que** les secrets GitHub `CLOUDFLARE_API_TOKEN` et `CLOUDFLARE_ACCOUNT_ID` existent. Sans eux, le job est sauté : lancer `npm run deploy` dans `worker/`.
4. Vérifier dans l'onglet **Actions** du dépôt que les runs sont verts, puis ouvrir l'app : la fenêtre « Quoi de neuf » doit s'afficher une fois.

## 3. Où sont les secrets

| Secret | Où | Remarques |
|---|---|---|
| `GOOGLE_CLIENT_SECRET`, `ENCRYPTION_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `ALLOWED_EMAILS` | **Tableau de bord Cloudflare** : Workers & Pages → `suivi-epargne-api` → Paramètres → Variables et secrets | jamais dans le dépôt ; `npm run setup-secrets` (voir worker/README.md) |
| Client OAuth (identifiant public + code secret) | **Console Google Cloud** : API et services → Identifiants, client commençant par `763862877733-` | l'identifiant est public (dans le code) ; seul le code secret est sensible |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | **GitHub** : dépôt → Settings → Secrets and variables → Actions | servent uniquement au déploiement automatique du Worker |
| Clé Gemini | **Sur chaque appareil**, saisie par l'utilisateur dans Paramètres (stockage local) | clé personnelle de l'utilisateur ; jamais sur Drive, jamais sur le serveur |

## 4. Calendrier de l'année

| Quand | Quoi |
|---|---|
| **Janvier** | Nouveau barème de l'impôt et paramètres fiscaux (loi de finances) : vérifier `src/constants.ts` (barème, abattement de 10 %, décote, plafonds). L'app le rappelle en début d'année. Bilan annuel et relevés annuels des placements (mi-janvier). |
| **1er janvier 2027** | Restitution du capital des parents, puis mode solo. |
| **1er février** et **1er août** | Révision des taux réglementés (Livret A, LDDS, LEP) : saisir le nouveau taux avec sa date d'effet. L'app affiche une alerte. |
| **Chaque semaine** | La **veille fiscale Gemini** compare les valeurs officielles aux paramètres de l'app et **propose** les changements avec leur source. Rien n'est appliqué sans validation : vérifier la source avant d'accepter. |
| **Deux fois par an** (par exemple en février et en août, avec les taux) | Vérifier les **dépréciations des modèles Gemini** (page des modèles de Google AI) et mettre à jour `GEMINI_MODEL` / `FALLBACK_MODELS` en tête de `src/services/geminiService.ts`. Un modèle retiré est sauté automatiquement, mais si tous le sont, les fiches de paie et la veille fiscale s'arrêtent. Dépannage immédiat possible depuis Paramètres (modèle personnalisé). |
| **Chaque mois** | Pull requests Dependabot groupées : les fusionner si les vérifications sont vertes. |
| **Chaque lundi** | `ci.yml` relance tests et audit avec la date du jour : un échec sans changement de code signale une logique de dates à corriger ou une faille publiée. |
| **Avril** | Déclaration de revenus : l'app rappelle les dons et leurs reçus. |
| **Octobre** (chaque année) | **Node LTS** : une nouvelle version paire passe LTS. Mettre à jour `.nvmrc` et `engines` (`package.json`, `worker/package.json`) quand la version actuelle approche de sa fin de vie (Node 22 : avril 2027). |

## 5. Procédures en cas de panne

### Compte Cloudflare perdu ou inaccessible
L'app continue de fonctionner sans serveur (session Google d'une heure, pas de notifications) : rien n'est perdu, les données sont sur Drive.
1. Créer un nouveau compte Cloudflare et suivre [worker/README.md](worker/README.md) depuis l'étape 1 (nouveau KV, nouveaux secrets).
2. Mettre à jour l'`id` du KV dans `worker/wrangler.toml`, l'URI de redirection dans la console Google, `VITE_BACKEND_URL` dans `.env.production`, et les secrets GitHub `CLOUDFLARE_*`.
3. Pousser, puis se reconnecter et réactiver les notifications sur chaque appareil.

### Code secret OAuth Google renouvelé
1. Console Google Cloud → Identifiants → client `763862877733-…` : copier le nouveau code secret.
2. Tableau de bord Cloudflare → `suivi-epargne-api` → Variables et secrets → modifier `GOOGLE_CLIENT_SECRET`.
3. Supprimer l'ancien code secret dans la console Google une fois le nouveau en place. Les refresh tokens déjà émis restent valables avec le nouveau code secret ; tester quand même une connexion et « Envoyer un test » de notification.

### Fichier Drive corrompu ou mauvaise manipulation
1. **Paramètres → Copies mensuelles sur Drive** : choisir une copie `suivi_epargne_backup_AAAA-MM.json` (12 mois gardés) et la restaurer (confirmation demandée).
2. À défaut : historique des versions du fichier dans Google Drive (30 jours), ou un export JSON fait auparavant (Paramètres → « Importer un fichier »).
3. Les copies supprimées vont à la corbeille Drive (récupérables 30 jours).

### Clé Gemini divulguée
1. Sur [Google AI Studio](https://aistudio.google.com/apikey), **révoquer** la clé et en créer une nouvelle.
2. La saisir de nouveau dans Paramètres sur chaque appareil. Aucune action n'est nécessaire sur Drive ni sur le serveur : la clé n'y a jamais été stockée.

### App cassée après un déploiement
- **Le plus simple** : sur GitHub, revenir au commit précédent (revert) et pousser sur `main` ; le déploiement repart automatiquement.
- **Ou** : onglet Actions → workflow « Déploiement GitHub Pages » → ouvrir le run d'un commit sain → *Re-run all jobs*. Attention, le prochain push redéploiera `main`.
- Les onglets ouverts se rechargent seuls sur la nouvelle version. Si le fichier Drive a été abîmé, voir plus haut.

### Utilisateur bloqué par le verrou (code oublié, biométrie indisponible)
Sur l'écran de verrouillage : **Code oublié**. L'app se déconnecte et efface les données de cet appareil (elle ne déverrouille pas). Se reconnecter avec Google, puis redéfinir un code ou la biométrie dans Paramètres. Les données sont sur Drive : rien n'est perdu (sauf la clé Gemini de l'appareil, à ressaisir).

## 6. Limites de l'offre gratuite Cloudflare

| Ressource | Limite gratuite | Usage de Pécule |
|---|---|---|
| Requêtes Worker | 100 000 / jour | quelques dizaines |
| Écritures KV (put + delete) | 1 000 / jour | ~1 par connexion, 1 par jour et par session utilisée, 1 par rappel envoyé |
| Lectures KV | 100 000 / jour | quelques centaines |
| CPU | 10 ms par requête (cron compris) | en dessous ; l'attente réseau ne compte pas |

Au-delà, Cloudflare refuse les requêtes jusqu'au lendemain : l'app retombe sur le mode sans serveur. Détails dans [worker/README.md](worker/README.md).

## 7. Statut de l'application OAuth Google

- **En production**, **non validée** par Google, **un seul utilisateur** (le serveur n'accepte que `ALLOWED_EMAILS`). Elle doit rester « En production » : en mode test, les refresh tokens expirent au bout de 7 jours.
- À la connexion, Google affiche « application non validée » : c'est normal (Paramètres avancés → Accéder à…).
- Portées : `drive.file` (non sensible, uniquement les fichiers créés par l'app) et **`gmail.send`**, une portée **sensible**, utilisée seulement pour les e-mails aux parents. **Après la restitution (2027), elle pourra être retirée** (`SCOPES` dans `src/services/googleDriveService.ts` et la liste des API dans la console Google), ce qui réduit les droits accordés. Cela demande une reconnexion sur chaque appareil.

## 8. Nom de domaine

- **pecule-app.com**, acheté chez Cloudflare (registrar et DNS). Renouvellement automatique : vérifier une fois par an que le moyen de paiement est valide (Cloudflare → Domain Registration).
- L'app est servie par **GitHub Pages** (Settings → Pages → Custom domain), via les enregistrements A/AAAA de GitHub dans le DNS Cloudflare, en mode « DNS only ». Le domaine est vérifié dans les paramètres GitHub du compte (enregistrement TXT `_github-pages-challenge-…`) : personne d'autre ne peut le rattacher à un autre dépôt.
- L'ancienne adresse `antoninnourisson-cloud.github.io/suivi-epargne/` redirige vers le domaine. Une app installée depuis l'ancienne adresse affiche « Pécule a déménagé » (`src/components/MovedNotice.tsx`).
- **Début 2027** : retirer `LEGACY_APP_URL` de `worker/wrangler.toml`, l'origine `https://antoninnourisson-cloud.github.io` du client OAuth Google et de la clé du Picker.

