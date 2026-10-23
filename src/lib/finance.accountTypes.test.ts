// Nouveaux types de compte (livret bancaire, compte à terme, compte-titres, PEL, CEL) et
// « Autre » : fiscalité, disponibilité, épargne de précaution, aide à la déclaration.
import { describe, it, expect } from 'vitest';
import {
  socialChargesRateFor, isHousingSavingsIncomeTaxExempt, hasTaxableYearlyInterest, computeCapitalGainsTax,
  accountAvailabilityStatus, tracksDeposits, computeWithdrawalTax,
} from './finance';
import { netAnnualRate } from './projection';
import { computeEmergencyFund } from './planning';
import { buildTaxReturnChecklist } from './taxReturn';
import { DEFAULT_FISCAL_CONFIG } from '../constants';
import { AccountType, SavingsAccount } from '../types';

const CFG = DEFAULT_FISCAL_CONFIG;
const NOW = new Date(2026, 9, 21);
const acc = (over: Partial<SavingsAccount>): SavingsAccount => ({
  id: 'a', name: 'Compte', type: AccountType.AUTRE, institution: 'B', totalAmount: 1000, ownedAmount: 1000, parentalCapital: 0, movements: [], ...over,
});

describe('prélèvements sociaux 2026 par produit', () => {
  it('17,2 % : assurance vie, PEL, CEL ; 18,6 % : le reste', () => {
    for (const t of [AccountType.ASSURANCE_VIE, AccountType.PEL, AccountType.CEL]) expect(socialChargesRateFor(t, CFG)).toBe(0.172);
    for (const t of [AccountType.LIVRET_BANCAIRE, AccountType.COMPTE_A_TERME, AccountType.CTO, AccountType.PEA, AccountType.AUTRE]) expect(socialChargesRateFor(t, CFG)).toBe(0.186);
  });
});

describe('épargne logement : régime selon la date d’ouverture', () => {
  it('PEL ouvert avant 2018 : exonéré 12 ans ; depuis 2018 : imposé ; CEL avant 2018 : exonéré', () => {
    expect(isHousingSavingsIncomeTaxExempt({ type: AccountType.PEL, openingDate: '2015-03-01' }, NOW)).toBe(true);
    expect(isHousingSavingsIncomeTaxExempt({ type: AccountType.PEL, openingDate: '2014-10-21' }, NOW)).toBe(false); // 12 ans pile
    expect(isHousingSavingsIncomeTaxExempt({ type: AccountType.PEL, openingDate: '2018-01-01' }, NOW)).toBe(false);
    expect(isHousingSavingsIncomeTaxExempt({ type: AccountType.CEL, openingDate: '2005-01-01' }, NOW)).toBe(true);
    expect(isHousingSavingsIncomeTaxExempt({ type: AccountType.CEL, openingDate: '2019-01-01' }, NOW)).toBe(false);
    expect(isHousingSavingsIncomeTaxExempt({ type: AccountType.CEL }, NOW)).toBe(false);
    expect(isHousingSavingsIncomeTaxExempt({ type: AccountType.LIVRET_A, openingDate: '2005-01-01' }, NOW)).toBe(false);
  });

  it('intérêts imposés chaque année : livret bancaire, compte à terme, compte courant, « Autre », PEL/CEL récents', () => {
    expect(hasTaxableYearlyInterest({ type: AccountType.LIVRET_BANCAIRE }, NOW)).toBe(true);
    expect(hasTaxableYearlyInterest({ type: AccountType.COMPTE_A_TERME }, NOW)).toBe(true);
    expect(hasTaxableYearlyInterest({ type: AccountType.PEL, openingDate: '2020-01-01' }, NOW)).toBe(true);
    expect(hasTaxableYearlyInterest({ type: AccountType.PEL, openingDate: '2016-01-01' }, NOW)).toBe(false);
    expect(hasTaxableYearlyInterest({ type: AccountType.LIVRET_A }, NOW)).toBe(false);
    expect(hasTaxableYearlyInterest({ type: AccountType.PEA }, NOW)).toBe(false);
  });
});

describe('net des gains', () => {
  it('livret bancaire, « Autre », compte-titres : PFU (12,8 % + 18,6 %)', () => {
    for (const type of [AccountType.LIVRET_BANCAIRE, AccountType.AUTRE, AccountType.CTO, AccountType.COMPTE_A_TERME]) {
      const t = computeCapitalGainsTax({ type }, 100, CFG, NOW);
      expect(t).toMatchObject({ regime: 'PFU' });
      expect(t.socialCharges).toBeCloseTo(18.6, 9);
      expect(t.incomeTax).toBeCloseTo(12.8, 9);
    }
  });

  it('PEL ancien : sans impôt sur le revenu, 17,2 % sociaux ; PEL récent : PFU à 30 %', () => {
    expect(computeCapitalGainsTax({ type: AccountType.PEL, openingDate: '2016-01-01' }, 100, CFG, NOW)).toMatchObject({ regime: 'EXONERE_IR', incomeTax: 0 });
    const recent = computeCapitalGainsTax({ type: AccountType.PEL, openingDate: '2020-01-01' }, 100, CFG, NOW);
    expect(recent.regime).toBe('PFU');
    expect(recent.netInterest).toBeCloseTo(70, 9);
  });

  it('taux net de la projection : livret bancaire 3 % → 3 × (1 − 31,4 %) ; PEL ancien 2 % → 2 × (1 − 17,2 %)', () => {
    expect(netAnnualRate({ type: AccountType.LIVRET_BANCAIRE, interestRate: 3 }, CFG, NOW)).toBeCloseTo(3 * (1 - 0.186 - 0.128), 9);
    expect(netAnnualRate({ type: AccountType.PEL, interestRate: 2, openingDate: '2016-01-01' }, CFG, NOW)).toBeCloseTo(2 * (1 - 0.172), 9);
    expect(netAnnualRate({ type: AccountType.CEL, interestRate: 1.25, openingDate: '2020-01-01' }, CFG, NOW)).toBeCloseTo(1.25 * (1 - 0.172 - 0.128), 9);
  });

  it('compte-titres : versements suivis, plus-value imposée au PFU au retrait', () => {
    expect(tracksDeposits(AccountType.CTO)).toBe(true);
    const r = computeWithdrawalTax({ type: AccountType.CTO, totalAmount: 10000, totalDeposits: 8000 }, 5000, CFG, NOW);
    expect(r.known).toBe(true);
    expect(r.gainPart).toBeCloseTo(1000, 9);
    expect(r.socialCharges + r.incomeTax).toBeCloseTo(314, 6);
  });
});

describe('disponibilité', () => {
  const status = (over: Partial<SavingsAccount>) => accountAvailabilityStatus(acc(over), CFG, NOW);
  it('« Autre » disponible, sauf marqué bloqué', () => {
    expect(status({ type: AccountType.AUTRE })).toBe('AVAILABLE');
    expect(status({ type: AccountType.AUTRE, blocked: true })).toBe('HARD_LOCKED');
  });
  it('PEL bloqué avant 4 ans (ou date inconnue), libre ensuite', () => {
    expect(status({ type: AccountType.PEL, openingDate: '2024-01-01' })).toBe('HARD_LOCKED');
    expect(status({ type: AccountType.PEL })).toBe('HARD_LOCKED');
    expect(status({ type: AccountType.PEL, openingDate: '2020-01-01' })).toBe('AVAILABLE');
  });
  it("compte à terme bloqué jusqu'à l'échéance", () => {
    expect(status({ type: AccountType.COMPTE_A_TERME, contractEndDate: '2027-01-01' })).toBe('HARD_LOCKED');
    expect(status({ type: AccountType.COMPTE_A_TERME, contractEndDate: '2026-10-21' })).toBe('AVAILABLE');
    expect(status({ type: AccountType.COMPTE_A_TERME })).toBe('AVAILABLE');
  });
  it('livret bancaire, CEL, compte-titres : disponibles', () => {
    for (const type of [AccountType.LIVRET_BANCAIRE, AccountType.CEL, AccountType.CTO]) expect(status({ type })).toBe('AVAILABLE');
  });
});

describe('épargne de précaution et déclaration', () => {
  it('livret bancaire et CEL comptent dans la précaution, pas le PEL', () => {
    const fund = computeEmergencyFund([
      acc({ type: AccountType.LIVRET_BANCAIRE, totalAmount: 1000, ownedAmount: 1000 }),
      acc({ id: 'c', type: AccountType.CEL, totalAmount: 500, ownedAmount: 500 }),
      acc({ id: 'p', type: AccountType.PEL, totalAmount: 9000, ownedAmount: 9000 }),
    ], 1000, 3)!;
    expect(fund.current).toBe(1500);
  });

  it('intérêts d’un livret bancaire en 2TR ; ceux d’un PEL ancien, non', () => {
    const lines = buildTaxReturnChecklist({ accounts: [
      acc({ id: 'lb', name: 'Livret Boost', type: AccountType.LIVRET_BANCAIRE, interestRate: 3, totalAmount: 10000, ownedAmount: 10000, openingDate: '2024-01-01' }),
      acc({ id: 'pel', name: 'PEL', type: AccountType.PEL, interestRate: 2.5, totalAmount: 20000, ownedAmount: 20000, openingDate: '2016-01-01' }),
    ], payslips: [], donations: [] }, 2025);
    const interest = lines.find(l => l.id === 'interest')!;
    expect(interest.note).toContain('Livret Boost');
    expect(interest.note).not.toContain('PEL');
    expect(interest.amount).toBe(300);
  });
});
