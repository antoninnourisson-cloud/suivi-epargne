// @vitest-environment jsdom
// « Mes comptes » : fraîcheur du solde de chaque compte (« Solde vérifié »), total d'une
// étiquette (projet), performance d'un placement.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { AccountsView } from './AccountsView';
import { DEFAULT_FISCAL_CONFIG } from '../constants';
import { AccountType, type SavingsAccount } from '../types';
import { localTodayISO } from '../lib/dates';

afterEach(cleanup);

const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const acc = (over: Partial<SavingsAccount>): SavingsAccount => ({
  id: 'a', name: 'Livret A', type: AccountType.LIVRET_A, institution: 'Banque', totalAmount: 1000, ownedAmount: 1000, parentalCapital: 0, movements: [], ...over,
});

const setup = (accounts: SavingsAccount[]) => {
  const handleSaveAccount = vi.fn();
  render(
    <AccountsView
      accounts={accounts} fiscalConfig={DEFAULT_FISCAL_CONFIG} onUpdateAccounts={vi.fn()} setView={vi.fn()}
      editingAccount={undefined} setEditingAccount={vi.fn()} showForm={false} setShowForm={vi.fn()}
      handleSaveAccount={handleSaveAccount} handleDeleteAccount={vi.fn()} handleDeleteMovement={vi.fn()} handleRenameMovement={vi.fn()}
      hasParental={false}
    />,
  );
  return { handleSaveAccount };
};

const rowOf = (name: string) => screen.getByRole('button', { name: `${name} : voir les mouvements` }).closest('tr')!;

describe('Mes comptes', () => {
  it('fraîcheur : « Solde vérifié » sur un compte en retard date le solde du jour', () => {
    const { handleSaveAccount } = setup([
      acc({ id: 'lep', name: 'LEP', type: AccountType.LEP, balanceCheckedAt: daysAgo(120) }),
      acc({ id: 'cc', name: 'Compte courant', type: AccountType.COMPTE_COURANT, balanceCheckedAt: daysAgo(2) }),
    ]);
    const lep = within(rowOf('LEP'));
    expect(lep.getByText(/Solde vérifié il y a 4 mois/)).toBeTruthy();
    fireEvent.click(lep.getByRole('button', { name: /Solde vérifié/ }));
    expect(handleSaveAccount).toHaveBeenCalledWith(expect.objectContaining({ id: 'lep', balanceCheckedAt: localTodayISO() }));
    const cc = within(rowOf('Compte courant'));
    expect(cc.getByText('Solde vérifié il y a 2 jours')).toBeTruthy();
    expect(cc.queryByRole('button', { name: /Solde vérifié/ })).toBeNull();
  });

  it('compte courant vérifié il y a 20 jours : « Solde vérifié » proposé (l’argent qui dort n’est chiffré que sur 15 jours)', () => {
    const { handleSaveAccount } = setup([acc({ id: 'cc', name: 'Compte courant', type: AccountType.COMPTE_COURANT, balanceCheckedAt: daysAgo(20) })]);
    const cc = within(rowOf('Compte courant'));
    expect(cc.getByText('Solde vérifié il y a 20 jours').className).not.toMatch(/text-tertiary/);
    fireEvent.click(cc.getByRole('button', { name: /Solde vérifié/ }));
    expect(handleSaveAccount).toHaveBeenCalledWith(expect.objectContaining({ id: 'cc', balanceCheckedAt: localTodayISO() }));
  });

  it('étiquette choisie : total du projet', () => {
    setup([
      acc({ id: '1', name: 'Livret A', tags: ['Voyage'], ownedAmount: 800, totalAmount: 800 }),
      acc({ id: '2', name: 'LDDS', type: AccountType.LDDS, tags: ['Voyage'], ownedAmount: 1000, totalAmount: 1000 }),
      acc({ id: '3', name: 'LEP', type: AccountType.LEP, tags: ['Précaution'] }),
    ]);
    fireEvent.click(within(screen.getByRole('group', { name: 'Filtrer par étiquette' })).getByRole('button', { name: 'Voyage' }));
    expect(screen.getByText(/Total « Voyage »/).textContent).toMatch(/Total « Voyage » : 1\s800\s€ de votre part, sur 2 comptes\./);
    expect(screen.queryByRole('button', { name: 'LEP : voir les mouvements' })).toBeNull();
  });

  it('placement : gain et rendement annuel, ou invitation à actualiser la valeur', () => {
    setup([
      acc({
        id: 'pea', name: 'PEA', type: AccountType.PEA, totalAmount: 1100, ownedAmount: 1100, totalDeposits: 1000,
        movements: [
          { id: 'i', date: '2024-01-01', amount: 1000, label: 'Solde initial', type: 'IN', tag: 'initial' },
          { id: 'v', date: '2025-01-01', amount: 100, label: 'Valorisation (+)', type: 'IN', kind: 'valuation' },
        ],
      }),
      acc({ id: 'c', name: 'Crypto', type: AccountType.CRYPTO, movements: [{ id: 'i', date: daysAgo(30), amount: 1000, label: 'Solde initial', type: 'IN', tag: 'initial' }] }),
    ]);
    expect(within(rowOf('PEA')).getByText(/Gain/).textContent).toMatch(/Gain \+100\s€ · \+[\d,]+\s% par an depuis janvier 2024/);
    expect(within(rowOf('Crypto')).getByText('Performance : actualisez la valeur du compte pour la mesurer.')).toBeTruthy();
  });
});
