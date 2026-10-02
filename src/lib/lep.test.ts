import { describe, it, expect } from 'vitest';
import { computeLepTimeline, buildLepIncomeYears, describeLepTimeline, lepClosureDate } from './lep';
import { AccountType } from '../types';

const lep = [{ type: AccountType.LEP }];
const NOW = new Date('2026-10-03T12:00:00');

describe('éligibilité au LEP dans le temps', () => {
  it('ferme après deux années de revenus consécutives au-dessus du plafond', () => {
    const t = computeLepTimeline(lep, [
      { year: 2025, rfr: 24000, source: 'avis' },
      { year: 2026, rfr: 25000, source: 'estimation' },
    ], 23028, NOW)!;
    expect(t.status).toBe('closing');
    expect(t.closeBy).toBe(lepClosureDate(2026));
    expect(t.closeBy).toBe('2028-04-30');
    expect(t.estimated).toBe(true);
  });
  it('tolère un dépassement isolé et annonce la date si l\'année suivante dépasse aussi', () => {
    const t = computeLepTimeline(lep, [
      { year: 2024, rfr: 20000, source: 'avis' },
      { year: 2025, rfr: 24000, source: 'avis' },
    ], 23028, NOW)!;
    expect(t.status).toBe('one-over');
    expect(t.closeBy).toBe('2028-04-30');
    expect(describeLepTimeline(t)?.title).toContain('2025');
  });
  it('rien si le dépassement est suivi d\'une année sous le plafond', () => {
    const t = computeLepTimeline(lep, [
      { year: 2024, rfr: 24000, source: 'avis' },
      { year: 2025, rfr: 15000, source: 'avis' },
      { year: 2026, rfr: 15000, source: 'estimation' },
    ], 23028, NOW)!;
    expect(t.status).toBe('ok');
    expect(describeLepTimeline(t)).toBeNull();
  });
  it('signale une fermeture déjà due', () => {
    const t = computeLepTimeline(lep, [
      { year: 2023, rfr: 30000, source: 'avis' },
      { year: 2024, rfr: 30000, source: 'avis' },
    ], 23028, NOW)!;
    expect(t.status).toBe('closed-due');
  });
  it('privilégie l\'avis d\'imposition, puis les fiches de paie', () => {
    const payslips = Array.from({ length: 12 }, (_, i) => ({ id: String(i), extracted: { period: `2025-${String(i + 1).padStart(2, '0')}`, netTaxable: 2000 } }));
    const years = buildLepIncomeYears({ payslips, config: { rfrByYear: { 2024: 21000 } } } as any, NOW, 26000);
    expect(years.find(y => y.year === 2024)).toEqual({ year: 2024, rfr: 21000, source: 'avis' });
    expect(years.find(y => y.year === 2025)).toEqual({ year: 2025, rfr: 21600, source: 'fiches' });
    expect(years.find(y => y.year === 2026)?.source).toBe('estimation');
  });
  it('rien sans LEP', () => {
    expect(computeLepTimeline([{ type: AccountType.LIVRET_A }], [{ year: 2026, rfr: 99999, source: 'avis' }], 23028, NOW)).toBeNull();
  });
});
