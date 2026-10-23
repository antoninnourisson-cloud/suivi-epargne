// @vitest-environment jsdom
// Copie locale chiffrée (modifications pas encore sur Drive), avec une vraie IndexedDB
// simulée (fake-indexeddb) et le vrai WebCrypto : la copie ne doit jamais être lisible sur
// le disque, ni se perdre quand on la relit.
import { IDBFactory } from 'fake-indexeddb';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type Vault = typeof import('./localVault');
// La clé est mise en cache dans le module : un module neuf par test (comme une page rechargée).
const freshVault = async (): Promise<Vault> => { vi.resetModules(); return import('./localVault'); };

// Une IndexedDB vide par test ; « effacer les données du site » = une nouvelle base vide.
const wipeDatabase = () => { vi.stubGlobal('indexedDB', new IDBFactory()); };

const sample = { savedAt: '2026-10-19T10:00:00.000Z', fileId: 'file-1', data: { accounts: [{ id: 'a', totalAmount: 1234.56 }] } };

beforeEach(() => { wipeDatabase(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('coffre local (copie des modifications pas encore sur Drive)', () => {
  it('chiffre la copie (préfixe enc1:, aucun montant lisible) et la relit à l’identique', async () => {
    const vault = await freshVault();
    const sealed = await vault.sealJSON(sample);
    expect(sealed.startsWith('enc1:')).toBe(true);
    expect(sealed).not.toContain('1234');
    expect(sealed).not.toContain('file-1');
    expect(await vault.openJSON(sealed)).toEqual(sample);
    // Vecteur d'initialisation neuf à chaque copie : deux copies identiques ne se ressemblent pas.
    expect(await vault.sealJSON(sample)).not.toBe(sealed);
  });

  it('la clé est gardée dans IndexedDB : relue après un rechargement de la page', async () => {
    const sealed = await (await freshVault()).sealJSON(sample);
    const reloaded = await freshVault();
    expect(await reloaded.openJSON(sealed)).toEqual(sample);
  });

  it('une ancienne copie en clair reste lisible', async () => {
    const vault = await freshVault();
    expect(await vault.openJSON(JSON.stringify(sample))).toEqual(sample);
  });

  it('sans IndexedDB, dans l’app publiée : modifications gardées en clair plutôt que perdues, copie hors ligne refusée, copie chiffrée signalée illisible', async () => {
    const sealed = await (await freshVault()).sealJSON(sample);
    vi.stubGlobal('indexedDB', undefined);
    vi.stubEnv('MODE', 'production');
    try {
      const vault = await freshVault();
      expect(JSON.parse(await vault.sealJSON(sample))).toEqual(sample);
      await expect(vault.sealJSON(sample, { encryptedOnly: true })).rejects.toThrow('VAULT_UNAVAILABLE');
      await expect(vault.openJSON(sealed)).rejects.toThrow('VAULT_UNAVAILABLE');
    } finally { vi.unstubAllEnvs(); }
  });

  it('tests unitaires seulement (jsdom sans IndexedDB) : copie lisible, pour les tests des écrans', async () => {
    vi.stubGlobal('indexedDB', undefined);
    const vault = await freshVault();
    expect(JSON.parse(await vault.sealJSON(sample))).toEqual(sample);
  });

  it('base effacée (nouvelle clé) : la copie chiffrée avec l’ancienne clé est refusée, jamais lue de travers', async () => {
    const sealed = await (await freshVault()).sealJSON(sample);
    wipeDatabase();
    const vault = await freshVault();
    await expect(vault.openJSON(sealed)).rejects.toBeTruthy();
    // La nouvelle clé fonctionne normalement.
    expect(await vault.openJSON(await vault.sealJSON(sample))).toEqual(sample);
  });

  it('IndexedDB bloquée (stockage refusé) : copie hors ligne jamais en clair, même dans les tests', async () => {
    vi.stubGlobal('indexedDB', { open: () => { throw new Error('bloqué'); } });
    const vault = await freshVault();
    await expect(vault.sealJSON(sample, { encryptedOnly: true })).rejects.toThrow('VAULT_UNAVAILABLE');
    expect(JSON.parse(await vault.sealJSON(sample))).toEqual(sample);
  });

  it('échec passager : un nouvel essai réussit, avec la même clé (les copies restent lisibles)', async () => {
    const sealed = await (await freshVault()).sealJSON(sample);
    const real = indexedDB;
    let fail = true;
    vi.stubGlobal('indexedDB', { open: (...a: Parameters<IDBFactory['open']>) => { if (fail) throw new Error('occupée'); return real.open(...a); } });
    const vault = await freshVault();
    await expect(vault.sealJSON(sample, { encryptedOnly: true })).rejects.toThrow('VAULT_UNAVAILABLE');
    fail = false;
    expect(await vault.openJSON(sealed)).toEqual(sample);
    expect((await vault.sealJSON(sample, { encryptedOnly: true })).startsWith('enc1:')).toBe(true);
  });
});
