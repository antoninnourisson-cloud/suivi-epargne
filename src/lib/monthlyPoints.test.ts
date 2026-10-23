import { describe, it, expect } from 'vitest';
import { portfolioTotals, withExpensePoint, withPortfolioPoint } from './monthlyPoints';
import { monthsUntilRestitution } from './finance';

describe('points mensuels de l’historique', () => {
  const history = [
    { date: '2026-08-03', totalAmount: 900, ownedAmount: 800 },
    { date: '2026-10-02', totalAmount: 1000, ownedAmount: 900 },
  ];
  it('met à jour le point du mois en gardant sa date de création', () => {
    expect(withPortfolioPoint(history, { totalAmount: 1100, ownedAmount: 950 }, '2026-10', '2026-10-20'))
      .toEqual([history[0], { date: '2026-10-02', totalAmount: 1100, ownedAmount: 950 }]);
  });
  it('rien à changer : null', () => {
    expect(withPortfolioPoint(history, { totalAmount: 1000, ownedAmount: 900 }, '2026-10', '2026-10-20')).toBeNull();
  });
  it('nouveau mois : point daté du jour, historique trié', () => {
    expect(withPortfolioPoint([history[1], history[0]], { totalAmount: 1, ownedAmount: 1 }, '2026-11', '2026-11-01')!.map(p => p.date))
      .toEqual(['2026-08-03', '2026-10-02', '2026-11-01']);
    expect(withPortfolioPoint(undefined, { totalAmount: 1, ownedAmount: 1 }, '2026-11', '2026-11-01')).toEqual([{ date: '2026-11-01', totalAmount: 1, ownedAmount: 1 }]);
  });
  it('charges fixes : même règle', () => {
    const charges = [{ date: '2026-10-01', total: 500 }];
    expect(withExpensePoint(charges, 500, '2026-10', '2026-10-20')).toBeNull();
    expect(withExpensePoint(charges, 520, '2026-10', '2026-10-20')).toEqual([{ date: '2026-10-01', total: 520 }]);
    expect(withExpensePoint(undefined, 520, '2026-11', '2026-11-02')).toEqual([{ date: '2026-11-02', total: 520 }]);
  });
});

describe('mois avant la restitution prévue', () => {
  const now = new Date(2026, 9, 20);
  it('mois calendaires jusqu’à la date prévue (lue en heure locale)', () => {
    expect(monthsUntilRestitution({ plannedDate: '2027-01-01' }, now)).toBe(3);
    expect(monthsUntilRestitution({ plannedDate: '2026-10-31' }, now)).toBe(0);
  });
  it('rien de prévu ou déjà faite : pas de restitution projetée', () => {
    expect(monthsUntilRestitution(undefined, now)).toBeUndefined();
    expect(monthsUntilRestitution({}, now)).toBeUndefined();
    expect(monthsUntilRestitution({ plannedDate: '2027-01-01', done: { date: '2027-01-01' } }, now)).toBeUndefined();
    expect(monthsUntilRestitution({ plannedDate: 'pas une date' }, now)).toBeUndefined();
  });
  it('date passée mais restitution pas encore notée : tout de suite (0), comme le simulateur', () => {
    expect(monthsUntilRestitution({ plannedDate: '2026-09-01' }, now)).toBe(0);
    expect(monthsUntilRestitution({ plannedDate: '2025-01-01' }, now)).toBe(0);
  });
});

describe('totaux du point mensuel', () => {
  it('sont arrondis au centime (pas de bruit de virgule flottante dans le fichier)', () => {
    expect(portfolioTotals([{ totalAmount: 1234.56, ownedAmount: 1234.56 }, { totalAmount: 100.1, ownedAmount: 0.1 }, { totalAmount: 0.2, ownedAmount: 0.2 }]))
      .toEqual({ totalAmount: 1334.86, ownedAmount: 1234.86 });
    expect(portfolioTotals([])).toEqual({ totalAmount: 0, ownedAmount: 0 });
  });
});
