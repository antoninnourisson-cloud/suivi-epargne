import { describe, it, expect } from 'vitest';
import { monthsBetween, daysBetween, parseISODate, AVG_DAYS_PER_MONTH, formatISODay } from './dates';

describe('parseISODate', () => {
  it("parse 'YYYY-MM-DD' en date locale à minuit (pas de décalage de fuseau)", () => {
    const d = parseISODate('2026-08-31');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(7); // août
    expect(d.getDate()).toBe(31);
    expect(d.getHours()).toBe(0);
  });
});

describe('daysBetween', () => {
  it('compte 1 jour entre le 31/08 et le 01/09 (bascule de mois)', () => {
    expect(daysBetween(parseISODate('2026-08-31'), parseISODate('2026-09-01'))).toBe(1);
  });

  it('compte 2 jours entre le 31/08 et le 02/09', () => {
    expect(daysBetween(parseISODate('2026-08-31'), parseISODate('2026-09-02'))).toBe(2);
  });

  it('ignore l’heure de la journée', () => {
    const from = new Date(2026, 7, 31, 23, 59);
    const to = new Date(2026, 8, 1, 0, 1);
    expect(daysBetween(from, to)).toBe(1);
  });

  it('traverse un changement d’heure sans perdre de jour', () => {
    // Passage à l'heure d'hiver en France : nuit du 24 au 25 octobre 2026.
    expect(daysBetween(parseISODate('2026-10-24'), parseISODate('2026-10-26'))).toBe(2);
  });
});

describe('monthsBetween', () => {
  it('renvoie 0 pour un écart nul', () => {
    expect(monthsBetween(parseISODate('2026-08-31'), parseISODate('2026-08-31'))).toBe(0);
  });

  it('reste strictement positif pour une échéance demain (régression 31/08 → 01/09)', () => {
    const m = monthsBetween(parseISODate('2026-08-31'), parseISODate('2026-09-01'));
    expect(m).toBeGreaterThan(0);
    expect(m).toBeCloseTo(1 / AVG_DAYS_PER_MONTH, 6); // ≈ 0,0329
  });

  it('double bien la valeur pour 2 jours (régression 31/08 → 02/09)', () => {
    const m = monthsBetween(parseISODate('2026-08-31'), parseISODate('2026-09-02'));
    expect(m).toBeCloseTo(2 / AVG_DAYS_PER_MONTH, 6); // ≈ 0,0657 et non 0,0333
  });

  it('renvoie ≈ 12 mois pour un écart d’un an', () => {
    expect(monthsBetween(parseISODate('2026-01-01'), parseISODate('2027-01-01'))).toBeCloseTo(12, 1);
  });

  it('renvoie ≈ 1 mois pour un mois plein', () => {
    expect(monthsBetween(parseISODate('2026-01-01'), parseISODate('2026-02-01'))).toBeCloseTo(31 / AVG_DAYS_PER_MONTH, 6);
  });

  it('renvoie une valeur négative pour une date passée', () => {
    const m = monthsBetween(parseISODate('2026-09-01'), parseISODate('2026-08-01'));
    expect(m).toBeLessThan(0);
    expect(m).toBeCloseTo(-31 / AVG_DAYS_PER_MONTH, 6);
  });
});

describe('formatISODay', () => {
  it('formate en jour LOCAL, pas UTC', () => {
    // 00h30 heure locale : toISOString() aurait donne LA VEILLE dans un fuseau positif.
    const d = new Date(2026, 7, 31, 0, 30);
    expect(formatISODay(d)).toBe('2026-08-31');
  });
  it('zero-pad mois et jour', () => {
    expect(formatISODay(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
  it('est l inverse de parseISODate', () => {
    expect(formatISODay(parseISODate('2025-10-26'))).toBe('2025-10-26');
  });
});
