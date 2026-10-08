# Maintenance de Pécule

Ce document rassemble ce qu'il faut savoir pour faire vivre l'app sans la casser : les règles à ne jamais enfreindre, la marche à suivre pour publier une mise à jour, où sont rangés les secrets, le calendrier de l'année et quoi faire quand quelque chose tombe en panne.

Voir aussi : [README.md](README.md) (fonctionnement général), [worker/README.md](worker/README.md) (serveur), [ROADMAP.md](ROADMAP.md) (pistes et notes techniques).

## 1. Invariants à ne pas casser

### Soldes et mouvements
- **Tout changement de solde passe par [`src/lib/accountOps.ts`](src/lib/accountOps.ts)** (`applyMovement`, `snapshotBalances`, `restoreBalances`). Ne jamais modifier `ownedAmount`, `parentalCapital`, `totalAmount` ou `totalDeposits` à la main ailleurs : ce calcul était autrefois recopié à six endroits et dérivait. Le total est toujours égal à part propre + part des parents, au centime.
- **Les opérations métier qui changent les soldes sont des commandes pures et testées dans [`src/lib/commands`](src/lib/commands)** (ajout rapide, suppression/annulation de mouvement, fiche de compte, restitution et son annulation) : elles appliquent elles-mêmes les règles ci-dessous et renvoient de quoi annuler à l'identique ; `App.tsx` ne fait que l'interface (confirmation, toasts). Toute nouvelle opération de ce genre s'y ajoute, avec ses tests.
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
- **Restitution prévue vers le 1er janvier 2027** (le 1er janvier garde toute l'année d'intérêts). Une fois enregistrée, l'app passe en **mode solo** : plus de part parentale. Le code lié aux parents doit continuer à fonctionner sans erreur quand le capital parental vaut zéro partout.

### Fichier de données
- **Un seul point d'entrée : `migrate()`** dans [`src/lib/schema.ts`](src/lib/schema.ts). Tout ce qui entre dans l'app (chargement Drive, import, restauration locale, synchronisation entre onglets, lecture par le Worker) passe par lui. Une nouvelle forme de données = une migration dans `migrate()`, nulle part ailleurs.
- **`APP_SCHEMA_VERSION`** : à augmenter **seulement** quand un changement rend le fichier dangereux pour une ancienne version de l'app (par exemple un champ dont le sens change). Les anciens clients refusent alors d'écrire et demandent une mise à jour. Ajouter un champ facultatif ne demande pas d'augmenter la version.
- **Les champs inconnus sont conservés** : `migrate()` garde tout ce qu'il ne connaît pas (`...rest`). Une version de l'app ne doit jamais effacer ce qu'une version plus récente a ajouté. Ne pas réécrire le fichier à partir d'une liste blanche de champs.
- **Écriture Drive vérifiée** ([`updateConfigFile`](src/services/googleDriveService.ts), [`src/lib/driveWriteCheck.ts`](src/lib/driveWriteCheck.ts)) : Drive n'a pas d'écriture conditionnelle, donc une écriture d'un autre appareil peut tomber entre le contrôle de révision (`headRevisionId`) et notre PATCH. Après chaque sauvegarde automatique, on relit l'historique des révisions (une lecture de métadonnées, aucune écriture en plus) : la révision qui précède la nôtre doit être celle attendue. Sinon, la version de l'autre appareil est marquée « Keep Forever » (condition de Drive pour télécharger une révision de blob), relue, gardée en mémoire et dans la quarantaine locale chiffrée, et la bannière de conflit habituelle s'ouvre (`ConcurrentWriteError`) : « Garder mes modifications » réécrit la nôtre, « Recharger l'autre version » applique la sienne. Jamais d'écrasement automatique. Ne pas se fier au champ `version` (il bouge tout seul après un PATCH).
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
| **Chaque semaine** | La **veille fiscale** compare les valeurs officielles aux paramètres de l'app et **propose** les changements avec leur source. Rien n'est appliqué sans validation : vérifier la source avant d'accepter. **Serveur d'abord** : chaque lundi (cron `0 5 * * 1`), le Worker relit les pages de service-public.gouv.fr avec Cloudflare Workers AI (gratuit, sans clé ; `worker/src/fiscalWatchJob.ts`). **Gemini en secours** (clé de l'appareil) si le relevé du serveur manque ou date de plus de 8 jours ; « Vérifier maintenant » utilise Gemini s'il y a une clé, sinon le serveur. **Contrôle** : Paramètres → Veille fiscale → *Détail du relevé* liste chaque valeur relevée, « = app » ou « ≠ app », avec la phrase de la page et les pages en défaut. Toutes les valeurs doivent être « = app » tant qu'aucune règle n'a changé ; un « ≠ app » se vérifie sur la source avant d'appliquer. |
| **Deux fois par an** (par exemple en février et en août, avec les taux) | Vérifier les **dépréciations des modèles Gemini** (page des modèles de Google AI) et mettre à jour `GEMINI_MODEL` / `FALLBACK_MODELS` en tête de `src/services/geminiService.ts`. Un modèle retiré est sauté automatiquement, mais si tous le sont, les fiches de paie et la veille fiscale s'arrêtent. Dépannage immédiat possible depuis Paramètres (modèle personnalisé). Même contrôle pour le modèle **Workers AI** de la veille (`FISCAL_AI_MODEL` dans `worker/src/fiscalWatchJob.ts`, page des modèles de Cloudflare : identifiant, mode JSON, tarif en neurones). |
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
4. **Dernier recours : sauvegarde de secours chiffrée** (si elle a été activée). Drive reste la source principale ; cette copie, gardée par le Worker (clés KV `backup:<sub>:<AAAA-MM-JJ>`, 8 copies au plus, effacées d'elles-mêmes après 1 an), est chiffrée par l'app avant l'envoi (format `pecule-backup` v1 : AES-256-GCM, clé dérivée par HKDF-SHA-256 du **code de secours** de 28 caractères et d'un sel stocké avec la copie ; `src/lib/cloudBackupCrypto.ts`). Le code n'est affiché qu'à l'activation et n'est enregistré nulle part, ni sur Drive ni sur le serveur. Pour restaurer, sur n'importe quel appareil connecté au serveur : Paramètres → Sauvegarde des données → « Restaurer », choisir la date, saisir le code ; la copie déchiffrée passe par le même contrôle qu'un import de fichier, puis est réécrite sur Drive. **Code perdu = copies définitivement illisibles** (personne ne peut les ouvrir, pas même le serveur) : désactiver puis réactiver la fonction pour obtenir un nouveau code, les anciennes copies étant effacées. Une purge automatique sur accès Google révoqué garde ces copies ; « Supprimer mes données serveur » et « Désactiver » les effacent.

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
- À la connexion, Google affiche « application non validée » tant que la marque n'est pas validée (Paramètres avancés → Accéder à…).
- Portées : `openid`, `email` (identité, côté serveur) et `drive.file` (non sensible, uniquement les fichiers créés par l'app). **Aucune portée sensible** : l'envoi d'e-mails (`gmail.send`) a été retiré, ce qui permet de demander la validation de la marque sans examen de sécurité. Les portées sont dans `SCOPES` (`src/services/googleDriveService.ts`) et `OAUTH_SCOPES` (`worker/src/google.ts`) : les deux listes doivent garder les mêmes droits Google (le serveur ajoute seulement `openid` et `email`), déclarés aussi dans la console Google.

## 8. Nom de domaine

- **pecule-app.com**, acheté chez Cloudflare (registrar et DNS). Renouvellement automatique : vérifier une fois par an que le moyen de paiement est valide (Cloudflare → Domain Registration).
- L'app est servie par **GitHub Pages** (Settings → Pages → Custom domain), via les enregistrements A/AAAA de GitHub dans le DNS Cloudflare (en « DNS only » à l'origine ; à passer en « Proxied » pour activer les en-têtes de sécurité, voir plus bas). Le domaine est vérifié dans les paramètres GitHub du compte (enregistrement TXT `_github-pages-challenge-…`) : personne d'autre ne peut le rattacher à un autre dépôt.
- L'ancienne adresse `antoninnourisson-cloud.github.io/suivi-epargne/` redirige vers le domaine. Une app installée depuis l'ancienne adresse affiche « Pécule a déménagé » (`src/components/MovedNotice.tsx`).
- **Début 2027** : retirer `LEGACY_APP_URL` de `worker/wrangler.toml`, l'origine `https://antoninnourisson-cloud.github.io` du client OAuth Google et de la clé du Picker.

### En-têtes de sécurité (Worker `pecule-edge`, dossier `edge/`)

GitHub Pages ne permet pas de choisir ses en-têtes HTTP. Un petit Worker Cloudflare, `pecule-edge` ([`edge/src/index.ts`](edge/src/index.ts)), se place devant lui sur les routes `pecule-app.com/*` et `www.pecule-app.com/*` : il relaie chaque requête telle quelle à GitHub Pages et ajoute seulement à la réponse :

| En-tête | Valeur | Pourquoi |
|---|---|---|
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` | HTTPS obligatoire pendant un an (pas de `preload` pour l'instant : quasi irréversible) |
| `X-Content-Type-Options` | `nosniff` | le navigateur ne devine pas le type des fichiers |
| `X-Frame-Options` + `Content-Security-Policy` | `DENY` + `frame-ancestors 'none'` | l'app ne peut pas être affichée dans une iframe (clickjacking) |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | pas d'adresse complète transmise aux autres sites |
| `Permissions-Policy` | caméra, micro, position, paiement, USB, FLoC désactivés | l'app n'en a pas besoin |
| `Cross-Origin-Opener-Policy` | `same-origin-allow-popups` | isole la fenêtre de l'app ; `same-origin` casserait la fenêtre de connexion Google (valeur recommandée par Google pour les fenêtres surgissantes) |

`www.pecule-app.com` est redirigé (301) vers `https://pecule-app.com`, chemin et paramètres conservés. Le Worker ne modifie ni le contenu, ni le statut, ni le cache ; les requêtes autres que GET/HEAD passent sans modification. La politique de contenu complète (CSP) reste dans la balise `<meta>` d'`index.html`, seule source de vérité : le Worker n'ajoute que `frame-ancestors`, qu'une balise `<meta>` ne peut pas exprimer.

**Déploiement** : automatique par [`edge.yml`](.github/workflows/edge.yml) à chaque push sur `main` touchant `edge/` (mêmes secrets que le serveur). Le jeton `CLOUDFLARE_API_TOKEN` doit avoir en plus **Zone → Workers Routes → Edit** (et **Zone → Zone → Read**) sur `pecule-app.com`. À la main : `npm run deploy` dans `edge/`.

**Réglages Cloudflare nécessaires** (sans eux, le Worker est déployé mais jamais appelé) :

1. **DNS → Records** : passer en **« Proxied »** (nuage orange) les enregistrements `A` et `AAAA` de `pecule-app.com` (adresses GitHub `185.199.108-111.153` et `2606:50c0:8000-8003::153`), et l'enregistrement `www` s'il existe. Laisser le `TXT _github-pages-challenge-…` tel quel.
2. **SSL/TLS → Overview** : mode **« Full (strict) »**. Jamais « Flexible » : Cloudflare parlerait en HTTP à GitHub, qui redirige vers HTTPS, d'où une boucle de redirections.
3. Vérifier : `curl -I https://pecule-app.com/` doit afficher `strict-transport-security`, `x-frame-options: DENY`, etc., et `curl -I https://www.pecule-app.com/x` un `301` vers `https://pecule-app.com/x`. La surveillance quotidienne le vérifie aussi.

**Si le certificat de GitHub ne se renouvelle plus** : derrière le proxy, GitHub voit les adresses de Cloudflare au lieu des siennes et peut refuser de renouveler son certificat (Settings → Pages affiche alors une erreur de DNS ; en « Full (strict) », le site renvoie l'erreur Cloudflare **526**). Remède : repasser temporairement les enregistrements en **« DNS only »**, attendre que Settings → Pages indique un certificat valide (« Enforce HTTPS » cochable), puis les remettre en « Proxied ». En « DNS only », le site marche normalement, simplement sans ces en-têtes.

**Désactiver en urgence** : repasser les enregistrements en « DNS only » (effet en quelques minutes), ou supprimer les routes dans Workers & Pages → `pecule-edge` → Settings → Domains & Routes.

## 9. Surveillance

[`monitor.yml`](.github/workflows/monitor.yml) tourne chaque matin à 6 h 30 UTC (et à la demande : Actions → *Surveillance* → Run workflow). Il vérifie :

- l'accueil `https://pecule-app.com/` (code 200 et « Pécule » dans la page), `presentation.html` et `confidentialite.html` ;
- le serveur : `GET /status` (public, sans aucune donnée utilisateur : `{"ok":true,"cron":{"lastRunAt","ok"}}`) ; la tâche quotidienne de la veille doit avoir réussi et dater de moins de 26 h ;
- le certificat TLS de `pecule-app.com` : plus de 14 jours avant expiration ;
- l'en-tête HSTS du Worker edge : simple information tant que le DNS n'est pas en « Proxied ».

En cas d'échec, une issue étiquetée **`panne`** est ouverte (ou complétée d'un commentaire si elle est déjà ouverte) avec la liste des vérifications en échec : GitHub envoie un e-mail. Quand tout refonctionne, l'issue est commentée puis fermée automatiquement. Pour ne pas manquer ces e-mails : GitHub → Settings → Notifications → « Issues » activé, et suivre le dépôt (Watch).

Attention : GitHub suspend les tâches planifiées d'un dépôt public sans activité depuis 60 jours (un e-mail prévient avant). Il suffit alors de cliquer « Enable workflow » dans l'onglet Actions.

