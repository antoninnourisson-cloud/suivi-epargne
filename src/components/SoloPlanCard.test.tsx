// @vitest-environment jsdom
// Plan solo (écran Part parentale) : carte du kit, champ « Épargne par mois » relié à son
// libellé, tableau année par année qui suit la saisie, montant illisible signalé.
import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { SoloPlanCard } from './SoloPlanCard';
import { DEFAULT_FISCAL_CONFIG } from '../constants';
import { AccountType, type SavingsAccount } from '../types';

afterEach(cleanup);

const accounts: SavingsAccount[] = [
  { id: 'la', name: 'Livret A', type: AccountType.LIVRET_A, institution: 'B', ownedAmount: 10000, parentalCapital: 9000, totalAmount: 19000, interestRate: 0, movements: [] },
  { id: 'av', name: 'AV', type: AccountType.ASSURANCE_VIE, institution: 'B', ownedAmount: 0, parentalCapital: 0, totalAmount: 0, interestRate: 0, movements: [] },
];

describe('SoloPlanCard', () => {
  it('part de votre seule part, et le tableau suit l’épargne saisie', () => {
    render(<SoloPlanCard accounts={accounts} fiscalConfig={DEFAULT_FISCAL_CONFIG} monthPlan={1000} restitutionISO="2027-01-01" />);
    expect(screen.getByRole('heading', { name: 'Votre plan solo 2027-2030' })).toBeTruthy();
    const field = screen.getByLabelText('Épargne par mois') as HTMLInputElement;
    expect(field.value).toBe('1000');
    const table = screen.getByRole('table', { name: 'Épargne au 31 décembre de chaque année' });
    const firstYear = within(table).getAllByRole('row')[1];
    expect(firstYear.textContent).toMatch(/2027/);
    expect(firstYear.textContent).toMatch(/22\s000\s€/);

    fireEvent.change(field, { target: { value: '0' } });
    expect(within(table).getAllByRole('row')[1].textContent).toMatch(/10\s000\s€/);
    expect(document.body.innerHTML).not.toMatch(/(slate|indigo|amber)-\d/);
  });

  it('placement sans taux saisi : même hypothèse de rendement qu’au Rendement, et elle est dite', () => {
    const pea: SavingsAccount = { id: 'pea', name: 'PEA', type: AccountType.PEA, institution: 'B', ownedAmount: 10000, parentalCapital: 0, totalAmount: 10000, interestRate: 0, movements: [] };
    const hypotheses = { rates: { pea: 5 }, assumptions: [{ id: 'pea', name: 'PEA', rate: 5, source: 'observed' as const, since: '2023-01-01' }] };
    render(<SoloPlanCard accounts={[pea]} hypotheses={hypotheses} fiscalConfig={DEFAULT_FISCAL_CONFIG} monthPlan={0} restitutionISO="2027-01-01" />);
    expect(screen.getByRole('note').textContent).toMatch(/PEA : \+5\s% par an, la performance observée depuis janvier 2023/);
    const firstYear = within(screen.getByRole('table')).getAllByRole('row')[1];
    // 10 000 € à 5 % par an (versés chaque mois, nets des prélèvements sociaux d'un retrait) : plus de 10 000 € fin 2027.
    expect(firstYear.textContent).not.toMatch(/10\s000\s€/);
  });

  it('montant illisible : signalé sous le champ', () => {
    render(<SoloPlanCard accounts={accounts} fiscalConfig={DEFAULT_FISCAL_CONFIG} restitutionISO="2027-01-01" />);
    const field = screen.getByLabelText('Épargne par mois');
    fireEvent.change(field, { target: { value: '12a' } });
    expect(screen.getByRole('alert').textContent).toMatch(/Montant non reconnu/);
    expect(field.getAttribute('aria-invalid')).toBe('true');
  });
});
