import { describe, it, expect } from 'vitest';
import { generateRecoveryCode } from './cloudBackupCrypto';
import { pickCheckGroups, checkGroups, groupOf, normalizeGroup, recoveryCodeFileText, RECOVERY_GROUPS, backupCodeCheckDue } from './recoveryCodeCheck';

describe('vérification du code de secours noté', () => {
  it('tire deux groupes distincts, non voisins, dans l’ordre, entre 1 et 7', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const [a, b] = pickCheckGroups(() => i / 200);
      expect(a).toBeGreaterThanOrEqual(1);
      expect(b).toBeLessThanOrEqual(RECOVERY_GROUPS);
      expect(b - a).toBeGreaterThanOrEqual(2);
      seen.add(`${a}-${b}`);
    }
    expect(seen.size).toBe(15); // toutes les paires possibles
    expect(pickCheckGroups(() => 0.9999999)).toEqual([5, 7]);
  });

  it('accepte les groupes recopiés (casse, espaces, confusions O/0 et I/L/1), refuse le reste', () => {
    const { code } = generateRecoveryCode();
    const [a, b] = [2, 6];
    expect(checkGroups(code, [a, b], [groupOf(code, a), groupOf(code, b)])).toBe(true);
    expect(checkGroups(code, [a, b], [` ${groupOf(code, a).toLowerCase()} `, groupOf(code, b)])).toBe(true);
    expect(checkGroups('AAAA-1010-CCCC-DDDD-EEEE-FFFF-GGGG', [2], ['ioLo'])).toBe(true);
    expect(checkGroups(code, [a, b], [groupOf(code, b), groupOf(code, a)])).toBe(groupOf(code, a) === groupOf(code, b));
    expect(checkGroups(code, [a, b], [groupOf(code, a), ''])).toBe(false);
    expect(checkGroups(code, [a, b], [groupOf(code, a)])).toBe(false);
    expect(checkGroups(code, [9], ['XXXX'])).toBe(false);
    expect(checkGroups(code, [], [])).toBe(false);
    expect(normalizeGroup('o-l i')).toBe('011');
  });

  it('fichier texte : le code, la date et le conseil de le ranger ailleurs', () => {
    const text = recoveryCodeFileText('AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG', new Date(2026, 9, 20));
    expect(text).toContain('AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG');
    expect(text).toContain('20 octobre 2026');
    expect(text).toMatch(/hors de cet appareil/);
  });
});

describe('vérification annuelle du code de secours', () => {
  const at = (iso: string) => new Date(iso);
  it('sans sauvegarde sur l’appareil : jamais de rappel', () => {
    expect(backupCodeCheckDue(null, at('2027-10-20T12:00:00Z'))).toBe(false);
    expect(backupCodeCheckDue(undefined, at('2027-10-20T12:00:00Z'))).toBe(false);
  });
  it('un an après l’activation, pas avant', () => {
    const e = { enabledAt: '2026-10-20T10:00:00.000Z' };
    expect(backupCodeCheckDue(e, at('2027-10-19T12:00:00Z'))).toBe(false);
    expect(backupCodeCheckDue(e, at('2027-10-20T10:00:00Z'))).toBe(true);
  });
  it('un code retapé juste repousse le rappel d’un an', () => {
    const e = { enabledAt: '2025-01-10T10:00:00.000Z', codeCheckedAt: '2027-03-01T08:00:00.000Z' };
    expect(backupCodeCheckDue(e, at('2027-10-20T12:00:00Z'))).toBe(false);
    expect(backupCodeCheckDue(e, at('2028-03-01T08:00:00Z'))).toBe(true);
  });
  it('date illisible : pas de rappel', () => {
    expect(backupCodeCheckDue({ enabledAt: 'n’importe quoi' }, at('2030-01-01T00:00:00Z'))).toBe(false);
  });
});
