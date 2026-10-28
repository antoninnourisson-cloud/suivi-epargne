// @vitest-environment jsdom
// Barre du bas : l'onglet « Plus » annonce qu'il ouvre une boîte de dialogue, et si elle est
// ouverte (aria-haspopup, aria-expanded).
import { describe, it, expect, vi, afterEach } from 'vitest';
import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { BottomNav } from './BottomNav';
import type { View } from '../navigation';

afterEach(cleanup);

const Harness: React.FC<{ setView: (v: View) => void; onAsk?: () => void }> = ({ setView, onAsk }) => {
  const [moreOpen, setMoreOpen] = useState(false);
  return <BottomNav view="dashboard" setView={setView} moreOpen={moreOpen} setMoreOpen={setMoreOpen} onAsk={onAsk} />;
};

describe('BottomNav', () => {
  it('« Plus » : ouvre la feuille et le dit aux lecteurs d’écran', () => {
    render(<Harness setView={vi.fn()} />);
    const more = screen.getByRole('button', { name: 'Plus' });
    expect(more.getAttribute('aria-haspopup')).toBe('dialog');
    expect(more.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(more);
    expect(screen.getByRole('dialog', { name: "Plus d'écrans" })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Plus', hidden: true }).getAttribute('aria-expanded')).toBe('true');
  });

  it('les onglets ordinaires ne s’annoncent pas comme un menu', () => {
    render(<Harness setView={vi.fn()} />);
    const home = screen.getAllByRole('button').find(b => b.getAttribute('aria-current') === 'page');
    expect(home?.hasAttribute('aria-haspopup')).toBe(false);
    expect(home?.hasAttribute('aria-expanded')).toBe(false);
  });

  it('« Demander à Pécule » en tête du panneau : ferme le panneau et ouvre l’assistant', () => {
    const onAsk = vi.fn();
    render(<Harness setView={vi.fn()} onAsk={onAsk} />);
    fireEvent.click(screen.getByRole('button', { name: 'Plus' }));
    fireEvent.click(screen.getByRole('button', { name: 'Demander à Pécule' }));
    expect(onAsk).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog', { name: "Plus d'écrans" })).toBeNull();
  });
});
