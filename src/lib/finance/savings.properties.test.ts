// Propriétés de l'épargne du mois et des soldes passés (fast-check) :
// - l'ordre des mouvements (et des comptes) ne change aucun total, même pour un même jour ;
// - un mouvement de 0 € ne change rien ;
// - un virement entre deux comptes d'épargne, le même jour, ne change pas l'épargne du mois ;
// - ni la valorisation d'un placement ni l'argent des parents ne comptent comme épargne.
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { AccountMovement, AccountType } from '../../types';
import { computeAccountBalanceAtDate, computeMonthSavedAmount } from './savings';

const RUNS = { numRuns: 150 };
const ASOF = new Date(2026, 10, 20); // novembre 2026
const iso = (n: number) => {
  const d = new Date(2026, 9, 1 + n); // jour 0 = 1er octobre
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const cents = (max: number) => fc.integer({ min: 0, max: max * 100 }).map(c => c / 100);
const movement = fc.record({
  day: fc.integer({ min: 0, max: 70 }), // du 1er octobre à début décembre : avant, pendant et après le mois
  amount: cents(3000),
  type: fc.constantFrom<'IN' | 'OUT'>('IN', 'OUT'),
  kind: fc.constantFrom<AccountMovement['kind']>(undefined, undefined, undefined, 'valuation', 'parental', 'adjustment'),
}).map((m): AccountMovement => ({ id: `m-${m.day}-${m.amount}-${m.type}`, date: iso(m.day), amount: m.amount, label: 'Mouvement', type: m.type, ...(m.kind ? { kind: m.kind } : {}) }));
const account = fc.record({
  type: fc.constantFrom(AccountType.LIVRET_A, AccountType.LDDS, AccountType.ASSURANCE_VIE, AccountType.COMPTE_COURANT),
  ownedAmount: cents(30_000),
  movements: fc.array(movement, { maxLength: 8 }),
});
const accountList = fc.array(account, { minLength: 1, maxLength: 3 });

const reversed = <T,>(list: T[]) => [...list].reverse();

describe('épargne du mois et soldes passés : propriétés', () => {
  it('l\'ordre des mouvements et des comptes ne change aucun total', () => {
    fc.assert(fc.property(accountList, accs => {
      const flipped = reversed(accs.map(a => ({ ...a, movements: reversed(a.movements) })));
      expect(computeMonthSavedAmount(flipped, ASOF)).toBeCloseTo(computeMonthSavedAmount(accs, ASOF), 6);
      expect(computeAccountBalanceAtDate(flipped, iso(30))).toBeCloseTo(computeAccountBalanceAtDate(accs, iso(30)), 6);
    }), RUNS);
  });

  it('un mouvement de 0 € ne change rien', () => {
    fc.assert(fc.property(accountList, fc.integer({ min: 0, max: 70 }), fc.constantFrom<'IN' | 'OUT'>('IN', 'OUT'), (accs, day, kind) => {
      const zero: AccountMovement = { id: 'zero', date: iso(day), amount: 0, label: 'Rien', type: kind };
      const withZero = accs.map((a, i) => (i === 0 ? { ...a, movements: [...a.movements, zero] } : a));
      expect(computeMonthSavedAmount(withZero, ASOF)).toBeCloseTo(computeMonthSavedAmount(accs, ASOF), 6);
      expect(computeAccountBalanceAtDate(withZero, iso(30))).toBeCloseTo(computeAccountBalanceAtDate(accs, iso(30)), 6);
    }), RUNS);
  });

  it('un virement entre deux comptes d\'épargne ne change pas l\'épargne du mois', () => {
    fc.assert(fc.property(accountList, cents(5000), fc.integer({ min: 31, max: 50 }), (accs, amount, day) => {
      // Jours 31 à 50 : du 1er au 20 novembre, donc dans le mois et pas dans le futur.
      const out: AccountMovement = { id: 'vir-out', date: iso(day), amount, label: 'Virement', type: 'OUT' };
      const into: AccountMovement = { id: 'vir-in', date: iso(day), amount, label: 'Virement', type: 'IN' };
      const moved: typeof accs = [
        { type: AccountType.LIVRET_A, ownedAmount: 0, movements: [out] },
        { type: AccountType.ASSURANCE_VIE, ownedAmount: 0, movements: [into] },
      ];
      expect(computeMonthSavedAmount([...accs, ...moved], ASOF)).toBeCloseTo(computeMonthSavedAmount(accs, ASOF), 6);
    }), RUNS);
  });

  it('valorisation, part des parents et corrections ne comptent pas comme épargne', () => {
    fc.assert(fc.property(accountList, accs => {
      const onlyReal = accs.map(a => ({ ...a, movements: a.movements.filter(m => !m.kind) }));
      expect(computeMonthSavedAmount(accs, ASOF)).toBeCloseTo(computeMonthSavedAmount(onlyReal, ASOF), 6);
    }), RUNS);
  });
});
