// @vitest-environment jsdom
// Restitution enregistrée : « Annuler la restitution » passe toujours par une confirmation
// qui dit ce qui va se passer (capital remis, relevé effacé).
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { RestitutionPanel } from './RestitutionPanel';
import type { ParentalRestitution } from '../types';

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
