// @vitest-environment jsdom
// Abonnements : après une suppression, le focus va sur l'abonnement voisin, puis sur le champ
// « Nom de l'abonnement » quand la liste est vide (WCAG 2.4.3), jamais sur <body>.
import { describe, it, expect, afterEach } from 'vitest';
import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Subscription } from '../types';
import { Subscriptions } from './Subscriptions';

afterEach(cleanup);

const sub = (id: string, name: string, amount: number): Subscription =>
  ({ id, name, amount, debitAccount: '', frequency: 'monthly', anchorDate: '2026-01-05', active: true });

const Harness: React.FC<{ initial: Subscription[] }> = ({ initial }) => {
  const [list, setList] = useState(initial);
  return <Subscriptions subscriptions={list} onUpdate={setList} />;
};

describe('Abonnements', () => {
  it('suppression : focus sur l’abonnement voisin, puis sur le champ du nom', async () => {
    render(<Harness initial={[sub('a', 'Musique', 10), sub('b', 'Vidéo', 12)]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Supprimer Musique' }));
    expect(screen.queryByText('Musique')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Modifier Vidéo' })));
    fireEvent.click(screen.getByRole('button', { name: 'Supprimer Vidéo' }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Nom de l'abonnement")));
  });
});
