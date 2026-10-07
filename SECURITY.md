# Sécurité

Pécule manipule des données financières et un accès à Google Drive : les failles de sécurité sont prises très au sérieux.

## Signaler une faille

**N'ouvrez pas d'issue publique.** Utilisez le signalement privé de GitHub (onglet **Security** du dépôt, puis **Report a vulnerability**), ou écrivez à [contact@pecule-app.com](mailto:contact@pecule-app.com).

Indiquez si possible :

- ce qui est touché (app, serveur `worker/`, fichier de données) ;
- comment reproduire le problème, avec des données fictives (mode démo) ;
- l'impact que vous envisagez.

Vous recevrez une réponse sous 7 jours. Une correction est publiée dès que possible, et vous serez crédité si vous le souhaitez.

## Versions prises en charge

Seule la version en ligne (dernière version de `main`) est maintenue : l'app se met à jour seule chez tous les utilisateurs.

## Hors périmètre

- Les failles des services tiers eux-mêmes (Google, Cloudflare) : signalez-les directement à ces services.
- Une attaque qui demande déjà un accès physique à un appareil déverrouillé.

## Les protections en place

Résumé ici, détail dans le README (section *Sécurité et confidentialité*) et sur la [page de confidentialité](https://pecule-app.com/confidentialite.html) :

- accès Google limité aux fichiers créés par l'app (`drive.file`) ;
- serveur réservé à une liste d'adresses e-mail, sessions signées et expirées après 30 jours d'inactivité (60 jours au plus), limitation du débit des requêtes ;
- jeton Google du serveur chiffré (AES-256-GCM) ;
- copie locale des données chiffrée sur chaque appareil ;
- politique de sécurité du contenu (CSP) stricte, sans script en ligne ;
- clé Gemini gardée sur l'appareil, jamais écrite sur Drive ni envoyée au serveur.
