# Roadmap

Idées de fonctionnalités futures, non planifiées ni committées à un calendrier.

## Analyse de fiches de paie par IA — ✅ livré

**Objectif** : uploader une fiche de paie (PDF/image) dans l'app, en extraire automatiquement les informations pertinentes (brut, net, cotisations, tickets restaurant, Navigo, etc.), les stocker sur le Drive de l'utilisateur, et en tirer un résumé exploitable dans le reste de l'app (ex: pré-remplir "Pilotage Budgétaire", suivre l'évolution du salaire dans le temps).

Implémenté et validé en conditions réelles (import, extraction, relecture, pré-remplissage du Pilotage, graphique d'évolution). Voir `src/components/Payslips.tsx`, `src/services/geminiService.ts`, et les fonctions Picker de `src/services/googleDriveService.ts`.

### Pourquoi c'est cohérent avec l'architecture actuelle
- Zéro-backend : cohérent avec le principe déjà en place (tout tourne dans le navigateur + Drive de l'utilisateur).
- Les clés API (Gemini, Picker) sont saisies dans **Paramètres**, stockées dans le fichier `suivi_epargne.json` sur le Drive de l'utilisateur (comme le `parentsEmail`) — jamais envoyées à un serveur tiers autre que l'API du fournisseur concerné.

### Décision d'accès Drive
Le scope OAuth (`drive.file`) ne donne accès qu'aux fichiers créés par l'app — impossible de parcourir un dossier existant par chemin. Choix retenu : **Google Picker**, fenêtre native où l'utilisateur choisit lui-même le fichier, donnant un accès scopé à *exactement* ce qui est sélectionné, sans élargir le scope OAuth.

Point d'intégration non documenté ailleurs, découvert en testant en conditions réelles : avec `drive.file`, le Picker doit recevoir `.setAppId()` (le préfixe numérique du `CLIENT_ID`) — sans ça, le fichier choisi semble sélectionnable mais l'accès n'est en réalité jamais accordé (404 silencieux à la lecture).

### Étapes livrées
1. **Clés API** : deux champs dans Paramètres (`geminiApiKey`, `pickerApiKey`), stockés en clair sur le Drive de l'utilisateur, avec avertissement explicite.
2. **Sélection via Google Picker** : le fichier reste à son emplacement d'origine sur Drive, seule sa référence (`fileId`) est stockée.
3. **Extraction Gemini** : sortie structurée contrainte par schéma, aucun champ requis (extraction partielle acceptée). Modèle isolé en constante (`geminiService.ts`) — Gemini déprécie ses modèles régulièrement et indique lui-même le remplaçant dans son message d'erreur.
4. **Relecture obligatoire** avant tout enregistrement — jamais de confiance aveugle sur des montants extraits par IA.
5. **Restitution** : tableau historique, graphique "Évolution du net" (dès 2 fiches), et bouton "Utiliser pour mon Pilotage Budgétaire" (brut mensuel × 12, avec confirmation affichant l'ancienne et la nouvelle valeur avant écrasement).

### Points d'attention retenus
- **Coût** : chaque extraction est une action explicite (bouton dédié), jamais automatique — consomme le quota Gemini de l'utilisateur.
- **Confidentialité** : fiches de paie et clés API restent uniquement sur le Drive personnel de l'utilisateur.
- **Fiabilité** : écran de relecture systématique avant sauvegarde.
- **Taille du fichier de données** : non-problème par construction — seule la référence (`fileId`) est stockée, jamais le contenu du PDF.

### Bug transverse découvert et corrigé à cette occasion
En ajoutant ces nouveaux champs, un vrai risque de perte de données silencieuse est apparu : un onglet PWA resté ouvert avec une version antérieure du code (avant l'ajout des champs) pouvait, lors de sa sauvegarde automatique normale, réécrire le fichier Drive partagé en omettant les champs qu'il ne connaissait pas. Corrigé structurellement : l'app force un rechargement dès qu'un nouveau service worker prend le contrôle de la page (`src/index.tsx`), empêchant qu'un onglet tourne durablement avec un schéma de données obsolète.

## Idées non démarrées

- Pré-remplissage des avantages salariaux (Navigo, tickets restaurant, mutuelle) à partir d'une fiche de paie — laissé de côté car le modèle `WorkBenefits` attend des paramètres (taux, prix de base) que la fiche de paie ne donne pas directement sous cette forme (elle donne des montants déjà calculés, pas les taux d'entrée).
