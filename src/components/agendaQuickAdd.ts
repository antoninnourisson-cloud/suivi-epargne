// Agenda et ajout rapide chargés ensemble, en un fichier à part chargé à la première ouverture.
// Créé quand Rollup fusionnait les fichiers de moins de 8 Ko dans le code de démarrage
// (experimentalMinChunkSize) ; Rolldown (Vite 8) ne fusionne plus, mais un seul fichier
// pour les deux reste une requête de moins (vite.config.ts).
export { Agenda } from './Agenda';
export { QuickAddModal } from './QuickAddModal';
