import { describe, expect, it } from 'vitest';
import { computeYearEndTax, isYearEndFinalReminder, isYearEndTaxSeason } from './yearEndTax';
import { applyDecote, computeDonationSummary, computeIncomeTax } from './finance';
import { DEFAULT_FISCAL_CONFIG } from '../constants';
import { AccountType, type AccountMovement, type Donation, type SavingsAccount } from '../types';

const CFG = DEFAULT_FISCAL_CONFIG;
const tax = (income: number) => applyDecote(computeIncomeTax(income, CFG.taxBrackets), CFG);
const mv = (date: string, amount: number): AccountMovement => ({ id: `${date}-${amount}`, date, amount, type: 'IN', label: 'Versement' });
const per = (movements: AccountMovement[] = []): SavingsAccount => ({
  id: 'per', name: 'PER', type: AccountType.PER, institution: 'B', totalAmount: 5000, ownedAmount: 5000, parentalCapital: 0, movements,
});
const don = (date: string, amount: number, rate: 66 | 75 = 66): Donation =>
  ({ id: `${date}-${amount}`, date, amount, organization: 'Asso', rate, receiptReceived: true });

describe('saison « Avant le 31 décembre »', () => {
  it('du 15 novembre au 31 décembre, pas avant ni après', () => {
    expect(isYearEndTaxSeason(new Date(2026, 10, 14))).toBe(false);
    expect(isYearEndTaxSeason(new Date(2026, 10, 15))).toBe(true);
    expect(isYearEndTaxSeason(new Date(2026, 11, 31, 23))).toBe(true);
    expect(isYearEndTaxSeason(new Date(2027, 0, 2))).toBe(false);
    expect(isYearEndTaxSeason(new Date(2026, 5, 20))).toBe(false);
  });

  it('le dernier rappel commence le 15 décembre', () => {
    expect(isYearEndFinalReminder(new Date(2026, 10, 30))).toBe(false);
    expect(isYearEndFinalReminder(new Date(2026, 11, 14))).toBe(false);
    expect(isYearEndFinalReminder(new Date(2026, 11, 15))).toBe(true);
  });
});

describe('chiffres de fin d\'année', () => {
  const base = { donations: [] as Donation[], year: 2026, fiscalConfig: CFG, taxableIncome: 40_000, taxDue: tax(40_000) };

  it('PER : 1 000 € d\'exemple, économie = impôt sans le versement moins impôt avec', () => {
    const r = computeYearEndTax({ ...base, accounts: [per()] });
    expect(r.per?.amount).toBe(1000);
    expect(r.per?.saving).toBeCloseTo(tax(40_000) - tax(39_000), 2);
    expect(r.per?.saving).toBeCloseTo(300, 2);
  });

  it('PER : les versements déjà faits sont d\'abord déduits', () => {
    const r = computeYearEndTax({ ...base, accounts: [per([mv('2026-03-01', 2000)])] });
    expect(r.per?.saving).toBeCloseTo(tax(38_000) - tax(37_000), 2);
  });

  it('PER : l\'exemple est réduit à la place restante sous le plafond de l\'avis', () => {
    const r = computeYearEndTax({ ...base, accounts: [per([mv('2026-03-01', 2000)])], notice: { year: 2026, amount: 2400 } });
    expect(r.per?.amount).toBe(400);
    expect(r.per?.saving).toBeCloseTo(tax(38_000) - tax(37_600), 2);
  });

  it('PER : rien sans plafond restant, ni sans compte PER', () => {
    expect(computeYearEndTax({ ...base, accounts: [per([mv('2026-03-01', 3000)])], notice: { year: 2026, amount: 3000 } }).per).toBeUndefined();
    expect(computeYearEndTax({ ...base, accounts: [] }).per).toBeUndefined();
  });

  it('PER : la décote est comprise (revenu modeste)', () => {
    const r = computeYearEndTax({ ...base, accounts: [per()], taxableIncome: 17_000, taxDue: tax(17_000) });
    expect(r.per?.saving).toBeCloseTo(tax(17_000) - tax(16_000), 2);
  });

  it('dons : réduction acquise et don d\'exemple de 100 € à 66 %', () => {
    const r = computeYearEndTax({ ...base, accounts: [], donations: [don('2026-05-01', 200)] });
    expect(r.donations).toEqual({ acquired: 132, example: 100, extra: 66 });
  });

  it('dons : sans don, rien d\'acquis mais l\'exemple rapporte 66 €', () => {
    expect(computeYearEndTax({ ...base, accounts: [] }).donations).toEqual({ acquired: 0, example: 100, extra: 66 });
  });

  it('dons : seuls ceux de l\'année comptent', () => {
    expect(computeYearEndTax({ ...base, accounts: [], donations: [don('2025-05-01', 500)] }).donations?.acquired).toBe(0);
  });

  it('dons : le plafond de 20 % du revenu limite le gain en plus', () => {
    // 20 % de 40 000 € = 8 000 € : déjà atteint, un don de plus ne rapporte rien.
    const r = computeYearEndTax({ ...base, accounts: [], donations: [don('2026-05-01', 8000)] });
    expect(r.donations?.extra).toBe(0);
    expect(r.donations?.acquired).toBeCloseTo(computeDonationSummary([don('2026-05-01', 8000)], 2026, { taxableIncome: 40_000, taxDue: tax(40_000) }).reduction, 2);
  });

  it('dons : au taux de 75 % plafonné, l\'exemple de 100 € bascule à 66 % une fois 2 000 € atteints', () => {
    const r = computeYearEndTax({ ...base, accounts: [], donations: [don('2026-05-01', 2000, 75)] });
    expect(r.donations).toEqual({ acquired: 1500, example: 100, extra: 66 });
  });

  it('dons : la réduction ne dépasse pas l\'impôt dû', () => {
    const r = computeYearEndTax({ ...base, accounts: [], donations: [don('2026-05-01', 200)], taxDue: 50 });
    expect(r.donations).toEqual({ acquired: 50, example: 100, extra: 0 });
  });

  it('sans revenu imposable connu : aucun chiffre', () => {
    expect(computeYearEndTax({ ...base, accounts: [per()], taxableIncome: undefined, taxDue: undefined })).toEqual({ year: 2026 });
    expect(computeYearEndTax({ ...base, accounts: [per()], taxableIncome: 0 })).toEqual({ year: 2026 });
  });
});
