import { describe, expect, it } from 'vitest';
import { combineMonthTarget, computeMonthTarget, currentPayAdjustment, sanitizePayAdjustment, updatePayAdjustment } from './payAdjustment';
import { emptyData, migrate } from './schema';
import { computeMonthlySavingsCapacity } from './finance';
import type { GlobalAppData } from '../types';

// Paie le 27 : le 19 octobre 2026, on gère encore la paie de septembre.
const OCT_19 = new Date(2026, 9, 19);
const OCT_28 = new Date(2026, 9, 28);

const withConfig = (patch: Partial<GlobalAppData['config']>): GlobalAppData => {
  const d = emptyData();
  return { ...d, config: { ...d.config, ...patch } };
};

describe('currentPayAdjustment', () => {
  it('ne garde que le réglage de la paie en cours', () => {
    const config = { paydayDay: 27, payAdjustment: { period: '2026-09', extra: 500 } };
    expect(currentPayAdjustment(config, OCT_19)).toEqual({ period: '2026-09', extra: 500 });
    // Paie suivante (27 octobre) : le réglage de septembre ne vaut plus.
    expect(currentPayAdjustment(config, OCT_28)).toBeUndefined();
  });

  it('sans jour de paie, la période est le mois calendaire', () => {
    expect(currentPayAdjustment({ payAdjustment: { period: '2026-10', capacity: 900 } }, OCT_19)).toEqual({ period: '2026-10', capacity: 900 });
    expect(currentPayAdjustment({ payAdjustment: { period: '2026-09', capacity: 900 } }, OCT_19)).toBeUndefined();
    expect(currentPayAdjustment(undefined, OCT_19)).toBeUndefined();
  });
});

describe('combineMonthTarget', () => {
  it('capacité saisie > montant du rappel de paie > calcul, plus la somme en plus', () => {
    expect(combineMonthTarget({ computed: 773.34 })).toEqual({ computed: 773.34, capacity: 773.34, extra: 0, total: 773.34, source: 'calc' });
    expect(combineMonthTarget({ computed: 773.34, paydayAmount: 800 })).toMatchObject({ capacity: 800, total: 800, source: 'payday' });
    expect(combineMonthTarget({ computed: 773.34, paydayAmount: 800, adjustment: { period: '2026-09', capacity: 600 } })).toMatchObject({ capacity: 600, total: 600, source: 'manual' });
    expect(combineMonthTarget({ computed: 773.34, adjustment: { period: '2026-09', extra: 500 } })).toMatchObject({ capacity: 773.34, extra: 500, total: 1273.34, source: 'calc' });
  });

  it("n'est jamais négatif", () => {
    expect(combineMonthTarget({ computed: -200, adjustment: { period: '2026-09', extra: 50 } }).total).toBe(0);
  });
});

describe('computeMonthTarget', () => {
  it('même objectif que le Pilotage : calcul + réglage de la paie en cours', () => {
    const base = withConfig({ paydayDay: 27 });
    const computed = computeMonthlySavingsCapacity(base);
    const data = withConfig({ paydayDay: 27, payAdjustment: { period: '2026-09', extra: 500 } });
    expect(computeMonthTarget(data, OCT_19).total).toBeCloseTo(Math.max(0, computed + 500), 2);
    // À la paie suivante, la prime n'est plus comptée.
    expect(computeMonthTarget(data, OCT_28).total).toBeCloseTo(Math.max(0, computed), 2);
  });

  it('le montant du rappel de paie reste la base quand rien n’est saisi pour cette paie', () => {
    const data = withConfig({ paydayDay: 27, paydayAmount: 650, payAdjustment: { period: '2026-08', capacity: 100 } });
    expect(computeMonthTarget(data, OCT_19)).toMatchObject({ capacity: 650, extra: 0, total: 650, source: 'payday' });
  });
});

describe('updatePayAdjustment', () => {
  it('ajoute, remplace et efface les valeurs de la paie en cours', () => {
    const a = updatePayAdjustment(undefined, '2026-09', { extra: 500 });
    expect(a).toEqual({ period: '2026-09', extra: 500 });
    const b = updatePayAdjustment(a, '2026-09', { capacity: 1200.456 });
    expect(b).toEqual({ period: '2026-09', extra: 500, capacity: 1200.46 });
    expect(updatePayAdjustment(b, '2026-09', { capacity: null })).toEqual({ period: '2026-09', extra: 500 });
    // Somme en plus remise à 0 et plus de capacité : rien à garder.
    expect(updatePayAdjustment({ period: '2026-09', extra: 500 }, '2026-09', { extra: 0 })).toBeUndefined();
  });

  it("repart de zéro quand le réglage enregistré date d'une autre paie", () => {
    expect(updatePayAdjustment({ period: '2026-08', capacity: 100, extra: 40 }, '2026-09', { extra: 300 })).toEqual({ period: '2026-09', extra: 300 });
  });

  it('ignore une saisie non numérique', () => {
    expect(updatePayAdjustment({ period: '2026-09', capacity: 100 }, '2026-09', { capacity: Number.NaN })).toBeUndefined();
  });
});

describe('sanitizePayAdjustment et migrate', () => {
  it('écarte un réglage illisible, garde les champs inconnus', () => {
    expect(sanitizePayAdjustment(null)).toBeUndefined();
    expect(sanitizePayAdjustment({ capacity: 3 })).toBeUndefined();
    expect(sanitizePayAdjustment({ period: '2026-13', capacity: 3 })).toBeUndefined();
    expect(sanitizePayAdjustment({ period: '2026-09', capacity: 'beaucoup', extra: 200, note: 'prime' })).toEqual({ period: '2026-09', extra: 200, note: 'prime' });
  });

  it('migrate() garde un réglage valide et retire un réglage abîmé', () => {
    const ok = migrate({ config: { payAdjustment: { period: '2026-09', capacity: 900, extra: 500 } } });
    expect(ok.config.payAdjustment).toEqual({ period: '2026-09', capacity: 900, extra: 500 });
    const broken = migrate({ config: { payAdjustment: 'prime' } });
    expect('payAdjustment' in broken.config).toBe(false);
    expect(migrate({ config: {} }).config.payAdjustment).toBeUndefined();
  });
});
