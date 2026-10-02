import { describe, it, expect } from 'vitest';
import { computeEmergencyFund, buildSoloPlan, buildTaxReturnChecklist, reviewSubscriptions, benefitsFromPayslips } from './planning';
import { DEFAULT_FISCAL_CONFIG as CFG } from '../constants';
import { AccountType } from '../types';

const acc = (over: any) => ({ institution: 'B', parentalCapital: 0, interestRate: 0, movements: [], ...over, totalAmount: over.totalAmount ?? (over.ownedAmount + (over.parentalCapital || 0)) });

describe('épargne de précaution', () => {
  it('ne compte que votre part sur les comptes disponibles', () => {
    const f = computeEmergencyFund([
      acc({ id: 'la', name: 'LA', type: AccountType.LIVRET_A, ownedAmount: 2000, parentalCapital: 5000 }),
      acc({ id: 'av', name: 'AV', type: AccountType.ASSURANCE_VIE, ownedAmount: 9000 }),
    ] as any, 1000, 3)!;
    expect(f.current).toBe(2000);
    expect(f.target).toBe(3000);
    expect(f.missing).toBe(1000);
    expect(f.reached).toBe(false);
  });
  it('rien sans dépenses connues', () => {
    expect(computeEmergencyFund([], 0)).toBeNull();
  });
});

describe('plan solo', () => {
  it('retire le capital des parents puis remplit les livrets et note les étapes', () => {
    const accounts = [
      acc({ id: 'la', name: 'Livret A', type: AccountType.LIVRET_A, ownedAmount: 10000, parentalCapital: 9000, interestRate: 0 }),
      acc({ id: 'av', name: 'AV', type: AccountType.ASSURANCE_VIE, ownedAmount: 0, interestRate: 0 }),
    ] as any;
    const plan = buildSoloPlan(accounts, CFG, 1000, '2027-01-01', { years: 2, emergencyTarget: 12000 });
    expect(plan.startTotal).toBe(10000);
    expect(plan.years[0].year).toBe(2027);
    expect(plan.years[0].total).toBe(22000);
    expect(plan.milestones.map(m => m.label)).toContain('Épargne de précaution atteinte');
    expect(plan.milestones.some(m => m.label === 'Livret A plein')).toBe(true);
  });
});

describe('aide à la déclaration', () => {
  it('somme les nets imposables et reporte les dons', () => {
    const payslips = Array.from({ length: 12 }, (_, i) => ({ id: String(i), extracted: { period: `2026-${String(i + 1).padStart(2, '0')}`, netTaxable: 2000, incomeTaxWithheld: 50 } }));
    const lines = buildTaxReturnChecklist({ payslips, donations: [{ id: 'd', date: '2026-05-01', amount: 100, organization: 'X', rate: 75, receiptReceived: false }], accounts: [] } as any, 2026, { allowanceRate: 0.1, allowanceCap: 14555 });
    const box = (b: string) => lines.find(l => l.box === b);
    expect(box('1AJ')?.amount).toBe(24000);
    expect(box('1AJ')?.confidence).toBe('exact');
    expect(box('8HV')?.amount).toBe(600);
    expect(box('7UD')?.amount).toBe(100);
    expect(lines.some(l => l.label === 'Reçus manquants')).toBe(true);
  });
});

describe('revue des abonnements', () => {
  it('trie par coût annuel, repère hausses, revue et préavis', () => {
    const rows = reviewSubscriptions([
      { id: 'a', name: 'Musique', amount: 12, debitAccount: '', frequency: 'monthly', anchorDate: '2026-01-05', active: true, priceHistory: [{ date: '2026-06-01', amount: 10 }], reviewedAt: '2026-09-01' },
      { id: 'b', name: 'Assurance', amount: 300, debitAccount: '', frequency: 'yearly', anchorDate: '2025-12-15', active: true, noticeDays: 30 },
    ] as any, 2000, new Date('2026-10-02'));
    expect(rows[0].sub.id).toBe('b');
    expect(rows[0].cancelBy).toBe('2026-11-15');
    expect(rows[0].reviewDue).toBe(true);
    expect(rows[1].priceIncrease).toEqual({ from: 10, to: 12, date: '2026-06-01' });
    expect(rows[1].reviewDue).toBe(false);
  });
});

describe('avantages salariaux depuis les fiches de paie', () => {
  const cur = { navigo: { active: true, basePrice: 90.8, refundRate: 67.24 }, mutuelle: { active: true, totalCost: 50, employerRate: 50 }, mealVouchers: { active: true, faceValue: 10, employerRate: 60, daysPerMonth: 20 } };
  const slip = (period: string, ex: any) => ({ id: period, extracted: { period, ...ex } });
  it('moyenne des 3 dernières fiches, Navigo et tickets à 50 %', () => {
    const r = benefitsFromPayslips([
      slip('2026-07', { navigoRefund: 40, mealVouchers: 100, mutuelleCost: 20 }),
      slip('2026-08', { navigoRefund: 44, mealVouchers: 90 }),
      slip('2026-09', { navigoRefund: 42, mealVouchers: 110, mutuelleCost: 22 }),
      slip('2026-01', { navigoRefund: 999 }),
    ] as any, cur as any)!;
    expect(r.months).toBe(3);
    expect(r.benefits.navigo).toEqual({ active: true, basePrice: 84, refundRate: 50 });
    expect(r.benefits.mealVouchers.daysPerMonth).toBe(20);
    expect(r.benefits.mealVouchers.employerRate).toBe(50);
    expect(r.benefits.mutuelle).toEqual({ active: true, totalCost: 21, employerRate: 0 });
  });
  it('désactive ce qui ne figure sur aucune fiche', () => {
    const r = benefitsFromPayslips([slip('2026-09', { navigoRefund: 42 })] as any, cur as any)!;
    expect(r.benefits.mutuelle.active).toBe(false);
    expect(r.benefits.mealVouchers.active).toBe(false);
  });
});
