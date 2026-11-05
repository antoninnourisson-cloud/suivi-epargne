// @vitest-environment jsdom
// Copie locale faite quand l'app passe en arrière-plan : saisie en attente puis document caché
// (ou fermeture de la page) → copie écrite tout de suite, sans attendre les 600 ms habituelles ;
// rien en attente → aucune copie ; retour au premier plan → pas d'écriture, pas de relecture
// de Drive tant que la dernière date de moins de 30 secondes.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor, cleanup, configure } from '@testing-library/react';

configure({ asyncUtilTimeout: 5000 });

const drive = vi.hoisted(() => ({ file: null as unknown, writes: 0, metaCalls: 0 }));

vi.mock('../../services/googleDriveService', () => {
  const copy = (x: unknown) => JSON.parse(JSON.stringify(x)) as unknown;
  class ConcurrentWriteError extends Error {}
  return {
    ConcurrentWriteError,
    setOnAuthLost: () => {},
    findConfigFiles: async () => [{ id: 'file-1', modifiedTime: '2026-10-14T08:00:00.000Z', headRevisionId: '1' }],
    createConfigFile: async () => 'file-1',
    readConfigFile: async () => copy(drive.file),
    getFileRevision: async () => '1',
    getFileMeta: async () => { drive.metaCalls += 1; return { headRevisionId: '1', modifiedTime: '2026-10-14T08:00:00.000Z' }; },
    fetchRevisionContent: async () => copy(drive.file),
    updateConfigFile: async () => { drive.writes += 1; return '2'; },
    writeMonthlyBackup: async () => true,
    listBackups: async () => [],
  };
});

import { usePortfolioData } from '../usePortfolioData';
import { APP_SCHEMA_VERSION } from '../../lib/schema';

// Point du mois en cours déjà présent : l'ouverture ne modifie alors rien.
const month = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
const baseFile = () => ({
  schemaVersion: APP_SCHEMA_VERSION,
  accounts: [{ id: 'a', name: 'Livret A', institution: 'B', type: 'Livret A', totalAmount: 100, ownedAmount: 100, parentalCapital: 0, movements: [] }],
  expenses: [], history: [{ date: `${month}-01`, totalAmount: 100, ownedAmount: 100 }], expensesHistory: [{ date: `${month}-01`, total: 0 }],
  config: { grossAnnual: 30000, leisureBudget: 200, projectSavings: 0, taxRateManual: 0, extraMonthlyIncome: 0 },
});

// jsdom n'a pas d'IndexedDB : les copies locales y restent en JSON lisible (voir localVault).
const BACKUP = 'suivi_epargne_backup';
const storedCopy = () => {
  const raw = localStorage.getItem(BACKUP);
  return raw ? (JSON.parse(raw) as { data: { config: { leisureBudget: number } } }) : null;
};

const setVisibility = (state: 'hidden' | 'visible') => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
};

const load = async () => {
  const hook = renderHook(() => usePortfolioData(true));
  await act(async () => { await hook.result.current.loadDriveData(); });
  return hook;
};

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  localStorage.clear();
  drive.file = baseFile();
  drive.writes = 0;
  drive.metaCalls = 0;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  Reflect.deleteProperty(document, 'visibilityState');
});

describe('copie locale en passant en arrière-plan', () => {
  it('saisie en attente puis document caché : la copie est écrite tout de suite', async () => {
    const { result } = await load();
    act(() => result.current.patchConfig({ leisureBudget: 321 }));
    expect(storedCopy()).toBeNull(); // pas avant le délai habituel de 600 ms
    act(() => setVisibility('hidden'));
    await waitFor(() => expect(storedCopy()?.data.config.leisureBudget).toBe(321));
    expect(drive.writes).toBe(0);
  });

  it('fermeture de la page (pagehide) avec une saisie en attente : copie écrite', async () => {
    const { result } = await load();
    act(() => result.current.patchConfig({ leisureBudget: 222 }));
    act(() => { window.dispatchEvent(new Event('pagehide')); });
    await waitFor(() => expect(storedCopy()?.data.config.leisureBudget).toBe(222));
  });

  it('aucune saisie en attente : ni document caché ni pagehide ne créent de copie', async () => {
    await load();
    act(() => setVisibility('hidden'));
    act(() => { window.dispatchEvent(new Event('pagehide')); });
    await act(async () => { await vi.advanceTimersByTimeAsync(700); });
    expect(storedCopy()).toBeNull();
    expect(drive.writes).toBe(0);
  });

  it('retour au premier plan : aucune écriture ni relecture de Drive (relecture trop récente)', async () => {
    const { result } = await load();
    act(() => result.current.patchConfig({ leisureBudget: 321 }));
    act(() => setVisibility('hidden'));
    await waitFor(() => expect(storedCopy()?.data.config.leisureBudget).toBe(321));
    const metaBefore = drive.metaCalls;
    act(() => setVisibility('visible'));
    await act(async () => { await vi.advanceTimersByTimeAsync(20); });
    expect(drive.metaCalls).toBe(metaBefore);
    expect(result.current.syncConflict).toBe(false);
  });
});
