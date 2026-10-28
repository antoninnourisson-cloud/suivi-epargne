// @vitest-environment jsdom
// Historique (Material 3) : un seul bilan annuel, onglets accessibles, états vides.
import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { emptyData } from '../lib/schema';
import { History } from './History';
import { SplitProjectionCard } from './SplitProjectionCard';
import { Agenda } from './Agenda';
import { AccountType, type SavingsAccount } from '../types';

afterEach(cleanup);

const snap = (date: string, totalAmount: number, ownedAmount: number) => ({ date, totalAmount, ownedAmount });

describe('History', () => {
  it('un seul bilan annuel (« Votre année »), plus de second bilan en chiffres bruts', () => {
    const data = { ...emptyData(), config: { ...emptyData().config, gamification: false } };
    render(<History history={[]} expensesHistory={[]} reviewData={data} />);
    expect(screen.getByRole('heading', { name: /Votre année/ })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: /Bilan/ })).toBeNull();
  });

  it('un seul relevé : chiffres de synthèse, et la courbe attend un deuxième point', () => {
    render(<History history={[snap('2026-09-30', 15200, 8200)]} expensesHistory={[]} />);
    expect(screen.getByText('Total actuel')).toBeTruthy();
    expect(screen.getByText('Votre part actuelle')).toBeTruthy();
    expect(screen.getByText("L'historique se construit au fil des mois")).toBeTruthy();
  });

  it('onglets Patrimoine / Charges fixes ; tableau mois par mois avec l’écart réel en mois', () => {
    render(<History history={[snap('2026-05-31', 14000, 7000), snap('2026-08-31', 15200, 8200)]} expensesHistory={[]} />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map(t => t.textContent)).toEqual(['Patrimoine', 'Charges fixes']);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    const table = screen.getByRole('table', { name: 'Variation de votre patrimoine mois par mois' });
    expect(table.textContent).toMatch(/\+1\s200\s€/);
    expect(table.textContent).toContain('sur 3 mois');
    fireEvent.click(tabs[1]);
    expect(screen.getByRole('tab', { name: 'Charges fixes' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText("L'historique des charges se construit au fil des mois")).toBeTruthy();
  });
});

describe('SplitProjectionCard', () => {
  const accounts: SavingsAccount[] = [
    { id: 'la', name: 'Livret A', institution: 'B', type: AccountType.LIVRET_A, totalAmount: 1000, ownedAmount: 1000, parentalCapital: 0, interestRate: 1.7, ceiling: 22950, movements: [] },
    { id: 'av', name: 'Assurance vie', institution: 'A', type: AccountType.ASSURANCE_VIE, totalAmount: 1000, ownedAmount: 1000, parentalCapital: 0, interestRate: 3, movements: [] },
  ];

  it('trois répartitions ; la durée se choisit par un bouton segmenté', () => {
    render(<SplitProjectionCard accounts={accounts} fiscalConfig={emptyData().fiscalConfig} monthPlan={500} />);
    expect(screen.getByRole('list', { name: 'Trois répartitions sur 10 ans' }).children).toHaveLength(3);
    // « 100 % » insécable (espace fine) : jamais « 100 » en fin de ligne et « % » à la suivante.
    expect(screen.getByRole('list', { name: 'Trois répartitions sur 10 ans' }).textContent).toContain('100 % ');
    expect(screen.getByText('(le plus élevé)')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '20 ans' }));
    expect(screen.getByRole('button', { name: '20 ans' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('list', { name: 'Trois répartitions sur 20 ans' })).toBeTruthy();
    expect((screen.getByLabelText('Épargne par mois') as HTMLInputElement).value).toBe('500');
  });

  it('rien sans Livret A et Assurance vie', () => {
    const { container } = render(<SplitProjectionCard accounts={accounts.slice(0, 1)} fiscalConfig={emptyData().fiscalConfig} />);
    expect(container.textContent).toBe('');
  });
});

describe('Agenda', () => {
  it('un événement qui mène à un écran est un bouton (jamais un bouton désactivé)', () => {
    const opened: string[] = [];
    const data = { ...emptyData(), subscriptions: [{ id: 's', name: 'Netflix', amount: 13.49, debitAccount: '', frequency: 'monthly' as const, anchorDate: '2026-01-05', active: true }] };
    render(<Agenda data={data} onOpen={v => opened.push(v)} />);
    expect(screen.getByRole('heading', { name: 'Agenda', level: 2 })).toBeTruthy();
    const row = screen.getAllByRole('button', { name: /Netflix/ })[0];
    expect(row.textContent).toMatch(/−13,49\s€/);
    expect(row.textContent).toMatch(/· (aujourd'hui|demain|dans \d+ jours)/);
    fireEvent.click(row);
    expect(opened).toEqual(['subscriptions']);
    expect(screen.getAllByRole('button').every(b => !(b as HTMLButtonElement).disabled)).toBe(true);
  });
});
