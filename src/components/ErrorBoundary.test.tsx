// @vitest-environment jsdom
// Filets d'erreur : l'écran plein de toute l'app (Recharger, données en sécurité) et celui d'un
// écran ; chaque erreur rattrapée est notée dans le journal de l'appareil.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ErrorBoundary, RootErrorBoundary } from './ErrorBoundary';
import { readErrorJournal } from '../lib/errorJournal';

const Boom: React.FC<{ msg?: string }> = ({ msg = 'Compte "Livret de Léa" : 1500' }) => { throw new Error(msg); };

describe('ErrorBoundary', () => {
  beforeEach(() => { localStorage.clear(); vi.spyOn(console, 'error').mockImplementation(() => {}); });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('racine : écran plein avec « Recharger » et l\'état exact des données', () => {
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });
    render(<RootErrorBoundary><Boom /></RootErrorBoundary>);
    expect(screen.getByRole('heading', { name: 'Pécule a rencontré un problème' })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toMatch(/sur votre Google Drive/);
    expect(screen.getByRole('alert').textContent).toMatch(/proposera après le rechargement/);
    fireEvent.click(screen.getByRole('button', { name: /Recharger/ }));
    expect(reload).toHaveBeenCalled();
  });

  it('note l\'erreur sans données personnelles, avec les composants en cause', () => {
    render(<RootErrorBoundary><Boom /></RootErrorBoundary>);
    const [entry] = readErrorJournal();
    expect(entry.source).toBe('affichage');
    expect(entry.message).toBe('Error: Compte "…" : #');
    expect(entry.where).toMatch(/^Boom/);
  });

  it('sans erreur : affiche les enfants', () => {
    render(<RootErrorBoundary><p>ok</p></RootErrorBoundary>);
    expect(screen.getByText('ok')).toBeTruthy();
    expect(readErrorJournal()).toEqual([]);
  });

  it('écran : message local, effacé au changement d\'écran, erreur notée aussi', () => {
    const { rerender } = render(<ErrorBoundary resetKey="a"><Boom msg="x" /></ErrorBoundary>);
    expect(screen.getByText("Cet écran n'a pas pu s'afficher")).toBeTruthy();
    expect(readErrorJournal()).toHaveLength(1);
    rerender(<ErrorBoundary resetKey="b"><p>autre écran</p></ErrorBoundary>);
    expect(screen.getByText('autre écran')).toBeTruthy();
  });
});
