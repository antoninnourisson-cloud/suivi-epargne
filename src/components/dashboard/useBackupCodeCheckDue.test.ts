// @vitest-environment jsdom
// Rappel annuel du code de secours : lu sur la clé de l'appareil, seulement avec le serveur.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const backend = vi.hoisted(() => ({ enabled: true }));
const svc = vi.hoisted(() => ({
  isCloudBackupAvailable: vi.fn(() => true),
  getDeviceEnrollment: vi.fn(async () => null as { enabledAt: string; codeCheckedAt?: string } | null),
  readStatus: vi.fn(() => ({}) as { lastUploadAt?: string; lastError?: string; lastErrorAt?: string }),
  FAILURE_MESSAGES: { OFFLINE: 'Serveur injoignable (hors ligne ?).' } as Record<string, string>,
}));
vi.mock('../../services/backendService', () => ({ isBackendEnabled: () => backend.enabled }));
vi.mock('../../services/cloudBackup', () => svc);

import { useBackupCodeCheckDue } from './useBackupCodeCheckDue';

const yearsAgo = (n: number) => new Date(Date.now() - n * 366 * 86_400_000).toISOString();

beforeEach(() => {
  vi.clearAllMocks();
  backend.enabled = true;
  svc.isCloudBackupAvailable.mockReturnValue(true);
});

describe("rappel annuel du code de secours (Accueil)", () => {
  it('activée depuis plus d’un an, code jamais retapé : rappel', async () => {
    svc.getDeviceEnrollment.mockResolvedValue({ enabledAt: yearsAgo(1) });
    const { result } = renderHook(() => useBackupCodeCheckDue());
    await waitFor(() => expect(result.current.codeCheckDue).toBe(true));
  });

  it('code retapé il y a moins d’un an : pas de rappel', async () => {
    svc.getDeviceEnrollment.mockResolvedValue({ enabledAt: yearsAgo(2), codeCheckedAt: new Date().toISOString() });
    const { result } = renderHook(() => useBackupCodeCheckDue());
    await waitFor(() => expect(svc.getDeviceEnrollment).toHaveBeenCalled());
    expect(result.current.codeCheckDue).toBe(false);
  });

  it('envoi vieux de plus de 30 jours ou erreur récente : problème signalé, avec la phrase en clair', async () => {
    const now = Date.now();
    svc.getDeviceEnrollment.mockResolvedValue({ enabledAt: new Date(now - 90 * 86_400_000).toISOString() });
    svc.readStatus.mockReturnValue({ lastUploadAt: new Date(now - 34 * 86_400_000).toISOString() });
    const stale = renderHook(() => useBackupCodeCheckDue());
    await waitFor(() => expect(stale.result.current.uploadProblem).toMatchObject({ kind: 'stale', days: 34 }));
    svc.readStatus.mockReturnValue({ lastUploadAt: new Date(now - 2 * 86_400_000).toISOString(), lastError: 'OFFLINE', lastErrorAt: new Date(now - 86_400_000).toISOString() });
    const failed = renderHook(() => useBackupCodeCheckDue());
    await waitFor(() => expect(failed.result.current.uploadProblem).toMatchObject({ kind: 'error', reason: 'Serveur injoignable (hors ligne ?).' }));
    svc.readStatus.mockReturnValue({});
  });

  it('sans serveur, ou sans session : rien n’est lu', async () => {
    backend.enabled = false;
    const { result } = renderHook(() => useBackupCodeCheckDue());
    expect(result.current.codeCheckDue).toBe(false);
    backend.enabled = true;
    svc.isCloudBackupAvailable.mockReturnValue(false);
    const second = renderHook(() => useBackupCodeCheckDue());
    await waitFor(() => expect(svc.isCloudBackupAvailable).toHaveBeenCalled());
    expect(svc.getDeviceEnrollment).not.toHaveBeenCalled();
    expect(second.result.current.codeCheckDue).toBe(false);
  });
});
