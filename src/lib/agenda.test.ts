import { describe, it, expect } from 'vitest';
import { buildAgenda, computeYearReview } from './agenda';
import { AccountType, GlobalAppData, SavingsAccount } from '../types';
import { migrate } from './schema';
import { DEFAULT_FISCAL_CONFIG } from '../constants';

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
    // Le montant de la ligne de paie est ce qu'il faut placer, et la ligne le dit.
    expect(events.find(e => e.kind === 'payday')).toMatchObject({ title: 'Jour de paie', detail: expect.stringMatching(/^Montant à placer/) });
    expect(has('subscription', '2026-10-01')).toBe(true);
    expect(events.filter(e => e.title === 'Navigo').length).toBe(3); // 1er oct, nov, déc : deux mois seulement
    expect(has('subscription', '2027-08-06')).toBe(true);              // annuel : tout l'horizon
    expect(has('restitution', '2027-01-01')).toBe(true);
    expect(has('rates', '2027-02-01')).toBe(true);
    expect(has('review', '2027-01-02')).toBe(true);
    // Paramètres fiscaux : une étape de la clôture de janvier, pas un rendez-vous à part.
    expect(has('fiscal', '2027-01-20')).toBe(false);
    expect(events.map(e => e.date)).toEqual([...events.map(e => e.date)].sort());
  });

  it("un seul rendez-vous de clôture en janvier (plus de relevés à part), absent une fois l'année clôturée", () => {
    const av = acc({ id: 'av', name: 'AV', type: AccountType.ASSURANCE_VIE, totalAmount: 5000, ownedAmount: 5000 });
    const { events } = buildAgenda(base({ accounts: [av] }), NOW);
    const january = events.filter(e => e.date.startsWith('2027-01'));
    expect(january.find(e => e.kind === 'review')).toMatchObject({
      date: '2027-01-02', title: "Clôture de l'année 2026", view: 'history',
      detail: 'Soldes au 31 décembre, intérêts, relevés des placements et taux servi, paramètres fiscaux, bilan et archive, dans Historique',
    });
    expect(january.some(e => e.kind === 'statement')).toBe(false);
    expect(buildAgenda(base({ accounts: [acc({})] }), NOW).events.find(e => e.kind === 'review')?.detail).toBe('Soldes au 31 décembre, intérêts, paramètres fiscaux, bilan et archive, dans Historique');
    const fiscalOn20 = (d: GlobalAppData) => buildAgenda(d, NOW).events.some(e => e.kind === 'fiscal' && e.date === '2027-01-20');
    // Rien à clôturer (aucun compte) : pas de clôture, les paramètres fiscaux restent à part.
    expect(buildAgenda(base(), NOW).events.some(e => e.kind === 'review')).toBe(false);
    expect(fiscalOn20(base())).toBe(true);
    // Année clôturée : plus de clôture ; les paramètres fiscaux reviennent le 20 janvier s'ils restent à vérifier.
    const closed = base({ accounts: [av], config: { ...base().config, yearClosings: { 2026: { closedOn: '2026-12-31' } } } });
    expect(buildAgenda(closed, NOW).events.some(e => e.kind === 'review')).toBe(false);
    expect(fiscalOn20(closed)).toBe(true);
    expect(fiscalOn20({ ...closed, fiscalConfig: { ...DEFAULT_FISCAL_CONFIG, paramsReviewedYear: 2027 } })).toBe(false);
  });

  it("jour de paie : la ligne reprend l'objectif de la paie en cours (somme en plus comprise), pas les suivantes", () => {
    const payDay = new Date(2026, 9, 27, 9); // 27 octobre 2026, jour de paie
    // Réglages au format d'avant le schéma v3, reportés sur la paie par migrate() comme à
    // l'ouverture du fichier.
    const data = migrate(base({
      config: { ...base().config, paydayDay: 27, paydayAmount: 1000, payAdjustment: { period: '2026-10', extra: 300 } },
    }));
    const paydays = buildAgenda(data, payDay).events.filter(e => e.kind === 'payday');
    expect(paydays.map(e => [e.date, e.amount])).toEqual([['2026-10-27', 1300], ['2026-11-27', 1000], ['2026-12-27', 1000]]);

    // Capacité saisie pour cette paie : elle remplace le montant habituel ce jour-là seulement.
    const manual = migrate(base({ config: { ...base().config, paydayDay: 27, paydayAmount: 1000, payAdjustment: { period: '2026-10', capacity: 800 } } }));
    expect(buildAgenda(manual, payDay).events.find(e => e.kind === 'payday')).toMatchObject({ date: '2026-10-27', amount: 800 });

    // Avant la paie, le réglage de la paie précédente ne s'applique pas à la suivante.
    const before = migrate(base({ config: { ...base().config, paydayDay: 27, paydayAmount: 1000, payAdjustment: { period: '2026-09', extra: 300 } } }));
    expect(buildAgenda(before, NOW).events.find(e => e.kind === 'payday')).toMatchObject({ date: '2026-10-27', amount: 1000 });
  });

  it('renvoie à part les maturités fiscales lointaines', () => {
    const data = base({ accounts: [acc({ id: 'av', name: 'AV', type: AccountType.ASSURANCE_VIE, openingDate: '2025-11-28' })] });
    const { events, later } = buildAgenda(data, NOW);
    expect(events.some(e => e.kind === 'maturity')).toBe(false);
    expect(later[0]).toMatchObject({ kind: 'maturity', date: '2033-11-28' });
    expect(later[0].detail).toContain('prélèvements sociaux (17,2 %) toujours dus');
  });

  it('PEE : annonce le déblocage du prochain versement, pas une « maturité fiscale »', () => {
    const pee = acc({ id: 'pee', name: 'PEE', type: AccountType.PEE, openingDate: '2019-01-01', totalAmount: 2000, ownedAmount: 2000, movements: [
      { id: 'a', date: '2019-01-15', amount: 1000, label: 'Versement', type: 'IN' },
      { id: 'b', date: '2022-03-10', amount: 1000, label: 'Intéressement', type: 'IN' },
    ] });
    const { events } = buildAgenda(base({ accounts: [pee] }), NOW);
    const e = events.find(x => x.kind === 'maturity');
    expect(e).toMatchObject({ date: '2027-03-10', title: 'PEE : versements débloqués', amount: 1000, detail: 'Tout votre plan devient disponible' });
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
    // Livret A à 2 %, règle des quinzaines : 1 000 € sur les 24 quinzaines (20 €), + 500 € à
    // partir du 16 février sur 21 quinzaines (8,75 €), − 100 € à partir du 1er mai sur 16
    // quinzaines (− 1,33 €) : 27,42 €.
    expect(r.interest).toBeCloseTo(20 + 8.75 - 100 * 0.02 * 16 / 24, 10);
    expect(r.interest).toBeCloseTo(27.42, 2);
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

describe('bilan : relevés mensuels et écart', () => {
  it("part du relevé mensuel et signale l'écart avec les mouvements", () => {
    const la = acc({ id: 'la', totalAmount: 5000, ownedAmount: 5000, movements: [{ id: '1', date: '2026-03-01', amount: 4000, label: 'x', type: 'IN' }] });
    const data = base({ accounts: [la], history: [{ date: '2026-01-28', totalAmount: 3000, ownedAmount: 3000 }] });
    const r = computeYearReview(data, 2026, new Date(2026, 9, 1));
    expect(r.netStart).toBe(3000);
    expect(r.netStartDate).toBe('2026-01-28');
    expect(r.unexplainedGap).toBe(-2000); // +2 000 réels contre +4 000 de mouvements
  });
});
