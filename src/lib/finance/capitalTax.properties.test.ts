// Propriétés des impôts sur l'épargne (fast-check) :
// - la décomposition des intérêts bruts tombe juste : prélèvements sociaux + impôt + net = brut,
//   rien de négatif, jamais NaN ni infini ;
// - doubler les intérêts double chaque part (le calcul est proportionnel) ;
// - un retrait ne coûte jamais plus que ce qu'il contient de gains, et jamais plus que son montant ;
// - sans gains (versements au moins égaux à la valeur), un retrait ne coûte rien ;
// - les versements restants après un retrait restent entre 0 et les versements d'avant.
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { AccountType } from '../../types';
import { DEFAULT_FISCAL_CONFIG } from '../../constants';
import { computeCapitalGainsTax, computeWithdrawalTax, depositsAfterWithdrawal } from './capitalTax';

const RUNS = { numRuns: 150 };
const ASOF = new Date(2026, 10, 5);
const EPS = 1e-6;

const cents = (max: number) => fc.integer({ min: 0, max: max * 100 }).map(c => c / 100);
const anyType = fc.constantFrom(...Object.values(AccountType));
const openingDate = fc.option(
  fc.integer({ min: 0, max: 9500 }).map(n => {
    const d = new Date(2000, 0, 1 + n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }),
  { nil: undefined },
);
const euroFundPct = fc.option(fc.integer({ min: 0, max: 100 }), { nil: undefined });

describe('impôt sur les intérêts : propriétés', () => {
  const taxed = fc.record({ type: anyType, openingDate, euroFundPct });

  it('prélèvements sociaux + impôt + net = brut, rien de négatif', () => {
    fc.assert(fc.property(taxed, cents(100_000), (acc, gross) => {
      const t = computeCapitalGainsTax(acc, gross, DEFAULT_FISCAL_CONFIG, ASOF);
      for (const v of [t.socialCharges, t.incomeTax, t.netInterest]) {
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(-EPS);
      }
      expect(t.socialCharges + t.incomeTax + t.netInterest).toBeCloseTo(gross, 6);
      expect(t.netInterest).toBeLessThanOrEqual(gross + EPS);
    }), RUNS);
  });

  it('doubler les intérêts double chaque part', () => {
    fc.assert(fc.property(taxed, cents(50_000), (acc, gross) => {
      const one = computeCapitalGainsTax(acc, gross, DEFAULT_FISCAL_CONFIG, ASOF);
      const two = computeCapitalGainsTax(acc, gross * 2, DEFAULT_FISCAL_CONFIG, ASOF);
      expect(two.regime).toBe(one.regime);
      expect(two.netInterest).toBeCloseTo(one.netInterest * 2, 6);
      expect(two.socialCharges).toBeCloseTo(one.socialCharges * 2, 6);
      expect(two.incomeTax).toBeCloseTo(one.incomeTax * 2, 6);
    }), RUNS);
  });
});

describe('impôt sur un retrait : propriétés', () => {
  const withdrawal = fc.record({
    type: anyType,
    openingDate,
    euroFundPct,
    totalAmount: cents(300_000),
    deposits: fc.option(fc.integer({ min: 0, max: 200 }).map(p => p / 100), { nil: undefined }), // versements = part de la valeur
    amountShare: fc.integer({ min: 0, max: 150 }).map(p => p / 100),                              // retrait = part de la valeur
    cryptoBefore: fc.option(cents(1000), { nil: undefined }),
  }).map(r => ({
    account: { type: r.type, openingDate: r.openingDate, euroFundPct: r.euroFundPct, totalAmount: r.totalAmount, totalDeposits: r.deposits === undefined ? undefined : Math.round(r.totalAmount * r.deposits * 100) / 100 },
    amount: Math.round(r.totalAmount * r.amountShare * 100) / 100,
    cryptoBefore: r.cryptoBefore,
  }));

  it('jamais NaN ni négatif, le net reste entre 0 et le montant retiré', () => {
    fc.assert(fc.property(withdrawal, ({ account, amount, cryptoBefore }) => {
      const w = computeWithdrawalTax(account, amount, DEFAULT_FISCAL_CONFIG, ASOF, { cryptoDisposalsThisYear: cryptoBefore });
      for (const v of [w.gainPart, w.taxableGain, w.socialCharges, w.incomeTax, w.net]) expect(Number.isFinite(v)).toBe(true);
      expect(w.socialCharges).toBeGreaterThanOrEqual(-EPS);
      expect(w.incomeTax).toBeGreaterThanOrEqual(-EPS);
      expect(w.gainPart).toBeLessThanOrEqual(amount + EPS);
      expect(w.net).toBeLessThanOrEqual(amount + EPS);
      expect(w.net).toBeGreaterThanOrEqual(-EPS);
    }), RUNS);
  });

  it('sans gains (versements au moins égaux à la valeur), un retrait ne coûte rien', () => {
    fc.assert(fc.property(withdrawal, ({ account, amount }) => {
      if (account.totalDeposits === undefined) return;
      const noGain = { ...account, totalDeposits: Math.max(account.totalDeposits, account.totalAmount) };
      const w = computeWithdrawalTax(noGain, amount, DEFAULT_FISCAL_CONFIG, ASOF);
      expect(w.socialCharges).toBeCloseTo(0, 6);
      expect(w.incomeTax).toBeCloseTo(0, 6);
    }), RUNS);
  });

  it('les versements restants après un retrait restent entre 0 et les versements d\'avant', () => {
    fc.assert(fc.property(cents(300_000), cents(300_000), cents(400_000), (deposits, value, amount) => {
      const left = depositsAfterWithdrawal(deposits, value, amount);
      expect(Number.isFinite(left)).toBe(true);
      expect(left).toBeGreaterThanOrEqual(0);
      expect(left).toBeLessThanOrEqual(deposits + EPS);
      expect(depositsAfterWithdrawal(deposits, value, 0)).toBe(deposits);
    }), RUNS);
  });
});
