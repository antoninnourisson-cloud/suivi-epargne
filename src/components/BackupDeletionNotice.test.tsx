// @vitest-environment jsdom
// Effacement des copies de secours programmé : visible en haut de l'app à chaque ouverture,
// même sans notification, et annulable sur place.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';

const state = vi.hoisted(() => ({ enabled: true, session: true }));
vi.mock('../services/backendService', () => ({
  isBackendEnabled: () => state.enabled,
  hasBackendSession: () => state.session,
}));
const cloud = vi.hoisted(() => ({
  getServerDeletion: vi.fn(async (): Promise<{ requestedAt: string; purgeAt: string } | null> => null),
  cancelServerDeletion: vi.fn(async () => true),
}));
vi.mock('../services/cloudBackup', () => cloud);
const sections = vi.hoisted(() => ({ openSettingsSection: vi.fn() }));
vi.mock('./settings/sections', () => sections);

import { BackupDeletionNotice } from './BackupDeletionNotice';
import { ToastContext } from './Toast';

const deletion = { requestedAt: '2026-10-20T10:00:00.000Z', purgeAt: '2026-10-27T10:00:00.000Z' };

const setup = (active = true) => {
  const toast = vi.fn();
  const onOpenSettings = vi.fn();
  const view = render(<ToastContext.Provider value={toast}><BackupDeletionNotice active={active} onOpenSettings={onOpenSettings} /></ToastContext.Provider>);
  const rerender = (a: boolean) => view.rerender(<ToastContext.Provider value={toast}><BackupDeletionNotice active={a} onOpenSettings={onOpenSettings} /></ToastContext.Provider>);
  return { toast, onOpenSettings, rerender };
};

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(state, { enabled: true, session: true });
  cloud.getServerDeletion.mockResolvedValue(deletion);
  cloud.cancelServerDeletion.mockResolvedValue(true);
});
afterEach(cleanup);

describe('BackupDeletionNotice', () => {
  it('rien avant que les données soient affichées ; ensuite l’effacement programmé est annoncé', async () => {
    const { rerender } = setup(false);
    expect(cloud.getServerDeletion).not.toHaveBeenCalled();
    rerender(true);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/Vos copies de secours seront effacées le 27 octobre/);
    expect(alert.textContent).toMatch(/Ce n'est pas vous/);
    // Une seule lecture par ouverture.
    rerender(false);
    rerender(true);
    expect(cloud.getServerDeletion).toHaveBeenCalledTimes(1);
  });

  it('« Annuler l’effacement » : annulé sur le serveur, le bandeau disparaît', async () => {
    const { toast } = setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Annuler l\'effacement' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(cloud.cancelServerDeletion).toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'success' }));
  });

  it('serveur injoignable à l’annulation : message, le bandeau reste', async () => {
    cloud.cancelServerDeletion.mockRejectedValue(new TypeError('Failed to fetch'));
    setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Annuler l\'effacement' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/n'est pas annulé/));
  });

  it('« Voir dans Paramètres » ouvre la carte Données', async () => {
    const { onOpenSettings } = setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Voir dans Paramètres' }));
    expect(sections.openSettingsSection).toHaveBeenCalledWith('data');
    expect(onOpenSettings).toHaveBeenCalled();
  });

  it('aucun effacement, pas de serveur ou pas de session : rien n’est affiché', async () => {
    cloud.getServerDeletion.mockResolvedValue(null);
    setup();
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByRole('alert')).toBeNull();
    cleanup();
    state.session = false;
    setup();
    state.enabled = false;
    setup();
    expect(cloud.getServerDeletion).toHaveBeenCalledTimes(1);
  });

  it('hors ligne : nouvel essai à la prochaine activation', async () => {
    cloud.getServerDeletion.mockRejectedValueOnce(new TypeError('offline'));
    const { rerender } = setup();
    await waitFor(() => expect(cloud.getServerDeletion).toHaveBeenCalledTimes(1));
    rerender(false);
    rerender(true);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(cloud.getServerDeletion).toHaveBeenCalledTimes(2);
  });
});
