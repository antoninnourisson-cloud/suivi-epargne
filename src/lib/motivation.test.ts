import { describe, it, expect } from 'vitest';
import {
  payWindowStart, recentPayWindows, savedBetween, computeGoodMonths, computeMilestones, nextMilestone,
  computePayReview, detectPayslipAnomalies, motivationSettings, PAY_WINDOW_DAYS,
} from './motivation';
import { AccountMovement, AccountType, PayslipRecord, SavingsAccount } from '../types';

const mv = (date: string, amount: number, type: 'IN' | 'OUT' = 'IN', extra: Partial<AccountMovement> = {}): AccountMovement =>
  ({ id: `${date}-${amount}-${type}`, date, amount, type, label: 'x', ...extra });
const account = (movements: AccountMovement[], over: Partial<SavingsAccount> = {}): SavingsAccount => ({
  id: 'la', name: 'Livret A', institution: 'B', type: AccountType.LIVRET_A,
  totalAmount: 1000, ownedAmount: 1000, parentalCapital: 0, movements, ...over,
});
const slip = (period: string, addedAt: string, extracted: Partial<PayslipRecord['extracted']> = {}): PayslipRecord =>
  ({ id: `${period}-${addedAt}`, fileId: 'f', fileName: 'f.pdf', addedAt, reviewed: true, extracted: { period, ...extracted } });

describe('réglages', () => {
  it('active par défaut, seuil 500 €, désactivable', () => {
    expect(motivationSettings(undefined)).toEqual({ enabled: true, threshold: 500 });
    expect(motivationSettings({ gamification: false, goodMonthThreshold: 800 })).toEqual({ enabled: false, threshold: 800 });
    expect(motivationSettings({ goodMonthThreshold: 0 }).threshold).toBe(500);
  });
});

describe('fenêtres de 30 jours à partir de la paie', () => {
  it("part de l'enregistrement de la fiche de paie quand il tombe à une semaine près du jour de paie", () => {
    expect(payWindowStart('2026-09', 27, [slip('2026-09', '2026-09-29T10:00:00Z')])).toEqual({ start: '2026-09-29', source: 'payslip' });
  });
  it('ignore une fiche enregistrée trop tard et revient au jour de paie', () => {
    expect(payWindowStart('2026-09', 27, [slip('2026-09', '2026-10-12T10:00:00Z')])).toEqual({ start: '2026-09-27', source: 'payday' });
  });
  it('sans jour de paie ni fiche : le 1er du mois ; un 31 devient le 30', () => {
    expect(payWindowStart('2026-09', undefined)).toEqual({ start: '2026-09-01', source: 'calendar' });
    expect(payWindowStart('2026-09', 31).start).toBe('2026-09-30');
  });
  it('dure 30 jours et ne crée pas la fenêtre d\'une paie pas encore tombée', () => {
    const w = recentPayWindows('2026-10-02', 27, [], 3);
    expect(w.map(x => x.start)).toEqual(['2026-07-27', '2026-08-27', '2026-09-27']);
    expect(w[2].end).toBe('2026-10-27');
    expect(PAY_WINDOW_DAYS).toBe(30);
  });
});

describe('argent mis de côté', () => {
  it("ne compte que l'épargne propre : pas les comptes courants, valorisations, part des parents ni solde initial", () => {
    const accts = [
      account([mv('2026-09-28', 400), mv('2026-09-30', 50, 'OUT'), mv('2026-09-29', 999, 'IN', { kind: 'valuation' }), mv('2026-09-29', 300, 'IN', { kind: 'parental' })]),
      account([mv('2026-09-28', 5000)], { id: 'cc', type: AccountType.COMPTE_COURANT }),
    ];
    expect(savedBetween(accts, '2026-09-27', '2026-10-27', '2026-10-02')).toBe(350);
  });
  it("s'arrête à aujourd'hui", () => {
    expect(savedBetween([account([mv('2026-10-05', 100)])], '2026-09-27', '2026-10-27', '2026-10-02')).toBe(0);
  });
});

describe('bons mois et séries', () => {
  const monthly = (amounts: number[]) => account(amounts.map((a, i) => mv(`2026-0${i + 1}-28`, a)));

  it('un bon mois = au moins le seuil sur la fenêtre ; la série compte les mois réussis d\'affilée', () => {
    const r = computeGoodMonths({ accounts: [monthly([600, 700, 550])], today: '2026-04-30', paydayDay: 27 });
    expect(r.months.filter(m => !m.inProgress).map(m => m.good)).toEqual([true, true, true]);
    expect(r.streak).toBe(3);
    expect(r.goodCount).toBe(3);
  });
  it('un joker par an couvre un mois raté ; le second mois raté de l\'année casse la série', () => {
    const r = computeGoodMonths({ accounts: [monthly([600, 100, 600, 100, 600])], today: '2026-06-30', paydayDay: 27 });
    expect(r.months.find(m => m.key === '2026-02')?.joker).toBe(true);
    expect(r.jokersUsed).toEqual(['2026']);
    expect(r.bestStreak).toBe(2);
    expect(r.streak).toBe(1);
  });
  it("le mois en cours ne casse rien tant qu'il n'est pas fini, et compte dès qu'il est acquis", () => {
    const pending = computeGoodMonths({ accounts: [account([mv('2026-03-28', 600), mv('2026-04-28', 100)])], today: '2026-05-02', paydayDay: 27 });
    expect(pending.current?.key).toBe('2026-04');
    expect(pending.current?.good).toBe(false);
    expect(pending.streak).toBe(1);
    const reached = computeGoodMonths({ accounts: [account([mv('2026-03-28', 600), mv('2026-04-28', 600)])], today: '2026-05-02', paydayDay: 27 });
    expect(reached.streak).toBe(2);
  });
  it("ne pénalise pas les mois d'avant le début du suivi", () => {
    const r = computeGoodMonths({ accounts: [account([mv('2026-05-28', 600)])], today: '2026-06-20', paydayDay: 27 });
    expect(r.months.map(m => m.key)).toEqual(['2026-05']);
    expect(r.jokersUsed).toEqual([]);
  });
  it('respecte un seuil personnalisé', () => {
    const r = computeGoodMonths({ accounts: [monthly([600])], today: '2026-02-20', paydayDay: 27, threshold: 800 });
    expect(r.months[0].good).toBe(false);
  });
});

describe('jalons', () => {
  const gm = computeGoodMonths({ accounts: [account([mv('2026-01-28', 600), mv('2026-02-28', 600), mv('2026-03-28', 600)])], today: '2026-04-20', paydayDay: 27 });
  const base = { mySavings: 12_000, monthlySpending: 1000, goodMonths: gm };

  it('reconnaît premier bon mois, série de 3, palier de 10 000 € et livret au plafond', () => {
    const list = computeMilestones({ ...base, accounts: [account([], { totalAmount: 22_950, ceiling: 22_950, ownedAmount: 22_950 })] });
    const done = list.filter(m => m.achieved).map(m => m.id);
    expect(done).toEqual(expect.arrayContaining(['good-month-1', 'streak-3', 'savings-10000', 'livret-full', 'emergency-3', 'emergency-6']));
    expect(done).not.toContain('savings-25000');
  });
  it('ne récompense ni crypto ni nombre d\'opérations', () => {
    const ids = computeMilestones({ ...base, accounts: [] }).map(m => m.id).join(' ');
    expect(ids).not.toMatch(/crypto|transaction|operation/);
  });
  it('propose comme prochain jalon le plus avancé', () => {
    const list = computeMilestones({ ...base, accounts: [] });
    expect(nextMilestone(list)?.id).toBe('streak-6');
  });
  it('ajoute « premier bon mois en solo » après la restitution', () => {
    const list = computeMilestones({ ...base, accounts: [], restitutionDoneOn: '2026-02-01' });
    expect(list.find(m => m.id === 'solo-month')?.achieved).toBe(true);
  });
});

describe('point de paie', () => {
  it('résume la dernière paie terminée : versements, retraits, valorisation, par compte, un enseignement', () => {
    const acc = account([mv('2026-03-28', 700), mv('2026-04-10', 100, 'OUT'), mv('2026-04-01', 40, 'IN', { kind: 'valuation' })]);
    const gm = computeGoodMonths({ accounts: [acc], today: '2026-05-02', paydayDay: 27 });
    const r = computePayReview({ accounts: [acc], goodMonths: gm, today: '2026-05-02', plan: 500 });
    expect(r).toMatchObject({ key: '2026-03', saved: 600, good: true, deposits: 700, withdrawals: 100, valuation: 40 });
    expect(r?.byAccount).toEqual([{ accountId: 'la', name: 'Livret A', net: 600 }]);
    expect(r?.insight).toBe('Objectif tenu : 100 € de plus que prévu.');
    expect(r?.action).toBeUndefined();
  });
  it('propose une action quand le mois est raté', () => {
    const acc = account([mv('2026-03-28', 200)]);
    const gm = computeGoodMonths({ accounts: [acc], today: '2026-05-02', paydayDay: 27 });
    const r = computePayReview({ accounts: [acc], goodMonths: gm, today: '2026-05-02' });
    expect(r?.insight).toBe('Il a manqué 300 € pour un bon mois.');
    expect(r?.action?.view).toBe('pilot');
  });
});

describe('contrôle des fiches de paie', () => {
  const series = (nets: number[]) => nets.map((n, i) => slip(`2026-0${i + 1}`, `2026-0${i + 1}-28`, { netPaid: n }));

  it("signale une fiche à plus de 15 % et 50 € de la médiane des précédentes", () => {
    const a = detectPayslipAnomalies(series([2000, 2010, 1990, 2400]));
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ period: '2026-04', field: 'netPaid', median: 2000 });
    expect(a[0].delta).toBeCloseTo(0.2);
  });
  it('se tait sous les seuils, avec moins de trois fiches, ou sur une fiche non relue', () => {
    expect(detectPayslipAnomalies(series([2000, 2010, 1990, 2200]))).toEqual([]);
    expect(detectPayslipAnomalies(series([2000, 3000]))).toEqual([]);
    const unreviewed = series([2000, 2010, 1990, 2400]).map((p, i) => (i === 3 ? { ...p, reviewed: false } : p));
    expect(detectPayslipAnomalies(unreviewed)).toEqual([]);
  });
});
