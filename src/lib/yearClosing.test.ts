import { describe, expect, it } from 'vitest';
import { AccountType, type GlobalAppData, type SavingsAccount } from '../types';
import {
  addClosingChecks, buildYearClosing, closingApplies, closingYearOf, isClosingSeason, isYearClosed, remainingSteps, setClosingCheck,
  setYearClosed, yearArchiveCsv, yearClosingStatus, CLOSING_CHECKS, type YearClosing,
} from './yearClosing';
import { hasParentalCapital, hasParentalHistory } from './parentalMode';
import { migrate } from './schema';
import { confirmRatesUnchanged } from './finance';
import { DEFAULT_FISCAL_CONFIG, TAX_SCALES } from '../constants';

const JAN = new Date(2027, 0, 10, 12);
const MARCH = new Date(2027, 2, 10, 12);

const livret = (over: Partial<SavingsAccount> = {}): SavingsAccount => ({
  id: 'la', name: 'Livret A', type: AccountType.LIVRET_A, institution: 'Banque', totalAmount: 10000, ownedAmount: 10000, parentalCapital: 0,
  interestRate: 3, openingDate: '2020-01-01', balanceCheckedAt: '2026-12-10',
  movements: [{ id: 'i', date: '2020-01-01', amount: 10000, label: 'Solde initial', type: 'IN', tag: 'initial' }],
  ...over,
});
const av = (over: Partial<SavingsAccount> = {}): SavingsAccount => ({
  id: 'av', name: 'Assurance vie', type: AccountType.ASSURANCE_VIE, institution: 'Assureur', totalAmount: 5000, ownedAmount: 5000, parentalCapital: 0,
  totalDeposits: 4000, openingDate: '2022-01-01', balanceCheckedAt: '2026-11-01', movements: [],
  ...over,
});
const data = (over: Partial<GlobalAppData> = {}, config: Partial<GlobalAppData['config']> = {}): GlobalAppData => ({
  accounts: [livret()], expenses: [], history: [],
  config: { grossAnnual: 0, leisureBudget: 0, projectSavings: 0, taxRateManual: 0, extraMonthlyIncome: 0, ...config },
  ...over,
});
const step = (c: YearClosing, id: string) => c.steps.find(s => s.id === id);

describe('saison et année', () => {
  it('janvier et février seulement, pour l\'année écoulée', () => {
    expect(isClosingSeason(new Date(2027, 0, 1))).toBe(true);
    expect(isClosingSeason(new Date(2027, 1, 28))).toBe(true);
    expect(isClosingSeason(new Date(2027, 2, 1))).toBe(false);
    expect(closingYearOf(JAN)).toBe(2026);
  });
});

describe('buildYearClosing', () => {
  it('ordonne les étapes et compte ce qui reste, hors la clôture elle-même', () => {
    const c = buildYearClosing(data(), 2026, JAN);
    expect(c.steps.map(s => s.id)).toEqual(['balances', 'interest', 'review', 'tax-return', 'fiscal-params', 'archive', 'close']);
    expect(c).toMatchObject({ year: 2026, done: 0, total: 6 });
    expect(remainingSteps(c)).toContain('Vérifier les soldes au 31 décembre');
    expect(remainingSteps(c)).not.toContain('Clôturer l\'année 2026');
  });

  it('soldes : vérifiés depuis le 31 décembre, compte par compte', () => {
    const todo = step(buildYearClosing(data(), 2026, JAN), 'balances')!;
    expect(todo.done).toBe(false);
    expect(todo.items[0]).toMatchObject({ label: 'Livret A', done: false, detail: 'dernier solde constaté le 10 décembre 2026' });
    expect(todo.detail).toMatch(/^1 compte à vérifier/);
    expect(todo.buttons[0].action).toEqual({ type: 'navigate', view: 'update' });
    const ok = step(buildYearClosing(data({ accounts: [livret({ balanceCheckedAt: '2026-12-31' })] }), 2026, JAN), 'balances')!;
    expect(ok.done).toBe(true);
    expect(ok.items[0].detail).toBe('vérifié le 31 décembre 2026');
    const never = step(buildYearClosing(data({ accounts: [livret({ balanceCheckedAt: undefined, movements: [] })] }), 2026, JAN), 'balances')!;
    expect(never.items[0].detail).toBe('jamais vérifié');
  });

  it('ignore les comptes ouverts après le 31 décembre, l\'immobilier et les comptes vides sans mouvement', () => {
    const accounts = [
      livret({ id: 'new', name: 'Nouveau', openingDate: '2027-01-05' }),
      livret({ id: 'house', name: 'Maison', type: AccountType.IMMOBILIER, interestRate: 0 }),
      livret({ id: 'empty', name: 'Vide', totalAmount: 0, ownedAmount: 0, movements: [] }),
    ];
    const c = buildYearClosing(data({ accounts }), 2026, JAN);
    expect(step(c, 'balances')).toBeUndefined();
    expect(step(c, 'interest')).toBeUndefined();
  });

  it('intérêts : la proposition d\'« Actualiser », éteinte une fois enregistrés hors épargne', () => {
    const todo = step(buildYearClosing(data(), 2026, JAN), 'interest')!;
    expect(todo.title).toBe('Enregistrer les intérêts 2026');
    expect(todo.done).toBe(false);
    expect(todo.items[0].detail).toMatch(/300,00\s€ attendus/);
    expect(todo.detail).not.toContain('parents');
    const recorded = livret({
      totalAmount: 10300, ownedAmount: 10300, balanceCheckedAt: '2027-01-05',
      movements: [...livret().movements!, { id: 'int', date: '2027-01-05', amount: 300, label: 'Intérêts 2026', type: 'IN', kind: 'adjustment' }],
    });
    const done = buildYearClosing(data({ accounts: [recorded] }), 2026, JAN);
    expect(step(done, 'interest')).toMatchObject({ done: true });
    expect(step(done, 'balances')!.done).toBe(true);
    expect(done.done).toBe(2);
  });

  it('intérêts : « Déjà enregistrés » à la main quand l\'app ne peut pas le voir', () => {
    const c = buildYearClosing(data({}, { yearClosings: { 2026: { checked: [CLOSING_CHECKS.interest] } } }), 2026, JAN);
    expect(step(c, 'interest')).toMatchObject({ done: true, check: { checked: true } });
  });

  it('intérêts : au-delà du 31 mars, la proposition reste celle arrêtée au 31 mars', () => {
    const c = buildYearClosing(data(), 2026, new Date(2027, 9, 1));
    expect(step(c, 'interest')!.done).toBe(false);
  });

  it('intérêts : année pas encore terminée, tout reste attendu', () => {
    const c = buildYearClosing(data(), 2027, JAN);
    expect(step(c, 'interest')!.items[0]).toMatchObject({ done: false, detail: expect.stringMatching(/attendus : à enregistrer$/) });
    expect(step(c, 'balances')!.items[0].detail).toBe('dernier solde constaté le 10 décembre 2026');
  });

  it('intérêts : mentionne la part produite par le capital des parents tant qu\'il y en a', () => {
    const shared = livret({ totalAmount: 20000, ownedAmount: 10000, parentalCapital: 10000 });
    const c = buildYearClosing(data({ accounts: [shared] }), 2026, JAN);
    expect(step(c, 'interest')!.detail).toMatch(/Dont environ 300\s€ produits par le capital de vos parents/);
  });

  it('intérêts : seulement les comptes crédités le 31 décembre (pas un compte à terme)', () => {
    const term = livret({ id: 'cat', name: 'Compte à terme', type: AccountType.COMPTE_A_TERME, contractEndDate: '2028-06-30' });
    const pel = livret({ id: 'pel', name: 'PEL', type: AccountType.PEL, interestRate: 2 });
    const current = livret({ id: 'cc', name: 'Compte courant', type: AccountType.COMPTE_COURANT, interestRate: 1 });
    const s = step(buildYearClosing(data({ accounts: [term, pel, current] }), 2026, JAN), 'interest')!;
    expect(s.items.map(i => i.label)).toEqual(['PEL']);
    expect(s.detail).toMatch(/^Ces comptes ont reçu leurs intérêts le 31 décembre/);
    expect(step(buildYearClosing(data({ accounts: [term] }), 2026, JAN), 'interest')).toBeUndefined();
  });

  it('paramètres fiscaux de la nouvelle année : barème à appliquer, puis confirmés', () => {
    const todo = step(buildYearClosing(data(), 2026, JAN), 'fiscal-params')!;
    expect(todo).toMatchObject({ title: 'Paramètres fiscaux 2027', done: false });
    expect(todo.items.map(i => i.key)).toEqual(['fiscal-params']);
    expect(todo.items[0].button).toEqual({ label: 'C\'est à jour', action: { type: 'confirm-fiscal-params', year: 2027 } });
    expect(todo.buttons[0].action).toEqual({ type: 'navigate', view: 'settings' });
    const reviewed = step(buildYearClosing(data({ fiscalConfig: { ...DEFAULT_FISCAL_CONFIG, paramsReviewedYear: 2027 } }), 2026, JAN), 'fiscal-params')!;
    expect(reviewed).toMatchObject({ done: true });
    expect(reviewed.items[0]).toMatchObject({ done: true, detail: 'vérifiés pour 2027', button: undefined });
    // Barème plus récent disponible : à appliquer, même paramètres confirmés.
    const old = { ...DEFAULT_FISCAL_CONFIG, taxBrackets: TAX_SCALES[0].brackets, taxScaleYear: TAX_SCALES[0].year, paramsReviewedYear: 2027 };
    const scale = step(buildYearClosing(data({ fiscalConfig: old }), 2026, JAN), 'fiscal-params')!;
    expect(scale.done).toBe(false);
    expect(scale.items[0]).toMatchObject({ key: 'tax-scale', done: false, button: { label: 'Appliquer', action: { type: 'apply-tax-scale' } } });
  });

  it('relevés : valeur au 31 décembre et taux servi du fonds euros', () => {
    const c = buildYearClosing(data({ accounts: [av()] }), 2026, JAN);
    const s = step(c, 'statements')!;
    expect(s.done).toBe(false);
    expect(s.items.map(i => i.key)).toEqual(['av', 'rate:av']);
    expect(s.items[1].button).toEqual({ label: 'Taux inchangé', action: { type: 'confirm-rate', accountId: 'av' } });
    expect(s.buttons.map(b => b.label)).toEqual(['Actualiser', 'Mes comptes']);
    expect(step(c, 'balances')).toBeUndefined();
    const valued = av({ movements: [{ id: 'v', date: '2026-12-31', amount: 120, label: 'Valorisation', type: 'IN', kind: 'valuation' }] });
    // « Taux inchangé » : noté sur le compte (la même trace que la tâche de l'Accueil).
    const byHand = buildYearClosing(data({ accounts: confirmRatesUnchanged([valued], ['av'], '2027-01-10') }), 2026, JAN);
    expect(step(byHand, 'statements')!.done).toBe(true);
    expect(step(buildYearClosing(data({ accounts: [valued] }), 2026, JAN), 'statements')!.done).toBe(false);
    const newRate = buildYearClosing(data({ accounts: [av({ balanceCheckedAt: '2027-01-08', rateHistory: [{ date: '2027-01-01', rate: 2.5 }] })] }), 2026, JAN);
    expect(step(newRate, 'statements')!.done).toBe(true);
    const reviewed = buildYearClosing(data({ accounts: [av({ balanceCheckedAt: '2027-01-08', rateReviewedAt: '2027-01-08' })] }), 2026, JAN);
    expect(step(reviewed, 'statements')!.done).toBe(true);
  });

  it('relevés : un PEA n\'a pas de taux servi', () => {
    const pea = av({ id: 'pea', name: 'PEA', type: AccountType.PEA });
    const s = step(buildYearClosing(data({ accounts: [pea] }), 2026, JAN), 'statements')!;
    expect(s.items.map(i => i.key)).toEqual(['pea']);
    expect(s.buttons.map(b => b.label)).toEqual(['Actualiser']);
  });

  it('restitution : à faire tant qu\'il reste du capital des parents, faite ensuite, absente en solo', () => {
    const shared = livret({ totalAmount: 15000, ownedAmount: 10000, parentalCapital: 5000 });
    const planned = step(buildYearClosing(data({ accounts: [shared], parentalRestitution: { plannedDate: '2027-01-01' } }), 2026, JAN), 'restitution')!;
    expect(planned).toMatchObject({ done: false });
    expect(planned.detail).toMatch(/^Prévue le 1er janvier : 5\s000\s€ à rendre/);
    expect(planned.buttons[0].action).toEqual({ type: 'navigate', view: 'parental' });
    const unplanned = step(buildYearClosing(data({ accounts: [shared] }), 2026, JAN), 'restitution')!;
    expect(unplanned.detail).toMatch(/de capital de vos parents sur vos comptes/);
    const restitution = { plannedDate: '2027-01-01', done: { date: '2027-01-01', accounts: [{ accountId: 'la', name: 'Livret A', amount: 5000 }], interestsOffered: [{ year: 2026, amount: 150 }] } };
    const done = buildYearClosing(data({ parentalRestitution: restitution }), 2026, JAN);
    expect(step(done, 'restitution')).toMatchObject({ done: true });
    expect(step(done, 'restitution')!.detail).toMatch(/5\s000\s€ rendus le 1er janvier\. Vous continuez en solo\./);
    // Intérêts offerts : le montant noté à la restitution.
    expect(step(done, 'interest')!.detail).toMatch(/Dont environ 150\s€/);
    expect(step(buildYearClosing(data(), 2026, JAN), 'restitution')).toBeUndefined();
    // Prévue des années plus tard : ne bloque pas une clôture d'avant (2025, vue en octobre 2026).
    const later = data({ accounts: [shared], parentalRestitution: { plannedDate: '2027-01-01' } });
    expect(step(buildYearClosing(later, 2025, new Date(2026, 9, 23)), 'restitution')).toBeUndefined();
    // Prévue pendant la saison de clôture (avant mars) : encore de cette clôture ; après, non.
    expect(step(buildYearClosing(data({ accounts: [shared], parentalRestitution: { plannedDate: '2027-02-28' } }), 2026, JAN), 'restitution')).toBeDefined();
    expect(step(buildYearClosing(data({ accounts: [shared], parentalRestitution: { plannedDate: '2027-03-01' } }), 2026, JAN), 'restitution')).toBeUndefined();
    // Restitution d'une année plus ancienne : sans objet pour cette clôture.
    expect(step(buildYearClosing(data({ parentalRestitution: restitution }), 2027, new Date(2028, 0, 10)), 'restitution')).toBeUndefined();
  });

  it('déclaration : points à vérifier et reçus des dons manquants', () => {
    const donations = [
      { id: 'd1', date: '2026-03-01', amount: 100, organization: 'Restos du cœur', rate: 75 as const, receiptReceived: true },
      { id: 'd2', date: '2026-11-20', amount: 50, organization: 'MSF', rate: 66 as const, receiptReceived: false },
    ];
    const s = step(buildYearClosing(data({ donations }), 2026, JAN), 'tax-return')!;
    expect(s.detail).toMatch(/^À vérifier au printemps : /);
    expect(s.items[0]).toMatchObject({ label: 'Reçus fiscaux des dons', done: false, detail: '1 reçu manquant : MSF' });
    expect(s.check).toEqual({ key: 'tax-return', label: 'C\'est noté', checked: false });
    expect(s.buttons[0].action).toEqual({ type: 'show-tax-return' });
    const noted = buildYearClosing(data({ donations }, { yearClosings: { 2026: { checked: ['tax-return'] } } }), 2026, JAN);
    expect(step(noted, 'tax-return')!.done).toBe(true);
  });

  it('archive : faite quand les deux fichiers sont téléchargés ; clôture et réouverture', () => {
    const one = buildYearClosing(data({}, { yearClosings: { 2026: { checked: ['archive-json'] } } }), 2026, JAN);
    expect(step(one, 'archive')!.done).toBe(false);
    expect(step(one, 'archive')!.items.map(i => i.done)).toEqual([true, false]);
    const both = buildYearClosing(data({}, { yearClosings: { 2026: { checked: ['archive-json', 'archive-csv', 'review'], closedOn: '2027-01-12' } } }), 2026, JAN);
    expect(step(both, 'archive')!.done).toBe(true);
    expect(step(both, 'review')!.done).toBe(true);
    expect(step(both, 'close')).toMatchObject({ done: true });
    expect(step(both, 'close')!.detail).toMatch(/^Année clôturée le 12 janvier/);
    expect(step(both, 'close')!.buttons[0].action).toEqual({ type: 'reopen' });
    expect(step(one, 'close')!.buttons[0]).toEqual({ label: 'Clôturer 2026', action: { type: 'close' } });
    expect(both.closedOn).toBe('2027-01-12');
  });
});

describe('enregistrement des coches et de la clôture', () => {
  it('coche, décoche, clôture et rouvre sans toucher aux autres années ni aux champs inconnus', () => {
    const start = { 2025: { closedOn: '2026-01-20' }, 2026: { checked: ['review'], future: 1 } } as Record<string, { closedOn?: string; checked?: string[] }>;
    const a = setClosingCheck(start, 2026, 'tax-return');
    expect(a['2026']).toEqual({ checked: ['review', 'tax-return'], future: 1 });
    expect(a['2025']).toEqual({ closedOn: '2026-01-20' });
    const b = setClosingCheck(a, 2026, 'review', false);
    expect(b['2026'].checked).toEqual(['tax-return']);
    expect(setClosingCheck(b, 2026, 'tax-return', false)['2026']).toEqual({ future: 1 });
    const c = addClosingChecks(undefined, 2026, ['archive-json', 'archive-csv', 'archive-json']);
    expect(c['2026'].checked).toEqual(['archive-json', 'archive-csv']);
    const closed = setYearClosed(c, 2026, '2027-01-12');
    expect(isYearClosed({ yearClosings: closed }, 2026)).toBe(true);
    const reopened = setYearClosed(closed, 2026, null);
    expect(reopened['2026']).toEqual({ checked: ['archive-json', 'archive-csv'] });
    expect(isYearClosed({ yearClosings: reopened }, 2026)).toBe(false);
    expect(isYearClosed(undefined, 2026)).toBe(false);
  });

  it('migrate garde les clôtures lisibles et écarte le reste', () => {
    const m = migrate({
      accounts: [],
      config: { yearClosings: { 2026: { closedOn: '2027-01-12', checked: ['review', 'review', 3, ''], extra: 'x' }, 2025: { closedOn: 'hier' }, abc: { closedOn: '2027-01-01' }, 2024: 'oui' } },
    });
    expect(m.config.yearClosings).toEqual({ 2026: { closedOn: '2027-01-12', checked: ['review'], extra: 'x' }, 2025: {} });
    expect(migrate({ config: { yearClosings: 'non' } }).config.yearClosings).toBeUndefined();
    expect(migrate({ config: { yearClosings: { x: {} } } }).config.yearClosings).toBeUndefined();
    expect(migrate({ config: { yearClosings: { 2026: { checked: 'review' } } } }).config.yearClosings).toEqual({ 2026: {} });
  });
});

describe('closingApplies', () => {
  it('seulement si un compte était suivi au 31 décembre (un compte ajouté en janvier ne compte pas)', () => {
    expect(closingApplies(data(), 2026)).toBe(true);
    // Ajouté le 5 janvier 2027 : son solde initial contient déjà les intérêts 2026.
    const added = livret({ openingDate: '2019-03-01', movements: [{ id: 'i', date: '2027-01-05', amount: 10000, label: 'Solde initial', type: 'IN', tag: 'initial' }] });
    expect(closingApplies(data({ accounts: [added] }), 2026)).toBe(false);
    expect(yearClosingStatus(data({ accounts: [added] }), JAN)).toBeNull();
    expect(step(buildYearClosing(data({ accounts: [added, livret({ id: 'old', name: 'Ancien' })] }), 2026, JAN), 'interest')!.items.map(i => i.label)).toEqual(['Ancien']);
    // Ancien compte sans aucun mouvement : suivi s'il a un solde.
    expect(closingApplies(data({ accounts: [livret({ movements: [] })] }), 2026)).toBe(true);
    // Un relevé mensuel de l'année suffit.
    expect(closingApplies({ accounts: [added], history: [{ date: '2026-06-01', totalAmount: 1, ownedAmount: 1 }] }, 2026)).toBe(true);
  });
});

describe('yearClosingStatus', () => {
  it('avancement en saison, rien à compter hors saison ou une fois clôturée', () => {
    expect(yearClosingStatus(data({ accounts: [] }), JAN)).toBeNull();
    expect(yearClosingStatus(data(), JAN)).toEqual({ year: 2026, closed: false, inSeason: true, done: 0, total: 6 });
    expect(yearClosingStatus(data(), MARCH)).toEqual({ year: 2026, closed: false, inSeason: false, done: 0, total: 0 });
    expect(yearClosingStatus(data({}, { yearClosings: { 2026: { closedOn: '2027-01-12' } } }), JAN)).toEqual({ year: 2026, closed: true, inSeason: true, done: 0, total: 0 });
  });
});

describe('yearArchiveCsv', () => {
  it('mouvements de l\'année dans l\'ordre, puis soldes au 31 décembre', () => {
    const accounts = [
      livret({
        movements: [
          ...livret().movements!,
          { id: 'b', date: '2026-05-02', amount: 200, label: 'Épargne', type: 'IN' },
          { id: 'a', date: '2026-03-01', amount: 50, label: '=Retrait', type: 'OUT' },
          { id: 'n', date: '2027-01-05', amount: 300, label: 'Intérêts 2026', type: 'IN', kind: 'adjustment' },
        ],
        totalAmount: 10450, ownedAmount: 10450,
      }),
      av({ movements: [{ id: 'v', date: '2026-12-31', amount: 120, label: 'Valorisation', type: 'IN', kind: 'valuation' }] }),
      livret({ id: 'new', name: 'Nouveau', openingDate: '2027-01-02' }),
    ];
    const { fileName, rows } = yearArchiveCsv({ accounts }, 2026);
    expect(fileName).toBe('pecule-2026-mouvements-et-soldes.csv');
    expect(rows[1]).toEqual(['Date', 'Compte', 'Établissement', 'Libellé', 'Nature', 'Montant (€)']);
    expect(rows.slice(2, 5)).toEqual([
      ['2026-03-01', 'Livret A', 'Banque', '=Retrait', 'Retrait', '-50,00'],
      ['2026-05-02', 'Livret A', 'Banque', 'Épargne', 'Versement', '200,00'],
      ['2026-12-31', 'Assurance vie', 'Assureur', 'Valorisation', 'Variation de valeur', '120,00'],
    ]);
    expect(rows[6]).toEqual(['Soldes au 31/12/2026']);
    expect(rows[7]).toEqual(['Compte', 'Type', 'Établissement', 'Solde (€)']);
    // Les intérêts crédités en janvier 2027 ne sont pas dans le solde au 31/12/2026.
    expect(rows[8]).toEqual(['Livret A', 'Livret A', 'Banque', '10150,00']);
    expect(rows).toHaveLength(10);
  });

  it('colonnes des parents seulement s\'ils avaient du capital ce jour-là', () => {
    const shared = livret({
      totalAmount: 10000, ownedAmount: 10000, parentalCapital: 0,
      movements: [...livret().movements!, { id: 'r', date: '2027-01-01', amount: 4000, label: 'Restitution aux parents', type: 'OUT', kind: 'parental', tag: 'restitution' }],
    });
    const { rows } = yearArchiveCsv({ accounts: [shared] }, 2026);
    expect(rows.find(r => r[0] === 'Compte')).toEqual(['Compte', 'Type', 'Établissement', 'Votre part (€)', 'Part des parents (€)', 'Total (€)']);
    expect(rows[rows.length - 1]).toEqual(['Livret A', 'Livret A', 'Banque', '10000,00', '4000,00', '14000,00']);
    expect(rows.find(r => r[0] === '2027-01-01')).toBeUndefined();
  });
});

describe('parentalMode', () => {
  it('capital des parents présent, puis historique seulement', () => {
    expect(hasParentalCapital([{ parentalCapital: 0 }, { parentalCapital: 10 }])).toBe(true);
    expect(hasParentalCapital([{ parentalCapital: 0 }])).toBe(false);
    expect(hasParentalHistory([{ parentalCapital: 0, movements: [{ kind: 'parental' }] }])).toBe(true);
    expect(hasParentalHistory([{ parentalCapital: 0, movements: [] }], { done: { date: '2027-01-01', accounts: [], interestsOffered: [] } })).toBe(true);
    expect(hasParentalHistory([{ parentalCapital: 0, movements: [{}] }])).toBe(false);
  });
});
