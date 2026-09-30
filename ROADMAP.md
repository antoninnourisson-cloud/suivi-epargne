# Roadmap

## Livré

- **Fiches de paie par IA** : import via Google Picker, extraction Gemini (sortie structurée, nouvelles tentatives et modèles de repli en cas de saturation), relecture obligatoire, graphique du net, mode « chiffres exacts » dans le Pilotage.
- **Verrou de l'appareil** : biométrie (WebAuthn) ou PIN (PBKDF2), réactivé à chaque passage en arrière-plan, avec une porte de sortie en cas de code oublié.
- **Fiscalité du capital** : net des gains en cas de retrait (PFU, exonérations après maturité), compte à rebours de maturité par compte.
- **Intérêts réellement acquis** (règle des quinzaines) pour les gains nets si retrait et le rappel parental.
- **Projection et dérive du rythme d'épargne** ; rythme réel confronté à la théorie dans Objectifs.
- **Alertes** : révision des taux réglementés, éligibilité LEP, intérêts parentaux de décembre.
- **Mouvements récurrents** proposés à l'échéance, et **ajustement « + / − x € »** dans Actualiser solde.
- **Serveur Cloudflare** : session Google persistante et notifications push, dont le rappel du jour de paie avec le plan de placement.
- **Versements cumulés** (PEA, AV…) : plus-values latentes, impôt exact d'un retrait, plafond PEA ; « Placé ce mois-ci » ; meilleur compte à ponctionner ; abonnements avec rappels.

## Pistes non démarrées

- **Préférences de notification par type** (couper par exemple le rappel « soldes non actualisés » en gardant les échéances). Aujourd'hui, c'est tout ou rien par appareil.
- **Déploiement automatique du Worker** depuis GitHub Actions. Il faut ajouter un jeton d'API Cloudflare aux secrets du dépôt ; aujourd'hui, `npm run deploy` se lance à la main.
- **Pré-remplissage des avantages salariaux depuis une fiche de paie**. Mis de côté : `WorkBenefits` attend des taux et des prix de base, alors que la fiche ne donne que des montants déjà calculés.

## Notes techniques à ne pas perdre

- **Google Picker avec `drive.file`** : le Picker doit recevoir `.setAppId()` (le préfixe numérique du `CLIENT_ID`). Sans ça, le fichier semble sélectionnable, mais l'accès n'est jamais accordé : la lecture renvoie un 404 silencieux.
- **Modèles Gemini** : Google les déprécie régulièrement. Le modèle principal et les modèles de repli sont des constantes en tête de `src/services/geminiService.ts`. Un modèle retiré (404) est sauté automatiquement.
- **Onglets PWA restés ouverts** : un onglet qui exécute une ancienne version peut effacer des champs récents du fichier Drive. L'app se recharge donc dès qu'un nouveau service worker prend le contrôle de la page (`src/index.tsx`).
- **Session du serveur** : l'écran de consentement OAuth doit rester « En production ». En mode test, Google fait expirer les refresh tokens au bout de 7 jours.
- **Déconnexion en mode serveur** : ne jamais révoquer le jeton Google côté navigateur. La révocation annule tout l'accord, refresh token du serveur compris, et déconnecterait tous les appareils.
