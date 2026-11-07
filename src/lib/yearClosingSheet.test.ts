// Feuille « Clôture de l'année » : calculé et crédité, écart et sa phrase au-delà de 5 €,
// saisies → une seule demande, récapitulatif de restitution, objectif ; ligne de l'Accueil.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AccountType, type GlobalAppData, type SavingsAccount } from '../types';
import { buildClosingSheet, closingSheetInput, creditedText, interestGap, readGoal, stepFilledOnScreen, INTEREST_GAP_CAUSES, type ClosingDrafts } from './yearClosingSheet';
import { recordYearClosing, yearClosingSummary } from './commands';
import { applyPatch } from './commands/testHelpers';
import { yearGoalProgress } from './yearGoal';
import { yearGoalLine } from '../components/dashboard/SavingsCard';
import { computeAccruedParentalInterest } from './finance';

const JAN = new Date(2027, 0, 10, 12);
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(JAN); });
afterEach(() => { vi.useRealTimers(); });

const acc = (over: Partial<SavingsAccount>): SavingsAccount => ({
  id: 'la', name: 'Livret A', type: AccountType.LIVRET_A, institution: 'Banque', totalAmount: 10000, ownedAmount: 10000, parentalCapital: 0,
  interestRate: 3, openingDate: '2020-01-01', balanceCheckedAt: '2026-12-10',
  movements: [{ id: 'i', date: '2020-01-01', amount: 10000, label: 'Solde initial', type: 'IN', tag: 'initial' }],
  ...over,
});
const data = (accounts: SavingsAccount[], config: Partial<GlobalAppData['config']> = {}): GlobalAppData => ({
  accounts, expenses: [], history: [],
  config: { grossAnnual: 0, leisureBudget: 0, projectSavings: 0, taxRateManual: 0, extraMonthlyIncome: 0, ...config },
});
const EMPTY: ClosingDrafts = { credited: {}, values: {}, deposits: {}, unchanged: [], rates: {} };

describe('interestGap', () => {
  it('rien quand c\'est le calcul ; l\'écart en euros, puis la cause au-delà de 5 €', () => {
    expect(interestGap(168.4, 168.4)).toEqual({ amount: 0, text: null, causes: null });
    const less = interestGap(168.4, 166.1);
    expect(less.amount).toBe(-2.3);
    expect(less.text).toMatch(/^2,30\s€ de moins que prévu$/);
    expect(less.causes).toBeNull();
    expect(interestGap(168.4, 169.5).text).toMatch(/^1,10\s€ de plus que prévu$/);
    expect(interestGap(168.4, 160).causes).toBe(INTEREST_GAP_CAUSES);
    expect(interestGap(168.4, 173.4).causes).toBeNull();
  });
});

describe('buildClosingSheet', () => {
  it('calculé par Pécule (la proposition d\'Actualiser), soldes au 31 décembre, objectif prérempli', () => {
    const m = buildClosingSheet(data([acc({})]), 2026, JAN);
    expect(m.interest).toEqual([{ accountId: 'la', name: 'Livret A', computed: 300, done: false, recorded: 0 }]);
    expect(m.balances).toEqual([expect.objectContaining({ accountId: 'la', atYearEnd: 10000, done: false })]);
    expect(m.goal).toEqual({ year: 2027, suggested: 0, saved: 0 });
    expect(buildClosingSheet(data([acc({})], { yearGoals: { 2027: 9000 } }), 2026, JAN).goal.current).toBe(9000);
  });

  it('restitution : capital des parents par compte, total, intérêts produits par leur capital (calcul de décembre)', () => {
    const accounts = [
      acc({ totalAmount: 9460, ownedAmount: 5000, parentalCapital: 4460 }),
      acc({ id: 'lep', name: 'LEP', type: AccountType.LEP, totalAmount: 5000, ownedAmount: 0, parentalCapital: 5000, movements: [] }),
    ];
    const r = buildClosingSheet(data(accounts), 2026, JAN).restitution!;
    expect(r.accounts).toEqual([{ name: 'Livret A', amount: 4460 }, { name: 'LEP', amount: 5000 }]);
    expect(r.total).toBe(9460);
    expect(r.parentalInterest).toBeCloseTo(computeAccruedParentalInterest(accounts, 2026, new Date(2027, 0, 1)).totalAnnualParental, 6);
    expect(r.parentalInterest).toBeGreaterThan(1);
    // Restitution faite : plus de récapitulatif.
    const done = { ...data(accounts), parentalRestitution: { done: { date: '2027-01-01', accounts: [{ accountId: 'la', amount: 4460 }], interestsOffered: [] } } } as unknown as GlobalAppData;
    expect(buildClosingSheet(done, 2026, JAN).restitution).toBeNull();
  });
});

describe("objectif proposé : le plan de l'app, sinon le mis de côté", () => {
  it('avec un plan (rythme du Pilotage) : douze mois, et le mis de côté en repère', () => {
    const accounts = [acc({ movements: [...acc({}).movements, { id: 'v', date: '2026-05-05', amount: 4820, label: 'Versement', type: 'IN' }] })];
    const m = buildClosingSheet(data(accounts, { paydayAmount: 771 }), 2026, JAN);
    expect(m.goal).toEqual({ year: 2027, suggested: 9252, saved: 4820, monthly: 771 });
    // Un objectif déjà enregistré reste l'objectif ; le repère est toujours là.
    expect(buildClosingSheet(data(accounts, { paydayAmount: 771, yearGoals: { 2027: 8000 } }), 2026, JAN).goal).toEqual({ year: 2027, current: 8000, suggested: 9252, saved: 4820, monthly: 771 });
  });

  it("sans plan : le mis de côté de l'année écoulée, comme avant", () => {
    const accounts = [acc({ movements: [...acc({}).movements, { id: 'v', date: '2026-05-05', amount: 4820, label: 'Versement', type: 'IN' }] })];
    const m = buildClosingSheet(data(accounts), 2026, JAN);
    expect(m.goal.suggested).toBe(4820);
    expect(m.goal.monthly).toBeUndefined();
  });
});

describe('intérêts saisis différents du calcul (le scénario de la répétition)', () => {
  const ldds = () => acc({
    id: 'ldds', name: 'LDDS', type: AccountType.LDDS, totalAmount: 3000, ownedAmount: 3000, interestRate: 1.43,
    movements: [{ id: 'i', date: '2020-01-01', amount: 3000, label: 'Solde initial', type: 'IN', tag: 'initial' }],
  });

  it("« Inchangé » puis intérêts corrigés à l'étape 2 : enregistrés une fois, jamais d'écart reproposé", () => {
    const accounts = [ldds()];
    const m = buildClosingSheet(data(accounts), 2026, JAN);
    const computed = m.interest[0].computed;
    expect(computed).toBeGreaterThan(30);
    const credited = Math.round((computed - 1.93) * 100) / 100;
    const r = closingSheetInput(m, accounts, { ...EMPTY, credited: { ldds: creditedText(credited) }, unchanged: ['ldds'] }, '2027-01-10');
    if (!('input' in r)) throw new Error(r.error);
    expect(r.input.updates).toEqual([expect.objectContaining({ accountId: 'ldds', interest: credited, owned: Math.round((3000 + credited) * 100) / 100, confirm: true })]);
    expect(yearClosingSummary(r.input)).toBe('Solde de 1 compte et intérêt de 1 compte enregistrés');

    const done = recordYearClosing({ accounts }, r.input);
    if (!done.ok) throw new Error(done.error);
    const after = applyPatch({ accounts }, done.next).accounts!;
    expect(done.message).toBe('Solde de 1 compte et intérêt de 1 compte enregistrés');

    // Ensuite : la ligne est faite, avec le montant saisi ; l'écart de 1,93 € n'est jamais reproposé.
    const m2 = buildClosingSheet(data(after), 2026, JAN);
    expect(m2.interest[0]).toMatchObject({ done: true, recorded: credited });
    expect(m2.closing.steps.find(x => x.id === 'interest')!.done).toBe(true);
    expect(m2.balances[0].atYearEnd).toBeCloseTo(3000 + credited, 2);
    const again = closingSheetInput(m2, after, EMPTY, '2027-01-10');
    expect(again).toEqual({ input: { updates: [], rates: [], date: '2027-01-10' } });
    // Même en recochant « Inchangé » : aucun intérêt n'est ajouté.
    const confirmOnly = closingSheetInput(m2, after, { ...EMPTY, unchanged: ['ldds'] }, '2027-01-10');
    expect('input' in confirmOnly && confirmOnly.input.updates.every(u => !u.interest)).toBe(true);
  });

  it("compteur de la feuille : une étape est complète à l'écran dès que chaque ligne est faite ou saisie", () => {
    const accounts = [ldds()];
    const m = buildClosingSheet(data(accounts), 2026, JAN);
    expect(stepFilledOnScreen(m, 'balances', EMPTY)).toBe(false);
    expect(stepFilledOnScreen(m, 'balances', { ...EMPTY, unchanged: ['ldds'] })).toBe(true);
    expect(stepFilledOnScreen(m, 'balances', { ...EMPTY, values: { ldds: '3 010' } })).toBe(true);
    expect(stepFilledOnScreen(m, 'balances', { ...EMPTY, values: { ldds: 'abc' } })).toBe(false);
    expect(stepFilledOnScreen(m, 'interest', EMPTY)).toBe(false);
    expect(stepFilledOnScreen(m, 'interest', { ...EMPTY, credited: { ldds: '41' } })).toBe(true);
    expect(stepFilledOnScreen(m, 'review', EMPTY)).toBe(false);
  });
});

describe('closingSheetInput', () => {
  it('intérêt crédité seul : ajouté à votre part, hors épargne, daté du 31 décembre', () => {
    const accounts = [acc({})];
    const m = buildClosingSheet(data(accounts), 2026, JAN);
    const r = closingSheetInput(m, accounts, { ...EMPTY, credited: { la: '297,70' } }, '2027-01-10');
    expect(r).toEqual({ input: { updates: [{ accountId: 'la', date: '2026-12-31', owned: 10297.7, parental: 0, interest: 297.7, interestLabel: 'Intérêts 2026', interestDate: '2026-12-31' }], rates: [], date: '2027-01-10' } });
  });

  it('solde et intérêts du même livret : une seule mise à jour ; illisible : refus', () => {
    const accounts = [acc({})];
    const m = buildClosingSheet(data(accounts), 2026, JAN);
    const r = closingSheetInput(m, accounts, { ...EMPTY, values: { la: '10 350' } }, '2027-01-10');
    expect('input' in r && r.input.updates).toEqual([expect.objectContaining({ owned: 10350, interest: 300, confirm: true })]);
    expect(closingSheetInput(m, accounts, { ...EMPTY, credited: { la: 'abc' } }, '2027-01-10')).toEqual({ error: expect.stringMatching(/^Livret A : intérêts non reconnus/) });
  });

  it('relevé : valeur et versements de l\'année, taux servi', () => {
    const av = acc({ id: 'av', name: 'Assurance vie', type: AccountType.ASSURANCE_VIE, totalAmount: 5000, ownedAmount: 5000, totalDeposits: 4000, interestRate: 2.5, movements: [] });
    const m = buildClosingSheet(data([av]), 2026, JAN);
    expect(m.statements).toEqual([expect.objectContaining({ accountId: 'av', atYearEnd: 5000, depositsOfYear: 0, rate: { current: 2.5, done: false } })]);
    const r = closingSheetInput(m, [av], { ...EMPTY, values: { av: '5 300' }, deposits: { av: '200' }, rates: { av: '2,7' } }, '2027-01-10');
    expect(r).toEqual({ input: {
      updates: [{ accountId: 'av', date: '2026-12-31', owned: 5300, parental: 0, deposits: 4000, cashFlow: 200, confirm: true }],
      rates: [{ accountId: 'av', rate: 2.7 }], date: '2027-01-10',
    } });
  });

  it('readGoal : arrondi à l\'euro, vide = retiré, illisible = undefined', () => {
    expect(readGoal('9 000,40')).toBe(9000);
    expect(readGoal('')).toBeNull();
    expect(readGoal('abc')).toBeUndefined();
  });
});

describe('objectif de l\'année à l\'Accueil', () => {
  it('ligne seulement avec un objectif pour l\'année en cours', () => {
    expect(yearGoalProgress(data([acc({})]), JAN)).toBeNull();
    expect(yearGoalProgress(data([acc({})], { yearGoals: { 2026: 5000 } }), JAN)).toBeNull();
    const accounts = [acc({ movements: [...acc({}).movements, { id: 'v', date: '2027-01-05', amount: 1200, label: 'Versement', type: 'IN' }] })];
    const p = yearGoalProgress(data(accounts, { yearGoals: { 2027: 9000 } }), JAN)!;
    expect(p).toEqual({ year: 2027, goal: 9000, saved: 1200 });
    expect(yearGoalLine(p)).toMatch(/^Objectif 2027 : 1\s200\s€ sur 9\s000\s€$/);
  });
});
