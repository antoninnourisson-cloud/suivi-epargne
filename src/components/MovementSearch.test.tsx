// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { AccountType, type SavingsAccount } from '../types';
import { MovementSearch } from './MovementSearch';

afterEach(cleanup);

const accounts: SavingsAccount[] = [
  {
    id: 'la', name: 'Livret A', institution: 'B', type: AccountType.LIVRET_A, totalAmount: 1000, ownedAmount: 800, parentalCapital: 200,
    movements: [
      { id: 'm1', date: '2026-09-15', amount: 250, label: 'Épargne du mois', type: 'IN' },
      { id: 'm2', date: '2026-08-02', amount: 13.5, label: 'Retrait', type: 'OUT' },
      { id: 'm3', date: '2026-09-20', amount: 100, label: 'Épargne parents', type: 'IN', kind: 'parental' },
    ],
  },
  { id: 'av', name: 'Assurance vie', institution: 'A', type: AccountType.ASSURANCE_VIE, totalAmount: 500, ownedAmount: 500, parentalCapital: 0,
    movements: [{ id: 'v1', date: '2026-09-30', amount: 12, label: 'Gain', type: 'IN', kind: 'valuation' }] },
];

const search = (q: string) => fireEvent.change(screen.getByLabelText('Rechercher un mouvement'), { target: { value: q } });
const rows = () => within(screen.getByRole('list', { name: 'Mouvements trouvés' })).getAllByRole('listitem');

describe('MovementSearch', () => {
  it('par libellé, sans accents ni majuscules ; le solde net ignore la part des parents', () => {
    render(<MovementSearch accounts={accounts} />);
    search('epargne');
    expect(rows()).toHaveLength(2);
    expect(screen.getByText(/2 mouvements · solde net/).textContent).toMatch(/\+250\s€/);
  });

  it('par montant, par mois (09/2026) et par sens', () => {
    render(<MovementSearch accounts={accounts} />);
    search('13,50');
    expect(rows()).toHaveLength(1);
    expect(rows()[0].textContent).toMatch(/Retrait.*−13,50\s€/);
    search('09/2026');
    expect(rows()).toHaveLength(3);
    expect(rows()[0].textContent).toContain('(valorisation)');
    fireEvent.click(screen.getByRole('button', { name: 'Sorties' }));
    expect(screen.getByText('Aucun mouvement ne correspond.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Entrées' }));
    expect(rows()).toHaveLength(3);
  });

  it('« Effacer la recherche » vide le champ et la liste', () => {
    render(<MovementSearch accounts={accounts} />);
    search('Gain');
    expect(rows()).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Effacer la recherche' }));
    expect((screen.getByLabelText('Rechercher un mouvement') as HTMLInputElement).value).toBe('');
    expect(screen.queryByRole('list', { name: 'Mouvements trouvés' })).toBeNull();
  });
});
