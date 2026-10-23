// @vitest-environment jsdom
// Clé du coffre local créée par deux onglets ouverts en même temps pour la première fois :
// une seule clé doit survivre, et les copies chiffrées par les deux onglets rester lisibles.
import { IDBFactory } from 'fake-indexeddb';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type Vault = typeof import('./localVault');
// Un module neuf = un onglet (la clé est mise en cache dans le module).
const newTab = async (): Promise<Vault> => { vi.resetModules(); return import('./localVault'); };
const sample = { savedAt: '2026-10-20T10:00:00.000Z', data: { accounts: [{ id: 'a', totalAmount: 42 }] } };

beforeEach(() => { vi.stubGlobal('indexedDB', new IDBFactory()); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('coffre local : première clé', () => {
  it('two tabs creating the key at once end up sharing one key', async () => {
    const tabA = await newTab();
    const tabB = await newTab();
    const [fromA, fromB] = await Promise.all([tabA.sealJSON(sample), tabB.sealJSON(sample)]);
    const later = await newTab();
    expect(await later.openJSON(fromA)).toEqual(sample);
    expect(await later.openJSON(fromB)).toEqual(sample);
  });
});
