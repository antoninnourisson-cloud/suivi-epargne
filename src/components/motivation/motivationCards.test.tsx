// @vitest-environment jsdom
// Cartes « Bons mois » et « Bilan » : nommées par le mois d'épargne (paie du 27 octobre →
// « Novembre : bon mois », bilan « Bilan d'octobre »), pas par le mois de versement.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { GoodMonthsCard } from './GoodMonthsCard';
import { PayReviewCard } from './PayReviewCard';
import type { GoodMonthsSummary, MonthResult, PayReview } from '../../lib/motivation';

afterEach(cleanup);

const month = (key: string, payMonth: string, start: string, end: string, over: Partial<MonthResult> = {}): MonthResult =>
  ({ key, payMonth, start, end, source: 'payday', saved: 600, good: true, inProgress: false, ...over });

describe('GoodMonthsCard', () => {
  it("nomme chaque pastille par son mois d'épargne, et le joker par l'année de ce mois", () => {
    const months = [
      month('2026-12', '2026-11', '2026-11-27', '2026-12-27'),
      month('2027-01', '2026-12', '2026-12-27', '2027-01-27', { saved: 100, good: false, joker: true }),
      month('2027-02', '2027-01', '2027-01-27', '2027-02-26', { saved: 0, good: false, inProgress: true }),
    ];
    const summary: GoodMonthsSummary = { threshold: 500, months, current: months[2], streak: 1, bestStreak: 1, goodCount: 1, jokersUsed: ['2027'] };
    render(<GoodMonthsCard summary={summary} today="2027-02-02" milestones={[]} fresh={[]} />);
    const list = screen.getByRole('list', { name: "Derniers mois d'épargne" });
    expect(list.textContent).toMatch(/Décembre 2026 : bon mois, 600/);
    // L'épargne de janvier 2027 (paie du 27 décembre) : joker de 2027.
    expect(list.textContent).toMatch(/Janvier : joker utilisé, 100/);
    expect(list.textContent).toMatch(/Février : en cours/);
    expect(screen.getByText(/Joker 2027 utilisé pour l'épargne de janvier/)).toBeTruthy();
  });
});

describe('PayReviewCard', () => {
  const review: PayReview = {
    key: '2026-10', payMonth: '2026-09', start: '2026-09-27', end: '2026-10-27', saved: 620, threshold: 500, good: true, joker: false,
    deposits: 620, withdrawals: 0, valuation: 0, byAccount: [], insight: 'Bon mois : 620 € mis de côté.',
  };

  it("s'intitule « Bilan d'octobre » (mois d'épargne), ou le titre donné par le rituel", () => {
    const onValidate = vi.fn();
    render(<PayReviewCard review={review} onValidate={onValidate} />);
    expect(screen.getByRole('heading', { name: "Bilan d'octobre" })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Valider' }));
    expect(onValidate).toHaveBeenCalledOnce();
    cleanup();
    render(<PayReviewCard review={review} onValidate={onValidate} title="Résultat du mois" validateLabel="Continuer" />);
    expect(screen.getByRole('heading', { name: 'Résultat du mois' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Continuer' })).toBeTruthy();
  });
});
