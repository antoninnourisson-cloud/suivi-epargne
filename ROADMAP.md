# Roadmap

Idées de fonctionnalités futures, non planifiées ni committées à un calendrier.

## Analyse de fiches de paie par IA

**Objectif** : uploader une fiche de paie (PDF/image) dans l'app, en extraire automatiquement les informations pertinentes (brut, net, cotisations, tickets restaurant, Navigo, etc.), les stocker sur le Drive de l'utilisateur, et en tirer un résumé exploitable dans le reste de l'app (ex: pré-remplir "Pilotage Budgétaire", suivre l'évolution du salaire dans le temps).

### Pourquoi c'est cohérent avec l'architecture actuelle
- Zéro-backend : cohérent avec le principe déjà en place (tout tourne dans le navigateur + Drive de l'utilisateur).
- La clé API (Gemini ou autre) serait saisie dans **Paramètres**, stockée dans le fichier `suivi_epargne.json` sur le Drive de l'utilisateur (comme le `parentsEmail` actuellement) — jamais envoyée à un serveur tiers autre que l'API du fournisseur choisi.

### Décision d'accès Drive (tranchée)
L'utilisateur a déjà ses fiches de paie quelque part sur son Drive. Le scope OAuth actuel
(`drive.file`) ne donne accès **qu'aux fichiers créés par l'app** — impossible de parcourir
un dossier existant par chemin. Deux options existaient : élargir le scope à tout le Drive
(rupture avec le principe de moindre privilège déjà documenté), ou utiliser le **Google
Picker** : une fenêtre native Google où l'utilisateur choisit lui-même le(s) fichier(s), ce
qui donne à l'app un accès scopé à *exactement* ce qui est sélectionné, sans changer de
scope OAuth ni redemander de consentement plus large. **Choix retenu : Google Picker.**

Nécessite une **clé API Google Cloud** distincte du `CLIENT_ID` (identifiant public, pas un
secret, mais à restreindre à l'API Picker et aux origines autorisées).

### Grandes étapes envisagées
1. **Stockage sécurisé des clés API**
   - Deux champs dans `Settings.tsx` / `GlobalAppData.config` : `geminiApiKey` (extraction IA)
     et `pickerApiKey` (Google Picker).
   - Avertissement clair à l'utilisateur : stockées en clair dans son propre Drive (comme le
     reste des données actuellement — cohérent avec le choix déjà fait pour le `CLIENT_ID`).
2. **Sélection de fichier via Google Picker**
   - Nouvel écran/onglet "Fiches de paie".
   - Le fichier sélectionné (PDF ou photo) reste sur le Drive de l'utilisateur, à son
     emplacement d'origine — pas de copie ni de duplication. On ne stocke que sa référence
     (`fileId`), l'accès scopé étant conservé par Google après sélection via Picker.
3. **Extraction des données**
   - Appel à l'API Gemini (multimodal, supporte PDF/image en entrée) avec un prompt structuré demandant un JSON en sortie (brut, net, cotisations, primes, tickets resto, Navigo, période, employeur...).
   - Gérer les erreurs d'extraction (fiche illisible, champs manquants) avec une validation/correction manuelle par l'utilisateur avant sauvegarde.
4. **Stockage & historique**
   - Nouvelle structure de données `payslips: PayslipRecord[]` dans `GlobalAppData`, au même titre que `history`/`expensesHistory`.
   - Un enregistrement par fiche de paie : mois, montants extraits, `fileId` Drive du fichier d'origine (pour le rouvrir depuis Drive, jamais de copie).
5. **Restitution**
   - Résumé/tableau des fiches de paie importées avec évolution du net dans le temps (graphique, à la manière de la courbe d'épargne existante).
   - Pré-remplissage automatique de "Pilotage Budgétaire" (`grossAnnual`, avantages salariaux) à partir de la dernière fiche importée, avec confirmation de l'utilisateur avant d'écraser les valeurs actuelles.

### Points d'attention identifiés dès maintenant
- **Coût** : chaque appel à l'API Gemini a un coût (facturé sur la clé de l'utilisateur) — prévoir un indicateur clair avant chaque extraction ("cette action va utiliser votre clé API").
- **Confidentialité** : les fiches de paie contiennent des données personnelles sensibles (nom, employeur, salaire) — bien documenter que ça reste sur le Drive perso, comme le reste de l'app.
- **Fiabilité de l'extraction** : toujours prévoir une étape de relecture/correction manuelle avant sauvegarde définitive, ne jamais faire confiance aveuglément à l'extraction automatique pour des montants financiers.
- **Taille du fichier `suivi_epargne.json`** : réglé par construction — on ne stocke qu'une référence (`fileId`) vers le fichier Drive déjà existant de l'utilisateur, jamais son contenu.
