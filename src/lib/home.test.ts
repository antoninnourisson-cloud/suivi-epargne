import { describe, expect, it } from 'vitest';
import { AccountType, type AccountMovement, type SavingsAccount, type Subscription } from '../types';
import { DEFAULT_FISCAL_CONFIG, LATEST_TAX_SCALE } from '../constants';
import {
  availabilitySlices, averageFullMonthRate, buildHomeTodos, buildStackedSeries, dateRangeProblem, daysSinceLastMovement, defaultDateRange,
  findCeilingAlerts, findInactiveEmptyAccounts, isConstrainedAccount, isDateRange, monthDelta, parentalYearEndInterest, payPeriodSavings, periodCsvExport, savingsGauge,
  savingsOn, savingsProjection, upcomingDebits, homeAgenda, MAX_SERIES_DAYS, type HomeTodoInput,
} from './home';
import { buildAgenda } from './agenda';
import type { Alert } from './alerts';

const fiscal = { ...DEFAULT_FISCAL_CONFIG, ceilings: { livretA: 22950, ldds: 12000, lep: 10000 } };
let seq = 0;
const mv = (date: string, amount: number, type: 'IN' | 'OUT' = 'IN', over: Partial<AccountMovement> = {}): AccountMovement =>
  ({ id: `m${++seq}`, date, amount, type, label: 'x', ...over });
const acc = (id: string, type: AccountType, owned: number, over: Partial<SavingsAccount> = {}): SavingsAccount => ({
  id, name: id, institution: 'Banque', type, totalAmount: owned + (over.parentalCapital ?? 0), ownedAmount: owned, parentalCapital: 0, movements: [], ...over,
});

describe('votre épargne à ce jour', () => {
  it('neutralises movements dated after today, but not the parents\' share', () => {
    const a = acc('a', AccountType.LIVRET_A, 1000, { movements: [mv('2026-10-25', 200), mv('2026-10-25', 50, 'IN', { kind: 'parental' })] });
    const b = acc('b', AccountType.LDDS, 500, { movements: [mv('2026-10-01', 100)] });
    expect(savingsOn([a, b], '2026-10-20')).toBe(1300);
  });

  it('measures the change since the previous monthly point', () => {
    const history = [{ date: '2026-08-31', totalAmount: 0, ownedAmount: 900 }, { date: '2026-09-30', totalAmount: 0, ownedAmount: 1000 }, { date: '2026-10-05', totalAmount: 0, ownedAmount: 1100 }];
    expect(monthDelta(history, 1250, '2026-10-20')).toBe(250);
    expect(monthDelta([], 1250, '2026-10-20')).toBeNull();
  });
});

describe('signaux de l\'Accueil', () => {
  it('flags regulated booklets between 90 and 100 % of their ceiling, the account ceiling first', () => {
    const accounts = [
      acc('la', AccountType.LIVRET_A, 21000),
      acc('ldds', AccountType.LDDS, 12000), // plein : rien
      acc('lep', AccountType.LEP, 4600, { ceiling: 5000 }), // plafond propre : 92 %
      acc('cc', AccountType.COMPTE_COURANT, 50000),
    ];
    const alerts = findCeilingAlerts(accounts, fiscal);
    expect(alerts.map(a => a.id)).toEqual(['lep', 'la']);
    expect(alerts[1].remaining).toBe(1950);
  });

  it('lists empty accounts idle for 60 days or never funded', () => {
    const now = new Date(2026, 9, 20);
    const accounts = [
      acc('old', AccountType.LIVRET_A, 0, { movements: [mv('2026-07-01', 10), mv('2026-07-02', 10, 'OUT')] }),
      acc('recent', AccountType.LIVRET_A, 0, { movements: [mv('2026-10-01', 10, 'OUT')] }),
      acc('never', AccountType.LDDS, 0),
      acc('opened', AccountType.LDDS, 0, { openingDate: '2026-10-10' }),
      acc('funded', AccountType.LDDS, 10),
    ];
    expect(findInactiveEmptyAccounts(accounts, now).map(a => a.id)).toEqual(['old', 'never']);
  });

  it('counts days since the last movement, ignoring future-dated ones', () => {
    const now = new Date(2026, 9, 20, 15);
    const accounts = [acc('a', AccountType.LIVRET_A, 0, { movements: [mv('2026-09-29', 1), mv('2026-12-01', 1)] })];
    expect(daysSinceLastMovement(accounts, now)).toBe(21);
    expect(daysSinceLastMovement([acc('b', AccountType.LDDS, 0)], now)).toBeNull();
  });

  it('lists active debits of the next 7 days, nearest first', () => {
    const sub = (id: string, anchorDate: string, over: Partial<Subscription> = {}): Subscription =>
      ({ id, name: id, amount: 10, frequency: 'monthly', anchorDate, active: true, ...over } as Subscription);
    const now = new Date(2026, 9, 20, 18);
    const list = upcomingDebits([sub('in3', '2026-01-23'), sub('today', '2026-01-20'), sub('far', '2026-01-05'), sub('off', '2026-01-21', { active: false })], now);
    expect(list.map(d => [d.s.id, d.inDays])).toEqual([['today', 0], ['in3', 3]]);
  });

  it('« Prochaines échéances » ne répète pas un prélèvement déjà dans les 7 prochains jours', () => {
    const sub = (id: string, anchorDate: string, frequency: Subscription['frequency'] = 'monthly'): Subscription =>
      ({ id, name: id, amount: 10, debitAccount: '', frequency, anchorDate, active: true });
    const now = new Date(2026, 9, 20, 18);
    const subscriptions = [sub('Musique', '2026-01-22'), sub('Assurance', '2025-11-05', 'yearly')];
    const config = { grossAnnual: 0, leisureBudget: 0, projectSavings: 0, taxRateManual: 0, extraMonthlyIncome: 0, paydayDay: 27 };
    const { events } = buildAgenda({ accounts: [], expenses: [], history: [], subscriptions, config }, now);
    const debits = upcomingDebits(subscriptions, now);
    expect(debits.map(d => d.s.name)).toEqual(['Musique']);
    // Musique (22/10) est déjà dans la carte des prélèvements : les trois suivants à la place,
    // y compris Musique le mois prochain (hors des 7 jours).
    expect(homeAgenda(events, debits).map(e => [e.title, e.date])).toEqual([
      ['Paie attendue · épargne de novembre', '2026-10-27'], ['Assurance', '2026-11-05'], ['Musique', '2026-11-22'],
    ]);
    expect(homeAgenda(events, []).map(e => e.title)).toEqual(['Musique', 'Paie attendue · épargne de novembre', 'Assurance']);
  });

  it('reminds the parents\' interest in December only', () => {
    const accounts = [acc('la', AccountType.LIVRET_A, 0, { parentalCapital: 10000, interestRate: 3, openingDate: '2020-01-01' })];
    expect(parentalYearEndInterest(accounts, new Date(2026, 10, 20))).toBeNull();
    expect(parentalYearEndInterest(accounts, new Date(2026, 11, 20))).toBeGreaterThan(200);
  });

  it('knows which accounts are not available right away', () => {
    expect(isConstrainedAccount(AccountType.PEA)).toBe(true);
    expect(isConstrainedAccount(AccountType.LIVRET_A)).toBe(false);
  });
});

describe('courbe d\'épargne', () => {
  it('rewinds each day from today\'s balances, without the parents\' share', () => {
    const a = acc('a', AccountType.LIVRET_A, 300, { movements: [mv('2026-10-02', 100), mv('2026-10-03', 50, 'OUT'), mv('2026-10-02', 999, 'IN', { kind: 'parental' })] });
    const series = buildStackedSeries([a], { start: '2026-10-01', end: '2026-10-03' });
    expect(series.map(p => [p.date, p.a, p.total])).toEqual([['2026-10-01', 250, 250], ['2026-10-02', 350, 350], ['2026-10-03', 300, 300]]);
    expect(series[0].displayDate).toMatch(/01/);
  });

  it('cancels movements after the end of the range', () => {
    const a = acc('a', AccountType.LIVRET_A, 300, { movements: [mv('2026-10-10', 100)] });
    expect(buildStackedSeries([a], { start: '2026-10-01', end: '2026-10-02' }).map(p => p.a)).toEqual([200, 200]);
  });

  it('keeps the day of the autumn clock change', () => {
    const a = acc('a', AccountType.LIVRET_A, 100, { movements: [mv('2025-10-26', 40)] });
    const series = buildStackedSeries([a], { start: '2025-10-25', end: '2025-10-27' });
    expect(series.map(p => p.date)).toEqual(['2025-10-25', '2025-10-26', '2025-10-27']);
    expect(series[0].a).toBe(60);
  });

  it('thins long ranges and caps them at about five years', () => {
    const a = acc('a', AccountType.LIVRET_A, 100);
    const year = buildStackedSeries([a], { start: '2025-10-20', end: '2026-10-20' });
    expect(year.length).toBeLessThan(60);
    expect(year[year.length - 1].date).toBe('2026-10-20');
    const huge = buildStackedSeries([a], { start: '1990-01-01', end: '2026-10-20' });
    expect(huge.length).toBeLessThanOrEqual(Math.ceil(MAX_SERIES_DAYS / 14) + 2);
    expect(buildStackedSeries([a], { start: '2026-10-20', end: '2026-10-01' })).toEqual([]);
  });

  it('validates a stored range and builds the default six months', () => {
    expect(isDateRange({ start: '2026-01-01', end: '2026-02-01' })).toBe(true);
    expect(isDateRange({ start: 1, end: '2026-02-01' })).toBe(false);
    expect(isDateRange('abîmé')).toBe(false);
    expect(defaultDateRange(new Date(2026, 7, 31))).toEqual({ start: '2026-02-28', end: '2026-08-31' });
  });

  it('tells a missing date from a reversed period', () => {
    expect(dateRangeProblem({ start: '2026-01-01', end: '2026-02-01' })).toBeNull();
    expect(dateRangeProblem({ start: '2026-02-01', end: '2026-02-01' })).toBeNull();
    expect(dateRangeProblem({ start: '', end: '2026-02-01' })).toBe('missing');
    expect(dateRangeProblem({ start: '2026-01-01', end: '' })).toBe('missing');
    expect(dateRangeProblem({ start: '2026-03-01', end: '2026-02-01' })).toBe('reversed');
  });
});

describe('rythme et projection', () => {
  it('projects the last 90 days and flags a 25 % drift', () => {
    const now = new Date(2026, 9, 20);
    const day = (n: number) => { const d = new Date(now); d.setDate(d.getDate() - n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
    // Trimestre précédent : 300 € par mois ; dernier trimestre : 600 € par mois.
    const movements = [
      ...[170, 140, 110].map(n => mv(day(n), 300)),
      ...[80, 50, 20].map(n => mv(day(n), 600)),
    ];
    const p = savingsProjection([acc('a', AccountType.LIVRET_A, 2700, { openingDate: day(400), movements })], now)!;
    expect(p.monthlyRate).toBeGreaterThan(400);
    expect(p.in12).toBeCloseTo(p.totalNow + p.monthlyRate * 12, 6);
    expect(p.drift?.changeRatio).toBeGreaterThan(0.25);
    expect(savingsProjection([acc('b', AccountType.LIVRET_A, 100)], now)).toBeNull();
  });

  it("une baisse de la bourse ne se lit pas comme une épargne ralentie (rythme = versements − retraits)", () => {
    const now = new Date(2026, 9, 20);
    const day = (n: number) => { const d = new Date(now); d.setDate(d.getDate() - n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
    // 300 € versés chaque mois sur les deux trimestres ; le PEA perd 2 000 € au dernier, et le
    // livret reçoit 150 € d'intérêts (hors épargne).
    const pea = acc('pea', AccountType.PEA, 8000, { movements: [
      ...[170, 140, 110, 80, 50, 20].map(n => mv(day(n), 300)),
      mv(day(10), 2000, 'OUT', { kind: 'valuation', label: 'Valorisation (-)' }),
    ] });
    const livret = acc('la', AccountType.LIVRET_A, 5000, { movements: [mv(day(5), 150, 'IN', { kind: 'adjustment', label: 'Intérêts' })] });
    const p = savingsProjection([pea, livret], now)!;
    expect(p.monthlyRate).toBeCloseTo(300, 6);
    expect(p.drift).toBeNull();
    expect(p.totalNow).toBe(13000);
    expect(p.in6).toBeCloseTo(13000 + 1800, 6);
  });

  it('averages full months that moved, never the current one', () => {
    expect(averageFullMonthRate([{ month: '2026-08', saved: 100, rate: 10 }, { month: '2026-09', saved: 0, rate: 0 }, { month: '2026-10', saved: 900, rate: 90 }])).toBe(10);
    expect(averageFullMonthRate([{ month: '2026-10', saved: 1, rate: 5 }])).toBeNull();
  });

  it('follows the pay period when a payday is known', () => {
    const period = { key: '2026-10', end: '2026-10-27', byPay: true, since: 'depuis la paie du 27 septembre' };
    const g = savingsGauge({ saved: 300, goal: 600, period, today: '2026-10-01' });
    // Nommée par le mois d'épargne (paie du 27 septembre → épargne d'octobre).
    expect(g.title).toBe("Épargne d'octobre");
    expect(g.since).toBe('Depuis la paie du 27 septembre');
    expect(g.daysLeft).toBe(26);
    expect(g.until).toBe('la prochaine paie');
    expect(g.pct).toBe(50);
    expect(g.done).toBe(false);
    expect(g.tick).toBeNull();
    const m = savingsGauge({ saved: 700, goal: 600, period: { end: '2026-11-01', byPay: false, since: 'depuis le 1er octobre' }, today: '2026-10-20' });
    expect(m.title).toBe('Placé depuis le 1er octobre');
    expect(m.since).toBeNull();
    expect(m.daysLeft).toBe(12);
    expect(m.until).toBe('la fin du mois');
    expect(m.pct).toBe(100);
    expect(m.done).toBe(true);
    expect(savingsGauge({ saved: 0, period, today: '2026-10-01' }).hasPlan).toBe(false);
  });

  it('puts the goal and the good-month threshold on one gauge', () => {
    const period = { end: '2026-10-27', byPay: true, since: 'depuis la paie du 27 septembre' };
    // Objectif 773 €, seuil 500 € : la barre va jusqu'à l'objectif, un trait marque le seuil.
    const g = savingsGauge({ saved: 320, goal: 773, threshold: 500, period, today: '2026-10-02' });
    expect(g.max).toBe(773);
    expect(g.tick).toEqual({ kind: 'threshold', amount: 500, pct: (500 / 773) * 100 });
    expect(g.good).toBe(false);
    expect(g.done).toBe(false);
    expect(savingsGauge({ saved: 520, goal: 773, threshold: 500, period, today: '2026-10-02' }).good).toBe(true);
    // Objectif plus bas que le seuil : la barre va jusqu'au seuil, le trait marque l'objectif.
    const low = savingsGauge({ saved: 450, goal: 400, threshold: 500, period, today: '2026-10-02' });
    expect(low.max).toBe(500);
    expect(low.tick?.kind).toBe('goal');
    expect(low.done).toBe(true);
    expect(low.good).toBe(false);
    // Seuil seul (pas d'objectif) : une seule cible, pas de trait.
    const only = savingsGauge({ saved: 250, threshold: 500, period, today: '2026-10-02' });
    expect([only.max, only.pct, only.tick]).toEqual([500, 50, null]);
    // Même montant : un seul repère.
    expect(savingsGauge({ saved: 0, goal: 500, threshold: 500, period, today: '2026-10-02' }).tick).toBeNull();
    // Retrait net : jauge vide, jamais négative.
    expect(savingsGauge({ saved: -80, goal: 500, period, today: '2026-10-02' }).pct).toBe(0);
  });
});

describe('fenêtre « ce mois-ci » : la paie en cours', () => {
  const livret = (movements: AccountMovement[]) => acc('a', AccountType.LIVRET_A, 1000, { movements });

  it('counts what was placed since the last pay, not since the 1st of the month', () => {
    // Paie le 27 : 320 € placés les 28 et 30 septembre ; le 2 octobre, le mois civil est vide.
    const accounts = [livret([mv('2026-09-28', 200), mv('2026-09-30', 120), mv('2026-08-28', 500)])];
    const p = payPeriodSavings({ accounts, today: '2026-10-02', paydayDay: 27, monthlyPay: 2000 });
    expect(p.start).toBe('2026-09-27');
    expect(p.end).toBe('2026-10-27');
    expect(p.byPay).toBe(true);
    // Mois d'épargne d'octobre (paie du 27 septembre), paie attendue pas encore déclarée.
    expect(p.key).toBe('2026-10');
    expect(p.declared).toBe(false);
    expect(p.since).toBe('depuis la paie du 27 septembre');
    expect(p.saved).toBe(320);
    expect(p.rate).toBe(16);
    // Le suivi commence au premier versement (28 août) : les mois d'avant ne sont pas des
    // barres à 0 %, seuls l'épargne de septembre (paie d'août) et le mois en cours sont montrés.
    expect(p.history).toEqual([{ month: '2026-09', saved: 500, rate: 25 }, { month: '2026-10', saved: 320, rate: 16 }]);
    expect(p.avgRate).toBe(25);
    expect(p.avgCount).toBe(1);
  });

  it('shows no pay before the tracking start, but always the current one', () => {
    // « Repartir de zéro » le 1er septembre : le versement de janvier 2025 ne compte plus, le
    // suivi reprend au versement du 10 septembre (dans la paie d'août, du 27 août au 26 septembre).
    const accounts = [livret([mv('2025-01-15', 300), mv('2026-09-10', 100), mv('2026-09-28', 200)])];
    const p = payPeriodSavings({ accounts, today: '2026-10-02', paydayDay: 27, monthlyPay: 2000, trackingStartISO: '2026-09-01' });
    expect(p.history).toEqual([{ month: '2026-09', saved: 100, rate: 5 }, { month: '2026-10', saved: 200, rate: 10 }]);
    const later = payPeriodSavings({ accounts, today: '2026-10-02', paydayDay: 27, monthlyPay: 2000, trackingStartISO: '2026-09-27' });
    expect(later.history.map(h => h.month)).toEqual(['2026-10']);
    // Aucun versement encore : seule la paie en cours.
    expect(payPeriodSavings({ accounts: [], today: '2026-10-02', paydayDay: 27, monthlyPay: 2000 }).history).toHaveLength(1);
    // Suivi ancien : les 12 dernières paies.
    expect(payPeriodSavings({ accounts, today: '2026-10-02', paydayDay: 27, monthlyPay: 2000 }).history).toHaveLength(12);
  });

  it('falls back to the calendar month without a payday', () => {
    const accounts = [livret([mv('2026-10-01', 50), mv('2026-09-30', 70, 'OUT')])];
    const p = payPeriodSavings({ accounts, today: '2026-10-20', monthlyPay: 0 });
    expect([p.start, p.end, p.byPay, p.since]).toEqual(['2026-10-01', '2026-11-01', false, 'depuis le 1er octobre']);
    expect(p.saved).toBe(50);
    // Paie inconnue : pas de taux plutôt qu'un 0 % trompeur.
    expect(p.rate).toBeNull();
    expect(p.avgRate).toBeNull();
  });

  it('marks the month declared once its pay is received, from the day it arrived', () => {
    // Paie reçue le 25 septembre (en avance) : l'épargne d'octobre part de là.
    const pays = [{ id: 'pay-2026-10', receivedOn: '2026-09-25', savingsMonth: '2026-10' }];
    const p = payPeriodSavings({ accounts: [livret([mv('2026-09-25', 300)])], today: '2026-10-02', paydayDay: 27, pays, monthlyPay: 0 });
    expect([p.key, p.declared, p.start, p.saved]).toEqual(['2026-10', true, '2026-09-25', 300]);
  });

  it('bounds the next payday to the end of a short month and crosses the year', () => {
    expect(payPeriodSavings({ accounts: [], today: '2027-01-31', paydayDay: 31, monthlyPay: 0 }).end).toBe('2027-02-28');
    expect(payPeriodSavings({ accounts: [], today: '2026-12-31', paydayDay: 31, monthlyPay: 0 }).end).toBe('2027-01-31');
  });

  it('starts on the day the payslip was recorded when there is no payday', () => {
    const payslips = [{ addedAt: '2026-10-03T10:00:00Z', extracted: { period: '2026-10' } }] as Parameters<typeof payPeriodSavings>[0]['payslips'];
    const p = payPeriodSavings({ accounts: [livret([mv('2026-10-03', 40), mv('2026-10-02', 10)])], today: '2026-10-05', payslips, monthlyPay: 0 });
    expect(p.byPay).toBe(true);
    expect(p.start).toBe('2026-10-03');
    expect(p.since).toBe('depuis la paie du 3 octobre');
    expect(p.end).toBe('2026-11-02');
    expect(p.saved).toBe(40);
  });
});

describe('disponibilité et export', () => {
  it('describes each availability slice', () => {
    const slices = availabilitySlices({ available: 100, taxLocked: 50, hardLocked: 30, peeUndated: true, peeNextRelease: { date: '2027-03-01', monthsRemaining: 5, amount: 1200, last: false, name: 'PEE' } });
    expect(slices.map(s => s.key)).toEqual(['available', 'tax', 'locked']);
    expect(slices[2].hint).toMatch(/1\s200\s€ de PEE libres le 01\/03\/2027 · épargne salariale sans date/);
    expect(availabilitySlices({ available: 10, taxLocked: 0, hardLocked: 0, peeUndated: false }).length).toBe(1);
  });

  it('exports the chosen period, one row per day, own share only', () => {
    const a = acc('a', AccountType.LIVRET_A, 300, { name: 'Livret A; Banque', movements: [mv('2026-10-02', 100), mv('2026-10-02', 999, 'IN', { kind: 'parental' })] });
    const b = acc('b', AccountType.LDDS, 20.5, { name: 'LDDS' });
    const out = periodCsvExport([a, b], { start: '2026-10-01', end: '2026-10-03' });
    expect(out?.fileName).toBe('pecule-evolution-2026-10-01-au-2026-10-03.csv');
    expect(out?.rows).toEqual([
      ['Date', 'Livret A; Banque (€)', 'LDDS (€)', 'Total, votre part (€)'],
      ['2026-10-01', '200,00', '20,50', '220,50'],
      ['2026-10-02', '300,00', '20,50', '320,50'],
      ['2026-10-03', '300,00', '20,50', '320,50'],
    ]);
  });

  it('keeps every day of a long period, and nothing for an inverted one', () => {
    const a = acc('a', AccountType.LIVRET_A, 100);
    const year = periodCsvExport([a], { start: '2025-10-20', end: '2026-10-20' });
    expect(year?.rows.length).toBe(1 + 366);
    expect(periodCsvExport([a], { start: '2026-10-20', end: '2026-10-01' })).toBeNull();
    // Plus de cinq ans demandés : le nom dit la période réellement exportée.
    expect(periodCsvExport([a], { start: '1990-01-01', end: '2026-10-20' })?.fileName).toMatch(/^pecule-evolution-2021-10-\d\d-au-2026-10-20\.csv$/);
  });
});

describe('liste « À faire »', () => {
  const can = { navigate: true, recordRecurring: true, deleteAccount: true, updateFiscalConfig: true, updateAccounts: true, openSettings: true, acceptPayRaise: true, dismissPayRaise: true, exportData: true };
  const base = (over: Partial<HomeTodoInput> = {}): HomeTodoInput => ({
    now: new Date(2026, 9, 20), accounts: [], fiscalConfig: fiscal, can,
    daysSinceUpdate: null, dueRecurring: [], lepTimeline: null, staleRates: null, dismissedRateRevision: null, ratesEditorOpen: false,
    parentalYearEnd: null, inactiveEmpty: [], fiscalReview: { annualCheckDue: false }, taxReturnAlert: null, taxReturnFiled: null,
    payRaise: null, avRatesDue: [], ceilingAlerts: [], lastExportAt: '2026-10-01', alerts: [], emergency: null, ...over,
  });

  it('is empty when there is nothing to do', () => {
    expect(buildHomeTodos(base())).toEqual([]);
  });

  it('envies sans prix : une tâche ponctuelle « Envies à compléter », absente quand tout est complété', () => {
    const todo = (n: number) => buildHomeTodos(base({ wishesToComplete: n })).find(t => t.key === 'wishes-to-complete');
    expect(todo(0)).toBeUndefined();
    expect(buildHomeTodos(base())).toEqual([]);
    expect(todo(1)).toMatchObject({ text: 'Envies à compléter', detail: '1 envie sans prix', primary: { label: 'Compléter', action: { type: 'navigate', view: 'wishes' } } });
    expect(todo(3)?.detail).toBe('3 envies sans prix');
    expect(todo(3)?.snoozable).toBeUndefined();
  });

  describe('« Avant le 31 décembre »', () => {
    const at = (month: number, day: number) => new Date(2026, month, day, 10);
    const todo = (now: Date, yearEndTax?: HomeTodoInput['yearEndTax'], over: Partial<HomeTodoInput> = {}) =>
      buildHomeTodos(base({ now, yearEndTax, ...over })).find(t => t.key.startsWith('year-end-tax'));
    const figures = { year: 2026, per: { amount: 1000, saving: 300 }, donations: { acquired: 132, example: 100, extra: 66 } };

    it('apparaît du 15 novembre au 31 décembre, avec les montants de l\'utilisateur', () => {
      const t = todo(at(10, 15), figures);
      expect(t).toMatchObject({ key: 'year-end-tax-2026-early', text: 'Avant le 31 décembre', snoozable: true, primary: { label: 'Voir mes dons', action: { type: 'navigate', view: 'donations' } } });
      const detail = (t?.detail ?? '').replace(/\s/g, ' ');
      expect(detail).toContain('Verser 1 000 € sur votre PER réduirait votre impôt 2026 d\'environ 300 €.');
      expect(detail).toContain('Vos dons de 2026 vous donnent déjà 132 € de réduction ; 100 € de plus en donneraient 66 €.');
      expect(todo(at(11, 31), figures)).toBeDefined();
    });

    it('absente avant le 15 novembre et après le 31 décembre', () => {
      expect(todo(at(10, 14), figures)).toBeUndefined();
      expect(todo(at(9, 20), figures)).toBeUndefined();
      expect(todo(new Date(2027, 0, 2, 10), { ...figures, year: 2027 })).toBeUndefined();
    });

    it('dernier rappel à partir du 15 décembre : autre clé, donc un « Plus tard » de novembre ne le masque pas', () => {
      expect(todo(at(11, 14), figures)?.key).toBe('year-end-tax-2026-early');
      expect(todo(at(11, 15), figures)?.key).toBe('year-end-tax-2026-last');
    });

    it('sans revenu connu, la tâche reste générale : aucun montant', () => {
      for (const f of [undefined, null, { year: 2026 }]) {
        const t = todo(at(11, 1), f);
        expect(t?.detail).toBe('Les versements sur un PER et les dons faits avant le 31 décembre réduisent l\'impôt de 2026.');
        expect(t?.detail).not.toMatch(/€/);
      }
    });

    it('sans PER : seule la phrase des dons ; sans don acquis : le don d\'exemple seul', () => {
      expect(todo(at(11, 1), { year: 2026, donations: figures.donations })?.detail).not.toContain('PER');
      const none = todo(at(11, 1), { year: 2026, donations: { acquired: 0, example: 100, extra: 66 } })?.detail?.replace(/\s/g, ' ');
      expect(none).toContain('100 € donnés avant le 31 décembre réduiraient votre impôt 2026 de 66 €.');
    });

    it('plafond des dons atteint : seule la réduction acquise est citée', () => {
      const d = todo(at(11, 1), { year: 2026, donations: { acquired: 132, example: 100, extra: 0 } })?.detail?.replace(/\s/g, ' ');
      expect(d).toContain('Vos dons de 2026 vous donnent déjà 132 € de réduction.');
      expect(d).not.toContain('de plus');
    });

    it('sans navigation possible : pas de bouton « Voir mes dons »', () => {
      expect(todo(at(11, 1), figures, { can: { ...can, navigate: false } })?.primary).toBeUndefined();
    });
  });

  it('keeps the historic keys (snoozes depend on them) and names actions', () => {
    const la = acc('la', AccountType.LIVRET_A, 100, { name: 'Livret A' });
    const recurring = { id: 'r1', label: 'Virement', amount: 50, type: 'IN' as const, accountId: 'la', dayOfMonth: 5, active: true };
    const todos = buildHomeTodos(base({
      accounts: [la],
      daysSinceUpdate: 30,
      dueRecurring: [{ recurring, dueDate: '2026-10-05' }],
      staleRates: { revision: { key: '2026-08', label: '1er août 2026' }, accounts: [{ name: 'Livret A' }] },
      parentalYearEnd: 123,
      inactiveEmpty: [acc('vide', AccountType.LDDS, 0)],
      fiscalReview: { annualCheckDue: true },
      payRaise: { delta: 80, period: '2026-09', hasFixedAmount: true },
      avRatesDue: [acc('av', AccountType.ASSURANCE_VIE, 10)],
      lastExportAt: undefined,
      emergency: { months: 3, monthlySpending: 1000, target: 3000, current: 1000, missing: 2000, pct: 33, reached: false },
    }));
    expect(todos.map(t => t.key)).toEqual(['stale-update', 'rec-r1-2026-10-05', 'rates', 'parental-ye-2026', 'empty-vide', 'annual-2026', 'raise-2026-09', 'av-rate-2026', 'export', 'emergency']);
    const rec = todos[1];
    expect(rec.text).toMatch(/^Échéance du 5 octobre : Virement, \+50\s€ sur Livret A$/);
    expect(rec.secondary?.action).toEqual({ type: 'skip-recurring', recurringId: 'r1' });
    expect(todos[0].primary?.action).toEqual({ type: 'navigate', view: 'update' });
    expect(todos.find(t => t.key === 'annual-2026')?.primary?.action).toEqual({ type: 'confirm-fiscal-params', year: 2026 });
    expect(todos.find(t => t.key === 'av-rate-2026')?.text).toContain('Taux servi 2025');
    // « Taux inchangé » : noté sur les comptes (la clôture de l'année lit la même trace).
    expect(todos.find(t => t.key === 'av-rate-2026')?.secondary?.action).toEqual({ type: 'confirm-av-rates', accountIds: ['av'] });
  });

  it('replaces the January reminders with one year-end closing task, until the year is closed', () => {
    const jan = new Date(2027, 0, 20);
    const january = (yearClosing: HomeTodoInput['yearClosing']) => buildHomeTodos(base({
      now: jan, avRatesDue: [acc('av', AccountType.ASSURANCE_VIE, 10)], lastExportAt: undefined, yearClosing,
      fiscalReview: { annualCheckDue: true, newScale: LATEST_TAX_SCALE },
    }));
    const open = january({ year: 2026, closed: false, inSeason: true, done: 1, total: 7 });
    expect(open.map(t => t.key)).toEqual(['year-closing-2026']);
    expect(open[0]).toMatchObject({ icon: 'calendar-check', tone: 'action', snoozable: true, pinned: true, text: 'Clôture de l\'année 2026 : 1 étape sur 7 faite.' });
    expect(open[0].primary?.action).toEqual({ type: 'open-year-closing' });
    expect(january({ year: 2026, closed: false, inSeason: true, done: 3, total: 7 })[0].text).toBe('Clôture de l\'année 2026 : 3 étapes sur 7 faites.');
    // Clôturée : plus de tâche de clôture ni de taux servi ; barème, paramètres fiscaux et copie
    // trimestrielle reviennent à part s'ils restent à faire.
    expect(january({ year: 2026, closed: true, inSeason: true, done: 0, total: 0 }).map(t => t.key)).toEqual([`scale-${LATEST_TAX_SCALE.year}`, 'annual-2027', 'export']);
    // Hors saison, année ouverte : les rappels habituels.
    expect(buildHomeTodos(base({ now: new Date(2027, 2, 5), lastExportAt: '2027-02-01', avRatesDue: [acc('av', AccountType.ASSURANCE_VIE, 10)], yearClosing: { year: 2026, closed: false, inSeason: false, done: 0, total: 0 } })).map(t => t.key))
      .toEqual(['av-rate-2027']);
    // Sans navigation, la tâche reste mais sans bouton.
    expect(buildHomeTodos(base({ now: jan, can: { ...can, navigate: false }, yearClosing: { year: 2026, closed: false, inSeason: true, done: 0, total: 7 } }))[0].primary).toBeUndefined();
  });

  it('rappel annuel du code de secours : dû, il mène aux Paramètres et se reporte ; sinon rien', () => {
    const [todo] = buildHomeTodos(base({ backupCodeCheckDue: true }));
    expect(todo).toMatchObject({ key: 'backup-code-check-2026', icon: 'shield', tone: 'action', snoozable: true });
    expect(todo.text).toMatch(/code de secours est toujours à portée de main/);
    expect(todo.primary?.action).toEqual({ type: 'check-backup-code' });
    // Clé par année : un « Plus tard » de l'an passé ne le cache pas l'année suivante.
    expect(buildHomeTodos(base({ now: new Date(2027, 9, 20), lastExportAt: '2027-10-01', backupCodeCheckDue: true }))[0].key).toBe('backup-code-check-2027');
    expect(buildHomeTodos(base({ backupCodeCheckDue: false }))).toEqual([]);
    // Sans accès aux Paramètres depuis l'écran, pas de tâche impossible à faire.
    expect(buildHomeTodos(base({ backupCodeCheckDue: true, can: { ...can, openSettings: false } }))).toEqual([]);
  });

  it('offers « Taux inchangé » only when the screen can note it on the accounts', () => {
    const march = base({ now: new Date(2027, 2, 5), avRatesDue: [acc('av', AccountType.ASSURANCE_VIE, 10)], can: { ...can, updateAccounts: false } });
    const todo = buildHomeTodos(march).find(t => t.key === 'av-rate-2027');
    expect(todo?.secondary).toBeUndefined();
    expect(todo?.primary?.action).toEqual({ type: 'navigate', view: 'accounts' });
  });

  it('hides dismissed reminders and actions the screen cannot run', () => {
    const todos = buildHomeTodos(base({
      can: { ...can, navigate: false, recordRecurring: false, exportData: false },
      daysSinceUpdate: 25,
      dueRecurring: [{ recurring: { id: 'r1', label: 'x', amount: 1, type: 'OUT', accountId: 'z', dayOfMonth: 1, active: true }, dueDate: '2026-10-01' }],
      staleRates: { revision: { key: '2026-08', label: 'août' }, accounts: [] },
      dismissedRateRevision: '2026-08',
      taxReturnAlert: { key: 'tax-return-2025', incomeYear: 2025, title: 'Déclaration', detail: 'd' } as never,
      taxReturnFiled: '2025',
      lastExportAt: undefined,
    }));
    expect(todos.map(t => t.key)).toEqual(['stale-update']);
    expect(todos[0].primary).toBeUndefined();
  });

  it('drops a ceiling percentage when a « livret full » forecast covers the same booklet', () => {
    const alerts: Alert[] = [{ id: 'livret-full-la', kind: 'livret-full', tone: 'info', title: 'Plein bientôt', detail: '', accountId: 'la', action: { label: 'Voir le plan', view: 'pilot' } }];
    const todos = buildHomeTodos(base({
      ceilingAlerts: [{ id: 'la', name: 'Livret A', pct: 93, remaining: 1600 }, { id: 'ldds', name: 'LDDS', pct: 96, remaining: 480 }],
      alerts,
    }));
    expect(todos.map(t => t.key)).toEqual(['ceiling-ldds-19', 'livret-full-la']);
    expect(todos[0].text).toMatch(/^LDDS est rempli à 96 % : il reste 480\s€ avant le plafond\.$/);
    expect(todos[1].icon).toBe('alert');
    expect(todos[1].primary?.action).toEqual({ type: 'navigate', view: 'pilot' });
  });

  it('offers the tax-return helper and the LEP timeline', () => {
    const todos = buildHomeTodos(base({
      taxReturnAlert: { key: 'tax-return-2025', incomeYear: 2025, title: 'Déclaration de revenus 2025', detail: 'Avant le 28 mai.' } as never,
      lepTimeline: { ceiling: 22823, years: [], status: 'closing', closeBy: '2027-01-01', estimated: true },
    }));
    const lep = todos.find(t => t.key.startsWith('lep-'))!;
    expect(lep.tone).toBe('action');
    expect(lep.primary).toEqual({ label: 'Importer mon avis', action: { type: 'navigate', view: 'settings' } });
    const tr = todos.find(t => t.key === 'tax-return-2025')!;
    expect(tr.primary?.action).toEqual({ type: 'show-tax-return' });
    expect(tr.secondary?.action).toEqual({ type: 'mark-tax-return-filed', incomeYear: 2025 });
  });

  it('les taux ont changé (veille fiscale) : une tâche qui remplace le rappel de révision', () => {
    const rateChanges = [
      { group: 'livretA', groupLabel: 'Livret A et LDDS', current: 1.7, value: 1.5, effectiveDate: '2027-02-01' },
      { group: 'lep', groupLabel: 'LEP', current: 2.7, value: 2.5, effectiveDate: '2026-11-01' },
    ];
    const staleRates = { revision: { key: '2026-08', label: '1er août 2026' }, accounts: [{ name: 'Livret A' }] };
    const todos = buildHomeTodos(base({ rateChanges, staleRates, can: { ...can, rateChanges: true } }));
    const t = todos.find(x => x.key === 'rate-changes')!;
    expect(t.text).toBe('Les taux ont changé : Livret A et LDDS 1,7 % → 1,5 % au 1er février 2027 ; LEP 2,7 % → 2,5 % au 1er novembre.');
    expect(t.pinned).toBe(true);
    expect(t.primary).toEqual({ label: 'Voir et appliquer', action: { type: 'open-rate-changes' } });
    expect(todos.some(x => x.key === 'rates')).toBe(false);
    // Sans feuille, pas de bouton ; sans proposition, le rappel de révision revient.
    expect(buildHomeTodos(base({ rateChanges })).find(x => x.key === 'rate-changes')!.primary).toBeUndefined();
    expect(buildHomeTodos(base({ rateChanges: [], staleRates })).map(x => x.key)).toEqual(['rates']);
  });

  it('retrait prévu (« J’ai besoin d’argent ») : une tâche le jour venu, « Enregistrer » ou « Supprimer »', () => {
    const la = acc('la', AccountType.LIVRET_A, 1000, { name: 'Livret A' });
    const av = acc('av', AccountType.ASSURANCE_VIE, 3000, { name: 'Assurance vie' });
    const plan = { id: 'p1', date: '2026-10-16', needDate: '2026-10-20', lines: [{ accountId: 'la', amount: 800 }, { accountId: 'av', amount: 200 }, { accountId: 'parti', amount: 50 }] };
    const todos = buildHomeTodos(base({ accounts: [la, av], plannedWithdrawals: [plan], can: { ...can, plannedWithdrawals: true } }));
    const t = todos.find(x => x.key === 'withdrawal-p1')!;
    expect(t.text).toMatch(/^Retrait prévu : prendre 800\s€ sur le Livret A, 200\s€ sur l'Assurance vie et 50\s€ sur un compte supprimé, pour le 20 octobre\.$/);
    expect(t.detail).toMatch(/^Fait le 16 octobre ou après/);
    // Un compte supprimé depuis : on ne peut plus enregistrer, seule « Supprimer » reste.
    expect(t.primary).toEqual({ label: 'Supprimer', action: { type: 'delete-planned-withdrawal', id: 'p1' } });
    expect(t.secondary).toBeUndefined();
    const ok = buildHomeTodos(base({ accounts: [la, av], plannedWithdrawals: [{ ...plan, lines: plan.lines.slice(0, 2) }], can: { ...can, plannedWithdrawals: true } })).find(x => x.key === 'withdrawal-p1')!;
    expect(ok.primary).toEqual({ label: 'Enregistrer', action: { type: 'record-planned-withdrawal', id: 'p1' } });
    expect(ok.secondary).toEqual({ label: 'Supprimer', action: { type: 'delete-planned-withdrawal', id: 'p1' } });
    // Jour même du besoin : pas de conseil ; sans gestionnaire, pas de bouton.
    const same = buildHomeTodos(base({ accounts: [la], plannedWithdrawals: [{ ...plan, date: '2026-10-20', lines: [plan.lines[0]] }] })).find(x => x.key === 'withdrawal-p1')!;
    expect(same.detail).toBeUndefined();
    expect(same.primary).toBeUndefined();
  });

  it('sauvegarde de secours en retard ou en échec : une tâche qui renvoie aux Paramètres, sinon rien', () => {
    expect(buildHomeTodos(base({ backupProblem: null }))).toEqual([]);
    const stale = buildHomeTodos(base({ backupProblem: { kind: 'stale', days: 34, never: false } }))[0];
    expect(stale.key).toBe('backup-upload-problem');
    expect(stale.text).toBe('Sauvegarde de secours : dernier envoi il y a 34 jours.');
    expect(stale.primary).toEqual({ label: 'Voir la sauvegarde', action: { type: 'check-backup-code' } });
    const err = buildHomeTodos(base({ backupProblem: { kind: 'error', code: 'OFFLINE', reason: 'Serveur injoignable (hors ligne ?).' } }))[0];
    expect(err.text).toBe('Sauvegarde de secours : le dernier envoi a échoué.');
    expect(err.detail).toMatch(/^Serveur injoignable/);
    expect(buildHomeTodos(base({ backupProblem: { kind: 'stale', days: 34, never: false }, can: { ...can, openSettings: false } }))).toEqual([]);
  });
});

describe("liste « À faire » : avis d'impôt et anniversaire fiscal", () => {
  const can = { navigate: true, recordRecurring: true, deleteAccount: true, updateFiscalConfig: true, updateAccounts: true, openSettings: true, acceptPayRaise: true, dismissPayRaise: true, exportData: true };
  const base = (over: Partial<HomeTodoInput> = {}): HomeTodoInput => ({
    now: new Date(2026, 7, 10), accounts: [], fiscalConfig: fiscal, can,
    daysSinceUpdate: null, dueRecurring: [], lepTimeline: null, staleRates: null, dismissedRateRevision: null, ratesEditorOpen: false,
    parentalYearEnd: null, inactiveEmpty: [], fiscalReview: { annualCheckDue: false }, taxReturnAlert: null, taxReturnFiled: null,
    payRaise: null, avRatesDue: [], ceilingAlerts: [], lastExportAt: '2026-08-01', alerts: [], emergency: null, ...over,
  });
  const notice = (over: Partial<HomeTodoInput> = {}) => buildHomeTodos(base(over)).find(t => t.key.startsWith('tax-notice'));

  it("avis d'impôt : de début août à fin septembre, ouvre la lecture de l'avis (comme « Importer mon avis »)", () => {
    const t = notice()!;
    expect(t.key).toBe('tax-notice-2026');
    expect(t.text).toBe("Votre avis d'impôt est arrivé ?");
    expect(t.primary).toEqual({ label: 'Importer mon avis', action: { type: 'navigate', view: 'settings' } });
    expect(notice({ now: new Date(2026, 7, 1) })).toBeDefined();
    expect(notice({ now: new Date(2026, 8, 30) })).toBeDefined();
  });
  it("avis d'impôt : rien avant août, ni à partir d'octobre", () => {
    expect(notice({ now: new Date(2026, 6, 31) })).toBeUndefined();
    expect(notice({ now: new Date(2026, 9, 1) })).toBeUndefined();
  });
  it("avis d'impôt : disparaît dès que le revenu fiscal de référence de l'année de revenus est saisi", () => {
    expect(notice({ rfrByYear: { '2025': 18000 } })).toBeUndefined();
    expect(notice({ rfrByYear: { '2024': 18000 } })).toBeDefined();
    const lepTimeline = { ceiling: 30000, years: [{ year: 2025, rfr: 18000, source: 'avis' as const, over: false }], status: 'ok' as const, estimated: false };
    expect(notice({ lepTimeline })).toBeUndefined();
    const estimated = { ...lepTimeline, years: [{ year: 2025, rfr: 18000, source: 'fiches' as const, over: false }] };
    expect(notice({ lepTimeline: estimated })).toBeDefined();
  });

  const pea = acc('pea', AccountType.PEA, 5000, { name: 'PEA Bourse', openingDate: '2021-08-05' });
  const av = acc('av', AccountType.ASSURANCE_VIE, 8000, { name: 'Contrat vie', openingDate: '2018-08-20' });
  const anniversaries = (now: Date, accounts: SavingsAccount[]) => buildHomeTodos(base({ now, accounts })).filter(t => t.key.startsWith('fiscal-anniversary'));

  it('anniversaire fiscal : le jour des 5 ans du PEA, avec ce que ça change', () => {
    const [t] = anniversaries(new Date(2026, 7, 5), [pea]);
    expect(t.key).toBe('fiscal-anniversary-pea-2026-08-05');
    expect(t.text).toBe("Anniversaire fiscal : PEA Bourse a 5 ans aujourd'hui.");
    expect(t.detail).toMatch(/^Ce que ça change : Gains sans impôt sur le revenu ; les prélèvements sociaux/);
    expect(t.tone).toBe('info');
  });
  it('anniversaire fiscal : assurance vie à 8 ans, affichée 30 jours puis retirée', () => {
    const [t] = anniversaries(new Date(2026, 7, 20), [av]);
    expect(t.text).toContain('Contrat vie a 8 ans');
    expect(t.detail).toContain('Impôt sur le revenu réduit');
    expect(anniversaries(new Date(2026, 8, 18), [av])).toHaveLength(1); // 29e jour
    expect(anniversaries(new Date(2026, 8, 19), [av])).toHaveLength(0); // 30e jour
    expect(anniversaries(new Date(2026, 7, 19), [av])).toHaveLength(0); // la veille
  });
  it("anniversaire fiscal : pas pour un compte vide, sans date d'ouverture, ni pour un livret", () => {
    expect(anniversaries(new Date(2026, 7, 5), [{ ...pea, totalAmount: 0, ownedAmount: 0 }])).toEqual([]);
    expect(anniversaries(new Date(2026, 7, 5), [{ ...pea, openingDate: undefined }])).toEqual([]);
    expect(anniversaries(new Date(2026, 7, 5), [acc('la', AccountType.LIVRET_A, 1000, { openingDate: '2021-08-05' })])).toEqual([]);
  });
});
