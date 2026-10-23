// @vitest-environment jsdom
// Journal (Material 3) : chaque ligne nomme ce qu'elle modifie, filtres, point de départ du
// suivi repris quand il change ailleurs.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { AccountType, type SavingsAccount } from '../types';
import { Journal } from './Journal';

afterEach(cleanup);

const accounts: SavingsAccount[] = [{
  id: 'la', name: 'Livret A', institution: 'B', type: AccountType.LIVRET_A, totalAmount: 1000, ownedAmount: 800, parentalCapital: 200,
  interestRate: 1.7, rateHistory: [{ date: '2026-08-01', rate: 2.4 }],
  movements: [
    { id: 'm1', date: '2026-09-15', amount: 250, label: 'Épargne du mois', type: 'IN' },
    { id: 'm2', date: '2026-09-10', amount: 200, label: 'Versement des parents', type: 'IN', kind: 'parental' },
  ],
}, { id: 'ldds', name: 'LDDS', institution: 'B', type: AccountType.LDDS, totalAmount: 0, ownedAmount: 0, parentalCapital: 0, movements: [] }];

const setup = (trackingStartDate?: string) => {
  const props = {
    accounts, onDeleteMovement: vi.fn(), onRevertRate: vi.fn(), onRemoveCancelling: vi.fn(),
    onSetTrackingStart: vi.fn(), onToggleAdjustment: vi.fn(), trackingStartDate,
  };
  const view = render(<Journal {...props} />);
  return { ...props, ...view };
};

describe('Journal', () => {
  it('liste les mouvements et les taux, du plus récent au plus ancien', () => {
    setup();
    expect(screen.getByRole('heading', { name: 'Journal', level: 2 })).toBeTruthy();
    const items = screen.getAllByRole('listitem');
    const titles = items.map(i => i.querySelector('p')?.textContent);
    expect(titles.slice(0, 2)).toEqual(['Épargne du mois', 'Versement des parents']);
    expect(titles[2]).toMatch(/^Taux : 2,4\d?\s%\s→\s1,7\d?\s%$/);
    expect(screen.getByText('3 entrées')).toBeTruthy();
  });

  it('actions nommées d’après la ligne : pas de l’épargne, suppression, taux', () => {
    const p = setup();
    const own = screen.getAllByRole('listitem')[0];
    fireEvent.click(within(own).getByRole('button', { name: "Pas de l'épargne" }));
    expect(p.onToggleAdjustment).toHaveBeenCalledWith('la', 'm1');
    fireEvent.click(screen.getByRole('button', { name: 'Supprimer « Épargne du mois »' }));
    expect(p.onDeleteMovement).toHaveBeenCalledWith('la', 'm1');
    // La part des parents ne se requalifie pas en correction.
    expect(within(screen.getAllByRole('listitem')[1]).queryByRole('button', { name: "Pas de l'épargne" })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Annuler ce changement de taux' }));
    expect(p.onRevertRate).toHaveBeenCalledWith('la', '2026-08-01');
  });

  it('filtres par type et par compte', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Parents' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Taux' }));
    expect(screen.getAllByRole('listitem')[0].textContent).toContain('Taux');
    fireEvent.click(screen.getByRole('button', { name: 'Tout' }));
    fireEvent.change(screen.getByLabelText('Compte'), { target: { value: 'ldds' } });
    expect(screen.getByText('Aucune entrée ne correspond à ces filtres.')).toBeTruthy();
    expect(screen.getByText('0 entrée')).toBeTruthy();
  });

  it('point de départ du suivi : saisi, puis repris quand il change ailleurs (« Annuler »)', () => {
    const p = setup('2026-01-01');
    const field = screen.getByLabelText('Point de départ du suivi') as HTMLInputElement;
    expect(field.value).toBe('2026-01-01');
    fireEvent.change(field, { target: { value: '2026-10-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Changer la date' }));
    expect(p.onSetTrackingStart).toHaveBeenCalledWith('2026-10-01');
    p.rerender(<Journal {...p} trackingStartDate="2026-03-01" />);
    expect((screen.getByLabelText('Point de départ du suivi') as HTMLInputElement).value).toBe('2026-03-01');
    fireEvent.click(screen.getByRole('button', { name: 'Retirer le point de départ' }));
    expect(p.onSetTrackingStart).toHaveBeenLastCalledWith(undefined);
  });
});
