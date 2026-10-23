// Données de démonstration : l'historique mensuel suit les comptes (courbe de l'Historique,
// variation de l'Accueil et « Votre année » cohérentes entre elles).
import { describe, it, expect } from 'vitest';
import { DEMO_DATA, demoHistory } from './demoData';
import { computeAccountBalanceAtDate } from '../lib/finance';
import { computeYearReview } from '../lib/agenda';
import { portfolioTotals } from '../lib/monthlyPoints';

describe('démo : historique des douze derniers mois', () => {
  it('un point par mois, total = votre part + capital des parents, dernier point = soldes du jour', () => {
    const h = DEMO_DATA.history;
    expect(h).toHaveLength(12);
    expect(new Set(h.map(s => s.date.slice(0, 7))).size).toBe(12);
    expect([...h].sort((a, b) => a.date.localeCompare(b.date))).toEqual(h);
    const parental = DEMO_DATA.accounts.reduce((s, a) => s + a.parentalCapital, 0);
    for (const s of h) expect(s.totalAmount).toBeCloseTo(s.ownedAmount + parental, 2);
    // Le point du mois en cours ne change pas quand useMonthlySnapshots le recalcule.
    expect(h[11]).toMatchObject(portfolioTotals(DEMO_DATA.accounts));
    // Jamais daté dans le futur.
    const today = new Date();
    const todayISO = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    for (const s of h) expect(s.date <= todayISO).toBe(true);
  });

  it('chaque point vaut votre part en fin de mois, reconstituée par les mouvements', () => {
    const at = new Date(2026, 9, 15);
    const h = demoHistory(DEMO_DATA.accounts, at);
    expect(h[0].date).toBe('2025-11-01');
    expect(h[11].date).toBe('2026-10-01');
    expect(h[1].ownedAmount).toBeCloseTo(computeAccountBalanceAtDate(DEMO_DATA.accounts, '2025-12-31'), 2);
    expect(h[11].ownedAmount).toBeCloseTo(computeAccountBalanceAtDate(DEMO_DATA.accounts, '2026-10-15'), 2);
    // La part grandit avec l'épargne de la démo.
    expect(h[11].ownedAmount).toBeGreaterThan(h[0].ownedAmount);
  });

  it('« Votre année » part du point de décembre, sans écart inexpliqué', () => {
    const year = new Date().getFullYear();
    const review = computeYearReview(DEMO_DATA, year);
    // Décembre dernier est dans la fenêtre de douze mois, sauf en décembre.
    if (new Date().getMonth() <= 10) {
      expect(review.netStartDate?.slice(0, 7)).toBe(`${year - 1}-12`);
    }
    expect(review.unexplainedGap).toBeUndefined();
  });
});
