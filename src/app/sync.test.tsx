// @vitest-environment jsdom
// Bannières et fenêtres de la synchronisation, et valeurs calculées pour les écrans.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { initialSyncStatus, syncReducer } from '../lib/sync/syncStatus';
import { syncErrorText } from '../lib/syncErrors';
import { migrate } from '../lib/schema';
import { DEMO_DATA } from '../dev/demoData';
import { SyncBanners, useSyncToasts } from './SyncBanners';
import { SyncDialogsHost, useSyncDialogs } from './SyncDialogs';
import { useDerivedData } from './useDerivedData';
import { computeIncome } from '../lib/finance';

afterEach(() => cleanup());

const callbacks = () => ({
  retrySync: vi.fn(), dismissDuplicate: vi.fn(), compareDuplicate: vi.fn(), restoreLocalBackup: vi.fn(), dismissLocalBackup: vi.fn(), dismissUnreadableCopy: vi.fn(),
});
const quiet = {
  offlineDataAt: null, isOffline: false, isLoadingData: false, dataShown: true, appOutdated: false, sessionExpired: false,
  syncConflict: false, duplicateFile: null, syncError: false, syncErrorInfo: null, loadFailed: false, localBackup: null, unreadableLocalCopy: null,
};

describe('bannières de synchronisation', () => {
  it('rien à signaler : aucune bannière', () => {
    const { container } = render(<SyncBanners data={{ ...quiet, ...callbacks() }} onReconnect={() => {}} onOpenConflict={() => {}} />);
    expect(container.textContent).toBe('');
  });

  it('session expirée, choix en attente, doublon, copie locale : chaque bouton fait ce qu’il dit', () => {
    const cb = callbacks();
    const onReconnect = vi.fn();
    const onOpenConflict = vi.fn();
    render(<SyncBanners data={{
      ...quiet, ...cb, sessionExpired: true, syncConflict: true, appOutdated: true,
      localBackup: { savedAt: '2026-10-19T08:00:00.000Z', data: migrate({}) },
    }} onReconnect={onReconnect} onOpenConflict={onOpenConflict} />);
    fireEvent.click(screen.getByRole('button', { name: 'Se reconnecter' }));
    expect(onReconnect).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Comparer et choisir' }));
    expect(onOpenConflict).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/version plus récente de Pécule/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Restaurer cette sauvegarde' }));
    expect(cb.restoreLocalBackup).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Ignorer' }));
    expect(cb.dismissLocalBackup).toHaveBeenCalled();
    // Pendant un conflit, le doublon et l'erreur ne s'ajoutent pas.
    expect(screen.queryByText(/Un autre fichier de données/)).toBeNull();
  });

  it('doublon : « Comparer » ouvre l’écran de choix, « Ignorer » le fait taire', () => {
    const cb = callbacks();
    const onOpenConflict = vi.fn();
    render(<SyncBanners data={{ ...quiet, ...cb, duplicateFile: { id: 'f2', modifiedTime: '2026-10-01T10:00:00.000Z' } }} onReconnect={() => {}} onOpenConflict={onOpenConflict} />);
    expect(screen.getByText(/modifié le 1 octobre 2026/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Comparer' }));
    expect(cb.compareDuplicate).toHaveBeenCalled();
    expect(onOpenConflict).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Ignorer' }));
    expect(cb.dismissDuplicate).toHaveBeenCalled();
  });

  it('erreur : message du chargement ou de la sauvegarde, et « Réessayer »', () => {
    const cb = callbacks();
    const info = { reason: 'quota' as const, transient: false };
    const { rerender } = render(<SyncBanners data={{ ...quiet, ...cb, syncError: true, syncErrorInfo: info }} onReconnect={() => {}} onOpenConflict={() => {}} />);
    expect(screen.getByText(syncErrorText('save', 'quota'))).toBeTruthy();
    rerender(<SyncBanners data={{ ...quiet, ...cb, syncError: true, syncErrorInfo: info, loadFailed: true }} onReconnect={() => {}} onOpenConflict={() => {}} />);
    expect(screen.getByText(syncErrorText('load', 'quota'))).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(cb.retrySync).toHaveBeenCalled();
  });

  it('copie locale illisible : signalée, perdue ou pour l’instant, et « Compris » la fait taire', () => {
    const cb = callbacks();
    const { rerender } = render(<SyncBanners data={{ ...quiet, ...cb, unreadableLocalCopy: 'lost' }} onReconnect={() => {}} onOpenConflict={() => {}} />);
    expect(screen.getByRole('alert').textContent).toMatch(/ne peuvent pas être récupérées/);
    fireEvent.click(screen.getByRole('button', { name: 'Compris' }));
    expect(cb.dismissUnreadableCopy).toHaveBeenCalled();
    rerender(<SyncBanners data={{ ...quiet, ...cb, unreadableLocalCopy: 'unavailable' }} onReconnect={() => {}} onOpenConflict={() => {}} />);
    expect(screen.getByRole('alert').textContent).toMatch(/pour l’instant|pour l'instant/);
  });

  it('hors ligne : copie hors ligne datée, ou simple rappel', () => {
    const cb = callbacks();
    const { rerender } = render(<SyncBanners data={{ ...quiet, ...cb, offlineDataAt: '2026-10-18T19:04:00.000Z', isOffline: true }} onReconnect={() => {}} onOpenConflict={() => {}} />);
    expect(screen.getByText(/Hors ligne : données du/)).toBeTruthy();
    rerender(<SyncBanners data={{ ...quiet, ...cb, isOffline: true }} onReconnect={() => {}} onOpenConflict={() => {}} />);
    expect(screen.getByText(/partiront sur Drive dès que possible/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(cb.retrySync).toHaveBeenCalled();
  });
});

describe('toasts de la synchronisation', () => {
  it('« Enregistré » à chaque écriture confirmée, pas pour la valeur du montage', () => {
    const addToast = vi.fn(() => 'id');
    const { rerender } = renderHook(({ saved, remote }) => useSyncToasts(saved, remote, addToast), { initialProps: { saved: new Date(1) as Date | null, remote: null as number | null } });
    expect(addToast).not.toHaveBeenCalled();
    rerender({ saved: new Date(2), remote: null });
    expect(addToast).toHaveBeenCalledWith({ message: 'Enregistré', kind: 'success', durationMs: 1500 });
    rerender({ saved: new Date(2), remote: 5 });
    expect(addToast).toHaveBeenLastCalledWith({ message: 'Données mises à jour depuis un autre appareil', kind: 'info' });
    expect(addToast).toHaveBeenCalledTimes(2);
  });
});

describe('fenêtres de la synchronisation', () => {
  it('un conflit ouvre l’écran de choix ; il se ferme quand il n’y a plus rien à choisir', () => {
    const { result, rerender } = renderHook(({ conflict, view }) => useSyncDialogs(conflict, view), { initialProps: { conflict: false, view: false } });
    expect(result.current.conflictOpen).toBe(false);
    rerender({ conflict: true, view: true });
    expect(result.current.conflictOpen).toBe(true);
    act(() => result.current.closeConflict());
    expect(result.current.conflictOpen).toBe(false);
    act(() => result.current.openConflict());
    rerender({ conflict: false, view: false });
    expect(result.current.conflictOpen).toBe(false);
    act(() => result.current.openLogout());
    expect(result.current.logoutOpen).toBe(true);
    act(() => result.current.closeLogout());
    expect(result.current.logoutOpen).toBe(false);
  });

  const dialogData = (status = initialSyncStatus(true)) => ({
    conflict: null, syncStatus: status, syncConflict: false, localBackup: null,
    closeDuplicateComparison: vi.fn(), resolveConflict: vi.fn(), retryConflictLoad: vi.fn(), flushPendingChanges: vi.fn(async () => true),
  });
  const dialogs = (logoutOpen: boolean) => ({ conflictOpen: false, openConflict: vi.fn(), closeConflict: vi.fn(), logoutOpen, openLogout: vi.fn(), closeLogout: vi.fn() });

  it('déconnexion hors ligne : l’envoi est grisé et la raison est dite', async () => {
    const offline = syncReducer(initialSyncStatus(true), { type: 'offline' });
    const onLogout = vi.fn(async () => {});
    const d = dialogs(true);
    render(<SyncDialogsHost data={dialogData(offline)} dialogs={d} addToast={vi.fn(() => 'id')} onLogout={onLogout} />);
    expect(await screen.findByText('Vous êtes hors ligne ou Drive est injoignable pour le moment.')).toBeTruthy();
    expect((screen.getByRole('button', { name: /Envoyer puis se déconnecter/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Se déconnecter sans envoyer' }));
    expect(d.closeLogout).toHaveBeenCalled();
    await vi.waitFor(() => expect(onLogout).toHaveBeenCalledWith({ discardUnsynced: true }));
  });

  it('rien ne bloque : l’envoi est possible', async () => {
    render(<SyncDialogsHost data={dialogData()} dialogs={dialogs(true)} addToast={vi.fn(() => 'id')} onLogout={vi.fn(async () => {})} />);
    const send = await screen.findByRole('button', { name: /Envoyer puis se déconnecter/ });
    expect((send as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('valeurs calculées pour les écrans', () => {
  it('calculées une fois par document, stables tant qu’il ne change pas', () => {
    const doc = migrate(DEMO_DATA);
    const { result, rerender } = renderHook(({ d }) => useDerivedData(d, d), { initialProps: { d: doc } });
    const first = result.current;
    expect(first.monthPlan).toBeGreaterThan(0);
    expect(first.monthlyPay).toBeGreaterThan(0);
    expect(first.taxEstimate?.taxDue).toBeGreaterThanOrEqual(0);
    expect(first.allCharges.length).toBeGreaterThanOrEqual(doc.expenses.length);
    expect(first.showParentalScreen).toBe(first.hasParental || !!doc.parentalRestitution?.done);
    rerender({ d: doc });
    expect(result.current).toBe(first);
    const changed = { ...doc, config: { ...doc.config, paydayAmount: 123 } };
    rerender({ d: changed });
    expect(result.current.monthPlan).toBe(123);
  });

  it('l’impôt estimé (dons, aide à la déclaration) compte l’autre salaire, comme le Pilotage', () => {
    const doc = migrate(DEMO_DATA);
    const withExtra = { ...doc, config: { ...doc.config, grossAnnual: 40_000, taxRateManual: 0, extraMonthlyIncome: 0 } };
    const { result, rerender } = renderHook(({ d }) => useDerivedData(d, d), { initialProps: { d: withExtra } });
    const without = result.current.taxEstimate!;
    const next = { ...withExtra, config: { ...withExtra.config, extraMonthlyIncome: 800 } };
    rerender({ d: next });
    const withSecond = result.current.taxEstimate!;
    const pilot = computeIncome({ grossAnnual: 40_000, taxRateManual: 0, extraMonthlyIncome: 800 }, next.fiscalConfig, next.workBenefits);
    expect(withSecond.taxDue).toBeCloseTo(pilot.taxAmount, 9);
    expect(withSecond.taxableIncome).toBeCloseTo(pilot.netTaxableYear, 9);
    expect(withSecond.beforeAllowance).toBeCloseTo(pilot.netTaxableBeforeAllowance, 9);
    expect(withSecond.taxDue).toBeGreaterThan(without.taxDue);
    expect(withSecond.beforeAllowance).toBeGreaterThan(without.beforeAllowance + 800 * 12);
  });

  it('une estimation par année de revenus : l’an passé suit ses propres règles (transport)', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2027, 3, 15));
    try {
      const doc = migrate(DEMO_DATA);
      const navigo = { active: true, basePrice: 90.8, refundRate: 67.24 };
      const d = { ...doc, config: { ...doc.config, grossAnnual: 32_000, taxRateManual: 0, extraMonthlyIncome: 0 }, workBenefits: { ...doc.workBenefits, navigo } };
      const { result } = renderHook(() => useDerivedData(d, d));
      const { taxEstimate, taxEstimates } = result.current;
      expect(Object.keys(taxEstimates!).map(Number).sort()).toEqual([2026, 2027]);
      expect(taxEstimate).toBe(taxEstimates![2027]);
      // Revenus 2026 : remboursement exonéré jusqu'à 75 % ; revenus 2027 : 50 %, 15,65 € par mois imposables.
      const input = { grossAnnual: 32_000, taxRateManual: 0, extraMonthlyIncome: 0 };
      expect(taxEstimates![2026].beforeAllowance).toBeCloseTo(computeIncome(input, d.fiscalConfig, d.workBenefits, 2026).netTaxableBeforeAllowance, 9);
      expect(taxEstimates![2027].beforeAllowance - taxEstimates![2026].beforeAllowance).toBeCloseTo(187.85, 2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('sans salaire : pas d’impôt estimé ; mode solo : pas d’écran Part parentale', () => {
    const doc = migrate({ accounts: [{ id: 'a', name: 'A', type: 'Livret A', totalAmount: 10, ownedAmount: 10, parentalCapital: 0 }], config: { grossAnnual: 0 } });
    const { result } = renderHook(() => useDerivedData(doc, doc));
    expect(result.current.taxEstimate).toBeUndefined();
    expect(result.current.hasParental).toBe(false);
    expect(result.current.showParentalScreen).toBe(false);
    expect(result.current.restitutionInMonths).toBeUndefined();
  });
});
