// Calculs financiers de l'app (fonctions pures, testées). Découpés par thème dans
// src/lib/finance/ ; ce fichier réexporte tout pour que les imports existants restent valables.
export * from './finance/income';
export * from './finance/capitalTax';
export * from './finance/interest';
export * from './finance/savings';
export * from './finance/placement';
export * from './finance/subscriptions';
export * from './finance/payPlan';
export * from './finance/donations';
export * from './finance/fiscalParams';
export * from './finance/restitution';
