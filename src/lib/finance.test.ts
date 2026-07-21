import { describe, it, expect } from 'vitest';
import { computeIncomeTax, computeIncome, computeWeightedAnnualRate } from './finance';
import { DEFAULT_FISCAL_CONFIG, DEFAULT_WORK_BENEFITS } from '../constants';
import { WorkBenefits } from '../types';

const NO_BENEFITS: WorkBenefits = {
  navigo: { active: false, basePrice: 0, refundRate: 0 },
  mutuelle: { active: false, totalCost: 0, employerRate: 0 },
  mealVouchers: { active: false, faceValue: 0, employerRate: 0, daysPerMonth: 0 },
};

describe('computeIncomeTax (barème progressif FR)', () => {
  const brackets = DEFAULT_FISCAL_CONFIG.taxBrackets;

  it('ne taxe pas un revenu sous le seuil de la 1re tranche', () => {
    expect(computeIncomeTax(10000, brackets)).toBe(0);
  });

  it('applique 11% uniquement sur la part dans la 2e tranche', () => {
    // 20 000 imposable : (20000 - 11294) * 0.11
    const expected = (20000 - 11294) * 0.11;
    expect(computeIncomeTax(20000, brackets)).toBeCloseTo(expected, 2);
  });

  it('cumule les tranches 0% / 11% / 30%', () => {
    const taxable = 40000;
    const expected =
      (28797 - 11294) * 0.11 + (taxable - 28797) * 0.3;
    expect(computeIncomeTax(taxable, brackets)).toBeCloseTo(expected, 2);
  });

  it('gère la dernière tranche (limit = Infinity)', () => {
    expect(computeIncomeTax(500000, brackets)).toBeGreaterThan(0);
  });
});

describe('computeIncome (super net)', () => {
  const baseInput = {
    grossAnnual: 45000,
    extraMonthlyIncome: 0,
    navigoBase: 0,
    navigoRate: 0,
    taxRateManual: 0,
  };

  it('déduit les charges salariales du brut', () => {
    const r = computeIncome(baseInput, DEFAULT_FISCAL_CONFIG, NO_BENEFITS);
    expect(r.grossMonth).toBeCloseTo(3750, 2);
    expect(r.socialCharges).toBeCloseTo(3750 * DEFAULT_FISCAL_CONFIG.salaryChargesRate, 2);
    expect(r.netSalaryOnly).toBeCloseTo(3750 - r.socialCharges, 2);
  });

  it('applique un taux d\'imposition forcé quand taxRateManual > 0', () => {
    const forced = computeIncome({ ...baseInput, taxRateManual: 10 }, DEFAULT_FISCAL_CONFIG, NO_BENEFITS);
    expect(forced.effectiveMonthlyTax).toBeCloseTo(forced.netBeforeTax * 0.1, 2);
  });

  it('retire mutuelle et tickets resto du super net', () => {
    const r = computeIncome(baseInput, DEFAULT_FISCAL_CONFIG, DEFAULT_WORK_BENEFITS);
    expect(r.superNet).toBeCloseTo(r.superNetRaw - r.effectiveMonthlyTax, 2);
    expect(r.superNetRaw).toBeCloseTo(r.netBeforeTax - r.mutuelleCost - r.swileCost, 2);
  });

  it('compte le remboursement Navigo comme un gain', () => {
    const withNavigo = computeIncome(baseInput, DEFAULT_FISCAL_CONFIG, {
      ...NO_BENEFITS,
      navigo: { active: true, basePrice: 90, refundRate: 50 },
    });
    expect(withNavigo.navigoGain).toBeCloseTo(45, 2);
  });
});

describe('computeWeightedAnnualRate', () => {
  it('retourne le taux courant sans historique', () => {
    expect(computeWeightedAnnualRate(3, undefined, 2026)).toBe(3);
    expect(computeWeightedAnnualRate(3, [], 2026)).toBe(3);
  });

  it('pondère par la durée de chaque segment de taux', () => {
    // Taux à 2% du 1er janvier au 1er juillet, puis 4% jusqu'à fin d'année (année bissextile ou non gérée via jours réels)
    const rate = computeWeightedAnnualRate(4, [{ date: '2026-01-01', rate: 2 }], 2026);
    // La moyenne pondérée doit être strictement entre 2 et 4.
    expect(rate).toBeGreaterThan(2);
    expect(rate).toBeLessThan(4);
  });
});
