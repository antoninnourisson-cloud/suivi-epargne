# Roadmap

## Livré

- **Fiches de paie par IA** : import via Google Picker, extraction Gemini (sortie structurée, nouvelles tentatives et modèles de repli en cas de saturation), relecture obligatoire, graphique du net, mode « chiffres exacts » dans le Pilotage.
- **Verrou de l'appareil** : biométrie (WebAuthn) ou PIN (PBKDF2), réactivé à chaque passage en arrière-plan, avec une porte de sortie en cas de code oublié.
- **Fiscalité du capital** : net des gains en cas de retrait (PFU, exonérations après maturité), compte à rebours de maturité par compte.
- **Intérêts réellement acquis** (règle des quinzaines) pour les gains nets si retrait et le rappel parental.
- **Projection et dérive du rythme d'épargne**.
- **Alertes** : révision des taux réglementés, éligibilité LEP, intérêts parentaux de décembre.
- **Mouvements récurrents** proposés à l'échéance, et **ajustement « + / − x € »** dans Actualiser solde.
- **Serveur Cloudflare** : session Google persistante et notifications push, dont le rappel du jour de paie avec le plan de placement.
- **Versements cumulés** (PEA, AV…) : plus-values latentes, impôt exact d'un retrait, plafond PEA ; « Placé ce mois-ci » ; meilleur compte à ponctionner ; abonnements avec rappels.
- **Restitution du capital parental**, agenda des douze mois, bilan annuel, répartition personnalisée de l'épargne, taux datés, journal des modifications, corrections « Pas de l'épargne » et point de départ du suivi.
- **Quoi de neuf** : historique des mises à jour en dur (`src/changelog.ts`), affiché une fois après chaque mise à jour.
- **Déploiement automatique du Worker** depuis GitHub Actions (`.github/workflows/worker.yml`), à chaque push qui touche le code du serveur ou ce qu'il partage avec l'app. Actif dès que les deux secrets du dépôt `CLOUDFLARE_API_TOKEN` et `CLOUDFLARE_ACCOUNT_ID` existent ; d'ici là, le job est sauté et `npm run deploy` reste possible à la main.
- **Plus aucun envoi d'e-mail** : l'autorisation Gmail (`gmail.send`) est retirée de la connexion Google, qui ne demande plus aucune portée sensible.
- **Préférences de notification par type**, **avantages salariaux d'après les fiches de paie**, **LEP : alerte avant fermeture et lecture de l'avis d'imposition**, **veille fiscale hebdomadaire** (Gemini propose, vous validez).

## Feuille de route (par phases, sans dates)

Fait : corrections immédiates, accessibilité urgente, filet de sécurité (tests, lint strict, contrôles), retrait des e-mails, marque Google validée, domaine pecule-app.com, passage visuel Material 3 Expressive.

### Phase 1 : interface (faite)
1. Bibliothèque de composants Material (`src/components/ui/`) : Card, StatTile, MoneyText, DeltaBadge, DataTable, TextField, SegmentedButton, Tabs, Chip, EmptyState, PageHeader, Sparkline. Conversion progressive des boutons et cartes faits main.
2. Accueil : un chiffre principal (variation + petite courbe SVG), deux tâches au plus, le reste replié.
3. Pilotage : « À placer ce mois » d'abord, puis « D'où vient ce chiffre ».
4. Actualiser : une ligne repliable par compte.
5. Graphiques relookés Material, chacun avec son tableau accessible.
6. Pages publiques (présentation, confidentialité) au même style.

### Phase 2 : motivation (faite)
1. Bons mois : au moins 500 € mis de côté sur 30 jours à partir de chaque paie (seuil réglable, désactivable).
2. Jalons et séries : précaution atteinte, livret plein, série de paies tenues (un joker par an).
3. Point de paie : bilan à chaque paie (prévu / réalisé, un enseignement, une action).
4. Contrôle des fiches de paie : alerte si une fiche s'écarte nettement de la médiane des six précédentes.

### Phase 3 : solidité avant la restitution (faite)
1. Écriture Drive vérifiée : plus de modification perdue entre deux appareils.
2. Restitution, virements et annulations sortis d'`App.tsx` en commandes testées.
3. Répétition générale de la restitution en mode démo.

### Phase 4 : passage en solo (faite, sauf ce qui attend la restitution de janvier)
1. Restitution, mode solo, nettoyage de l'ancienne adresse github.io (serveur, client OAuth, clé du Picker).
2. Simulateur « Et si… » et alertes unifiées chiffrées en euros.
3. « Votre année Pécule » (bilan annuel).

### Phase 5 : infrastructure (en cours)
1. ✅ Adresse contact@pecule-app.com (redirection e-mail Cloudflare), code de conduite (Contributor Covenant 2.1) et contacts de SECURITY/CONTRIBUTING.
2. ✅ Cloudflare devant le site : en-têtes de sécurité HTTP (HSTS, anti-iframe, politique de permissions).
3. ✅ Seconde sauvegarde chiffrée chez Cloudflare (chiffrée dans l'app, illisible pour le serveur).
4. ✅ Surveillance quotidienne du site et du serveur (GitHub Actions, issue ouverte en cas de panne).
5. Veille fiscale côté serveur avec l'IA de Cloudflare, si l'offre gratuite suffit et que la qualité tient.

### Phase 6 : wiki GitHub (rédigé, à relire en phase 7)
Remplir le wiki du dépôt : guide d'utilisation (premiers pas, paie et Pilotage, comptes et Actualiser, parents et restitution, motivation, simulateur, notifications, sauvegardes et conflits, confidentialité), FAQ, et pages pour contribuer (architecture, invariants, déploiement, veille fiscale). Le README et MAINTENANCE restent la référence technique ; le wiki s'adresse d'abord aux utilisateurs.

### Phase 7 : point final (en dernier, une fois tout le reste bouclé)
Grand ménage et remise à plat de tout ce qui entoure le code :
- code : fichiers, exports et dépendances inutilisés, commentaires périmés, duplications restantes ;
- documentation : README, MAINTENANCE, CONTRIBUTING, SECURITY, ROADMAP, worker/README, wiki ;
- règles GitHub : protection de la branche principale, modèles d'issues et de PR, Dependabot (dont `edge/`), étiquettes ;
- règles de l'app et pages publiques : confidentialité, présentation, mentions dans l'app ;
- vérification finale : tests, couverture, accessibilité, sécurité.

### Abandonné
- **Ouverture à d'autres utilisateurs sur invitation** (octobre 2026) : liée au Play Store, abandonnée avec lui. Pécule reste une app personnelle.
- **App Android sur le Play Store** (octobre 2026) : Google impose aux comptes personnels un test fermé de 12 testeurs pendant 14 jours. Pécule reste une PWA, qui s'installe déjà comme une vraie app Android via Chrome (« Installer l'application »).

### En continu
- Architecture : montants en centimes, store et moteur de synchronisation, paquet `domain/` partagé avec le serveur.
- Maintenance : versions majeures (Vite 8, Node 24), TypeScript 7 dès que typescript-eslint le prend en charge, en-têtes de sécurité HTTP via Cloudflare.
- Pistes : « Demander à Pécule » (assistant), données chiffrées de bout en bout chez Cloudflare.

## Notes techniques à ne pas perdre

- **Google Picker avec `drive.file`** : le Picker doit recevoir `.setAppId()` (le préfixe numérique du `CLIENT_ID`). Sans ça, le fichier semble sélectionnable, mais l'accès n'est jamais accordé : la lecture renvoie un 404 silencieux.
- **Modèles Gemini** : Google les déprécie régulièrement. Le modèle principal et les modèles de repli sont des constantes en tête de `src/services/geminiService.ts`. Un modèle retiré (404) est sauté automatiquement.
- **Onglets PWA restés ouverts** : un onglet qui exécute une ancienne version peut effacer des champs récents du fichier Drive. L'app se recharge donc dès qu'un nouveau service worker prend le contrôle de la page (`src/index.tsx`).
- **Session du serveur** : l'écran de consentement OAuth doit rester « En production ». En mode test, Google fait expirer les refresh tokens au bout de 7 jours.
- **Mouvements `kind`** : `valuation` (variation de valeur), `parental` (part des parents), `adjustment` (correction, pas de l'épargne). Seuls les mouvements sans `kind`, hors solde initial et après `config.trackingStartDate`, comptent comme épargne (`isSavingsFlow` dans `src/lib/finance/savings.ts`). Tout changement de solde passe par `src/lib/accountOps.ts`.
- **Déconnexion en mode serveur** : ne jamais révoquer le jeton Google côté navigateur. La révocation annule tout l'accord, refresh token du serveur compris, et déconnecterait tous les appareils.
