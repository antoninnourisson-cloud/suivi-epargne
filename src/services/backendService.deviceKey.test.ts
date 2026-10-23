// @vitest-environment jsdom
// Session serveur liée à l'appareil : clé ECDSA non exportable rangée dans IndexedDB
// (fake-indexeddb), vrai WebCrypto, preuves sur le nonce rendu par le serveur et vérifiées
// par le code du serveur lui-même (worker/src/deviceProof.ts) : un jeton copié seul ne doit
// servir à rien.
import { IDBFactory } from 'fake-indexeddb';
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { verifyProof, parseDeviceKey, type DeviceKey } from '../../worker/src/deviceProof';

vi.stubEnv('VITE_BACKEND_URL', 'https://api.test');
type Backend = typeof import('./backendService');
let api: Backend;

// Nonce rendu par le faux serveur avec chaque réponse (en-tête X-Pecule-Nonce).
const NONCE = 'N'.repeat(43);
const NONCE2 = 'M'.repeat(43);
const json = (status: number, body: unknown = {}, nonce: string | null = NONCE) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', ...(nonce ? { 'X-Pecule-Nonce': nonce } : {}) },
});
type Call = { url: string; method: string; headers: Headers; body: Record<string, unknown> | null };
let calls: Call[];
let route: (c: Call) => Response | Promise<Response>;
let fetchMock: Mock<typeof fetch>;

const proofOf = (c: Call) => c.headers.get('X-Pecule-Proof');
const pathOf = (c: Call) => new URL(c.url).pathname;
const readRecord = () => new Promise<{ pair: CryptoKeyPair; session?: string; bound: boolean } | undefined>((resolve, reject) => {
  const open = indexedDB.open('pecule-device-key', 1);
  open.onupgradeneeded = () => open.result.createObjectStore('keys');
  open.onerror = () => reject(open.error);
  open.onsuccess = () => {
    const r = open.result.transaction('keys', 'readonly').objectStore('keys').get('session');
    r.onsuccess = () => { open.result.close(); resolve(r.result); };
    r.onerror = () => reject(r.error);
  };
});

beforeEach(async () => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.resetModules();
  api = await import('./backendService');
  localStorage.clear();
  calls = [];
  route = () => json(200, {});
  fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    const c: Call = {
      url: String(input), method: init?.method ?? 'GET', headers: new Headers(init?.headers),
      body: init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null,
    };
    calls.push(c);
    return route(c);
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); window.history.replaceState(null, '', '/'); });

/** Connexion complète : code échangé avec la clé de l'appareil, session gardée. */
const login = async (bound = true): Promise<DeviceKey> => {
  window.history.replaceState(null, '', '/#login_code=code-123');
  let key: DeviceKey | null = null;
  route = c => {
    key = parseDeviceKey(c.body?.key);
    return json(200, { session: 'jeton-de-session-0123456789', access_token: 'ya29', expires_in: 3599, ...(bound ? { bound: true } : {}) });
  };
  const res = await api.consumeLoginCode();
  api.saveBackendSession(res!.session);
  expect(key).not.toBeNull();
  return key!;
};

describe('session liée à l’appareil', () => {
  it('connexion : clé publique envoyée, clé privée NON exportable, puis chaque requête est signée', async () => {
    const key = await login();
    expect(calls[0].body).toMatchObject({ code: 'code-123', device: expect.any(String) });
    const record = await readRecord();
    expect(record).toMatchObject({ bound: true });
    expect(record!.pair.privateKey.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('jwk', record!.pair.privateKey)).rejects.toBeTruthy();

    route = () => json(200, { access_token: 'ya29.b', expires_in: 3599 });
    await api.fetchAccessToken();
    const tokenCall = calls.at(-1)!;
    expect(pathOf(tokenCall)).toBe('/token');
    // Signée sur le nonce rendu avec l'échange, sans aller-retour de plus.
    expect(calls).toHaveLength(2);
    expect(await verifyProof(key, proofOf(tokenCall), 'POST', '/token', [NONCE])).toBe('ok');
    // La même preuve ne vaut pas pour une autre route.
    expect(await verifyProof(key, proofOf(tokenCall), 'GET', '/backup', [NONCE])).toBe('invalid');
  });

  it('session restée sans clé : liée au premier appel (nonce demandé, puis preuve de possession), puis signée', async () => {
    api.saveBackendSession('ancienne-session-0123456789');
    let bound: DeviceKey | null = null;
    route = c => {
      if (pathOf(c) === '/auth/bind') {
        // Pas encore de nonce : le serveur en rend un, l'app signe et réessaie.
        if (!c.body?.proof) return json(401, { error: 'PROOF_REQUIRED', nonce: NONCE }, null);
        bound = parseDeviceKey(c.body?.key);
        return json(200, { ok: true, bound: true });
      }
      return json(200, { devices: [] });
    };
    await api.listPushDevices();
    expect(calls.map(pathOf)).toEqual(['/auth/bind', '/auth/bind', '/push/devices']);
    expect(await verifyProof(bound!, String(calls[1].body?.proof), 'POST', '/auth/bind', [NONCE])).toBe('ok');
    expect(calls[1].headers.get('Authorization')).toBe('Bearer ancienne-session-0123456789');
    expect(await verifyProof(bound!, proofOf(calls[2]), 'GET', '/push/devices', [NONCE])).toBe('ok');
    // Déjà liée : plus de nouvelle liaison.
    await api.listPushDevices();
    expect(calls.map(pathOf)).toEqual(['/auth/bind', '/auth/bind', '/push/devices', '/push/devices']);
  });

  it('serveur d’avant la liaison (404) : requêtes non signées, sans réessayer à chaque appel', async () => {
    api.saveBackendSession('ancienne-session-0123456789');
    route = c => (pathOf(c) === '/auth/bind' ? json(404, { error: 'NOT_FOUND' }) : json(200, { devices: [] }));
    await api.listPushDevices();
    await api.listPushDevices();
    expect(calls.map(pathOf)).toEqual(['/auth/bind', '/push/devices', '/push/devices']);
    expect(proofOf(calls[1])).toBeNull();
  });

  it('session déjà liée à une AUTRE clé (409) : inutilisable ici, effacée, reconnexion demandée', async () => {
    api.saveBackendSession('session-volee-ailleurs-0123');
    route = c => (pathOf(c) === '/auth/bind' ? json(409, { error: 'BOUND_ELSEWHERE' }) : json(200, {}));
    await expect(api.fetchAccessToken()).rejects.toThrow('SESSION_EXPIRED');
    expect(api.hasBackendSession()).toBe(false);
    expect(calls.map(pathOf)).toEqual(['/auth/bind']);
  });

  it('nonce périmé : le serveur en rend un nouveau, un seul nouvel essai signé avec lui', async () => {
    const key = await login();
    let n = 0;
    route = () => (n++ === 0 ? json(401, { error: 'PROOF_NONCE', nonce: NONCE2 }, NONCE2) : json(200, { access_token: 'ya29.c', expires_in: 3599 }, NONCE2));
    expect(await api.fetchAccessToken()).toEqual({ access_token: 'ya29.c', expires_in: 3599 });
    expect(calls).toHaveLength(3);
    expect(await verifyProof(key, proofOf(calls[1]), 'POST', '/token', [NONCE])).toBe('ok');
    expect(await verifyProof(key, proofOf(calls[2]), 'POST', '/token', [NONCE2])).toBe('ok');
    expect(api.hasBackendSession()).toBe(true);
    // Toujours refusé après le nouvel essai : pas de boucle, la session est fermée.
    route = () => json(401, { error: 'PROOF_NONCE', nonce: NONCE2 }, NONCE2);
    await expect(api.fetchAccessToken()).rejects.toThrow('SESSION_EXPIRED');
    expect(calls).toHaveLength(5);
  });

  it('page rechargée : la première requête, sans nonce, est refusée avec un nonce puis renvoyée signée', async () => {
    const key = await login();
    vi.resetModules();
    api = await import('./backendService'); // plus rien en mémoire
    route = c => (proofOf(c) ? json(200, { access_token: 'ya29.e', expires_in: 3599 }) : json(401, { error: 'PROOF_REQUIRED', nonce: NONCE2 }, NONCE2));
    expect(await api.fetchAccessToken()).toEqual({ access_token: 'ya29.e', expires_in: 3599 });
    const [first, retry] = calls.slice(-2);
    expect(proofOf(first)).toBeNull();
    expect(await verifyProof(key, proofOf(retry), 'POST', '/token', [NONCE2])).toBe('ok');
  });

  it('serveur d’avant la liaison au moment de la connexion : liaison tentée au premier appel', async () => {
    await login(false);
    expect(await readRecord()).toMatchObject({ bound: false });
    route = c => (pathOf(c) === '/auth/bind' ? json(200, { ok: true, bound: true }) : json(200, { sessions: [] }));
    await api.listServerSessions();
    expect(calls.slice(1).map(pathOf)).toEqual(['/auth/bind', '/auth/sessions']);
    expect(await readRecord()).toMatchObject({ bound: true });
  });

  it('clé momentanément illisible au démarrage : ni nouvelle clé, ni session effacée ; la vraie clé resert ensuite', async () => {
    const key = await login();
    const real = indexedDB;
    let fail = true;
    vi.stubGlobal('indexedDB', { open: (...a: Parameters<IDBFactory['open']>) => { if (fail) throw new Error('connexion perdue'); return real.open(...a); } });
    vi.resetModules();
    api = await import('./backendService'); // page rechargée : rien en mémoire
    route = c => (proofOf(c) ? json(200, { access_token: 'ya29.d', expires_in: 3599 }) : json(401, { error: 'PROOF_REQUIRED' }));
    await expect(api.fetchAccessToken()).rejects.toThrow(TypeError); // comme hors ligne
    expect(api.hasBackendSession()).toBe(true);
    expect(calls.map(pathOf)).not.toContain('/auth/bind');
    fail = false;
    expect(await api.fetchAccessToken()).toEqual({ access_token: 'ya29.d', expires_in: 3599 });
    expect(await verifyProof(key, proofOf(calls.at(-1)!), 'POST', '/token', [NONCE])).toBe('ok');
  });

  it('déconnexion : la clé de l’appareil est effacée avec la session', async () => {
    await login();
    route = () => json(200, { ok: true });
    await api.backendLogout();
    expect(proofOf(calls.at(-1)!)).not.toBeNull();
    await vi.waitFor(async () => expect(await readRecord()).toBeUndefined());
  });
});

describe('appareils connectés et alerte', () => {
  beforeEach(async () => { await login(); });

  it('liste les sessions, en déconnecte une ; déconnecter celle-ci efface la session locale', async () => {
    const sessions = [{ id: 'a', device: 'iPhone (Safari)', createdAt: null, lastUsedAt: '2026-10-20T00:00:00.000Z', bound: true, current: false }];
    route = () => json(200, { sessions });
    expect(await api.listServerSessions()).toEqual(sessions);
    route = () => json(200, { ok: true, current: false });
    await api.revokeServerSession('a');
    expect(calls.at(-1)!.body).toEqual({ id: 'a' });
    expect(api.hasBackendSession()).toBe(true);
    route = () => json(200, { ok: true, current: true });
    await api.revokeServerSession('b');
    expect(api.hasBackendSession()).toBe(false);
  });

  it('« Code oublié » : alerte envoyée avec la date de la demande ; hors ligne = à réessayer ; sans session = plus tard', async () => {
    const at = new Date('2026-10-20T12:00:00.000Z');
    route = () => json(200, { ok: true, delivered: 1 });
    expect(await api.notifyLockResetRequested(at)).toBe('sent');
    expect(pathOf(calls.at(-1)!)).toBe('/alert/lock-reset');
    expect(calls.at(-1)!.body).toMatchObject({ requestedAt: '2026-10-20T12:00:00.000Z', device: expect.any(String) });
    route = () => { throw new TypeError('Failed to fetch'); };
    expect(await api.notifyLockResetRequested(at)).toBe('failed');
    route = () => json(500, {});
    expect(await api.notifyLockResetRequested(at)).toBe('failed');
    route = () => json(401, { error: 'PROOF_NONCE', nonce: NONCE2 }, NONCE2); // nouvel essai refusé aussi
    expect(await api.notifyLockResetRequested(at)).toBe('failed');
    route = () => json(401, { error: 'REAUTH_REQUIRED' }, null);
    expect(await api.notifyLockResetRequested(at)).toBe('no-session');
    localStorage.clear();
    expect(await api.notifyLockResetRequested(at)).toBe('no-session');
  });

  it('suppression des données serveur : date d’effacement des copies de secours rendue', async () => {
    route = () => json(200, { ok: true, googleRevoked: true, backupsDeletionAt: '2026-10-27T10:00:00.000Z' });
    expect(await api.deleteServerAccount()).toEqual({ backupsDeletionAt: '2026-10-27T10:00:00.000Z' });
    expect(api.hasBackendSession()).toBe(false);
  });
});
