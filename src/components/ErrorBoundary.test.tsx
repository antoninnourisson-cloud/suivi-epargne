// @vitest-environment jsdom
// Filets d'erreur : l'écran plein de toute l'app (Recharger, données en sécurité) et celui d'un
// écran ; chaque erreur rattrapée est notée dans le journal de l'appareil.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ErrorBoundary, RootErrorBoundary, lazyWithRetry } from './ErrorBoundary';
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

// Écran chargé à la demande qui n'est pas en cache : hors réseau ce n'est pas une nouvelle version.
describe('lazyWithRetry', () => {
  const setOnline = (on: boolean) => Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => on });
  const Page: React.FC<{ label: string }> = ({ label }) => <p>Écran {label}</p>;
  const show = (Screen: React.ComponentType<{ label: string }>) => render(
    <ErrorBoundary resetKey="a"><React.Suspense fallback={<p>chargement</p>}><Screen label="prêt" /></React.Suspense></ErrorBoundary>,
  );

  beforeEach(() => { localStorage.clear(); sessionStorage.clear(); vi.spyOn(console, 'error').mockImplementation(() => {}); });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); setOnline(true); });

  it('hors réseau : pas de rechargement, message exact, « Réessayer » relance le chargement', async () => {
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });
    setOnline(false);
    const factory = vi.fn<() => Promise<{ default: typeof Page }>>()
      .mockRejectedValueOnce(new TypeError('Failed to fetch dynamically imported module'))
      .mockResolvedValue({ default: Page });
    show(lazyWithRetry(factory));
    expect(await screen.findByText('Cet écran a besoin du réseau la première fois.')).toBeTruthy();
    expect(screen.queryByText(/nouvelle version/)).toBeNull();
    expect(reload).not.toHaveBeenCalled();
    expect(factory).toHaveBeenCalledTimes(1); // pas d'attente ni de second essai inutile
    expect(readErrorJournal()).toEqual([]); // attendu hors réseau : rien à journaliser
    // Le réseau revient : « Réessayer » recharge l'écran, sans recharger la page.
    setOnline(true);
    fireEvent.click(screen.getByRole('button', { name: /Réessayer/ }));
    expect(await screen.findByText('Écran prêt')).toBeTruthy();
    expect(reload).not.toHaveBeenCalled();
  });

  it('hors réseau, « Réessayer » sans réseau : le même message revient', async () => {
    setOnline(false);
    const factory = vi.fn<() => Promise<{ default: typeof Page }>>().mockRejectedValue(new TypeError('Failed to fetch'));
    show(lazyWithRetry(factory));
    await screen.findByText('Cet écran a besoin du réseau la première fois.');
    fireEvent.click(screen.getByRole('button', { name: /Réessayer/ }));
    await waitFor(() => expect(factory).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Cet écran a besoin du réseau la première fois.')).toBeTruthy();
  });

  it('en ligne : un second essai, puis rechargement de la page (nouvelle version)', async () => {
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });
    const factory = vi.fn<() => Promise<{ default: typeof Page }>>().mockRejectedValue(new Error('404'));
    show(lazyWithRetry(factory));
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1), { timeout: 4000 });
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it("en ligne, déjà rechargé il y a moins d'une minute : le message de nouvelle version", async () => {
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });
    sessionStorage.setItem('chunk_reload_at', String(Date.now()));
    const factory = vi.fn<() => Promise<{ default: typeof Page }>>().mockRejectedValue(new Error('404'));
    show(lazyWithRetry(factory));
    expect(await screen.findByText(/Une nouvelle version de Pécule est peut-être disponible/, undefined, { timeout: 4000 })).toBeTruthy();
    expect(reload).not.toHaveBeenCalled();
  });

  it("en ligne : l'écran s'affiche normalement", async () => {
    show(lazyWithRetry(async () => ({ default: Page })));
    expect(await screen.findByText('Écran prêt')).toBeTruthy();
  });
});
