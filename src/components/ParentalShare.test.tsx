// @vitest-environment jsdom
// Part parentale : chiffres clés (votre capital, celui des parents), tableau compte par compte
// avec le total banque, état vide qui dit quoi faire.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { ParentalShare } from './ParentalShare';
import { AccountType, type SavingsAccount } from '../types';

afterEach(cleanup);

const account = (id: string, name: string, owned: number, parental: number): SavingsAccount => ({
  id, name, type: AccountType.LIVRET_A, institution: 'Banque', ownedAmount: owned, parentalCapital: parental, totalAmount: owned + parental, movements: [],
});

const renderShare = (accounts: SavingsAccount[]) => render(
  <ParentalShare accounts={accounts} onPlanRestitution={vi.fn()} onRestitute={vi.fn()} onUndoRestitution={vi.fn()} />
);

describe('Part parentale', () => {
  it('sans capital des parents : état vide qui renvoie vers Mes comptes', () => {
    renderShare([account('a', 'Livret A', 5000, 0)]);
    expect(screen.getByRole('heading', { name: 'Part parentale' })).toBeTruthy();
    expect(screen.getByText('Aucun capital de vos parents sur vos comptes')).toBeTruthy();
    expect(screen.queryByRole('table', { name: /compte par compte/ })).toBeNull();
  });

  it("l'état vide propose d'ouvrir Mes comptes", () => {
    const onOpenAccounts = vi.fn();
    render(<ParentalShare accounts={[account('a', 'Livret A', 5000, 0)]} onPlanRestitution={vi.fn()} onRestitute={vi.fn()} onUndoRestitution={vi.fn()} onOpenAccounts={onOpenAccounts} />);
    fireEvent.click(screen.getByRole('button', { name: 'Ouvrir Mes comptes' }));
    expect(onOpenAccounts).toHaveBeenCalled();
  });

  it('avec capital des parents : totaux, répartition écrite et tableau par compte', () => {
    renderShare([account('a', 'Livret A', 3000, 7000), account('b', 'LDDS', 2000, 0)]);
    expect(screen.getByText('Mon capital')).toBeTruthy();
    expect(screen.getByText('Capital parents')).toBeTruthy();
    expect(screen.getByText('42 % du total géré')).toBeTruthy();
    expect(screen.getByText('58 % du total géré')).toBeTruthy();
    const table = screen.getByRole('table', { name: 'Votre part et celle de vos parents, compte par compte' });
    const rows = within(table).getAllByRole('row');
    // En-tête, puis le compte qui porte le plus de capital parental en premier.
    expect(within(rows[1]).getByRole('rowheader').textContent).toContain('Livret A');
    expect(rows[1].textContent).toMatch(/Total banque : 10\s000,00\s€/);
    expect(rows[1].textContent).toContain('30 % à vous');
    // Aucune ancienne palette de couleurs dans l'écran.
    expect(document.body.innerHTML).not.toMatch(/(amber|slate|indigo|emerald)-\d/);
  });
});
