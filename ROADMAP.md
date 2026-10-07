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

### Phase 1 : interface (en cours)
1. Bibliothèque de composants Material (`src/components/ui/`) : Card, StatTile, MoneyText, DeltaBadge, DataTable, TextField, SegmentedButton, Tabs, Chip, EmptyState, PageHeader, Sparkline. Conversion progressive des boutons et cartes faits main.
2. Accueil : un chiffre principal (variation + petite courbe SVG), deux tâches au plus, le reste replié.
3. Pilotage : « À placer ce mois » d'abord, puis « D'où vient ce chiffre ».
4. Actualiser : une ligne repliable par compte.
5. Graphiques relookés Material, chacun avec son tableau accessible.
6. Pages publiques (présentation, confidentialité) au même style.

### Phase 2 : motivation
1. Bons mois : au moins 500 € mis de côté sur 30 jours à partir de chaque paie (seuil réglable, désactivable).
2. Jalons et séries : précaution atteinte, livret plein, série de paies tenues (un joker par an).
3. Point de paie : bilan à chaque paie (prévu / réalisé, un enseignement, une action).
4. Contrôle des fiches de paie : alerte si une fiche s'écarte nettement de la médiane des six précédentes.

### Phase 3 : solidité avant la restitution
1. Écriture Drive vérifiée : plus de modification perdue entre deux appareils.
2. Restitution, virements et annulations sortis d'`App.tsx` en commandes testées.
3. Répétition générale de la restitution en mode démo.

### Phase 4 : passage en solo
1. Restitution, mode solo, nettoyage de l'ancienne adresse github.io (serveur, client OAuth, clé du Picker).
2. Simulateur « Et si… » et alertes unifiées chiffrées en euros.
3. « Votre année Pécule » (bilan annuel).

### Phase 5 : app Android (Trusted Web Activity)
`/.well-known/assetlinks.json` sur le domaine, projet Android signé (PWABuilder ou Bubblewrap), compte Google Play (25 $), fiche de confidentialité, période de test fermé.

### Phase 6 : ouverture sur invitation
- Invitations à usage unique avec date d'expiration, accès révocable (remplace `ALLOWED_EMAILS`).
- Rappels quotidiens répartis dans une file (Cloudflare Queues) ; offre Workers à 5 $/mois si le nombre de comptes le justifie.
- Accueil guidé, partie « parents » facultative et masquée par défaut ; lecture Gemini : clé personnelle ou serveur, à trancher.
- Mentions légales (LCEN), contact dédié, confidentialité multi-utilisateurs (RGPD), remontée d'erreurs anonyme, code de conduite (Contributor Covenant 2.1, contact de signalement non personnel).

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
