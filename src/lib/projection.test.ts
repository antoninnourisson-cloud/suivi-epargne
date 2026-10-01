import { describe, it, expect } from 'vitest';
import { netAnnualRate, projectSavings, detectPayRaise, computeBadgeCount } from './projection';
import { DEFAULT_FISCAL_CONFIG as CFG } from '../constants';
import { AccountType, GlobalAppData, SavingsAccount, PayslipRecord } from '../types';

const acc = (over: Partial<SavingsAccount>): SavingsAccount => ({
  id: 'x', name: 'x', type: AccountType.LIVRET_A, institution: 'B',
  totalAmount: 0, ownedAmount: 0, parentalCapital: 0, movements: [], ...over,
});

describe('netAnnualRate', () => {
  it('livrets nets, AV moins les prélèvements sociaux (et les frais éventuels)', () => {
    expect(netAnnualRate(acc({ interestRate: 1.7 }), CFG)).toBe(1.7);
    expect(netAnnualRate(acc({ type: AccountType.ASSURANCE_VIE, interestRate: 3 }), CFG)).toBeCloseTo(3 * 0.828);
    expect(netAnnualRate(acc({ type: AccountType.ASSURANCE_VIE, interestRate: 3, managementFee: 0.6 }), CFG)).toBeCloseTo(2.4 * 0.828);
  });
});

describe('projectSavings', () => {
  const la = acc({ id: 'la', name: 'Livret A', interestRate: 1.7 });
  const av = acc({ id: 'av', name: 'AV', type: AccountType.ASSURANCE_VIE, interestRate: 3 });

  it('compose les intérêts nets et répartit selon la répartition', () => {
    const r = projectSavings([la, av], CFG, 1000, 1, [{ accountId: 'la', pct: 50 }, { accountId: 'av', pct: 50 }]);
    expect(r.deposited).toBe(12000);
    expect(r.interest).toBeGreaterThan(0);
    expect(r.byAccount.find(b => b.accountId === 'la')!.amount).toBeGreaterThan(6000);
  });
  it('ne verse plus au-delà du plafond du Livret A (seuls les intérêts le dépassent, comme en vrai)', () => {
    const r = projectSavings([la, av], CFG, 1000, 3, [{ accountId: 'la', pct: 100 }]);
    expect(r.byAccount.find(b => b.accountId === 'la')!.amount).toBeLessThan(CFG.ceilings.livretA * 1.03);
    expect(r.byAccount.find(b => b.accountId === 'av')!.amount).toBeGreaterThan(10000);
  });
});

describe('detectPayRaise', () => {
  const slip = (id: string, period: string, netPaid: number): PayslipRecord =>
    ({ id, fileId: id, fileName: id, period, extracted: { period, netPaid } } as unknown as PayslipRecord);
  it('repère une hausse du net entre les deux dernières fiches', () => {
    const r = detectPayRaise([slip('a', '2026-08', 2938), slip('b', '2026-09', 3397)]);
    expect(r?.delta).toBeCloseTo(459);
    expect(detectPayRaise([slip('a', '2026-08', 2938), slip('b', '2026-09', 2940)])).toBeNull();
  });
});

describe('computeBadgeCount', () => {
  it('compte les virements de la paie en cours non cochés', () => {
    const data: GlobalAppData = {
      accounts: [acc({ id: 'la', interestRate: 1.7, totalAmount: 1000, ownedAmount: 1000 })],
      expenses: [{ id: 'e', name: 'Commun', amount: 900 }], history: [],
      config: { grossAnnual: 0, leisureBudget: 0, projectSavings: 0, taxRateManual: 0, extraMonthlyIncome: 0, paydayDay: 27, paydayAmount: 500 },
      fiscalConfig: { ...CFG, paramsReviewedYear: 2026 },
      payChecklist: { month: '2026-09', lines: [
        { key: 't:Commun', label: 'Commun', amount: 900, kind: 'transfer' },
        { key: 's:la', label: 'Livret A', amount: 500, kind: 'saving', accountId: 'la' },
      ], done: { 't:Commun': { amount: 900 } } },
    };
    expect(computeBadgeCount(data, new Date(2026, 9, 1))).toBe(1);
  });
});
