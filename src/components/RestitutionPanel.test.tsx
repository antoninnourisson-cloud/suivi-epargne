// @vitest-environment jsdom
// Restitution du capital des parents : champs Material 3 reliés à leur libellé, planification,
// enregistrement en deux temps (date du retrait réel), relevé exportable ; « Annuler la
// restitution » passe toujours par une confirmation qui dit ce qui va se passer (capital
// remis, relevé effacé), avec le focus sur « Garder la restitution ».
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { RestitutionPanel } from './RestitutionPanel';
import { AccountType, type ParentalRestitution, type SavingsAccount } from '../types';

vi.mock('../services/fileDownload', () => ({ downloadCsv: vi.fn() }));
import { downloadCsv } from '../services/fileDownload';

afterEach(cleanup);

const restitution: ParentalRestitution = {
  plannedDate: '2027-01-01',
  done: {
    date: '2027-01-01',
    accounts: [
      { accountId: 'la', name: 'Livret A', amount: 7000 },
      { accountId: 'lep', name: 'LEP', amount: 2500 },
    ],
    interestsOffered: [{ year: 2026, amount: 210 }],
  },
};

const renderDone = () => {
  const onUndo = vi.fn();
  render(<RestitutionPanel accounts={[]} restitution={restitution} onPlan={vi.fn()} onRestitute={vi.fn()} onUndo={onUndo} />);
  return { onUndo, open: () => fireEvent.click(screen.getByRole('button', { name: 'Annuler la restitution' })) };
};

describe('RestitutionPanel : annulation de la restitution', () => {
  it("ne fait rien sans confirmation, et la boîte dit ce qui va changer", () => {
    const { onUndo, open } = renderDone();
    open();
    expect(onUndo).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog', { name: 'Annuler la restitution ?' });
    expect(dialog.textContent).toMatch(/9\s500\s€ de capital de vos parents seront remis sur 2 comptes, et le relevé du 1er janvier 2027 sera effacé\. Votre part ne change pas\./);
    // Action dangereuse : le focus part sur le bouton qui ne change rien.
    expect(document.activeElement?.textContent).toBe('Garder la restitution');
  });

  it('« Garder la restitution » ferme sans rien changer', () => {
    const { onUndo, open } = renderDone();
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Garder la restitution' }));
    expect(onUndo).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('un seul compte concerné : la boîte le nomme', () => {
    const one: ParentalRestitution = {
      done: {
        date: '2027-01-01',
        accounts: [{ accountId: 'la', name: 'Livret A', amount: 7000 }, { accountId: 'pea', name: 'PEA', amount: 0 }],
        interestsOffered: [],
      },
    };
    render(<RestitutionPanel accounts={[]} restitution={one} onPlan={vi.fn()} onRestitute={vi.fn()} onUndo={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Annuler la restitution' }));
    const dialog = screen.getByRole('dialog', { name: 'Annuler la restitution ?' });
    expect(dialog.textContent).toMatch(/7\s000\s€ de capital de vos parents seront remis sur le compte « Livret A », et le relevé/);
  });

  it('« Remettre leur capital » annule la restitution', () => {
    const { onUndo, open } = renderDone();
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Remettre leur capital' }));
    expect(onUndo).toHaveBeenCalledTimes(1);
  });
});

const account = (id: string, name: string, owned: number, parental: number): SavingsAccount => ({
  id, name, type: AccountType.LIVRET_A, institution: 'Banque', ownedAmount: owned, parentalCapital: parental, totalAmount: owned + parental, interestRate: 1.7,
});

const setup = (accounts: SavingsAccount[], restitution?: ParentalRestitution) => {
  const handlers = { onPlan: vi.fn(), onRestitute: vi.fn(), onUndo: vi.fn() };
  render(<RestitutionPanel accounts={accounts} restitution={restitution} monthPlan={773} {...handlers} />);
  return handlers;
};

describe('Restitution du capital', () => {
  it('rien à rendre : le panneau ne s’affiche pas', () => {
    setup([account('a', 'Livret A', 5000, 0)]);
    expect(screen.queryByRole('heading', { name: 'Restitution du capital' })).toBeNull();
  });

  it('plan : date reliée à son libellé, capital à rendre compte par compte, planification', () => {
    const { onPlan } = setup([account('a', 'Livret A', 3000, 7000), account('b', 'LEP', 1000, 2500)]);
    expect(screen.getByRole('heading', { name: 'Restitution du capital' })).toBeTruthy();
    const date = screen.getByLabelText('Date de retrait prévue') as HTMLInputElement;
    expect(date.type).toBe('date');
    const table = screen.getByRole('table', { name: 'Capital à rendre à vos parents, compte par compte' });
    expect(within(table).getByText('Livret A')).toBeTruthy();
    expect(table.textContent).toMatch(/9\s500\s€/);
    fireEvent.click(screen.getByRole('button', { name: 'Planifier (rappels)' }));
    expect(onPlan).toHaveBeenCalledWith(date.value);
  });

  it('une date de retrait avant le 1er janvier est signalée, la date conseillée est proposée', () => {
    setup([account('a', 'Livret A', 3000, 7000)]);
    fireEvent.change(screen.getByLabelText('Date de retrait prévue'), { target: { value: `${new Date().getFullYear() + 1}-06-20` } });
    expect(screen.getByText(/d'intérêts \d{4} sont perdus/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Utiliser la date conseillée/ })).toBeTruthy();
  });

  it('enregistrement : deux temps, avec la date du retrait réel', () => {
    const { onRestitute } = setup([account('a', 'Livret A', 3000, 7000)]);
    fireEvent.click(screen.getByRole('button', { name: "J'ai rendu l'argent : enregistrer la restitution" }));
    const real = screen.getByLabelText('Date du retrait réel') as HTMLInputElement;
    fireEvent.change(real, { target: { value: '2027-01-02' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer la restitution' }));
    expect(onRestitute).toHaveBeenCalledWith('2027-01-02');
  });

  it('« Annuler » referme la confirmation sans rien enregistrer', () => {
    const { onRestitute } = setup([account('a', 'Livret A', 3000, 7000)]);
    fireEvent.click(screen.getByRole('button', { name: "J'ai rendu l'argent : enregistrer la restitution" }));
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(screen.queryByLabelText('Date du retrait réel')).toBeNull();
    expect(onRestitute).not.toHaveBeenCalled();
  });

  const done: ParentalRestitution = {
    done: { date: '2027-01-01', accounts: [{ accountId: 'a', name: 'Livret A', amount: 7000 }], interestsOffered: [{ year: 2026, amount: 119 }] },
  };

  it('relevé : montants rendus, export CSV, aucune ancienne palette', () => {
    setup([account('a', 'Livret A', 3000, 0)], done);
    expect(screen.getByRole('heading', { name: /^Restitution effectuée le 1er janvier 2027/ })).toBeTruthy();
    expect(screen.getByText(/7\s000\s€ rendus à vos parents/)).toBeTruthy();
    expect(screen.getByText(/2026 : 119\s€/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Exporter le relevé (CSV)' }));
    expect(downloadCsv).toHaveBeenCalledWith('restitution-parents-2027-01-01.csv', expect.any(Array));
    expect(document.body.innerHTML).not.toMatch(/(amber|slate|indigo|emerald|rose)-\d/);
  });

  it('annulation : confirmée, focus sur « Garder la restitution », bouton au rôle error', () => {
    const { onUndo } = setup([account('a', 'Livret A', 3000, 0)], done);
    fireEvent.click(screen.getByRole('button', { name: 'Annuler la restitution' }));
    const dialog = screen.getByRole('dialog', { name: 'Annuler la restitution ?' });
    expect(document.activeElement?.textContent).toBe('Garder la restitution');
    const destroy = within(dialog).getByRole('button', { name: 'Remettre leur capital' });
    expect(destroy.className).toContain('bg-error');
    expect(onUndo).not.toHaveBeenCalled();
    fireEvent.click(destroy);
    expect(onUndo).toHaveBeenCalled();
  });
});
