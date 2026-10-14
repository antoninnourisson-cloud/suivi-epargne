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
  // Pannes : lecture du fichier en échec, prochaine écriture en échec, écriture lente.
  readFail: null as unknown,
  writeFail: null as unknown,
  writeGate: null as Promise<void> | null,
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
    readConfigFile: async () => {
      if (drive.readFail) throw drive.readFail;
      return copy(drive.file);
    },
    getFileRevision: async () => String(drive.revision),
    fetchRevisionContent: async (_id: string, rev: string) => {
      if (!drive.history.has(rev)) throw new Error('REVISION_GONE');
      return copy(drive.history.get(rev));
    },
    // Même contrat que le vrai service : contrôle, écriture, puis vérification que la
    // révision précédant la nôtre est bien celle attendue.
    updateConfigFile: async (_id: string, data: unknown, expected?: string | null) => {
      if (drive.writeFail) { const err = drive.writeFail; drive.writeFail = null; throw err; }
      if (drive.writeGate) await drive.writeGate;
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
  drive.readFail = null;
  drive.writeFail = null;
  drive.writeGate = null;
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

const budgetOfFile = (x: unknown) => (x as { config: { leisureBudget: number } }).config.leisureBudget;
const withBudget = (leisureBudget: number) => ({ ...baseFile(), config: { ...baseFile().config, leisureBudget } });
// jsdom n'a pas d'IndexedDB : les copies locales y restent en JSON lisible (voir localVault).
const storedCopy = (key: string) => {
  const raw = localStorage.getItem(key);
  return raw ? (JSON.parse(raw) as { savedAt: string; data: unknown }) : null;
};
const PENDING = 'suivi_epargne_pending';
const BACKUP = 'suivi_epargne_backup';

describe('chargement raté', () => {
  it("« Réessayer » recharge au lieu d'écraser Drive avec un document vide", async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    drive.readFail = new Error('HTTP 503');
    const { result } = await load();
    expect(result.current.loadFailed).toBe(true);
    expect(result.current.syncError).toBe(true);
    expect(result.current.accounts).toHaveLength(0);

    // Ni l'écriture forcée, ni « Réessayer » n'écrivent quoi que ce soit.
    await act(async () => { await result.current.forceSaveToDrive(); });
    await act(async () => { result.current.retrySync(); await vi.advanceTimersByTimeAsync(10); });
    await flushSave();
    expect(drive.writes).toHaveLength(0);

    drive.readFail = null;
    await act(async () => { result.current.retrySync(); await vi.advanceTimersByTimeAsync(10); });
    await waitFor(() => expect(result.current.accounts).toHaveLength(1));
    expect(result.current.loadFailed).toBe(false);
    expect(result.current.syncError).toBe(false);
    await flushSave();
    expect(drive.writes).toHaveLength(0);
    spy.mockRestore();
  });

  it('le chargement est retenté tout seul', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    drive.readFail = new TypeError('NETWORK_TIMEOUT');
    const { result } = await load();
    expect(result.current.loadFailed).toBe(true);
    drive.readFail = null;
    await act(async () => { await vi.advanceTimersByTimeAsync(5500); });
    await waitFor(() => expect(result.current.accounts).toHaveLength(1));
    expect(drive.writes).toHaveLength(0);
    spy.mockRestore();
  });

  it("un fichier à l'historique ou aux réglages abîmés se charge quand même", async () => {
    drive.file = { ...baseFile(), history: [{}, null, { date: 1 }], fiscalConfig: { taxBrackets: 'x' }, workBenefits: { navigo: null } };
    const { result } = await load();
    expect(result.current.loadFailed).toBe(false);
    expect(result.current.accounts).toHaveLength(1);
    expect(result.current.fiscalConfig.taxBrackets.length).toBeGreaterThan(0);
    expect(result.current.workBenefits.navigo.active).toBe(true);
  });
});

describe('déconnexion', () => {
  it('signale les modifications pas encore sur Drive et en garde une copie, proposée à la reconnexion', async () => {
    const first = await load();
    expect(first.result.current.hasUnsyncedChanges()).toBe(false);
    act(() => first.result.current.setLeisureBudget(321));
    expect(first.result.current.hasUnsyncedChanges()).toBe(true);
    act(() => first.result.current.resetData());
    await waitFor(() => expect(storedCopy(BACKUP)).not.toBeNull());
    expect(budgetOfFile(storedCopy(BACKUP)!.data)).toBe(321);
    expect(drive.writes).toHaveLength(0);
    first.unmount();

    const second = await load();
    await waitFor(() => expect(second.result.current.localBackup).not.toBeNull());
    expect(budgetOfFile(second.result.current.localBackup!.data)).toBe(321);
  });

  it('plus rien à signaler une fois la sauvegarde faite', async () => {
    const { result } = await load();
    act(() => result.current.setLeisureBudget(321));
    await flushSave();
    await waitFor(() => expect(drive.writes.length).toBe(1));
    expect(result.current.hasUnsyncedChanges()).toBe(false);
  });
});

describe('réseau', () => {
  it("un délai dépassé n'arrête pas la synchronisation : nouvel essai sans événement « online »", async () => {
    const { result } = await load();
    drive.writeFail = new TypeError('NETWORK_TIMEOUT');
    act(() => result.current.setLeisureBudget(5));
    await flushSave();
    await waitFor(() => expect(result.current.isOffline).toBe(true));
    expect(drive.writes).toHaveLength(0);
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    await flushSave();
    await waitFor(() => expect(drive.writes.length).toBe(1));
    expect(result.current.isOffline).toBe(false);
    expect(budgetOfFile(drive.file)).toBe(5);
  });

  it('« Réessayer » et le retour au premier plan relancent tout de suite', async () => {
    const { result } = await load();
    drive.writeFail = new TypeError('Failed to fetch');
    act(() => result.current.setLeisureBudget(5));
    await flushSave();
    await waitFor(() => expect(result.current.isOffline).toBe(true));
    act(() => { window.dispatchEvent(new Event('focus')); });
    await flushSave();
    await waitFor(() => expect(drive.writes.length).toBe(1));
    expect(result.current.isOffline).toBe(false);
  });
});

describe('plusieurs onglets', () => {
  const announce = async () => {
    await act(async () => {
      window.dispatchEvent(new StorageEvent('storage', {
        key: 'suivi_epargne_last_save', newValue: JSON.stringify({ fileId: 'file-1', revision: String(drive.revision), at: Date.now() }),
      }));
      await vi.advanceTimersByTimeAsync(20);
    });
  };

  it("applique la sauvegarde d'un autre onglet quand rien n'est en attente", async () => {
    const { result } = await load();
    remoteWrite(withBudget(300));
    await announce();
    await waitFor(() => expect(result.current.leisureBudget).toBe(300));
    await flushSave();
    expect(drive.writes).toHaveLength(0);
  });

  it("n'efface pas des modifications non envoyées : la prochaine écriture lève le conflit, la nôtre en quarantaine", async () => {
    const { result } = await load();
    act(() => { window.dispatchEvent(new Event('offline')); });
    act(() => result.current.setLeisureBudget(150));
    remoteWrite(withBudget(300));
    await announce();
    expect(result.current.leisureBudget).toBe(150);

    act(() => { window.dispatchEvent(new Event('online')); });
    await flushSave();
    await waitFor(() => expect(result.current.syncConflict).toBe(true));
    expect(drive.writes).toHaveLength(0);
    expect(budgetOfFile(drive.file)).toBe(300);
    expect(result.current.leisureBudget).toBe(150);
    await waitFor(() => expect(storedCopy(PENDING)).not.toBeNull());
    expect(budgetOfFile(storedCopy(PENDING)!.data)).toBe(150);
  });

  it("pendant un conflit, la sauvegarde d'un autre onglet n'est pas appliquée", async () => {
    const { result } = await load();
    drive.revision = 99; // un autre appareil a écrit
    act(() => result.current.setLeisureBudget(5));
    await flushSave();
    await waitFor(() => expect(result.current.syncConflict).toBe(true));
    remoteWrite(withBudget(300));
    await announce();
    expect(result.current.leisureBudget).toBe(5);
  });

  it("un autre onglet écrit dans un format plus récent : lecture seule, rien n'est réécrit", async () => {
    const { result } = await load();
    remoteWrite({ ...withBudget(300), schemaVersion: APP_SCHEMA_VERSION + 1 });
    await announce();
    await waitFor(() => expect(result.current.appOutdated).toBe(true));
    act(() => result.current.setLeisureBudget(5));
    await flushSave();
    expect(drive.writes).toHaveLength(0);
  });
});

describe('copies locales', () => {
  it("garde le miroir d'une saisie faite pendant une écriture lente", async () => {
    const { result } = await load();
    let release = () => {};
    drive.writeGate = new Promise<void>(r => { release = r; });
    act(() => result.current.setLeisureBudget(150));
    await flushSave(); // écriture de 150 en cours, bloquée
    act(() => result.current.setLeisureBudget(175));
    await act(async () => { await vi.advanceTimersByTimeAsync(700); });
    await waitFor(() => expect(storedCopy(BACKUP)).not.toBeNull());

    await act(async () => { drive.writeGate = null; release(); await vi.advanceTimersByTimeAsync(10); });
    await waitFor(() => expect(drive.writes.length).toBe(1));
    expect(budgetOfFile(drive.file)).toBe(150);
    // 175 n'est pas encore sur Drive : son miroir reste.
    await waitFor(() => expect(budgetOfFile(storedCopy(BACKUP)?.data ?? withBudget(-1))).toBe(175));

    await flushSave();
    await waitFor(() => expect(budgetOfFile(drive.file)).toBe(175));
    await waitFor(() => expect(storedCopy(BACKUP)).toBeNull());
  });

  it('au démarrage, propose la copie la plus récente même si une vieille quarantaine existe', async () => {
    const copy = (budget: number, savedAt: string) => JSON.stringify({ savedAt, fileId: 'file-1', data: withBudget(budget) });
    localStorage.setItem(PENDING, copy(111, '2026-10-01T10:00:00.000Z'));
    localStorage.setItem(BACKUP, copy(222, '2026-10-05T10:00:00.000Z'));
    const { result } = await load();
    await waitFor(() => expect(result.current.localBackup).not.toBeNull());
    expect(budgetOfFile(result.current.localBackup!.data)).toBe(222);
    expect(budgetOfFile(storedCopy(PENDING)!.data)).toBe(222);
  });

  it("une copie d'un autre compte n'est ni proposée ni effacée", async () => {
    localStorage.setItem(PENDING, JSON.stringify({ savedAt: '2026-10-01T10:00:00.000Z', fileId: 'autre-fichier', data: withBudget(111) }));
    const { result } = await load();
    expect(result.current.localBackup).toBeNull();
    expect(storedCopy(PENDING)).not.toBeNull();
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
