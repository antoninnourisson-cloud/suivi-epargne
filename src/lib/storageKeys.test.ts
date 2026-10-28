import { afterEach, describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  STORAGE_KEYS, OBSOLETE_KEYS, MARK, cleanUpStorage, clearTraces, hasMark, keysOfKind, pruneMarks, pruneSnoozed, readMarks, setMark,
  skippedRecurringIds,
} from './storageKeys';

const memoryStorage = (init: Record<string, string> = {}): Storage => {
  const m = new Map(Object.entries(init));
  return {
    get length() { return m.size; },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, String(v)); },
    removeItem: (k: string) => { m.delete(k); },
    clear: () => m.clear(),
  };
};

afterEach(() => { vi.unstubAllGlobals(); });

describe('registre des clés du stockage local', () => {
  it('has unique key names', () => {
    const names = Object.values(STORAGE_KEYS).map(k => k.key);
    expect(new Set(names).size).toBe(names.length);
  });

  it('lists every storage key written in the app code', () => {
    // Clés écrites en dur dans le code (hors tests) : toutes doivent figurer au registre,
    // sinon une purge (« Code oublié ») ou un renommage les oublierait.
    const known = new Set([...Object.values(STORAGE_KEYS).map(k => k.key), ...OBSOLETE_KEYS]);
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !p.endsWith('storageKeys.ts')) files.push(p);
      }
    };
    walk(join(__dirname, '..'));
    const patterns = [
      /(?:localStorage|sessionStorage)\.(?:getItem|setItem|removeItem)\(\s*'([^']+)'/g,
      /\bls(?:Get|Set|Del|GetJSON|SetJSON)\(\s*'([^']+)'/g,
      /\b[A-Z_]*KEY\s*=\s*'([^']+)'/g,
    ];
    const unknown: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      for (const re of patterns) for (const m of src.matchAll(re)) if (!known.has(m[1])) unknown.push(`${f}: ${m[1]}`);
    }
    expect(unknown).toEqual([]);
  });

  it('classifies keys by kind', () => {
    expect(keysOfKind('data')).toContain('suivi_epargne_pending');
    expect(keysOfKind('secret')).toContain('gemini_api_key');
    expect(keysOfKind('trace')).toEqual(expect.arrayContaining(['last_view', 'suivi_epargne_last_save', 'home_marks']));
    expect(keysOfKind('trace')).not.toContain('pecule_device_id');
  });
});

describe('repères datés de l\'Accueil', () => {
  it('keeps marks for a bit more than a year, and drops unreadable dates', () => {
    const marks = { old: '2025-01-01', recent: '2026-06-01', broken: 'n/a' };
    expect(pruneMarks(marks, '2026-10-20')).toEqual({ recent: '2026-06-01' });
  });

  it('sets, reads and prunes marks in one object', () => {
    vi.stubGlobal('localStorage', memoryStorage({ home_marks: JSON.stringify({ [MARK.avRateChecked(2024)]: '2024-01-15' }) }));
    expect(hasMark(MARK.avRateChecked(2024))).toBe(true);
    setMark(MARK.skippedRecurring('2026-10', 'r1'), '2026-10-20');
    expect(readMarks()).toEqual({ 'skip:2026-10:r1': '2026-10-20' });
  });

  it('never ages out a pay raise already seen (it would be offered and added a second time)', () => {
    const seen = MARK.payRaiseSeen('p42');
    const marks = { [seen]: '2024-01-15', [MARK.avRateChecked(2024)]: '2024-01-15' };
    expect(pruneMarks(marks, '2026-10-20')).toEqual({ [seen]: '2024-01-15' });
    // Ni par setMark (qui élague à chaque écriture), ni par le ménage au démarrage.
    vi.stubGlobal('localStorage', memoryStorage({ home_marks: JSON.stringify(marks) }));
    setMark(MARK.skippedRecurring('2026-10', 'r1'), '2026-10-20');
    expect(hasMark(seen)).toBe(true);
    const s = memoryStorage({ home_marks: JSON.stringify(marks) });
    cleanUpStorage(s, '2030-01-01');
    expect(JSON.parse(s.getItem('home_marks')!)).toEqual({ [seen]: '2024-01-15' });
  });

  it('« Pas ce mois-ci » : échéances écartées du mois demandé seulement', () => {
    const marks = {
      [MARK.skippedRecurring('2026-10', 'r1')]: '2026-10-05',
      [MARK.skippedRecurring('2026-10', 'r2')]: '2026-10-06',
      [MARK.skippedRecurring('2026-09', 'r3')]: '2026-09-05',
      [MARK.payRaiseSeen('p1')]: '2026-10-01',
    };
    expect([...skippedRecurringIds(marks, '2026-10')].sort()).toEqual(['r1', 'r2']);
    expect([...skippedRecurringIds(marks, '2026-11')]).toEqual([]);
  });

  it('ignores a damaged marks object', () => {
    vi.stubGlobal('localStorage', memoryStorage({ home_marks: '[1,2]' }));
    expect(readMarks()).toEqual({});
  });

  it('drops expired snoozes', () => {
    expect(pruneSnoozed({ a: 10, b: 30, c: 'x' as unknown as number }, 20)).toEqual({ b: 30 });
  });
});

describe('ménage au démarrage', () => {
  it('moves legacy dated keys into home_marks and removes obsolete keys', () => {
    const s = memoryStorage({
      'skipped_recurring_2026-10': JSON.stringify(['r1', 'r2']),
      'skipped_recurring_2024-01': JSON.stringify(['old']),
      'skipped_recurring_2026-09': '{abîmé',
      av_rate_checked_2026: '1',
      pay_raise_seen_p42: '1',
      goal_prompt: '1',
      auth_timestamp: '123',
      theme: 'dark',
      todo_snoozed: JSON.stringify({ expired: 5, active: 50 }),
    });
    cleanUpStorage(s, '2026-10-20', 10);
    const marks = JSON.parse(s.getItem('home_marks')!);
    expect(marks).toEqual({
      'skip:2026-10:r1': '2026-10-01',
      'skip:2026-10:r2': '2026-10-01',
      'av-rate:2026': '2026-01-01',
      'pay-raise:p42': '2026-10-20',
    });
    for (const k of ['skipped_recurring_2026-10', 'skipped_recurring_2024-01', 'skipped_recurring_2026-09', 'av_rate_checked_2026', 'pay_raise_seen_p42', 'goal_prompt', 'auth_timestamp']) {
      expect(s.getItem(k)).toBeNull();
    }
    expect(s.getItem('theme')).toBe('dark');
    expect(JSON.parse(s.getItem('todo_snoozed')!)).toEqual({ active: 50 });
  });

  it('removes empty leftovers and never throws', () => {
    const s = memoryStorage({ home_marks: JSON.stringify({ x: '2020-01-01' }), todo_snoozed: '{abîmé' });
    cleanUpStorage(s, '2026-10-20');
    expect(s.getItem('home_marks')).toBeNull();
    expect(s.getItem('todo_snoozed')).toBeNull();
    const blocked = { get length(): number { throw new Error('SecurityError'); } } as unknown as Storage;
    expect(() => cleanUpStorage(blocked, '2026-10-20')).not.toThrow();
  });

  it('clears usage traces but keeps data copies, secrets and preferences', () => {
    const local = memoryStorage({ last_view: 'pilot', quickadd_last_account: 'a1', suivi_epargne_pending: 'enc1:x', theme: 'dark', pecule_device_id: 'd1' });
    const session = memoryStorage({ 'pecule.updateDrafts': '{}' });
    vi.stubGlobal('localStorage', local);
    vi.stubGlobal('sessionStorage', session);
    clearTraces();
    expect(local.getItem('last_view')).toBeNull();
    expect(local.getItem('quickadd_last_account')).toBeNull();
    expect(session.getItem('pecule.updateDrafts')).toBeNull();
    expect(local.getItem('suivi_epargne_pending')).toBe('enc1:x');
    expect(local.getItem('theme')).toBe('dark');
    expect(local.getItem('pecule_device_id')).toBe('d1');
  });

  it('« Code oublié » keeps the pay-raise marks: the same raise is never proposed, nor added, twice', () => {
    const local = memoryStorage({});
    vi.stubGlobal('localStorage', local);
    vi.stubGlobal('sessionStorage', memoryStorage({}));
    setMark(MARK.payRaiseSeen('p1'), '2026-10-01');
    setMark(MARK.skippedRecurring('2026-10', 'r1'), '2026-10-01');
    setMark(MARK.avRateChecked(2026), '2026-10-01');
    clearTraces();
    expect(hasMark(MARK.payRaiseSeen('p1'))).toBe(true);
    expect(readMarks()).toEqual({ [MARK.payRaiseSeen('p1')]: '2026-10-01' });
    // Sans repère permanent, la clé disparaît entièrement.
    const empty = memoryStorage({ home_marks: JSON.stringify({ [MARK.avRateChecked(2025)]: '2025-02-01' }) });
    vi.stubGlobal('localStorage', empty);
    clearTraces();
    expect(empty.getItem('home_marks')).toBeNull();
  });
});
