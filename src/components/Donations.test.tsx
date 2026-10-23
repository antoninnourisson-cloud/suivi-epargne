// @vitest-environment jsdom
// Dons et impôts : champs Material 3 reliés à leur libellé, erreurs annoncées, état vide avec
// action, suppression qui garde le focus dans la liste (WCAG 2.4.3), aide à la déclaration.
import { describe, it, expect, vi, afterEach } from 'vitest';
import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Donation } from '../types';

vi.mock('../services/googleDriveService', () => ({ openDrivePicker: vi.fn() }));

import { Donations } from './Donations';
import { focusAfterRemoval, FOCUS_AFTER_REMOVAL } from './focusAfterRemoval';

afterEach(cleanup);

const year = new Date().getFullYear();
const don = (id: string, organization: string, day: string, amount = 100): Donation =>
  ({ id, date: `${year}-${day}`, amount, organization, rate: 66, receiptReceived: true });

const Harness: React.FC<{ initial: Donation[]; taxHelper?: React.ReactNode }> = ({ initial, taxHelper }) => {
  const [list, setList] = useState(initial);
  return <Donations donations={list} onUpdate={setList} taxHelper={taxHelper} />;
};

describe('Dons et impôts', () => {
  it('état vide : une action mène au formulaire, dont les champs sont reliés', () => {
    render(<Harness initial={[]} />);
    expect(screen.getByText(`Aucun don noté pour ${year}`)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Noter un don' }));
    expect(document.activeElement).toBe(screen.getByLabelText('Association'));
    expect(screen.getByLabelText('Montant')).toBeTruthy();
    expect(screen.getByLabelText('Date du don')).toBeTruthy();
    expect(screen.getByLabelText('Note (facultative)')).toBeTruthy();
  });

  it('erreurs annoncées, puis don ajouté à la liste', () => {
    render(<Harness initial={[]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter le don' }));
    expect(screen.getByRole('alert').textContent).toMatch(/Indiquez l'association/);
    fireEvent.change(screen.getByLabelText('Association'), { target: { value: 'Restos du cœur' } });
    fireEvent.change(screen.getByLabelText('Montant'), { target: { value: '50,5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter le don' }));
    expect(screen.getByRole('button', { name: 'Supprimer le don à Restos du cœur' })).toBeTruthy();
  });

  it('suppression : le focus va sur le don voisin, puis sur le formulaire quand la liste est vide', async () => {
    render(<Harness initial={[don('a', 'Alpha', '03-01'), don('b', 'Bravo', '02-01')]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Supprimer le don à Alpha' }));
    await waitFor(() => expect(document.activeElement?.getAttribute('aria-label')).toBe('Modifier le don à Bravo'));
    fireEvent.click(screen.getByRole('button', { name: 'Supprimer le don à Bravo' }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Association')));
  });

  it("l'aide à la déclaration reste affichée et joignable depuis la carte", () => {
    render(<Harness initial={[don('a', 'Alpha', '03-01')]} taxHelper={<section id="tax-return">Aide</section>} />);
    expect(screen.getByText('Aide')).toBeTruthy();
    expect(screen.getByRole('button', { name: "Voir l'aide à la déclaration" })).toBeTruthy();
  });
});

describe('focusAfterRemoval', () => {
  const list = (n: number) => {
    const ul = document.createElement('ul');
    for (let i = 0; i < n; i++) {
      const b = document.createElement('button');
      b.setAttribute(FOCUS_AFTER_REMOVAL, '');
      b.textContent = `b${i}`;
      ul.appendChild(b);
    }
    document.body.appendChild(ul);
    return ul;
  };

  it("vise l'élément à la même place, ou le dernier si on a supprimé le dernier", async () => {
    const ul = list(2);
    focusAfterRemoval(() => ul, 5);
    await waitFor(() => expect(document.activeElement?.textContent).toBe('b1'));
    focusAfterRemoval(() => ul, 0);
    await waitFor(() => expect(document.activeElement?.textContent).toBe('b0'));
    ul.remove();
  });

  it('liste vide ou absente : repli', async () => {
    const fallback = document.createElement('button');
    document.body.appendChild(fallback);
    focusAfterRemoval(() => null, 0, () => fallback);
    await waitFor(() => expect(document.activeElement).toBe(fallback));
    fallback.remove();
  });

  it('repli désactivé ou absent : le titre de l\'écran prend le focus, jamais <body>', async () => {
    const main = document.createElement('main');
    const title = document.createElement('h2');
    title.textContent = 'Écran';
    const disabled = document.createElement('button');
    disabled.disabled = true;
    main.append(title, disabled);
    document.body.appendChild(main);
    focusAfterRemoval(() => null, 0, () => disabled);
    await waitFor(() => expect(document.activeElement).toBe(title));
    expect(title.tabIndex).toBe(-1);
    (document.activeElement as HTMLElement).blur();
    focusAfterRemoval(() => null, 0, () => null);
    await waitFor(() => expect(document.activeElement).toBe(title));
    main.remove();
  });
});
