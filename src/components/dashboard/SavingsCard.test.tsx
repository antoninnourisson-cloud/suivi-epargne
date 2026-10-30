// @vitest-environment jsdom
// Carte « Épargne de novembre » : un seul chiffre pour le mois d'épargne en cours, une seule
// jauge avec l'objectif et le seuil « bon mois », et le taux d'épargne sur la même fenêtre.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SavingsCard } from './SavingsCard';
import { savingsGauge, type PayPeriodSavings } from '../../lib/home';

afterEach(() => cleanup());

const period = (over: Partial<PayPeriodSavings> = {}): PayPeriodSavings => ({
  key: '2026-10', declared: true,
  start: '2026-09-27', end: '2026-10-27', byPay: true, since: 'depuis la paie du 27 septembre', saved: 320, rate: 16,
  history: [{ month: '2026-09', saved: 500, rate: 25 }, { month: '2026-10', saved: 320, rate: 16 }], avgRate: 25, avgCount: 1, ...over,
});

describe('SavingsCard', () => {
  it('montre une seule jauge avec l’objectif et le seuil « bon mois »', () => {
    const p = period();
    render(<SavingsCard gauge={savingsGauge({ saved: p.saved, goal: 773, threshold: 500, period: p, today: '2026-10-02' })} period={p} monthlyPay={2000} />);
    // Titre = mois d'épargne (paie du 27 septembre → épargne d'octobre), début rappelé dessous.
    expect(screen.getByRole('heading', { name: "Épargne d'octobre" })).toBeTruthy();
    expect(screen.getByText('Depuis la paie du 27 septembre')).toBeTruthy();
    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuetext')?.replace(/\s/g, ' ')).toBe('320 € placés, objectif 773 €, bon mois dès 500 €');
    expect(screen.getByText(/Reste 453 € pour l'objectif de 773 €, 25 jours avant la prochaine paie/)).toBeTruthy();
    expect(screen.getByText(/Bon mois dès 500 € : encore 180 €/)).toBeTruthy();
    expect(screen.getByText(/Le trait sur la jauge marque le seuil « bon mois »/)).toBeTruthy();
    // Taux d'épargne sur la même fenêtre : la paie, pas le mois civil (16 %, pas 0 %).
    expect(screen.getByText(/Cette paie/).textContent).toMatch(/Cette paie 16 %/);
    // La moyenne dit sur combien de paies elle porte (ici une seule paie terminée).
    expect(screen.getByText(/Cette paie/).textContent).toMatch(/moyenne sur 1 paie 25 %/);
    fireEvent.click(screen.getByRole('button', { name: /Épargne de septembre 2026 : 25 %/ }));
    expect(screen.getByText(/Épargne de septembre : 25 % de la paie/)).toBeTruthy();
    // Paie déclarée : pas d'invitation à la déclarer.
    expect(screen.queryByRole('button', { name: "J'ai reçu ma paie" })).toBeNull();
  });

  it("propose « J'ai reçu ma paie » tant que la paie attendue n'est pas déclarée", () => {
    const onPayReceived = vi.fn();
    const p = period({ declared: false });
    render(<SavingsCard gauge={savingsGauge({ saved: 0, goal: 773, period: p, today: '2026-09-28' })} period={p} monthlyPay={2000} onPayReceived={onPayReceived} />);
    expect(screen.getByText(/Paie attendue le 27 septembre : reçue \?/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: "J'ai reçu ma paie" }));
    expect(onPayReceived).toHaveBeenCalledOnce();
    cleanup();
    // Mois civil (sans jour de paie) : rien à déclarer.
    const civil = period({ declared: false, byPay: false, since: 'depuis le 1er octobre' });
    render(<SavingsCard gauge={savingsGauge({ saved: 0, goal: 773, period: civil, today: '2026-10-02' })} period={civil} monthlyPay={2000} onPayReceived={onPayReceived} />);
    expect(screen.queryByRole('button', { name: "J'ai reçu ma paie" })).toBeNull();
  });

  it('dit quand le bon mois et l’objectif sont acquis, et les retraits nets', () => {
    const p = period({ saved: 800 });
    render(<SavingsCard gauge={savingsGauge({ saved: 800, goal: 773, threshold: 500, period: p, today: '2026-10-02' })} period={p} monthlyPay={0} />);
    expect(screen.getByText('Objectif atteint.')).toBeTruthy();
    expect(screen.getByText(/Bon mois acquis/)).toBeTruthy();
    expect(screen.queryByText(/Taux d'épargne/)).toBeNull();
    cleanup();
    const neg = period({ saved: -50, byPay: false, since: 'depuis le 1er octobre', end: '2026-11-01' });
    render(<SavingsCard gauge={savingsGauge({ saved: -50, threshold: 500, period: neg, today: '2026-10-20' })} period={neg} monthlyPay={2000} />);
    expect(screen.getByRole('heading', { name: 'Placé depuis le 1er octobre' })).toBeTruthy();
    expect(screen.getByText(/plus retiré que versé/)).toBeTruthy();
    expect(screen.getByText(/Bon mois dès 500 € : encore 500 €, 12 jours avant la fin du mois/)).toBeTruthy();
    expect(screen.getByText(/Ce mois-ci/)).toBeTruthy();
    cleanup();
    const many = period({ avgCount: 8 });
    render(<SavingsCard gauge={savingsGauge({ saved: 320, goal: 773, period: many, today: '2026-10-02' })} period={many} monthlyPay={2000} />);
    expect(screen.getByText(/moyenne sur 8 paies/)).toBeTruthy();
  });
});
