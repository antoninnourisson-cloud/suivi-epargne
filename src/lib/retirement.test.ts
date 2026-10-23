import { describe, it, expect } from 'vitest';
import { marginalTaxRate, perContributions, computePerAdvantage, PER_CEILING_RULES } from './retirement';
import { applyDecote, computeIncomeTax } from './finance';
import { DEFAULT_FISCAL_CONFIG } from '../constants';
import { AccountMovement, AccountType, SavingsAccount } from '../types';

const CFG = DEFAULT_FISCAL_CONFIG;
const mv = (date: string, amount: number, over: Partial<AccountMovement> = {}): AccountMovement =>
  ({ id: `${date}-${amount}-${over.kind ?? ''}`, date, amount, type: 'IN', label: 'Versement', ...over });
const per = (movements: AccountMovement[]): SavingsAccount => ({
  id: 'per', name: 'PER', type: AccountType.PER, institution: 'B', totalAmount: 5000, ownedAmount: 5000, parentalCapital: 0, movements,
});
const tax = (income: number) => applyDecote(computeIncomeTax(income, CFG.taxBrackets), CFG);

describe('taux marginal', () => {
  it('tranche du dernier euro (barème 2026 : 0 / 11 / 30 / 41 / 45 %)', () => {
    expect(marginalTaxRate(0, CFG.taxBrackets)).toBe(0);
    expect(marginalTaxRate(10_000, CFG.taxBrackets)).toBe(0);
    expect(marginalTaxRate(25_000, CFG.taxBrackets)).toBe(0.11);
    expect(marginalTaxRate(40_000, CFG.taxBrackets)).toBe(0.3);
    expect(marginalTaxRate(500_000, CFG.taxBrackets)).toBe(0.45);
  });
});

describe('versements PER de l’année', () => {
  it('seuls les versements volontaires de l’année comptent', () => {
    const a = per([
      mv('2026-01-10', 1000, { tag: 'initial', label: 'Solde initial' }),
      mv('2026-03-01', 500),
      mv('2026-06-01', 50, { kind: 'valuation' }),
      mv('2026-07-01', 300, { kind: 'parental' }),
      mv('2025-12-31', 400),
      { ...mv('2026-08-01', 100), type: 'OUT' },
      mv('2026-09-01', 700),
    ]);
    expect(perContributions([a], 2026)).toBe(1200);
    expect(perContributions([{ ...a, type: AccountType.PEA }], 2026)).toBe(0);
  });
});

describe('économie d’impôt du PER', () => {
  const accounts = [per([mv('2026-03-01', 2000), mv('2026-09-01', 1000)])];

  it('rien sans PER', () => {
    expect(computePerAdvantage({ accounts: [], year: 2026, fiscalConfig: CFG, taxableIncome: 40_000 })).toBeNull();
  });

  it("plafond de l'avis d'impôt : versements déduits, impôt en moins au taux marginal", () => {
    const r = computePerAdvantage({ accounts, year: 2026, fiscalConfig: CFG, taxableIncome: 40_000, notice: { year: 2026, amount: 5000 } })!;
    expect(r).toMatchObject({ contributions: 3000, ceiling: 5000, ceilingSource: 'notice', deductible: 3000, overCeiling: 0, room: 2000, marginalRate: 0.3 });
    expect(r.saving).toBeCloseTo(tax(40_000) - tax(37_000), 2);
    expect(r.saving).toBeCloseTo(900, 2);
    expect(r.savingPer100).toBeCloseTo(30, 2);
  });

  it('au-delà du plafond : rien de plus n’est déduit', () => {
    const r = computePerAdvantage({ accounts, year: 2026, fiscalConfig: CFG, taxableIncome: 40_000, notice: { year: 2026, amount: 2500 } })!;
    expect(r).toMatchObject({ deductible: 2500, overCeiling: 500, room: 0 });
    expect(r.savingPer100).toBeUndefined();
  });

  it('sans avis : plafond estimé (10 % des revenus, entre 4 710 € et 37 680 € en 2026)', () => {
    expect(PER_CEILING_RULES[2026]).toEqual({ floor: 4710, cap: 37680 });
    expect(computePerAdvantage({ accounts, year: 2026, fiscalConfig: CFG, taxableIncome: 30_000 })).toMatchObject({ ceiling: 4710, ceilingSource: 'estimate' });
    expect(computePerAdvantage({ accounts, year: 2026, fiscalConfig: CFG, taxableIncome: 60_000 })).toMatchObject({ ceiling: 6000, ceilingSource: 'estimate' });
    expect(computePerAdvantage({ accounts, year: 2026, fiscalConfig: CFG, taxableIncome: 900_000 })).toMatchObject({ ceiling: 37680 });
    // Revenu inconnu : le minimum légal, et pas d'économie chiffrée.
    const r = computePerAdvantage({ accounts, year: 2026, fiscalConfig: CFG })!;
    expect(r).toMatchObject({ ceiling: 4710, ceilingSource: 'estimate', deductible: 3000 });
    expect(r.saving).toBeUndefined();
    expect(r.marginalRate).toBeUndefined();
  });

  it("autre année sans avis : plafond inconnu (demandé), avis d'une autre année ignoré", () => {
    const r = computePerAdvantage({ accounts: [per([mv('2027-03-01', 1000)])], year: 2027, fiscalConfig: CFG, taxableIncome: 40_000, notice: { year: 2026, amount: 5000 } })!;
    expect(r).toMatchObject({ ceilingSource: 'unknown', ceiling: undefined, deductible: 1000, room: undefined });
    expect(r.saving).toBeCloseTo(tax(40_000) - tax(39_000), 2);
  });

  it('revenu sous la première tranche : aucune économie', () => {
    const r = computePerAdvantage({ accounts, year: 2026, fiscalConfig: CFG, taxableIncome: 9_000, notice: { year: 2026, amount: 5000 } })!;
    expect(r.saving).toBe(0);
    expect(r.marginalRate).toBe(0);
  });
});
