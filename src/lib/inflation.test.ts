import { describe, it, expect } from 'vitest';
import { DEFAULT_INFLATION, inflationOf, realRate, isInflationOutdated } from './inflation';

describe('inflation INSEE', () => {
  it('valeur livrée datée et sourcée (moyenne 2025 : +0,9 %)', () => {
    expect(DEFAULT_INFLATION).toEqual({ rate: 0.9, year: 2025, source: 'https://www.insee.fr/fr/statistiques/8726461' });
  });

  it('la valeur des paramètres fiscaux prend le relais si elle est aussi récente', () => {
    expect(inflationOf({})).toBe(DEFAULT_INFLATION);
    expect(inflationOf({ inflation: { rate: 1.4, year: 2026 } })).toEqual({ rate: 1.4, year: 2026 });
    expect(inflationOf({ inflation: { rate: 2, year: 2024 } })).toBe(DEFAULT_INFLATION);
  });

  it('rendement après inflation : (1 + net) / (1 + inflation) − 1', () => {
    expect(realRate(1.7, 0.9)).toBeCloseTo((1.017 / 1.009 - 1) * 100, 10);
    expect(realRate(0.5, 2)).toBeLessThan(0);
    expect(realRate(2, 2)).toBeCloseTo(0, 10);
  });

  it('chiffre en retard : celui de l’année passée aurait dû paraître', () => {
    expect(isInflationOutdated({ rate: 0.9, year: 2025 }, new Date(2026, 9, 21))).toBe(false);
    expect(isInflationOutdated({ rate: 0.9, year: 2025 }, new Date(2027, 0, 10))).toBe(false);
    expect(isInflationOutdated({ rate: 0.9, year: 2025 }, new Date(2027, 1, 1))).toBe(true);
  });
});
