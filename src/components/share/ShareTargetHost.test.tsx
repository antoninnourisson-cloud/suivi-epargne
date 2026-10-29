// @vitest-environment jsdom
// « Partager vers Pécule » : rien avant que les données soient prêtes, puis le choix (fiche
// de paie, relevé, avis d'imposition, annuler), la clé Gemini manquante, le fichier
// introuvable et le partage refusé. L'adresse est nettoyée dans tous les cas.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { emptyData } from '../../lib/schema';

const take = vi.fn<() => Promise<File | null>>();
const discard = vi.fn(async () => undefined);
vi.mock('../../services/sharedFile', async importOriginal => ({
  ...(await importOriginal<typeof import('../../services/sharedFile')>()),
  takeSharedFile: () => take(),
  discardSharedFile: () => discard(),
}));
const stubProps: Record<string, Record<string, unknown>> = {};
vi.mock('../StatementImport', () => ({
  StatementImport: (p: Record<string, unknown>) => { stubProps.StatementImport = p; return <div data-testid="statement" />; },
}));
vi.mock('../TaxNoticePanel', () => ({
  TaxNoticePanel: (p: Record<string, unknown>) => { stubProps.TaxNoticePanel = p; return <div data-testid="tax" />; },
}));

import { ShareTargetHost, describeFileSize, describeReceivedAt, type ShareTargetHostProps } from './ShareTargetHost';

const pdf = new File(['%PDF'], 'Bulletin octobre.pdf', { type: 'application/pdf' });

const setup = (over: Partial<ShareTargetHostProps> = {}) => {
  const doc = emptyData();
  const props: ShareTargetHostProps = {
    marker: '1', ready: true,
    data: { doc, geminiApiKey: 'cle', patchConfig: vi.fn(), setFiscalConfig: vi.fn() },
    onImportStatement: vi.fn(() => null), onPayslip: vi.fn(), onOpenKeys: vi.fn(), onDone: vi.fn(),
    ...over,
  };
  return { props, ...render(<ShareTargetHost {...props} />) };
};

beforeEach(() => {
  window.history.replaceState({}, '', '/?partage=1');
  take.mockReset().mockResolvedValue(pdf);
  discard.mockClear();
});
afterEach(cleanup);

describe('Partager vers Pécule', () => {
  it('rien tant que les données ne sont pas prêtes', () => {
    const { props, rerender } = setup({ ready: false });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(take).not.toHaveBeenCalled();
    expect(window.location.search).toBe('?partage=1');
    rerender(<ShareTargetHost {...props} ready />);
    expect(take).toHaveBeenCalledTimes(1);
  });

  it('fiche de paie : le fichier part vers l’écran des fiches, adresse nettoyée', async () => {
    const { props } = setup();
    const dialog = await screen.findByRole('dialog', { name: 'Que voulez-vous importer ?' });
    expect(dialog.textContent).toContain('Bulletin octobre.pdf');
    expect(dialog.textContent).toMatch(/qu'après votre choix/);
    expect(window.location.search).toBe('');
    fireEvent.click(screen.getByRole('button', { name: /Fiche de paie/ }));
    expect(props.onPayslip).toHaveBeenCalledWith(pdf);
    expect(props.onDone).toHaveBeenCalled();
  });

  it('avant toute lecture : nom, taille, heure de réception et « Vous n’avez rien partagé ? »', async () => {
    const at = new Date(2026, 9, 29, 14, 32).getTime();
    take.mockResolvedValue(new File([new Uint8Array(2500)], 'inconnu.pdf', { type: 'application/pdf', lastModified: at }));
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 9, 29, 14, 40) });
    try {
      const { props } = setup();
      const dialog = await screen.findByRole('dialog', { name: 'Que voulez-vous importer ?' });
      expect(dialog.textContent).toContain('inconnu.pdf');
      expect(dialog.textContent).toMatch(/2 Ko · reçu aujourd'hui à 14:32/);
      expect(dialog.textContent).toMatch(/Vous n'avez rien partagé \? Annulez/);
      fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
      expect(props.onDone).toHaveBeenCalled();
      expect(props.onPayslip).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('taille et heure lisibles', () => {
    expect(describeFileSize(1)).toBe('1 octet');
    expect(describeFileSize(900)).toBe('900 octets');
    expect(describeFileSize(820 * 1024)).toBe('820 Ko');
    expect(describeFileSize(2.44 * 1024 * 1024)).toBe('2,4 Mo');
    const at = new Date(2026, 9, 28, 23, 50).getTime();
    expect(describeReceivedAt(at, new Date(2026, 9, 29, 0, 10).getTime())).toBe('reçu le 28 octobre à 23:50');
  });

  it('relevé bancaire : « Lire un relevé » reçoit le fichier', async () => {
    const { props } = setup();
    fireEvent.click(await screen.findByRole('button', { name: /Relevé bancaire/ }));
    expect(screen.getByTestId('statement')).toBeTruthy();
    expect(stubProps.StatementImport.initialFile).toBe(pdf);
    expect(stubProps.StatementImport.onImport).toBe(props.onImportStatement);
    (stubProps.StatementImport.onClose as () => void)();
    expect(props.onDone).toHaveBeenCalled();
  });

  it('avis d’imposition : enregistré comme depuis les Paramètres', async () => {
    const { props } = setup();
    fireEvent.click(await screen.findByRole('button', { name: /Avis d'imposition/ }));
    expect(screen.getByRole('dialog', { name: "Avis d'imposition" })).toBeTruthy();
    expect(stubProps.TaxNoticePanel.initialFile).toBe(pdf);
    (stubProps.TaxNoticePanel.onSave as (y: number, v: number) => void)(2025, 21000);
    expect(props.data.patchConfig).toHaveBeenCalledWith({ rfrByYear: { 2025: 21000 } });
    (stubProps.TaxNoticePanel.onSetParts as (p: number) => void)(2);
    const update = vi.mocked(props.data.setFiscalConfig).mock.calls[0][0] as (prev: object) => object;
    expect(update({ a: 1 })).toEqual({ a: 1, lepHouseholdParts: 2 });
    fireEvent.click(screen.getAllByRole('button', { name: 'Fermer' })[0]);
    expect(props.onDone).toHaveBeenCalled();
  });

  it('« Annuler » : fin du partage', async () => {
    const { props } = setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Annuler' }));
    expect(props.onDone).toHaveBeenCalled();
    expect(props.onPayslip).not.toHaveBeenCalled();
  });

  it('sans clé Gemini : le dire, mener aux Paramètres, fichier abandonné', async () => {
    const { props } = setup({ data: { doc: emptyData(), geminiApiKey: '', patchConfig: vi.fn(), setFiscalConfig: vi.fn() } });
    const dialog = await screen.findByRole('dialog', { name: 'Fichier non importé' });
    expect(dialog.textContent).toMatch(/clé Gemini/);
    expect(dialog.textContent).toMatch(/Le fichier reçu a été effacé/);
    fireEvent.click(screen.getByRole('button', { name: 'Ouvrir « Clés et services »' }));
    expect(props.onDone).toHaveBeenCalled();
    expect(props.onOpenKeys).toHaveBeenCalled();
  });

  it('fichier introuvable (déjà lu, ou plus d’une heure)', async () => {
    take.mockResolvedValue(null);
    const { props } = setup();
    expect((await screen.findByRole('dialog', { name: 'Fichier non importé' })).textContent).toMatch(/plus disponible/);
    fireEvent.click(screen.getByRole('button', { name: 'Fermer' }));
    expect(props.onDone).toHaveBeenCalled();
  });

  it('partage refusé par le service worker : message, cache vidé, fichier jamais pris', async () => {
    window.history.replaceState({}, '', '/?partage=taille');
    setup({ marker: 'taille' });
    expect((await screen.findByRole('dialog', { name: 'Fichier non importé' })).textContent).toMatch(/15 Mo/);
    expect(take).not.toHaveBeenCalled();
    await waitFor(() => expect(discard).toHaveBeenCalled());
    expect(window.location.search).toBe('');
    cleanup();
    setup({ marker: 'type' });
    expect((await screen.findByRole('dialog')).textContent).toMatch(/PDF et les images/);
  });
});
