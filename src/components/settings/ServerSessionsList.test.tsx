// @vitest-environment jsdom
// « Appareils connectés » : liste des sessions du serveur et « Déconnecter cet appareil ».
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';

const backend = vi.hoisted(() => ({
  listServerSessions: vi.fn(),
  revokeServerSession: vi.fn(async (_id: string) => undefined),
}));
vi.mock('../../services/backendService', () => backend);

import { ServerSessionsList } from './ServerSessionsList';
import { ToastContext } from '../Toast';

const sessions = [
  { id: 'moi', device: 'téléphone Android (Chrome)', createdAt: '2026-10-01T08:00:00.000Z', lastUsedAt: '2026-10-20T08:00:00.000Z', bound: true, current: true },
  { id: 'inconnu', device: null, createdAt: null, lastUsedAt: '2026-10-19T08:00:00.000Z', bound: false, current: false },
  { id: 'ancienne', device: 'iPhone (Safari)', createdAt: '2026-09-01T08:00:00.000Z', lastUsedAt: '2026-10-01T08:00:00.000Z', bound: false, legacy: true, current: false },
];

const setup = () => {
  const confirm = vi.fn((_t: string, _m: string, ok: () => void | Promise<void>) => { void ok(); });
  const onSignedOut = vi.fn();
  const toast = vi.fn();
  render(<ToastContext.Provider value={toast}><ServerSessionsList confirm={confirm} onSignedOut={onSignedOut} /></ToastContext.Provider>);
  return { confirm, onSignedOut, toast };
};

beforeEach(() => {
  vi.clearAllMocks();
  backend.listServerSessions.mockResolvedValue(sessions);
});
afterEach(cleanup);

describe('Appareils connectés', () => {
  it('liste les appareils, signale celui-ci, et déconnecte un appareil inconnu', async () => {
    const { confirm, onSignedOut, toast } = setup();
    const list = await screen.findByRole('list', { name: 'Appareils connectés' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0].textContent).toMatch(/téléphone Android \(Chrome\)\(cet appareil\)/);
    expect(items[0].textContent).toMatch(/Connecté le 1 octobre 2026/);
    expect(items[1].textContent).toMatch(/Appareil inconnu/);
    // Session sans clé d'appareil : signalée ; ouverte avant la protection : plus acceptée.
    expect(items[0].textContent).not.toMatch(/Ancienne connexion|moins protégée/);
    expect(items[1].textContent).toMatch(/Connexion moins protégée/);
    expect(items[2].textContent).toMatch(/Ancienne connexion, plus acceptée/);
    expect(items[2].textContent).not.toMatch(/moins protégée/);

    backend.listServerSessions.mockResolvedValue([sessions[0]]);
    fireEvent.click(screen.getByRole('button', { name: "Déconnecter l'appareil inconnu" }));
    expect(confirm.mock.calls[0][0]).toBe('Déconnecter « appareil inconnu » ?');
    expect(confirm.mock.calls[0][1]).toMatch(/mot de passe de votre compte Google/);
    await waitFor(() => expect(backend.revokeServerSession).toHaveBeenCalledWith('inconnu'));
    await waitFor(() => expect(toast).toHaveBeenCalledWith({ message: 'Appareil déconnecté', kind: 'success' }));
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(1));
    expect(onSignedOut).not.toHaveBeenCalled();
  });

  it('déconnecter cet appareil : déconnexion de l’app', async () => {
    const { onSignedOut } = setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Déconnecter cet appareil' }));
    await waitFor(() => expect(onSignedOut).toHaveBeenCalled());
  });

  it('serveur injoignable : message, et refus de déconnexion signalé', async () => {
    backend.listServerSessions.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    setup();
    expect(await screen.findByText(/Liste indisponible/)).toBeTruthy();
  });

  it('échec de la déconnexion : message d’erreur', async () => {
    backend.revokeServerSession.mockRejectedValueOnce(new Error('BACKEND_500'));
    const { toast } = setup();
    fireEvent.click(await screen.findByRole('button', { name: "Déconnecter l'appareil inconnu" }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith({ message: 'Serveur injoignable, réessayez.', kind: 'error' }));
  });
});
