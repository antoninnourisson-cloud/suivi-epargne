import { describe, it, expect } from 'vitest';
import {
  computeWithdrawalTax,
  depositsAfterWithdrawal,
  computeMonthSavedAmount,
  nextSubscriptionDate,
  findDueSubscriptions,
  subscriptionMonthlyCost,
  subscriptionsAsExpenses,
  totalFixedCharges,
  computeSavingsRateHistory,
  computeDonationSummary,
  accountAgeYears,
  computeUnlockCost,
  findFiscalReview,
  applyTaxScale,
} from './finance';
import { DEFAULT_FISCAL_CONFIG as CFG, TAX_SCALES, LATEST_TAX_SCALE } from '../constants';
import { AccountType, SavingsAccount, Subscription } from '../types';
import { formatISODay } from './dates';

const acc = (over: Partial<SavingsAccount>): SavingsAccount => ({
  id: over.name || 'x', name: 'x', type: AccountType.LIVRET_A, institution: 'B',
  totalAmount: 10000, ownedAmount: 10000, parentalCapital: 0, movements: [], ...over,
});
const NOW = new Date(2026, 8, 30, 9); // 30 septembre 2026

describe('computeWithdrawalTax', () => {
  it("n'impose que la part de gains contenue dans le retrait", () => {
    // PEA de 10 ans : 10 000 € dont 4 000 € de gains → 1 000 € retirés contiennent 400 € de gains.
    const t = computeWithdrawalTax(acc({ type: AccountType.PEA, openingDate: '2016-01-01', totalDeposits: 6000 }), 1000, CFG, NOW);
    expect(t.known).toBe(true);
    expect(t.gainPart).toBeCloseTo(400);
    expect(t.incomeTax).toBe(0);
    expect(t.socialCharges).toBeCloseTo(400 * 0.172);
    expect(t.closesPea).toBe(false);
  });

  it('signale la clôture d’un PEA de moins de 5 ans et applique le PFU', () => {
    const t = computeWithdrawalTax(acc({ type: AccountType.PEA, openingDate: '2024-01-01', totalDeposits: 6000 }), 1000, CFG, NOW);
    expect(t.closesPea).toBe(true);
    expect(t.incomeTax).toBeCloseTo(400 * 0.128);
  });

  it('Assurance Vie de plus de 8 ans : abattement de 4 600 € avant le taux réduit', () => {
    const av = acc({ type: AccountType.ASSURANCE_VIE, openingDate: '2010-01-01', totalAmount: 100000, ownedAmount: 100000, totalDeposits: 50000 });
    expect(computeWithdrawalTax(av, 5000, CFG, NOW).incomeTax).toBe(0); // 2 500 € de gains < abattement
    expect(computeWithdrawalTax(av, 20000, CFG, NOW).incomeTax).toBeCloseTo((10000 - 4600) * 0.075);
  });

  it('reste « inconnu » sans versements cumulés', () => {
    expect(computeWithdrawalTax(acc({ type: AccountType.PEA }), 1000, CFG, NOW).known).toBe(false);
  });

  it('un retrait emporte les versements au prorata', () => {
    expect(depositsAfterWithdrawal(6000, 10000, 1000)).toBeCloseTo(5400);
    expect(depositsAfterWithdrawal(6000, 10000, 20000)).toBe(0);
  });
});

describe('computeMonthSavedAmount', () => {
  it('compte versements − retraits du mois, hors valorisation et hors compte courant', () => {
    const accounts = [
      acc({ movements: [
        { id: '1', date: '2026-09-05', amount: 300, label: 'x', type: 'IN' },
        { id: '2', date: '2026-09-20', amount: 50, label: 'x', type: 'OUT' },
        { id: '3', date: '2026-08-31', amount: 999, label: 'x', type: 'IN' },
      ] }),
      acc({ type: AccountType.PEA, movements: [
        { id: '4', date: '2026-09-10', amount: 200, label: 'Versement', type: 'IN' },
        { id: '5', date: '2026-09-10', amount: 80, label: 'Valorisation', type: 'IN', kind: 'valuation' },
      ] }),
      acc({ type: AccountType.COMPTE_COURANT, movements: [{ id: '6', date: '2026-09-02', amount: 2000, label: 'Salaire', type: 'IN' }] }),
    ];
    expect(computeMonthSavedAmount(accounts, NOW)).toBe(450);
  });
});

describe('abonnements', () => {
  const sub = (over: Partial<Subscription>): Subscription => ({
    id: 's', name: 'Netflix', amount: 13.49, debitAccount: 'BP', frequency: 'monthly', anchorDate: '2026-01-31', active: true, ...over,
  });

  it('ramène le 31 au dernier jour sans dériver', () => {
    expect(formatISODay(nextSubscriptionDate(sub({}), new Date(2026, 1, 10)))).toBe('2026-02-28');
    expect(formatISODay(nextSubscriptionDate(sub({}), new Date(2026, 2, 1)))).toBe('2026-03-31');
  });

  it('gère annuel, trimestriel et hebdomadaire', () => {
    expect(formatISODay(nextSubscriptionDate(sub({ frequency: 'yearly', anchorDate: '2024-03-15' }), NOW))).toBe('2027-03-15');
    expect(formatISODay(nextSubscriptionDate(sub({ frequency: 'quarterly', anchorDate: '2026-01-10' }), NOW))).toBe('2026-10-10');
    expect(formatISODay(nextSubscriptionDate(sub({ frequency: 'weekly', anchorDate: '2026-09-01' }), NOW))).toBe('2026-10-06');
  });

  it('prévient la veille sous 100 €, une semaine avant au-delà', () => {
    const small = sub({ anchorDate: '2026-10-05' });
    const big = sub({ id: 'b', amount: 120, anchorDate: '2026-10-05' });
    const ids = (d: Date) => findDueSubscriptions([small, big], d).map(x => x.subscription.id);
    expect(ids(new Date(2026, 8, 27))).toEqual([]);
    expect(ids(new Date(2026, 8, 28))).toEqual(['b']);
    expect(ids(new Date(2026, 9, 4))).toEqual(['s', 'b']);
    expect(ids(new Date(2026, 9, 5))).toEqual([]); // le jour même : trop tard
  });

  it('ignore les abonnements désactivés et calcule le coût mensuel', () => {
    expect(findDueSubscriptions([sub({ active: false, anchorDate: '2026-10-01' })], NOW)).toEqual([]);
    expect(subscriptionMonthlyCost({ amount: 120, frequency: 'yearly' })).toBe(10);
  });

  it('ajoute les seuls abonnements mensuels actifs aux charges fixes', () => {
    const subs = [
      sub({ id: 'n', amount: 13.49 }),
      sub({ id: 'a', name: 'Assurance', amount: 120, frequency: 'yearly' }),
      sub({ id: 'p', name: 'En pause', amount: 50, active: false }),
    ];
    // L'annuel ne pèse pas sur les charges mensuelles : il ne fait que déclencher un rappel.
    expect(subscriptionsAsExpenses(subs).map(e => e.id)).toEqual(['sub:n']);
    expect(totalFixedCharges([{ id: 'loyer', name: 'Loyer', amount: 800 }], subs)).toBeCloseTo(800 + 13.49);
  });
});

describe("taux d'épargne", () => {
  it('rapporte les versements de chaque mois à la paie, mois en cours inclus', () => {
    const accounts = [acc({ movements: [
      { id: '1', date: '2026-08-05', amount: 500, label: 'x', type: 'IN' },
      { id: '2', date: '2026-09-05', amount: 250, label: 'x', type: 'IN' },
    ] })];
    const h = computeSavingsRateHistory(accounts, 2500, 3, NOW);
    expect(h.map(m => m.month)).toEqual(['2026-07', '2026-08', '2026-09']);
    expect(h.map(m => m.rate)).toEqual([0, 20, 10]);
  });
});

describe('dons', () => {
  it('plafonne le taux de 75 % et bascule l’excédent à 66 %', () => {
    const s = computeDonationSummary([
      { id: 'a', date: '2026-02-01', amount: 1200, organization: 'Restos', rate: 75, receiptReceived: true },
      { id: 'b', date: '2026-06-01', amount: 100, organization: 'MSF', rate: 66, receiptReceived: false },
      { id: 'c', date: '2025-06-01', amount: 500, organization: 'Autre année', rate: 66, receiptReceived: false },
    ], 2026);
    expect(s.total).toBe(1300);
    expect(s.total75).toBe(1000);
    expect(s.total66).toBe(300);
    expect(s.reduction).toBeCloseTo(750 + 198);
    expect(s.missingReceipts.map(d => d.id)).toEqual(['b']);
  });
});

describe('ancienneté et déblocage', () => {
  it("compte les années au jour anniversaire près", () => {
    expect(Math.floor(accountAgeYears('2021-03-12', new Date(2026, 2, 11)))).toBe(4);
    expect(accountAgeYears('2021-03-12', new Date(2026, 2, 12))).toBe(5);
  });

  it("chiffre l'impôt en plus d'un retrait avant maturité et la date de libération", () => {
    const av = acc({ name: 'AV', type: AccountType.ASSURANCE_VIE, openingDate: '2022-06-01', totalAmount: 20000, ownedAmount: 20000, totalDeposits: 15000 });
    const pea = acc({ name: 'PEA', type: AccountType.PEA, openingDate: '2023-01-15', totalDeposits: 8000 });
    const u = computeUnlockCost([av, pea, acc({ name: 'Inconnu', type: AccountType.PEA, openingDate: '2024-01-01' })], CFG, NOW);
    // AV : 5 000 € de gains → 12,8 % maintenant, 7,5 % au-delà de l'abattement de 4 600 € après 8 ans.
    // PEA : 2 000 € de gains → 12,8 % maintenant, exonéré après 5 ans.
    expect(u.extraTax).toBeCloseTo(5000 * 0.128 - 400 * 0.075 + 2000 * 0.128);
    expect(u.closesPea).toBe(true);
    expect(u.unknown).toEqual(['Inconnu']);
    expect(u.nextFree).toEqual({ date: '2028-01-15', name: 'PEA' });
  });
});

describe('barème et vérification annuelle', () => {
  const old = { ...CFG, taxBrackets: TAX_SCALES[0].brackets, taxScaleYear: undefined };
  it('propose le nouveau barème et garde l’ancien en historique', () => {
    expect(findFiscalReview(old, NOW).newScale?.year).toBe(LATEST_TAX_SCALE.year);
    const next = applyTaxScale(old, LATEST_TAX_SCALE, NOW);
    expect(findFiscalReview(next, NOW).newScale).toBeUndefined();
    expect(next.taxBracketsHistory?.[0]).toMatchObject({ year: 2024, replacedOn: '2026-09-30' });
  });
  it('reconnaît un barème revenu du JSON (Infinity → null)', () => {
    const fromJson = JSON.parse(JSON.stringify({ ...CFG }));
    expect(findFiscalReview(fromJson, NOW).newScale).toBeUndefined();
  });
  it('ne propose rien pour un barème saisi à la main plus récent', () => {
    expect(findFiscalReview({ ...CFG, taxBrackets: [{ limit: Infinity, rate: 0.2 }], taxScaleYear: 2030 }, NOW).newScale).toBeUndefined();
  });
  it('demande la vérification de janvier à mars, une fois par an', () => {
    expect(findFiscalReview(CFG, new Date(2027, 1, 1)).annualCheckDue).toBe(true);
    expect(findFiscalReview({ ...CFG, paramsReviewedYear: 2027 }, new Date(2027, 1, 1)).annualCheckDue).toBe(false);
    expect(findFiscalReview(CFG, NOW).annualCheckDue).toBe(false);
  });
});
