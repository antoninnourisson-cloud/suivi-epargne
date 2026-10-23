// @vitest-environment jsdom
// Abri des copies jamais envoyées illisibles pour l'instant (stockage protégé indisponible) :
// elles ne sont jamais écrasées par la quarantaine, sont relues au chargement, et quittent
// l'abri seulement une fois proposées ou mises de côté.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { GlobalAppData } from '../../types';
import { BACKUP_KEY, HELD_KEY, PENDING_KEY } from './keys';
import {
  createPendingStore, dropLostCopies, heldCopies, holdCopy, holdUnavailableCopies, newestUnsyncedCopy, readHeldCopies, releaseHeldCopies, removeStoredCopy,
} from './localCopies';
import { canonicalize } from '../../lib/schema';
import { listSetAside } from '../../services/setAsideVersions';
import type { StoredSnapshot } from './syncShared';

// jsdom n'a pas d'IndexedDB : une copie « enc1: » est illisible pour l'instant (VAULT_UNAVAILABLE),
// une copie en JSON se relit.
const SEALED = 'enc1:AAAA.BBBB';
const dataOf = (n: number) => ({ accounts: [{ id: 'a', totalAmount: n }] }) as unknown as GlobalAppData;
const snap = (n: number, savedAt = '2026-10-05T10:00:00.000Z', fileId = 'file-1'): StoredSnapshot => ({ savedAt, fileId, data: dataOf(n) });

beforeEach(() => { localStorage.clear(); });
afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

describe('abri des copies illisibles pour l’instant', () => {
  it('la quarantaine met à l’abri une copie illisible pour l’instant avant de la remplacer', async () => {
    localStorage.setItem(PENDING_KEY, SEALED);
    const ok = await createPendingStore(() => 1).replace(snap(10), 'file-1');
    expect(ok).toBe(true);
    expect(readHeldCopies()).toEqual([SEALED]);
    expect(JSON.parse(localStorage.getItem(PENDING_KEY)!)).toMatchObject({ fileId: 'file-1' });
  });

  it('une copie définitivement abîmée n’est pas mise à l’abri (rien à en tirer)', async () => {
    localStorage.setItem(PENDING_KEY, '{abîmée');
    await createPendingStore(() => 1).replace(snap(10), 'file-1');
    expect(localStorage.getItem(HELD_KEY)).toBeNull();
  });

  it('déplace à l’abri les copies illisibles pour l’instant, pas les copies perdues', () => {
    localStorage.setItem(BACKUP_KEY, SEALED);
    localStorage.setItem(PENDING_KEY, '{abîmée');
    const kept = holdUnavailableCopies([
      { key: BACKUP_KEY, stored: SEALED, lost: false },
      { key: PENDING_KEY, stored: '{abîmée', lost: true },
    ]);
    expect(kept).toEqual([
      { key: HELD_KEY, stored: SEALED, lost: false },
      { key: PENDING_KEY, stored: '{abîmée', lost: true },
    ]);
    expect(localStorage.getItem(BACKUP_KEY)).toBeNull();
    expect(localStorage.getItem(PENDING_KEY)).toBe('{abîmée');
    expect(readHeldCopies()).toEqual([SEALED]);
    // Déjà à l'abri : rien ne change, pas de doublon.
    expect(holdCopy(SEALED)).toBe(true);
    expect(readHeldCopies()).toEqual([SEALED]);
  });

  it('stockage plein : la copie reste à sa place', () => {
    localStorage.setItem(BACKUP_KEY, SEALED);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceededError'); });
    const kept = holdUnavailableCopies([{ key: BACKUP_KEY, stored: SEALED, lost: false }]);
    expect(kept[0].key).toBe(BACKUP_KEY);
    expect(localStorage.getItem(BACKUP_KEY)).toBe(SEALED);
  });

  it('au chargement, l’abri est relu avec les autres copies', async () => {
    const readable = JSON.stringify(snap(20));
    const synced = JSON.stringify(snap(30));
    localStorage.setItem(HELD_KEY, JSON.stringify([SEALED, readable, synced]));
    const reference = canonicalize(dataOf(30));
    const { newest, unreadable, held } = await newestUnsyncedCopy('file-1', reference, [], heldCopies(), true);
    expect(newest?.data).toEqual(dataOf(20));
    expect(held.map(h => h.stored)).toEqual([readable]);
    // Toujours illisible : signalé, gardé à l'abri ; identique à Drive : retiré.
    expect(unreadable).toEqual([{ key: HELD_KEY, stored: SEALED, lost: false }]);
    expect(readHeldCopies()).toEqual([SEALED, readable]);
  });

  it('une copie redevenue lisible quitte l’abri une fois proposée ou mise de côté', async () => {
    const newer = { stored: JSON.stringify(snap(20, '2026-10-06T10:00:00.000Z')), snap: snap(20, '2026-10-06T10:00:00.000Z') };
    const older = { stored: JSON.stringify(snap(10)), snap: snap(10) };
    localStorage.setItem(HELD_KEY, JSON.stringify([older.stored, newer.stored]));
    // La plus récente n'a pas pu être écrite en quarantaine : elle reste à l'abri.
    await releaseHeldCopies([older, newer], newer.snap, false);
    expect(readHeldCopies()).toEqual([newer.stored]);
    expect((await listSetAside('file-1')).map(v => v.data)).toEqual([dataOf(10)]);
    await releaseHeldCopies([newer], newer.snap, true);
    expect(localStorage.getItem(HELD_KEY)).toBeNull();
  });

  it('mise de côté impossible : la copie reste à l’abri', async () => {
    const older = { stored: JSON.stringify(snap(10)), snap: snap(10) };
    localStorage.setItem(HELD_KEY, JSON.stringify([older.stored]));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceededError'); });
    await releaseHeldCopies([older], null, false);
    expect(readHeldCopies()).toEqual([older.stored]);
  });

  it('« Compris » retire de l’abri une copie définitivement illisible', () => {
    localStorage.setItem(HELD_KEY, JSON.stringify(['{abîmée', SEALED]));
    dropLostCopies([{ key: HELD_KEY, stored: '{abîmée', lost: true }, { key: HELD_KEY, stored: SEALED, lost: false }]);
    expect(readHeldCopies()).toEqual([SEALED]);
    removeStoredCopy(HELD_KEY, SEALED);
    expect(localStorage.getItem(HELD_KEY)).toBeNull();
  });

  it('un abri abîmé est ignoré', () => {
    localStorage.setItem(HELD_KEY, '{"pas":"une liste"}');
    expect(readHeldCopies()).toEqual([]);
    expect(heldCopies()).toEqual([]);
  });
});
