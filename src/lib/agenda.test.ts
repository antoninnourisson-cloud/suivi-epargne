import { describe, it, expect } from 'vitest';
import { buildAgenda, computeYearReview } from './agenda';
import { AccountType, GlobalAppData, SavingsAccount } from '../types';

const acc = (over: Partial<SavingsAccount>): SavingsAccount => ({
  id: 'x', name: 'x', type: AccountType.LIVRET_A, institution: 'B',
  totalAmount: 1000, ownedAmount: 1000, parentalCapital: 0, movements: [], ...over,
});
const base = (over: Partial<GlobalAppData> = {}): GlobalAppData => ({
  accounts: [], expenses: [], history: [],
  config: { grossAnnual: 0, leisureBudget: 0, projectSavings: 0, taxRateManual: 0, extraMonthlyIncome: 0 },
  ...over,
});
const NOW = new Date(2026, 9, 1, 9); // 1er octobre 2026

describe('buildAgenda', () => {
  it('rassemble paies, prélèvements, révisions de taux, restitution et rendez-vous annuels', () => {
    const data = base({
      accounts: [acc({ id: 'lep', name: 'LEP', type: AccountType.LEP, totalAmount: 10000, ownedAmount: 1754, parentalCapital: 8246 })],
      config: { ...base().config, paydayDay: 27, paydayAmount: 1000 },
      subscriptions: [
        { id: 'n', name: 'Navigo', amount: 90.8, debitAccount: 'Revolut', frequency: 'monthly', anchorDate: '2026-01-01', active: true },
        { id: 's', name: 'Strava', amount: 139.99, debitAccount: 'Revolut', frequency: 'yearly', anchorDate: '2026-08-06', active: true },
      ],
      parentalRestitution: { plannedDate: '2027-01-01' },
    });
    const { events } = buildAgenda(data, NOW);
    const has = (kind: string, date: string) => events.some(e => e.kind === kind && e.date === date);
    expect(has('payday', '2026-10-27')).toBe(true);
    expect(has('subscription', '2026-10-01')).toBe(true);
    expect(events.filter(e => e.title === 'Navigo').length).toBe(3); // 1er oct, nov, déc : deux mois seulement
    expect(has('subscription', '2027-08-06')).toBe(true);              // annuel : tout l'horizon
    expect(has('restitution', '2027-01-01')).toBe(true);
    expect(has('rates', '2027-02-01')).toBe(true);
    expect(has('review', '2027-01-02')).toBe(true);
    expect(has('fiscal', '2027-01-20')).toBe(true);
    expect(events.map(e => e.date)).toEqual([...events.map(e => e.date)].sort());
  });

  it('renvoie à part les maturités fiscales lointaines', () => {
    const data = base({ accounts: [acc({ id: 'av', name: 'AV', type: AccountType.ASSURANCE_VIE, openingDate: '2025-11-28' })] });
    const { events, later } = buildAgenda(data, NOW);
    expect(events.some(e => e.kind === 'maturity')).toBe(false);
    expect(later[0]).toMatchObject({ kind: 'maturity', date: '2033-11-28' });
  });
});

describe('computeYearReview', () => {
  it("additionne l'épargne de l'année et repère le meilleur et le pire mois", () => {
    const la = acc({ id: 'la', interestRate: 2, totalAmount: 1400, ownedAmount: 1400, movements: [
      { id: '1', date: '2025-06-01', amount: 1000, label: 'x', type: 'IN' },
      { id: '2', date: '2026-02-10', amount: 500, label: 'x', type: 'IN' },
      { id: '3', date: '2026-05-10', amount: 100, label: 'x', type: 'OUT' },
    ] });
    const r = computeYearReview(base({ accounts: [la] }), 2026, new Date(2027, 0, 5));
    expect(r.complete).toBe(true);
    expect(r.saved).toBe(400);
    expect(r.best).toEqual({ month: 1, saved: 500 });
    expect(r.worst).toEqual({ month: 4, saved: -100 });
    expect(r.netStart).toBe(1000);
    expect(r.netEnd).toBe(1400);
    expect(r.interest).toBeGreaterThan(0);
  });

  it("reprend la restitution et les intérêts offerts de l'année", () => {
    const data = base({
      accounts: [acc({ id: 'lep', type: AccountType.LEP })],
      parentalRestitution: { done: { date: '2027-01-01', accounts: [{ accountId: 'lep', name: 'LEP', amount: 8246 }], interestsOffered: [{ year: 2026, amount: 206 }] } },
    });
    const r = computeYearReview(data, 2026, new Date(2027, 0, 5));
    expect(r.restitution).toEqual({ date: '2027-01-01', amount: 8246 });
    expect(r.parentalInterest).toBe(206);
  });
});
