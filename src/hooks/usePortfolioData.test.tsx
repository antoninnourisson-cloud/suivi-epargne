// @vitest-environment jsdom
// Synchronisation avec Drive, testée contre un faux Drive en mémoire : pas d'écriture à
// l'ouverture, écriture après une modification, conflit détecté, fichier d'une version plus
// récente jamais écrasé, clé Gemini jamais envoyée.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const drive = vi.hoisted(() => ({
  file: null as unknown,
  revision: 1,
  writes: [] as unknown[],
  backups: [] as string[],
}));

vi.mock('../services/googleDriveService', () => {
  class ConflictError extends Error { constructor() { super('CONFLICT'); this.name = 'ConflictError'; } }
  class ApiError extends Error { status: number; constructor(m: string, s: number) { super(m); this.status = s; } }
  return {
    ConflictError, ApiError,
    setOnAuthLost: () => {},
    findConfigFile: async () => 'file-1',
    createConfigFile: async () => 'file-1',
    readConfigFile: async () => JSON.parse(JSON.stringify(drive.file)),
    getFileRevision: async () => String(drive.revision),
    updateConfigFile: async (_id: string, data: unknown, expected?: string | null) => {
      if (expected != null && expected !== String(drive.revision)) throw new ConflictError();
      drive.file = JSON.parse(JSON.stringify(data));
      drive.writes.push(drive.file);
      drive.revision += 1;
      return String(drive.revision);
    },
    sendGmail: async () => {},
    writeMonthlyBackup: async (month: string) => { drive.backups.push(month); return true; },
    listBackups: async () => [],
  };
});

import { usePortfolioData } from './usePortfolioData';
import { APP_SCHEMA_VERSION } from '../lib/schema';

const baseFile = () => ({
  schemaVersion: APP_SCHEMA_VERSION,
  accounts: [{ id: 'a', name: 'Livret A', institution: 'B', type: 'Livret A', totalAmount: 100, ownedAmount: 100, parentalCapital: 0, movements: [] }],
  expenses: [], history: [{ date: `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-01`, totalAmount: 100, ownedAmount: 100 }],
  expensesHistory: [{ date: `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-01`, total: 0 }],
  config: { grossAnnual: 30000, leisureBudget: 200, projectSavings: 0, taxRateManual: 0, extraMonthlyIncome: 0, parentsEmail: '' },
});

const load = async () => {
  const hook = renderHook(() => usePortfolioData(true));
  await act(async () => { await hook.result.current.loadDriveData(); });
  return hook;
};
const flushSave = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(2600); }); };

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  localStorage.clear();
  drive.file = baseFile();
  drive.revision = 1;
  drive.writes = [];
  drive.backups = [];
});
afterEach(() => { vi.useRealTimers(); });

describe('synchronisation Drive', () => {
  it("n'écrit rien à l'ouverture si rien n'a changé", async () => {
    const { result } = await load();
    expect(result.current.accounts).toHaveLength(1);
    await flushSave();
    expect(drive.writes).toHaveLength(0);
  });

  it('écrit après une modification, avec la version du format et sans clé Gemini', async () => {
    const { result } = await load();
    act(() => { result.current.setGeminiApiKey('secret-key'); result.current.setLeisureBudget(321); });
    await flushSave();
    await waitFor(() => expect(drive.writes.length).toBe(1));
    const written = drive.writes[0] as { schemaVersion: number; config: Record<string, unknown> };
    expect(written.schemaVersion).toBe(APP_SCHEMA_VERSION);
    expect(written.config.leisureBudget).toBe(321);
    expect(written.config.geminiApiKey).toBeUndefined();
    expect(localStorage.getItem('gemini_api_key')).toBe('secret-key');
    expect(drive.backups).toHaveLength(1);
  });

  it('garde les champs inconnus du fichier', async () => {
    drive.file = { ...baseFile(), futureFeature: { x: 1 } };
    const { result } = await load();
    act(() => result.current.setLeisureBudget(999));
    await flushSave();
    await waitFor(() => expect(drive.writes.length).toBe(1));
    expect((drive.writes[0] as Record<string, unknown>).futureFeature).toEqual({ x: 1 });
  });

  it("signale un conflit au lieu d'écraser une écriture d'un autre appareil", async () => {
    const { result } = await load();
    drive.revision = 99; // un autre appareil a écrit
    act(() => result.current.setLeisureBudget(5));
    await flushSave();
    await waitFor(() => expect(result.current.syncConflict).toBe(true));
    expect(drive.writes).toHaveLength(0);
  });

  it("ne réécrit jamais un fichier venant d'une version plus récente de l'app", async () => {
    drive.file = { ...baseFile(), schemaVersion: APP_SCHEMA_VERSION + 1 };
    const { result } = await load();
    expect(result.current.appOutdated).toBe(true);
    act(() => result.current.setLeisureBudget(5));
    await flushSave();
    expect(drive.writes).toHaveLength(0);
  });

  it("retire la clé Gemini d'un ancien fichier et la garde sur l'appareil", async () => {
    drive.file = { ...baseFile(), config: { ...baseFile().config, geminiApiKey: 'old-key' } };
    const { result } = await load();
    expect(result.current.geminiApiKey).toBe('old-key');
    await flushSave();
    await waitFor(() => expect(drive.writes.length).toBe(1));
    expect((drive.writes[0] as { config: Record<string, unknown> }).config.geminiApiKey).toBeUndefined();
  });

  it("refuse un import invalide et ne reprend jamais l'adresse des parents d'un fichier", async () => {
    drive.file = { ...baseFile(), config: { ...baseFile().config, parentsEmail: 'parents@exemple.fr' } };
    const { result } = await load();
    const bad = new File(['{"accounts": "nope"}'], 'x.json');
    let ok = true;
    await act(async () => { ok = await result.current.importData(bad); });
    expect(ok).toBe(false);
    const evil = new File([JSON.stringify({ ...baseFile(), config: { ...baseFile().config, parentsEmail: 'pirate@exemple.com' } })], 'y.json');
    await act(async () => { ok = await result.current.importData(evil); });
    expect(ok).toBe(true);
    expect(result.current.parentsEmail).toBe('parents@exemple.fr');
  });
});
