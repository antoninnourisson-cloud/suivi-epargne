// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { listServerBackups, uploadNow, decryptServerBackup, maybeAutoUpload, readStatus, failureCode } from './cloudBackup';
import { generateRecoveryCode, deriveBackupKey, encryptBackup, newSalt, b64urlEncode } from '../lib/cloudBackupCrypto';
import { emptyData } from '../lib/schema';

const respond = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => { localStorage.clear(); localStorage.setItem('backend_session', 'session-token-session-token'); });
afterEach(() => { vi.unstubAllGlobals(); });

const codeOf = async (p: Promise<unknown>) => { try { await p; return 'ok'; } catch (e) { return failureCode(e); } };

describe('service de sauvegarde de secours', () => {
  it('envoie la session en Bearer et traduit les erreurs HTTP', async () => {
    const f = vi.fn(async () => respond(200, { dates: ['2026-10-07'] }));
    vi.stubGlobal('fetch', f);
    expect(await listServerBackups()).toEqual(['2026-10-07']);
    expect(((f.mock.calls[0] as unknown[])[1] as RequestInit).headers).toMatchObject({ Authorization: 'Bearer session-token-session-token' });

    vi.stubGlobal('fetch', vi.fn(async () => respond(401, {})));
    expect(await codeOf(listServerBackups())).toBe('SESSION_EXPIRED');
    vi.stubGlobal('fetch', vi.fn(async () => respond(429, {})));
    expect(await codeOf(listServerBackups())).toBe('RATE_LIMITED');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    expect(await codeOf(listServerBackups())).toBe('OFFLINE');
  });

  it("sans clé sur l'appareil, l'envoi échoue proprement et le note dans le statut", async () => {
    vi.stubGlobal('fetch', vi.fn());
    expect(await codeOf(uploadNow(emptyData()))).toBe('NOT_ENABLED');
    expect(readStatus().lastError).toBe('NOT_ENABLED');
    expect(await maybeAutoUpload(emptyData())).toBe(false); // jamais d'erreur levée
  });

  it('déchiffre une copie du serveur avec le code ; code mal recopié ou faux = erreur claire', async () => {
    const { code, bytes } = generateRecoveryCode();
    const salt = newSalt();
    const { key, kcv } = await deriveBackupKey(bytes, salt, ['encrypt']);
    const json = JSON.stringify({ ...emptyData(), accounts: [] });
    const blob = await encryptBackup(json, key, { salt: b64urlEncode(salt), kcv });
    const f = vi.fn(async () => respond(200, blob));
    vi.stubGlobal('fetch', f);
    expect(await decryptServerBackup('2026-10-07', code.toLowerCase())).toBe(json);
    expect(String((f.mock.calls[0] as unknown[])[0])).toBe('/backup/2026-10-07');

    const typo = (code[0] === 'A' ? 'B' : 'A') + code.slice(1);
    expect(await codeOf(decryptServerBackup('2026-10-07', typo))).toBe('TYPO');
    expect(await codeOf(decryptServerBackup('2026-10-07', 'trop court'))).toBe('INVALID_CODE');
    expect(await codeOf(decryptServerBackup('2026-10-07', generateRecoveryCode().code))).toBe('WRONG_CODE');
  });
});
