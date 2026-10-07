import { describe, it, expect } from 'vitest';
import { simulate, mulberry32, pastMonthlySavings, monthIndex, Scenario } from './simulator';
import { buildSoloPlan } from './planning';
import { DEFAULT_FISCAL_CONFIG as CFG } from '../constants';
import { AccountType, AccountMovement, SavingsAccount } from '../types';

const acc = (over: Partial<SavingsAccount> & Pick<SavingsAccount, 'id' | 'name' | 'type' | 'ownedAmount'>): SavingsAccount => ({
  institution: 'B', parentalCapital: 0, interestRate: 0, movements: [],
  ...over,
  totalAmount: over.totalAmount ?? over.ownedAmount + (over.parentalCapital || 0),
});

const simple = () => [
  acc({ id: 'cc', name: 'Compte courant', type: AccountType.COMPTE_COURANT, ownedAmount: 1000 }),
  acc({ id: 'la', name: 'Livret A', type: AccountType.LIVRET_A, ownedAmount: 5000, interestRate: 1.5 }),
  acc({ id: 'av', name: 'AV', type: AccountType.ASSURANCE_VIE, ownedAmount: 2000, interestRate: 2.5 }),
];
const zeroRates = () => simple().map(a => ({ ...a, interestRate: 0 }));

const run = (scenarios: Scenario[] = [], over: Partial<Parameters<typeof simulate>[0]> = {}) =>
  simulate({ accounts: zeroRates(), fiscal: CFG, monthlyPlan: 500, horizon: 24, today: '2027-01-01', scenarios, ...over });

describe('simulateur « Et si… » : courbe de référence', () => {
  it('suit le plan solo (intérêts nets puis versement réparti)', () => {
    const r = simulate({ accounts: simple(), fiscal: CFG, monthlyPlan: 500, horizon: 12, today: '2027-01-01', restitution: { done: true } });
    const solo = buildSoloPlan(simple(), CFG, 500, '2027-01-01', { years: 1 });
    expect(r.start).toBe(8000);
    expect(Math.round(r.points[12].baseline)).toBe(solo.years[0].total);
    expect(r.points).toHaveLength(13);
    expect(r.points[0].date).toBe('2027-01-01');
    expect(r.points[12].date).toBe('2028-01-01');
  });

  it('sans scénario, la courbe du scénario est la référence', () => {
    const r = run();
    expect(r.points.every(p => p.scenario === p.baseline)).toBe(true);
    expect(r.gap).toBe(0);
    expect(r.baselineEnd).toBe(8000 + 500 * 24);
  });

  it('borne l\'horizon entre 6 et 60 mois', () => {
    expect(run([], { horizon: 2 }).horizon).toBe(6);
    expect(run([], { horizon: 120 }).horizon).toBe(60);
  });
});

describe('scénarios', () => {
  it('achat : retire X à partir du mois M, compte courant puis livrets', () => {
    const r = run([{ kind: 'purchase', id: 'p', amount: 3000, month: 6 }]);
    for (const p of r.points) expect(p.baseline - p.scenario).toBeCloseTo(p.month >= 6 ? 3000 : 0, 6);
    expect(r.gap).toBeCloseTo(-3000, 6);
    const out = r.purchases[0];
    expect(out.takenFrom.map(t => [t.accountId, Math.round(t.amount)])).toEqual([['cc', 1000], ['la', 2000]]);
    expect(out.shortfall).toBe(0);
  });

  it('achat : avec intérêts, l\'écart grandit (intérêts perdus)', () => {
    const r = simulate({ accounts: simple(), fiscal: CFG, monthlyPlan: 500, horizon: 24, today: '2027-01-01', scenarios: [{ kind: 'purchase', id: 'p', amount: 3000, month: 3 }] });
    expect(r.points[3].baseline - r.points[3].scenario).toBeCloseTo(3000, 6);
    expect(-r.gap).toBeGreaterThan(3000);
  });

  it('pause : aucun versement pendant N mois', () => {
    const r = run([{ kind: 'pause', id: 'z', month: 4, months: 3 }]);
    expect(r.points[3].scenario).toBe(r.points[3].baseline);
    expect(r.points[6].baseline - r.points[6].scenario).toBe(1500);
    expect(r.gap).toBe(-1500);
  });

  it('épargne mensuelle : autre montant chaque mois', () => {
    const r = run([{ kind: 'monthly', id: 'm', amount: 700 }]);
    expect(r.monthly).toEqual({ baseline: 500, scenario: 700 });
    expect(r.gap).toBe(200 * 24);
  });

  it('les scénarios se combinent', () => {
    const r = run([
      { kind: 'monthly', id: 'm', amount: 600 },
      { kind: 'pause', id: 'z', month: 1, months: 2 },
      { kind: 'purchase', id: 'p', amount: 1000, month: 10 },
    ]);
    expect(r.scenarioEnd).toBe(8000 + 600 * 22 - 1000);
  });
});

describe('restitution et part des parents', () => {
  const withParents = () => [
    acc({ id: 'cc', name: 'Compte courant', type: AccountType.COMPTE_COURANT, ownedAmount: 500 }),
    acc({ id: 'lep', name: 'LEP', type: AccountType.LEP, ownedAmount: 7000, parentalCapital: 3000, interestRate: 2.4, ceiling: 10000 }),
    acc({ id: 'av', name: 'AV', type: AccountType.ASSURANCE_VIE, ownedAmount: 0, interestRate: 0 }),
  ];
  const base = { accounts: withParents(), fiscal: CFG, monthlyPlan: 300, horizon: 24, today: '2026-10-07' };

  it('la part des parents n\'est jamais comptée ni utilisée pour un achat', () => {
    const r = simulate({ ...base, restitution: { plannedDate: '2027-01-01' }, scenarios: [{ kind: 'purchase', id: 'p', amount: 9000, month: 1 }] });
    expect(r.start).toBe(7500);
    const out = r.purchases[0];
    const fromLep = out.takenFrom.find(t => t.accountId === 'lep')!.amount;
    expect(fromLep).toBeLessThanOrEqual(7000 + 7000 * 0.024 / 12 + 3000 * 0.024 / 12 + 1e-6);
    expect(out.shortfall).toBeGreaterThan(1000);
    expect(r.points[1].scenario).toBeGreaterThanOrEqual(-1e-9);
  });

  it('avant la restitution, le LEP est plein ; après, il se remplit et produit moins', () => {
    const r = simulate({ ...base, restitution: { plannedDate: '2027-01-01' } });
    expect(monthIndex('2026-10-07', '2027-01-01')).toBe(3);
    expect(r.restitution.baselineMonth).toBe(3);
    // Mois 1 : intérêts du capital entier (offerts) ; versement sur l'AV (LEP plein).
    expect(r.points[1].baseline).toBeCloseTo(7500 + 10000 * 0.024 / 12 + 300, 6);
  });

  it('décaler la restitution change la courbe ; sans effet une fois faite', () => {
    const later = simulate({ ...base, restitution: { plannedDate: '2027-01-01' }, scenarios: [{ kind: 'restitution', id: 'r', date: '2027-07-01' }] });
    expect(later.restitution.scenarioMonth).toBe(9);
    // Plus longtemps avec le capital des parents : plus d'intérêts offerts.
    expect(later.gap).toBeGreaterThan(0);
    const done = simulate({ ...base, accounts: withParents().map(a => ({ ...a, parentalCapital: 0, totalAmount: a.ownedAmount })), restitution: { plannedDate: '2027-01-01', done: true }, scenarios: [{ kind: 'restitution', id: 'r', date: '2027-07-01' }] });
    expect(done.restitution.scenarioIgnored).toBe(true);
    expect(done.gap).toBe(0);
  });
});

describe('fourchette (bootstrap de vos mois passés)', () => {
  const history = [200, 450, 500, 600, 900, -100, 520];

  it('P10 ≤ P50 ≤ P90 à chaque mois', () => {
    const r = run([], { history, rng: mulberry32(42), runs: 300 });
    expect(r.band).toEqual({ runs: 300, historyMonths: 7 });
    for (const p of r.points) {
      expect(p.p10!).toBeLessThanOrEqual(p.p50! + 1e-9);
      expect(p.p50!).toBeLessThanOrEqual(p.p90! + 1e-9);
    }
    expect(r.points[24].p90! - r.points[24].p10!).toBeGreaterThan(0);
  });

  it('même graine, même résultat', () => {
    const a = run([{ kind: 'purchase', id: 'p', amount: 1000, month: 2 }], { history, rng: mulberry32(7), runs: 200 });
    const b = run([{ kind: 'purchase', id: 'p', amount: 1000, month: 2 }], { history, rng: mulberry32(7), runs: 200 });
    expect(a.points).toEqual(b.points);
  });

  it('un historique constant donne une fourchette serrée sur ce montant', () => {
    const r = run([], { history: [500, 500, 500], runs: 50 });
    expect(r.points[24].p10).toBeCloseTo(r.baselineEnd, 6);
    expect(r.points[24].p90).toBeCloseTo(r.baselineEnd, 6);
  });

  it('band: false : courbes seules, mêmes valeurs', () => {
    const full = run([{ kind: 'pause', id: 'z', month: 2, months: 2 }], { history, runs: 20 });
    const lines = run([{ kind: 'pause', id: 'z', month: 2, months: 2 }], { history, band: false });
    expect(lines.band).toBeNull();
    expect(lines.bandUnavailable).toBeUndefined();
    expect(lines.points.map(p => p.scenario)).toEqual(full.points.map(p => p.scenario));
  });

  it('moins de 3 mois passés : pas de fourchette, et on dit pourquoi', () => {
    const r = run([], { history: [400, 500] });
    expect(r.band).toBeNull();
    expect(r.bandUnavailable).toMatch(/2 mois/);
    expect(r.points[0].p10).toBeUndefined();
  });

  it('objectif : mois où chaque courbe l\'atteint', () => {
    const r = run([{ kind: 'purchase', id: 'p', amount: 3000, month: 1 }], { target: 12000, history: [500, 500, 500], runs: 20 });
    expect(r.goal).toEqual({ target: 12000, baselineMonth: 8, scenarioMonth: 14, p50Month: 14 });
  });
});

describe('mois passés', () => {
  const mv = (id: string, date: string, amount: number, type: 'IN' | 'OUT' = 'IN'): AccountMovement => ({ id, date, amount, type, label: 'x' });
  it('mois civils terminés, sans le mois en cours ni le compte courant', () => {
    const accounts = [
      acc({ id: 'la', name: 'LA', type: AccountType.LIVRET_A, ownedAmount: 0, movements: [mv('1', '2026-07-03', 300), mv('2', '2026-08-10', 400), mv('3', '2026-09-02', 500), mv('4', '2026-09-20', 50, 'OUT'), mv('5', '2026-10-02', 999)] }),
      acc({ id: 'cc', name: 'CC', type: AccountType.COMPTE_COURANT, ownedAmount: 0, movements: [mv('6', '2026-09-05', 1000)] }),
    ];
    const p = pastMonthlySavings({ accounts, today: '2026-10-07', trackingStartDate: '2026-07-01' });
    expect(p.source).toBe('calendar');
    expect(p.amounts).toEqual([300, 400, 450]);
  });
});
