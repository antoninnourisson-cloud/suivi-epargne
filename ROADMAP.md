# Roadmap

## Livré

- **Ma paie** (30 octobre 2026, branche `ma-paie`, lots M1 à M5) : la paie reçue devient un objet de données (`PayRecord`, schéma v3, migration de la liste à cocher, de la capacité et de la somme en plus). Rituel « J'ai reçu ma paie » dans le Pilotage (montant, date, prime, fiche de paie importée sur place, répartition conseillée pour le montant reçu, enregistrement en une commande avec un seul « Annuler », modifier ou supprimer la paie, versement en plus). Mois d'épargne (paie reçue à partir du 15 : mois suivant, modifiable) pour la jauge, la routine à trois étapes, les bons mois, « Votre année », « Demander à Pécule » et l'Agenda ; notification « Paie reçue ? » avec relance, clés au mois d'épargne sans doublon à la bascule.
- **Fiches de paie par IA** : import via Google Picker, extraction Gemini (sortie structurée, nouvelles tentatives et modèles de repli en cas de saturation), relecture obligatoire, graphique du net, mode « chiffres exacts » dans le Pilotage.
- **Verrou de l'appareil** : biométrie (WebAuthn) ou PIN (PBKDF2), réactivé après le délai choisi dans Paramètres (Immédiatement, 1, 5 ou 15 minutes ; 5 par défaut) en passant en arrière-plan, posé en surcouche sans démonter l'écran en cours (une saisie à moitié remplie survit) et toujours actif à l'ouverture de l'app, avec une porte de sortie en cas de code oublié.
- **Fiscalité du capital** : net des gains en cas de retrait (PFU, exonérations après maturité), compte à rebours de maturité par compte.
- **Intérêts réellement acquis** (règle des quinzaines) pour les gains nets si retrait et le rappel parental.
- **Projection et dérive du rythme d'épargne**.
- **Alertes** : révision des taux réglementés, éligibilité LEP, intérêts parentaux de décembre.
- **Mouvements récurrents** proposés à l'échéance, et **ajustement « + / − x € »** dans Actualiser solde.
- **Serveur Cloudflare** : session Google persistante et notifications push, dont le rappel du jour de paie avec le plan de placement.
- **Versements cumulés** (PEA, AV…) : plus-values latentes, impôt exact d'un retrait, plafond PEA ; « Placé ce mois-ci » ; meilleur compte à ponctionner ; abonnements avec rappels.
- **Restitution du capital parental**, agenda des douze mois, bilan annuel, répartition personnalisée de l'épargne, taux datés, journal des modifications, corrections « Pas de l'épargne » et point de départ du suivi.
- **Quoi de neuf** : historique des mises à jour en dur (`src/changelog.ts`), affiché une fois après chaque mise à jour.
- **Déploiement automatique du Worker** depuis GitHub Actions (`.github/workflows/deploy.yml`, avec le site et le Worker d'en-têtes, à chaque push sur `main` depuis le 26/10/2026). Actif dès que les deux secrets du dépôt `CLOUDFLARE_API_TOKEN` et `CLOUDFLARE_ACCOUNT_ID` existent ; d'ici là, le job est sauté et `npm run deploy` reste possible à la main.
- **Plus aucun envoi d'e-mail** : l'autorisation Gmail (`gmail.send`) est retirée de la connexion Google, qui ne demande plus aucune portée sensible.
- **Préférences de notification par type**, **avantages salariaux d'après les fiches de paie**, **LEP : alerte avant fermeture et lecture de l'avis d'imposition**, **veille fiscale hebdomadaire** (d'abord avec Gemini ; depuis octobre 2026 sur le serveur avec Cloudflare Workers AI, Gemini en secours ; l'app propose, vous validez).
- **Partager vers Pécule** (octobre 2026) : l'app installée sur Android reçoit un PDF ou une image partagé depuis une autre app (Web Share Target) et propose de l'importer comme fiche de paie, relevé bancaire ou avis d'imposition ; fichier gardé sur l'appareil le temps de l'import seulement.
- **Demander à Pécule** (octobre 2026) : questions en français sur ses propres données, réponses de Gemini avec la clé de l'appareil d'après un résumé compact (sans e-mail, identifiant Drive, clé ni texte libre). Lecture seule, conversation jamais enregistrée.
- **Audit du 29 octobre 2026** (branche `audit-oct29`, lots L1 à L8) : calculs justes (intérêts de l'ajout rapide hors épargne, prélèvements sociaux des PEL et CEL, rythme d'épargne sans intérêts, intérêts datés du 31/12, « 12.500 » refusé), fiches de paie (contrôle croisé des montants, remplacer ou ajouter une fiche du même mois, « Choisir sur l'appareil »), fichier partagé visible avant lecture, verrou à délai réglable et en surcouche, « Se déconnecter » dans Paramètres et état de synchronisation touchable, « Inchangé » et « Confirmer le solde » dans Actualiser, mouvements lisibles sur téléphone, mode discret, routine du mois sur l'Accueil, en-tête du Pilotage et « Et si… » plus honnêtes, élisions (« Paie d'octobre »), plafond de 500 kB du fichier principal vérifié en CI, filet d'erreur et journal local des erreurs, date du jour qui suit minuit, stockage persistant demandé, `/status` enrichi (veille fiscale et historique des crons) et alerte de la surveillance, jeton Cloudflare réservé à `main`, cooldown Dependabot, tests de la session et des actions de compte.
- **Octobre 2026** : Material 3 Expressive, motivation (bons mois, jalons, point de paie), simulateur « Et si… », alertes en euros, « Votre année », écriture Drive vérifiée, sauvegarde de secours chiffrée, en-têtes de sécurité, surveillance quotidienne, tests de bout en bout, wiki. Détail par phase ci-dessous.
- **Node 24 et dates de compatibilité** (30 octobre 2026, branche `archi-oct30`) : Node 24 pour l'app, `worker/` et `edge/` (`.nvmrc`, `engines`, `@types/node` 24) ; `compatibility_date` des deux Workers montée de 2025-06-01 à 2026-10-01 (indicateurs passés par défaut entre les deux dates relus un par un : aucun changement de code nécessaire).
- **Vite 8** (30 octobre 2026, branche `archi-oct30`) : Vite 6.4 → 8.3 (Rolldown remplace Rollup et esbuild), `@vitejs/plugin-react` 4.7 → 6.1, `vite-plugin-pwa` 1.3 → 2.0, Vitest 5.0.3 → 5.0.5. Service worker, manifeste et CSP du build identiques ; fichier principal 452 → 408 kB. `experimentalMinChunkSize` n'existe pas dans Rolldown : plus de petits fichiers JS (détail dans `vite.config.ts`).

## Feuille de route (par phases, sans dates)

Fait : corrections immédiates, accessibilité urgente, filet de sécurité (tests, lint strict, contrôles), retrait des e-mails, marque Google validée, domaine pecule-app.com, passage visuel Material 3 Expressive.

### Phase 1 : interface (faite)
1. Bibliothèque de composants Material (`src/components/ui/`) : Card, StatTile, MoneyText, DeltaBadge, DataTable, TextField, SegmentedButton, Tabs, Chip, EmptyState, PageHeader, Sparkline, IconButton (bouton-icône de 48 px), ListItem (ligne de liste dont les actions passent sous le titre sur téléphone). Journal, Virements, Agenda, Abonnements, Historique, recherche de mouvements, ajout rapide et projection selon la répartition sont convertis (aucune palette brute, aucun texte sous 12 px : garde-fou `src/components/materialScreens.palette.test.ts`). Dons et impôts, Part parentale, Restitution, Fiches de paie et « Où le placer » le sont aussi (garde-fou `src/components/materialMoneyScreens.palette.test.ts`), ainsi que la boîte de confirmation (titre, actions texte, bouton destructeur au rôle « error », focus sur « Annuler ») et le bouton désactivé (état Material 3, raison écrite à côté) ; les anciens noms de variantes de bouton (primary, secondary, ghost) n'existent plus. Après une suppression au clavier, le focus passe à l'élément voisin (`focusAfterRemoval`). Migration terminée : plus aucune classe de palette brute dans l'app, le thème ne rebranche plus les échelles indigo, slate, gray, emerald, rose ou amber, et le lint refuse leur retour (`eslint.config.js`, garde-fou `src/components/paletteGuard.test.ts`, aucun fichier exempté). Boutons-icônes, puces et boutons texte passent par le kit (`IconButton`, `Chip`, `Button`, taille `sm`).
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

### Phase 5 : infrastructure (faite)
1. ✅ Adresse contact@pecule-app.com (redirection e-mail Cloudflare), code de conduite (Contributor Covenant 2.1) et contacts de SECURITY/CONTRIBUTING.
2. ✅ Cloudflare devant le site : en-têtes de sécurité HTTP (HSTS, anti-iframe, politique de permissions).
3. ✅ Seconde sauvegarde chiffrée chez Cloudflare (chiffrée dans l'app, illisible pour le serveur).
4. ✅ Surveillance quotidienne du site et du serveur (GitHub Actions, issue ouverte en cas de panne).
5. ✅ Veille fiscale côté serveur avec l'IA de Cloudflare (gratuit : ~2 000 neurones par semaine) ; qualité à confirmer sur le premier relevé réel, Gemini en secours.

### Phase 6 : wiki GitHub (fait, mis à jour en phase 7)
Remplir le wiki du dépôt : guide d'utilisation (premiers pas, paie et Pilotage, comptes et Actualiser, parents et restitution, motivation, simulateur, notifications, sauvegardes et conflits, confidentialité), FAQ, et pages pour contribuer (architecture, invariants, déploiement, veille fiscale). Le README et MAINTENANCE restent la référence technique ; le wiki s'adresse d'abord aux utilisateurs.

### Phase 7 : point final (en dernier, une fois tout le reste bouclé)
Grand ménage et remise à plat de tout ce qui entoure le code :
- ✅ code (octobre 2026) : exports inutilisés retirés (analyse knip), commentaires périmés corrigés (rôles du serveur, veille fiscale), formatage des montants et accès au stockage local regroupés (`src/lib/format.ts`, `src/lib/storage.ts`) ; Paramètres rangés en cartes repliables ;
- ✅ accessibilité (octobre 2026) : résultat du simulateur annoncé en une phrase après la saisie, raisons des choix indisponibles, date de restitution vidée signalée, jauge « Bons mois » en euros, annonce des nouveaux jalons, boutons de fermeture de 44 px, niveaux de titres, noms de boutons explicites ;
- ✅ documentation : README, MAINTENANCE, CONTRIBUTING, SECURITY, ROADMAP, worker/README, wiki (octobre 2026) ;
- règles GitHub : ✅ modèles d'issues et de PR, ✅ Dependabot (dont `edge/`), ✅ permissions minimales des workflows, ✅ protection de la branche principale (règle « Protection de main » : ni suppression ni réécriture, contrôle « Types, tests, build » exigé), ✅ étiquettes (dont `panne`) ; ✅ une seule vérification par push et retour arrière depuis l'interface web (Actions → Déploiement → Run workflow, octobre 2026) ;
- règles de l'app et pages publiques : ✅ confidentialité et présentation (octobre 2026), mentions dans l'app ;
- ✅ vérification finale (octobre 2026) : lint, typage, tests et couverture, build, tests de bout en bout (deux passages sans échec), audit complet des dépendances (app, serveur, edge : aucune faille ; `sharp`, tiré par wrangler, forcé en 0.35.5 par `overrides` dans `worker/` et `edge/`, à retirer dès que wrangler l'embarque) ; tests rendus plus robustes sur machine lente (délais d'attente, démontage des hooks entre tests).
- Après la restitution de janvier 2027 (faite à la main, sans rituel) : enregistrer la restitution et passer en mode solo ; retirer l'ancienne adresse github.io (`LEGACY_APP_URL` dans `worker/wrangler.toml` et `worker/src/security.ts`, avis de déménagement `src/components/MovedNotice.tsx`, origine dans le client OAuth et la clé du Picker) ; mettre à jour les textes liés aux parents des pages publiques et du wiki (dans l'app, ils suivent les données et passent d'eux-mêmes en solo : lib/parentalMode).

### Phase 8 : rituels et menus allégés (à faire, validé le 30 octobre 2026)
Même principe que « Ma paie » : un événement réel, saisi une fois, rangé au bon mois. **Règle commune : aucun rituel n'ajoute d'entrée de menu ni de carte permanente** ; chacun s'ouvre depuis un endroit qui existe déjà (tâche de l'Accueil, notification, écran concerné) et disparaît une fois fait.
1. **Menus simplifiés, sans perdre d'information** : regrouper et alléger la navigation (barre du bas, « Plus », menu latéral) et les cartes des écrans les plus chargés ; chaque écran et chaque information gardent une place, plus facile à trouver.
2. **« J'ai besoin de X € » (retrait guidé)** : montant et date, Pécule choisit le compte où puiser (impôt, maturité, règle des quinzaines, part parentale intouchable), dit ce que le retrait coûte et l'enregistre en une fois.
3. **Clôture de l'année (janvier)** : une seule feuille pour les intérêts réellement crédités sur chaque livret (face à ceux calculés), les relevés annuels (assurance vie, PEA), « Votre année » et l'objectif de l'année suivante. Remplace la dispersion entre Actualiser, les alertes et la clôture. Sans la restitution.
4. **« Les taux ont changé » (1er février, 1er août)** : les nouveaux taux officiels (Livret A, LDDS, LEP) proposés par la veille fiscale, appliqués à tous les comptes concernés en un geste, à la bonne date.
5. **« Argent reçu » hors salaire** (remboursement, vente, cadeau) : même rituel que la paie, répartition conseillée, et ce qui se déclare (dons familiaux au-delà des seuils).

La **restitution aux parents** (janvier 2027) se fera **à la main**, avec les outils actuels (carte « Restitution du capital ») : pas de rituel dédié.

### Audit complet d'octobre 2026 (lots 1, 2 et 3 faits, puis l'audit du 29 octobre)
- ✅ **Lot 1** : données protégées, « Actualiser » fiable, calculs justes, surveillance fiable, déploiements derrière la CI.
- ✅ **Lot 2** : plusieurs appareils (écran de choix, version écartée mise de côté), hors ligne, déclaration complète, verrou renforcé (« Code oublié » avec délai de 24 h).
- ✅ **Lot 3** (23 octobre 2026) : `App.tsx` et les données découpés (`src/app`, `src/hooks/portfolio`, état de synchronisation unique) ; session serveur liée à l'appareil, « Appareils connectés », alerte « Code oublié » aux autres appareils, effacement des copies de secours différé de 7 jours et conservation échelonnée ; nouveaux types de compte (livret bancaire, CEL, PEL, compte à terme, compte-titres), performance réelle des placements, fraîcheur des soldes compte par compte, rendement après inflation (INSEE), PER ; « Lire un relevé » (Gemini) ; clôture de l'année ; corrections de calcul (argent qui dort, dons 2025, remboursement transport, quinzaines, crypto 305 €) ; tous les écrans en Material 3 (aucune palette brute, cibles de 48 px, thème Automatique / Clair / Sombre) ; seuils de couverture relevés (toute l'app 81 / 74 / 73 / 85).
- ✅ **Reliquats** (octobre 2026) : le plan de placement automatique remplit aussi le CEL (plafond légal de 15 300 € ou celui du compte) et les livrets bancaires plafonnés, après les livrets réglementés ; un livret bancaire sans plafond ne reçoit le reste que s'il n'y a ni assurance vie ni PEA ; la répartition personnalisée respecte aussi le plafond du CEL. Performance d'un placement comparée au Livret A sur la même période (taux datés notés sur le Livret A). Tâche « Clôture de l'année » en tête de l'Accueil en janvier-février. `SavingsAccount.movements` obligatoire (migrate() le crée) et protections inutiles retirées. Option au barème (case 2OP) présentée clairement comme une approximation.
- ✅ **Audit du 29 octobre 2026** (lots L1 à L8, voir « Livré ») : toutes les propositions retenues sont faites, sauf ce qui suit. Non retenus : refus du partage selon le référent dans `share-sw.js` (non vérifiable sans l'appareil, et contournable), `id` du manifeste (changerait l'identité de l'app pour Chrome), `title`/`text` dans le partage (Pécule serait proposé pour du texte sans fichier). Les intérêts « Intérêts » de l'ajout rapide saisis avant le lot restent à marquer « Pas de l'épargne » au Journal.
- Reste à faire (plus tard) :
  - aide à la déclaration : pas de ligne pour l'IFU d'un compte-titres (dividendes, plus-values), cases à vérifier sur une source officielle avant de coder ;
  - plafond PER estimé : seule l'année 2026 est connue (`PER_CEILING_RULES`) ; ajouter 2027 et les suivantes une fois vérifiées sur une source officielle ;
  - import d'un relevé en CSV ou OFX (seule la lecture d'un PDF ou d'une capture par Gemini existe) ;
  - option au barème (case 2OP) : calcul exact par le barème complet (aujourd'hui un seul taux marginal, signalé comme approximation à l'écran) ;
  - comparaison au Livret A : avant le plus ancien changement de taux noté sur le compte Livret A, Pécule prend ce plus ancien taux ; une table officielle des taux passés rendrait la comparaison exacte sur de longues périodes ;
  - exploitation (à faire plus tard, une chose à la fois, sur une branche) :
    - **Node 26** : à évaluer en 2027 (LTS depuis fin octobre 2026), une fois wrangler et Playwright validés ; Node 24 (fait le 30 octobre 2026) est maintenu jusqu'au 30 avril 2028 ;
    - **ESLint 10** : **bloqué** (vérifié le 30 octobre 2026). `eslint-plugin-jsx-a11y` 6.10.2 (dernière version, octobre 2024) n'accepte qu'ESLint ≤ 9 ; les demandes ([#1075](https://github.com/jsx-eslint/eslint-plugin-jsx-a11y/issues/1075)) et les correctifs proposés ([#1079](https://github.com/jsx-eslint/eslint-plugin-jsx-a11y/pull/1079), [#1081](https://github.com/jsx-eslint/eslint-plugin-jsx-a11y/pull/1081)) attendent toujours le mainteneur. Le reste est prêt : `@eslint/js` 10.0.1, `typescript-eslint` 8.72, `eslint-plugin-react-hooks` 7.1.1 acceptent ESLint 10. ESLint 9 n'a plus de correctifs depuis le 6 août 2026 ([version-support](https://eslint.org/version-support/)) : sans effet sur l'app (outil de développement seulement), mais à ne pas laisser traîner. Déjà fait sous ESLint 9 : les règles ajoutées à `eslint:recommended` par ESLint 10 (`no-unassigned-vars`, `no-useless-assignment`, `preserve-caught-error`) et le nouveau défaut de `no-shadow-restricted-names` sont actives dans `eslint.config.js`, et leurs six alertes sont corrigées. À la sortie d'une version de `eslint-plugin-jsx-a11y` qui accepte ESLint 10 (ou si le projet reste figé au-delà de mi-2027, envisager une copie maintenue du plugin, après vérification), monter `eslint` et `@eslint/js` en 10 sans `--legacy-peer-deps`, relire le [guide de migration](https://eslint.org/docs/latest/use/migrate-to-10.0.0) (recherche de `eslint.config.js` depuis chaque fichier, commentaires `/* eslint-env */` refusés, JSX compté comme référence par `no-unused-vars`), puis relancer les tests de bout en bout et le test du build publié. Laisser ensuite Dependabot proposer les majeures sans risque (`@types/*`, `globals`) ;
    - **TypeScript 7** (compilateur natif) : **pas encore**, évalué le 30 octobre 2026. TypeScript 7.0.2 est sorti en juillet 2026 mais n'expose plus l'API JavaScript de TypeScript 6 (le paquet n'exporte que des modules `unstable/*`) ; `typescript-eslint` 8.72 exige `typescript` < 6.1 et sa prise en charge attend une API de TypeScript 7.1 ([#10940](https://github.com/typescript-eslint/typescript-eslint/issues/10940), essai en cours [#12803](https://github.com/typescript-eslint/typescript-eslint/pull/12803)). Vite et Vitest ne lisent pas les types (ils les retirent seulement) : seul `npm run typecheck` (`tsc --noEmit`) profiterait de la vitesse de TypeScript 7. Passer quand `typescript-eslint` l'accepte, sans installer deux TypeScript côte à côte en attendant ;
    - **regrouper les petits fichiers JS** quand Rolldown aura un équivalent sûr de `experimentalMinChunkSize` (Rollup) : depuis Vite 8, 76 fichiers JS au lieu de 41 (précache 89 entrées au lieu de 54, même poids). Un groupe « partagé » dans `codeSplitting` a été essayé : sans `strictExecutionOrder`, l'app plante au démarrage (ordre d'exécution des modules) ; avec, le fichier principal devient une coquille de 40 octets ;
    - **API du serveur sur `api.pecule-app.com`** : **fait le 30 octobre 2026** (domaine personnalisé sur `suivi-epargne-api`, URI de redirection Google ajouté, règle de limitation de débit « API et site » à la place de « Leaked credential check », qui occupait l'unique règle gratuite et ne protégeait rien : Pécule n'a aucun formulaire de mot de passe ; `deploy.yml` ne publie le site que si le serveur répond). Reste, quelques jours après (vers le 3 novembre) : `workers_dev = false` dans `worker/wrangler.toml` (l'ancienne adresse échappe à la règle tant qu'elle est ouverte), puis retirer l'URI de redirection en `workers.dev` dans la console Google ; et revoir le champ `site.hsts` de `/status` : appelé sur la zone, le Worker lit le site sans passer par `pecule-edge`, donc sans HSTS (la surveillance vérifie l'en-tête elle-même, pas de fausse alerte) ;
  - risques résiduels connus de la sécurité : voir [SECURITY.md](SECURITY.md) (*Limites connues*).

### Abandonné
- **Ouverture à d'autres utilisateurs sur invitation** (octobre 2026) : liée au Play Store, abandonnée avec lui. Pécule reste une app personnelle.
- **App Android sur le Play Store** (octobre 2026) : Google impose aux comptes personnels un test fermé de 12 testeurs pendant 14 jours. Pécule reste une PWA, qui s'installe déjà comme une vraie app Android via Chrome (« Installer l'application »).

### En continu
- Architecture : montants en centimes, store et moteur de synchronisation, paquet `domain/` partagé avec le serveur.
- Maintenance : versions majeures (voir *exploitation* ci-dessus et le calendrier de MAINTENANCE.md § 4), ESLint 10 dès qu'`eslint-plugin-jsx-a11y` l'accepte, TypeScript 7 dès que typescript-eslint le prend en charge (voir *exploitation*).

## Notes techniques à ne pas perdre

- **Google Picker avec `drive.file`** : le Picker doit recevoir `.setAppId()` (le préfixe numérique du `CLIENT_ID`). Sans ça, le fichier semble sélectionnable, mais l'accès n'est jamais accordé : la lecture renvoie un 404 silencieux.
- **Modèles Gemini** : Google les déprécie régulièrement. Le modèle principal est `DEFAULT_GEMINI_MODEL` (`src/services/geminiModel.ts`), les modèles de repli sont en tête de `src/services/geminiService.ts`. Un modèle retiré (404) est sauté automatiquement.
- **Onglets PWA restés ouverts** : un onglet qui exécute une ancienne version peut effacer des champs récents du fichier Drive. L'app se recharge donc dès qu'un nouveau service worker prend le contrôle de la page (`src/index.tsx`).
- **Session du serveur** : l'écran de consentement OAuth doit rester « En production ». En mode test, Google fait expirer les refresh tokens au bout de 7 jours.
- **Mouvements `kind`** : `valuation` (variation de valeur), `parental` (part des parents), `adjustment` (correction, pas de l'épargne). Seuls les mouvements sans `kind`, hors solde initial et après `config.trackingStartDate`, comptent comme épargne (`isSavingsFlow` dans `src/lib/finance/savings.ts`). Tout changement de solde passe par `src/lib/accountOps.ts`.
- **Déconnexion en mode serveur** : ne jamais révoquer le jeton Google côté navigateur. La révocation annule tout l'accord, refresh token du serveur compris, et déconnecterait tous les appareils.
