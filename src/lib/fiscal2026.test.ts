// Non-régression fiscale 2026 : chaque valeur attendue est ÉCRITE EN DUR d'après une source
// officielle (vérifiée le 2026-10-19), jamais recalculée depuis la configuration testée.
// Une faute de frappe dans src/constants.ts ou une proposition de veille mal acceptée doit
// faire échouer ce fichier. À mettre à jour chaque année avec les nouvelles sources.
import { describe, it, expect } from 'vitest';
import { DEFAULT_FISCAL_CONFIG as CFG, LATEST_TAX_SCALE } from '../constants';
import { applyDecote, computeIncomeTax, computeCapitalGainsTax, computeWithdrawalTax, PEA_DEPOSIT_CEILING } from './finance';
import { AccountType } from '../types';

const NOW = new Date(2026, 9, 19);

describe('paramètres 2026 figés', () => {
  it('barème des revenus 2025 (1 part)', () => {
    // https://www.service-public.gouv.fr/particuliers/vosdroits/F1419
    expect(LATEST_TAX_SCALE.year).toBe(2026);
    expect(CFG.taxBrackets).toEqual([
      { limit: 11600, rate: 0 },
      { limit: 29579, rate: 0.11 },
      { limit: 84577, rate: 0.30 },
      { limit: 181917, rate: 0.41 },
      { limit: Infinity, rate: 0.45 },
    ]);
  });

  it('décote : 897 € − 45,25 % de l’impôt brut, sous 1 982 €', () => {
    // https://www.service-public.gouv.fr/particuliers/vosdroits/F34328
    expect(CFG.decote).toEqual({ single: 897, rate: 0.4525, threshold: 1982 });
  });

  it('abattement de 10 % sur les salaires : entre 509 € et 14 555 €', () => {
    // https://www.service-public.gouv.fr/particuliers/vosdroits/F1989
    expect(CFG.standardAllowance).toBe(0.10);
    expect(CFG.standardAllowanceMin).toBe(509);
    expect(CFG.standardAllowanceCap).toBe(14555);
  });

  it('plafonds des livrets réglementés', () => {
    // Livret A https://www.service-public.gouv.fr/particuliers/vosdroits/F2365
    // LDDS https://www.service-public.gouv.fr/particuliers/vosdroits/F2368
    // LEP https://www.service-public.gouv.fr/particuliers/vosdroits/F2367
    expect(CFG.ceilings).toEqual({ livretA: 22950, ldds: 12000, lep: 10000 });
    // Plafond de revenu LEP 2026, 1 part, métropole (même source F2367).
    expect(CFG.lepIncomeCeiling).toBe(23028);
  });

  it('prélèvements sociaux : 18,6 % en général, 17,2 % sur l’assurance vie', () => {
    // https://www.service-public.gouv.fr/particuliers/vosdroits/F2329
    expect(CFG.socialChargesCapital).toBe(0.186);
    expect(CFG.socialChargesLifeInsurance).toBe(0.172);
  });

  it('durées : PEA 5 ans, assurance vie 8 ans, versement de PEE bloqué 5 ans', () => {
    // PEA https://www.service-public.gouv.fr/particuliers/vosdroits/F2385
    // AV https://www.service-public.gouv.fr/particuliers/vosdroits/F22414
    // PEE https://code.travail.gouv.fr/code-du-travail/l3332-25
    expect(CFG.legalMaturity).toEqual({ pea: 5, assuranceVie: 8, pee: 5 });
    expect(PEA_DEPOSIT_CEILING).toBe(150000); // F2385
  });

  it('dons : 75 % jusqu’à 2 000 €', () => {
    // https://www.service-public.gouv.fr/particuliers/vosdroits/F426
    expect(CFG.donation75Ceiling).toBe(2000);
  });
});

describe('impôt de bout en bout (barème + décote)', () => {
  const tax = (taxable: number) => applyDecote(computeIncomeTax(taxable, CFG.taxBrackets), CFG);

  it("exemple officiel : 30 000 € imposables → 2 103,99 €, tranche à 30 %, pas de décote", () => {
    // F34328 / F1419 : (29 579 − 11 600) × 11 % + (30 000 − 29 579) × 30 %.
    expect(computeIncomeTax(30000, CFG.taxBrackets)).toBeCloseTo(2103.99, 2);
    expect(tax(30000)).toBeCloseTo(2103.99, 2);
  });

  it('exemple officiel de décote : impôt brut de 1 400 € → 1 136,50 €', () => {
    // F34328 : 897 − 1 400 × 45,25 % = 263,50 € de décote.
    expect(applyDecote(1400, CFG)).toBeCloseTo(1136.5, 2);
  });

  it('zone de décote : 20 000 € imposables → 445,11 €', () => {
    // Brut (20 000 − 11 600) × 11 % = 924 € ; décote 897 − 924 × 45,25 % = 478,89 €.
    expect(tax(20000)).toBeCloseTo(445.11, 2);
  });

  it('décote qui efface tout : 15 000 € imposables → 0 €', () => {
    // Brut 374 € ; décote 897 − 169,24 = 727,77 € > 374 €.
    expect(tax(15000)).toBe(0);
  });

  it('tranche à 41 % : 100 000 € imposables → 24 800,52 €', () => {
    // 1 977,69 + (84 577 − 29 579) × 30 % + (100 000 − 84 577) × 41 % = 1 977,69 + 16 499,40 + 6 323,43.
    expect(tax(100000)).toBeCloseTo(24800.52, 2);
  });

  it('sous la première tranche : rien', () => {
    expect(tax(11600)).toBe(0);
  });
});

describe('fiscalité des gains, en euros', () => {
  // 1 000 € de gains. PFU : 12,8 % d'impôt sur le revenu (impots.gouv.fr, plus-values mobilières).
  it('PEA de moins de 5 ans : 128 € d’impôt + 186 € de prélèvements sociaux', () => {
    const r = computeCapitalGainsTax({ type: AccountType.PEA, openingDate: '2024-01-01' }, 1000, CFG, NOW);
    expect(r.incomeTax).toBeCloseTo(128, 6);
    expect(r.socialCharges).toBeCloseTo(186, 6);
    expect(r.netInterest).toBeCloseTo(686, 6);
  });

  it('assurance vie de moins de 8 ans : 128 € + 172 €', () => {
    const r = computeCapitalGainsTax({ type: AccountType.ASSURANCE_VIE, openingDate: '2024-01-01' }, 1000, CFG, NOW);
    expect(r.incomeTax).toBeCloseTo(128, 6);
    expect(r.socialCharges).toBeCloseTo(172, 6);
  });

  it('crypto : 31,4 % au total', () => {
    // https://www.impots.gouv.fr/particulier/questions/comment-declarer-les-plus-ou-moins-values-sur-cessions-dactifs-numeriques
    const r = computeCapitalGainsTax({ type: AccountType.CRYPTO, openingDate: '2010-01-01' }, 1000, CFG, NOW);
    expect(r.incomeTax + r.socialCharges).toBeCloseTo(314, 6);
  });
});

describe('retrait d’assurance vie de plus de 8 ans', () => {
  // F22414 et BOFiP BOI-RPPM-RCM-20-10-20-50 : gains du rachat = rachat − versements × rachat / valeur ;
  // abattement 4 600 €, imputé d'abord sur la part à 7,5 % ; 12,8 % sur les gains liés aux
  // versements au-delà de 150 000 € ; prélèvements sociaux 17,2 %.
  const av = (totalAmount: number, totalDeposits: number) =>
    ({ type: AccountType.ASSURANCE_VIE, openingDate: '2010-01-01', totalAmount, totalDeposits });

  it('gains sous l’abattement : pas d’impôt sur le revenu, 17,2 % de prélèvements sociaux', () => {
    // 100 000 € dont 50 000 € de versements : 5 000 € retirés contiennent 2 500 € de gains.
    const t = computeWithdrawalTax(av(100000, 50000), 5000, CFG, NOW);
    expect(t.gainPart).toBeCloseTo(2500, 6);
    expect(t.incomeTax).toBe(0);
    expect(t.socialCharges).toBeCloseTo(430, 6);
  });

  it('au-delà : 7,5 % sur les gains moins 4 600 €', () => {
    // 20 000 € retirés : 10 000 € de gains, (10 000 − 4 600) × 7,5 % = 405 €.
    const t = computeWithdrawalTax(av(100000, 50000), 20000, CFG, NOW);
    expect(t.incomeTax).toBeCloseTo(405, 6);
    expect(t.socialCharges).toBeCloseTo(1720, 6);
    expect(t.net).toBeCloseTo(20000 - 405 - 1720, 6);
  });

  it('versements au-delà de 150 000 € : 12,8 % sur leur part de gains', () => {
    // 400 000 € dont 200 000 € de versements ; 40 000 € retirés = 20 000 € de gains, dont
    // 15 000 € liés aux 150 000 premiers euros (7,5 %) et 5 000 € au-delà (12,8 %).
    // Abattement sur la part à 7,5 % d'abord : (15 000 − 4 600) × 7,5 % + 5 000 × 12,8 % = 780 + 640.
    const t = computeWithdrawalTax(av(400000, 200000), 40000, CFG, NOW);
    expect(t.incomeTax).toBeCloseTo(1420, 6);
  });
});
