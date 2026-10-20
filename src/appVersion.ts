// Version de l'app affichée au démarrage (écran de connexion, barre latérale, « Quoi de neuf »).
// Le module virtuel (vite.config.ts) la contient en clair au build : l'historique complet
// (src/changelog.ts) n'est chargé qu'avec « Quoi de neuf » et « À propos ».
export { APP_VERSION } from 'virtual:app-version';
