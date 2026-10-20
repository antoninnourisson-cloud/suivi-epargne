// @vitest-environment jsdom
// Sauvegarde de secours de bout en bout sur l'appareil : vraie dérivation de clé (WebCrypto),
// clé rangée dans une IndexedDB simulée (fake-indexeddb), faux serveur en mémoire. Ce qui est
// envoyé doit se relire avec le code, et rien de vide ne doit partir.
import { IDBFactory } from 'fake-indexeddb';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateRecoveryCode } from '../lib/cloudBackupCrypto';
import { emptyData } from '../lib/schema';
import type { GlobalAppData } from '../types';

vi.mock('./backendService', async importOriginal => ({
  ...(await importOriginal<typeof import('./backendService')>()),
  BACKEND_URL: 'https://api.test',
  isBackendEnabled: () => true,
}));

import {
  enableWithNewCode, enableWithExistingCode, uploadNow, maybeAutoUpload, decryptServerBackup, getDeviceEnrollment,
  disableAndDeleteServerCopies, readStatus, failureCode,
} from './cloudBackup';

// Faux serveur : les copies chiffrées reçues, par date.
let server: Map<string, string>;
let requests: { method: string; url: string }[];
const respond = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const fakeServer = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  const method = init?.method ?? 'GET';
  requests.push({ method, url });
  const path = url.replace('https://api.test', '');
  if (path === '/backup' && method === 'PUT') { server.set(`2026-10-${String(10 + server.size).padStart(2, '0')}`, String(init?.body)); return respond(200, { ok: true }); }
  if (path === '/backup' && method === 'GET') return respond(200, { dates: [...server.keys()].sort().reverse() });
  if (path === '/backup' && method === 'DELETE') { const deleted = server.size; server.clear(); return respond(200, { deleted }); }
  const m = path.match(/^\/backup\/(.+)$/);
  if (m && method === 'GET') { const blob = server.get(decodeURIComponent(m[1])); return blob ? new Response(blob, { status: 200 }) : respond(404, {}); }
  throw new Error(`requête inattendue ${method} ${url}`);
});

const portfolio = (amount: number): GlobalAppData => ({
  ...emptyData(),
  accounts: [{ id: 'a', name: 'Livret A', institution: 'Banque', type: 'Livret A', totalAmount: amount, ownedAmount: amount, parentalCapital: 0, movements: [] }],
  config: { ...emptyData().config, geminiApiKey: 'clé-de-cet-appareil' } as GlobalAppData['config'],
} as GlobalAppData);

const codeOf = async (p: Promise<unknown>) => { try { await p; return 'ok'; } catch (e) { return failureCode(e); } };
const latest = () => [...server.keys()].sort().reverse()[0];

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('fetch', fakeServer);
  server = new Map();
  requests = [];
  localStorage.clear();
  localStorage.setItem('backend_session', 'session-token-session-token');
});
afterEach(() => { vi.unstubAllGlobals(); fakeServer.mockClear(); });

describe('sauvegarde de secours sur cet appareil', () => {
  it('nouveau code → envoi chiffré → relu avec le code, données identiques (sans la clé Gemini de l’appareil)', async () => {
    const { code } = generateRecoveryCode();
    expect(await getDeviceEnrollment()).toBeNull();
    await enableWithNewCode(code);
    expect(await getDeviceEnrollment()).toMatchObject({ enabledAt: expect.any(String) });

    await uploadNow(portfolio(1234.56));
    const sent = server.get(latest())!;
    // Le serveur ne reçoit que du texte chiffré.
    expect(sent).not.toContain('1234');
    expect(sent).not.toContain('Livret');
    expect(readStatus()).toMatchObject({ lastUploadAt: expect.any(String), lastHash: expect.any(String) });
    expect(readStatus().lastError).toBeUndefined();

    const restored = JSON.parse(await decryptServerBackup(latest(), code)) as GlobalAppData;
    expect(restored.accounts[0].totalAmount).toBe(1234.56);
    expect((restored.config as { geminiApiKey?: string }).geminiApiKey).toBeUndefined();
    // Un autre code ne déchiffre rien.
    expect(await codeOf(decryptServerBackup(latest(), generateRecoveryCode().code))).toBe('WRONG_CODE');
  });

  it('autre appareil : le bon code reprend le sel de la dernière copie, un mauvais code est refusé sans rien activer', async () => {
    const { code } = generateRecoveryCode();
    await enableWithNewCode(code);
    await uploadNow(portfolio(500));

    // Nouvel appareil : base vide.
    vi.stubGlobal('indexedDB', new IDBFactory());
    expect(await codeOf(enableWithExistingCode(generateRecoveryCode().code))).toBe('WRONG_CODE');
    expect(await getDeviceEnrollment()).toBeNull();

    await enableWithExistingCode(code);
    expect(await getDeviceEnrollment()).not.toBeNull();
    await uploadNow(portfolio(600));
    // Même sel : la nouvelle copie se relit avec le même code.
    expect((JSON.parse(await decryptServerBackup(latest(), code)) as GlobalAppData).accounts[0].totalAmount).toBe(600);
  });

  it('autre appareil sans aucune copie sur le serveur : NO_BACKUP', async () => {
    expect(await codeOf(enableWithExistingCode(generateRecoveryCode().code))).toBe('NO_BACKUP');
  });

  it('envoi automatique : jamais une copie vide, une seule fois pour les mêmes données', async () => {
    await enableWithNewCode(generateRecoveryCode().code);
    expect(await maybeAutoUpload(emptyData())).toBe(false);
    expect(fakeServer).not.toHaveBeenCalled();

    const now = new Date();
    expect(await maybeAutoUpload(portfolio(100), now)).toBe(true);
    expect(await maybeAutoUpload(portfolio(100), now)).toBe(false);
    // Données changées, mais moins d'une semaine après : rien de plus.
    expect(await maybeAutoUpload(portfolio(200), now)).toBe(false);
    expect(await maybeAutoUpload(portfolio(200), new Date(now.getTime() + 8 * 86_400_000))).toBe(true);
    expect(requests.filter(r => r.method === 'PUT')).toHaveLength(2);
  });

  it('envoi automatique sans clé sur cet appareil ou sans session : aucun appel', async () => {
    expect(await maybeAutoUpload(portfolio(100))).toBe(false);
    await enableWithNewCode(generateRecoveryCode().code);
    localStorage.removeItem('backend_session');
    expect(await maybeAutoUpload(portfolio(100))).toBe(false);
    expect(fakeServer).not.toHaveBeenCalled();
  });

  it('deux envois simultanés partagent une seule requête', async () => {
    await enableWithNewCode(generateRecoveryCode().code);
    await Promise.all([uploadNow(portfolio(1)), uploadNow(portfolio(1))]);
    expect(requests.filter(r => r.method === 'PUT')).toHaveLength(1);
  });

  it('échec du serveur : noté dans le statut, l’envoi précédent reste connu', async () => {
    await enableWithNewCode(generateRecoveryCode().code);
    await uploadNow(portfolio(1));
    const before = readStatus();
    vi.stubGlobal('fetch', vi.fn(async () => respond(413, {})));
    expect(await codeOf(uploadNow(portfolio(2)))).toBe('TOO_LARGE');
    expect(readStatus()).toMatchObject({ lastUploadAt: before.lastUploadAt, lastHash: before.lastHash, lastError: 'TOO_LARGE' });
  });

  it('désactiver : copies du serveur effacées, puis clé et statut de cet appareil', async () => {
    await enableWithNewCode(generateRecoveryCode().code);
    await uploadNow(portfolio(1));
    expect(await disableAndDeleteServerCopies()).toBe(1);
    expect(server.size).toBe(0);
    expect(await getDeviceEnrollment()).toBeNull();
    expect(readStatus()).toEqual({});
    expect(await codeOf(uploadNow(portfolio(1)))).toBe('NOT_ENABLED');
  });
});
