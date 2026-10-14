import { afterEach, describe, it, expect, vi } from 'vitest';
import { clearStoredDrafts, loadStoredDrafts, saveStoredDrafts, UPDATE_DRAFTS_KEY, type Draft } from './draft';

const fakeStorage = () => {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
    has: (k: string) => m.has(k),
  };
};
const d = (over: Partial<Draft> = {}): Draft => ({ owned: '8200', parental: '7000', date: '2026-10-14', deposits: '', cashFlow: 0, ...over });

afterEach(() => { vi.unstubAllGlobals(); });

describe('conservation de la saisie « Actualiser »', () => {
  it('garde seulement les comptes modifiés, les restitue, puis les efface', () => {
    const s = fakeStorage();
    vi.stubGlobal('sessionStorage', s);
    saveStoredDrafts({ la: d({ owned: '12345', touched: ['owned'] }), lep: d() }, 1000);
    expect(Object.keys(loadStoredDrafts(2000))).toEqual(['la']);
    expect(loadStoredDrafts(2000).la).toMatchObject({ owned: '12345', touched: ['owned'], cashFlow: 0 });
    clearStoredDrafts();
    expect(s.has(UPDATE_DRAFTS_KEY)).toBe(false);
    // Plus rien de modifié : la clé disparaît.
    saveStoredDrafts({ la: d({ touched: ['owned'] }) }, 1000);
    saveStoredDrafts({ la: d({ touched: [] }) }, 1000);
    expect(s.has(UPDATE_DRAFTS_KEY)).toBe(false);
  });

  it('ignore une saisie périmée ou abîmée, et survit à un stockage indisponible', () => {
    const s = fakeStorage();
    vi.stubGlobal('sessionStorage', s);
    saveStoredDrafts({ la: d({ touched: ['owned'] }) }, 0);
    expect(loadStoredDrafts(13 * 3600 * 1000)).toEqual({});
    s.setItem(UPDATE_DRAFTS_KEY, '{pas du json');
    expect(loadStoredDrafts()).toEqual({});
    s.setItem(UPDATE_DRAFTS_KEY, JSON.stringify({ at: Date.now(), drafts: { la: { owned: 1 }, lep: { ...d(), touched: ['owned'], cashFlow: 'x' } } }));
    expect(loadStoredDrafts()).toEqual({ lep: { ...d(), touched: ['owned'] } });
    vi.stubGlobal('sessionStorage', { getItem: () => { throw new Error('bloqué'); }, setItem: () => { throw new Error('bloqué'); }, removeItem: () => { throw new Error('bloqué'); } });
    expect(() => saveStoredDrafts({ la: d({ touched: ['owned'] }) })).not.toThrow();
    expect(loadStoredDrafts()).toEqual({});
    expect(() => clearStoredDrafts()).not.toThrow();
  });
});
