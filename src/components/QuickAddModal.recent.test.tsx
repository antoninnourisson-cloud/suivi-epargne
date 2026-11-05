// @vitest-environment jsdom
// Mouvement rapide : les trois derniers libellés du compte en tête des puces, avec leur
// dernier montant au toucher ; les puces fixes suivent, sans doublon.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AccountType, type AccountMovement, type SavingsAccount } from '../types';
import { QuickAddModal, recentLabels } from './QuickAddModal';

afterEach(() => { cleanup(); localStorage.clear(); });

const mv = (id: string, date: string, label: string, amount: number, extra: Partial<AccountMovement> = {}): AccountMovement =>
  ({ id, date, label, amount, type: 'IN', ...extra });
const base = { institution: 'B', parentalCapital: 0 };
const accounts: SavingsAccount[] = [
  { ...base, id: 'la', name: 'Livret A', type: AccountType.LIVRET_A, totalAmount: 1000, ownedAmount: 1000, movements: [
    mv('1', '2026-01-05', 'Paie', 300),
    mv('2', '2026-02-05', 'Cadeau mamie', 50),
    mv('3', '2026-03-05', 'paie', 450),
    mv('4', '2026-03-06', 'Intérêts versés', 12, { kind: 'adjustment' }),
    mv('5', '2026-03-07', 'Virement vers LDDS', 100, { linkId: 'x' }),
    mv('6', '2026-04-05', 'Épargne du mois', 200),
    mv('7', '2026-04-06', 'Cadeau', 20),
    mv('8', '2026-04-07', 'Courses', 40),
    mv('9', '2026-04-08', 'Retrait loyer', 600, { type: 'OUT' }),
  ] },
  { ...base, id: 'ldds', name: 'LDDS', type: AccountType.LDDS, totalAmount: 500, ownedAmount: 500, movements: [] },
];

const open = () => {
  render(<QuickAddModal open accounts={accounts} onClose={vi.fn()} onSubmit={vi.fn()} />);
  return screen.getByRole('group', { name: 'Libellés proposés' });
};
const chipNames = (group: HTMLElement) => Array.from(group.querySelectorAll('button')).map(b => b.textContent);

describe('recentLabels', () => {
  it('distincts sans tenir compte des majuscules, du plus récent au plus ancien, avec le dernier montant', () => {
    expect(recentLabels(accounts[0], 'IN')).toEqual([
      { label: 'Courses', amount: 40 }, { label: 'Cadeau', amount: 20 }, { label: 'Épargne du mois', amount: 200 },
    ]);
    expect(recentLabels(accounts[0], 'OUT')).toEqual([{ label: 'Retrait loyer', amount: 600 }]);
    expect(recentLabels(undefined, 'IN')).toEqual([]);
  });
});

describe('Puces du mouvement rapide', () => {
  it('récents en tête, puis les fixes sans doublon', () => {
    const names = chipNames(open());
    expect(names.slice(0, 3)).toEqual(['Courses', 'Cadeau', 'Épargne du mois']);
    expect(names.slice(3)).toEqual(['Virement de paie', 'Intérêts']);
    expect(new Set(names).size).toBe(names.length);
  });

  it('au toucher : le libellé et le dernier montant, modifiable', () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Cadeau' }));
    expect((screen.getByLabelText('Libellé (facultatif)') as HTMLInputElement).value).toBe('Cadeau');
    expect((screen.getByLabelText('Montant') as HTMLInputElement).value).toMatch(/^20/);
    fireEvent.change(screen.getByLabelText('Montant'), { target: { value: '35' } });
    expect((screen.getByLabelText('Montant') as HTMLInputElement).value).toMatch(/^35/);
  });

  it('une puce fixe ne touche pas au montant', () => {
    open();
    fireEvent.change(screen.getByLabelText('Montant'), { target: { value: '80' } });
    fireEvent.click(screen.getByRole('button', { name: 'Intérêts' }));
    expect((screen.getByLabelText('Montant') as HTMLInputElement).value).toMatch(/^80/);
  });

  it('suit le sens et le compte choisis', () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Retrait', pressed: false }));
    expect(screen.getByRole('button', { name: 'Retrait loyer' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Compte'), { target: { value: 'ldds' } });
    expect(screen.queryByRole('button', { name: 'Retrait loyer' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Projet' })).toBeTruthy();
  });
});
