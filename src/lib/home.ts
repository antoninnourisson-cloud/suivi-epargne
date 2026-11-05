// Règles de l'Accueil (écran Dashboard), en fonctions pures testées : l'écran ne garde que
// l'état d'affichage et le rendu.
// - votre épargne « à ce jour » (mouvements datés dans le futur neutralisés) ;
// - livrets presque pleins, comptes vides inactifs, dernière actualisation, prélèvements à venir ;
// - courbe d'épargne compte par compte sur une période, projection et dérive du rythme ;
// - jauge « Placé depuis la paie » ;
// - liste « À faire » (buildHomeTodos), sans JSX : textes et actions nommées, que l'écran
//   relie à ses icônes et à ses gestionnaires.
// La disponibilité (« disponible / avec impôt / bloqué ») est celle de lib/finance/availability,
// fondée sur la date anniversaire comme Rendement et le compte à rebours : il n'y a plus de
// calcul de maturité propre à l'Accueil.
//
// Ce fichier ne fait que ré-exporter : le code vit par sujet dans homeAlerts, homeAgenda,
// homeChart, homeGauge, homeAvailability, homeExport et homeTodos.
export * from './homeAlerts';
export * from './homeAgenda';
export * from './homeChart';
export * from './homeGauge';
export * from './homeAvailability';
export * from './homeExport';
export * from './homeTodos';
