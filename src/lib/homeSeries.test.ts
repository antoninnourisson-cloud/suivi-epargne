import { describe, it, expect } from 'vitest';
import { historySeries, monthEndDates, homeSparkline, isoDaysBefore, deltaOverDays, shiftMonth, availabilityShares } from './homeSeries';

describe('homeSeries', () => {
  it('décale les mois, y compris au changement d\'année', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-10', -11)).toBe('2025-11');
    expect(shiftMonth('2025-12', 1)).toBe('2026-01');
  });

  it('garde le dernier point de chaque mois passé et finit sur la valeur du jour', () => {
    const history = [
      { date: '2025-09-15', totalAmount: 1, ownedAmount: 1 }, // trop ancien (hors 12 mois)
      { date: '2026-08-01', totalAmount: 900, ownedAmount: 500 },
      { date: '2026-08-20', totalAmount: 950, ownedAmount: 550 },
      { date: '2026-09-03', totalAmount: 1000, ownedAmount: 600 },
      { date: '2026-10-02', totalAmount: 1100, ownedAmount: 650 }, // mois en cours : remplacé
    ];
    expect(historySeries(history, 700, '2026-10-07')).toEqual([550, 600, 700]);
  });

  it('prend le total quand la part propre manque (anciennes données)', () => {
    const history = [{ date: '2026-09-03', totalAmount: 1000 } as never];
    expect(historySeries(history, 700, '2026-10-07')).toEqual([1000, 700]);
  });

  it('liste les fins de mois puis aujourd\'hui', () => {
    expect(monthEndDates('2026-03-10', 4)).toEqual(['2025-12-31', '2026-01-31', '2026-02-28', '2026-03-10']);
  });

  it('reconstitue la courbe par les mouvements quand l\'historique est trop court', () => {
    const balanceAt = (iso: string) => (iso < '2026-02-01' ? 100 : 200);
    expect(homeSparkline({ history: [], current: 250, today: '2026-03-10', balanceAt, months: 4 })).toEqual([100, 100, 200, 250]);
  });

  it('préfère l\'historique dès trois points', () => {
    const history = [
      { date: '2026-01-05', totalAmount: 0, ownedAmount: 10 },
      { date: '2026-02-05', totalAmount: 0, ownedAmount: 20 },
    ];
    expect(homeSparkline({ history, current: 30, today: '2026-03-10', balanceAt: () => 999, months: 4 })).toEqual([10, 20, 30]);
  });

  it('calcule la variation sur 30 jours', () => {
    expect(isoDaysBefore('2026-03-10', 30)).toBe('2026-02-08');
    const balanceAt = (iso: string) => (iso === '2026-02-08' ? 1000.004 : 0);
    expect(deltaOverDays(1250, balanceAt, '2026-03-10')).toBe(250);
  });

  it('répartit la barre de disponibilité', () => {
    expect(availabilityShares([300, 100, 0])).toEqual([75, 25, 0]);
    expect(availabilityShares([-50, 50])).toEqual([0, 100]);
    expect(availabilityShares([0, 0])).toEqual([0, 0]);
  });
});
