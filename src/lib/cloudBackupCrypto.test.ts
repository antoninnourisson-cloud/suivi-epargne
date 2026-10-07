import { describe, it, expect } from 'vitest';
import {
  generateRecoveryCode, formatRecoveryCode, parseRecoveryCode, deriveBackupKey, newSalt, encryptBackup, decryptBackup,
  parseBackupBlob, codeMatchesBlob, b64urlEncode, b64urlDecode, CloudBackupError, shouldAutoUpload, AUTO_UPLOAD_INTERVAL_MS,
  type CloudBackupBlobV1,
} from './cloudBackupCrypto';

const errorCode = async (p: Promise<unknown>) => {
  try { await p; return 'no error'; } catch (e) { return e instanceof CloudBackupError ? e.code : `other: ${String(e)}`; }
};

const setup = async (zip?: 'gzip' | 'none') => {
  const { code, bytes } = generateRecoveryCode();
  const salt = newSalt();
  const { key, kcv } = await deriveBackupKey(bytes, salt, ['encrypt']);
  const data = JSON.stringify({ accounts: [{ id: 'a1', name: 'Livret A', totalAmount: 1234.56 }], note: 'é€ 🐷' });
  const blob = await encryptBackup(data, key, { salt: b64urlEncode(salt), kcv }, new Date('2026-10-07T10:00:00Z'), zip);
  return { code, bytes, blob, data };
};

describe('code de secours', () => {
  it('128 bits, 7 groupes de 4 caractères base32 Crockford, relu à l’identique', () => {
    const { code, bytes } = generateRecoveryCode();
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){6}$/);
    const parsed = parseRecoveryCode(code);
    expect(parsed).toEqual({ ok: true, bytes });
  });

  it('tolère minuscules, espaces, et les confusions O/0, I/L/1', () => {
    const bytes = new Uint8Array(16); // que des zéros : le code commence par des 0
    const code = formatRecoveryCode(bytes);
    const sloppy = code.toLowerCase().replace(/-/g, ' ').replace(/0/g, 'o');
    expect(parseRecoveryCode(sloppy)).toEqual({ ok: true, bytes });
  });

  it('distingue longueur, caractère interdit et faute de frappe', () => {
    const { code } = generateRecoveryCode();
    expect(parseRecoveryCode(code.slice(0, -1))).toEqual({ ok: false, reason: 'length' });
    expect(parseRecoveryCode(`U${code.slice(1)}`)).toEqual({ ok: false, reason: 'chars' });
    // Chaque caractère modifié est détecté par le contrôle.
    const flat = code.replace(/-/g, '');
    for (let i = 0; i < flat.length; i++) {
      const other = flat[i] === 'A' ? 'B' : 'A';
      const typo = flat.slice(0, i) + other + flat.slice(i + 1);
      expect(parseRecoveryCode(typo).ok).toBe(false);
    }
  });

  it('deux codes successifs diffèrent', () => {
    expect(generateRecoveryCode().code).not.toBe(generateRecoveryCode().code);
  });
});

describe('copie chiffrée v1', () => {
  it('aller-retour : chiffrée puis déchiffrée avec le code (gzip et sans compression)', async () => {
    for (const zip of ['gzip', 'none'] as const) {
      const { bytes, blob, data } = await setup(zip);
      expect(blob).toMatchObject({ format: 'pecule-backup', v: 1, kdf: 'HKDF-SHA256', cipher: 'AES-256-GCM', zip, createdAt: '2026-10-07T10:00:00.000Z' });
      expect(blob.ct).not.toContain('Livret');
      expect(await decryptBackup(JSON.parse(JSON.stringify(blob)), bytes)).toBe(data);
    }
  });

  it('IV et texte chiffré changent à chaque envoi', async () => {
    const { bytes } = await setup();
    const salt = newSalt();
    const { key, kcv } = await deriveBackupKey(bytes, salt, ['encrypt']);
    const a = await encryptBackup('{}', key, { salt: b64urlEncode(salt), kcv });
    const b = await encryptBackup('{}', key, { salt: b64urlEncode(salt), kcv });
    expect(a.iv).not.toBe(b.iv);
    expect(a.ct).not.toBe(b.ct);
  });

  it('un mauvais code échoue proprement (WRONG_CODE), sans rien déchiffrer', async () => {
    const { blob } = await setup();
    const other = generateRecoveryCode().bytes;
    expect(await errorCode(decryptBackup(blob, other))).toBe('WRONG_CODE');
    expect(await codeMatchesBlob(other, blob)).toBe(false);
  });

  it('un texte chiffré modifié est refusé (CORRUPTED)', async () => {
    const { bytes, blob } = await setup();
    const ct = b64urlDecode(blob.ct);
    ct[5] ^= 1;
    expect(await errorCode(decryptBackup({ ...blob, ct: b64urlEncode(ct) }, bytes))).toBe('CORRUPTED');
    const iv = b64urlDecode(blob.iv);
    iv[0] ^= 1;
    expect(await errorCode(decryptBackup({ ...blob, iv: b64urlEncode(iv) }, bytes))).toBe('CORRUPTED');
  });

  it("l'en-tête est authentifié : changer la date ou la compression rend la copie illisible", async () => {
    const { bytes, blob } = await setup('gzip');
    expect(await errorCode(decryptBackup({ ...blob, createdAt: '2020-01-01T00:00:00.000Z' }, bytes))).toBe('CORRUPTED');
    expect(await errorCode(decryptBackup({ ...blob, zip: 'none' }, bytes))).toBe('CORRUPTED');
  });

  it('vérifie le format et la version', async () => {
    const { bytes, blob } = await setup();
    expect(await errorCode(decryptBackup({ ...blob, v: 2 }, bytes))).toBe('UNSUPPORTED_VERSION');
    expect(await errorCode(decryptBackup({ ...blob, format: 'autre' }, bytes))).toBe('UNSUPPORTED_FORMAT');
    expect(await errorCode(decryptBackup({ ...blob, cipher: 'AES-128-CBC' }, bytes))).toBe('UNSUPPORTED_FORMAT');
    expect(await errorCode(decryptBackup(null, bytes))).toBe('UNSUPPORTED_FORMAT');
    expect(await errorCode(decryptBackup({ ...blob, ct: 'pas du base64!' }, bytes))).toBe('CORRUPTED');
    expect(() => parseBackupBlob({ ...blob, extra: 'ignoré' })).not.toThrow();
    expect(Object.keys(parseBackupBlob({ ...blob, extra: 'x' }) as CloudBackupBlobV1)).not.toContain('extra');
  });

  it('une clé gardée sur l’appareil peut être limitée au chiffrement', async () => {
    const { bytes } = generateRecoveryCode();
    const { key } = await deriveBackupKey(bytes, newSalt(), ['encrypt']);
    expect(key.extractable).toBe(false);
    expect(key.usages).toEqual(['encrypt']);
  });
});

describe('envoi automatique', () => {
  const now = new Date('2026-10-07T12:00:00Z');
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
  it('envoie la première fois', () => { expect(shouldAutoUpload(null, 'h', now)).toBe(true); });
  it("n'envoie pas si rien n'a changé, même après une semaine", () => {
    expect(shouldAutoUpload({ lastUploadAt: ago(30 * 86_400_000), lastHash: 'h' }, 'h', now)).toBe(false);
  });
  it('au plus une fois par semaine quand les données changent', () => {
    expect(shouldAutoUpload({ lastUploadAt: ago(AUTO_UPLOAD_INTERVAL_MS - 1), lastHash: 'a' }, 'b', now)).toBe(false);
    expect(shouldAutoUpload({ lastUploadAt: ago(AUTO_UPLOAD_INTERVAL_MS), lastHash: 'a' }, 'b', now)).toBe(true);
  });
});
