// @vitest-environment jsdom
// Fiches de paie : bouton d'import désactivé qui dit pourquoi, saisie à la main sans clé
// Gemini (champs reliés, montant illisible signalé), liste avec actions libellées, retrait
// annulable qui garde le focus dans la liste.
import { describe, it, expect, vi, afterEach } from 'vitest';
import React, { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { PayslipRecord } from '../types';

vi.mock('../services/googleDriveService', () => ({
  openDrivePicker: vi.fn(async () => ({ id: 'file-1', name: 'paie-aout.pdf', mimeType: 'application/pdf' })),
  downloadFileAsBase64: vi.fn(),
}));
vi.mock('../services/geminiService', () => ({
  extractPayslipData: vi.fn(),
  fileToBase64: vi.fn(async () => 'QkFTRTY0'),
  GeminiError: class GeminiError extends Error { code = 'OTHER'; },
}));

import { Payslips } from './Payslips';

afterEach(cleanup);

const slip = (id: string, period: string, net: number, gross?: number): PayslipRecord => ({
  id, fileId: `f-${id}`, fileName: `${id}.pdf`, addedAt: '2026-10-01T00:00:00Z', reviewed: true,
  extracted: { period, netPaid: net, grossAmount: gross, employer: 'ACME' },
});

const Harness: React.FC<{ initial: PayslipRecord[]; picker?: string; gemini?: string; activeId?: string; onApply?: (p: PayslipRecord) => void; onClear?: () => void; spy?: (p: PayslipRecord[]) => void }> = ({ initial, picker = '', gemini = '', activeId, onApply = () => {}, onClear = () => {}, spy }) => {
  const [list, setList] = useState(initial);
  spy?.(list);
  return <Payslips payslips={list} onUpdatePayslips={setList} geminiApiKey={gemini} pickerApiKey={picker} onApplyToPilotage={onApply} activePayslipId={activeId} onClearActivePayslip={onClear} />;
};

describe('Fiches de paie', () => {
  it('sans clé : import désactivé, et la raison est écrite et reliée au bouton', () => {
    render(<Harness initial={[]} />);
    expect(screen.getByRole('heading', { name: 'Fiches de paie' })).toBeTruthy();
    expect(screen.getByText("Aucune fiche de paie pour l'instant")).toBeTruthy();
    const importBtn = screen.getByRole('button', { name: 'Importer depuis Drive' }) as HTMLButtonElement;
    expect(importBtn.disabled).toBe(true);
    const note = document.getElementById(importBtn.getAttribute('aria-describedby')!);
    expect(note?.textContent).toMatch(/clé Google Picker et une clé Gemini/);
  });

  it('clé manquante : un bouton mène aux Paramètres, rubrique « Clés et services »', () => {
    const onOpenKeys = vi.fn();
    render(<Payslips payslips={[]} onUpdatePayslips={() => {}} geminiApiKey="" pickerApiKey="pk" onApplyToPilotage={() => {}} onClearActivePayslip={() => {}} onOpenKeys={onOpenKeys} />);
    expect(screen.getByText(/Ajoutez une clé Gemini/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Ouvrir « Clés et services »' }));
    expect(onOpenKeys).toHaveBeenCalled();
  });

  it('sans clé Gemini : saisie à la main, montant illisible signalé, fiche enregistrée', async () => {
    let latest: PayslipRecord[] = [];
    render(<Harness initial={[]} picker="pk" spy={l => { latest = l; }} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Importer depuis Drive' })); });
    expect(screen.getByRole('heading', { name: 'paie-aout.pdf' })).toBeTruthy();
    const analyse = screen.getByRole('button', { name: "Analyser avec l'IA" }) as HTMLButtonElement;
    expect(analyse.disabled).toBe(true);
    expect(document.getElementById(analyse.getAttribute('aria-describedby')!)?.textContent).toMatch(/clé Gemini/);

    fireEvent.click(screen.getByRole('button', { name: 'Saisir à la main' }));
    fireEvent.change(screen.getByLabelText('Mois de la paie (AAAA-MM)'), { target: { value: '2026-08' } });
    const gross = screen.getByLabelText('Brut') as HTMLInputElement;
    fireEvent.blur(gross, { target: { value: '12a' } });
    expect(screen.getByRole('alert').textContent).toMatch(/Montant non reconnu/);
    expect(gross.getAttribute('aria-invalid')).toBe('true');
    fireEvent.blur(gross, { target: { value: '2 230,50' } });
    expect(screen.queryByText(/Montant non reconnu/)).toBeNull();
    fireEvent.blur(screen.getByLabelText('Net payé'), { target: { value: '1 744,12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer la fiche' }));

    expect(latest).toHaveLength(1);
    expect(latest[0]).toMatchObject({ fileId: 'file-1', fileName: 'paie-aout.pdf', reviewed: true, extracted: { period: '2026-08', grossAmount: 2230.5, netPaid: 1744.12 } });
    expect(screen.getByRole('button', { name: "Retirer la fiche d'août 2026 de la liste" })).toBeTruthy();
  });

  it('une fiche du même mois est signalée avant d’enregistrer', async () => {
    render(<Harness initial={[slip('a', '2026-08', 1700, 2200)]} picker="pk" />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Importer depuis Drive' })); });
    fireEvent.click(screen.getByRole('button', { name: 'Saisir à la main' }));
    fireEvent.change(screen.getByLabelText('Mois de la paie (AAAA-MM)'), { target: { value: '2026-08' } });
    expect(screen.getByText(/Une fiche existe déjà pour août 2026/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Enregistrer la fiche/ })).toBeNull();
    expect(screen.getByRole('button', { name: "Remplacer la fiche d'août 2026" })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ajouter (deux fiches ce mois-ci)' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Abandonner cette fiche' }));
    expect(screen.queryByLabelText('Brut')).toBeNull();
  });

  const importManualFor = async (period: string) => {
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Importer depuis Drive' })); });
    fireEvent.click(screen.getByRole('button', { name: 'Saisir à la main' }));
    fireEvent.change(screen.getByLabelText('Mois de la paie (AAAA-MM)'), { target: { value: period } });
    fireEvent.blur(screen.getByLabelText('Net payé'), { target: { value: '1 900' } });
  };

  it('« Remplacer » : l’ancienne fiche du mois disparaît ; référence du Pilotage relâchée', async () => {
    let latest: PayslipRecord[] = [];
    const onClear = vi.fn();
    render(<Harness initial={[slip('a', '2026-08', 1700, 2200), slip('b', '2026-07', 1700)]} picker="pk" activeId="a" onClear={onClear} spy={l => { latest = l; }} />);
    await importManualFor('2026-08');
    fireEvent.click(screen.getByRole('button', { name: "Remplacer la fiche d'août 2026" }));
    expect(latest.map(p => p.id)).not.toContain('a');
    expect(latest).toHaveLength(2);
    expect(latest[0]).toMatchObject({ extracted: { period: '2026-08', netPaid: 1900 } });
    expect(latest[0].addsToPeriod).toBeUndefined();
    expect(onClear).toHaveBeenCalled();
  });

  it('« Ajouter » : les deux fiches restent, la nouvelle est marquée « s’ajoute »', async () => {
    let latest: PayslipRecord[] = [];
    const onClear = vi.fn();
    render(<Harness initial={[slip('a', '2026-08', 1700, 2200)]} picker="pk" activeId="a" onClear={onClear} spy={l => { latest = l; }} />);
    await importManualFor('2026-08');
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter (deux fiches ce mois-ci)' }));
    expect(latest.map(p => p.id)).toContain('a');
    expect(latest).toHaveLength(2);
    expect(latest[0]).toMatchObject({ addsToPeriod: true, extracted: { period: '2026-08' } });
    expect(onClear).not.toHaveBeenCalled();
  });

  it('montants qui ne se recoupent pas : avertissement, champs signalés, enregistrement possible', async () => {
    let latest: PayslipRecord[] = [];
    render(<Harness initial={[]} picker="pk" spy={l => { latest = l; }} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Importer depuis Drive' })); });
    fireEvent.click(screen.getByRole('button', { name: 'Saisir à la main' }));
    fireEvent.blur(screen.getByLabelText('Net à payer avant impôt'), { target: { value: '2 400' } });
    fireEvent.blur(screen.getByLabelText('Impôt prélevé à la source'), { target: { value: '100' } });
    expect(screen.queryByText(/ne se recoupent pas/)).toBeNull();
    fireEvent.blur(screen.getByLabelText('Net payé'), { target: { value: '2 400' } });
    expect(screen.getByText(/ne se recoupent pas/)).toBeTruthy();
    expect(screen.getByText(/écart de 100,00/)).toBeTruthy();
    expect(document.getElementById(screen.getByLabelText('Net payé').getAttribute('aria-describedby')!)?.textContent).toMatch(/À relire/);
    fireEvent.blur(screen.getByLabelText('Net payé'), { target: { value: '2 300' } });
    expect(screen.queryByText(/ne se recoupent pas/)).toBeNull();
    fireEvent.blur(screen.getByLabelText('Net payé'), { target: { value: '2 000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer la fiche' }));
    expect(latest).toHaveLength(1);
  });

  it('« Choisir sur l’appareil » : fichier lu sur place, sans Drive ni clé Picker', async () => {
    const gemini = await import('../services/geminiService');
    const drive = await import('../services/googleDriveService');
    vi.mocked(gemini.extractPayslipData).mockResolvedValueOnce({ period: '2026-09', netPaid: 2050, employer: 'ACME' });
    vi.mocked(gemini.fileToBase64).mockClear();
    vi.mocked(drive.openDrivePicker).mockClear();
    let latest: PayslipRecord[] = [];
    render(<Harness initial={[]} gemini="g" spy={l => { latest = l; }} />);
    const device = screen.getByRole('button', { name: "Choisir sur l'appareil" }) as HTMLButtonElement;
    expect(device.disabled).toBe(false);
    const input = screen.getByTestId('payslip-file') as HTMLInputElement;
    expect(input.accept).toBe('application/pdf,image/*');
    const file = new File(['%PDF'], 'Paie septembre.pdf', { type: 'application/pdf' });
    fireEvent.change(input, { target: { files: [file] } });
    expect(screen.getByRole('heading', { name: 'Paie septembre.pdf' })).toBeTruthy();
    expect(screen.getByText(/pas copiée sur votre Drive/)).toBeTruthy();
    expect(gemini.fileToBase64).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: "Analyser avec l'IA" })); });
    expect(gemini.fileToBase64).toHaveBeenCalledWith(file);
    expect(drive.openDrivePicker).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: /Enregistrer la fiche/ }));
    expect(latest[0]).toMatchObject({ fileId: '', fileName: 'Paie septembre.pdf', extracted: { netPaid: 2050 } });
  });

  it('« Choisir sur l’appareil » : type ou taille refusés, rien n’est lu', async () => {
    const gemini = await import('../services/geminiService');
    vi.mocked(gemini.fileToBase64).mockClear();
    render(<Harness initial={[]} gemini="g" />);
    fireEvent.change(screen.getByTestId('payslip-file'), { target: { files: [new File(['x'], 'notes.txt', { type: 'text/plain' })] } });
    expect(screen.getByRole('alert').textContent).toMatch(/ne lit que les PDF et les images/);
    fireEvent.click(screen.getByRole('button', { name: "Fermer l'import" }));
    const big = new File(['%PDF'], 'lourd.pdf', { type: 'application/pdf' });
    Object.defineProperty(big, 'size', { value: 16 * 1024 * 1024 });
    fireEvent.change(screen.getByTestId('payslip-file'), { target: { files: [big] } });
    expect(screen.getByRole('alert').textContent).toMatch(/trop lourd : 15 Mo au plus/);
    expect(screen.queryByRole('button', { name: "Analyser avec l'IA" })).toBeNull();
    expect(gemini.fileToBase64).not.toHaveBeenCalled();
  });

  it('liste : actions libellées, fiche de référence du Pilotage', () => {
    const onApply = vi.fn();
    const onClear = vi.fn();
    const a = slip('a', '2026-09', 1800, 2300);
    const b = slip('b', '2026-08', 1750, 2250);
    render(<Harness initial={[b, a]} activeId="b" onApply={onApply} onClear={onClear} />);
    expect(screen.getByText('Référence du Pilotage')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: "Revenir à l'estimation" }));
    expect(onClear).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Utiliser pour le Pilotage (fiche de septembre 2026)' }));
    expect(onApply).toHaveBeenCalledWith(a);
    const drive = screen.getByRole('link', { name: 'Ouvrir la fiche de septembre 2026 sur Drive (nouvel onglet)' });
    expect(drive.getAttribute('href')).toBe('https://drive.google.com/file/d/f-a/view');
  });

  it('retrait : la fiche disparaît et le focus va sur la fiche voisine', async () => {
    render(<Harness initial={[slip('a', '2026-09', 1800), slip('b', '2026-08', 1750)]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Retirer la fiche de septembre 2026 de la liste' }));
    expect(screen.queryByText('septembre 2026')).toBeNull();
    await waitFor(() => expect(document.activeElement?.getAttribute('aria-label')).toBe("Ouvrir la fiche d'août 2026 sur Drive (nouvel onglet)"));
  });

  // « Importer depuis Drive » désactivé sans clé Picker : le focus va sur « Choisir sur
  // l'appareil », toujours actif (avant ce bouton, il allait sur le titre), jamais sur la page.
  it('retrait de la dernière fiche sans clé Picker : le focus va sur « Choisir sur l’appareil »', async () => {
    render(<Harness initial={[slip('a', '2026-09', 1800)]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Retirer la fiche de septembre 2026 de la liste' }));
    expect(screen.getByText("Aucune fiche de paie pour l'instant")).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: "Choisir sur l'appareil" })));
  });

  it('retrait de la dernière fiche avec clé Picker : le focus va sur « Importer depuis Drive »', async () => {
    render(<Harness initial={[slip('a', '2026-09', 1800)]} picker="pk" />);
    fireEvent.click(screen.getByRole('button', { name: 'Retirer la fiche de septembre 2026 de la liste' }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Importer depuis Drive' })));
  });

  it('fiche partagée vers Pécule : lue depuis l’appareil, enregistrée sans lien Drive', async () => {
    const gemini = await import('../services/geminiService');
    const drive = await import('../services/googleDriveService');
    vi.mocked(gemini.extractPayslipData).mockResolvedValueOnce({ period: '2026-10', netPaid: 2100, employer: 'ACME' });
    const shared = new File(['%PDF'], 'Bulletin octobre.pdf', { type: 'application/pdf' });
    const taken = vi.fn();
    let latest: PayslipRecord[] = [];
    const Shared = () => {
      const [list, setList] = useState<PayslipRecord[]>([]);
      latest = list;
      return <Payslips payslips={list} onUpdatePayslips={setList} geminiApiKey="g" pickerApiKey="" onApplyToPilotage={() => {}} onClearActivePayslip={() => {}}
        sharedFile={shared} onSharedFileTaken={taken} />;
    };
    render(<Shared />);
    expect(screen.getByRole('heading', { name: 'Bulletin octobre.pdf' })).toBeTruthy();
    expect(taken).toHaveBeenCalled();
    expect(screen.getByText(/pas copiée sur votre Drive/)).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: "Analyser avec l'IA" })); });
    expect(gemini.fileToBase64).toHaveBeenCalledWith(shared);
    expect(drive.downloadFileAsBase64).not.toHaveBeenCalled();
    expect(gemini.extractPayslipData).toHaveBeenCalledWith('g', 'QkFTRTY0', 'application/pdf');
    fireEvent.click(await screen.findByRole('button', { name: /Enregistrer la fiche/ }));
    expect(latest[0]).toMatchObject({ fileId: '', fileName: 'Bulletin octobre.pdf', extracted: { netPaid: 2100 } });
    expect(screen.queryByRole('link', { name: /sur Drive/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Retirer la fiche/ }).hasAttribute('data-focus-after-removal')).toBe(true);
  });

  it('fiche partagée illisible : erreur de lecture, nouvel essai proposé', async () => {
    const gemini = await import('../services/geminiService');
    vi.mocked(gemini.fileToBase64).mockRejectedValueOnce(new Error('lecture'));
    const shared = new File(['%PDF'], 'b.pdf', { type: '' });
    render(<Payslips payslips={[]} onUpdatePayslips={() => {}} geminiApiKey="g" pickerApiKey="" onApplyToPilotage={() => {}} onClearActivePayslip={() => {}} sharedFile={shared} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: "Analyser avec l'IA" })); });
    expect(await screen.findByText('La lecture du fichier a échoué.')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Réessayer l'analyse/ })).toBeTruthy();
  });
});
