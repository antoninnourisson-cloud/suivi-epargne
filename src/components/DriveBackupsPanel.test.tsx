// @vitest-environment jsdom
// Copies mensuelles Drive (Paramètres) : la ligne d'échec n'apparaît qu'après plus de 45 jours
// sans copie réussie, et « Réessayer maintenant » refait la copie tout de suite.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, configure } from '@testing-library/react';

configure({ asyncUtilTimeout: 5000 });

const drive = vi.hoisted(() => ({ fail: false, calls: 0 }));
vi.mock('../services/googleDriveService', () => ({
  writeMonthlyBackup: vi.fn(async () => {
    drive.calls += 1;
    if (drive.fail) throw new Error('réseau');
    return true;
  }),
}));

import { DriveBackupsPanel } from './SettingsPanels';
import { ToastContext } from './Toast';
import { emptyData } from '../lib/schema';
import { resetMonthlyBackup } from '../hooks/portfolio/monthlyBackup';

const STATE_KEY = 'monthly_backup_state';
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

const setup = (withData = true) => {
  const toast = vi.fn();
  const list = vi.fn(async () => []);
  render(
    <ToastContext.Provider value={toast}>
      <DriveBackupsPanel list={list} restore={vi.fn()} confirm={vi.fn()} getData={withData ? () => emptyData() : undefined} />
    </ToastContext.Provider>,
  );
  return { toast, list };
};

describe('DriveBackupsPanel : copie mensuelle en échec', () => {
  beforeEach(() => { localStorage.clear(); resetMonthlyBackup(); drive.fail = false; drive.calls = 0; vi.spyOn(console, 'warn').mockImplementation(() => {}); });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('aucun problème noté : pas de ligne d\'échec', async () => {
    setup();
    await screen.findByText(/Pas encore de copie/);
    expect(screen.queryByText(/n'a pas pu être faite/)).toBeNull();
  });

  it('échec depuis moins de 45 jours : rien à signaler', async () => {
    localStorage.setItem(STATE_KEY, JSON.stringify({ lastOkAt: daysAgo(30).toISOString(), firstFailAt: daysAgo(3).toISOString() }));
    setup();
    await screen.findByText(/Pas encore de copie/);
    expect(screen.queryByText(/n'a pas pu être faite/)).toBeNull();
  });

  it('plus de 45 jours : la ligne claire avec la date, et le bouton', async () => {
    const last = daysAgo(60);
    localStorage.setItem(STATE_KEY, JSON.stringify({ lastOkAt: last.toISOString(), firstFailAt: daysAgo(20).toISOString() }));
    setup();
    const line = await screen.findByText(/n'a pas pu être faite depuis le/);
    expect(line.textContent).toMatch(/^La copie mensuelle sur Drive n'a pas pu être faite depuis le \d+(er)? \p{L}+( \d{4})?\. Pécule réessaie chaque jour\.$/u);
    expect(screen.getByRole('button', { name: /Réessayer maintenant/ })).toBeTruthy();
  });

  it('« Réessayer maintenant » : copie refaite tout de suite, la ligne disparaît', async () => {
    localStorage.setItem(STATE_KEY, JSON.stringify({ lastOkAt: daysAgo(60).toISOString(), firstFailAt: daysAgo(20).toISOString(), lastTryDay: '2099-01-01' }));
    const { toast, list } = setup();
    await screen.findByText(/n'a pas pu être faite depuis/);
    fireEvent.click(screen.getByRole('button', { name: /Réessayer maintenant/ }));
    await waitFor(() => expect(screen.queryByText(/n'a pas pu être faite depuis/)).toBeNull());
    expect(drive.calls).toBe(1); // malgré l'essai déjà fait aujourd'hui
    expect(toast).toHaveBeenCalledWith({ message: 'Copie mensuelle créée sur Drive', kind: 'success' });
    expect(list.mock.calls.length).toBeGreaterThanOrEqual(2); // la liste est relue
  });

  it('« Réessayer maintenant » qui échoue encore : la ligne reste, un message le dit', async () => {
    drive.fail = true;
    localStorage.setItem(STATE_KEY, JSON.stringify({ lastOkAt: daysAgo(60).toISOString(), firstFailAt: daysAgo(20).toISOString() }));
    const { toast } = setup();
    await screen.findByText(/n'a pas pu être faite depuis/);
    fireEvent.click(screen.getByRole('button', { name: /Réessayer maintenant/ }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'error' })));
    expect(screen.getByText(/n'a pas pu être faite depuis/)).toBeTruthy();
  });

  it('sans données à copier : la ligne s\'affiche, sans bouton', async () => {
    localStorage.setItem(STATE_KEY, JSON.stringify({ lastOkAt: daysAgo(60).toISOString(), firstFailAt: daysAgo(20).toISOString() }));
    setup(false);
    await screen.findByText(/n'a pas pu être faite depuis/);
    expect(screen.queryByRole('button', { name: /Réessayer maintenant/ })).toBeNull();
  });
});
