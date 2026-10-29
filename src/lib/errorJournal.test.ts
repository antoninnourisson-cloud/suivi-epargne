// Journal des erreurs de l'appareil : rien de personnel, 20 entrées au plus, jamais d'exception.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  appendEntry, clearErrorJournal, componentNames, formatErrorJournal, installErrorJournal, MAX_ENTRIES, readErrorJournal,
  recordError, sanitizeMessage, stackFrames, toEntry, type ErrorEntry,
} from './errorJournal';
import { APP_VERSION } from '../appVersion';

const memoryStorage = () => {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, String(v)); },
    removeItem: (k: string) => { m.delete(k); }, clear: () => m.clear(), key: (i: number) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
  };
};

describe('errorJournal', () => {
  beforeEach(() => { vi.stubGlobal('localStorage', memoryStorage()); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('retire montants, textes cités, adresses mail et paramètres d\'adresse', () => {
    expect(sanitizeMessage('Solde 12 345,67 € invalide pour "Livret A de Marie"')).toBe('Solde # € invalide pour "…"');
    expect(sanitizeMessage("Cannot read 'marie@example.com' or jean.dupont@gmail.com")).toBe('Cannot read "…" or [courriel]');
    expect(sanitizeMessage('Failed to fetch https://pecule-app.com/assets/Agenda-B5W6.js?token=abc#x')).toBe('Failed to fetch Agenda-B5W6.js');
    expect(sanitizeMessage('Compte « Épargne Paul » : 1500')).toBe('Compte "…" : #');
    expect(sanitizeMessage('première ligne\nseconde ligne avec le fichier')).toBe('première ligne');
    expect(sanitizeMessage('x'.repeat(500))).toHaveLength(200);
  });

  it('noms des composants et lignes de pile, sans adresse', () => {
    expect(componentNames('\n    at Dashboard (https://x/a.js:1:2)\n    at Suspense\n    at ErrorBoundary (https://x/a.js:3:4)\n    in App')).toEqual(['Dashboard', 'Suspense', 'ErrorBoundary', 'App']);
    expect(stackFrames('TypeError: x\n    at buildAgenda (https://x/assets/seasonal-1.js?v=2:10:20)\n    at https://x/assets/index-2.js:3:4\nfoo@https://x/a.js:5:6\nbar@https://x/b.js:7:8'))
      .toEqual(['buildAgenda (seasonal-1.js:10:20)', '? (index-2.js:3:4)', 'foo (a.js:5:6)']);
  });

  it('entrée : version de l\'app, type d\'erreur, où, quelle que soit la valeur levée', () => {
    const now = new Date('2026-10-29T10:00:00Z');
    const err = new TypeError('Cannot read properties of undefined (reading "amount")');
    err.stack = 'TypeError: x\n    at f (https://x/a.js:1:2)';
    expect(toEntry('script', err, null, now)).toEqual({
      at: '2026-10-29T10:00:00.000Z', version: APP_VERSION, source: 'script',
      message: 'TypeError: Cannot read properties of undefined (reading "…")', where: 'f (a.js:1:2)',
    });
    expect(toEntry('affichage', new Error('boum'), '\n at A (x)\n at B (y)', now).where).toBe('A < B');
    expect(toEntry('promesse', 'texte 42', null, now).message).toBe('texte #');
    expect(toEntry('promesse', null, null, now).message).toBe('Valeur rejetée (null)');
    expect(toEntry('promesse', { solde: 10 }, null, now)).not.toHaveProperty('where');
    expect(toEntry('promesse', { solde: 10 }, null, now).message).toBe('Valeur rejetée (object)');
  });

  it('20 entrées au plus, la plus récente en tête ; une répétition immédiate est comptée', () => {
    const e = (i: number): ErrorEntry => ({ at: `t${i}`, version: '1', source: 'script', message: `m${i}` });
    let j: ErrorEntry[] = [];
    for (let i = 0; i < 25; i++) j = appendEntry(j, e(i));
    expect(j).toHaveLength(MAX_ENTRIES);
    expect(j[0].message).toBe('m24');
    j = appendEntry(j, { ...e(24), at: 'plus tard' });
    j = appendEntry(j, { ...e(24), at: 'encore' });
    expect(j).toHaveLength(MAX_ENTRIES);
    expect(j[0]).toMatchObject({ at: 'encore', count: 3 });
    expect(formatErrorJournal(j.slice(0, 1))).toBe('encore · version 1 · script · ×3\nm24');
    expect(formatErrorJournal([{ ...e(1), where: 'A < B' }])).toBe('t1 · version 1 · script\nm1\nOù : A < B');
  });

  it('enregistre, relit et efface sur l\'appareil ; un journal abîmé repart de zéro', () => {
    recordError('affichage', new Error('a'));
    recordError('chargement', new Error('b'));
    expect(readErrorJournal().map(x => x.message)).toEqual(['Error: b', 'Error: a']);
    clearErrorJournal();
    expect(readErrorJournal()).toEqual([]);
    localStorage.setItem('pecule_error_journal', '[{"oops":1}]');
    expect(readErrorJournal()).toEqual([]);
  });

  it('ne lève jamais, même stockage bloqué', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('bloqué'); }, setItem: () => { throw new Error('bloqué'); } });
    expect(() => recordError('script', new Error('x'))).not.toThrow();
    expect(readErrorJournal()).toEqual([]);
  });

  it('écoute les erreurs et promesses non rattrapées, jusqu\'à l\'arrêt', () => {
    const target = new EventTarget() as unknown as Window;
    const stop = installErrorJournal(target);
    target.dispatchEvent(Object.assign(new Event('error'), { error: new RangeError('trop 3'), message: 'ignoré' }));
    target.dispatchEvent(Object.assign(new Event('error'), { error: null, message: 'Script error.' }));
    target.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason: new Error('réseau') }));
    expect(readErrorJournal().map(x => [x.source, x.message])).toEqual([
      ['promesse', 'Error: réseau'], ['script', 'Script error.'], ['script', 'RangeError: trop #'],
    ]);
    stop();
    target.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason: new Error('après') }));
    expect(readErrorJournal()).toHaveLength(3);
  });
});
