// ================================================
// FILE: src/lib/yearEndTax.ts
// « Avant le 31 décembre » : de mi-novembre à la fin de l'année, ce que valent encore pour
// l'impôt de l'année un versement sur un PER et un don. Rien n'est recalculé ici : on réutilise
// le plafond PER (retirement.ts), le barème et la décote (finance/income.ts) et la réduction
// pour dons (finance/donations.ts). Fonctions pures, testées.
// ================================================
import type { Donation, FiscalConfig, SavingsAccount } from '../types';
import { applyDecote, computeDonationSummary, computeIncomeTax } from './finance';
import { computePerAdvantage } from './retirement';
import { round2 } from './money';

/** Versement PER d'exemple (réduit si le plafond restant est plus petit). */
export const YEAR_END_PER_EXAMPLE = 1000;
/** Don d'exemple, au taux de 66 % (le cas courant). */
export const YEAR_END_DONATION_EXAMPLE = 100;

/** Du 15 novembre au 31 décembre inclus. */
export const isYearEndTaxSeason = (now: Date): boolean =>
  now.getMonth() === 11 || (now.getMonth() === 10 && now.getDate() >= 15);

/** À partir du 15 décembre : le dernier rappel (le « Plus tard » d'avant ne le masque plus). */
export const isYearEndFinalReminder = (now: Date): boolean => now.getMonth() === 11 && now.getDate() >= 15;

export interface YearEndTaxFigures {
  year: number;
  /** Versement PER d'exemple et l'impôt qu'il ferait économiser ; absent sans PER, sans plafond restant ou sans revenu. */
  per?: { amount: number; saving: number };
  /**
   * Dons de l'année : réduction déjà acquise, don d'exemple et réduction en plus qu'il donnerait
   * (0 si le plafond de 20 % du revenu ou l'impôt dû est déjà atteint). Absent sans revenu connu.
   */
  donations?: { acquired: number; example: number; extra: number };
}

export interface YearEndTaxInput {
  accounts: SavingsAccount[];
  donations: Donation[];
  year: number;
  fiscalConfig: Pick<FiscalConfig, 'taxBrackets' | 'decote'>;
  /** Revenu imposable estimé de l'année (salaires après l'abattement de 10 %) ; absent : aucun chiffre. */
  taxableIncome?: number;
  /** Impôt annuel estimé (après décote) : la réduction des dons ne le dépasse pas. */
  taxDue?: number;
  /** Plafond PER lu sur l'avis d'impôt (valable pour les versements de `notice.year`). */
  notice?: { year: number; amount: number };
  /** Plafond des dons à 75 % réglé dans les paramètres fiscaux. */
  ceiling75?: number;
}

/**
 * Chiffres de l'année pour la tâche « Avant le 31 décembre ». Sans revenu imposable connu, rien
 * n'est chiffré (l'objet ne contient que l'année) et la tâche reste générale.
 */
export const computeYearEndTax = (input: YearEndTaxInput): YearEndTaxFigures => {
  const { accounts, donations, year, fiscalConfig, taxableIncome, taxDue, notice, ceiling75 } = input;
  const out: YearEndTaxFigures = { year };
  if (!(taxableIncome !== undefined && taxableIncome > 0)) return out;

  // PER : impôt sans le versement d'exemple moins impôt avec le revenu diminué du versement.
  // Les versements déjà faits cette année sont d'abord déduits, comme dans computePerAdvantage.
  const advantage = computePerAdvantage({ accounts, year, fiscalConfig, taxableIncome, notice });
  if (advantage && advantage.room !== undefined && advantage.room > 0) {
    const amount = Math.min(YEAR_END_PER_EXAMPLE, advantage.room);
    const tax = (base: number) => applyDecote(computeIncomeTax(base, fiscalConfig.taxBrackets), fiscalConfig);
    const base = taxableIncome - advantage.deductible;
    const saving = round2(Math.max(0, tax(base) - tax(base - amount)));
    out.per = { amount, saving };
  }

  // Dons : réduction acquise, puis ce qu'un don d'exemple ajouterait (plafonds de la fonction existante).
  const opts = { taxableIncome, taxDue, ceiling75 };
  const acquired = computeDonationSummary(donations, year, opts).reduction;
  const example: Donation = {
    id: 'year-end-example', date: `${year}-12-31`, amount: YEAR_END_DONATION_EXAMPLE,
    organization: '', rate: 66, receiptReceived: false,
  };
  const withExample = computeDonationSummary([...donations, example], year, opts).reduction;
  out.donations = {
    acquired: round2(acquired),
    example: YEAR_END_DONATION_EXAMPLE,
    extra: round2(Math.max(0, withExample - acquired)),
  };
  return out;
};
