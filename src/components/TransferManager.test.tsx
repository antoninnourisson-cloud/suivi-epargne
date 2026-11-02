// @vitest-environment jsdom
// Comptes › Mouvements (« Faire un virement », échéances récurrentes) et Abonnements (Material
// 3) : le virement est confié au bouton « Mouvement », panneau repliable accessible ;
// abonnements ajoutés, modifiés (ancien prix gardé), mis en pause et supprimés avec « Annuler ».
import { describe, it, expect, vi, afterEach } from 'vitest';
import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AccountType, type SavingsAccount, type Subscription } from '../types';
import { ToastContext } from './Toast';
import { TransferManager } from './TransferManager';
import { Subscriptions } from './Subscriptions';

type AddToast = NonNullable<React.ContextType<typeof ToastContext>>;

afterEach(cleanup);

const accounts: SavingsAccount[] = [
  { id: 'la', name: 'Livret A', institution: 'B', type: AccountType.LIVRET_A, totalAmount: 15200, ownedAmount: 8200, parentalCapital: 7000, movements: [] },
  { id: 'ldds', name: 'LDDS', institution: 'B', type: AccountType.LDDS, totalAmount: 3000, ownedAmount: 3000, parentalCapital: 0, movements: [] },
];

const renderTransfers = (accs = accounts) => {
  const props = { onOpenTransfer: vi.fn(), onUpdateRecurring: vi.fn(), recurringMovements: [] };
  render(<TransferManager accounts={accs} {...props} />);
  return props;
};

describe('TransferManager', () => {
  it('sans compte : rien (le journal dit déjà quoi faire)', () => {
    renderTransfers([]);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('« Faire un virement » ouvre la feuille du bouton « Mouvement » (pas de second formulaire ici)', () => {
    const p = renderTransfers();
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.queryByLabelText('Montant du virement')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Faire un virement' }));
    expect(p.onOpenTransfer).toHaveBeenCalledOnce();
  });

  it('échéances récurrentes : panneau replié ; un seul compte, pas de virement possible', () => {
    renderTransfers([accounts[0]]);
    expect(screen.queryByRole('button', { name: 'Faire un virement' })).toBeNull();
    const panel = screen.getByRole('button', { name: 'Échéances récurrentes' });
    expect(panel.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(panel);
    expect(screen.getByRole('region', { name: 'Échéances récurrentes' })).toBeTruthy();
  });
});

describe('Subscriptions', () => {
  const Harness = ({ initial, addToast }: { initial: Subscription[]; addToast: AddToast }) => {
    const [subs, setSubs] = useState(initial);
    return <ToastContext.Provider value={addToast}><Subscriptions subscriptions={subs} onUpdate={setSubs} monthlyPay={2500} /></ToastContext.Provider>;
  };

  it('ajout, modification (ancien prix gardé), pause et suppression annulable', () => {
    const addToast = vi.fn<AddToast>(() => 'id');
    render(<Harness initial={[]} addToast={addToast} />);
    fireEvent.click(screen.getByRole('button', { name: "Ajouter l'abonnement" }));
    expect(screen.getByRole('alert').textContent).toMatch(/Donnez un nom/);
    fireEvent.change(screen.getByLabelText("Nom de l'abonnement"), { target: { value: 'Netflix' } });
    fireEvent.change(screen.getByLabelText('Montant'), { target: { value: '13,49' } });
    fireEvent.click(screen.getByRole('button', { name: "Ajouter l'abonnement" }));
    expect(screen.getByRole('region', { name: 'Vos abonnements' }).textContent).toMatch(/Netflix.*Mensuel/);

    fireEvent.click(screen.getByRole('button', { name: 'Modifier Netflix' }));
    expect(screen.getByRole('heading', { name: "Modifier l'abonnement" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Montant'), { target: { value: '15,99' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(screen.getByRole('region', { name: 'Revue des abonnements' }).textContent).toMatch(/Hausse : 13,49\s€ → 15,99\s€/);

    fireEvent.click(screen.getByRole('button', { name: 'Mettre en pause Netflix' }));
    expect(screen.getByText('En pause')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Réactiver Netflix' }));

    fireEvent.click(screen.getByRole('button', { name: 'Supprimer Netflix' }));
    expect(screen.queryByRole('region', { name: 'Vos abonnements' })).toBeNull();
    expect(addToast.mock.calls[0][0].action?.label).toBe('Annuler');
  });
});
