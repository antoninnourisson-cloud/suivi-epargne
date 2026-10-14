// @vitest-environment jsdom
// Paramètres : l'enregistrement automatique ne renvoie que les champs modifiés, appliqués à
// l'état le plus récent. Une modification faite ailleurs pendant ce temps (veille fiscale
// « Appliquer », avis d'imposition, import) n'est jamais défaite par la saisie suivante.
import { describe, it, expect, afterEach } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { Settings } from './Settings';
import { DEFAULT_FISCAL_CONFIG, DEFAULT_WORK_BENEFITS } from '../constants';
import type { FiscalConfig, WorkBenefits } from '../types';

let latest: { fiscal: FiscalConfig; benefits: WorkBenefits; picker: string };

const Harness = () => {
  const [fiscal, setFiscal] = useState<FiscalConfig>({ ...DEFAULT_FISCAL_CONFIG, lepHouseholdParts: 1 });
  const [benefits, setBenefits] = useState<WorkBenefits>(DEFAULT_WORK_BENEFITS);
  const [picker, setPicker] = useState('');
  const [shown, setShown] = useState(true);
  latest = { fiscal, benefits, picker };
  if (!shown) return null;
  return (
    <>
    <button onClick={() => setShown(false)}>quitter-ecran</button>
    <Settings config={fiscal} workBenefits={benefits} geminiApiKey="" pickerApiKey={picker}
      onUpdateFiscal={setFiscal} onUpdateBenefits={setBenefits} onSaveGeminiKey={() => {}} onSavePickerKey={setPicker}
      onExport={() => {}} onImport={async () => true}
      fiscalWatchSlot={<button onClick={() => setFiscal(p => ({ ...p, lepIncomeCeiling: 99999 }))}>veille-appliquer</button>}
      taxNoticeSlot={<button onClick={() => setFiscal(p => ({ ...p, lepHouseholdParts: 2 }))}>avis-parts-2</button>} />
    </>
  );
};

const waitDebounce = () => act(async () => { await new Promise(r => setTimeout(r, 900)); });

afterEach(() => cleanup());

describe('Paramètres : enregistrement champ par champ', () => {
  it('appliquer une proposition de la veille puis modifier un autre champ garde la proposition', async () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('veille-appliquer'));
    expect(latest.fiscal.lepIncomeCeiling).toBe(99999);
    fireEvent.change(screen.getByLabelText('Charges salariales'), { target: { value: '0,25' } });
    await waitDebounce();
    expect(latest.fiscal.salaryChargesRate).toBe(0.25);
    expect(latest.fiscal.lepIncomeCeiling).toBe(99999);
  });

  it("les parts de l'avis d'imposition survivent à la saisie d'une clé", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('avis-parts-2'));
    fireEvent.change(document.getElementById('picker-key')!, { target: { value: 'AIzaTEST' } });
    await waitDebounce();
    expect(latest.picker).toBe('AIzaTEST');
    expect(latest.fiscal.lepHouseholdParts).toBe(2);
  });

  it("une saisie faite juste avant de quitter l'écran est enregistrée", () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText('Charges salariales'), { target: { value: '0,3' } });
    expect(latest.fiscal.salaryChargesRate).toBe(DEFAULT_FISCAL_CONFIG.salaryChargesRate);
    fireEvent.click(screen.getByText('quitter-ecran'));
    expect(latest.fiscal.salaryChargesRate).toBe(0.3);
  });
});
