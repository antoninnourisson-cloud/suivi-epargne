// @vitest-environment jsdom
// Virements et Abonnements (Material 3) : onglets accessibles, erreurs dites dans le
// formulaire, virement annulable, dépôt confié à l'ajout rapide, capital des parents jamais
// viré ; abonnements ajoutés, modifiés (ancien prix gardé), mis en pause et supprimés avec
// « Annuler ».
import { describe, it, expect, vi, afterEach } from 'vitest';
import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AccountType, type SavingsAccount, type Subscription } from '../types';
import type { CommandPatch } from '../lib/commands';
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
  const addToast = vi.fn<AddToast>(() => 'id');
  const props = {
    onCommit: vi.fn<(patch: CommandPatch) => void>(),
    onUpdateRecurring: vi.fn(), recurringMovements: [],
    onQuickAdd: vi.fn(),
  };
  render(<ToastContext.Provider value={addToast}><TransferManager accounts={accs} {...props} /></ToastContext.Provider>);
  return { ...props, addToast };
};

describe('TransferManager', () => {
  it('sans compte : un état vide qui dit quoi faire', () => {
    renderTransfers([]);
    expect(screen.getByRole('heading', { name: 'Virements', level: 2 })).toBeTruthy();
    expect(screen.getByText("Aucun compte pour l'instant")).toBeTruthy();
  });

  it('dépôt ou retrait : un seul chemin, l’ajout rapide (pas de second formulaire ici)', () => {
    const p = renderTransfers();
    expect(screen.getAllByRole('tab').map(t => t.textContent)).toEqual(['Virement', 'Récurrents']);
    expect(screen.queryByLabelText('Montant du dépôt')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Dépôt ou retrait' }));
    expect(p.onQuickAdd).toHaveBeenCalledTimes(1);
    expect(p.onCommit).not.toHaveBeenCalled();
  });

  it('virement : jamais au-delà de votre part (le capital des parents reste)', () => {
    const p = renderTransfers();
    expect(screen.getByRole('tab', { name: 'Virement' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.change(screen.getByLabelText('Compte de départ'), { target: { value: 'la' } });
    fireEvent.change(screen.getByLabelText("Compte d'arrivée"), { target: { value: 'ldds' } });
    fireEvent.change(screen.getByLabelText('Montant du virement'), { target: { value: 'abc' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Enregistrer le virement' }).closest('form')!);
    expect(screen.getByRole('alert').textContent).toMatch(/Montant non reconnu/);
    fireEvent.change(screen.getByLabelText('Montant du virement'), { target: { value: '9000' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Enregistrer le virement' }).closest('form')!);
    expect(screen.getByRole('alert').textContent).toMatch(/Fonds insuffisants : votre part sur Livret A/);
    expect(p.onCommit).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Montant du virement'), { target: { value: '500' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Enregistrer le virement' }).closest('form')!);
    // Commande appliquée : 500 € quittent votre part du Livret A (le capital des parents reste)
    // et arrivent sur le LDDS, en deux lignes appariées.
    expect(p.onCommit).toHaveBeenCalledTimes(1);
    const next = p.onCommit.mock.calls[0][0].accounts!;
    expect(next.find(a => a.id === 'la')).toMatchObject({ ownedAmount: 7700, parentalCapital: 7000, totalAmount: 14700 });
    expect(next.find(a => a.id === 'ldds')).toMatchObject({ ownedAmount: 3500, totalAmount: 3500 });
    // « Annuler » dans le message de confirmation, comme pour l'ajout rapide.
    const toast = p.addToast.mock.calls[0][0];
    expect(toast.message).toMatch(/^Virement de 500,00\s€ : Livret A → LDDS$/);
    expect(toast.action?.label).toBe('Annuler');
    toast.action!.onClick();
    expect(p.onCommit).toHaveBeenCalledTimes(2);
    expect(p.onCommit.mock.calls[1][0].accounts).toEqual(accounts);
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
