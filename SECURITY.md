# Sécurité

Pécule manipule des données financières et un accès à Google Drive : les failles de sécurité sont prises très au sérieux.

## Signaler une faille

**N'ouvrez pas d'issue publique.** Utilisez le signalement privé de GitHub (onglet **Security** du dépôt, puis **Report a vulnerability**), ou écrivez à [contact@pecule-app.com](mailto:contact@pecule-app.com).

Indiquez si possible :

- ce qui est touché (app, serveur `worker/`, Worker des en-têtes `edge/`, fichier de données, sauvegarde de secours chiffrée) ;
- comment reproduire le problème, avec des données fictives (mode démo) ;
- l'impact que vous envisagez.

Vous recevrez une réponse sous 7 jours. Une correction est publiée dès que possible, et vous serez crédité si vous le souhaitez.

## Versions prises en charge

Seule la version en ligne (dernière version de `main`) est maintenue : l'app se met à jour seule chez tous les utilisateurs.

## Hors périmètre

- Les failles des services tiers eux-mêmes (Google, Cloudflare) : signalez-les directement à ces services.
- Une attaque qui demande déjà un accès physique à un appareil déverrouillé **dont le compte Google est ouvert** : le fichier est alors lisible sur drive.google.com, sans passer par Pécule. Le verrou de l'app (biométrie ou PIN), lui, est dans le périmètre, avec la limite connue décrite ci-dessous.

## Limites connues

- **Délai et surcouche du verrou.** Le verrou se remet après un délai choisi par appareil (Immédiatement, 1, 5 ou 15 minutes ; 5 par défaut), mesuré avec l'horloge du système et l'horloge monotone (la plus longue gagne : une horloge reculée verrouille). Une fois l'app affichée, il est posé par-dessus l'écran en cours : l'arbre de l'app reste monté mais `inert` et masqué aux lecteurs d'écran (ni clavier, ni pointeur), si bien qu'une saisie ou un import en cours n'est pas perdu. Les montants restent donc dans le DOM derrière le verrou, lisibles seulement par un script ou les outils du navigateur : le verrou est un frein à l'accès occasionnel, pas une barrière contre du code qui s'exécute dans la page. À l'ouverture, au rechargement et dans un nouvel onglet, seul l'écran de verrou est rendu (ni données, ni session, ni connexion). Un choix de fichier lancé par l'app suspend le verrou jusqu'à la fin du choix ou le retour au premier plan, 3 minutes au plus ; en « Après N minutes », la vignette du sélecteur d'applications Android peut montrer l'écran tel qu'il était. « Demander à Pécule » n'est plus fermée au verrouillage (seulement à la déconnexion). Le **mode discret** est un confort d'affichage, pas une protection.
- **Verrou de l'appareil et « Code oublié ».** Le verrou est gardé dans le navigateur de l'appareil. « Code oublié » ne déverrouille jamais : il enregistre une demande de retrait, utilisable seulement 24 heures plus tard (et pendant 7 jours). Pendant ce délai le verrou reste affiché avec la date de la demande, et tout déverrouillage réussi l'annule en avertissant le propriétaire ; ses autres appareils qui reçoivent les notifications sont prévenus dès la demande, et il peut déconnecter l'appareil depuis « Appareils connectés ». Le retrait est refusé tant que cette alerte n'est pas partie : garder l'appareil hors ligne ne permet pas de l'éviter. Seule exception, l'appareil n'a plus de session serveur valable (expirée, ou fermée depuis un autre appareil) : l'alerte part alors avec la session suivante, juste après la reconnexion Google. Ensuite seulement, la session de l'appareil est fermée et il faut se reconnecter à Google (choix du compte, nouvel accord) et charger les données depuis Drive. Ce délai ne protège pas contre tout : quelqu'un qui garde l'appareil plus de 24 heures sans que le propriétaire ouvre Pécule, qui avance l'horloge de l'appareil, ou qui efface les données du site dans les réglages du navigateur (le verrou part avec elles) peut se reconnecter, si le compte Google du propriétaire est ouvert sur l'appareil. Une telle personne peut de toute façon lire le fichier sur drive.google.com. Le retrait reste visible : l'app ne demande plus le code à l'ouverture, et Paramètres affiche la date du dernier retrait par « Code oublié ».
- **Code PIN court.** Le code est dérivé avec PBKDF2 (310 000 itérations) et les essais sont freinés dans l'app, mais quelqu'un qui copie le stockage du navigateur peut essayer tous les codes à 6 chiffres hors ligne en peu de temps. La biométrie n'a pas cette limite.
- **Copie locale chiffrée.** Les copies gardées sur l'appareil (dernier état de Drive, modifications pas encore envoyées, versions mises de côté) sont chiffrées en AES-GCM avec une clé non exportable. Cette clé vit dans IndexedDB, dans le même profil du navigateur et sur le même disque : le chiffrement protège contre la lecture du seul stockage local (outil, extension ou copie qui ne prend que `localStorage`), pas contre la copie de tout le profil ni contre un script qui s'exécuterait dans la page. Sans IndexedDB (cas rare), la copie hors ligne n'est pas écrite ; les modifications pas encore envoyées, la quarantaine et les versions mises de côté sont gardées en clair plutôt que perdues, jusqu'à ce que Drive les ait reçues (`sealJSON`, option `encryptedOnly`).
- **Session liée à l'appareil, pas à la page ni au profil.** La liaison protège contre la copie du jeton SEUL (stockage local lu par une extension, journal, sauvegarde partielle). La clé privée de la session ne peut pas être lue par JavaScript, mais un script qui s'exécuterait dans l'app (dépendance compromise, extension, faille future) peut lui faire signer des requêtes tant qu'il y est, donc obtenir des jetons Drive d'une heure ; chaque preuve porte un nonce du serveur valable 10 minutes au plus, si bien qu'il ne peut pas en préparer à l'avance pour s'en servir ensuite ailleurs pendant toute la vie de la session. Quelqu'un qui copie tout le profil du navigateur emporte aussi la clé (le navigateur peut la garder telle quelle sur le disque). Le jeton d'accès Google en cours (1 h) et la clé Gemini restent lisibles dans le stockage local. Les sessions ouvertes avant la liaison (octobre 2026) sont refusées : chaque appareil se reconnecte une fois, et un jeton copié avant la protection ne sert plus à rien. Un navigateur qui ne peut pas garder de clé (stockage IndexedDB indisponible) garde une session non liée, signalée dans « Appareils connectés ».
- **Effacement des copies de secours.** Une session volée ne peut que le programmer (7 jours, annulable). L'effacement programmé s'affiche dans l'app à chaque ouverture, et la notification part aussi vers les appareils retirés ou déconnectés depuis moins de 30 jours : retirer d'abord les appareils du propriétaire ne suffit pas à le cacher.
- **Fichier Drive.** Un jeton Drive (portée `drive.file`) permet de supprimer définitivement le fichier de données et ses copies mensuelles : Pécule ne peut pas l'empêcher. La sauvegarde de secours chiffrée, gardée par le serveur, est faite pour ce cas : son effacement est toujours différé de 7 jours, annoncé aux appareils et annulable.
- **CSP et exfiltration.** La politique de contenu empêche un script étranger de s'exécuter (scripts Google limités aux fichiers exacts), mais elle ne peut pas empêcher l'envoi de données vers Drive (`www.googleapis.com` doit rester autorisé) ni une navigation vers un autre site.

## Les protections en place

Résumé ici, détail dans le README (section *Sécurité et confidentialité*) et sur la [page de confidentialité](https://pecule-app.com/confidentialite.html) :

**Dans l'app et sur l'appareil**

- accès Google limité aux fichiers créés ou ouverts par l'app (`drive.file`), aucune portée sensible ;
- politique de sécurité du contenu (CSP) stricte, sans script en ligne ; scripts Google limités aux fichiers exacts chargés (`accounts.google.com/gsi/client`, `apis.google.com/js/api.js` et ses modules), plus aucun domaine entier ; `object-src 'none'` ;
- session serveur **liée à l'appareil** : clé ECDSA P-256 non exportable créée à la connexion, chaque requête signée (nonce du serveur valable 10 minutes au plus, méthode, chemin) ; un jeton de session copié seul ne sert à rien (une copie du profil entier du navigateur, si) ; sessions d'avant la liaison refusées ;
- copie locale des données chiffrée (AES-GCM, clé non exportable, voir les limites ci-dessus ; en clair seulement pour des modifications pas encore envoyées, si le navigateur ne peut pas garder la clé) ; verrou biométrique ou PIN ;
- « Code oublié » : alerte envoyée aux autres appareils du propriétaire, obligatoire avant le retrait ; « Appareils connectés » dans Paramètres pour déconnecter une session inconnue ;
- fichier partagé vers Pécule : nom, taille et heure de réception affichés avant toute lecture, avec « Vous n'avez rien partagé ? Annulez » ; aucun filtrage par référent (il ne serait pas fiable : un site peut retirer le sien, et un partage Android peut porter un référent `android-app://`) ;
- journal local des erreurs (20 dernières, nombres, textes cités, adresses e-mail et paramètres d'adresse retirés) : gardé sur l'appareil, jamais envoyé ; Copier et Effacer dans Paramètres › Appareil ; stockage persistant demandé au navigateur après la connexion ;
- code de secours de la sauvegarde chiffrée : activation seulement après en avoir recopié deux groupes ;
- clé Gemini gardée sur l'appareil, jamais écrite sur Drive ni envoyée au serveur, effacée à la déconnexion ; un fichier importé ne peut ni installer sa propre clé Gemini ni remplacer la clé du Picker ; les relevés bancaires lus par Gemini partent directement de l'appareil vers Google, jamais vers le serveur ;
- déconnexion : les traces d'usage gardées sur l'appareil (dernier écran, derniers choix) sont effacées avec les données.

**Serveur (`worker/`)**

- réservé à une liste d'adresses e-mail, revérifiée à chaque requête (retirer une adresse ferme ses sessions) ; origines autorisées limitées à l'app ;
- sessions stockées hachées, expirées après 30 jours d'inactivité (60 jours au plus), liées à la clé publique de l'appareil (preuve signée exigée) ; state OAuth signé et lié au navigateur ; `id_token` vérifié ;
- jeton Google chiffré (AES-256-GCM), gardé seulement tant qu'une session ou une notification s'en sert (61 jours au plus sans usage) ; limitation du débit par IP ; taille des requêtes bornée, lue en flux (abandon dès la limite dépassée) ;
- notifications chiffrées de bout en bout (RFC 8291) ;
- **sauvegarde de secours chiffrée de bout en bout** : chiffrée dans l'app (AES-256-GCM, clé dérivée d'un code de secours de 128 bits jamais transmis), illisible pour le serveur ; jamais effacée sur-le-champ (7 jours, annulable, annoncé par notification), conservation échelonnée (copies récentes, hebdomadaires et mensuelles) qu'une série d'envois ne peut pas chasser, envois plafonnés par jour ;
- journaux d'appels Cloudflare désactivés : aucune adresse IP enregistrée, seuls les messages d'erreur du serveur ;
- veille fiscale : seul le texte de pages publiques est envoyé à Workers AI, et chaque valeur relevée doit figurer dans la page.

**Site (`edge/`)**

- en-têtes HTTP ajoutés devant GitHub Pages : HSTS, interdiction d'affichage dans une iframe (`X-Frame-Options`, `frame-ancestors`), `nosniff`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy` ; cache adapté (fichiers hachés : un an ; pages, service worker et son extension de notifications : revalidés à chaque fois, pour qu'un correctif arrive tout de suite) ;
- surveillance quotidienne du site, du serveur, du certificat TLS et de HSTS (`monitor.yml`).

**Dépôt**

- analyse du code par CodeQL, détection des secrets publiés, alertes et mises à jour Dependabot (app, `worker/`, `edge/`, Actions) ;
- actions GitHub épinglées par empreinte (SHA), permissions minimales dans chaque workflow, audit des dépendances chaque semaine ; mises à jour Dependabot proposées après 7 jours (cooldown, sauf correctifs de sécurité) ;
- jetons Cloudflare : les jobs de déploiement du serveur et des en-têtes ne tournent que depuis `main` (et les tags `v*` du retour arrière), dans l'environnement GitHub `cloudflare` ;
- aucune clé ni aucun jeton dans le code : les secrets vivent chez Cloudflare et dans les secrets GitHub Actions.

## Contact

[contact@pecule-app.com](mailto:contact@pecule-app.com) (pour une faille, préférez le signalement privé de GitHub ci-dessus). Les échanges suivent le [code de conduite](CODE_OF_CONDUCT.md).
