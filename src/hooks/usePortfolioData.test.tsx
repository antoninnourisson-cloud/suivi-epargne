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
  // La prochaine écriture arrive sur Drive, mais sa réponse se perd (réseau coupé pendant l'envoi).
  loseResponse: false,
  // Relecture de la révision impossible (chargement sans révision de référence).
  metaFail: null as unknown,
  // Relecture d'une ancienne révision impossible (version de l'autre appareil).
  revisionFail: false,
  // Le fichier principal a disparu (404) ; autres fichiers de données du compte.
  mainMissing: false,
  mainModified: '2026-10-14T08:00:00.000Z',
  extra: new Map<string, { content: unknown; modifiedTime: string; revision: number }>(),
  created: [] as string[],
  // Démarrage : la liste des fichiers donne aussi la révision ; appels comptés ; liste en échec.
  listRevision: false,
  lists: 0,
  metaCalls: 0,
  listFail: null as unknown,
}));

// Nombre de sérialisations canoniques (tri récursif de tout le document) : coût de chaque saisie.
const schemaCalls = vi.hoisted(() => ({ canonicalize: 0 }));
vi.mock('../lib/schema', async importOriginal => {
  const actual = await importOriginal<typeof import('../lib/schema')>();
  return { ...actual, canonicalize: (data: unknown) => { schemaCalls.canonicalize += 1; return actual.canonicalize(data); } };
});

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
  class ApiError extends Error {
    status: number; reason?: string;
    constructor(m: string, s: number, reason?: string) { super(m); this.name = 'ApiError'; this.status = s; this.reason = reason; }
  }
  const copy = (x: unknown) => JSON.parse(JSON.stringify(x)) as unknown;
  const notFound = () => new ApiError('Google API 404', 404, 'notFound');
  const extraRevision = (id: string) => `${id}-r${drive.extra.get(id)!.revision}`;
  return {
    ConflictError, ConcurrentWriteError, ApiError,
    setOnAuthLost: () => {},
    // Le plus récemment modifié d'abord, comme le vrai service.
    findConfigFiles: async () => {
      drive.lists += 1;
      if (drive.listFail) throw drive.listFail;
      return [
      ...(drive.mainMissing ? [] : [{ id: 'file-1', modifiedTime: drive.mainModified, ...(drive.listRevision ? { headRevisionId: String(drive.revision) } : {}) }]),
      ...[...drive.extra].map(([id, f]) => ({ id, modifiedTime: f.modifiedTime })),
    ].sort((a, b) => b.modifiedTime.localeCompare(a.modifiedTime));
    },
    createConfigFile: async (data: unknown) => {
      const id = drive.mainMissing ? `file-new-${drive.created.length + 1}` : 'file-1';
      drive.created.push(id);
      if (id !== 'file-1') drive.extra.set(id, { content: copy(data), modifiedTime: '2026-10-14T12:00:00.000Z', revision: 1 });
      return id;
    },
    readConfigFile: async (id: string) => {
      if (drive.readFail) throw drive.readFail;
      if (id === 'file-1') { if (drive.mainMissing) throw notFound(); return copy(drive.file); }
      const f = drive.extra.get(id);
      if (!f) throw notFound();
      return copy(f.content);
    },
    getFileRevision: async (id: string) => (id === 'file-1' ? String(drive.revision) : extraRevision(id)),
    getFileMeta: async (id: string) => {
      drive.metaCalls += 1;
      if (drive.metaFail) throw drive.metaFail;
      if (id === 'file-1') return { headRevisionId: String(drive.revision), modifiedTime: drive.mainModified };
      return { headRevisionId: extraRevision(id), modifiedTime: drive.extra.get(id)!.modifiedTime };
    },
    fetchRevisionContent: async (_id: string, rev: string) => {
      if (drive.revisionFail || !drive.history.has(rev)) throw new Error('REVISION_GONE');
      return copy(drive.history.get(rev));
    },
    // Même contrat que le vrai service : contrôle, écriture, puis vérification que la
    // révision précédant la nôtre est bien celle attendue.
    updateConfigFile: async (id: string, data: unknown, expected?: string | null) => {
      if (drive.writeFail) { const err = drive.writeFail; drive.writeFail = null; throw err; }
      if (drive.writeGate) await drive.writeGate;
      if (id !== 'file-1') {
        const f = drive.extra.get(id);
        if (!f) throw notFound();
        if (expected != null && expected !== extraRevision(id)) throw new ConflictError();
        f.content = copy(data);
        f.revision += 1;
        drive.writes.push(f.content);
        return extraRevision(id);
      }
      if (drive.mainMissing) throw notFound();
      if (expected != null && expected !== String(drive.revision)) throw new ConflictError();
      drive.beforeWrite?.();
      drive.beforeWrite = null;
      const previous = String(drive.revision);
      drive.file = copy(data);
      drive.writes.push(drive.file);
      drive.revision += 1;
      drive.history.set(String(drive.revision), drive.file);
      const ours = String(drive.revision);
      if (drive.loseResponse) { drive.loseResponse = false; throw new TypeError('Failed to fetch'); }
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
import { listSetAside } from '../services/setAsideVersions';

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
  drive.loseResponse = false;
  drive.metaFail = null;
  drive.revisionFail = false;
  drive.mainMissing = false;
  drive.mainModified = '2026-10-14T08:00:00.000Z';
  drive.extra = new Map();
  drive.created = [];
  drive.listRevision = false;
  drive.lists = 0;
  drive.metaCalls = 0;
  drive.listFail = null;
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
    act(() => { result.current.setGeminiApiKey('secret-key'); result.current.patchConfig({ leisureBudget: 321 }); });
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
    act(() => result.current.patchConfig({ leisureBudget: 999 }));
    await flushSave();
    await waitFor(() => expect(drive.writes.length).toBe(1));
    expect((drive.writes[0] as Record<string, unknown>).futureFeature).toEqual({ x: 1 });
  });

  it("signale un conflit au lieu d'écraser une écriture d'un autre appareil", async () => {
    const { result } = await load();
    drive.revision = 99; // un autre appareil a écrit
    act(() => result.current.patchConfig({ leisureBudget: 5 }));
    await flushSave();
    await waitFor(() => expect(result.current.syncConflict).toBe(true));
    expect(drive.writes).toHaveLength(0);
  });

  it('chaque écriture porte sa signature (date, appareil), sans effet sur la comparaison', async () => {
    const { result } = await load();
    act(() => result.current.patchConfig({ leisureBudget: 5 }));
    await flushSave();
    await waitFor(() => expect(drive.writes.length).toBe(1));
    const stamp = (drive.writes[0] as { lastWrite?: { at: string; device?: string; deviceId?: string } }).lastWrite;
    expect(stamp?.deviceId).toBe(localStorage.getItem('pecule_device_id'));
    expect(Number.isNaN(Date.parse(stamp!.at))).toBe(false);
    await flushSave();
    expect(drive.writes).toHaveLength(1);
  });

  it('sans course : une seule écriture, pas de conflit', async () => {
    const { result } = await load();
    act(() => result.current.patchConfig({ leisureBudget: 5 }));
    await flushSave();
    await waitFor(() => expect(drive.writes.length).toBe(1));
    await flushSave();
    expect(drive.writes).toHaveLength(1);
    expect(result.current.syncConflict).toBe(false);
  });

  describe('écriture concurrente entre le contrôle et le PATCH', () => {
    const theirs = () => ({ ...baseFile(), config: { ...baseFile().config, leisureBudget: 777 } });
    const budgetOf = (x: unknown) => (x as { config: { leisureBudget: number } }).config.leisureBudget;

    it("lève le conflit sans rien perdre ni réécrire, puis « garder cet appareil » garde la mienne et met la sienne de côté", async () => {
      const { result } = await load();
      drive.beforeWrite = () => remoteWrite(theirs());
      act(() => result.current.patchConfig({ leisureBudget: 5 }));
      await flushSave();
      await waitFor(() => expect(result.current.syncConflict).toBe(true));
      // Les deux versions sont récupérables : la mienne à l'écran et en tête de Drive,
      // la sienne dans la révision précédente et dans la quarantaine locale.
      expect(result.current.leisureBudget).toBe(5);
      expect(budgetOf(drive.file)).toBe(5);
      expect(budgetOf(drive.history.get('2'))).toBe(777);
      await waitFor(() => expect(localStorage.getItem('suivi_epargne_pending')).not.toBeNull());
      // L'écran de choix montre les deux versions.
      expect(result.current.conflict?.remoteStatus).toBe('ready');
      expect(result.current.conflict?.remote?.data.config.leisureBudget).toBe(777);
      expect(result.current.conflict?.local.data.config.leisureBudget).toBe(5);
      // Aucune réécriture automatique pendant le conflit.
      await flushSave();
      expect(drive.writes).toHaveLength(1);

      let outcome = '';
      await act(async () => { outcome = await result.current.resolveConflict('local'); });
      expect(outcome).toBe('done');
      expect(result.current.syncConflict).toBe(false);
      expect(budgetOf(drive.file)).toBe(5);
      expect(localStorage.getItem('suivi_epargne_pending')).toBeNull();
      // Drive porte déjà la mienne : rien à réécrire. La sienne est mise de côté.
      await flushSave();
      expect(drive.writes).toHaveLength(1);
      const aside = await listSetAside(null);
      expect(aside).toHaveLength(1);
      expect(budgetOf(aside[0].data)).toBe(777);
    });

    it("« garder la version de Drive » applique la sienne, la réécrit en tête (vérifiée) et met la mienne de côté", async () => {
      const { result } = await load();
      drive.beforeWrite = () => remoteWrite(theirs());
      act(() => result.current.patchConfig({ leisureBudget: 5 }));
      await flushSave();
      await waitFor(() => expect(result.current.conflict?.remoteStatus).toBe('ready'));

      await act(async () => { await result.current.resolveConflict('remote'); });
      await waitFor(() => expect(result.current.leisureBudget).toBe(777));
      expect(result.current.syncConflict).toBe(false);
      await flushSave();
      await waitFor(() => expect(budgetOf(drive.file)).toBe(777));
      expect(result.current.syncConflict).toBe(false);
      const aside = await listSetAside(null);
      expect(aside.map(e => budgetOf(e.data))).toEqual([5]);
      expect(aside[0].label).toBe('Version de cet appareil écartée');
    });

    it("version de l'autre appareil illisible sur le moment : relue aussitôt pour l'écran de choix", async () => {
      const { result } = await load();
      drive.otherUnreadable = true;
      drive.beforeWrite = () => remoteWrite(theirs());
      act(() => result.current.patchConfig({ leisureBudget: 5 }));
      await flushSave();
      await waitFor(() => expect(result.current.syncConflict).toBe(true));
      expect(result.current.leisureBudget).toBe(5);
      await waitFor(() => expect(result.current.conflict?.remote?.data.config.leisureBudget).toBe(777));

      await act(async () => { await result.current.resolveConflict('remote'); });
      await waitFor(() => expect(result.current.leisureBudget).toBe(777));
      expect(result.current.syncConflict).toBe(false);
    });

    it("si la relecture échoue, aucun choix à l'aveugle : le conflit reste ouvert et rien n'est écrasé", async () => {
      const { result } = await load();
      drive.otherUnreadable = true;
      drive.revisionFail = true;
      drive.beforeWrite = () => remoteWrite(theirs());
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      act(() => result.current.patchConfig({ leisureBudget: 5 }));
      await flushSave();
      await waitFor(() => expect(result.current.conflict?.remoteStatus).toBe('error'));
      let outcome = '';
      await act(async () => { outcome = await result.current.resolveConflict('remote'); });
      expect(outcome).toBe('unavailable');
      await act(async () => { outcome = await result.current.resolveConflict('local'); });
      expect(outcome).toBe('unavailable');
      expect(result.current.syncConflict).toBe(true);
      expect(result.current.leisureBudget).toBe(5);
      expect(drive.writes).toHaveLength(1);

      drive.revisionFail = false;
      act(() => result.current.retryConflictLoad());
      await waitFor(() => expect(result.current.conflict?.remoteStatus).toBe('ready'));
      spy.mockRestore();
    });
  });

  describe("conflit détecté avant l'écriture", () => {
    it('montre la version de Drive ; « garder cet appareil » réécrit la mienne avec contrôle', async () => {
      const { result } = await load();
      remoteWrite(withBudget(300)); // un autre appareil a écrit
      act(() => result.current.patchConfig({ leisureBudget: 5 }));
      await flushSave();
      await waitFor(() => expect(result.current.conflict?.remoteStatus).toBe('ready'));
      expect(drive.writes).toHaveLength(0);
      expect(result.current.conflict?.kind).toBe('conflict');
      expect(result.current.conflict?.remote?.data.config.leisureBudget).toBe(300);
      expect(result.current.conflict?.remote?.savedAt).toBe(drive.mainModified);

      await act(async () => { await result.current.resolveConflict('local'); });
      await flushSave();
      await waitFor(() => expect(drive.writes.length).toBe(1));
      expect(budgetOfFile(drive.file)).toBe(5);
      expect(result.current.syncConflict).toBe(false);
      expect((await listSetAside(null)).map(e => budgetOfFile(e.data))).toEqual([300]);
    });

    it('« garder la version de Drive » : rien à écrire, la mienne est mise de côté', async () => {
      const { result } = await load();
      remoteWrite(withBudget(300));
      act(() => result.current.patchConfig({ leisureBudget: 5 }));
      await flushSave();
      await waitFor(() => expect(result.current.conflict?.remoteStatus).toBe('ready'));
      await act(async () => { await result.current.resolveConflict('remote'); });
      expect(result.current.leisureBudget).toBe(300);
      await flushSave();
      expect(drive.writes).toHaveLength(0);
      expect(storedCopy(PENDING)).toBeNull();
      expect((await listSetAside(null)).map(e => budgetOfFile(e.data))).toEqual([5]);
    });

    it('la même modification faite des deux côtés : pas de choix à demander', async () => {
      const { result } = await load();
      remoteWrite(withBudget(5));
      act(() => result.current.patchConfig({ leisureBudget: 5 }));
      await flushSave();
      await act(async () => { await vi.advanceTimersByTimeAsync(50); });
      expect(result.current.syncConflict).toBe(false);
      expect(drive.writes).toHaveLength(0);
    });

    it('si la version écartée ne peut pas être gardée, rien ne change sans accord explicite', async () => {
      const { result } = await load();
      remoteWrite(withBudget(300));
      act(() => result.current.patchConfig({ leisureBudget: 5 }));
      await flushSave();
      await waitFor(() => expect(result.current.conflict?.remoteStatus).toBe('ready'));
      localStorage.setItem('suivi_epargne_set_aside', 'enc1:illisible');
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      let outcome = '';
      await act(async () => { outcome = await result.current.resolveConflict('remote'); });
      expect(outcome).toBe('copy-failed');
      expect(result.current.leisureBudget).toBe(5);
      expect(result.current.syncConflict).toBe(true);
      await act(async () => { outcome = await result.current.resolveConflict('remote', { withoutCopy: true }); });
      expect(outcome).toBe('done');
      expect(result.current.leisureBudget).toBe(300);
      warn.mockRestore();
    });

    it("une version de Drive venant d'une app plus récente ne peut pas être écrasée d'ici", async () => {
      const { result } = await load();
      remoteWrite({ ...withBudget(300), schemaVersion: APP_SCHEMA_VERSION + 1 });
      act(() => result.current.patchConfig({ leisureBudget: 5 }));
      await flushSave();
      await waitFor(() => expect(result.current.conflict?.remoteStatus).toBe('ready'));
      expect(result.current.conflict?.remoteFromNewerApp).toBe(true);
      let outcome = '';
      await act(async () => { outcome = await result.current.resolveConflict('local'); });
      expect(outcome).toBe('unavailable');
      expect(drive.writes).toHaveLength(0);
    });
  });

  it("ne réécrit jamais un fichier venant d'une version plus récente de l'app", async () => {
    drive.file = { ...baseFile(), schemaVersion: APP_SCHEMA_VERSION + 1 };
    const { result } = await load();
    expect(result.current.appOutdated).toBe(true);
    act(() => result.current.patchConfig({ leisureBudget: 5 }));
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
    let outcome: { ok: boolean; undoId?: string } = { ok: true };
    await act(async () => { outcome = await result.current.importData(bad); });
    expect(outcome).toEqual({ ok: false });
    const good = new File([JSON.stringify({ ...baseFile(), config: { ...baseFile().config, leisureBudget: 444 } })], 'y.json');
    await act(async () => { outcome = await result.current.importData(good); });
    expect(outcome.ok).toBe(true);
    expect(result.current.leisureBudget).toBe(444);
    // « Annuler » : la version mise de côté juste avant l'import revient.
    expect(outcome.undoId).toEqual(expect.any(String));
    let undone = false;
    await act(async () => { undone = await result.current.recoverSetAside(outcome.undoId!); });
    expect(undone).toBe(true);
    expect(result.current.leisureBudget).toBe(200);
  });

  it("un fichier importé n'installe jamais sa clé Gemini, ni ne remplace la clé Picker réglée", async () => {
    const { result } = await load();
    act(() => result.current.patchConfig({ pickerApiKey: 'ma-cle-picker' }));
    const trap = new File([JSON.stringify({ ...baseFile(), config: { ...baseFile().config, geminiApiKey: 'cle-d-un-tiers', pickerApiKey: 'autre-picker' } })], 'piege.json');
    let outcome: { ok: boolean } = { ok: false };
    await act(async () => { outcome = await result.current.importData(trap); });
    expect(outcome.ok).toBe(true);
    expect(result.current.geminiApiKey).toBe('');
    expect(localStorage.getItem('gemini_api_key')).toBeNull();
    expect(result.current.config.pickerApiKey).toBe('ma-cle-picker');
  });

  it("lit un ancien fichier (adresse des parents, restitution « emailed ») sans réécrire ni perdre ces champs", async () => {
    const restitution = { done: { date: '2027-01-01', accounts: [], interestsOffered: [], emailed: true } };
    drive.file = { ...baseFile(), parentalRestitution: restitution, config: { ...baseFile().config, parentsEmail: 'parents@exemple.fr' } };
    const { result } = await load();
    await flushSave();
    expect(drive.writes).toHaveLength(0);
    act(() => result.current.patchConfig({ leisureBudget: 321 }));
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
const HELD = 'suivi_epargne_held';

describe('chargement raté', () => {
  it("« Réessayer » recharge au lieu d'écraser Drive avec un document vide", async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    drive.readFail = new Error('HTTP 503');
    const { result } = await load();
    expect(result.current.loadFailed).toBe(true);
    expect(result.current.syncError).toBe(true);
    expect(result.current.accounts).toHaveLength(0);

    // Ni l'envoi immédiat, ni « Réessayer » n'écrivent quoi que ce soit.
    await act(async () => { await result.current.flushPendingChanges(); });
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
    act(() => first.result.current.patchConfig({ leisureBudget: 321 }));
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
    act(() => result.current.patchConfig({ leisureBudget: 321 }));
    await flushSave();
    await waitFor(() => expect(drive.writes.length).toBe(1));
    expect(result.current.hasUnsyncedChanges()).toBe(false);
  });
});

describe('réseau', () => {
  it("un délai dépassé n'arrête pas la synchronisation : nouvel essai sans événement « online »", async () => {
    const { result } = await load();
    drive.writeFail = new TypeError('NETWORK_TIMEOUT');
    act(() => result.current.patchConfig({ leisureBudget: 5 }));
    await flushSave();
    await waitFor(() => expect(result.current.isOffline).toBe(true));
    expect(drive.writes).toHaveLength(0);
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    await flushSave();
    await waitFor(() => expect(drive.writes.length).toBe(1));
    expect(result.current.isOffline).toBe(false);
    expect(budgetOfFile(drive.file)).toBe(5);
  });

  it("écriture arrivée sur Drive mais réponse perdue : pas de faux conflit, la saisie suivante part", async () => {
    const { result } = await load();
    drive.loseResponse = true;
    act(() => result.current.patchConfig({ leisureBudget: 5 }));
    await flushSave();
    await waitFor(() => expect(result.current.isOffline).toBe(true));
    expect(drive.writes).toHaveLength(1); // Drive l'a reçue, l'app ne le sait pas
    act(() => result.current.patchConfig({ leisureBudget: 6 }));
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    await flushSave();
    await waitFor(() => expect(drive.writes.length).toBe(2));
    expect(budgetOfFile(drive.file)).toBe(6);
    expect(result.current.syncConflict).toBe(false);
    expect(result.current.isOffline).toBe(false);
    await waitFor(() => expect(storedCopy(PENDING)).toBeNull());
    expect(await listSetAside()).toHaveLength(0);
  });

  it("réponse perdue puis écriture d'un autre appareil : le conflit est bien montré", async () => {
    const { result } = await load();
    drive.loseResponse = true;
    act(() => result.current.patchConfig({ leisureBudget: 5 }));
    await flushSave();
    await waitFor(() => expect(result.current.isOffline).toBe(true));
    remoteWrite(withBudget(300)); // l'autre appareil, après notre écriture
    act(() => result.current.patchConfig({ leisureBudget: 6 }));
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    await flushSave();
    await waitFor(() => expect(result.current.syncConflict).toBe(true));
    expect(drive.writes).toHaveLength(1);
    expect(budgetOfFile(drive.file)).toBe(300);
  });

  it('« Réessayer » et le retour au premier plan relancent tout de suite', async () => {
    const { result } = await load();
    drive.writeFail = new TypeError('Failed to fetch');
    act(() => result.current.patchConfig({ leisureBudget: 5 }));
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
    act(() => result.current.patchConfig({ leisureBudget: 150 }));
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
    act(() => result.current.patchConfig({ leisureBudget: 5 }));
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
    act(() => result.current.patchConfig({ leisureBudget: 5 }));
    await flushSave();
    expect(drive.writes).toHaveLength(0);
  });
});

describe('copies locales', () => {
  it("garde le miroir d'une saisie faite pendant une écriture lente", async () => {
    const { result } = await load();
    let release = () => {};
    drive.writeGate = new Promise<void>(r => { release = r; });
    act(() => result.current.patchConfig({ leisureBudget: 150 }));
    await flushSave(); // écriture de 150 en cours, bloquée
    act(() => result.current.patchConfig({ leisureBudget: 175 }));
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

  it('une copie jamais envoyée devenue illisible est signalée, plus ignorée en silence', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    localStorage.setItem(PENDING, '{abîmée');
    const { result } = await load();
    await waitFor(() => expect(result.current.unreadableLocalCopy).toBe('lost'));
    expect(result.current.localBackup).toBeNull();
    // « Compris » : la copie définitivement illisible est effacée, la bannière disparaît.
    act(() => { result.current.dismissUnreadableCopy(); });
    expect(result.current.unreadableLocalCopy).toBeNull();
    expect(localStorage.getItem(PENDING)).toBeNull();
    warn.mockRestore();
  });

  it('une copie chiffrée illisible pour l’instant (stockage protégé indisponible) est signalée et gardée', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    localStorage.setItem(BACKUP, 'enc1:AAAA.BBBB');
    const { result } = await load();
    await waitFor(() => expect(result.current.unreadableLocalCopy).toBe('unavailable'));
    // Mise à l'abri, telle quelle, avant que le miroir ne puisse réécrire sa place.
    expect(localStorage.getItem(BACKUP)).toBeNull();
    expect(JSON.parse(localStorage.getItem(HELD)!)).toEqual(['enc1:AAAA.BBBB']);
    act(() => { result.current.dismissUnreadableCopy(); });
    expect(result.current.unreadableLocalCopy).toBeNull();
    expect(JSON.parse(localStorage.getItem(HELD)!)).toEqual(['enc1:AAAA.BBBB']);
    warn.mockRestore();
  });

  it('une copie illisible pour l’instant survit aux saisies et aux sauvegardes qui suivent', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    localStorage.setItem(BACKUP, 'enc1:AAAA.BBBB');
    localStorage.setItem(PENDING, 'enc1:CCCC.DDDD');
    const { result } = await load();
    await waitFor(() => expect(result.current.unreadableLocalCopy).toBe('unavailable'));
    // Saisie : le miroir s'écrit (en clair, faute de clé) ; puis sauvegarde réussie, miroir effacé.
    act(() => result.current.patchConfig({ leisureBudget: 160 }));
    await act(async () => { await vi.advanceTimersByTimeAsync(700); });
    await waitFor(() => expect(storedCopy(BACKUP)).not.toBeNull());
    await flushSave();
    await waitFor(() => expect(budgetOfFile(drive.file)).toBe(160));
    await waitFor(() => expect(localStorage.getItem(BACKUP)).toBeNull());
    // Les deux copies illisibles sont toujours sur l'appareil, intactes.
    expect(JSON.parse(localStorage.getItem(HELD)!)).toEqual(['enc1:CCCC.DDDD', 'enc1:AAAA.BBBB']);
    warn.mockRestore();
  });

  it('une copie à l’abri redevenue lisible est proposée, puis quitte l’abri', async () => {
    const copy = JSON.stringify({ savedAt: '2026-10-05T10:00:00.000Z', fileId: 'file-1', data: withBudget(333) });
    localStorage.setItem(HELD, JSON.stringify([copy]));
    const { result } = await load();
    await waitFor(() => expect(result.current.localBackup).not.toBeNull());
    expect(budgetOfFile(result.current.localBackup!.data)).toBe(333);
    // En quarantaine (proposée jusqu'au choix), plus à l'abri.
    expect(budgetOfFile(storedCopy(PENDING)!.data)).toBe(333);
    await waitFor(() => expect(localStorage.getItem(HELD)).toBeNull());
    expect(result.current.unreadableLocalCopy).toBeNull();
  });

  it('« Se déconnecter sans envoyer » efface aussi les copies à l’abri', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    localStorage.setItem(BACKUP, 'enc1:AAAA.BBBB');
    const { result } = await load();
    await waitFor(() => expect(localStorage.getItem(HELD)).not.toBeNull());
    act(() => { result.current.resetData({ discardUnsynced: true }); });
    expect(localStorage.getItem(HELD)).toBeNull();
    warn.mockRestore();
  });
});

describe('retour dans l’app : relecture de Drive', () => {
  const focus = async () => {
    await act(async () => { await vi.advanceTimersByTimeAsync(31_000); window.dispatchEvent(new Event('focus')); await vi.advanceTimersByTimeAsync(20); });
  };

  it('sans modification locale, la version de l’autre appareil est chargée en silence', async () => {
    const { result } = await load();
    remoteWrite(withBudget(300));
    await focus();
    await waitFor(() => expect(result.current.leisureBudget).toBe(300));
    expect(result.current.remoteUpdatedAt).not.toBeNull();
    expect(result.current.syncConflict).toBe(false);
    await flushSave();
    expect(drive.writes).toHaveLength(0);
  });

  it('rien de nouveau : une seule lecture de révision, aucun rechargement', async () => {
    const { result } = await load();
    await focus();
    expect(result.current.remoteUpdatedAt).toBeNull();
  });

  it('avec une modification locale, le choix s’ouvre AVANT toute écriture', async () => {
    const { result } = await load();
    act(() => { window.dispatchEvent(new Event('offline')); });
    act(() => result.current.patchConfig({ leisureBudget: 5 }));
    remoteWrite(withBudget(300));
    act(() => { window.dispatchEvent(new Event('online')); });
    await act(async () => { await result.current.checkRemote(); });
    await waitFor(() => expect(result.current.conflict?.remoteStatus).toBe('ready'));
    expect(result.current.leisureBudget).toBe(5);
    await flushSave();
    expect(drive.writes).toHaveLength(0);
  });

  it('après une longue pause, la première touche relit Drive', async () => {
    const { result } = await load();
    remoteWrite(withBudget(300));
    await act(async () => { await vi.advanceTimersByTimeAsync(6 * 60_000); document.dispatchEvent(new Event('pointerdown')); await vi.advanceTimersByTimeAsync(20); });
    await waitFor(() => expect(result.current.leisureBudget).toBe(300));
  });

  it('révision de référence inconnue : jamais d’écrasement à l’aveugle', async () => {
    drive.metaFail = new Error('REVISION_UNAVAILABLE');
    const { result } = await load();
    drive.metaFail = null;
    remoteWrite(withBudget(300)); // écrit ailleurs pendant ce temps
    act(() => result.current.patchConfig({ leisureBudget: 5 }));
    await flushSave();
    await waitFor(() => expect(result.current.conflict?.remoteStatus).toBe('ready'));
    expect(drive.writes).toHaveLength(0);
    expect(budgetOfFile(drive.file)).toBe(300);
  });

  it('révision inconnue mais Drive inchangé : écriture normale, avec contrôle', async () => {
    drive.metaFail = new Error('REVISION_UNAVAILABLE');
    const { result } = await load();
    drive.metaFail = null;
    act(() => result.current.patchConfig({ leisureBudget: 5 }));
    await flushSave();
    await waitFor(() => expect(drive.writes.length).toBe(1));
    expect(result.current.syncConflict).toBe(false);
  });
});

describe('fichier introuvable (404) et fichiers en double', () => {
  it('fichier supprimé et aucun autre : recréé une seule fois avec mes données', async () => {
    const { result } = await load();
    drive.mainMissing = true;
    act(() => result.current.patchConfig({ leisureBudget: 5 }));
    await flushSave();
    await waitFor(() => expect(drive.created).toEqual(['file-new-1']));
    expect(budgetOfFile(drive.extra.get('file-new-1')!.content)).toBe(5);
    expect(result.current.syncError).toBe(false);
    act(() => result.current.patchConfig({ leisureBudget: 6 }));
    await flushSave();
    await waitFor(() => expect(budgetOfFile(drive.extra.get('file-new-1')!.content)).toBe(6));
    expect(drive.created).toHaveLength(1);
  });

  it('fichier supprimé mais un autre existe et diffère : choix demandé, rien écrasé ni créé', async () => {
    const { result } = await load();
    drive.mainMissing = true;
    drive.extra.set('file-2', { content: withBudget(300), modifiedTime: '2026-10-13T08:00:00.000Z', revision: 1 });
    act(() => result.current.patchConfig({ leisureBudget: 5 }));
    await flushSave();
    await waitFor(() => expect(result.current.conflict?.remoteStatus).toBe('ready'));
    expect(drive.created).toHaveLength(0);
    expect(budgetOfFile(drive.extra.get('file-2')!.content)).toBe(300);
    await act(async () => { await result.current.resolveConflict('local'); });
    await flushSave();
    await waitFor(() => expect(budgetOfFile(drive.extra.get('file-2')!.content)).toBe(5));
  });

  it('au démarrage, le fichier le plus récemment modifié est ouvert et le doublon signalé', async () => {
    drive.extra.set('file-recent', { content: withBudget(450), modifiedTime: '2026-10-14T09:00:00.000Z', revision: 1 });
    const { result } = await load();
    expect(result.current.leisureBudget).toBe(450);
    expect(result.current.duplicateFile?.id).toBe('file-1');
    act(() => result.current.dismissDuplicate());
    expect(result.current.duplicateFile).toBeNull();
    // Laissé tel quel : plus signalé au démarrage suivant.
    const again = await load();
    expect(again.result.current.duplicateFile).toBeNull();
  });

  it('« prendre l’autre fichier » : son contenu remplace celui du fichier ouvert, qui est mis de côté', async () => {
    drive.extra.set('file-old', { content: withBudget(120), modifiedTime: '2026-10-01T09:00:00.000Z', revision: 1 });
    const { result } = await load();
    expect(result.current.duplicateFile?.id).toBe('file-old');
    act(() => result.current.compareDuplicate());
    await waitFor(() => expect(result.current.conflict?.remoteStatus).toBe('ready'));
    expect(result.current.conflict?.kind).toBe('duplicate');
    expect(result.current.syncConflict).toBe(false);
    await act(async () => { await result.current.resolveConflict('remote'); });
    expect(result.current.leisureBudget).toBe(120);
    await flushSave();
    await waitFor(() => expect(budgetOfFile(drive.file)).toBe(120));
    expect(budgetOfFile(drive.extra.get('file-old')!.content)).toBe(120);
    expect(result.current.duplicateFile).toBeNull();
    expect((await listSetAside(null)).map(e => budgetOfFile(e.data))).toEqual([200]);
  });
});

describe('erreurs passagères et durables', () => {
  const apiError = async (status: number, reason?: string) => {
    const { ApiError } = await import('../services/googleDriveService');
    return new (ApiError as unknown as new (m: string, s: number, r?: string) => Error)(`Google API ${status}`, status, reason);
  };

  it('espace Drive plein : message clair, aucun nouvel essai automatique', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = await load();
    drive.writeFail = await apiError(403, 'storageQuotaExceeded');
    act(() => result.current.patchConfig({ leisureBudget: 5 }));
    await flushSave();
    await waitFor(() => expect(result.current.syncError).toBe(true));
    expect(result.current.syncErrorInfo).toEqual({ reason: 'quota', transient: false });
    await act(async () => { await vi.advanceTimersByTimeAsync(130_000); window.dispatchEvent(new Event('focus')); });
    await flushSave();
    expect(drive.writes).toHaveLength(0);
    // « Réessayer » reste possible, à la demande.
    act(() => result.current.retrySync());
    await flushSave();
    await waitFor(() => expect(drive.writes.length).toBe(1));
    expect(result.current.syncErrorInfo).toBeNull();
    spy.mockRestore();
  });

  it('Drive indisponible (503) : nouvel essai automatique', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = await load();
    drive.writeFail = await apiError(503);
    act(() => result.current.patchConfig({ leisureBudget: 5 }));
    await flushSave();
    await waitFor(() => expect(result.current.syncErrorInfo).toEqual({ reason: 'server', transient: true }));
    await act(async () => { await vi.advanceTimersByTimeAsync(5500); });
    await flushSave();
    await waitFor(() => expect(drive.writes.length).toBe(1));
    spy.mockRestore();
  });

  it('fichier illisible au chargement : pas de boucle de rechargements', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    drive.readFail = new SyntaxError('Unexpected token');
    const { result } = await load();
    expect(result.current.syncErrorInfo).toEqual({ reason: 'malformed', transient: false });
    drive.readFail = null;
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(result.current.loadFailed).toBe(true);
    spy.mockRestore();
  });
});

describe('restauration et déconnexion', () => {
  it('revenir à une copie Drive garde les données actuelles de côté, et se défait', async () => {
    drive.extra.set('backup-08', { content: withBudget(80), modifiedTime: '2000-01-01T00:00:00.000Z', revision: 1 });
    const { result } = await load();
    act(() => result.current.dismissDuplicate());
    let undoId = '';
    await act(async () => { undoId = await result.current.restoreDriveBackup('backup-08', "d'août 2026"); });
    expect(result.current.leisureBudget).toBe(80);
    let ok = false;
    await act(async () => { ok = await result.current.recoverSetAside(undoId); });
    expect(ok).toBe(true);
    expect(result.current.leisureBudget).toBe(200);
    // La version restaurée est à son tour gardée de côté.
    expect((await listSetAside(null)).map(e => budgetOfFile(e.data))).toEqual([80]);
  });

  it('« Envoyer puis se déconnecter » écrit tout de suite', async () => {
    const { result } = await load();
    act(() => result.current.patchConfig({ leisureBudget: 5 }));
    let ok = false;
    await act(async () => { ok = await result.current.flushPendingChanges(); });
    expect(ok).toBe(true);
    expect(budgetOfFile(drive.file)).toBe(5);
    expect(result.current.hasUnsyncedChanges()).toBe(false);
  });

  it('« Se déconnecter sans envoyer » efface les modifications de cet appareil', async () => {
    const first = await load();
    act(() => first.result.current.patchConfig({ leisureBudget: 321 }));
    await act(async () => { await vi.advanceTimersByTimeAsync(700); });
    await waitFor(() => expect(storedCopy(BACKUP)).not.toBeNull());
    act(() => first.result.current.resetData({ discardUnsynced: true }));
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    expect(storedCopy(BACKUP)).toBeNull();
    expect(storedCopy(PENDING)).toBeNull();
    first.unmount();
    const second = await load();
    expect(second.result.current.localBackup).toBeNull();
    expect(drive.writes).toHaveLength(0);
  });

  it('la déconnexion efface aussi les versions mises de côté', async () => {
    drive.extra.set('backup-08', { content: withBudget(80), modifiedTime: '2000-01-01T00:00:00.000Z', revision: 1 });
    const { result } = await load();
    act(() => result.current.dismissDuplicate());
    await act(async () => { await result.current.restoreDriveBackup('backup-08', "d'août 2026"); });
    expect(await listSetAside(null)).toHaveLength(1);
    act(() => result.current.resetData());
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(await listSetAside(null)).toEqual([]);
    expect(localStorage.getItem('suivi_epargne_set_aside')).toBeNull();
  });

  it('restauration de secours : sans copie des données actuelles, rien n’est remplacé', async () => {
    const { result } = await load();
    const real = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k: string, v: string) {
      if (k === 'suivi_epargne_set_aside') throw new DOMException('plein', 'QuotaExceededError');
      real.call(this, k, v);
    });
    const file = () => new File([JSON.stringify(withBudget(80))], 'secours.json', { type: 'application/json' });
    let failure: unknown = null;
    await act(async () => { await result.current.importData(file(), { requireSetAside: true }).catch(e => { failure = e; }); });
    expect((failure as Error | null)?.message).toBe('SET_ASIDE_FAILED');
    expect(result.current.leisureBudget).toBe(200);
    // Import d'un fichier (aucune promesse de copie) : il se fait quand même.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let outcome: { ok: boolean; undoId?: string } = { ok: false };
    await act(async () => { outcome = await result.current.importData(file()); });
    expect(outcome).toEqual({ ok: true, undoId: undefined }); // rien à annuler : pas de copie
    expect(result.current.leisureBudget).toBe(80);
    warn.mockRestore();
    vi.restoreAllMocks();
  });

  it('« Envoyer » refusé tant qu’une sauvegarde locale attend un choix', async () => {
    localStorage.setItem(BACKUP, JSON.stringify({ savedAt: '2026-10-05T10:00:00.000Z', fileId: 'file-1', data: withBudget(222) }));
    const { result } = await load();
    await waitFor(() => expect(result.current.localBackup).not.toBeNull());
    let ok = true;
    await act(async () => { ok = await result.current.flushPendingChanges(); });
    expect(ok).toBe(false);
    expect(drive.writes).toHaveLength(0);
  });

  it('saisies pas encore sur Drive : la mise à jour de l’app attend', async () => {
    const { result } = await load();
    expect(result.current.hasPendingEdits()).toBe(false);
    act(() => result.current.patchConfig({ leisureBudget: 5 }));
    expect(result.current.hasPendingEdits()).toBe(true);
    await flushSave();
    await waitFor(() => expect(drive.writes.length).toBe(1));
    await waitFor(() => expect(result.current.hasPendingEdits()).toBe(false));
  });
});

describe('démarrage rapide et hors ligne', () => {
  const OFFLINE = 'pecule_offline_copy';
  const setOnline = (online: boolean) => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });
  };
  afterEach(() => { delete (navigator as unknown as Record<string, unknown>).onLine; });

  /** Un premier chargement (en ligne) laisse la copie hors ligne ; l'app est rouverte hors ligne. */
  const startOffline = async () => {
    await load();
    await waitFor(() => expect(localStorage.getItem(OFFLINE)).not.toBeNull());
    cleanup();
    drive.lists = 0;
    setOnline(false);
    const hook = renderHook(() => usePortfolioData(true));
    await act(async () => { await hook.result.current.loadDriveData(); });
    return hook;
  };
  const goOnline = async () => {
    setOnline(true);
    await act(async () => { window.dispatchEvent(new Event('online')); await vi.advanceTimersByTimeAsync(50); });
  };

  it('la révision vient de la liste des fichiers : une lecture de moins, contrôle intact', async () => {
    drive.listRevision = true;
    const { result } = await load();
    expect(drive.metaCalls).toBe(0);
    act(() => result.current.patchConfig({ leisureBudget: 5 }));
    await flushSave();
    await waitFor(() => expect(drive.writes.length).toBe(1));
    remoteWrite(withBudget(300)); // un autre appareil écrit ensuite : conflit, pas d'écrasement
    act(() => result.current.patchConfig({ leisureBudget: 6 }));
    await flushSave();
    await waitFor(() => expect(result.current.syncConflict).toBe(true));
    expect(budgetOfFile(drive.file)).toBe(300);
  });

  it('copie chiffrée du dernier état de Drive, effacée à la déconnexion', async () => {
    const { result } = await load();
    await waitFor(() => expect(storedCopy(OFFLINE)).not.toBeNull());
    expect(budgetOfFile(storedCopy(OFFLINE)!.data)).toBe(200);
    act(() => result.current.patchConfig({ leisureBudget: 321 }));
    await flushSave();
    await waitFor(() => expect(budgetOfFile(storedCopy(OFFLINE)?.data)).toBe(321));
    act(() => result.current.resetData());
    expect(localStorage.getItem(OFFLINE)).toBeNull();
    expect(result.current.dataShown).toBe(false);
  });

  it('mode démo : aucune copie hors ligne', async () => {
    const { result } = renderHook(() => usePortfolioData(true));
    act(() => result.current.loadDemoData(baseFile()));
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    expect(result.current.dataShown).toBe(true);
    expect(localStorage.getItem(OFFLINE)).toBeNull();
  });

  it('hors ligne : la dernière copie s’affiche tout de suite, sans appel à Drive ni écriture', async () => {
    const { result } = await startOffline();
    expect(drive.lists).toBe(0);
    expect(result.current.accounts).toHaveLength(1);
    expect(result.current.dataShown).toBe(true);
    expect(result.current.offlineDataAt).not.toBeNull();
    expect(result.current.isOffline).toBe(true);
    expect(result.current.loadFailed).toBe(true);
    await flushSave();
    expect(drive.writes).toHaveLength(0);
  });

  it('hors ligne sans copie : rien d’affiché, aucune attente', async () => {
    setOnline(false);
    const { result } = renderHook(() => usePortfolioData(true));
    let loaded: boolean | undefined;
    await act(async () => { loaded = await result.current.loadDriveData(); });
    expect(loaded).toBe(false);
    expect(drive.lists).toBe(0);
    expect(result.current.dataShown).toBe(false);
    expect(result.current.loadFailed).toBe(true);
    expect(result.current.isOffline).toBe(true);
  });

  it('saisie hors ligne, Drive inchangé : elle part au retour du réseau, avec contrôle de révision', async () => {
    const { result } = await startOffline();
    act(() => result.current.patchConfig({ leisureBudget: 321 }));
    await flushSave();
    expect(drive.writes).toHaveLength(0);
    expect(result.current.hasUnsyncedChanges()).toBe(true);
    await waitFor(() => expect(storedCopy(BACKUP)).not.toBeNull()); // miroir local
    await goOnline();
    await waitFor(() => expect(result.current.offlineDataAt).toBeNull());
    expect(result.current.leisureBudget).toBe(321);
    expect(result.current.localBackup).toBeNull(); // son miroir n'est pas proposé en double
    await flushSave();
    await waitFor(() => expect(drive.writes.length).toBe(1));
    expect(budgetOfFile(drive.file)).toBe(321);
    expect(result.current.syncConflict).toBe(false);
    expect(result.current.isOffline).toBe(false);
  });

  it('Drive a changé pendant la coupure : le choix s’ouvre avant toute écriture', async () => {
    const { result } = await startOffline();
    act(() => result.current.patchConfig({ leisureBudget: 5 }));
    remoteWrite(withBudget(300));
    await goOnline();
    await waitFor(() => expect(result.current.syncConflict).toBe(true));
    expect(result.current.conflict?.remoteStatus).toBe('ready');
    expect(budgetOfFile(result.current.conflict?.remote?.data)).toBe(300);
    expect(result.current.leisureBudget).toBe(5);
    await flushSave();
    expect(drive.writes).toHaveLength(0);
    // « Garder la version de cet appareil » : écrite par-dessus la version relue, avec contrôle.
    await act(async () => { await result.current.resolveConflict('local'); });
    await flushSave();
    await waitFor(() => expect(drive.writes.length).toBe(1));
    expect(budgetOfFile(drive.file)).toBe(5);
  });

  it('sans saisie hors ligne, la version de Drive s’affiche sans question', async () => {
    const { result } = await startOffline();
    act(() => result.current.setLastView('journal')); // changer d'écran n'est pas une modification
    remoteWrite(withBudget(300));
    await goOnline();
    await waitFor(() => expect(result.current.leisureBudget).toBe(300));
    expect(result.current.offlineDataAt).toBeNull();
    expect(result.current.syncConflict).toBe(false);
  });

  it('Drive injoignable alors que le navigateur se croit en ligne : la copie s’affiche, nouvel essai', async () => {
    await load();
    await waitFor(() => expect(localStorage.getItem(OFFLINE)).not.toBeNull());
    cleanup();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    drive.listFail = new TypeError('NETWORK_TIMEOUT');
    const { result } = renderHook(() => usePortfolioData(true));
    await act(async () => { await result.current.loadDriveData(); });
    expect(result.current.offlineDataAt).not.toBeNull();
    expect(result.current.accounts).toHaveLength(1);
    expect(result.current.isOffline).toBe(true);
    expect(result.current.syncError).toBe(false);
    drive.listFail = null;
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    await waitFor(() => expect(result.current.offlineDataAt).toBeNull());
    expect(result.current.isOffline).toBe(false);
    spy.mockRestore();
  });

  it('jeton impossible à obtenir faute de réseau : la copie s’ouvre sans appel à Drive, nouvel essai ensuite', async () => {
    await load();
    await waitFor(() => expect(localStorage.getItem(OFFLINE)).not.toBeNull());
    cleanup();
    drive.lists = 0;
    const { result } = renderHook(() => usePortfolioData(true));
    await act(async () => { await result.current.loadDriveData({ startOffline: true }); });
    expect(drive.lists).toBe(0);
    expect(result.current.offlineDataAt).not.toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    await waitFor(() => expect(result.current.offlineDataAt).toBeNull());
    expect(drive.lists).toBe(1);
  });

  it('une copie jamais envoyée est proposée au démarrage hors ligne, et mise en quarantaine', async () => {
    await load();
    await waitFor(() => expect(localStorage.getItem(OFFLINE)).not.toBeNull());
    cleanup();
    localStorage.setItem(BACKUP, JSON.stringify({ savedAt: new Date().toISOString(), fileId: 'file-1', data: withBudget(777) }));
    setOnline(false);
    const { result } = renderHook(() => usePortfolioData(true));
    await act(async () => { await result.current.loadDriveData(); });
    expect(result.current.leisureBudget).toBe(200);
    expect(budgetOfFile(result.current.localBackup?.data)).toBe(777);
    await waitFor(() => expect(budgetOfFile(storedCopy(PENDING)?.data)).toBe(777));
    expect(result.current.hasUnsyncedChanges()).toBe(true);
  });

  it('copie hors ligne d’un autre fichier (autre compte Google) : jamais proposée pour l’écraser', async () => {
    const { result } = await startOffline();
    act(() => result.current.patchConfig({ leisureBudget: 5 })); // saisie sur la copie du fichier file-1
    // Reconnexion avec un autre compte : son seul fichier est file-b.
    drive.mainMissing = true;
    drive.extra.set('file-b', { content: withBudget(300), modifiedTime: '2026-10-15T08:00:00.000Z', revision: 1 });
    await goOnline();
    await waitFor(() => expect(result.current.offlineDataAt).toBeNull());
    expect(result.current.syncConflict).toBe(false);
    expect(result.current.leisureBudget).toBe(300);
    // Les saisies restent en quarantaine, rattachées à leur fichier (proposées à son compte).
    await waitFor(() => expect(budgetOfFile(storedCopy(PENDING)?.data)).toBe(5));
    expect((storedCopy(PENDING) as { fileId?: string }).fileId).toBe('file-1');
    expect(result.current.localBackup).toBeNull();
    await flushSave();
    expect(drive.writes).toHaveLength(0);
  });

  // La quarantaine n'a qu'une place : ce qui doit la céder part d'abord dans « Versions mises
  // de côté » (lot 2, filet anti-perte). Ouverture hors ligne avec une copie déjà en quarantaine.
  const reopenOfflineWithPending = async (pending: { fileId: string; budget: number }) => {
    await load();
    await waitFor(() => expect(localStorage.getItem(OFFLINE)).not.toBeNull());
    cleanup();
    localStorage.setItem(PENDING, JSON.stringify({ savedAt: '2026-10-10T10:00:00.000Z', fileId: pending.fileId, data: withBudget(pending.budget) }));
    setOnline(false);
    const hook = renderHook(() => usePortfolioData(true));
    await act(async () => { await hook.result.current.loadDriveData(); });
    return hook;
  };

  it('ancienne copie en quarantaine, puis conflit après une saisie hors ligne : aucune des deux n’est perdue', async () => {
    const { result } = await reopenOfflineWithPending({ fileId: 'file-1', budget: 111 });
    expect(budgetOfFile(result.current.localBackup?.data)).toBe(111);
    act(() => result.current.patchConfig({ leisureBudget: 5 })); // saisie hors ligne
    remoteWrite(withBudget(300)); // Drive change ailleurs pendant ce temps
    await goOnline();
    await waitFor(() => expect(result.current.syncConflict).toBe(true));
    // La copie du conflit prend la quarantaine ; l'ancienne a d'abord été mise de côté.
    await waitFor(() => expect(budgetOfFile(storedCopy(PENDING)?.data)).toBe(5));
    const kept = await listSetAside('file-1');
    expect(kept.map(e => [e.reason, budgetOfFile(e.data)])).toEqual([['unsent', 111]]);
    expect(kept[0].label).toMatch(/^Modifications jamais envoyées sur Drive \(du 10 octobre/);
    expect(budgetOfFile(result.current.localBackup?.data)).toBe(111); // toujours proposée

    // « Ignorer » la copie proposée n'efface pas la copie du conflit, qui a pris sa place.
    act(() => result.current.dismissLocalBackup());
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    expect(budgetOfFile(storedCopy(PENDING)?.data)).toBe(5);
    // Choisir la version de Drive efface la copie du conflit (mise de côté à son tour).
    await act(async () => { expect(await result.current.resolveConflict('remote')).toBe('done'); });
    await waitFor(() => expect(localStorage.getItem(PENDING)).toBeNull());
    expect((await listSetAside('file-1')).map(e => budgetOfFile(e.data)).sort()).toEqual([111, 5]);
    expect(drive.writes).toHaveLength(0);
  });

  it('copie hors ligne d’un autre fichier et copie jamais envoyée du fichier ouvert : les deux restent récupérables', async () => {
    const { result } = await reopenOfflineWithPending({ fileId: 'file-b', budget: 111 });
    expect(result.current.localBackup).toBeNull(); // copie d'un autre fichier : pas proposée ici
    act(() => result.current.patchConfig({ leisureBudget: 5 })); // saisie sur la copie hors ligne de file-1
    drive.mainMissing = true;
    drive.extra.set('file-b', { content: withBudget(300), modifiedTime: '2026-10-15T08:00:00.000Z', revision: 1 });
    await goOnline();
    await waitFor(() => expect(result.current.offlineDataAt).toBeNull());
    expect(result.current.leisureBudget).toBe(300);
    expect(result.current.syncConflict).toBe(false);
    // La copie de file-b est proposée (et gardée de côté, visible pour ce fichier)…
    await waitFor(() => expect(budgetOfFile(result.current.localBackup?.data)).toBe(111));
    await waitFor(async () => expect((await listSetAside('file-b')).map(e => [e.fileId, budgetOfFile(e.data)])).toEqual([['file-b', 111]]));
    // … et les saisies faites sur file-1 gardent la quarantaine, rattachées à leur fichier.
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    expect((storedCopy(PENDING) as { fileId?: string } | null)?.fileId).toBe('file-1');
    expect(budgetOfFile(storedCopy(PENDING)!.data)).toBe(5);
    // Ignorer la copie de file-b ne touche pas à celle de file-1.
    act(() => result.current.dismissLocalBackup());
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    expect(budgetOfFile(storedCopy(PENDING)?.data)).toBe(5);
    await flushSave();
    expect(drive.writes).toHaveLength(0);
  });

  it('nouvelle connexion : la copie hors ligne de la session précédente est oubliée', async () => {
    const { result } = await load();
    await waitFor(() => expect(localStorage.getItem(OFFLINE)).not.toBeNull());
    act(() => result.current.forgetOfflineCopy());
    expect(localStorage.getItem(OFFLINE)).toBeNull();
  });
});

// Filets anti-perte restants (audit #133) : quarantaine relue au démarrage, fichier encore
// listé après un 404, session perdue ou réseau coupé pendant une écriture, autre onglet
// pendant une écriture, déconnexion.
describe('filets anti-perte', () => {
  const quarantine = (budget: number, fileId = 'file-1') =>
    localStorage.setItem(PENDING, JSON.stringify({ savedAt: '2026-10-10T10:00:00.000Z', fileId, data: withBudget(budget) }));
  const apiError = async (status: number, reason?: string) => {
    const { ApiError } = await import('../services/googleDriveService');
    return new (ApiError as unknown as new (m: string, s: number, r?: string) => Error)(`Google API ${status}`, status, reason);
  };

  it('quarantaine au démarrage : « Restaurer » la remet à l’écran, puis elle part sur Drive avec contrôle', async () => {
    quarantine(111);
    const { result } = await load();
    await waitFor(() => expect(result.current.localBackup).not.toBeNull());
    // Rien n'est remplacé ni écrit sans le choix de l'utilisateur.
    expect(result.current.leisureBudget).toBe(200);
    await flushSave();
    expect(drive.writes).toHaveLength(0);

    act(() => result.current.restoreLocalBackup());
    expect(result.current.leisureBudget).toBe(111);
    expect(result.current.localBackup).toBeNull();
    await waitFor(() => expect(localStorage.getItem(PENDING)).toBeNull());
    await flushSave();
    await waitFor(() => expect(budgetOfFile(drive.file)).toBe(111));
    expect(drive.revision).toBe(2);
  });

  it('quarantaine au démarrage : « Ignorer » l’efface sans rien changer ni écrire', async () => {
    quarantine(111);
    const { result } = await load();
    await waitFor(() => expect(result.current.localBackup).not.toBeNull());
    act(() => result.current.dismissLocalBackup());
    expect(result.current.localBackup).toBeNull();
    await waitFor(() => expect(localStorage.getItem(PENDING)).toBeNull());
    expect(result.current.leisureBudget).toBe(200);
    await flushSave();
    expect(drive.writes).toHaveLength(0);
  });

  it('quarantaine identique à Drive : déjà enregistrée, effacée sans rien proposer', async () => {
    quarantine(200);
    const { result } = await load();
    await waitFor(() => expect(localStorage.getItem(PENDING)).toBeNull());
    expect(result.current.localBackup).toBeNull();
  });

  it('404 alors que le fichier est encore listé : refus passager, nouvel essai, jamais d’écriture sans contrôle', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = await load();
    drive.writeFail = await apiError(404, 'notFound');
    act(() => result.current.patchConfig({ leisureBudget: 5 }));
    await flushSave();
    await waitFor(() => expect(result.current.syncError).toBe(true));
    expect(drive.writes).toHaveLength(0);
    expect(drive.created).toHaveLength(0);
    // Nouvel essai automatique (5 s) : l'écriture part, avec la révision attendue.
    await act(async () => { await vi.advanceTimersByTimeAsync(5_500); });
    await waitFor(() => expect(budgetOfFile(drive.file)).toBe(5));
    expect(result.current.syncError).toBe(false);
    expect(drive.revision).toBe(2);
    spy.mockRestore();
  });

  it('fichier supprimé, un autre fichier porte déjà ces données : rien à écrire, aucun choix demandé', async () => {
    const { result } = await load();
    drive.mainMissing = true;
    drive.extra.set('file-2', { content: withBudget(5), modifiedTime: '2026-10-13T08:00:00.000Z', revision: 1 });
    act(() => result.current.patchConfig({ leisureBudget: 5 }));
    await flushSave();
    await waitFor(() => expect(drive.lists).toBe(2));
    await waitFor(() => expect(result.current.isSaving).toBe(false));
    expect(result.current.conflict).toBeNull();
    expect(result.current.syncError).toBe(false);
    expect(drive.writes).toHaveLength(0);
    expect(drive.created).toHaveLength(0);
    // L'app continue sur ce fichier : la saisie suivante y part, avec contrôle.
    act(() => result.current.patchConfig({ leisureBudget: 6 }));
    await flushSave();
    await waitFor(() => expect(budgetOfFile(drive.extra.get('file-2')!.content)).toBe(6));
    expect(drive.created).toHaveLength(0);
  });

  it('session perdue pendant une écriture : bannière de reconnexion, plus aucune écriture, saisies gardées', async () => {
    const { result } = await load();
    drive.writeFail = new Error('SESSION_EXPIRED');
    act(() => result.current.patchConfig({ leisureBudget: 5 }));
    await flushSave();
    await waitFor(() => expect(result.current.sessionExpired).toBe(true));
    act(() => result.current.patchConfig({ leisureBudget: 6 }));
    await flushSave();
    await act(async () => { await vi.advanceTimersByTimeAsync(130_000); });
    expect(drive.writes).toHaveLength(0);
    expect(result.current.leisureBudget).toBe(6);
    expect(result.current.hasUnsyncedChanges()).toBe(true);
    await waitFor(() => expect(budgetOfFile(storedCopy(BACKUP)?.data ?? withBudget(-1))).toBe(6));
  });

  it('réseau coupé pendant une écriture : « hors ligne », puis l’écriture repart seule', async () => {
    const { result } = await load();
    drive.writeFail = new TypeError('Failed to fetch');
    act(() => result.current.patchConfig({ leisureBudget: 5 }));
    await flushSave();
    await waitFor(() => expect(result.current.isOffline).toBe(true));
    expect(drive.writes).toHaveLength(0);
    await act(async () => { await vi.advanceTimersByTimeAsync(5_500); });
    await waitFor(() => expect(budgetOfFile(drive.file)).toBe(5));
    expect(result.current.isOffline).toBe(false);
  });

  it('session refusée au chargement : rien affiché ni écrit, reconnexion demandée', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    drive.readFail = new Error('SESSION_EXPIRED');
    const { result } = await load();
    expect(result.current.sessionExpired).toBe(true);
    expect(result.current.loadFailed).toBe(true);
    expect(result.current.accounts).toHaveLength(0);
    act(() => result.current.patchConfig({ leisureBudget: 5 }));
    await flushSave();
    expect(drive.writes).toHaveLength(0);
    spy.mockRestore();
  });

  it('un autre onglet enregistre pendant notre écriture : sa version n’est pas appliquée par-dessus', async () => {
    const { result } = await load();
    let release = () => {};
    drive.writeGate = new Promise<void>(r => { release = r; });
    act(() => result.current.patchConfig({ leisureBudget: 150 }));
    await flushSave(); // notre écriture est en cours, bloquée
    await waitFor(() => expect(result.current.isSaving).toBe(true));
    await act(async () => {
      window.dispatchEvent(new StorageEvent('storage', {
        key: 'suivi_epargne_last_save', newValue: JSON.stringify({ fileId: 'file-1', revision: '7', at: Date.now() }),
      }));
      await vi.advanceTimersByTimeAsync(20);
    });
    expect(result.current.leisureBudget).toBe(150);
    await act(async () => { drive.writeGate = null; release(); await vi.advanceTimersByTimeAsync(10); });
    await waitFor(() => expect(budgetOfFile(drive.file)).toBe(150));
  });

  it('annonce illisible ou d’un autre fichier : ignorée', async () => {
    const { result } = await load();
    remoteWrite(withBudget(300));
    await act(async () => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'suivi_epargne_last_save', newValue: '{pas du json' }));
      window.dispatchEvent(new StorageEvent('storage', { key: 'suivi_epargne_last_save', newValue: JSON.stringify({ fileId: 'autre', revision: '9' }) }));
      window.dispatchEvent(new StorageEvent('storage', { key: 'autre_cle', newValue: 'x' }));
      await vi.advanceTimersByTimeAsync(20);
    });
    expect(result.current.leisureBudget).toBe(200);
  });

  it('déconnexion en effaçant les saisies : copies locales, copie hors ligne et mois de la copie Drive effacés', async () => {
    const { result } = await load();
    await waitFor(() => expect(localStorage.getItem('pecule_offline_copy')).not.toBeNull());
    localStorage.setItem('last_drive_backup_month', '2026-10');
    quarantine(111);
    act(() => result.current.patchConfig({ leisureBudget: 5 }));
    act(() => result.current.resetData({ discardUnsynced: true }));
    for (const key of [PENDING, BACKUP, 'pecule_offline_copy', 'last_drive_backup_month']) expect(localStorage.getItem(key)).toBeNull();
    expect(result.current.accounts).toHaveLength(0);
    await flushSave();
    expect(drive.writes).toHaveLength(0);
    expect(localStorage.getItem(BACKUP)).toBeNull();
  });
});

describe('façade : un état de synchronisation, des fonctions stables', () => {
  it('les fonctions gardent leur identité d’un rendu à l’autre (les écrans mémoïsés ne sont pas re-rendus)', async () => {
    const { result } = await load();
    const before = result.current;
    act(() => result.current.patchConfig({ leisureBudget: 5 }));
    await flushSave();
    await waitFor(() => expect(drive.writes.length).toBe(1));
    expect(result.current.doc).not.toBe(before.doc);
    for (const k of [
      'patchConfig', 'setAccounts', 'setExpenses', 'updateWorkBenefits', 'setGeminiApiKey', 'setLastView', 'currentData', 'exportData',
      'loadDriveData', 'loadDemoData', 'retrySync', 'resolveConflict',
      'retryConflictLoad', 'compareDuplicate', 'dismissDuplicate', 'flushPendingChanges', 'hasUnsyncedChanges', 'hasPendingEdits',
      'forgetOfflineCopy', 'restoreLocalBackup', 'dismissLocalBackup', 'resetData', 'importData', 'listDriveBackups',
      'restoreDriveBackup', 'listSetAsideVersions', 'recoverSetAside',
    ] as const) expect(result.current[k], k).toBe(before[k]);
  });

  it('l’état de synchronisation est un seul objet, d’où viennent les indicateurs', async () => {
    const { result } = await load();
    const s = result.current.syncStatus;
    expect(s).toEqual({ loading: false, saving: false, offline: false, loadFailed: false, sessionExpired: false, appOutdated: false, error: null });
    expect(result.current.isLoadingData).toBe(s.loading);
    expect(result.current.syncError).toBe(false);
    drive.revision = 99; // un autre appareil a écrit
    act(() => result.current.patchConfig({ leisureBudget: 6 }));
    await waitFor(() => expect(result.current.isSaving).toBe(true));
    expect(result.current.syncStatus.saving).toBe(true);
    await flushSave();
    await waitFor(() => expect(result.current.syncConflict).toBe(true));
    expect(result.current.syncStatus.saving).toBe(false);
  });
});

describe('coût d’une saisie', () => {
  it('une seule comparaison complète à Drive par modification, faite après l’affichage de la saisie', async () => {
    const { result } = await load();
    await flushSave();
    schemaCalls.canonicalize = 0;
    act(() => result.current.patchConfig({ leisureBudget: 321 }));
    // Rendu et effets de la saisie passés : rien n'est encore sérialisé (ce qui retardait l'affichage).
    expect(schemaCalls.canonicalize).toBe(0);
    await flushSave();
    await waitFor(() => expect(drive.writes.length).toBe(1));
    // Sauvegarde auto, miroir, écriture et fin d'écriture réutilisent la même forme canonique
    // (avant : 3 à 4 sérialisations par modification).
    expect(schemaCalls.canonicalize).toBe(1);
  });
});
