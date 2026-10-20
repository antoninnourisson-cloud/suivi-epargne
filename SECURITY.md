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

- **Verrou de l'appareil et « Code oublié ».** Le verrou est gardé dans le navigateur de l'appareil. « Code oublié » ne déverrouille jamais : il enregistre une demande de retrait, utilisable seulement 24 heures plus tard (et pendant 7 jours). Pendant ce délai le verrou reste affiché avec la date de la demande, et tout déverrouillage réussi l'annule en avertissant le propriétaire. Ensuite seulement, la session de l'appareil est fermée et il faut se reconnecter à Google (choix du compte, nouvel accord) et charger les données depuis Drive. Ce délai ne protège pas contre tout : quelqu'un qui garde l'appareil plus de 24 heures sans que le propriétaire ouvre Pécule, qui avance l'horloge de l'appareil, ou qui efface les données du site dans les réglages du navigateur (le verrou part avec elles) peut se reconnecter, si le compte Google du propriétaire est ouvert sur l'appareil. Une telle personne peut de toute façon lire le fichier sur drive.google.com. Le retrait reste visible : l'app ne demande plus le code à l'ouverture, et Paramètres affiche la date du dernier retrait par « Code oublié ».
- **Code PIN court.** Le code est dérivé avec PBKDF2 (310 000 itérations) et les essais sont freinés dans l'app, mais quelqu'un qui copie le stockage du navigateur peut essayer tous les codes à 6 chiffres hors ligne en peu de temps. La biométrie n'a pas cette limite.

## Les protections en place

Résumé ici, détail dans le README (section *Sécurité et confidentialité*) et sur la [page de confidentialité](https://pecule-app.com/confidentialite.html) :

**Dans l'app et sur l'appareil**

- accès Google limité aux fichiers créés ou ouverts par l'app (`drive.file`), aucune portée sensible ;
- politique de sécurité du contenu (CSP) stricte, sans script en ligne, origines limitées à Google et au serveur ;
- copie locale des données chiffrée (AES-GCM, clé non exportable) ; verrou biométrique ou PIN ;
- clé Gemini gardée sur l'appareil, jamais écrite sur Drive ni envoyée au serveur.

**Serveur (`worker/`)**

- réservé à une liste d'adresses e-mail ; origines autorisées limitées à l'app ;
- sessions stockées hachées, expirées après 30 jours d'inactivité (60 jours au plus) ; state OAuth signé et lié au navigateur ; `id_token` vérifié ;
- jeton Google chiffré (AES-256-GCM), gardé seulement tant qu'une session ou une notification s'en sert (61 jours au plus sans usage) ; limitation du débit par IP ; taille des requêtes bornée ;
- notifications chiffrées de bout en bout (RFC 8291) ;
- **sauvegarde de secours chiffrée de bout en bout** : chiffrée dans l'app (AES-256-GCM, clé dérivée d'un code de secours de 128 bits jamais transmis), illisible pour le serveur ;
- veille fiscale : seul le texte de pages publiques est envoyé à Workers AI, et chaque valeur relevée doit figurer dans la page.

**Site (`edge/`)**

- en-têtes HTTP ajoutés devant GitHub Pages : HSTS, interdiction d'affichage dans une iframe (`X-Frame-Options`, `frame-ancestors`), `nosniff`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy` ;
- surveillance quotidienne du site, du serveur, du certificat TLS et de HSTS (`monitor.yml`).

**Dépôt**

- analyse du code par CodeQL, détection des secrets publiés, alertes et mises à jour Dependabot (app, `worker/`, `edge/`, Actions) ;
- actions GitHub épinglées par empreinte (SHA), permissions minimales dans chaque workflow, audit des dépendances chaque semaine ;
- aucune clé ni aucun jeton dans le code : les secrets vivent chez Cloudflare et dans les secrets GitHub Actions.

## Contact

[contact@pecule-app.com](mailto:contact@pecule-app.com) (pour une faille, préférez le signalement privé de GitHub ci-dessus). Les échanges suivent le [code de conduite](CODE_OF_CONDUCT.md).
