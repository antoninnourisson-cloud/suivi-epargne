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

## En cours : plan d'action de l'audit 360° (octobre 2026)

1. **Corrections immédiates** : confidentialité (avis d'imposition), historique daté, documentation, licence AGPL v3, CONTRIBUTING, SECURITY, police Inter hébergée avec l'app, Vitest 5.
2. **Accessibilité urgente** (WCAG 2.2 AA) : contrastes, lien d'évitement, titres d'écran, toast « Annuler », champs, import de fichier, mouvement réduit.
3. **Filet de sécurité** : couverture de tests avec seuils, tests de bout en bout en mode démo, lint strict, contrôles sur les virements et l'ajout rapide, validation par schéma aux entrées.
4. **Design system et refonte** : jetons sémantiques, composants `ui/`, graphiques SVG maison, refonte Accueil, Pilotage et Actualiser.
5. **Produit** : point de paie (bilan calé sur le 27), jalons et séries (gamification sobre), contrôle des fiches de paie, puis simulateur « Et si… » et alertes unifiées.
6. **Architecture** : commandes sorties d'`App.tsx`, store et moteur de synchronisation, montants en centimes, paquet `domain/` partagé avec le serveur.
7. **Hébergement** : origine dédiée (domaine ou Cloudflare Pages), en-têtes de sécurité HTTP.

## Plus tard

- **TypeScript 7** : à faire quand typescript-eslint le prendra en charge (aujourd'hui jusqu'à 6.0, déjà en place).
- **Code de conduite** (`CODE_OF_CONDUCT.md`, Contributor Covenant 2.1 en français) : choisir d'abord un contact de signalement qui ne soit pas l'adresse personnelle (par exemple une adresse redirigée sur pecule-app.com).

## Notes techniques à ne pas perdre

- **Google Picker avec `drive.file`** : le Picker doit recevoir `.setAppId()` (le préfixe numérique du `CLIENT_ID`). Sans ça, le fichier semble sélectionnable, mais l'accès n'est jamais accordé : la lecture renvoie un 404 silencieux.
- **Modèles Gemini** : Google les déprécie régulièrement. Le modèle principal et les modèles de repli sont des constantes en tête de `src/services/geminiService.ts`. Un modèle retiré (404) est sauté automatiquement.
- **Onglets PWA restés ouverts** : un onglet qui exécute une ancienne version peut effacer des champs récents du fichier Drive. L'app se recharge donc dès qu'un nouveau service worker prend le contrôle de la page (`src/index.tsx`).
- **Session du serveur** : l'écran de consentement OAuth doit rester « En production ». En mode test, Google fait expirer les refresh tokens au bout de 7 jours.
- **Mouvements `kind`** : `valuation` (variation de valeur), `parental` (part des parents), `adjustment` (correction, pas de l'épargne). Seuls les mouvements sans `kind`, hors solde initial et après `config.trackingStartDate`, comptent comme épargne (`isSavingsFlow` dans `src/lib/finance/savings.ts`). Tout changement de solde passe par `src/lib/accountOps.ts`.
- **Déconnexion en mode serveur** : ne jamais révoquer le jeton Google côté navigateur. La révocation annule tout l'accord, refresh token du serveur compris, et déconnecterait tous les appareils.
