// @vitest-environment jsdom
// « Actualiser les soldes » : un solde qui n'a pas bougé se confirme tel quel (« Inchangé »),
// ce qui éteint le rappel « Solde à vérifier » sans créer de mouvement.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { AccountUpdate } from './AccountUpdate';
import { AccountType, type SavingsAccount } from '../types';
import { localTodayISO } from '../lib/dates';
import { applyPatch, type CommandPatch } from '../lib/commands';

afterEach(() => { cleanup(); try { sessionStorage.clear(); } catch { /* ignoré */ } });

const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const lep: SavingsAccount = {
  id: 'lep', name: 'LEP', institution: 'Banque', type: AccountType.LEP, totalAmount: 5000, ownedAmount: 5000, parentalCapital: 0,
  movements: [], balanceCheckedAt: daysAgo(122),
};
const ldds: SavingsAccount = {
  id: 'ldds', name: 'LDDS', institution: 'Banque', type: AccountType.LDDS, totalAmount: 3000, ownedAmount: 3000, parentalCapital: 0,
  movements: [], balanceCheckedAt: daysAgo(10),
};

const setup = (accounts: SavingsAccount[]) => {
  const onCommit = vi.fn<(p: CommandPatch) => void>();
  render(<AccountUpdate accounts={accounts} onCommit={onCommit} />);
  return { onCommit };
};
const row = (name: RegExp) => screen.getByRole('button', { name }).closest('li')!;

describe('Actualiser : « Inchangé »', () => {
  it('chaque ligne dit depuis quand le solde est vérifié ; « Inchangé » d’office pour un solde à revérifier', () => {
    setup([lep, ldds]);
    expect(within(row(/^LEP/)).getByText('Solde vérifié il y a 4 mois').className).toMatch(/text-tertiary/);
    expect(within(row(/^LDDS/)).getByText('Solde vérifié il y a 10 jours')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Solde de LEP inchangé' })).toBeTruthy();
    // Solde récent : proposé seulement sur la ligne dépliée.
    expect(screen.queryByRole('button', { name: 'Solde de LDDS inchangé' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^LDDS/ }));
    expect(screen.getByRole('button', { name: 'Solde de LDDS inchangé' })).toBeTruthy();
  });

  it('« Tout enregistrer » marche avec seulement des soldes confirmés : constat daté du jour, aucun mouvement', () => {
    const { onCommit } = setup([lep, ldds]);
    const save = screen.getByRole('button', { name: /Tout enregistrer/ }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    const chip = screen.getByRole('button', { name: 'Solde de LEP inchangé' });
    fireEvent.click(chip);
    expect(chip.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('1 solde confirmé')).toBeTruthy();
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    expect(onCommit).toHaveBeenCalledTimes(1);
    const next = applyPatch({ accounts: [lep, ldds] }, onCommit.mock.calls[0][0]);
    expect(next.accounts[0]).toMatchObject({ balanceCheckedAt: localTodayISO(), ownedAmount: 5000, movements: [] });
    expect(next.accounts[1]).toEqual(ldds);
  });

  it('« Inchangé » retiré ou saisie d’un nouveau solde : plus de confirmation seule', () => {
    setup([lep]);
    const chip = screen.getByRole('button', { name: 'Solde de LEP inchangé' });
    fireEvent.click(chip);
    fireEvent.click(chip);
    expect(screen.queryByText('1 solde confirmé')).toBeNull();
    fireEvent.click(chip);
    // Un seul compte : la ligne est déjà dépliée.
    fireEvent.change(screen.getByLabelText('Ma part sur LEP'), { target: { value: '5100' } });
    expect(screen.queryByRole('button', { name: 'Solde de LEP inchangé' })).toBeNull();
    expect(screen.getByText('1 compte modifié')).toBeTruthy();
  });
});
