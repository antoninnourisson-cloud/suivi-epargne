// @vitest-environment jsdom
// Copie mensuelle Drive : un échec est noté, un seul essai par jour (sauf « Réessayer
// maintenant »), et le message des Paramètres n'apparaît qu'après plus de 45 jours sans réussite.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const drive = vi.hoisted(() => ({ calls: 0, fail: false }));
vi.mock('../../services/googleDriveService', () => ({
  writeMonthlyBackup: vi.fn(async () => {
    drive.calls += 1;
    if (drive.fail) throw new Error('réseau');
    return true;
  }),
}));

import { attemptMonthlyBackup, monthlyBackupMessage, monthlyBackupProblem, resetMonthlyBackup } from './monthlyBackup';
import { LAST_BACKUP_MONTH_KEY } from './keys';

const at = (iso: string) => new Date(`${iso}T10:00:00`);

describe('copie mensuelle Drive', () => {
  beforeEach(() => {
    localStorage.clear();
    resetMonthlyBackup();
    drive.calls = 0;
    drive.fail = false;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('réussite : le mois est noté, les sauvegardes suivantes ne refont rien', async () => {
    expect(await attemptMonthlyBackup({}, { now: at('2026-11-07') })).toBe(true);
    expect(localStorage.getItem(LAST_BACKUP_MONTH_KEY)).toBe('2026-11');
    expect(await attemptMonthlyBackup({}, { now: at('2026-11-08') })).toBe(true);
    expect(drive.calls).toBe(1);
  });

  it('échec : un seul essai par jour, même si l\'on sauvegarde dix fois', async () => {
    drive.fail = true;
    for (let i = 0; i < 10; i++) await attemptMonthlyBackup({}, { now: at('2026-11-07') });
    expect(drive.calls).toBe(1);
    expect(localStorage.getItem(LAST_BACKUP_MONTH_KEY)).toBeNull();
    // Le lendemain : un nouvel essai.
    await attemptMonthlyBackup({}, { now: at('2026-11-08') });
    expect(drive.calls).toBe(2);
  });

  it("« Réessayer maintenant » n'attend pas le lendemain, et une réussite efface le problème", async () => {
    drive.fail = true;
    await attemptMonthlyBackup({}, { now: at('2026-11-07') });
    drive.fail = false;
    expect(await attemptMonthlyBackup({}, { now: at('2026-11-07'), force: true })).toBe(true);
    expect(drive.calls).toBe(2);
    expect(monthlyBackupProblem(at('2027-03-01'))).toBeNull();
  });

  it('deux demandes en même temps : une seule requête', async () => {
    const [a, b] = await Promise.all([
      attemptMonthlyBackup({}, { now: at('2026-11-07') }),
      attemptMonthlyBackup({}, { now: at('2026-11-07'), force: true }),
    ]);
    expect([a, b]).toEqual([true, true]);
    expect(drive.calls).toBe(1);
  });

  it('pas de message avant 45 jours sans copie réussie, puis le message avec la date', async () => {
    await attemptMonthlyBackup({}, { now: at('2026-10-03') });
    drive.fail = true;
    // Novembre : échec noté, mais la dernière copie date du 3 octobre (35 jours).
    localStorage.removeItem(LAST_BACKUP_MONTH_KEY);
    await attemptMonthlyBackup({}, { now: at('2026-11-07') });
    expect(monthlyBackupProblem(at('2026-11-07'))).toBeNull();
    const later = at('2026-11-20'); // 48 jours après le 3 octobre
    const problem = monthlyBackupProblem(later);
    expect(problem).not.toBeNull();
    expect(monthlyBackupMessage(problem!, later)).toBe(
      'La copie mensuelle sur Drive n\'a pas pu être faite depuis le 3 octobre. Pécule réessaie chaque jour.');
  });

  it('sans date de réussite notée (anciennes versions) : on part du mois de la dernière copie', async () => {
    localStorage.setItem(LAST_BACKUP_MONTH_KEY, '2026-09');
    drive.fail = true;
    await attemptMonthlyBackup({}, { now: at('2026-11-07') });
    // Septembre est le dernier mois couvert.
    const now = at('2026-11-07');
    const problem = monthlyBackupProblem(now);
    expect(problem?.monthOnly).toBe(true);
    expect(monthlyBackupMessage(problem!, now)).toBe(
      'La copie mensuelle sur Drive n\'a pas pu être faite depuis septembre. Pécule réessaie chaque jour.');
  });

  it('jamais de copie réussie : on compte depuis le premier échec', async () => {
    drive.fail = true;
    await attemptMonthlyBackup({}, { now: at('2026-09-20') });
    expect(monthlyBackupProblem(at('2026-10-20'))).toBeNull();
    expect(monthlyBackupProblem(at('2026-11-10'))).not.toBeNull();
  });

  it('le 1er du mois se dit « 1er », et l\'année est donnée si elle n\'est pas l\'actuelle', () => {
    expect(monthlyBackupMessage({ since: new Date(2026, 9, 1), monthOnly: false }, at('2026-12-20')))
      .toMatch(/depuis le 1er octobre\./);
    expect(monthlyBackupMessage({ since: new Date(2026, 9, 1), monthOnly: false }, at('2027-02-20')))
      .toMatch(/depuis le 1er octobre 2026\./);
  });

  it('déconnexion : tout est oublié', async () => {
    drive.fail = true;
    await attemptMonthlyBackup({}, { now: at('2026-09-20') });
    resetMonthlyBackup();
    expect(monthlyBackupProblem(at('2027-01-01'))).toBeNull();
  });
});
