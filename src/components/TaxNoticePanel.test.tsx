// @vitest-environment jsdom
// Avis d'imposition reçu par « Partager vers Pécule » : lu dès l'ouverture (une seule fois),
// valeurs proposées puis enregistrées seulement à la validation.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('../services/geminiService', () => ({
  extractTaxNotice: vi.fn(async () => ({ incomeYear: 2025, rfr: 21000, parts: 1 })),
  fileToBase64: vi.fn(async () => 'QkFTRTY0'),
}));

import { TaxNoticePanel } from './TaxNoticePanel';
import { extractTaxNotice } from '../services/geminiService';

afterEach(cleanup);

describe('Avis d’imposition partagé', () => {
  it('lu dès l’ouverture, enregistré à la validation', async () => {
    const onSave = vi.fn();
    const avis = new File(['%PDF'], 'avis.pdf', { type: 'application/pdf' });
    render(<TaxNoticePanel geminiApiKey="g" rfrByYear={{}} onSave={onSave} onSetParts={() => {}} initialFile={avis} />);
    expect(await screen.findByText(/Revenus 2025 : RFR/)).toBeTruthy();
    expect(extractTaxNotice).toHaveBeenCalledTimes(1);
    expect(extractTaxNotice).toHaveBeenCalledWith('g', 'QkFTRTY0', 'application/pdf');
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(onSave).toHaveBeenCalledWith(2025, 21000);
  });

  it('trop lourd : refusé sans rien envoyer', () => {
    vi.mocked(extractTaxNotice).mockClear();
    const gros = new File([new Uint8Array(15 * 1024 * 1024 + 1)], 'avis.pdf', { type: 'application/pdf' });
    render(<TaxNoticePanel geminiApiKey="g" rfrByYear={{}} onSave={() => {}} onSetParts={() => {}} initialFile={gros} />);
    expect(screen.getByRole('alert').textContent).toMatch(/15 Mo/);
    expect(extractTaxNotice).not.toHaveBeenCalled();
  });
});
