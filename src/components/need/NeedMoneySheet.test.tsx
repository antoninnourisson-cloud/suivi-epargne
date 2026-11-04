// @vitest-environment jsdom
// « J'ai besoin d'argent » : proposition le moins cher d'abord avec son coût, lignes
// modifiables, phrase de précaution, ce qui manque, enregistrement immédiat ou retrait prévu.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { NeedMoneySheet, type NeedMoneySheetProps } from './NeedMoneySheet';
import { emptyData } from '../../lib/schema';
import { DEFAULT_FISCAL_CONFIG } from '../../constants';
import { AccountType, type SavingsAccount } from '../../types';
import type { EmergencyFund } from '../../lib/planning';

// Le 4 novembre 2026.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 4, 12));
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

const account = (id: string, name: string, type: AccountType, owned: number, over: Partial<SavingsAccount> = {}): SavingsAccount => ({
  id, name, type, institution: 'B', totalAmount: owned + (over.parentalCapital ?? 0), ownedAmount: owned, parentalCapital: 0, movements: [], ...over,
});
const accounts = [
  account('la', 'Livret A', AccountType.LIVRET_A, 5000, { interestRate: 1.7, parentalCapital: 7000 }),
  account('lep', 'LEP', AccountType.LEP, 1000, { interestRate: 2.5 }),
  account('av', 'Assurance vie', AccountType.ASSURANCE_VIE, 4300, { interestRate: 2.6, openingDate: '2024-06-15', totalDeposits: 4000 }),
  account('per', 'PER', AccountType.PER, 9000),
  account('cc', 'Compte courant', AccountType.COMPTE_COURANT, 1000),
];
const emergency = { target: 6000, cashBuffer: 1000, months: 3, monthlySpending: 2000, current: 6000, missing: 0, pct: 100, reached: true } as EmergencyFund;

const setup = (over: Partial<NeedMoneySheetProps> = {}) => {
  const props: NeedMoneySheetProps = {
    accounts, config: emptyData().config, fiscalConfig: DEFAULT_FISCAL_CONFIG, emergency,
    onClose: vi.fn(), onRecord: vi.fn(() => null), onPlan: vi.fn(), ...over,
  };
  render(<NeedMoneySheet {...props} />);
  return { props, dialog: screen.getByRole('dialog', { name: "J'ai besoin d'argent" }) };
};
const ask = (dialog: HTMLElement, amount: string, date?: string) => {
  fireEvent.change(within(dialog).getByLabelText("Montant dont j'ai besoin"), { target: { value: amount } });
  if (date) fireEvent.change(within(dialog).getByLabelText('Pour le'), { target: { value: date } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Voir où le prendre' }));
};

describe('NeedMoneySheet', () => {
  it('besoin d’aujourd’hui : le livret le moins cher, son coût, enregistré en une fois', () => {
    const { props, dialog } = setup({ emergency: { ...emergency, target: 4000 } });
    expect((within(dialog).getByRole('button', { name: 'Voir où le prendre' }) as HTMLButtonElement).disabled).toBe(true);
    ask(dialog, '800');
    expect(within(dialog).getByRole('heading', { name: /^Où prendre 800\s€$/ })).toBeTruthy();
    const list = within(dialog).getByRole('list', { name: 'Retraits proposés' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
    expect(list.textContent).toMatch(/Prendre 800\s€ sur le Livret A/);
    expect(list.textContent).toMatch(/Coût : environ 2\s€ d'intérêts perdus d'ici la fin de l'année\./);
    // La part des parents n'est pas proposée ; le PER et le compte courant non plus.
    const options = within(dialog).getAllByRole('option').map(o => o.textContent);
    expect(options).toEqual([expect.stringMatching(/^Livret A \(5\s000\s€ à vous\)$/), expect.stringMatching(/^LEP/), expect.stringMatching(/^Assurance vie/)]);
    expect(dialog.textContent).toMatch(/Chaque montant sera viré sur Compte courant\./);
    expect(dialog.textContent).not.toMatch(/précaution passera/);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    expect(props.onRecord).toHaveBeenCalledWith([{ accountId: 'la', amount: 800 }], '2026-11-04');
    expect(props.onClose).toHaveBeenCalled();
  });

  it('gros besoin : placements ensuite avec l’impôt, phrase de précaution, ce qui manque ; lignes modifiables', () => {
    const { props, dialog } = setup({ onRecord: vi.fn(() => 'Refusé') });
    ask(dialog, '11000');
    const items = within(within(dialog).getByRole('list', { name: 'Retraits proposés' })).getAllByRole('listitem');
    expect(items.map(i => i.querySelector('p')!.textContent)).toEqual([
      expect.stringMatching(/^Prendre 5\s000\s€ sur le Livret A$/), expect.stringMatching(/^Prendre 1\s000\s€ sur le LEP$/), expect.stringMatching(/^Prendre 4\s300\s€ sur l'Assurance vie$/),
    ]);
    expect(items[2].textContent).toMatch(/d'impôt et de prélèvements sociaux/);
    expect(dialog.textContent).toMatch(/il manque 700\s€/);
    expect(dialog.textContent).toMatch(/Votre épargne de précaution passera à 0\s€, sous son objectif de 6\s000\s€\./);
    // Ligne corrigée : trop haute, refusée ; puis retirée.
    fireEvent.change(within(dialog).getByLabelText('Montant de la ligne 2'), { target: { value: '1500' } });
    expect(dialog.textContent).toMatch(/Votre part sur ce compte est de 1\s000\s€\./);
    expect((within(dialog).getByRole('button', { name: 'Enregistrer' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(items[1]).getByRole('button', { name: 'Retirer cette ligne' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    expect(props.onRecord).toHaveBeenCalledWith([{ accountId: 'la', amount: 5000 }, { accountId: 'av', amount: 4300 }], '2026-11-04');
    // Refus de la commande : écrit dans la feuille, qui reste ouverte.
    expect(within(dialog).getByRole('alert').textContent).toBe('Refusé');
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it('besoin futur : le meilleur jour (le 16), le conseil des quinzaines, puis un retrait prévu', () => {
    const { props, dialog } = setup();
    ask(dialog, '2400', '2026-11-20');
    expect(dialog.textContent).toMatch(/Le meilleur jour : le 16 novembre\. Retiré ce jour-là plutôt qu'aujourd'hui, l'argent garde environ 2\s€ d'intérêts/);
    expect(dialog.textContent).toMatch(/Pécule vous le rappellera sur l'Accueil le 16 novembre, pour votre besoin du 20 novembre\./);
    fireEvent.change(within(dialog).getByLabelText('Compte de la ligne 1'), { target: { value: 'lep' } });
    fireEvent.change(within(dialog).getByLabelText('Montant de la ligne 1'), { target: { value: '500' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Autre compte' }));
    fireEvent.change(within(dialog).getByLabelText('Montant de la ligne 2'), { target: { value: '1900' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Prévoir le retrait' }));
    expect(props.onRecord).not.toHaveBeenCalled();
    expect(props.onPlan).toHaveBeenCalledWith({ id: expect.any(String), date: '2026-11-16', needDate: '2026-11-20', lines: [{ accountId: 'lep', amount: 500 }, { accountId: 'la', amount: 1900 }] });
  });

  it('date passée refusée, montant illisible signalé, retour à la saisie', () => {
    const { dialog } = setup();
    fireEvent.change(within(dialog).getByLabelText("Montant dont j'ai besoin"), { target: { value: 'abc' } });
    expect(dialog.textContent).toMatch(/Montant non reconnu/);
    fireEvent.change(within(dialog).getByLabelText("Montant dont j'ai besoin"), { target: { value: '100' } });
    fireEvent.change(within(dialog).getByLabelText('Pour le'), { target: { value: '2026-11-01' } });
    expect((within(dialog).getByRole('button', { name: 'Voir où le prendre' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText('Pour le'), { target: { value: '2026-11-04' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Voir où le prendre' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Retour' }));
    expect(within(dialog).getByLabelText("Montant dont j'ai besoin")).toBeTruthy();
  });

  it('sans compte courant : de simples retraits ; sans épargne : rien à proposer', () => {
    const { dialog } = setup({ accounts: accounts.filter(a => a.id !== 'cc') });
    ask(dialog, '100');
    expect(dialog.textContent).toMatch(/Pas de compte courant : chaque montant sera noté comme un retrait\./);
    cleanup();
    const again = setup({ accounts: [accounts[3]] });
    ask(again.dialog, '100');
    expect(again.dialog.textContent).toMatch(/rien à proposer/);
    expect(again.dialog.textContent).toMatch(/il manque 100\s€/);
  });
});
