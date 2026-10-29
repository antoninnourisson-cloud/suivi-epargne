// @vitest-environment jsdom
// Paramètres : l'enregistrement automatique ne renvoie que les champs modifiés, appliqués à
// l'état le plus récent. Une modification faite ailleurs pendant ce temps (veille fiscale
// « Appliquer », avis d'imposition, import) n'est jamais défaite par la saisie suivante.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, act, cleanup, within } from '@testing-library/react';
import { Settings } from './Settings';
import { ToastContext } from './Toast';
import { DEFAULT_FISCAL_CONFIG, DEFAULT_WORK_BENEFITS } from '../constants';
import type { FiscalConfig, WorkBenefits } from '../types';
import { fractionToPercent } from '../lib/numbers';

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
      onExport={() => {}} onImport={async () => ({ ok: true })}
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
    fireEvent.change(screen.getByLabelText('Charges salariales'), { target: { value: '25' } });
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
    fireEvent.change(screen.getByLabelText('Charges salariales'), { target: { value: '30' } });
    expect(latest.fiscal.salaryChargesRate).toBe(DEFAULT_FISCAL_CONFIG.salaryChargesRate);
    fireEvent.click(screen.getByText('quitter-ecran'));
    expect(latest.fiscal.salaryChargesRate).toBe(0.3);
  });
});

describe('Paramètres : import de fichier', () => {
  it('un import réussi propose « Annuler », qui remet les données mises de côté juste avant', async () => {
    const toast = vi.fn();
    const onImport = vi.fn(async (_f: File) => ({ ok: true, undoId: 'avant-import' }));
    const onUndoImport = vi.fn(async (_id: string) => true);
    render(
      <ToastContext.Provider value={toast}>
        <Settings config={DEFAULT_FISCAL_CONFIG} workBenefits={DEFAULT_WORK_BENEFITS} geminiApiKey="" pickerApiKey=""
          onUpdateFiscal={() => {}} onUpdateBenefits={() => {}} onSaveGeminiKey={() => {}} onSavePickerKey={() => {}}
          onExport={() => {}} onImport={onImport} onUndoImport={onUndoImport} />
      </ToastContext.Provider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Sauvegardes et données/ }));
    const file = new File(['{}'], 'pecule.json', { type: 'application/json' });
    fireEvent.change(screen.getByLabelText(/Importer un fichier/), { target: { files: [file] } });
    // La confirmation dit que l'import pourra être annulé juste après.
    expect(screen.getByText(/vous pourrez\s+annuler juste après/)).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Remplacer mes données' })); });
    expect(onImport).toHaveBeenCalledWith(file);
    const shown = toast.mock.calls[0][0] as { message: string; action?: { label: string; onClick: () => void } };
    expect(shown.message).toBe('Données importées (sauvegarde en cours)');
    expect(shown.action?.label).toBe('Annuler');
    await act(async () => { shown.action!.onClick(); });
    expect(onUndoImport).toHaveBeenCalledWith('avant-import');
    expect(toast).toHaveBeenLastCalledWith({ message: 'Import annulé : vos données d\'avant sont revenues', kind: 'success' });
  });
});

describe('Paramètres : affichage des taux et du thème', () => {
  it('affiche les taux exacts en %, avec une virgule à la saisie, et la dernière tranche en mots', () => {
    render(<Harness />);
    const charges = screen.getByLabelText('Charges salariales') as HTMLInputElement;
    expect(charges.value).toBe(fractionToPercent(DEFAULT_FISCAL_CONFIG.salaryChargesRate).toLocaleString('fr-FR'));
    const social = screen.getByLabelText('Prélèvements sociaux') as HTMLInputElement;
    // 0,186 s'affiche 18,6 (et non 0,19 arrondi).
    expect(social.value).toBe(fractionToPercent(DEFAULT_FISCAL_CONFIG.socialChargesCapital).toLocaleString('fr-FR'));
    fireEvent.focus(social);
    expect(social.value).not.toContain('.');
    // Un taux de tranche saisi en % est enregistré en fraction.
    const rates = screen.getAllByLabelText('Taux') as HTMLInputElement[];
    fireEvent.change(rates[1], { target: { value: '11,5' } });
    fireEvent.click(screen.getByText('quitter-ecran'));
    expect(latest.fiscal.taxBrackets[1].rate).toBe(0.115);
  });

  it('écrit « Au-delà de » pour la dernière tranche, sans nombre sentinelle', () => {
    render(<Harness />);
    expect(screen.getByText(/^Au-delà de /)).toBeTruthy();
    expect(screen.queryByDisplayValue(/999\s?999\s?999/)).toBeNull();
  });

  it('recrée la tranche « et au-delà » si elle a été supprimée, et ajoute les autres avant elle', () => {
    render(<Harness />);
    const count = DEFAULT_FISCAL_CONFIG.taxBrackets.length;
    fireEvent.click(screen.getByRole('button', { name: /^Fiscalité et barème/ }));
    fireEvent.click(screen.getByRole('button', { name: `Supprimer la tranche ${count}` }));
    expect(screen.queryByText(/^Au-delà de /)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Ajouter une tranche/ }));
    expect(screen.getByText(/^Au-delà de /)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Ajouter une tranche/ }));
    fireEvent.click(screen.getByText('quitter-ecran'));
    const brackets = latest.fiscal.taxBrackets;
    expect(brackets).toHaveLength(count + 1);
    expect(brackets[count - 1]).toEqual({ limit: 0, rate: 0 });
    expect(brackets[count].limit).toBe(Infinity);
  });

  it('propose un thème automatique, clair ou sombre', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: /^Affichage/ }));
    const group = screen.getByRole('group', { name: 'Thème' });
    fireEvent.click(within(group).getByRole('button', { name: /Sombre/ }));
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    fireEvent.click(within(group).getByRole('button', { name: /Automatique/ }));
    expect(within(group).getByRole('button', { name: /Automatique/ }).getAttribute('aria-pressed')).toBe('true');
  });
});

describe('Paramètres : déconnexion', () => {
  it('« Se déconnecter » est dans Paramètres (hors de l’en-tête mobile) et passe par la confirmation d’App', () => {
    const onRequestLogout = vi.fn();
    render(
      <ToastContext.Provider value={vi.fn()}>
        <Settings config={DEFAULT_FISCAL_CONFIG} workBenefits={DEFAULT_WORK_BENEFITS} geminiApiKey="" pickerApiKey=""
          onUpdateFiscal={() => {}} onUpdateBenefits={() => {}} onSaveGeminiKey={() => {}} onSavePickerKey={() => {}}
          onExport={() => {}} onImport={async () => ({ ok: true })} onRequestLogout={onRequestLogout} />
      </ToastContext.Provider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Se déconnecter' }));
    expect(onRequestLogout).toHaveBeenCalledTimes(1);
  });
});
