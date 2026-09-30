import { describe, it, expect } from 'vitest';
import {
  computeWithdrawalTax,
  computeWithdrawalOptions,
  depositsAfterWithdrawal,
  computeMonthSavedAmount,
  nextSubscriptionDate,
  findDueSubscriptions,
  subscriptionMonthlyCost,
} from './finance';
import { DEFAULT_FISCAL_CONFIG as CFG } from '../constants';
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

describe('computeWithdrawalOptions', () => {
  it('classe du moins coûteux au plus coûteux, sans le capital parental ni l’épargne bloquée', () => {
    const accounts = [
      acc({ name: 'LEP', type: AccountType.LEP, interestRate: 3.5 }),
      acc({ name: 'Livret A', interestRate: 2.4 }),
      acc({ name: 'PEE', type: AccountType.PEE }),
      acc({ name: 'Parents', totalAmount: 10000, ownedAmount: 500, parentalCapital: 9500 }),
    ];
    const opts = computeWithdrawalOptions(accounts, 1000, CFG, NOW);
    expect(opts.map(o => o.account.name)).toEqual(['Livret A', 'LEP']);
  });

  it('conseille d’attendre la prochaine quinzaine sur un livret', () => {
    const [o] = computeWithdrawalOptions([acc({ interestRate: 2.4 })], 5000, CFG, new Date(2026, 8, 10));
    expect(o.waitTip?.date).toBe('2026-09-16');
    expect(o.waitTip?.gain).toBeCloseTo(5000 * 0.024 / 24);
    expect(computeWithdrawalOptions([acc({ interestRate: 2.4 })], 5000, CFG, new Date(2026, 8, 16))[0].waitTip).toBeUndefined();
  });

  it('met en dernier un PEA que le retrait clôturerait', () => {
    const opts = computeWithdrawalOptions([
      acc({ name: 'PEA', type: AccountType.PEA, openingDate: '2025-01-01', totalDeposits: 10000 }),
      acc({ name: 'LEP', type: AccountType.LEP, interestRate: 3.5 }),
    ], 1000, CFG, NOW);
    expect(opts.map(o => o.account.name)).toEqual(['LEP', 'PEA']);
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
});
