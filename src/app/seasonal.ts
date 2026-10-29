// Calculs datés de l'Accueil chargés à part (import() dans useDerivedData) : l'agenda, le
// rappel de la déclaration de revenus et la clôture de l'année tirent avec eux lib/taxReturn
// et lib/yearClosing, une cinquantaine de kB qui n'ont rien à faire dans le fichier chargé au
// démarrage (plafond de 500 kB, scripts/check-bundle-size.mjs). Le fichier part dès le
// démarrage, en parallèle, et l'Accueil affiche ces cartes dès qu'il est là.
export { buildAgenda } from '../lib/agenda';
export { buildTaxReturnAlert } from '../lib/taxReturn';
export { yearClosingStatus } from '../lib/yearClosing';
