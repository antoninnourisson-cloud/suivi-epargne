// @vitest-environment jsdom
// Synchronisation avec Drive, testée contre un faux Drive en mémoire : pas d'écriture à
// l'ouverture, écriture après une modification, conflit détecté, fichier d'une version plus
// récente jamais écrasé, clé Gemini jamais envoyée.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor, cleanup, configure } from '@testing-library/react';

// Machine lente (couverture, réveil de veille) : on laisse plus d'une seconde aux attentes.
configure({ asyncUtilTimeout: 5000 });

const drive = vi.hoisted(() => ({
  file: null as unknown,
  revision: 1,
  writes: [] as unknown[],
  backups: [] as string[],
  // Historique des révisions (contenu de chacune), pour la vérification après écriture.
  history: new Map<string, unknown>(),
  // Écriture d'un autre appareil qui tombe entre notre contrôle de révision et notre PATCH.
  beforeWrite: null as (() => void) | null,
  // La version de l'autre appareil ne peut pas être relue au moment du conflit.
  otherUnreadable: false,
}));

const remoteWrite = (data: unknown) => {
  drive.file = JSON.parse(JSON.stringify(data));
  drive.revision += 1;
  drive.history.set(String(drive.revision), drive.file);
};

vi.mock('../services/googleDriveService', () => {
  class ConflictError extends Error { constructor() { super('CONFLICT'); this.name = 'ConflictError'; } }
  class ConcurrentWriteError extends ConflictError {
    ourRevisionId: string; otherRevisionId: string; otherContent: unknown;
    constructor(ours: string, other: string, content: unknown) {
      super(); this.ourRevisionId = ours; this.otherRevisionId = other; this.otherContent = content;
    }
  }
  class ApiError extends Error { status: number; constructor(m: string, s: number) { super(m); this.status = s; } }
  const copy = (x: unknown) => JSON.parse(JSON.stringify(x)) as unknown;
  return {
    ConflictError, ConcurrentWriteError, ApiError,
    setOnAuthLost: () => {},
    findConfigFile: async () => 'file-1',
    createConfigFile: async () => 'file-1',
    readConfigFile: async () => copy(drive.file),
    getFileRevision: async () => String(drive.revision),
    fetchRevisionContent: async (_id: string, rev: string) => {
      if (!drive.history.has(rev)) throw new Error('REVISION_GONE');
      return copy(drive.history.get(rev));
    },
    // Même contrat que le vrai service : contrôle, écriture, puis vérification que la
    // révision précédant la nôtre est bien celle attendue.
    updateConfigFile: async (_id: string, data: unknown, expected?: string | null) => {
      if (expected != null && expected !== String(drive.revision)) throw new ConflictError();
      drive.beforeWrite?.();
      drive.beforeWrite = null;
      const previous = String(drive.revision);
      drive.file = copy(data);
      drive.writes.push(drive.file);
      drive.revision += 1;
      drive.history.set(String(drive.revision), drive.file);
      const ours = String(drive.revision);
      if (expected != null && previous !== expected) {
        throw new ConcurrentWriteError(ours, previous, drive.otherUnreadable ? undefined : copy(drive.history.get(previous)));
      }
      return ours;
    },
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
  config: { grossAnnual: 30000, leisureBudget: 200, projectSavings: 0, taxRateManual: 0, extraMonthlyIncome: 0 },
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
  drive.history = new Map([['1', drive.file]]);
  drive.beforeWrite = null;
  drive.otherUnreadable = false;
});
// Chaque test démonte son hook (écouteurs, minuteries) avant de rendre les vraies horloges.
afterEach(() => { cleanup(); vi.useRealTimers(); });

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

  it('sans course : une seule écriture, pas de conflit', async () => {
    const { result } = await load();
    act(() => result.current.setLeisureBudget(5));
    await flushSave();
    await waitFor(() => expect(drive.writes.length).toBe(1));
    await flushSave();
    expect(drive.writes).toHaveLength(1);
    expect(result.current.syncConflict).toBe(false);
  });

  describe('écriture concurrente entre le contrôle et le PATCH', () => {
    const theirs = () => ({ ...baseFile(), config: { ...baseFile().config, leisureBudget: 777 } });
    const budgetOf = (x: unknown) => (x as { config: { leisureBudget: number } }).config.leisureBudget;

    it("lève le conflit sans rien perdre ni réécrire, puis « Garder mes modifications » garde la mienne", async () => {
      const { result } = await load();
      drive.beforeWrite = () => remoteWrite(theirs());
      act(() => result.current.setLeisureBudget(5));
      await flushSave();
      await waitFor(() => expect(result.current.syncConflict).toBe(true));
      // Les deux versions sont récupérables : la mienne à l'écran et en tête de Drive,
      // la sienne dans la révision précédente et dans la quarantaine locale.
      expect(result.current.leisureBudget).toBe(5);
      expect(budgetOf(drive.file)).toBe(5);
      expect(budgetOf(drive.history.get('2'))).toBe(777);
      await waitFor(() => expect(localStorage.getItem('suivi_epargne_pending')).not.toBeNull());
      // Aucune réécriture automatique pendant le conflit.
      await flushSave();
      expect(drive.writes).toHaveLength(1);

      await act(async () => { await result.current.forceSaveToDrive(); });
      expect(result.current.syncConflict).toBe(false);
      expect(budgetOf(drive.file)).toBe(5);
      expect(localStorage.getItem('suivi_epargne_pending')).toBeNull();
    });

    it("« Recharger l'autre version » applique la sienne et la réécrit en tête, vérifiée", async () => {
      const { result } = await load();
      drive.beforeWrite = () => remoteWrite(theirs());
      act(() => result.current.setLeisureBudget(5));
      await flushSave();
      await waitFor(() => expect(result.current.syncConflict).toBe(true));

      await act(async () => { result.current.reloadFromDrive(); });
      await waitFor(() => expect(result.current.leisureBudget).toBe(777));
      expect(result.current.syncConflict).toBe(false);
      await flushSave();
      await waitFor(() => expect(budgetOf(drive.file)).toBe(777));
      expect(result.current.syncConflict).toBe(false);
    });

    it("version de l'autre appareil illisible sur le moment : conflit levé, relue au choix de l'utilisateur", async () => {
      const { result } = await load();
      drive.otherUnreadable = true;
      drive.beforeWrite = () => remoteWrite(theirs());
      act(() => result.current.setLeisureBudget(5));
      await flushSave();
      await waitFor(() => expect(result.current.syncConflict).toBe(true));
      expect(result.current.leisureBudget).toBe(5);

      await act(async () => { result.current.reloadFromDrive(); });
      await waitFor(() => expect(result.current.leisureBudget).toBe(777));
      expect(result.current.syncConflict).toBe(false);
    });

    it('si la relecture échoue, le conflit reste ouvert et rien n’est écrasé', async () => {
      const { result } = await load();
      drive.otherUnreadable = true;
      drive.beforeWrite = () => remoteWrite(theirs());
      act(() => result.current.setLeisureBudget(5));
      await flushSave();
      await waitFor(() => expect(result.current.syncConflict).toBe(true));
      drive.history.delete('2');
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      await act(async () => { result.current.reloadFromDrive(); });
      await waitFor(() => expect(result.current.syncError).toBe(true));
      spy.mockRestore();
      expect(result.current.syncConflict).toBe(true);
      expect(result.current.leisureBudget).toBe(5);
      expect(drive.writes).toHaveLength(1);
    });
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

  it('refuse un import invalide et accepte un fichier valide', async () => {
    const { result } = await load();
    const bad = new File(['{"accounts": "nope"}'], 'x.json');
    let ok = true;
    await act(async () => { ok = await result.current.importData(bad); });
    expect(ok).toBe(false);
    const good = new File([JSON.stringify({ ...baseFile(), config: { ...baseFile().config, leisureBudget: 444 } })], 'y.json');
    await act(async () => { ok = await result.current.importData(good); });
    expect(ok).toBe(true);
    expect(result.current.leisureBudget).toBe(444);
  });

  it("lit un ancien fichier (adresse des parents, restitution « emailed ») sans réécrire ni perdre ces champs", async () => {
    const restitution = { done: { date: '2027-01-01', accounts: [], interestsOffered: [], emailed: true } };
    drive.file = { ...baseFile(), parentalRestitution: restitution, config: { ...baseFile().config, parentsEmail: 'parents@exemple.fr' } };
    const { result } = await load();
    await flushSave();
    expect(drive.writes).toHaveLength(0);
    act(() => result.current.setLeisureBudget(321));
    await flushSave();
    await waitFor(() => expect(drive.writes.length).toBe(1));
    const written = drive.writes[0] as { config: Record<string, unknown>; parentalRestitution: unknown };
    expect(written.config.parentsEmail).toBe('parents@exemple.fr');
    expect(written.parentalRestitution).toEqual(restitution);
  });
});

describe('virement interne lié', () => {
  const twoAccounts = () => ({
    ...baseFile(),
    accounts: [
      { id: 'a', name: 'Livret A', institution: 'B', type: 'Livret A', totalAmount: 1000, ownedAmount: 300, parentalCapital: 700, movements: [] },
      { id: 'b', name: 'LDDS', institution: 'B', type: 'LDDS', totalAmount: 0, ownedAmount: 0, parentalCapital: 0, movements: [] },
    ],
  });

  it('déplace la part propre et garde les totaux', async () => {
    drive.file = twoAccounts();
    const { result } = await load();
    let ok = false;
    act(() => { ok = result.current.executeLinkedTransfer('a', 'b', 300, '2026-10-02'); });
    expect(ok).toBe(true);
    const [a, b] = result.current.accounts;
    expect(a.ownedAmount).toBe(0); expect(a.parentalCapital).toBe(700); expect(a.totalAmount).toBe(700);
    expect(b.ownedAmount).toBe(300); expect(b.totalAmount).toBe(300);
  });

  it("refuse un virement qui entamerait la part des parents, sans rien modifier", async () => {
    drive.file = twoAccounts();
    const { result } = await load();
    let ok = true;
    act(() => { ok = result.current.executeLinkedTransfer('a', 'b', 301, '2026-10-02'); });
    expect(ok).toBe(false);
    expect(result.current.accounts[0].ownedAmount).toBe(300);
    expect(result.current.accounts[1].ownedAmount).toBe(0);
  });
});
