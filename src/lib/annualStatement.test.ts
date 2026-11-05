import { describe, it, expect } from 'vitest';
import { checkAnnualStatement } from './annualStatement';

describe('checkAnnualStatement', () => {
  it('relevé cohérent : tout est proposé, aucun avertissement', () => {
    const r = checkAnnualStatement({ year: 2026, valueAtYearEnd: 5000, deposits: 1000, rate: 2.6, interest: 120 }, 2026);
    expect(r.warnings).toEqual([]);
    expect(r.fill).toEqual({ valueAtYearEnd: 5000, deposits: 1000, rate: 2.6, interest: 120 });
  });

  it('valeur nulle ou négative, taux hors de 0 à 10 % : avertis et non proposés', () => {
    const r = checkAnnualStatement({ valueAtYearEnd: 0, rate: 12 }, 2026);
    expect(r.fill).toEqual({});
    expect(r.warnings).toHaveLength(2);
    expect(checkAnnualStatement({ valueAtYearEnd: 100, rate: 10 }, 2026).warnings).toEqual([]);
    expect(checkAnnualStatement({ valueAtYearEnd: 100, rate: -1 }, 2026).fill.rate).toBeUndefined();
  });

  it('versements plus grands que la valeur, autre année, rien de lisible', () => {
    expect(checkAnnualStatement({ valueAtYearEnd: 100, deposits: 200 }, 2026).warnings[0]).toMatch(/dépassent/);
    expect(checkAnnualStatement({ year: 2024, valueAtYearEnd: 100 }, 2026).warnings[0]).toMatch(/2024/);
    expect(checkAnnualStatement({}, 2026).warnings[0]).toMatch(/rien trouvé/);
  });
});
