// @vitest-environment jsdom
// Barre du bas : l'onglet « Plus » annonce qu'il ouvre une boîte de dialogue, et si elle est
// ouverte (aria-haspopup, aria-expanded) ; les entrées passent par le modèle de navigation
// (écran → onglet mémorisé, ancienne entrée → son onglet) ; l'onglet actif suit l'écran.
import { describe, it, expect, vi, afterEach } from 'vitest';
import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { BottomNav } from './BottomNav';
import type { Place, Screen, View } from '../navigation';

afterEach(cleanup);

const Harness: React.FC<{ place?: Place; onNavigate?: (v: View) => void; onOpenScreen?: (s: Screen) => void; onAsk?: () => void }> = ({ place = { screen: 'dashboard' }, onNavigate = vi.fn(), onOpenScreen = vi.fn(), onAsk }) => {
  const [moreOpen, setMoreOpen] = useState(false);
  return <BottomNav place={place} onNavigate={onNavigate} onOpenScreen={onOpenScreen} moreOpen={moreOpen} setMoreOpen={setMoreOpen} onAsk={onAsk} />;
};

const current = () => screen.getAllByRole('button').filter(b => b.getAttribute('aria-current') === 'page').map(b => b.textContent);

describe('BottomNav', () => {
  it('« Plus » : ouvre la feuille et le dit aux lecteurs d’écran', () => {
    render(<Harness />);
    const more = screen.getByRole('button', { name: 'Plus' });
    expect(more.getAttribute('aria-haspopup')).toBe('dialog');
    expect(more.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(more);
    expect(screen.getByRole('dialog', { name: "Plus d'écrans" })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Plus', hidden: true }).getAttribute('aria-expanded')).toBe('true');
  });

  it('les onglets ordinaires ne s’annoncent pas comme un menu', () => {
    render(<Harness />);
    const home = screen.getAllByRole('button').find(b => b.getAttribute('aria-current') === 'page');
    expect(home?.hasAttribute('aria-haspopup')).toBe(false);
    expect(home?.hasAttribute('aria-expanded')).toBe(false);
  });

  it('« Demander à Pécule » en tête du panneau : ferme le panneau et ouvre l’assistant', () => {
    const onAsk = vi.fn();
    render(<Harness onAsk={onAsk} />);
    fireEvent.click(screen.getByRole('button', { name: 'Plus' }));
    fireEvent.click(screen.getByRole('button', { name: 'Demander à Pécule' }));
    expect(onAsk).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog', { name: "Plus d'écrans" })).toBeNull();
  });

  it('un écran de la barre rouvre son onglet mémorisé ; une ancienne entrée ouvre son onglet', () => {
    const onNavigate = vi.fn();
    const onOpenScreen = vi.fn();
    render(<Harness onNavigate={onNavigate} onOpenScreen={onOpenScreen} />);
    fireEvent.click(screen.getByRole('button', { name: 'Pilotage' }));
    expect(onOpenScreen).toHaveBeenCalledWith('pilot');
    fireEvent.click(screen.getByRole('button', { name: 'Plus' }));
    fireEvent.click(screen.getByRole('button', { name: 'Abonnements' }));
    expect(onNavigate).toHaveBeenCalledWith('subscriptions');
    fireEvent.click(screen.getByRole('button', { name: 'Plus' }));
    fireEvent.click(screen.getByRole('button', { name: 'Paramètres' }));
    expect(onOpenScreen).toHaveBeenLastCalledWith('settings');
  });

  it('onglet actif : l’écran de la barre pour tous ses onglets, « Plus » pour Analyses, Impôts et Paramètres', () => {
    const { rerender } = render(<Harness place={{ screen: 'pilot', tab: 'subscriptions' }} />);
    expect(current()).toEqual(['Pilotage']);
    rerender(<Harness place={{ screen: 'accounts', tab: 'movements' }} />);
    expect(current()).toEqual(['Comptes']);
    for (const place of [{ screen: 'analyses', tab: 'agenda' }, { screen: 'taxes', tab: 'calendar' }, { screen: 'settings' }] as Place[]) {
      rerender(<Harness place={place} />);
      expect(current()).toEqual([]);
      const pill = screen.getByRole('button', { name: 'Plus' }).querySelector('span');
      expect(pill?.className).toMatch(/bg-secondary-container/);
    }
  });
});
