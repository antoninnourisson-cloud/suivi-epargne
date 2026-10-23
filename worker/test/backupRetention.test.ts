import { describe, it, expect } from 'vitest';
import { backupsToKeep, mondayOf, BACKUP_MAX_COPIES, BACKUP_RECENT } from '../src/backupRetention';

const days = (from: string, n: number, step = 1) => Array.from({ length: n }, (_, i) => {
  const d = new Date(`${from}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + i * step);
  return d.toISOString().slice(0, 10);
});

describe('conservation échelonnée des copies de secours', () => {
  it('lundi de la semaine', () => {
    expect(mondayOf('2026-10-20')).toBe('2026-10-19'); // mardi
    expect(mondayOf('2026-10-19')).toBe('2026-10-19'); // lundi
    expect(mondayOf('2026-10-25')).toBe('2026-10-19'); // dimanche
    expect(mondayOf('2027-01-01')).toBe('2026-12-28');
  });

  it('peu de copies : toutes gardées', () => {
    const dates = ['2026-10-01', '2026-10-08', '2026-10-15'];
    expect([...backupsToKeep(dates)].sort()).toEqual(dates);
    expect(backupsToKeep([]).size).toBe(0);
  });

  it(`envois quotidiens pendant un an : ${BACKUP_MAX_COPIES} copies au plus, dont les plus récentes et une par mois`, () => {
    const dates = days('2025-10-21', 365);
    const keep = backupsToKeep(dates);
    expect(keep.size).toBeLessThanOrEqual(BACKUP_MAX_COPIES);
    for (const d of dates.slice(-BACKUP_RECENT)) expect(keep.has(d)).toBe(true);
    // La première copie de chacun des 12 derniers mois.
    for (const m of ['2026-10', '2026-09', '2026-01', '2025-11']) expect(keep.has(`${m}-01`)).toBe(true);
    expect(keep.has('2025-10-21')).toBe(false); // 13e mois : au-delà de 12
  });

  it('une rafale d’envois récents ne chasse pas les copies d’avant', () => {
    const good = days('2026-05-04', 16, 7);            // hebdomadaires, mai à août
    const flood = days('2026-09-01', 45);              // quotidiennes, septembre à mi-octobre
    const keep = backupsToKeep([...good, ...flood]);
    expect(keep.has('2026-05-04')).toBe(true);
    expect(keep.has('2026-06-01')).toBe(true);
    expect(keep.has('2026-07-06')).toBe(true);
    expect(keep.has('2026-08-03')).toBe(true);
    // Toujours au moins une copie de plus de 30 jours avant la rafale.
    expect([...keep].some(d => d < '2026-09-01')).toBe(true);
  });

  it('ignore les noms qui ne sont pas des dates, et les doublons', () => {
    expect([...backupsToKeep(['2026-10-01', '2026-10-01', 'deletion', '../x'])]).toEqual(['2026-10-01']);
  });
});
