// @vitest-environment jsdom
// Ajout rapide : saisie protégée d'un toucher hors de la feuille, part des parents jamais
// retirable ni virée, virement entre deux comptes, libellés proposés, bouton d'ajout selon l'écran (téléphone / ordinateur).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AccountType, type SavingsAccount } from '../types';
import { QuickAddModal, type TransferRequest } from './QuickAddModal';
import { QuickAddFab, QuickAddNavButton, showQuickAddFab } from './QuickAddFab';
import { placeOf } from '../navigation';
import { Modal } from './Modal';

afterEach(() => { cleanup(); localStorage.clear(); });

const accounts: SavingsAccount[] = [
  { id: 'la', name: 'Livret A', institution: 'B', type: AccountType.LIVRET_A, totalAmount: 15200, ownedAmount: 8200, parentalCapital: 7000, movements: [] },
  { id: 'ldds', name: 'LDDS', institution: 'B', type: AccountType.LDDS, totalAmount: 3000, ownedAmount: 3000, parentalCapital: 0, movements: [] },
];

const setup = () => {
  const onClose = vi.fn();
  const onSubmit = vi.fn();
  render(<QuickAddModal open accounts={accounts} onClose={onClose} onSubmit={onSubmit} />);
  const dialog = screen.getByRole('dialog', { name: 'Ajouter un mouvement' });
  const scrim = dialog.parentElement!;
  return { onClose, onSubmit, dialog, scrim };
};

describe('QuickAddModal', () => {
  it('formulaire vide : un toucher sur le voile ferme la feuille', () => {
    const { onClose, scrim } = setup();
    fireEvent.click(scrim);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('saisie commencée : le voile ne ferme plus, Échap et « Fermer » si', () => {
    const { onClose, scrim } = setup();
    fireEvent.change(screen.getByLabelText('Montant'), { target: { value: '42' } });
    fireEvent.click(scrim);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Fermer' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('un libellé proposé suffit aussi à protéger la saisie', () => {
    const { onClose, scrim } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Cadeau' }));
    expect((screen.getByLabelText('Libellé (facultatif)') as HTMLInputElement).value).toBe('Cadeau');
    expect(screen.getByRole('button', { name: 'Cadeau' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(scrim);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('ajoute un dépôt (libellé par défaut) et retient le compte', () => {
    const { onSubmit, onClose } = setup();
    fireEvent.change(screen.getByLabelText('Compte'), { target: { value: 'ldds' } });
    fireEvent.change(screen.getByLabelText('Montant'), { target: { value: '123,5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter' }));
    expect(onSubmit).toHaveBeenCalledWith('ldds', 123.5, 'IN', 'Dépôt', expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
    expect(onClose).toHaveBeenCalled();
    expect(localStorage.getItem('quickadd_last_account')).toBe('ldds');
  });

  it('bouton « Ajouter » grisé : la raison est écrite et reliée au bouton', () => {
    setup();
    const add = screen.getByRole('button', { name: 'Ajouter' }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    const why = () => document.getElementById(add.getAttribute('aria-describedby') ?? '')?.textContent;
    expect(why()).toMatch(/Indiquez un montant|Choisissez un compte/);
    fireEvent.change(screen.getByLabelText('Compte'), { target: { value: 'ldds' } });
    expect(why()).toBe('Indiquez un montant pour pouvoir ajouter.');
    fireEvent.change(screen.getByLabelText('Montant'), { target: { value: '10' } });
    expect(add.disabled).toBe(false);
    expect(add.getAttribute('aria-describedby')).toBeNull();
    expect(screen.queryByText(/pour pouvoir ajouter/)).toBeNull();
  });

  it('un retrait ne peut pas entamer la part des parents', () => {
    const { onSubmit } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Retrait' }));
    expect(screen.getByRole('group', { name: 'Type de mouvement' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Montant'), { target: { value: '9000' } });
    expect(screen.getByRole('alert').textContent).toMatch(/la part de vos parents ne peut pas être retirée/);
    const add = screen.getByRole('button', { name: 'Ajouter' }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Montant'), { target: { value: '200' } });
    fireEvent.click(add);
    expect(onSubmit).toHaveBeenCalledWith('la', 200, 'OUT', 'Retrait', expect.any(String));
  });
});

describe('QuickAddModal, virement', () => {
  const setupTransfer = (props: Partial<React.ComponentProps<typeof QuickAddModal>> = {}) => {
    const onClose = vi.fn();
    const onSubmit = vi.fn();
    const onTransfer = vi.fn<(r: TransferRequest) => string | null>(() => null);
    render(<QuickAddModal open accounts={accounts} onClose={onClose} onSubmit={onSubmit} onTransfer={onTransfer} {...props} />);
    return { onClose, onSubmit, onTransfer };
  };

  it('« Faire un virement » : la feuille s’ouvre sur Virement, compte d’arrivée à choisir (jamais le compte de départ)', () => {
    setupTransfer({ initialKind: 'TRANSFER' });
    expect(screen.getByRole('button', { name: 'Virement' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByLabelText('Libellé (facultatif)')).toBeNull();
    const from = screen.getByLabelText('Compte de départ') as HTMLSelectElement;
    const to = screen.getByLabelText("Compte d'arrivée") as HTMLSelectElement;
    expect(from.value).toBe('la');
    expect(to.value).toBe('');
    expect((to.querySelector('option[value="la"]') as HTMLOptionElement).disabled).toBe(true);
    const save = screen.getByRole('button', { name: 'Enregistrer le virement' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(document.getElementById(save.getAttribute('aria-describedby') ?? '')?.textContent).toBe("Choisissez le compte d'arrivée pour pouvoir enregistrer.");
    // Le compte de départ choisi comme arrivée : l'arrivée est à rechoisir.
    fireEvent.change(to, { target: { value: 'ldds' } });
    fireEvent.change(from, { target: { value: 'ldds' } });
    expect(to.value).toBe('');
  });

  it('jamais au-delà de votre part ; enregistré : la feuille se ferme', () => {
    const { onTransfer, onClose, onSubmit } = setupTransfer();
    fireEvent.click(screen.getByRole('button', { name: 'Virement' }));
    fireEvent.change(screen.getByLabelText("Compte d'arrivée"), { target: { value: 'ldds' } });
    fireEvent.change(screen.getByLabelText('Montant'), { target: { value: '9000' } });
    expect(screen.getByRole('alert').textContent).toMatch(/la part de vos parents ne peut pas être retirée/);
    const save = screen.getByRole('button', { name: 'Enregistrer le virement' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Montant'), { target: { value: '500' } });
    fireEvent.click(save);
    expect(onTransfer).toHaveBeenCalledWith({ sourceId: 'la', destId: 'ldds', amount: 500, date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('virement refusé par la commande : la raison est écrite, la feuille reste ouverte', () => {
    const { onTransfer, onClose } = setupTransfer({ initialKind: 'TRANSFER' });
    onTransfer.mockReturnValueOnce('Fonds insuffisants.');
    fireEvent.change(screen.getByLabelText("Compte d'arrivée"), { target: { value: 'ldds' } });
    fireEvent.change(screen.getByLabelText('Montant'), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer le virement' }));
    expect(screen.getByRole('alert').textContent).toMatch(/Fonds insuffisants/);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('un seul compte : pas de choix « Virement » (la feuille s’ouvre sur Dépôt)', () => {
    setupTransfer({ accounts: [accounts[0]], initialKind: 'TRANSFER' });
    expect(screen.queryByRole('button', { name: 'Virement' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Dépôt' }).getAttribute('aria-pressed')).toBe('true');
  });
});

describe('QuickAddModal, mode solo', () => {
  it('sans part des parents sur le compte, le refus ne parle pas des parents', () => {
    setup();
    fireEvent.change(screen.getByLabelText('Compte'), { target: { value: 'ldds' } });
    fireEvent.click(screen.getByRole('button', { name: 'Retrait' }));
    fireEvent.change(screen.getByLabelText('Montant'), { target: { value: '5000' } });
    const alert = screen.getByRole('alert').textContent ?? '';
    expect(alert).toMatch(/Le solde de ce compte est de 3\s000\s€ : impossible de retirer davantage\./);
    expect(alert).not.toMatch(/parents/);
  });
});

describe('Modal', () => {
  it('ferme au clic sur le voile par défaut, pas avec closeOnScrim={false}', () => {
    const onClose = vi.fn();
    const { rerender } = render(<Modal open onClose={onClose} label="Boîte"><button type="button">Ok</button></Modal>);
    fireEvent.click(screen.getByRole('dialog', { name: 'Boîte' }).parentElement!);
    expect(onClose).toHaveBeenCalledTimes(1);
    rerender(<Modal open onClose={onClose} label="Boîte" closeOnScrim={false}><button type="button">Ok</button></Modal>);
    fireEvent.click(screen.getByRole('dialog', { name: 'Boîte' }).parentElement!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('bouton d’ajout rapide', () => {
  it('masqué sur les écrans qui ont déjà leur ajout ou leur enregistrement', () => {
    for (const v of ['update', 'subscriptions', 'donations', 'payslips', 'parental', 'settings'] as const) expect(showQuickAddFab(placeOf(v))).toBe(false);
    // Comptes › Mouvements (ex-Journal et ex-Virements) le garde.
    for (const v of ['dashboard', 'accounts', 'journal', 'transfers', 'pilot', 'history', 'agenda'] as const) expect(showQuickAddFab(placeOf(v))).toBe(true);
    expect(showQuickAddFab({ screen: 'taxes', tab: 'calendar' })).toBe(true);
  });

  it('téléphone : « Mouvement » visible, nom complet pour les lecteurs d’écran ; ordinateur : libellé complet', () => {
    const onClick = vi.fn();
    render(<>
      <QuickAddFab scrollRef={{ current: document.body }} resetKey="dashboard" onClick={onClick} />
      <QuickAddNavButton onClick={onClick} />
    </>);
    const [fab, nav] = screen.getAllByRole('button', { name: 'Ajouter un mouvement' });
    expect(fab.textContent).toContain('Mouvement');
    expect(fab.className).toContain('md:hidden');
    expect(nav.textContent).toContain('Ajouter un mouvement');
    fireEvent.click(fab);
    fireEvent.click(nav);
    expect(onClick).toHaveBeenCalledTimes(2);
  });
});
