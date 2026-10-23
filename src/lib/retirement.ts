// ================================================
// FILE: src/lib/retirement.ts
// Avantage fiscal du PER : vos versements volontaires de l'année sont déduits de votre revenu
// imposable, dans la limite du « plafond épargne retraite » imprimé sur l'avis d'impôt.
// L'économie d'impôt dépend de votre tranche (taux marginal). Fonctions pures, testées.
// ================================================
import { FiscalConfig, SavingsAccount, AccountType, TaxBracket } from '../types';
import { applyDecote, computeIncomeTax, isInitialBalance } from './finance';
import { round2 } from './money';

/**
 * Plafond de déduction d'un salarié quand l'avis d'impôt n'est pas saisi, par année de
 * versement : 10 % des revenus d'activité de l'année précédente (nets de frais
 * professionnels), au moins `floor`, au plus `cap`, hors reports des années passées.
 * Versements 2026 : 4 710 € à 37 680 €. Vérifié le 2026-10-21 :
 * https://www.service-public.gouv.fr/particuliers/vosdroits/F14709
 * Une autre année n'est pas estimée : le plafond de l'avis est alors demandé.
 */
export const PER_CEILING_RULES: Record<number, { floor: number; cap: number }> = {
  2026: { floor: 4710, cap: 37680 },
};
const PER_CEILING_RATE = 0.1;

/** Taux de la tranche où tombe le dernier euro de revenu imposable (une part), en fraction. */
export const marginalTaxRate = (taxableIncome: number, brackets: TaxBracket[]): number => {
  if (!(taxableIncome > 0)) return 0;
  const sorted = brackets
    .map(b => ({ limit: b.limit === null || b.limit === undefined ? Infinity : b.limit, rate: b.rate }))
    .sort((a, b) => (a.limit === b.limit ? 0 : a.limit - b.limit));
  for (const b of sorted) if (taxableIncome <= b.limit) return b.rate;
  return sorted.length > 0 ? sorted[sorted.length - 1].rate : 0;
};

/** Versements volontaires de l'année sur vos PER (hors solde initial, valorisation, part des parents et corrections). */
export const perContributions = (accounts: SavingsAccount[], year: number): number => round2(accounts
  .filter(a => a.type === AccountType.PER)
  .reduce((s, a) => s + (a.movements || [])
    .filter(m => m.type === 'IN' && !m.kind && !isInitialBalance(m) && m.date.startsWith(`${year}-`))
    .reduce((t, m) => t + m.amount, 0), 0));

export interface PerAdvantage {
  year: number;
  /** Versements notés cette année. */
  contributions: number;
  /** Plafond de déduction : celui de l'avis, une estimation, ou inconnu. */
  ceiling?: number;
  ceilingSource: 'notice' | 'estimate' | 'unknown';
  /** Part des versements déduite du revenu. */
  deductible: number;
  /** Versements au-delà du plafond (non déduits). */
  overCeiling: number;
  /** Place restante sous le plafond. */
  room?: number;
  /** Taux marginal d'imposition (fraction), si le revenu est connu. */
  marginalRate?: number;
  /** Impôt en moins grâce à la déduction (décote comprise), si le revenu est connu. */
  saving?: number;
  /** Impôt en moins pour 100 € de plus versés (dans la limite du plafond). */
  savingPer100?: number;
}

/**
 * Économie d'impôt des versements PER de `year` : impôt sur le revenu imposable, moins impôt
 * sur ce revenu diminué des versements déductibles (barème d'une part, décote comprise).
 * `taxableIncome` : revenu imposable estimé de l'année (salaires après l'abattement de 10 %).
 * `notice` : plafond lu sur l'avis d'impôt, valable pour les versements de `notice.year`.
 * `null` sans PER.
 */
export const computePerAdvantage = (input: {
  accounts: SavingsAccount[];
  year: number;
  fiscalConfig: Pick<FiscalConfig, 'taxBrackets' | 'decote'>;
  taxableIncome?: number;
  notice?: { year: number; amount: number };
}): PerAdvantage | null => {
  const { accounts, year, fiscalConfig, taxableIncome, notice } = input;
  if (!accounts.some(a => a.type === AccountType.PER)) return null;
  const contributions = perContributions(accounts, year);
  const income = taxableIncome !== undefined && taxableIncome > 0 ? taxableIncome : undefined;
  const rule = PER_CEILING_RULES[year];
  let ceiling: number | undefined;
  let ceilingSource: PerAdvantage['ceilingSource'] = 'unknown';
  if (notice && notice.year === year && notice.amount >= 0) { ceiling = notice.amount; ceilingSource = 'notice'; }
  else if (rule && income !== undefined) { ceiling = round2(Math.min(rule.cap, Math.max(rule.floor, income * PER_CEILING_RATE))); ceilingSource = 'estimate'; }
  else if (rule) { ceiling = rule.floor; ceilingSource = 'estimate'; }
  const deductible = ceiling !== undefined ? Math.min(contributions, ceiling) : contributions;
  const out: PerAdvantage = {
    year, contributions, ceiling, ceilingSource,
    deductible: round2(deductible),
    overCeiling: ceiling !== undefined ? round2(Math.max(0, contributions - ceiling)) : 0,
    room: ceiling !== undefined ? round2(Math.max(0, ceiling - contributions)) : undefined,
  };
  if (income === undefined) return out;
  const tax = (base: number) => applyDecote(computeIncomeTax(base, fiscalConfig.taxBrackets), fiscalConfig);
  const before = tax(income);
  out.marginalRate = marginalTaxRate(income - deductible, fiscalConfig.taxBrackets);
  out.saving = round2(Math.max(0, before - tax(income - deductible)));
  if (out.room === undefined || out.room > 0) {
    const more = Math.min(100, out.room ?? 100);
    out.savingPer100 = round2(Math.max(0, tax(income - deductible) - tax(income - deductible - more)) * (100 / more));
  }
  return out;
};
