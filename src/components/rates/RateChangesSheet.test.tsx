// @vitest-environment jsdom
// « Les taux ont changé » : taux de la veille corrigeable, autres comptes optionnels (vide ou
// inchangé : rien), même date d'effet par défaut, « Ignorer ces taux », ouverture à la main.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { RateChangesSheet, type RateChangesSheetProps } from './RateChangesSheet';
import { AccountType, type SavingsAccount } from '../../types';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 4, 12));
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

const account = (id: string, name: string, type: AccountType, interestRate: number): SavingsAccount => ({
  id, name, type, institution: 'B', totalAmount: 1000, ownedAmount: 1000, parentalCapital: 0, movements: [], interestRate,
});
const accounts = [
  account('la', 'Livret A', AccountType.LIVRET_A, 1.7),
  account('ldds', 'LDDS', AccountType.LDDS, 1.7),
  account('lb', 'Livret Plus', AccountType.LIVRET_BANCAIRE, 3),
  account('av', 'Assurance vie', AccountType.ASSURANCE_VIE, 2.6),
];
const proposal = { group: 'livretA', groupLabel: 'Livret A et LDDS', current: 1.7, value: 1.5, effectiveDate: '2027-02-01', source: 'https://www.service-public.gouv.fr/particuliers/vosdroits/F2365' };

const setup = (over: Partial<RateChangesSheetProps> = {}) => {
  const props: RateChangesSheetProps = { accounts, proposals: [proposal], onApply: vi.fn(() => null), onIgnore: vi.fn(), onClose: vi.fn(), ...over };
  render(<RateChangesSheet {...props} />);
  return { props, dialog: screen.getByRole('dialog') };
};
const type = (dialog: HTMLElement, label: string, value: string) => fireEvent.change(within(dialog).getByLabelText(label), { target: { value } });

describe('RateChangesSheet', () => {
  it('taux de la veille corrigé, un autre compte modifié, l’autre laissé : une seule application', () => {
    const { props, dialog } = setup();
    expect(within(dialog).getByRole('heading', { name: 'Les taux ont changé' })).toBeTruthy();
    expect(within(dialog).getByText(/Actuel : 1,7 % · Livret A, LDDS/)).toBeTruthy();
    expect((within(dialog).getByLabelText('Nouveau taux, Livret A et LDDS') as HTMLInputElement).value).toBe('1,5');
    expect(within(dialog).getByRole('link', { name: /service-public\.gouv\.fr/ })).toBeTruthy();
    const others = within(dialog).getByRole('list', { name: 'Vos autres comptes' });
    expect(within(others).getAllByRole('listitem').map(li => li.textContent)).toEqual([expect.stringMatching(/^Livret PlusActuel : 3 %/), expect.stringMatching(/^Assurance vieActuel : 2,6 %/)]);
    // Même date d'effet que le Livret A, tant qu'elle n'est pas changée.
    expect((within(dialog).getByLabelText('À partir du, autres comptes') as HTMLInputElement).value).toBe('2027-02-01');
    expect(within(dialog).getByText('Même date que Livret A et LDDS.')).toBeTruthy();

    type(dialog, 'Nouveau taux, Livret A et LDDS', '1,6');
    type(dialog, 'Nouveau taux, Livret Plus', '2,5');
    type(dialog, 'Nouveau taux, Assurance vie', '2,6');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Appliquer' }));
    expect(props.onApply).toHaveBeenCalledWith({
      groups: [{ key: 'livretA', rate: 1.6, date: '2027-02-01' }],
      accounts: [{ accountId: 'lb', rate: 2.5, date: '2027-02-01' }],
    });
    expect(props.onClose).toHaveBeenCalled();
  });

  it('taux illisible : « Appliquer » désactivé ; refus affiché ; « Ignorer ces taux »', () => {
    const onApply = vi.fn(() => 'Refusé');
    const { props, dialog } = setup({ onApply });
    const apply = within(dialog).getByRole('button', { name: 'Appliquer' }) as HTMLButtonElement;
    type(dialog, 'Nouveau taux, Livret Plus', 'beaucoup');
    expect(within(dialog).getByText('Taux non reconnu (exemple : 1,5)')).toBeTruthy();
    expect(apply.disabled).toBe(true);
    type(dialog, 'Nouveau taux, Livret Plus', '');
    type(dialog, 'Nouveau taux, Livret A et LDDS', '');
    expect(apply.disabled).toBe(true);
    type(dialog, 'Nouveau taux, Livret A et LDDS', '1,5');
    // Date des autres comptes changée à la main : elle ne suit plus.
    type(dialog, 'À partir du, autres comptes', '2026-11-04');
    type(dialog, 'À partir du, Livret A et LDDS', '2027-02-02');
    expect((within(dialog).getByLabelText('À partir du, autres comptes') as HTMLInputElement).value).toBe('2026-11-04');
    fireEvent.click(apply);
    expect(within(dialog).getByRole('alert').textContent).toBe('Refusé');
    expect(props.onClose).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ignorer ces taux' }));
    expect(props.onIgnore).toHaveBeenCalled();
    expect(props.onClose).toHaveBeenCalled();
  });

  it('ouverte à la main : les autres comptes seulement, à la date du jour', () => {
    const { props, dialog } = setup({ proposals: [], onIgnore: undefined });
    expect(within(dialog).getByRole('heading', { name: 'Un taux a changé ?' })).toBeTruthy();
    expect(within(dialog).queryByRole('list', { name: 'Taux réglementés' })).toBeNull();
    expect(within(dialog).queryByRole('button', { name: 'Ignorer ces taux' })).toBeNull();
    expect((within(dialog).getByLabelText('À partir du, autres comptes') as HTMLInputElement).value).toBe('2026-11-04');
    const apply = within(dialog).getByRole('button', { name: 'Appliquer' }) as HTMLButtonElement;
    expect(apply.disabled).toBe(true);
    type(dialog, 'Nouveau taux, Assurance vie', '2,4');
    fireEvent.click(apply);
    expect(props.onApply).toHaveBeenCalledWith({ groups: [], accounts: [{ accountId: 'av', rate: 2.4, date: '2026-11-04' }] });
  });

  it('sans livret bancaire ni assurance vie : rien d’autre à corriger', () => {
    const { dialog } = setup({ accounts: accounts.slice(0, 2) });
    expect(within(dialog).getByText("Aucun livret bancaire ni assurance vie : rien d'autre à corriger.")).toBeTruthy();
  });
});
