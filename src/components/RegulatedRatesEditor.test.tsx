// @vitest-environment jsdom
// Taux des livrets réglementés (Accueil, Mes comptes) : champs Material 3 libellés, un taux
// illisible est signalé, et le nouveau taux s'applique à tous les livrets du groupe.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AccountType, type SavingsAccount } from '../types';
import { RegulatedRatesEditor } from './RegulatedRatesEditor';

afterEach(() => cleanup());

const acc = (id: string, type: AccountType, interestRate: number): SavingsAccount => ({
  id, name: id, institution: 'Banque', type, totalAmount: 1000, ownedAmount: 1000, parentalCapital: 0, movements: [], interestRate,
});

describe('RegulatedRatesEditor', () => {
  const accounts = [acc('Livret A', AccountType.LIVRET_A, 2.4), acc('LDDS', AccountType.LDDS, 2.4), acc('LEP', AccountType.LEP, 3.5)];

  it('donne un nom distinct à chaque champ et applique le taux au groupe entier', () => {
    const onApply = vi.fn();
    render(<RegulatedRatesEditor accounts={accounts} onApply={onApply} />);
    const rate = screen.getByLabelText('Nouveau taux, Livret A et LDDS') as HTMLInputElement;
    expect(rate.value).toBe('2,4');
    expect(screen.getByLabelText('Nouveau taux, LEP')).toBeTruthy();
    expect(screen.getByLabelText('À partir du, LEP')).toBeTruthy();

    fireEvent.change(rate, { target: { value: '1,7' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Appliquer' })[0]);
    expect(onApply).toHaveBeenCalledTimes(1);
    const next: SavingsAccount[] = onApply.mock.calls[0][0](accounts);
    expect(next.map(a => a.interestRate)).toEqual([1.7, 1.7, 3.5]);
    expect(screen.getByRole('button', { name: 'Appliqué' })).toBeTruthy();
  });

  it('signale un taux illisible et bloque « Appliquer »', () => {
    render(<RegulatedRatesEditor accounts={accounts} onApply={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Nouveau taux, LEP'), { target: { value: 'abc' } });
    expect(screen.getByRole('alert').textContent).toBe('Taux illisible');
    expect((screen.getAllByRole('button', { name: 'Appliquer' })[1] as HTMLButtonElement).disabled).toBe(true);
  });

  it("n'affiche rien sans livret réglementé", () => {
    const { container } = render(<RegulatedRatesEditor accounts={[acc('PEA', AccountType.PEA, 0)]} onApply={vi.fn()} />);
    expect(container.innerHTML).toBe('');
  });
});
