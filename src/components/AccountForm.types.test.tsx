// @vitest-environment jsdom
// Fiche d'un compte : nouveaux types (livret bancaire, compte à terme, épargne logement,
// compte-titres, « Autre » bloqué), rendement supposé des placements (jamais un 0 % implicite).
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { AccountForm } from './AccountForm';
import { DEFAULT_FISCAL_CONFIG } from '../constants';
import { AccountType, type SavingsAccount } from '../types';
import { findAvRateUpdatesDue } from '../lib/finance';

afterEach(cleanup);

const setup = (initialData?: SavingsAccount) => {
  const onSave = vi.fn();
  render(<AccountForm onSave={onSave} initialData={initialData} fiscalConfig={DEFAULT_FISCAL_CONFIG} />);
  const type = (t: AccountType) => fireEvent.change(screen.getByLabelText('Type'), { target: { value: t } });
  fireEvent.change(screen.getByLabelText(/^Banque/), { target: { value: 'Banque' } });
  return {
    type,
    save: () => fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' })),
    saved: (): SavingsAccount => onSave.mock.calls[0][0],
    onSave,
  };
};

describe('AccountForm : catalogue des comptes', () => {
  it('la liste propose les nouveaux types, avec leur règle fiscale', () => {
    const f = setup();
    const options = Array.from((screen.getByLabelText('Type') as HTMLSelectElement).options).map(o => o.textContent);
    expect(options).toEqual(expect.arrayContaining(['Livret bancaire (imposé)', 'PEL (plan épargne logement)', 'CEL (compte épargne logement)', 'Compte à terme', 'Compte-titres (CTO)']));
    f.type(AccountType.LIVRET_BANCAIRE);
    expect(screen.getByText(/Intérêts imposés chaque année : 12,8\s%/)).toBeTruthy();
  });

  it('CEL : plafond de 15 300 € proposé ; PEL ancien : sans impôt sur le revenu', () => {
    const f = setup();
    f.type(AccountType.CEL);
    expect((screen.getByLabelText('Plafond') as HTMLInputElement).value).toMatch(/15\s?300/);
    f.type(AccountType.PEL);
    fireEvent.change(screen.getByLabelText("Date d'ouverture"), { target: { value: '2016-04-01' } });
    expect(screen.getByText(/Ouvert avant 2018 : intérêts sans impôt sur le revenu pendant 12 ans/)).toBeTruthy();
    f.save();
    expect(f.saved()).toMatchObject({ type: AccountType.PEL, ceiling: 61200, openingDate: '2016-04-01' });
  });

  it("compte à terme : l'échéance est enregistrée", () => {
    const f = setup();
    f.type(AccountType.COMPTE_A_TERME);
    fireEvent.change(screen.getByLabelText('Échéance'), { target: { value: '2027-06-30' } });
    f.save();
    expect(f.saved()).toMatchObject({ type: AccountType.COMPTE_A_TERME, contractEndDate: '2027-06-30' });
  });

  it('« Autre » : disponible par défaut, « Argent bloqué » enregistré si coché', () => {
    const f = setup();
    f.type(AccountType.AUTRE);
    f.save();
    expect(f.saved().blocked).toBeUndefined();
    cleanup();
    const g = setup();
    g.type(AccountType.AUTRE);
    fireEvent.click(screen.getByRole('checkbox', { name: /Argent bloqué/ }));
    g.save();
    expect(g.saved().blocked).toBe(true);
  });
});

describe('AccountForm : rendement supposé des placements', () => {
  it('placement sans hypothèse : aucun taux enregistré (pas de 0 % implicite) ; livret vide : 0 %', () => {
    const f = setup();
    f.type(AccountType.CTO);
    expect(screen.getByLabelText('Rendement annuel supposé')).toBeTruthy();
    f.save();
    expect(f.saved().interestRate).toBeUndefined();
    expect(f.saved().isTaxable).toBe(true);
    cleanup();
    const g = setup();
    g.type(AccountType.LIVRET_BANCAIRE);
    g.save();
    expect(g.saved().interestRate).toBe(0);
  });

  it("un ancien 0 % de placement s'affiche vide ; la performance observée est rappelée", () => {
    const pea: SavingsAccount = {
      id: 'p', name: 'PEA', type: AccountType.PEA, institution: 'B', totalAmount: 1100, ownedAmount: 1100, parentalCapital: 0, interestRate: 0,
      movements: [
        { id: 'i', date: '2024-01-01', amount: 1000, label: 'Solde initial', type: 'IN', tag: 'initial' },
        { id: 'v', date: '2025-01-01', amount: 100, label: 'Valorisation (+)', type: 'IN', kind: 'valuation' },
      ],
    };
    setup(pea);
    expect((screen.getByLabelText('Rendement annuel supposé') as HTMLInputElement).value).toBe('');
    expect(screen.getByText(/Performance observée : .* par an depuis le 01\/01\/2024/)).toBeTruthy();
  });

  it('taux illisible : refusé, avec un message', () => {
    const f = setup();
    fireEvent.change(screen.getByLabelText('Taux actuel'), { target: { value: 'abc' } });
    expect(screen.getByRole('alert').textContent).toMatch(/Taux non reconnu/);
    f.save();
    expect(f.onSave).not.toHaveBeenCalled();
  });
});

describe('AccountForm : taux servi d’une assurance vie (fonds euros)', () => {
  const av: SavingsAccount = {
    id: 'av', name: 'Assurance vie', type: AccountType.ASSURANCE_VIE, institution: 'B', totalAmount: 10000, ownedAmount: 10000, parentalCapital: 0,
    interestRate: 2.5, openingDate: '2020-03-01', movements: [],
  };

  it("un nouveau taux est daté et historisé : le rappel « Taux servi » de janvier s'éteint", () => {
    const f = setup(av);
    const rate = screen.getByLabelText('Taux servi (fonds euros)') as HTMLInputElement;
    expect(rate.value).toBe('2,5');
    fireEvent.change(rate, { target: { value: '2,8' } });
    fireEvent.change(screen.getByLabelText('Nouveau taux à partir du'), { target: { value: '2027-01-01' } });
    f.save();
    const saved = f.saved();
    expect(saved.interestRate).toBe(2.8);
    expect(saved.rateHistory).toEqual([{ date: '2027-01-01', rate: 2.5 }]);
    expect(findAvRateUpdatesDue([saved], new Date(2027, 0, 20))).toEqual([]);
    expect(findAvRateUpdatesDue([av], new Date(2027, 0, 20)).map(a => a.id)).toEqual(['av']);
  });

  it("un ancien 0 % (« pas de taux ») n'est pas historisé ; un PEA n'a jamais d'historique", () => {
    const f = setup({ ...av, interestRate: 0 });
    expect((screen.getByLabelText('Taux servi (fonds euros)') as HTMLInputElement).value).toBe('');
    fireEvent.change(screen.getByLabelText('Taux servi (fonds euros)'), { target: { value: '2,8' } });
    expect(screen.queryByLabelText('Nouveau taux à partir du')).toBeNull();
    f.save();
    expect(f.saved().rateHistory).toBeUndefined();
    cleanup();
    const g = setup({ ...av, id: 'pea', type: AccountType.PEA, interestRate: 6 });
    fireEvent.change(screen.getByLabelText('Rendement annuel supposé'), { target: { value: '5' } });
    expect(screen.queryByLabelText('Nouveau taux à partir du')).toBeNull();
    g.save();
    expect(g.saved().interestRate).toBe(5);
    expect(g.saved().rateHistory).toBeUndefined();
  });
});
