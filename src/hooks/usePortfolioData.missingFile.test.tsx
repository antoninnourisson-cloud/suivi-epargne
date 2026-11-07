// @vitest-environment jsdom
// Fichier Drive introuvable : si l'appareil garde des données (copie hors ligne, copie jamais
// envoyée), RIEN n'est créé ni écrasé et un choix est proposé ; un vrai premier démarrage
// (aucune trace) crée toujours le fichier. Chaque choix est vérifié côté « Drive ».
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor, cleanup, configure } from '@testing-library/react';

configure({ asyncUtilTimeout: 5000 });

const drive = vi.hoisted(() => ({
  files: new Map<string, { content: unknown; modifiedTime: string }>(),
  created: [] as { id: string; content: unknown }[],
  createFail: false,
}));

vi.mock('../services/googleDriveService', () => {
  const copy = (x: unknown) => JSON.parse(JSON.stringify(x)) as unknown;
  class ConflictError extends Error { constructor() { super('CONFLICT'); this.name = 'ConflictError'; } }
  class ConcurrentWriteError extends ConflictError {}
  return {
    ConflictError, ConcurrentWriteError,
    setOnAuthLost: () => {},
    findConfigFiles: async () => [...drive.files].map(([id, f]) => ({ id, modifiedTime: f.modifiedTime })),
    createConfigFile: async (data: unknown) => {
      if (drive.createFail) throw new NetworkError('Failed to fetch');
      const id = `file-new-${drive.created.length + 1}`;
      drive.created.push({ id, content: copy(data) });
      drive.files.set(id, { content: copy(data), modifiedTime: '2026-11-05T09:00:00.000Z' });
      return id;
    },
    readConfigFile: async (id: string) => copy(drive.files.get(id)?.content),
    getFileRevision: async () => '1',
    getFileMeta: async (id: string) => ({ headRevisionId: '1', modifiedTime: drive.files.get(id)?.modifiedTime ?? null }),
    fetchRevisionContent: async (id: string) => copy(drive.files.get(id)?.content),
    updateConfigFile: async (id: string, data: unknown) => { drive.files.get(id)!.content = copy(data); return '2'; },
    writeMonthlyBackup: async () => true,
    listBackups: async () => [],
  };
});

import { usePortfolioData } from './usePortfolioData';
import { APP_SCHEMA_VERSION } from '../lib/schema';
import { listSetAside } from '../services/setAsideVersions';
import { NetworkError } from '../lib/networkError';

const fileWithBudget = (leisureBudget: number) => ({
  schemaVersion: APP_SCHEMA_VERSION,
  accounts: [{ id: 'a', name: 'Livret A', institution: 'B', type: 'Livret A', totalAmount: 100, ownedAmount: 100, parentalCapital: 0, movements: [] }],
  expenses: [], history: [], expensesHistory: [],
  config: { grossAnnual: 30000, leisureBudget, projectSavings: 0, taxRateManual: 0, extraMonthlyIncome: 0 },
});
const budgetOf = (x: unknown) => (x as { config: { leisureBudget: number } }).config.leisureBudget;
const OFFLINE = 'pecule_offline_copy';
const PENDING = 'suivi_epargne_pending';

/** Un premier passage en ligne laisse la copie hors ligne de l'appareil ; l'app est ensuite rouverte. */
const withOfflineCopy = async (budget: number) => {
  drive.files.set('file-1', { content: fileWithBudget(budget), modifiedTime: '2026-11-01T08:00:00.000Z' });
  const first = renderHook(() => usePortfolioData(true));
  await act(async () => { await first.result.current.loadDriveData(); });
  await waitFor(() => expect(localStorage.getItem(OFFLINE)).not.toBeNull());
  cleanup();
  drive.files.clear(); // le fichier a disparu de Drive
  drive.created = [];
};

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  localStorage.clear();
  drive.files = new Map();
  drive.created = [];
  drive.createFail = false;
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('fichier Drive introuvable', () => {
  it('vrai premier démarrage (aucune trace sur l\'appareil) : le fichier est créé, aucun choix', async () => {
    const { result } = renderHook(() => usePortfolioData(true));
    await act(async () => { await result.current.loadDriveData(); });
    expect(drive.created).toHaveLength(1);
    expect(result.current.missingFile.getSnapshot()).toBeNull();
    expect(result.current.dataShown).toBe(true);
    expect(result.current.loadFailed).toBe(false);
  });

  it('copie hors ligne présente : aucun fichier créé, la copie n\'est pas touchée, un choix est proposé', async () => {
    await withOfflineCopy(321);
    const before = localStorage.getItem(OFFLINE);
    const { result } = renderHook(() => usePortfolioData(true));
    await act(async () => { await result.current.loadDriveData(); });
    expect(drive.created).toHaveLength(0);
    expect(result.current.missingFile.getSnapshot()?.copyAt).toEqual(expect.any(String));
    expect(result.current.dataShown).toBe(false); // jamais un tableau de bord vide présenté comme un premier démarrage
    expect(result.current.loadFailed).toBe(true); // rien n'est écrit tant qu'un choix n'est pas fait
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(drive.created).toHaveLength(0);
    expect(localStorage.getItem(OFFLINE)).toBe(before);
  });

  it('copie jamais envoyée seule (ni copie hors ligne ni fichier connu) : le choix est proposé aussi', async () => {
    localStorage.setItem(PENDING, JSON.stringify({ savedAt: '2026-11-03T10:00:00.000Z', fileId: 'file-1', data: fileWithBudget(77) }));
    const { result } = renderHook(() => usePortfolioData(true));
    await act(async () => { await result.current.loadDriveData(); });
    expect(drive.created).toHaveLength(0);
    expect(result.current.missingFile.getSnapshot()?.copyAt).toBe('2026-11-03T10:00:00.000Z');
    expect(localStorage.getItem(PENDING)).not.toBeNull();
  });

  it('« Restaurer la copie de cet appareil » : le fichier est recréé à partir d\'elle, les sauvegardes reprennent', async () => {
    await withOfflineCopy(321);
    const { result } = renderHook(() => usePortfolioData(true));
    await act(async () => { await result.current.loadDriveData(); });
    let outcome = '';
    await act(async () => { outcome = await result.current.restoreMissingFromDevice(); });
    expect(outcome).toBe('done');
    expect(drive.created).toHaveLength(1);
    expect(budgetOf(drive.created[0].content)).toBe(321);
    expect(result.current.missingFile.getSnapshot()).toBeNull();
    expect(result.current.dataShown).toBe(true);
    expect(result.current.loadFailed).toBe(false);
    expect(result.current.leisureBudget).toBe(321);
    // La saisie suivante part sur le nouveau fichier.
    act(() => result.current.patchConfig({ leisureBudget: 400 }));
    await act(async () => { await vi.advanceTimersByTimeAsync(2600); });
    await waitFor(() => expect(budgetOf(drive.files.get('file-new-1')!.content)).toBe(400));
    expect(drive.created).toHaveLength(1);
  });

  it('« Repartir de zéro » : fichier vide, et la copie de l\'appareil est mise de côté 30 jours', async () => {
    await withOfflineCopy(321);
    const { result } = renderHook(() => usePortfolioData(true));
    await act(async () => { await result.current.loadDriveData(); });
    let outcome = '';
    await act(async () => { outcome = await result.current.startOverMissing(); });
    expect(outcome).toBe('done');
    expect(drive.created).toHaveLength(1);
    expect((drive.created[0].content as { accounts: unknown[] }).accounts).toHaveLength(0);
    expect(result.current.accounts).toHaveLength(0);
    const kept = await listSetAside();
    expect(kept.map(e => budgetOf(e.data))).toEqual([321]);
  });

  it('le fichier est réapparu (sorti de la corbeille) : rien n\'est créé, il est ouvert', async () => {
    await withOfflineCopy(321);
    const { result } = renderHook(() => usePortfolioData(true));
    await act(async () => { await result.current.loadDriveData(); });
    drive.files.set('file-1', { content: fileWithBudget(500), modifiedTime: '2026-11-05T08:00:00.000Z' });
    let outcome = '';
    await act(async () => { outcome = await result.current.restoreMissingFromDevice(); });
    expect(outcome).toBe('found');
    expect(drive.created).toHaveLength(0);
    expect(result.current.missingFile.getSnapshot()).toBeNull();
    expect(result.current.leisureBudget).toBe(500);
  });

  it('création impossible (réseau) : rien n\'est changé, le choix reste affiché', async () => {
    await withOfflineCopy(321);
    const { result } = renderHook(() => usePortfolioData(true));
    await act(async () => { await result.current.loadDriveData(); });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    drive.createFail = true;
    let outcome = '';
    await act(async () => { outcome = await result.current.restoreMissingFromDevice(); });
    expect(outcome).toBe('failed');
    expect(result.current.missingFile.getSnapshot()).not.toBeNull();
    expect(result.current.dataShown).toBe(false);
    spy.mockRestore();
  });
});
