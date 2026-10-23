// @vitest-environment jsdom
// Rappel annuel du code de secours : lu sur la clé de l'appareil, seulement avec le serveur.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const backend = vi.hoisted(() => ({ enabled: true }));
const svc = vi.hoisted(() => ({
  isCloudBackupAvailable: vi.fn(() => true),
  getDeviceEnrollment: vi.fn(async () => null as { enabledAt: string; codeCheckedAt?: string } | null),
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
    await waitFor(() => expect(result.current).toBe(true));
  });

  it('code retapé il y a moins d’un an : pas de rappel', async () => {
    svc.getDeviceEnrollment.mockResolvedValue({ enabledAt: yearsAgo(2), codeCheckedAt: new Date().toISOString() });
    const { result } = renderHook(() => useBackupCodeCheckDue());
    await waitFor(() => expect(svc.getDeviceEnrollment).toHaveBeenCalled());
    expect(result.current).toBe(false);
  });

  it('sans serveur, ou sans session : rien n’est lu', async () => {
    backend.enabled = false;
    const { result } = renderHook(() => useBackupCodeCheckDue());
    expect(result.current).toBe(false);
    backend.enabled = true;
    svc.isCloudBackupAvailable.mockReturnValue(false);
    const second = renderHook(() => useBackupCodeCheckDue());
    await waitFor(() => expect(svc.isCloudBackupAvailable).toHaveBeenCalled());
    expect(svc.getDeviceEnrollment).not.toHaveBeenCalled();
    expect(second.result.current).toBe(false);
  });
});
