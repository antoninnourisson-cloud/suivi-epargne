// @vitest-environment jsdom
// Navigateur qui ne peut pas garder la clé de chiffrement (IndexedDB bloquée), dans l'app
// publiée : les modifications pas encore sur Drive doivent rester sur l'appareil (en clair,
// faute de mieux), la copie hors ligne (simple double de Drive) n'est jamais écrite en clair.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { GlobalAppData } from '../../types';
import { BACKUP_KEY, OFFLINE_KEY, PENDING_KEY } from './keys';

type Copies = typeof import('./localCopies');
const load = async (): Promise<Copies> => { vi.resetModules(); return import('./localCopies'); };

const data = { accounts: [{ id: 'a', totalAmount: 4321 }] } as unknown as GlobalAppData;
const until = async (check: () => boolean) => {
  for (let i = 0; i < 50 && !check(); i++) await new Promise(r => setTimeout(r, 5));
};

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('indexedDB', { open: () => { throw new Error('bloqué'); } });
  vi.stubEnv('MODE', 'production');
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); localStorage.clear(); });

describe('copies locales sans clé de chiffrement (app publiée)', () => {
  it('le miroir des modifications pas encore envoyées est gardé', async () => {
    const { createMirror } = await load();
    createMirror(() => 'file-1', () => '').write(data);
    await until(() => localStorage.getItem(BACKUP_KEY) !== null);
    expect(JSON.parse(localStorage.getItem(BACKUP_KEY)!)).toMatchObject({ fileId: 'file-1', data });
  });

  it('la quarantaine (modifications jamais envoyées) est gardée', async () => {
    const { createPendingStore } = await load();
    const ok = await createPendingStore(() => 1).replace({ savedAt: '2026-10-20T08:00:00.000Z', fileId: 'file-1', data }, 'file-1');
    expect(ok).toBe(true);
    expect(JSON.parse(localStorage.getItem(PENDING_KEY)!)).toMatchObject({ fileId: 'file-1', data });
  });

  it('la copie hors ligne n’est pas écrite en clair', async () => {
    const { createOfflineStore } = await load();
    createOfflineStore(() => 1).remember('file-1', data);
    await new Promise(r => setTimeout(r, 30));
    expect(localStorage.getItem(OFFLINE_KEY)).toBeNull();
  });
});
