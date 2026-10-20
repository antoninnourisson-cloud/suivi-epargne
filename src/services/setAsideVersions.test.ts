// @vitest-environment jsdom
// Versions mises de côté : gardées 30 jours, 6 au plus, jamais écrasées si illisibles.
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { setAsideVersion, listSetAside, getSetAside, removeSetAside, pruneSetAside, clearSetAside, storeBeforeSetAside, type SetAsideVersion } from './setAsideVersions';

const KEY = 'suivi_epargne_set_aside';
const NOW = Date.parse('2026-10-14T10:00:00Z');
const DAY = 86_400_000;

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('versions mises de côté', () => {
  it('garde, liste par fichier Drive, relit puis retire', async () => {
    const a = await setAsideVersion({ reason: 'conflict', label: 'Version de Drive écartée', fileId: 'f1', data: { v: 1 } }, NOW);
    await setAsideVersion({ reason: 'restore', label: 'Avant restauration', fileId: 'f2', data: { v: 2 } }, NOW + 1000);
    expect((await listSetAside('f1', NOW + 2000)).map(e => e.id)).toEqual([a]);
    expect(await listSetAside(null, NOW + 2000)).toHaveLength(2);
    expect((await getSetAside(a))?.data).toEqual({ v: 1 });
    await removeSetAside(a);
    expect(await getSetAside(a)).toBeNull();
    expect(await listSetAside(null, NOW + 2000)).toHaveLength(1);
  });

  it('au-delà de 30 jours ou de 6 versions, les plus anciennes partent', () => {
    const entry = (i: number, ageDays: number): SetAsideVersion => ({
      id: String(i), setAsideAt: new Date(NOW - ageDays * DAY).toISOString(), reason: 'conflict', label: 'x', data: null,
    });
    const list = [entry(1, 31), entry(2, 1), entry(3, 2), entry(4, 3), entry(5, 4), entry(6, 5), entry(7, 6), entry(8, 7)];
    expect(pruneSetAside(list, NOW).map(e => e.id)).toEqual(['2', '3', '4', '5', '6', '7']);
  });

  it('une liste illisible n’est jamais écrasée : la mise de côté échoue', async () => {
    localStorage.setItem(KEY, 'enc1:illisible');
    await expect(setAsideVersion({ reason: 'conflict', label: 'x', data: {} }, NOW)).rejects.toThrow();
    expect(localStorage.getItem(KEY)).toBe('enc1:illisible');
    expect(await listSetAside(null, NOW)).toEqual([]);
  });

  it('stockage plein : les plus anciennes sont abandonnées, sinon échec signalé', async () => {
    await setAsideVersion({ reason: 'conflict', label: 'ancienne', data: { big: 'x' } }, NOW);
    const real = Storage.prototype.setItem;
    // Refuse toute liste de plus d'une version.
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k: string, v: string) {
      if (k === KEY && (JSON.parse(v) as unknown[]).length > 1) throw new DOMException('plein', 'QuotaExceededError');
      real.call(this, k, v);
    });
    const id = await setAsideVersion({ reason: 'conflict', label: 'nouvelle', data: {} }, NOW + 1000);
    expect((await listSetAside(null, NOW + 2000)).map(e => e.id)).toEqual([id]);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('plein', 'QuotaExceededError'); });
    await expect(setAsideVersion({ reason: 'conflict', label: 'refusée', data: {} }, NOW + 3000)).rejects.toThrow('SET_ASIDE_FULL');
    // Ce qui était déjà gardé reste en place.
    expect((await listSetAside(null, NOW + 4000)).map(e => e.id)).toEqual([id]);
  });

  it('la déconnexion efface tout, y compris une mise de côté en cours', async () => {
    await setAsideVersion({ reason: 'conflict', label: 'a', data: {} }, NOW);
    const pending = setAsideVersion({ reason: 'restore', label: 'b', data: {} }, NOW + 1000);
    await clearSetAside();
    await pending;
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(await listSetAside(null, NOW + 2000)).toEqual([]);
  });

  it('le miroir des saisies passe avant : les versions les plus anciennes lui laissent la place', async () => {
    const oldest = await setAsideVersion({ reason: 'conflict', label: 'ancienne', data: {} }, NOW);
    const middle = await setAsideVersion({ reason: 'conflict', label: 'moyenne', data: {} }, NOW + 1000);
    const newest = await setAsideVersion({ reason: 'conflict', label: 'récente', data: {} }, NOW + 2000);
    const real = Storage.prototype.setItem;
    // Plein tant que plus d'une version est gardée.
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k: string, v: string) {
      const kept = (JSON.parse(this.getItem(KEY) ?? '[]') as unknown[]).length;
      if (k === 'miroir' && kept > 1) throw new DOMException('plein', 'QuotaExceededError');
      real.call(this, k, v);
    });
    expect(await storeBeforeSetAside('miroir', 'saisies', () => true)).toBe(true);
    expect(localStorage.getItem('miroir')).toBe('saisies');
    const left = (await listSetAside(null, NOW + 3000)).map(e => e.id);
    expect(left).toEqual([newest]);
    expect(left).not.toContain(oldest);
    expect(left).not.toContain(middle);
  });

  it('rien à abandonner, ou écriture devenue inutile : échec sans rien retirer de plus', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('plein', 'QuotaExceededError'); });
    expect(await storeBeforeSetAside('miroir', 'saisies')).toBe(false);
    vi.restoreAllMocks();
    await setAsideVersion({ reason: 'conflict', label: 'a', data: {} }, NOW);
    const b = await setAsideVersion({ reason: 'conflict', label: 'b', data: {} }, NOW + 1000);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => { throw new DOMException('plein', 'QuotaExceededError'); });
    // Une écriture plus récente l'a remplacée : on s'arrête après avoir libéré une place.
    expect(await storeBeforeSetAside('miroir', 'ancienne saisie', () => false)).toBe(false);
    expect((await listSetAside(null, NOW + 2000)).map(e => e.id)).toEqual([b]);
  });
});
