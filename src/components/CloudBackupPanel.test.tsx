// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, configure } from '@testing-library/react';

// Machine lente (couverture, réveil de veille) : on laisse plus d'une seconde aux attentes.
configure({ asyncUtilTimeout: 5000 });
import { emptyData } from '../lib/schema';
import { generateRecoveryCode as realGenerate, CloudBackupError } from '../lib/cloudBackupCrypto';

const svc = vi.hoisted(() => ({
  isCloudBackupAvailable: vi.fn(() => true),
  getDeviceEnrollment: vi.fn(async () => null as { enabledAt: string } | null),
  listServerBackups: vi.fn(async () => [] as string[]),
  readStatus: vi.fn(() => ({})),
  enableWithNewCode: vi.fn(async (_code: string) => undefined),
  enableWithExistingCode: vi.fn(async (_code: string) => undefined),
  uploadNow: vi.fn(async (_data: unknown) => undefined),
  decryptServerBackup: vi.fn(async (_date: string, _code: string) => ''),
  disableAndDeleteServerCopies: vi.fn(async () => 3),
}));

vi.mock('../services/cloudBackup', async () => {
  const crypto = await import('../lib/cloudBackupCrypto');
  const real = await vi.importActual<typeof import('../services/cloudBackup')>('../services/cloudBackup');
  return {
    ...svc,
    generateRecoveryCode: crypto.generateRecoveryCode,
    failureCode: real.failureCode,
    FAILURE_MESSAGES: real.FAILURE_MESSAGES,
  };
});

import { CloudBackupPanel } from './SettingsPanels';

const data = { ...emptyData(), accounts: [{ id: 'a1', name: 'Livret A', totalAmount: 10, ownedAmount: 10, parentalCapital: 0 }] } as never;

const setup = () => {
  const onImport = vi.fn(async (_f: File) => true);
  const confirm = vi.fn((_t: string, _m: string, ok: () => void | Promise<void>) => { void ok(); });
  render(<CloudBackupPanel getData={() => data} onImport={onImport} confirm={confirm} />);
  return { onImport, confirm };
};

beforeEach(() => {
  vi.clearAllMocks();
  svc.isCloudBackupAvailable.mockReturnValue(true);
  svc.getDeviceEnrollment.mockResolvedValue(null);
  svc.listServerBackups.mockResolvedValue([]);
});
afterEach(cleanup);

describe('Sauvegarde de secours chiffrée (Réglages)', () => {
  it("ne s'affiche pas sans serveur ni session", () => {
    svc.isCloudBackupAvailable.mockReturnValue(false);
    setup();
    expect(screen.queryByText(/Sauvegarde de secours chiffrée/)).toBeNull();
  });

  it('activation : montre le code une fois, puis active et envoie après « Je l’ai mis en lieu sûr »', async () => {
    setup();
    fireEvent.click(await screen.findByRole('button', { name: /Activer/ }));
    const code = screen.getByTestId('recovery-code').textContent!;
    expect(code).toMatch(/^([0-9A-Z]{4}-){6}[0-9A-Z]{4}$/);
    expect(svc.enableWithNewCode).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Je l'ai mis en lieu sûr/ }));
    await waitFor(() => expect(svc.uploadNow).toHaveBeenCalledWith(data));
    expect(svc.enableWithNewCode).toHaveBeenCalledWith(code);
    await waitFor(() => expect(screen.queryByTestId('recovery-code')).toBeNull());
  });

  it("annuler l'activation n'enregistre rien", async () => {
    setup();
    fireEvent.click(await screen.findByRole('button', { name: /Activer/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(screen.queryByTestId('recovery-code')).toBeNull();
    expect(svc.enableWithNewCode).not.toHaveBeenCalled();
  });

  it('restauration : mauvais code = message clair, rien de remplacé', async () => {
    svc.listServerBackups.mockResolvedValue(['2026-10-07', '2026-09-30']);
    svc.decryptServerBackup.mockRejectedValue(new CloudBackupError('WRONG_CODE'));
    const { onImport, confirm } = setup();
    fireEvent.click(await screen.findByRole('button', { name: /Restaurer/ }));
    fireEvent.change(screen.getByLabelText('Code de secours'), { target: { value: realGenerate().code } });
    fireEvent.click(screen.getByRole('button', { name: /Déchiffrer et restaurer/ }));
    expect(await screen.findByText(/ne correspond pas à cette copie/)).toBeTruthy();
    expect(confirm).not.toHaveBeenCalled();
    expect(onImport).not.toHaveBeenCalled();
  });

  it("restauration : demande confirmation puis passe par l'import de fichier", async () => {
    svc.listServerBackups.mockResolvedValue(['2026-10-07', '2026-09-30']);
    svc.getDeviceEnrollment.mockResolvedValue({ enabledAt: '2026-09-01T00:00:00Z' });
    const json = JSON.stringify(data);
    svc.decryptServerBackup.mockResolvedValue(json);
    const { onImport, confirm } = setup();
    fireEvent.click(await screen.findByRole('button', { name: /Restaurer/ }));
    fireEvent.change(screen.getByLabelText('Copie à restaurer'), { target: { value: '2026-09-30' } });
    const code = realGenerate().code;
    fireEvent.change(screen.getByLabelText('Code de secours'), { target: { value: code } });
    fireEvent.click(screen.getByRole('button', { name: /Déchiffrer et restaurer/ }));
    await waitFor(() => expect(onImport).toHaveBeenCalled());
    expect(svc.decryptServerBackup).toHaveBeenCalledWith('2026-09-30', code);
    expect(confirm.mock.calls[0][0]).toMatch(/Remplacer vos données par la copie du 30 septembre 2026/);
    const file = onImport.mock.calls[0][0];
    expect(await file.text()).toBe(json);
  });

  it('restauration : une copie déchiffrée mais invalide est refusée avant confirmation', async () => {
    svc.listServerBackups.mockResolvedValue(['2026-10-07']);
    svc.decryptServerBackup.mockResolvedValue(JSON.stringify({ accounts: 'pas une liste' }));
    const { onImport, confirm } = setup();
    fireEvent.click(await screen.findByRole('button', { name: /Restaurer/ }));
    fireEvent.change(screen.getByLabelText('Code de secours'), { target: { value: realGenerate().code } });
    fireEvent.click(screen.getByRole('button', { name: /Déchiffrer et restaurer/ }));
    expect(await screen.findByText(/rien n'a été remplacé/)).toBeTruthy();
    expect(confirm).not.toHaveBeenCalled();
    expect(onImport).not.toHaveBeenCalled();
  });

  it('désactivation : confirmation, puis copies serveur effacées', async () => {
    svc.getDeviceEnrollment.mockResolvedValue({ enabledAt: '2026-09-01T00:00:00Z' });
    const { confirm } = setup();
    fireEvent.click(await screen.findByRole('button', { name: /Désactiver/ }));
    expect(confirm.mock.calls[0][0]).toMatch(/Désactiver la sauvegarde de secours/);
    await waitFor(() => expect(svc.disableAndDeleteServerCopies).toHaveBeenCalled());
  });

  it('envoyer maintenant : une erreur reste discrète (message dans le panneau)', async () => {
    svc.getDeviceEnrollment.mockResolvedValue({ enabledAt: '2026-09-01T00:00:00Z' });
    svc.uploadNow.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    setup();
    fireEvent.click(await screen.findByRole('button', { name: /Envoyer maintenant/ }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Serveur injoignable (hors ligne ?).');
  });
});
