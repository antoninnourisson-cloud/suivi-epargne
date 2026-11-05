// Propriétés du plan de placement (fast-check) :
// - les parts d'un versement font le total au centime près (plan automatique ET répartition
//   personnalisée), sans part négative ni NaN ;
// - un versement de 0 € ne place rien ;
// - un livret réglementé ne reçoit jamais plus que la place qui lui reste sous son plafond
//   (plan automatique).
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { AccountType, SavingsAccount } from '../../types';
import { DEFAULT_FISCAL_CONFIG } from '../../constants';
import { computePlacementStrategy, PlacementStep } from './placement';

const RUNS = { numRuns: 150 };

const cents = (max: number) => fc.integer({ min: 0, max: max * 100 }).map(c => c / 100);
const TYPES = [AccountType.LEP, AccountType.LIVRET_A, AccountType.LDDS, AccountType.CEL, AccountType.LIVRET_BANCAIRE,
  AccountType.ASSURANCE_VIE, AccountType.PEA, AccountType.PEE, AccountType.COMPTE_COURANT, AccountType.CRYPTO];

const accounts = fc.array(fc.record({
  type: fc.constantFrom(...TYPES),
  totalAmount: cents(40_000),
  rate: fc.integer({ min: 0, max: 80 }).map(n => n / 20),
  ceiling: fc.option(fc.integer({ min: 100, max: 40_000 }), { nil: undefined }),
}), { maxLength: 6 }).map((rows): SavingsAccount[] => rows.map((r, i) => ({
  id: `a${i}`, name: `Compte ${i}`, institution: 'Banque', type: r.type, totalAmount: r.totalAmount, ownedAmount: r.totalAmount,
  parentalCapital: 0, interestRate: r.rate, ceiling: r.ceiling, movements: [],
})));

// Au moins 10 € : une part de 1 % reste au-dessus du demi-centime ignoré par le calcul.
const total = fc.integer({ min: 1000, max: 8_000_000 }).map(c => c / 100);
const placed = (steps: PlacementStep[]) => steps.filter(s => !s.infoOnly).reduce((sum, s) => sum + Math.round(s.fillAmount * 100), 0);

describe('plan de placement : propriétés', () => {
  it('plan automatique : les parts font le total au centime, aucune n\'est négative', () => {
    fc.assert(fc.property(total, accounts, (amount, accs) => {
      const steps = computePlacementStrategy(amount, accs, DEFAULT_FISCAL_CONFIG);
      for (const s of steps) {
        expect(Number.isFinite(s.fillAmount)).toBe(true);
        expect(s.fillAmount).toBeGreaterThanOrEqual(0);
      }
      expect(placed(steps)).toBe(Math.round(amount * 100));
    }), RUNS);
  });

  it('répartition personnalisée : les parts font aussi le total au centime', () => {
    const withSplit = accounts.filter(a => a.length > 0).chain(accs =>
      fc.array(fc.record({ index: fc.integer({ min: 0, max: accs.length - 1 }), pct: fc.integer({ min: 1, max: 100 }) }), { minLength: 1, maxLength: 4 })
        .map(rows => ({ accs, split: rows.map(r => ({ accountId: accs[r.index].id, pct: r.pct })) })));
    fc.assert(fc.property(total, withSplit, (amount, { accs, split }) => {
      const steps = computePlacementStrategy(amount, accs, DEFAULT_FISCAL_CONFIG, split);
      for (const s of steps) expect(s.fillAmount).toBeGreaterThanOrEqual(0);
      expect(placed(steps)).toBe(Math.round(amount * 100));
    }), RUNS);
  });

  it('un versement de 0 € ne place rien', () => {
    fc.assert(fc.property(accounts, accs => {
      expect(placed(computePlacementStrategy(0, accs, DEFAULT_FISCAL_CONFIG))).toBe(0);
    }), RUNS);
  });

  it('un livret réglementé ne dépasse jamais son plafond', () => {
    fc.assert(fc.property(total, accounts, (amount, accs) => {
      const ceilingOf = (a: SavingsAccount) => (a.ceiling && a.ceiling > 0 ? a.ceiling
        : a.type === AccountType.LEP ? DEFAULT_FISCAL_CONFIG.ceilings.lep
          : a.type === AccountType.LIVRET_A ? DEFAULT_FISCAL_CONFIG.ceilings.livretA : DEFAULT_FISCAL_CONFIG.ceilings.ldds);
      for (const s of computePlacementStrategy(amount, accs, DEFAULT_FISCAL_CONFIG)) {
        const a = accs.find(x => x.id === s.accountId);
        if (!a || ![AccountType.LEP, AccountType.LIVRET_A, AccountType.LDDS].includes(a.type)) continue;
        // 2 centimes de marge : l'écart d'arrondi du total peut ajouter un centime à la plus grosse part.
        expect(a.totalAmount + s.fillAmount).toBeLessThanOrEqual(Math.max(ceilingOf(a), a.totalAmount) + 0.02);
      }
    }), RUNS);
  });
});
