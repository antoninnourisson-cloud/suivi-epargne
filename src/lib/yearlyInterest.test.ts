import { describe, it, expect } from 'vitest';
import { accruedSinceJanuary, applyMonthlyInterest, creditsInterestYearly, pendingInterest } from './yearlyInterest';
import { AccountType, SavingsAccount } from '../types';

const account = (over: Partial<SavingsAccount> & Pick<SavingsAccount, 'id' | 'type'>): SavingsAccount => ({
  name: over.id, institution: 'B', totalAmount: 10000, ownedAmount: 10000, parentalCapital: 0, interestRate: 2.4, movements: [], ...over,
});

describe('livrets réglementés : intérêts versés au 31 décembre', () => {
  it('seuls Livret A, LDDS et LEP attendent le 31 décembre', () => {
    expect([AccountType.LIVRET_A, AccountType.LDDS, AccountType.LEP].every(creditsInterestYearly)).toBe(true);
    expect([AccountType.ASSURANCE_VIE, AccountType.PEA, AccountType.CRYPTO, AccountType.COMPTE_COURANT].some(creditsInterestYearly)).toBe(false);
  });

  it('un placement ordinaire compose chaque mois', () => {
    const av = { type: AccountType.ASSURANCE_VIE, totalAmount: 1000 };
    expect(applyMonthlyInterest(av, 0.01, false)).toBeCloseTo(10, 9);
    expect(applyMonthlyInterest(av, 0.01, false)).toBeCloseTo(10.1, 9);
    expect(av.totalAmount).toBeCloseTo(1020.1, 9);
  });

  it('un livret accumule, sans intérêts sur les intérêts, puis verse tout en décembre', () => {
    const la: { type: AccountType; totalAmount: number; accrued?: number } = { type: AccountType.LIVRET_A, totalAmount: 1200, accrued: 5 };
    for (let m = 0; m < 11; m++) expect(applyMonthlyInterest(la, 0.001, false)).toBe(0);
    expect(la.totalAmount).toBe(1200);
    expect(pendingInterest([la])).toBeCloseTo(5 + 11 * 1.2, 9);
    expect(applyMonthlyInterest(la, 0.001, true)).toBeCloseTo(5 + 12 * 1.2, 9);
    expect(la.totalAmount).toBeCloseTo(1200 + 5 + 14.4, 9);
    expect(pendingInterest([la])).toBe(0);
  });

  it('intérêts acquis depuis janvier jusqu\'au 1er du mois de départ (quinzaines)', () => {
    const accrued = accruedSinceJanuary([
      account({ id: 'lep', type: AccountType.LEP }),
      account({ id: 'av', type: AccountType.ASSURANCE_VIE }),
    ], new Date(2026, 9, 19));
    // Janvier à septembre : 18 quinzaines ; octobre est compté par la projection.
    expect(accrued.get('lep')).toBeCloseTo(10000 * 0.024 * 18 / 24, 9);
    expect(accrued.has('av')).toBe(false);
    expect(accruedSinceJanuary([account({ id: 'lep', type: AccountType.LEP })], new Date(2027, 0, 1)).get('lep')).toBe(0);
  });
});
