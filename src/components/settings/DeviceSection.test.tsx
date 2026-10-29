// @vitest-environment jsdom
// Carte « Appareil » : état du stockage protégé (et nouvelle demande), journal des erreurs
// (copier, effacer).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const persist = vi.hoisted(() => ({ state: 'not-granted' as string, next: 'granted' as string, request: vi.fn() }));
vi.mock('../../services/persistentStorage', () => ({
  getPersistState: async () => persist.state,
  requestPersist: async () => { persist.request(); return persist.next; },
}));

import { DeviceSection } from './DeviceSection';
import { clearErrorJournal, readErrorJournal, recordError } from '../../lib/errorJournal';

describe('DeviceSection', () => {
  beforeEach(() => { localStorage.clear(); persist.state = 'not-granted'; persist.next = 'granted'; persist.request.mockReset(); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('stockage non protégé : explique, puis redemande la protection', async () => {
    render(<DeviceSection />);
    expect(await screen.findByText('Stockage non protégé')).toBeTruthy();
    expect(screen.getByText(/presque plein/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Demander la protection/ }));
    expect(await screen.findByText('Stockage protégé')).toBeTruthy();
    expect(persist.request).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: /Demander la protection/ })).toBeNull();
  });

  it('protégé ou non proposé : pas de bouton', async () => {
    persist.state = 'granted';
    render(<DeviceSection />);
    expect(await screen.findByText(/ne l'effacera pas/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Demander/ })).toBeNull();
    cleanup();
    persist.state = 'unsupported';
    render(<DeviceSection />);
    expect(await screen.findByText('Protection non proposée')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Demander/ })).toBeNull();
  });

  it('journal vide : le dit, sans boutons', async () => {
    render(<DeviceSection />);
    expect(screen.getByText('Aucune erreur notée.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Copier/ })).toBeNull();
    await screen.findByText('Stockage non protégé');
  });

  it('journal : affiche, copie et efface les erreurs notées', async () => {
    recordError('affichage', new Error('Solde 1 200 € introuvable'), '\n at Dashboard (x)');
    recordError('promesse', new Error('réseau'));
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    render(<DeviceSection />);
    await screen.findByText('Stockage non protégé');
    expect(screen.getByText('Error: Solde # € introuvable')).toBeTruthy();
    expect(screen.getByText('Où : Dashboard')).toBeTruthy();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Copier/ })); });
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('Error: réseau'));
    expect(screen.getByRole('status').textContent).toBe('Journal copié.');
    fireEvent.click(screen.getByRole('button', { name: /Effacer/ }));
    expect(screen.getByText('Aucune erreur notée.')).toBeTruthy();
    expect(readErrorJournal()).toEqual([]);
  });

  it('copie refusée : le dit', async () => {
    recordError('script', new Error('x'));
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: async () => { throw new Error('refus'); } } });
    render(<DeviceSection />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Copier/ })); });
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Copie impossible sur ce navigateur.'));
    clearErrorJournal();
  });
});
