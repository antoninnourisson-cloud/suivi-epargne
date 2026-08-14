# Roadmap

Idées de fonctionnalités futures, non planifiées ni committées à un calendrier.

## Analyse de fiches de paie par IA

**Objectif** : uploader une fiche de paie (PDF/image) dans l'app, en extraire automatiquement les informations pertinentes (brut, net, cotisations, tickets restaurant, Navigo, etc.), les stocker sur le Drive de l'utilisateur, et en tirer un résumé exploitable dans le reste de l'app (ex: pré-remplir "Pilotage Budgétaire", suivre l'évolution du salaire dans le temps).

### Pourquoi c'est cohérent avec l'architecture actuelle
- Zéro-backend : cohérent avec le principe déjà en place (tout tourne dans le navigateur + Drive de l'utilisateur).
- La clé API (Gemini ou autre) serait saisie dans **Paramètres**, stockée dans le fichier `suivi_epargne.json` sur le Drive de l'utilisateur (comme le `parentsEmail` actuellement) — jamais envoyée à un serveur tiers autre que l'API du fournisseur choisi.

### Grandes étapes envisagées
1. **Stockage sécurisé de la clé API**
   - Nouveau champ dans `Settings.tsx` / `GlobalAppData.config` (ex: `geminiApiKey`).
   - Avertissement clair à l'utilisateur : la clé est stockée en clair dans son propre Drive (comme le reste des données actuellement — cohérent avec le choix déjà fait pour le `CLIENT_ID` et les autres données).
2. **Upload de fichier**
   - Nouvel écran ou section (ex: dans "Actualiser Solde" ou un nouvel onglet "Fiches de paie").
   - Accepter PDF et images (photo de la fiche papier).
   - Stocker le fichier original sur le Drive de l'utilisateur (`drive.file` scope déjà utilisé — soit dans le même fichier JSON en base64, soit en fichier séparé pour éviter de surcharger `suivi_epargne.json`).
3. **Extraction des données**
   - Appel à l'API Gemini (multimodal, supporte PDF/image en entrée) avec un prompt structuré demandant un JSON en sortie (brut, net, cotisations, primes, tickets resto, Navigo, période, employeur...).
   - Gérer les erreurs d'extraction (fiche illisible, champs manquants) avec une validation/correction manuelle par l'utilisateur avant sauvegarde.
4. **Stockage & historique**
   - Nouvelle structure de données (ex: `payslips: PayslipRecord[]`) dans `GlobalAppData`, au même titre que `history`/`expensesHistory`.
   - Un enregistrement par fiche de paie : mois, montants extraits, lien vers le fichier original.
5. **Restitution**
   - Résumé/tableau des fiches de paie importées avec évolution du net dans le temps (graphique, à la manière de la courbe d'épargne existante).
   - Pré-remplissage automatique de "Pilotage Budgétaire" (`grossAnnual`, avantages salariaux) à partir de la dernière fiche importée, avec confirmation de l'utilisateur avant d'écraser les valeurs actuelles.

### Points d'attention identifiés dès maintenant
- **Coût** : chaque appel à l'API Gemini a un coût (facturé sur la clé de l'utilisateur) — prévoir un indicateur clair avant chaque extraction ("cette action va utiliser votre clé API").
- **Confidentialité** : les fiches de paie contiennent des données personnelles sensibles (nom, employeur, salaire) — bien documenter que ça reste sur le Drive perso, comme le reste de l'app.
- **Fiabilité de l'extraction** : toujours prévoir une étape de relecture/correction manuelle avant sauvegarde définitive, ne jamais faire confiance aveuglément à l'extraction automatique pour des montants financiers.
- **Taille du fichier `suivi_epargne.json`** : si les fiches de paie (PDF/images) sont stockées en base64 dans ce même fichier, il va grossir vite. Envisager des fichiers Drive séparés référencés par ID plutôt qu'embarqués.
