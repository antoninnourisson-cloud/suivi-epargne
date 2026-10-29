import { describe, it, expect } from 'vitest';
import {
  freshnessLimitDays, lastBalanceCheck, balanceFreshness, findStaleBalances, describeCheckAge, describeStaleBalances,
  isRecentlyChecked, CURRENT_ACCOUNT_FRESH_DAYS, offersBalanceCheck,
} from './freshness';
import { buildHomeTodos, type HomeTodoInput } from './home';
import { formatISODay } from './dates';
import { findFiscalReview } from './finance';
import { DEFAULT_FISCAL_CONFIG } from '../constants';
import { AccountMovement, AccountType, SavingsAccount } from '../types';

const NOW = new Date(2026, 9, 21); // 21 octobre 2026
const mv = (date: string, label = 'Épargne du mois', over: Partial<AccountMovement> = {}): AccountMovement =>
  ({ id: `${date}-${label}`, date, amount: 10, type: 'IN', label, ...over });
const acc = (over: Partial<SavingsAccount>): SavingsAccount => ({
  id: 'a', name: 'Livret A', type: AccountType.LIVRET_A, institution: 'B', totalAmount: 100, ownedAmount: 100, parentalCapital: 0, movements: [], ...over,
});

describe('délai par type de compte', () => {
  it('compte courant 30 jours, livrets 90, placements à relevé annuel 400, immobilier jamais', () => {
    expect(freshnessLimitDays(AccountType.COMPTE_COURANT)).toBe(30);
    expect(freshnessLimitDays(AccountType.LIVRET_A)).toBe(90);
    expect(freshnessLimitDays(AccountType.LIVRET_BANCAIRE)).toBe(90);
    expect(freshnessLimitDays(AccountType.CRYPTO)).toBe(90);
    expect(freshnessLimitDays(AccountType.ASSURANCE_VIE)).toBe(400);
    expect(freshnessLimitDays(AccountType.PEL)).toBe(400);
    expect(freshnessLimitDays(AccountType.IMMOBILIER)).toBeNull();
  });
});

describe('dernier solde constaté', () => {
  it("un versement prévu ne compte pas ; une actualisation, un solde initial, une valorisation, si", () => {
    expect(lastBalanceCheck(acc({ movements: [mv('2026-10-01')] }), '2026-10-21')).toBeUndefined();
    expect(lastBalanceCheck(acc({ movements: [mv('2026-10-01'), mv('2026-09-01', 'Actualisation (+)')] }), '2026-10-21')).toBe('2026-09-01');
    expect(lastBalanceCheck(acc({ movements: [mv('2025-01-01', 'Solde initial', { tag: 'initial' })] }), '2026-10-21')).toBe('2025-01-01');
    expect(lastBalanceCheck(acc({ movements: [mv('2026-03-01', 'Valorisation (+)', { kind: 'valuation' })] }), '2026-10-21')).toBe('2026-03-01');
  });

  it('la date enregistrée prime si elle est plus récente ; une date future vaut aujourd’hui', () => {
    expect(lastBalanceCheck(acc({ balanceCheckedAt: '2026-10-10', movements: [mv('2026-09-01', 'Actualisation (+)')] }), '2026-10-21')).toBe('2026-10-10');
    expect(lastBalanceCheck(acc({ balanceCheckedAt: '2026-08-10', movements: [mv('2026-09-01', 'Actualisation (+)')] }), '2026-10-21')).toBe('2026-09-01');
    expect(lastBalanceCheck(acc({ balanceCheckedAt: '2026-12-01' }), '2026-10-21')).toBe('2026-10-21');
  });
});

describe('comptes à revérifier', () => {
  it('à revérifier dès le délai atteint, ou jamais vérifié', () => {
    expect(balanceFreshness(acc({ type: AccountType.COMPTE_COURANT, balanceCheckedAt: '2026-09-22' }), NOW)).toMatchObject({ days: 29, stale: false });
    expect(balanceFreshness(acc({ type: AccountType.COMPTE_COURANT, balanceCheckedAt: '2026-09-21' }), NOW)).toMatchObject({ days: 30, stale: true });
    expect(balanceFreshness(acc({}), NOW)).toMatchObject({ checkedOn: undefined, days: null, stale: true });
    expect(balanceFreshness(acc({ type: AccountType.IMMOBILIER }), NOW)).toMatchObject({ limit: null, stale: false });
  });

  it('le plus en retard d’abord, jamais vérifié en tête ; compte vide ignoré', () => {
    const list = findStaleBalances([
      acc({ id: 'cc', name: 'Compte courant', type: AccountType.COMPTE_COURANT, balanceCheckedAt: '2026-08-01' }), // 81 j, 51 de retard
      acc({ id: 'la', name: 'Livret A', balanceCheckedAt: '2026-01-01' }), // 293 j, 203 de retard
      acc({ id: 'n', name: 'LDDS', type: AccountType.LDDS }), // jamais
      acc({ id: 'ok', name: 'LEP', type: AccountType.LEP, balanceCheckedAt: '2026-10-01' }),
      acc({ id: 'vide', name: 'Vide', totalAmount: 0, ownedAmount: 0 }),
    ], NOW);
    expect(list.map(s => s.id)).toEqual(['n', 'la', 'cc']);
  });

  it('compte vidé (restitution, fermeture) : plus de rappel, même avec des mouvements', () => {
    const emptied = acc({
      id: 'old', name: 'Ancien livret', type: AccountType.LIVRET_BANCAIRE, totalAmount: 0, ownedAmount: 0,
      movements: [mv('2025-01-01', 'Solde initial', { amount: 500, tag: 'initial' }), mv('2025-02-01', 'Retrait', { amount: 500, type: 'OUT' })],
    });
    expect(findStaleBalances([emptied], NOW)).toEqual([]);
  });

  it('« Confirmer le solde » proposé : solde à revérifier, ou compte courant au-delà de 15 jours', () => {
    const cc = (days: number | null) => {
      const a = acc({ type: AccountType.COMPTE_COURANT, balanceCheckedAt: days === null ? undefined : formatISODay(new Date(2026, 9, 21 - days)) });
      return offersBalanceCheck(a.type, balanceFreshness(a, NOW));
    };
    expect(cc(0)).toBe(false);
    expect(cc(CURRENT_ACCOUNT_FRESH_DAYS)).toBe(false);
    expect(cc(20)).toBe(true);
    expect(cc(null)).toBe(true);
    const livret = acc({ balanceCheckedAt: '2026-09-01' });
    expect(offersBalanceCheck(livret.type, balanceFreshness(livret, NOW))).toBe(false);
    const oldLivret = acc({ balanceCheckedAt: '2026-01-01' });
    expect(offersBalanceCheck(oldLivret.type, balanceFreshness(oldLivret, NOW))).toBe(true);
  });

  it('phrases du rappel', () => {
    expect(describeCheckAge(null)).toBe('jamais vérifié');
    expect(describeCheckAge(0)).toBe("vérifié aujourd'hui");
    expect(describeCheckAge(1)).toBe('vérifié hier');
    expect(describeCheckAge(41)).toBe('vérifié il y a 41 jours');
    expect(describeCheckAge(122)).toBe('vérifié il y a 4 mois');
    const s = (name: string, days: number | null) => ({ id: name, name, type: AccountType.LIVRET_A, days, limit: 90, stale: true });
    expect(describeStaleBalances([])).toBeNull();
    expect(describeStaleBalances([s('LEP', 122)])).toBe('Solde à vérifier : LEP (vérifié il y a 4 mois).');
    expect(describeStaleBalances([s('A', null), s('B', 95)])).toBe('Soldes à vérifier : A (jamais vérifié) et B (vérifié il y a 3 mois).');
    expect(describeStaleBalances([s('A', null), s('B', null), s('C', null), s('D', null), s('E', null)]))
      .toBe('Soldes à vérifier : A (jamais vérifié), B (jamais vérifié), C (jamais vérifié) et 2 autres.');
  });

  it('solde récent du compte courant (argent qui dort)', () => {
    expect(CURRENT_ACCOUNT_FRESH_DAYS).toBe(15);
    expect(isRecentlyChecked(acc({ balanceCheckedAt: '2026-10-06' }), 15, NOW)).toBe(true);
    expect(isRecentlyChecked(acc({ balanceCheckedAt: '2026-10-05' }), 15, NOW)).toBe(false);
    expect(isRecentlyChecked(acc({}), 15, NOW)).toBe(false);
  });
});

describe('« À faire » de l’Accueil', () => {
  const input = (over: Partial<HomeTodoInput>): HomeTodoInput => ({
    now: NOW, accounts: [], fiscalConfig: DEFAULT_FISCAL_CONFIG,
    can: { navigate: true, recordRecurring: false, deleteAccount: false, updateFiscalConfig: false, updateAccounts: false, openSettings: false, acceptPayRaise: false, dismissPayRaise: false, exportData: false },
    daysSinceUpdate: null, dueRecurring: [], lepTimeline: null, staleRates: null, dismissedRateRevision: null, ratesEditorOpen: false,
    parentalYearEnd: null, inactiveEmpty: [], fiscalReview: findFiscalReview({ ...DEFAULT_FISCAL_CONFIG, paramsReviewedYear: 2026 }, NOW),
    taxReturnAlert: null, taxReturnFiled: null, payRaise: null, avRatesDue: [], ceilingAlerts: [], alerts: [], emergency: null,
    ...over,
  });

  it('nomme les comptes à revérifier, avec « Actualiser » et « Voir les comptes »', () => {
    const accounts = [acc({ id: 'lep', name: 'LEP', type: AccountType.LEP, balanceCheckedAt: '2026-06-23' })];
    const todo = buildHomeTodos(input({ accounts, staleBalances: findStaleBalances(accounts, NOW), daysSinceUpdate: 2 })).find(t => t.key === 'stale-update')!;
    expect(todo.text).toBe('Solde à vérifier : LEP (vérifié il y a 4 mois).');
    expect(todo.primary?.label).toBe('Actualiser');
    expect(todo.secondary).toEqual({ label: 'Voir les comptes', action: { type: 'navigate', view: 'accounts' } });
  });

  it("rien quand tout est à jour, même si le dernier mouvement est ancien", () => {
    expect(buildHomeTodos(input({ staleBalances: [], daysSinceUpdate: 60 })).some(t => t.key === 'stale-update')).toBe(false);
  });
});
