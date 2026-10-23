import { afterEach, describe, expect, it, vi } from 'vitest';
import { lsDel, lsGet, lsGetJSON, lsSet, lsSetJSON } from './storage';

const memoryStorage = () => {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
  };
};

const blockedStorage = {
  getItem: () => { throw new Error('SecurityError'); },
  setItem: () => { throw new Error('QuotaExceededError'); },
  removeItem: () => { throw new Error('SecurityError'); },
};

afterEach(() => { vi.unstubAllGlobals(); });

describe('stockage local sans erreur', () => {
  it('lit, écrit et efface', () => {
    vi.stubGlobal('localStorage', memoryStorage());
    expect(lsGet('k')).toBeNull();
    lsSet('k', 'v');
    expect(lsGet('k')).toBe('v');
    lsDel('k');
    expect(lsGet('k')).toBeNull();
  });

  it('lit et écrit du JSON, avec une valeur par défaut si absent ou illisible', () => {
    vi.stubGlobal('localStorage', memoryStorage());
    expect(lsGetJSON('j', { a: 0 })).toEqual({ a: 0 });
    lsSetJSON('j', { a: 1 });
    expect(lsGetJSON('j', { a: 0 })).toEqual({ a: 1 });
    lsSet('j', '{pas du json');
    expect(lsGetJSON('j', [])).toEqual([]);
  });

  it('rend la valeur par défaut quand le validateur refuse la valeur lue', () => {
    vi.stubGlobal('localStorage', memoryStorage());
    const isRange = (v: unknown): v is { start: string } => !!v && typeof (v as { start?: unknown }).start === 'string';
    lsSetJSON('r', { start: 7 });
    expect(lsGetJSON('r', { start: 'défaut' }, isRange)).toEqual({ start: 'défaut' });
    lsSetJSON('r', { start: '2026-01-01' });
    expect(lsGetJSON('r', { start: 'défaut' }, isRange)).toEqual({ start: '2026-01-01' });
  });

  it('ne lève jamais quand le stockage est bloqué', () => {
    vi.stubGlobal('localStorage', blockedStorage);
    expect(lsGet('k')).toBeNull();
    expect(lsGetJSON('k', 'défaut')).toBe('défaut');
    expect(() => { lsSet('k', 'v'); lsSetJSON('k', {}); lsDel('k'); }).not.toThrow();
  });
});
