// @vitest-environment jsdom
// Barre du bas : l'onglet « Plus » annonce qu'il ouvre une boîte de dialogue, et si elle est
// ouverte (aria-haspopup, aria-expanded) ; quatre écrans dans la barre, quatre entrées dans
// « Plus » ; chaque entrée rouvre l'onglet mémorisé de son écran ; l'onglet actif suit l'écran.
import { describe, it, expect, vi, afterEach } from 'vitest';
import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { BottomNav } from './BottomNav';
import type { Place, Screen } from '../navigation';

afterEach(cleanup);

const Harness: React.FC<{ place?: Place; onOpenScreen?: (s: Screen) => void; onAsk?: () => void }> = ({ place = { screen: 'dashboard' }, onOpenScreen = vi.fn(), onAsk }) => {
  const [moreOpen, setMoreOpen] = useState(false);
  return <BottomNav place={place} onOpenScreen={onOpenScreen} moreOpen={moreOpen} setMoreOpen={setMoreOpen} onAsk={onAsk} />;
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

  it('barre : Accueil, Actualiser, Comptes, Pilotage, Plus ; « Plus » : Demander à Pécule et trois écrans', () => {
    render(<Harness onAsk={() => {}} />);
    const bar = screen.getByRole('navigation', { name: 'Navigation principale' });
    expect([...bar.querySelectorAll('button')].map(b => b.textContent)).toEqual(['Accueil', 'Actualiser', 'Comptes', 'Pilotage', 'Plus']);
    fireEvent.click(screen.getByRole('button', { name: 'Plus' }));
    const sheet = screen.getByRole('dialog', { name: "Plus d'écrans" });
    const entries = [...sheet.querySelectorAll('button')].map(b => b.textContent?.trim()).filter(t => t !== '');
    expect(entries).toEqual(['Demander à Pécule', 'Analyses', 'Impôts', 'Paramètres']);
  });

  it('chaque entrée rouvre l’onglet mémorisé de son écran', () => {
    const onOpenScreen = vi.fn();
    render(<Harness onOpenScreen={onOpenScreen} />);
    fireEvent.click(screen.getByRole('button', { name: 'Pilotage' }));
    expect(onOpenScreen).toHaveBeenCalledWith('pilot');
    fireEvent.click(screen.getByRole('button', { name: 'Actualiser' }));
    expect(onOpenScreen).toHaveBeenLastCalledWith('update');
    for (const [name, key] of [['Analyses', 'analyses'], ['Impôts', 'taxes'], ['Paramètres', 'settings']]) {
      fireEvent.click(screen.getByRole('button', { name: 'Plus' }));
      fireEvent.click(screen.getByRole('button', { name }));
      expect(onOpenScreen).toHaveBeenLastCalledWith(key);
      expect(screen.queryByRole('dialog', { name: "Plus d'écrans" })).toBeNull();
    }
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
