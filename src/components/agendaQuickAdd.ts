// Agenda et ajout rapide chargés ensemble : chacun seul pèse moins que le seuil de fusion des
// petits fichiers (vite.config.ts, experimentalMinChunkSize) et rejoindrait le code de
// démarrage ; réunis, ils forment un fichier à part, chargé à la première ouverture.
export { Agenda } from './Agenda';
export { QuickAddModal } from './QuickAddModal';
