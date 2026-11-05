// Propriétés de la restitution aux parents (fast-check) :
// - le plan ne contient jamais NaN, infini ni négatif, et son total est la somme exacte des
//   capitaux parentaux ;
// - attendre pour rendre l'argent ne fait jamais gagner moins d'intérêts (et en perdre moins
//   par rapport au 1er janvier) : à taux fixe, plus la date est tardive, plus ils augmentent ;
// - après la restitution, il ne reste plus rien aux parents, votre part ne bouge pas, et le
//   mouvement de restitution vaut exactement le capital rendu ;
// - les comptes d'origine ne sont jamais modifiés.
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { AccountType, SavingsAccount } from '../../types';
import { accountsAfterRestitution, computeRestitutionPlan } from './restitution';

const RUNS = { numRuns: 120 };
const iso = (n: number) => {
  const d = new Date(2026, 0, 1 + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const cents = (max: number) => fc.integer({ min: 0, max: max * 100 }).map(c => c / 100);
const accounts = fc.array(fc.record({
  type: fc.constantFrom(AccountType.LIVRET_A, AccountType.LDDS, AccountType.LEP, AccountType.ASSURANCE_VIE, AccountType.LIVRET_BANCAIRE),
  owned: cents(20_000),
  parental: cents(20_000),
  rate: fc.integer({ min: 0, max: 100 }).map(n => n / 20),
}), { minLength: 1, maxLength: 4 }).map((rows): SavingsAccount[] => rows.map((r, i) => ({
  id: `a${i}`, name: `Compte ${i}`, institution: 'Banque', type: r.type, ownedAmount: r.owned, parentalCapital: r.parental,
  totalAmount: Math.round((r.owned + r.parental) * 100) / 100, interestRate: r.rate, movements: [],
})));
// Dates de l'année 2026 hors 1er janvier : toutes comptent les intérêts de 2026.
const day = fc.integer({ min: 31, max: 363 });

describe('restitution aux parents : propriétés', () => {
  it('rien de négatif ni de NaN, total = somme exacte des capitaux parentaux', () => {
    fc.assert(fc.property(accounts, day, (accs, d) => {
      const plan = computeRestitutionPlan(accs, iso(d));
      for (const r of plan.rows) {
        for (const v of [r.amount, r.yearInterest, r.lostVsBest]) {
          expect(Number.isFinite(v)).toBe(true);
          expect(v).toBeGreaterThanOrEqual(0);
        }
      }
      const toCents = (n: number) => Math.round(n * 100);
      expect(toCents(plan.total)).toBe(accs.reduce((s, a) => s + toCents(a.parentalCapital), 0));
      expect(plan.totalInterest).toBeCloseTo(plan.rows.reduce((s, r) => s + r.yearInterest, 0), 6);
    }), RUNS);
  });

  it('attendre ne fait jamais gagner moins d\'intérêts ni en perdre davantage', () => {
    fc.assert(fc.property(accounts, day, day, (accs, a, b) => {
      const [early, late] = a <= b ? [a, b] : [b, a];
      const first = computeRestitutionPlan(accs, iso(early));
      const second = computeRestitutionPlan(accs, iso(late));
      expect(second.totalInterest).toBeGreaterThanOrEqual(first.totalInterest - 1e-9);
      expect(second.totalLost).toBeLessThanOrEqual(first.totalLost + 1e-9);
    }), RUNS);
  });

  it('après la restitution : plus rien aux parents, votre part intacte, mouvement exact', () => {
    fc.assert(fc.property(accounts, day, (accs, d) => {
      const copy = JSON.parse(JSON.stringify(accs)) as SavingsAccount[];
      const after = accountsAfterRestitution(accs, iso(d));
      expect(accs).toEqual(copy); // jamais modifié en place
      after.forEach((a, i) => {
        expect(a.parentalCapital).toBe(0);
        expect(a.ownedAmount).toBe(accs[i].ownedAmount);
        expect(a.totalAmount).toBe(Math.round(accs[i].ownedAmount * 100) / 100);
        if (accs[i].parentalCapital > 0) {
          const out = a.movements.at(-1)!;
          expect(out).toMatchObject({ type: 'OUT', kind: 'parental', tag: 'restitution', date: iso(d), amount: Math.round(accs[i].parentalCapital * 100) / 100 });
        } else {
          expect(a.movements).toEqual(accs[i].movements);
        }
      });
    }), RUNS);
  });
});
