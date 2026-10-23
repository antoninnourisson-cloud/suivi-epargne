// @vitest-environment jsdom
// Suppression annulable : le toast « Annuler » dure 10 s à la souris ou au doigt, 30 s au
// clavier (le bouton est à plusieurs tabulations), et « Annuler » remet l'élément à sa place.
import { describe, it, expect, vi, afterEach } from 'vitest';
import React, { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ToastContext, useUndoableRemove, UNDO_TOAST_KEYBOARD_MS, UNDO_TOAST_MS, type ToastItem } from './Toast';

afterEach(cleanup);

type Item = { id: string; name: string };

const List: React.FC = () => {
  const [items, setItems] = useState<Item[]>([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }]);
  const removeWithUndo = useUndoableRemove();
  return (
    <ul>
      {items.map(i => (
        <li key={i.id}>{i.name}<button onClick={() => removeWithUndo(items, i, setItems, `${i.name} supprimé`)}>Supprimer {i.name}</button></li>
      ))}
    </ul>
  );
};

const setup = () => {
  const toasts: Omit<ToastItem, 'id'>[] = [];
  const addToast = vi.fn((t: Omit<ToastItem, 'id'>) => { toasts.push(t); return String(toasts.length); });
  render(<ToastContext.Provider value={addToast}><List /></ToastContext.Provider>);
  return toasts;
};

describe('useUndoableRemove', () => {
  it('à la souris : 10 s, et « Annuler » remet l’élément à sa place', () => {
    const toasts = setup();
    fireEvent.pointerDown(window);
    fireEvent.click(screen.getByRole('button', { name: 'Supprimer B' }));
    expect(screen.queryByText('B')).toBeNull();
    expect(toasts[0]).toMatchObject({ message: 'B supprimé', durationMs: UNDO_TOAST_MS, action: { label: 'Annuler' } });
    act(() => toasts[0].action!.onClick());
    expect(screen.getAllByRole('listitem').map(li => li.textContent?.charAt(0))).toEqual(['A', 'B', 'C']);
  });

  it('au clavier : 30 s pour avoir le temps d’atteindre « Annuler »', () => {
    const toasts = setup();
    fireEvent.keyDown(window, { key: 'Enter' });
    fireEvent.click(screen.getByRole('button', { name: 'Supprimer A' }));
    expect(toasts[0].durationMs).toBe(UNDO_TOAST_KEYBOARD_MS);
    expect(UNDO_TOAST_KEYBOARD_MS).toBeGreaterThan(UNDO_TOAST_MS);
    // Retour à la souris : durée normale.
    fireEvent.pointerDown(window);
    fireEvent.click(screen.getByRole('button', { name: 'Supprimer C' }));
    expect(toasts[1].durationMs).toBe(UNDO_TOAST_MS);
  });
});
