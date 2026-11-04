// Rituel « Les taux ont changé » (phase 8, rituel 3) : les taux des livrets réglementés
// proposés par la veille fiscale (lib/fiscalWatch, clés `rate.*`) passent par une feuille à
// part (tâche de l'Accueil), et non plus par la carte générique des propositions. La même
// feuille corrige aussi le taux des autres comptes (livrets bancaires, assurance vie).
// Module léger, sans dépendance au moteur de la veille (chargé à part).
import { AccountType, type SavingsAccount } from '../types';

/** Taux réglementé relevé par la veille, pour un groupe de livrets (Livret A et LDDS, LEP). */
export interface RateProposalInfo {
  /** Clé du groupe (REGULATED_RATE_GROUPS) : `livretA` ou `lep`. */
  group: string;
  /** « Livret A et LDDS », « LEP ». */
  groupLabel: string;
  /** Taux actuel du premier compte du groupe, en %. */
  current: number;
  /** Nouveau taux relevé, en %. */
  value: number;
  /** Date d'effet (AAAA-MM-JJ). */
  effectiveDate: string;
  source?: string;
}

/** Proposition de taux d'un livret réglementé : elle passe par le rituel. */
export const isRateProposal = (p: { key: string }): boolean => p.key.startsWith('rate.');

/** Propositions de taux (le rituel) et les autres (la carte de la veille). */
export const splitFiscalProposals = <P extends { key: string }>(proposals: readonly P[]): { rates: P[]; others: P[] } => ({
  rates: proposals.filter(isRateProposal),
  others: proposals.filter(p => !isRateProposal(p)),
});

/** Comptes dont la banque ou l'assureur fixe le taux : corrigés à la main dans la feuille. */
export const OTHER_RATE_TYPES: readonly AccountType[] = [AccountType.LIVRET_BANCAIRE, AccountType.ASSURANCE_VIE];
export const otherRateAccounts = (accounts: readonly SavingsAccount[]): SavingsAccount[] =>
  accounts.filter(a => OTHER_RATE_TYPES.includes(a.type));
