// ================================================
// FILE: src/lib/yearlyInterest.ts
// Livret A, LDDS et LEP : intérêts calculés par quinzaine mais ajoutés au solde une seule
// fois par an, au 31 décembre ; ils ne rapportent eux-mêmes qu'à partir de l'année
// suivante. Les autres placements (assurance vie, PEA, crypto…) restent composés chaque mois.
// Règle partagée par les projections mois par mois (simulateur « Et si… », projection selon
// la répartition, plan solo) : à la même date, elles donnent le même solde.
//
// Sources (vérifiées le 2026-10-19) :
// « Au 31 décembre de chaque année, les intérêts cumulés sur l'année s'ajoutent au capital. »
// En cas de clôture en cours d'année, les intérêts du 1er janvier à la clôture sont versés.
// https://www.service-public.gouv.fr/particuliers/vosdroits/F2365 (Livret A)
// https://www.service-public.gouv.fr/particuliers/vosdroits/F2368 (LDDS)
// https://www.service-public.gouv.fr/particuliers/vosdroits/F2367 (LEP)
// ================================================
import { AccountType, SavingsAccount } from '../types';
import { computeAccruedInterest, REGULATED_TYPES } from './finance';

/** Livrets réglementés : intérêts versés au 31 décembre, pas chaque mois. */
export const creditsInterestYearly = (type: AccountType): boolean => REGULATED_TYPES.includes(type);

/**
 * Intérêts des livrets réglementés acquis depuis le 1er janvier jusqu'au 1er du mois de
 * `start` (règle des quinzaines, computeAccruedInterest), pas encore versés : ils le seront
 * au 31 décembre. Le mois de `start` lui-même est compté par la projection.
 */
export const accruedSinceJanuary = (
  accounts: Pick<SavingsAccount, 'id' | 'type' | 'totalAmount' | 'movements' | 'interestRate' | 'rateHistory' | 'openingDate'>[],
  start: Date,
): Map<string, number> => {
  const monthStart = new Date(start.getFullYear(), start.getMonth(), 1);
  return new Map(accounts
    .filter(a => creditsInterestYearly(a.type))
    .map(a => [a.id, Math.max(0, computeAccruedInterest(a, start.getFullYear(), monthStart))]));
};

/** Compte d'une projection : `accrued` = intérêts d'un livret acquis, pas encore versés. */
export interface InterestCarrier { type: AccountType; totalAmount: number; accrued?: number }

/**
 * Un mois d'intérêts au taux mensuel `monthlyRate` sur le solde réel de `a`. Renvoie ce
 * qui s'ajoute au solde ce mois-ci (déjà ajouté à `totalAmount`, à ajouter à la part de
 * l'appelant) : tout de suite pour un placement ordinaire ; pour un livret réglementé,
 * rien avant le mois de décembre (`december`), puis les intérêts de toute l'année.
 */
export const applyMonthlyInterest = (a: InterestCarrier, monthlyRate: number, december: boolean): number => {
  const interest = a.totalAmount * monthlyRate;
  if (!creditsInterestYearly(a.type)) {
    a.totalAmount += interest;
    return interest;
  }
  a.accrued = (a.accrued ?? 0) + interest;
  if (!december) return 0;
  const credited = a.accrued;
  a.accrued = 0;
  a.totalAmount += credited;
  return credited;
};

/** Intérêts de livrets acquis mais pas encore versés (prochain 31 décembre). */
export const pendingInterest = (accounts: InterestCarrier[]): number =>
  accounts.reduce((s, a) => s + (a.accrued ?? 0), 0);
