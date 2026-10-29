import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { countedPayslips, payslipConsistency } from './payslipChecks';
import { buildTaxReturnChecklist } from './taxReturn';
import { buildLepIncomeYears } from './lep';
import type { PayslipRecord } from '../types';

// Fiche française cohérente : 3 000 € brut, 660 € de charges, Navigo 43,15 €.
const ok = { grossAmount: 3000, socialCharges: 660, netAmount: 2383.15, netTaxable: 2450.4, incomeTaxWithheld: 120.5, netPaid: 2262.65, navigoRefund: 43.15 };
const ids = (f: Parameters<typeof payslipConsistency>[0]) => payslipConsistency(f).map(w => w.id);

describe('contrôle croisé d’une fiche de paie', () => {
  it('fiche cohérente : aucun avertissement', () => {
    expect(payslipConsistency(ok)).toEqual([]);
  });
  it('trop peu de montants : rien à contrôler', () => {
    expect(payslipConsistency({})).toEqual([]);
    expect(payslipConsistency({ netAmount: 2000, netPaid: 1500 })).toEqual([]);
  });
  it('net avant impôt − impôt ≠ net payé : avertit avec l’écart, tolère 1 €', () => {
    expect(ids({ ...ok, netPaid: ok.netPaid + 0.99 })).toEqual([]);
    const [w] = payslipConsistency({ ...ok, netPaid: ok.netPaid + 50 });
    expect(w.id).toBe('net-after-tax');
    expect(w.fields).toEqual(['netAmount', 'incomeTaxWithheld', 'netPaid']);
    expect(w.message).toMatch(/écart de 50,00\s€/);
  });
  it('net imposable et net à payer inversés : signalé', () => {
    expect(ids({ ...ok, netAmount: ok.netTaxable, netTaxable: ok.netAmount })).toContain('net-after-tax');
  });
  it('net imposable au-dessus du brut', () => {
    expect(ids({ ...ok, netTaxable: 3100 })).toContain('net-taxable-above-gross');
  });
  it('net au-dessus du brut (Navigo compris dans la marge)', () => {
    expect(ids({ grossAmount: 2000, netPaid: 2040, navigoRefund: 43 })).toEqual([]);
    const w = payslipConsistency({ grossAmount: 2000, netAmount: 2500, netPaid: 2400, incomeTaxWithheld: 100 });
    expect(w.map(x => x.id)).toEqual(['net-above-gross']);
    expect(w[0].message).toMatch(/net avant impôt et le net payé dépassent/);
    expect(payslipConsistency({ grossAmount: 2000, netPaid: 2400 })[0].message).toMatch(/net payé dépasse/);
    expect(payslipConsistency({ grossAmount: 2000, netAmount: 2400 })[0].message).toMatch(/net avant impôt dépasse/);
  });
  it('charges patronales lues à la place des charges salariales', () => {
    expect(ids({ ...ok, socialCharges: 1350 })).toEqual(['gross-minus-charges']);
  });
  it('ne lève jamais sur des montants quelconques', () => {
    const amount = fc.option(fc.double({ min: 0, max: 500000, noNaN: true }), { nil: undefined });
    fc.assert(fc.property(fc.record({ grossAmount: amount, socialCharges: amount, netAmount: amount, netTaxable: amount, incomeTaxWithheld: amount, netPaid: amount, navigoRefund: amount }),
      f => { expect(Array.isArray(payslipConsistency(f))).toBe(true); }));
  });
});

const slip = (id: string, period: string, netTaxable: number, extra: Partial<PayslipRecord> = {}, withheld = 100): PayslipRecord =>
  ({ id, fileId: '', fileName: `${id}.pdf`, addedAt: `2026-01-01T00:00:0${id.length % 10}Z`, reviewed: true, extracted: { period, netTaxable, incomeTaxWithheld: withheld }, ...extra });
const year = (y: number, netTaxable = 2000) => Array.from({ length: 12 }, (_, i) => slip(`m${i}`, `${y}-${String(i + 1).padStart(2, '0')}`, netTaxable, { addedAt: '2026-01-01T00:00:00Z' }));

describe('fiches du même mois : remplace ou s’ajoute', () => {
  it('sans marquage, la fiche la plus récente du mois remplace les autres', () => {
    const a = slip('a', '2025-03', 2000, { addedAt: '2026-01-01T00:00:00Z' });
    const b = slip('b', '2025-03', 2100, { addedAt: '2026-02-01T00:00:00Z' });
    expect(countedPayslips([b, a]).map(p => p.id)).toEqual(['b']);
    expect(countedPayslips([a, b]).map(p => p.id)).toEqual(['b']);
  });
  it('fiche « s’ajoute » : comptée en plus ; fiche sans période gardée', () => {
    const a = slip('a', '2025-03', 2000);
    const b = slip('b', '2025-03', 500, { addsToPeriod: true });
    const c = { ...slip('c', '', 0), extracted: {} };
    expect(countedPayslips([a, b, c]).map(p => p.id).sort()).toEqual(['a', 'b', 'c']);
  });

  it('déclaration : une fiche rectificative ne gonfle ni 1AJ ni 8HV', () => {
    const rectif = slip('rectif', '2025-06', 2200, { addedAt: '2026-03-01T00:00:00Z' }, 150);
    const lines = buildTaxReturnChecklist({ accounts: [], donations: [], payslips: [...year(2025), rectif] }, 2025);
    const salary = lines.find(l => l.id === 'salary')!;
    expect(salary).toMatchObject({ box: '1AJ', amount: 2000 * 11 + 2200, confidence: 'exact' });
    expect(salary.note).toMatch(/vos 12 fiches/);
    expect(lines.find(l => l.id === 'withheld')).toMatchObject({ box: '8HV', amount: 100 * 11 + 150, confidence: 'exact' });
  });
  it('déclaration : un deuxième employeur (« s’ajoute ») est additionné', () => {
    const second = slip('second', '2025-06', 800, { addsToPeriod: true, addedAt: '2026-03-01T00:00:00Z' }, 40);
    const lines = buildTaxReturnChecklist({ accounts: [], donations: [], payslips: [...year(2025), second] }, 2025);
    const salary = lines.find(l => l.id === 'salary')!;
    expect(salary).toMatchObject({ amount: 2000 * 12 + 800, confidence: 'exact' });
    expect(salary.note).toMatch(/13 fiches \(12 mois\)/);
    expect(lines.find(l => l.id === 'withheld')!.amount).toBe(100 * 12 + 40);
  });

  it('LEP : un doublon ne gonfle pas le revenu estimé ; un ajout, si', () => {
    const NOW = new Date('2026-10-03T12:00:00');
    const base = buildLepIncomeYears({ payslips: year(2025), config: {} } as never, NOW).find(y => y.year === 2025)!;
    expect(base).toEqual({ year: 2025, rfr: 21600, source: 'fiches' });
    const dup = slip('dup', '2025-06', 2000, { addedAt: '2026-03-01T00:00:00Z' });
    expect(buildLepIncomeYears({ payslips: [...year(2025), dup], config: {} } as never, NOW).find(y => y.year === 2025)!.rfr).toBe(21600);
    const extra = { ...dup, addsToPeriod: true };
    expect(buildLepIncomeYears({ payslips: [...year(2025), extra], config: {} } as never, NOW).find(y => y.year === 2025)!.rfr).toBe(Math.round((24000 + 2000) * 0.9));
  });
});
