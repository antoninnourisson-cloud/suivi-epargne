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
  disableAndScheduleDeletion, cancelServerDeletion, getServerBackups, getServerDeletion, readStatus, failureCode, verifyRecoveryCode,
} from './cloudBackup';

// Faux serveur : les copies chiffrées reçues, par date.
let server: Map<string, string>;
let requests: { method: string; url: string; proof: string | null }[];
let deletion: { requestedAt: string; purgeAt: string } | null;
// Le faux serveur rend un nonce avec chaque réponse (en-tête X-Pecule-Nonce), comme le vrai.
const NONCE = 'N'.repeat(43);
const respond = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'X-Pecule-Nonce': NONCE } });
const fakeServer = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  const method = init?.method ?? 'GET';
  const path = url.replace('https://api.test', '');
  // Session liée à l'appareil : le faux serveur accepte la clé (POST /auth/bind).
  if (path === '/auth/bind' && method === 'POST') return respond(200, { ok: true, bound: true });
  requests.push({ method, url, proof: new Headers(init?.headers).get('X-Pecule-Proof') });
  if (path === '/backup' && method === 'PUT') { server.set(`2026-10-${String(10 + server.size).padStart(2, '0')}`, String(init?.body)); return respond(200, { ok: true }); }
  if (path === '/backup' && method === 'GET') return respond(200, { dates: [...server.keys()].sort().reverse(), ...(deletion ? { deletion } : {}) });
  if (path === '/backup' && method === 'DELETE') {
    deletion = { requestedAt: '2026-10-20T10:00:00.000Z', purgeAt: '2026-10-27T10:00:00.000Z' };
    return respond(200, { ok: true, scheduled: true, purgeAt: deletion.purgeAt, copies: server.size });
  }
  if (path === '/backup/deletion' && method === 'GET') return respond(200, { deletion: deletion ? { ...deletion, copies: server.size } : null });
  if (path === '/backup/deletion' && method === 'DELETE') { const cancelled = !!deletion; deletion = null; return respond(200, { ok: true, cancelled }); }
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
  deletion = null;
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

  it('vérification annuelle : le bon code est noté sur l’appareil, un autre non ; rien n’est envoyé', async () => {
    expect(await codeOf(verifyRecoveryCode(generateRecoveryCode().code))).toBe('NOT_ENABLED');
    const { code } = generateRecoveryCode();
    await enableWithNewCode(code);
    expect((await getDeviceEnrollment())?.codeCheckedAt).toBeUndefined();

    expect(await verifyRecoveryCode(generateRecoveryCode().code)).toBe(false);
    expect((await getDeviceEnrollment())?.codeCheckedAt).toBeUndefined();
    expect(await codeOf(verifyRecoveryCode('AAAA-BBBB'))).toMatch(/INVALID_CODE|TYPO/);

    const at = new Date('2027-10-20T09:00:00.000Z');
    // Casse et tirets ignorés, comme à la restauration.
    expect(await verifyRecoveryCode(code.toLowerCase(), at)).toBe(true);
    expect(await getDeviceEnrollment()).toMatchObject({ enabledAt: expect.any(String), codeCheckedAt: at.toISOString() });
    expect(fakeServer).not.toHaveBeenCalled();
    // La clé de l'appareil chiffre toujours : l'envoi suivant se relit avec le même code.
    await uploadNow(portfolio(700));
    expect((JSON.parse(await decryptServerBackup(latest(), code)) as GlobalAppData).accounts[0].totalAmount).toBe(700);
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

  it('désactiver : effacement des copies programmé sur le serveur, puis clé et statut de cet appareil effacés', async () => {
    await enableWithNewCode(generateRecoveryCode().code);
    await uploadNow(portfolio(1));
    expect(await disableAndScheduleDeletion()).toEqual({ copies: 1, purgeAt: '2026-10-27T10:00:00.000Z' });
    expect(await getServerBackups()).toEqual({ dates: [latest()], deletion: { requestedAt: '2026-10-20T10:00:00.000Z', purgeAt: '2026-10-27T10:00:00.000Z' } });
    expect(await getDeviceEnrollment()).toBeNull();
    expect(readStatus()).toEqual({});
    expect(await codeOf(uploadNow(portfolio(1)))).toBe('NOT_ENABLED');
    // Lecture légère faite à chaque ouverture de l'app (bandeau d'alerte).
    expect(await getServerDeletion()).toEqual({ requestedAt: '2026-10-20T10:00:00.000Z', purgeAt: '2026-10-27T10:00:00.000Z' });
    expect(await cancelServerDeletion()).toBe(true);
    expect((await getServerBackups()).deletion).toBeNull();
    expect(await getServerDeletion()).toBeNull();
  });

  it('chaque requête au serveur porte la preuve de l’appareil (session liée)', async () => {
    await enableWithNewCode(generateRecoveryCode().code);
    await uploadNow(portfolio(1));
    await getServerBackups();
    expect(requests.length).toBeGreaterThan(1);
    for (const r of requests) expect(r.proof, `${r.method} ${r.url}`).toBe(`${NONCE}.${r.proof?.split('.')[1]}`);
    for (const r of requests) expect(r.proof).toMatch(/^[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{86}$/);
  });
});
