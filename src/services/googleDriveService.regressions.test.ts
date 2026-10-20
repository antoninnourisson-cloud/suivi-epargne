// @vitest-environment jsdom
// Non-régression du service Drive : chaque test correspond à un ancien défaut décrit dans les
// commentaires de googleDriveService.ts (fichier vide en double, session perdue à tort,
// sauvegarde figée, révision vide, copies mensuelles).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const backend = vi.hoisted(() => ({
  enabled: true,
  session: true,
  refresh: null as null | (() => Promise<{ access_token: string; expires_in: number }>),
  refreshCalls: 0,
  logouts: 0,
}));

vi.mock('./backendService', () => ({
  isBackendEnabled: () => backend.enabled,
  hasBackendSession: () => backend.session,
  fetchAccessToken: async () => { backend.refreshCalls += 1; return backend.refresh!(); },
  consumeLoginCode: async () => null,
  saveBackendSession: () => {},
  startBackendLogin: () => {},
  backendLogout: async () => { backend.logouts += 1; },
}));

import {
  findConfigFiles, readConfigFile, updateConfigFile, writeMonthlyBackup, listBackups, setOnAuthLost, handleSignOut,
  getFileRevision, ApiError,
} from './googleDriveService';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const storeToken = (token: string, validMs = 3_600_000) => {
  localStorage.setItem('google_token', JSON.stringify({ access_token: token }));
  localStorage.setItem('token_expiry', String(Date.now() + validMs));
  localStorage.setItem('auth_persistence', 'true');
};
const bearer = (init?: RequestInit) => (init?.headers as Record<string, string> | undefined)?.Authorization;

let authLost: ReturnType<typeof vi.fn>;
beforeEach(() => {
  backend.enabled = true;
  backend.session = true;
  backend.refresh = async () => ({ access_token: 'fresh', expires_in: 3600 });
  backend.refreshCalls = 0;
  backend.logouts = 0;
  localStorage.clear();
  storeToken('old');
  authLost = vi.fn();
  setOnAuthLost(authLost as unknown as () => void);
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); setOnAuthLost(null); });

describe('recherche du fichier de données : une panne n’est jamais « aucun fichier »', () => {
  it.each([
    [503, 'backendError'],
    [403, 'rateLimitExceeded'],
    [500, undefined],
  ])('Drive répond %i : la recherche échoue (sinon un second fichier vide serait créé)', async (status, reason) => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: { errors: reason ? [{ reason }] : [] } }, status)));
    const err = await findConfigFiles().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status, reason });
  });

  it('tri refait sur la date de modification, même si Drive renvoie un autre ordre', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ files: [
      { id: 'b', modifiedTime: '2026-10-01T00:00:00Z' },
      { id: 'c' },
      { id: 'a', modifiedTime: '2026-10-18T00:00:00Z' },
    ] })));
    expect((await findConfigFiles()).map(f => f.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('session : rafraîchissement et perte', () => {
  it('401 puis rafraîchissement réussi : la requête est rejouée avec le nouveau jeton', async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) =>
      bearer(init) === 'Bearer fresh' ? json({ v: 1 }) : json({}, 401));
    vi.stubGlobal('fetch', fetchMock);
    expect(await readConfigFile('f')).toEqual({ v: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(backend.refreshCalls).toBe(1);
    expect(authLost).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem('google_token')!).access_token).toBe('fresh');
  });

  it('deux 401 de suite : SESSION_EXPIRED, jetons effacés, bannière de reconnexion demandée', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({}, 401)));
    await expect(readConfigFile('f')).rejects.toThrow('SESSION_EXPIRED');
    expect(authLost).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('google_token')).toBeNull();
    expect(localStorage.getItem('auth_persistence')).toBeNull();
  });

  it('serveur injoignable pendant le rafraîchissement : « hors ligne » (TypeError), la session reste', async () => {
    backend.refresh = async () => { throw new TypeError('Failed to fetch'); };
    vi.stubGlobal('fetch', vi.fn(async () => json({}, 401)));
    const err = await readConfigFile('f').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TypeError);
    expect(authLost).not.toHaveBeenCalled();
    expect(localStorage.getItem('auth_persistence')).toBe('true');
  });

  it('rafraîchissement refusé par le serveur : SESSION_EXPIRED', async () => {
    backend.refresh = async () => { throw new Error('SESSION_EXPIRED'); };
    vi.stubGlobal('fetch', vi.fn(async () => json({}, 401)));
    await expect(readConfigFile('f')).rejects.toThrow('SESSION_EXPIRED');
    expect(authLost).toHaveBeenCalledTimes(1);
  });

  it('jeton expiré : rafraîchi AVANT la requête, une seule fois pour des appels simultanés', async () => {
    storeToken('old', -1000);
    let release: () => void = () => {};
    backend.refresh = () => new Promise(resolve => { release = () => resolve({ access_token: 'fresh', expires_in: 3600 }); });
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => json({ token: bearer(init) }));
    vi.stubGlobal('fetch', fetchMock);
    const both = Promise.all([readConfigFile('a'), readConfigFile('b')]);
    await vi.waitFor(() => expect(backend.refreshCalls).toBe(1));
    release();
    expect(await both).toEqual([{ token: 'Bearer fresh' }, { token: 'Bearer fresh' }]);
    expect(backend.refreshCalls).toBe(1);
  });

  it('jeton effacé pendant le rafraîchissement (déconnexion) : SESSION_EXPIRED explicite, jamais une TypeError « hors ligne »', async () => {
    storeToken('old', -1000);
    backend.refresh = async () => {
      // La déconnexion tombe pendant l'attente : storeToken écrira le jeton, mais il est
      // effacé aussitôt après (handleSignOut).
      setTimeout(() => localStorage.removeItem('google_token'), 0);
      await new Promise(r => setTimeout(r, 5));
      return { access_token: 'fresh', expires_in: 3600 };
    };
    const setItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k: string, v: string) {
      if (k !== 'google_token') setItem.call(this, k, v);
    });
    vi.stubGlobal('fetch', vi.fn(async () => json({})));
    const err = await readConfigFile('f').catch((e: unknown) => e);
    vi.mocked(Storage.prototype.setItem).mockRestore();
    expect(err).not.toBeInstanceOf(TypeError);
    expect((err as Error).message).toBe('SESSION_EXPIRED');
  });

  it('aucune session sur l’appareil : NO_TOKEN, sans appel réseau', async () => {
    localStorage.clear();
    backend.session = false;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(readConfigFile('f')).rejects.toThrow('NO_TOKEN');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('délai maximal des requêtes', () => {
  it('une requête qui ne répond jamais échoue en « hors ligne » après 30 s (la sauvegarde ne reste pas figée)', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_url: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    })));
    const pending = readConfigFile('f').catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(29_000);
    let settled = false;
    void pending.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1_500);
    const err = await pending;
    expect(err).toBeInstanceOf(TypeError);
    expect((err as Error).message).toBe('NETWORK_TIMEOUT');
  });
});

describe('révision après écriture', () => {
  it('réponse du PATCH sans headRevisionId : la révision est relue, jamais vide', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${String(url)}`);
      if (init?.method === 'PATCH') return json({});
      return json({ headRevisionId: 'r5' });
    }));
    expect(await updateConfigFile('f', { v: 1 }, null)).toBe('r5');
    expect(calls).toHaveLength(2);
  });

  it('révision illisible : erreur, jamais une chaîne vide qui désactiverait le contrôle de concurrence', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({})));
    await expect(getFileRevision('f')).rejects.toThrow('REVISION_UNAVAILABLE');
    await expect(updateConfigFile('f', { v: 1 }, null)).rejects.toThrow('REVISION_UNAVAILABLE');
  });
});

describe('copies mensuelles', () => {
  const backups = (n: number) => Array.from({ length: n }, (_, i) => {
    const month = `2025-${String(i + 1).padStart(2, '0')}`;
    return { id: `b-${month}`, name: `suivi_epargne_backup_${month}.json`, createdTime: `${month}-01T00:00:00Z` };
  });
  const fakeDrive = (existing: { id: string; name: string; createdTime: string }[]) => {
    const calls: { method: string; url: string; body?: string }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ method, url: String(url), body: typeof init?.body === 'string' ? init.body : undefined });
      if (method === 'GET') return json({ files: [...existing, { id: 'x', name: 'autre.json', createdTime: '2025-01-01' }] });
      if (method === 'POST') return json({ id: 'nouvelle' });
      return json({});
    }));
    return calls;
  };

  it('liste : seules les copies, avec leur mois', async () => {
    fakeDrive(backups(2));
    expect((await listBackups()).map(b => b.month)).toEqual(['2025-01', '2025-02']);
  });

  it('12 copies déjà gardées : la nouvelle est créée et seule la plus ancienne part à la corbeille', async () => {
    const calls = fakeDrive(backups(12));
    expect(await writeMonthlyBackup('2026-10', { v: 1 })).toBe(true);
    expect(calls.filter(c => c.method === 'POST')).toHaveLength(1);
    const trashed = calls.filter(c => c.method === 'PATCH');
    expect(trashed).toHaveLength(1);
    expect(trashed[0].url).toContain('/files/b-2025-01');
    expect(JSON.parse(trashed[0].body!)).toEqual({ trashed: true });
  });

  it('copie du mois déjà présente : rien n’est créé ni supprimé', async () => {
    const calls = fakeDrive(backups(3));
    expect(await writeMonthlyBackup('2025-02', { v: 1 })).toBe(false);
    expect(calls.filter(c => c.method !== 'GET')).toHaveLength(0);
  });

  it('une corbeille impossible n’empêche pas la copie', async () => {
    fakeDrive(backups(12));
    const base = vi.mocked(fetch);
    vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL, init?: RequestInit) =>
      init?.method === 'PATCH' ? json({}, 500) : base(url, init)));
    expect(await writeMonthlyBackup('2026-10', { v: 1 })).toBe(true);
  });
});

describe('déconnexion', () => {
  it('mode serveur : seule la session de cet appareil est fermée, aucune révocation Google', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await handleSignOut();
    expect(backend.logouts).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(localStorage.getItem('google_token')).toBeNull();
  });

  it('sans serveur et sans SDK chargé : révocation directe du jeton', async () => {
    backend.enabled = false;
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await handleSignOut();
    expect(backend.logouts).toBe(0);
    expect(fetchMock).toHaveBeenCalledWith('https://oauth2.googleapis.com/revoke', expect.objectContaining({ method: 'POST', mode: 'no-cors', body: 'token=old' }));
    expect(localStorage.getItem('token_expiry')).toBeNull();
  });
});
