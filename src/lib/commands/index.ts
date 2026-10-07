// Commandes métier qui changent les soldes : point d'entrée unique pour l'interface.
// Chaque commande est pure, testée, et applique elle-même les règles (part des parents
// intouchable, total = part propre + part des parents, annulation exacte) quel que soit
// l'écran qui l'appelle. Voir MAINTENANCE.md §1.
export * from './types';
export * from './quickAdd';
export * from './movements';
export * from './restitution';
export * from './accounts';
