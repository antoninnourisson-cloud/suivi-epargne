// Propriétés des intérêts (fast-check) : des centaines de comptes tirés au hasard, et des
// règles vraies par construction du calcul (quinzaines pour les livrets, prorata journalier
// pour les autres) :
// - jamais NaN, infini ni négatif ;
// - un taux plus haut ne donne jamais moins d'intérêts ;
// - un mouvement de 0 € ne change rien ;
// - l'ordre dans lequel les mouvements sont rangés ne change rien (donc, en particulier, l'ordre
//   de plusieurs mouvements d'un même jour) ;
// - le taux moyen d'une période reste entre le plus bas et le plus haut taux connus.
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { AccountMovement, AccountType } from '../../types';
import { averageRateBetween, computeAccruedInterest } from './interest';

const RUNS = { numRuns: 120 };
const ASOF = new Date(2026, 10, 5);
const iso = (n: number) => {
  const d = new Date(2026, 0, 1 + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const cents = (max: number) => fc.integer({ min: 0, max: max * 100 }).map(c => c / 100);
const rate = fc.integer({ min: 0, max: 200 }).map(n => n / 20); // 0 à 10 %, par pas de 0,05
const type = fc.constantFrom(AccountType.LIVRET_A, AccountType.LDDS, AccountType.LEP, AccountType.ASSURANCE_VIE, AccountType.LIVRET_BANCAIRE);
const movement = fc.record({
  day: fc.integer({ min: -60, max: 330 }),
  amount: cents(5000),
  type: fc.constantFrom<'IN' | 'OUT'>('IN', 'OUT'),
}).map((m): AccountMovement => ({ id: `m-${m.day}-${m.amount}-${m.type}`, date: iso(m.day), amount: m.amount, label: 'Mouvement', type: m.type }));
const account = fc.record({
  type,
  totalAmount: cents(50_000),
  interestRate: rate,
  movements: fc.array(movement, { maxLength: 8 }),
});

describe('intérêts : propriétés', () => {
  it('jamais NaN, infini ni négatif', () => {
    fc.assert(fc.property(account, a => {
      const v = computeAccruedInterest(a, 2026, ASOF);
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
    }), RUNS);
  });

  it('un taux plus haut ne donne jamais moins d\'intérêts', () => {
    fc.assert(fc.property(account, rate, (a, other) => {
      const [lo, hi] = a.interestRate <= other ? [a.interestRate, other] : [other, a.interestRate];
      const low = computeAccruedInterest({ ...a, interestRate: lo }, 2026, ASOF);
      const high = computeAccruedInterest({ ...a, interestRate: hi }, 2026, ASOF);
      expect(high).toBeGreaterThanOrEqual(low - 1e-9);
    }), RUNS);
  });

  it('un mouvement de 0 € ne change rien', () => {
    fc.assert(fc.property(account, fc.integer({ min: -60, max: 330 }), fc.constantFrom<'IN' | 'OUT'>('IN', 'OUT'), (a, day, kind) => {
      const zero: AccountMovement = { id: 'zero', date: iso(day), amount: 0, label: 'Rien', type: kind };
      const before = computeAccruedInterest(a, 2026, ASOF);
      const after = computeAccruedInterest({ ...a, movements: [...a.movements, zero] }, 2026, ASOF);
      expect(after).toBeCloseTo(before, 6);
    }), RUNS);
  });

  it('l\'ordre des mouvements ne change rien (même jour compris)', () => {
    const shuffled = account.chain(a =>
      fc.shuffledSubarray(a.movements, { minLength: a.movements.length, maxLength: a.movements.length }).map(movements => ({ a, movements })));
    fc.assert(fc.property(shuffled, ({ a, movements }) => {
      expect(computeAccruedInterest({ ...a, movements }, 2026, ASOF)).toBeCloseTo(computeAccruedInterest(a, 2026, ASOF), 6);
    }), RUNS);
  });

  it('le taux moyen d\'une période reste entre le plus bas et le plus haut taux connus', () => {
    const history = fc.array(fc.record({ day: fc.integer({ min: -400, max: 330 }), rate }), { maxLength: 4 })
      .map(rows => rows.map(r => ({ date: iso(r.day), rate: r.rate })));
    fc.assert(fc.property(rate, history, fc.integer({ min: -300, max: 300 }), fc.integer({ min: 1, max: 300 }), (current, rateHistory, from, length) => {
      const avg = averageRateBetween({ interestRate: current, rateHistory }, iso(from), iso(from + length));
      const known = [current, ...rateHistory.map(r => r.rate)];
      expect(Number.isFinite(avg)).toBe(true);
      expect(avg).toBeGreaterThanOrEqual(Math.min(...known) - 1e-9);
      expect(avg).toBeLessThanOrEqual(Math.max(...known) + 1e-9);
    }), RUNS);
  });
});
