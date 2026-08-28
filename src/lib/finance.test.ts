import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  computeIncomeTax,
  computeIncome,
  computeSavingsCapacity,
  computeWeightedAnnualRate,
  computeCapitalGainsTax,
  computeParentalInterest,
  computeMaturityCountdown,
  computeAccountBalanceAtDate,
  computeRecentSavingsRate,
} from './finance';
import { DEFAULT_FISCAL_CONFIG, DEFAULT_WORK_BENEFITS } from '../constants';
import { FiscalConfig, TaxBracket, WorkBenefits, AccountType } from '../types';

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

  it('ne taxe ni un revenu nul ni un revenu négatif', () => {
    expect(computeIncomeTax(0, brackets)).toBe(0);
    // Une assiette négative ne doit jamais produire un "impôt négatif" (crédit fictif).
    expect(computeIncomeTax(-5000, brackets)).toBe(0);
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

  it('traite exactement les bornes du barème', () => {
    // Pile en haut de la tranche à 0% : aucun impôt.
    expect(computeIncomeTax(11294, brackets)).toBeCloseTo(0, 2);
    // Pile en haut de la tranche à 11% : (28797 - 11294) * 0.11 = 1925.33
    expect(computeIncomeTax(28797, brackets)).toBeCloseTo(1925.33, 2);
    // 1 € de plus n'est taxé qu'à 30% : 1925.33 + 0.30
    expect(computeIncomeTax(28798, brackets)).toBeCloseTo(1925.63, 2);
  });

  it('gère la dernière tranche (limit = Infinity)', () => {
    // 500 000 : 17503*0.11 + 53544*0.30 + 94765*0.41 + 322894*0.45
    //         = 1925.33 + 16063.20 + 38853.65 + 145302.30 = 202144.48
    expect(computeIncomeTax(500000, brackets)).toBeCloseTo(202144.48, 2);
  });

  it('donne le même impôt sur un barème désordonné (tranches éditables)', () => {
    // Le bouton « Ajouter tranche » des Paramètres appende en fin de liste : le barème
    // peut être désordonné. 50 000 => 17503*0.11 + 21203*0.30 = 8286.23
    const shuffled = [...brackets].reverse();
    expect(computeIncomeTax(50000, brackets)).toBeCloseTo(8286.23, 2);
    expect(computeIncomeTax(50000, shuffled)).toBeCloseTo(8286.23, 2);
  });

  it('ne laisse pas une tranche Infinity placée en tête tout absorber', () => {
    // Avant correction : 50000 * 0.45 = 22 500 €. Après tri : 8 286,23 €.
    const infinityFirst: TaxBracket[] = [
      { limit: Infinity, rate: 0.45 },
      { limit: 11294, rate: 0 },
      { limit: 28797, rate: 0.11 },
      { limit: 82341, rate: 0.30 },
      { limit: 177106, rate: 0.41 },
    ];
    expect(computeIncomeTax(50000, infinityFirst)).toBeCloseTo(8286.23, 2);
  });

  it('replace une tranche saisie après la dernière (limit null = Infinity)', () => {
    // limit null/undefined vaut Infinity et doit se retrouver en dernier après tri.
    const brokenOrder = [
      { limit: null as unknown as number, rate: 0.45 },
      { limit: 11294, rate: 0 },
      { limit: 28797, rate: 0.11 },
    ];
    // 20 000 : (20000 - 11294) * 0.11 = 957.66 (et non 20000 * 0.45)
    expect(computeIncomeTax(20000, brokenOrder)).toBeCloseTo(957.66, 2);
  });

  it('ne taxe pas deux fois la même part quand deux bornes sont identiques', () => {
    const duplicated: TaxBracket[] = [
      { limit: 10000, rate: 0.1 },
      { limit: 10000, rate: 0.2 },
      { limit: Infinity, rate: 0.3 },
    ];
    // 10000*0.1 (1re) + 0 (borne déjà consommée) + 10000*0.3 = 4000
    expect(computeIncomeTax(20000, duplicated)).toBeCloseTo(4000, 2);
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

  // Repères calculés à la main pour 45 000 € brut, charges 22,32 % :
  // grossMonth 3750 ; charges 837 ; net 2913 ; net annuel 34 956
  // abattement 10 % = 3495,60 (< plafond) ; assiette 31 460,40
  // impôt = 17503*0.11 + 2663.40*0.30 = 1925.33 + 799.02 = 2724.35

  it('déduit les charges salariales du brut', () => {
    const r = computeIncome(baseInput, DEFAULT_FISCAL_CONFIG, NO_BENEFITS);
    expect(r.grossMonth).toBeCloseTo(3750, 2);
    expect(r.socialCharges).toBeCloseTo(837, 2);
    expect(r.netSalaryOnly).toBeCloseTo(2913, 2);
    expect(r.netTaxableYear).toBeCloseTo(31460.4, 2);
    expect(r.taxAmount).toBeCloseTo(2724.35, 2);
    expect(r.monthlyTax).toBeCloseTo(227.03, 2);
  });

  it('exclut le remboursement Navigo de l\'assiette imposable', () => {
    const withNavigo = computeIncome(baseInput, DEFAULT_FISCAL_CONFIG, {
      ...NO_BENEFITS,
      navigo: { active: true, basePrice: 90, refundRate: 50 },
    });
    // Le gain Navigo augmente le net avant impôt mais pas l'assiette (exonéré).
    expect(withNavigo.navigoGain).toBeCloseTo(45, 2);
    expect(withNavigo.netBeforeTax).toBeCloseTo(2913 + 45, 2);
    expect(withNavigo.netTaxableYear).toBeCloseTo(31460.4, 2);
    expect(withNavigo.taxAmount).toBeCloseTo(2724.35, 2);
  });

  it('applique le taux forcé à l\'assiette imposable, pas au net avant impôt', () => {
    // Correction du bug d'assiette : 31460.40 / 12 * 10 % = 262.17
    // (avant : netBeforeTax * 10 %, ce qui imposait aussi le Navigo).
    const forced = computeIncome(
      { ...baseInput, taxRateManual: 10 },
      DEFAULT_FISCAL_CONFIG,
      NO_BENEFITS
    );
    expect(forced.effectiveMonthlyTax).toBeCloseTo(262.17, 2);

    const forcedWithNavigo = computeIncome(
      { ...baseInput, taxRateManual: 10 },
      DEFAULT_FISCAL_CONFIG,
      { ...NO_BENEFITS, navigo: { active: true, basePrice: 90, refundRate: 50 } }
    );
    // Même impôt forcé qu'sans Navigo : le remboursement n'est plus imposé.
    expect(forcedWithNavigo.effectiveMonthlyTax).toBeCloseTo(262.17, 2);
  });

  it('plafonne l\'abattement forfaitaire de 10%', () => {
    // 400 000 brut : net annuel 310 720 ; abattement plafonné à 14 171 => assiette 296 549
    // impôt = 1925.33 + 16063.20 + 38853.65 + 119443*0.45 = 110 591.53
    // Sans plafond l'assiette serait 279 648 et l'impôt 102 986.08 (-7 605.45).
    const r = computeIncome(
      { ...baseInput, grossAnnual: 400000 },
      DEFAULT_FISCAL_CONFIG,
      NO_BENEFITS
    );
    expect(r.netTaxableYear).toBeCloseTo(296549, 2);
    expect(r.taxAmount).toBeCloseTo(110591.53, 2);
  });

  it('retombe sur le plafond par défaut si le champ est absent des données', () => {
    // Rétrocompatibilité : les fichiers enregistrés avant l'ajout du champ n'ont pas
    // standardAllowanceCap. Le résultat doit être identique, et surtout jamais NaN.
    const { standardAllowanceCap: _omit, ...legacyConfig } = DEFAULT_FISCAL_CONFIG;
    const r = computeIncome(
      { ...baseInput, grossAnnual: 400000 },
      legacyConfig as FiscalConfig,
      NO_BENEFITS
    );
    expect(r.netTaxableYear).toBeCloseTo(296549, 2);
    expect(r.taxAmount).toBeCloseTo(110591.53, 2);
    expect(Number.isNaN(r.superNet)).toBe(false);
  });

  it('retire mutuelle et tickets resto du super net', () => {
    const r = computeIncome(baseInput, DEFAULT_FISCAL_CONFIG, DEFAULT_WORK_BENEFITS);
    expect(r.superNet).toBeCloseTo(r.superNetRaw - r.effectiveMonthlyTax, 2);
    expect(r.superNetRaw).toBeCloseTo(r.netBeforeTax - r.mutuelleCost - r.swileCost, 2);
    expect(r.mutuelleCost).toBeCloseTo(25, 2);
    expect(r.swileCost).toBeCloseTo(80, 2);
  });

  it('compte le remboursement Navigo comme un gain', () => {
    const withNavigo = computeIncome(baseInput, DEFAULT_FISCAL_CONFIG, {
      ...NO_BENEFITS,
      navigo: { active: true, basePrice: 90, refundRate: 50 },
    });
    expect(withNavigo.navigoGain).toBeCloseTo(45, 2);
  });

  it('utilise navigoBase/navigoRate en repli quand l\'avantage est inactif', () => {
    const r = computeIncome(
      { ...baseInput, navigoBase: 90.8, navigoRate: 67.24 },
      DEFAULT_FISCAL_CONFIG,
      NO_BENEFITS
    );
    expect(r.navigoGain).toBeCloseTo(61.05, 2);
    // Et toujours hors assiette imposable.
    expect(r.netTaxableYear).toBeCloseTo(31460.4, 2);
  });

  it('ne produit aucun NaN sur un revenu nul', () => {
    const r = computeIncome({ ...baseInput, grossAnnual: 0 }, DEFAULT_FISCAL_CONFIG, NO_BENEFITS);
    expect(r.netTaxableYear).toBe(0);
    expect(r.taxAmount).toBe(0);
    expect(r.autoRate).toBe(0);
    expect(r.superNet).toBe(0);
  });
});

describe('computeSavingsCapacity', () => {
  it('soustrait charges fixes, plaisir et projets du super net', () => {
    expect(computeSavingsCapacity(2000, 800, 300, 200)).toBe(700);
  });

  it('retourne une capacité négative en cas de dépassement', () => {
    expect(computeSavingsCapacity(1500, 1200, 400, 100)).toBe(-200);
  });

  it('vaut le super net quand aucune dépense n\'est renseignée', () => {
    expect(computeSavingsCapacity(1234.56, 0, 0, 0)).toBeCloseTo(1234.56, 2);
  });
});

describe('computeWeightedAnnualRate', () => {
  // Le temps doit être figé : la pondération dépend de "maintenant" pour l'année en cours,
  // sinon les valeurs attendues changent chaque jour (et à chaque passage d'année).
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-15T00:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('retourne le taux courant sans historique', () => {
    expect(computeWeightedAnnualRate(3, undefined, 2026)).toBe(3);
    expect(computeWeightedAnnualRate(3, [], 2026)).toBe(3);
  });

  it('applique le taux courant depuis le dernier changement, pas depuis aujourd\'hui', () => {
    // Dernier changement en 2020 : le taux courant couvre toute la période 2026 observée.
    // Avant correction : ~1.008 (le taux courant ne pesait que quelques heures).
    expect(computeWeightedAnnualRate(5, [{ date: '2020-01-01', rate: 1 }], 2026)).toBeCloseTo(5, 10);
  });

  it('pondère par la durée de chaque segment sur une année passée', () => {
    // Taux 2% jusqu'au 1er juillet 2025 (181 j), puis 4% jusqu'au 31/12 inclus (184 j).
    // (181*2 + 184*4) / 365 = 1098 / 365 = 3.008219178...
    const rate = computeWeightedAnnualRate(4, [{ date: '2025-07-01', rate: 2 }], 2025);
    expect(rate).toBeCloseTo(1098 / 365, 10);
  });

  it('compte 365 jours sur une année pleine (31/12 inclus)', () => {
    // Changement daté du 31/12/2025 : 364 j à 2% puis 1 j à 4%.
    // (364*2 + 1*4) / 365 = 732 / 365 = 2.005479452...
    // Avant correction, le 31/12 était exclu : ce changement avait un poids nul.
    const rate = computeWeightedAnnualRate(4, [{ date: '2025-12-31', rate: 2 }], 2025);
    expect(rate).toBeCloseTo(732 / 365, 10);
  });

  it('enchaîne plusieurs segments de taux', () => {
    // 1% jusqu'au 01/04 (90 j), 3% jusqu'au 01/10 (183 j), 5% jusqu'au 31/12 (92 j).
    // (90*1 + 183*3 + 92*5) / 365 = 1099 / 365 = 3.010958904...
    const rate = computeWeightedAnnualRate(
      5,
      [
        { date: '2025-04-01', rate: 1 },
        { date: '2025-10-01', rate: 3 },
      ],
      2025
    );
    expect(rate).toBeCloseTo(1099 / 365, 10);
  });

  it('ne garde que la dernière saisie en cas de dates dupliquées', () => {
    // Règle explicite : à date égale, la dernière valeur du tableau fait foi.
    // (181*9 + 184*4) / 365 = 2365 / 365
    const lastWins = computeWeightedAnnualRate(
      4,
      [
        { date: '2025-07-01', rate: 2 },
        { date: '2025-07-01', rate: 9 },
      ],
      2025
    );
    expect(lastWins).toBeCloseTo(2365 / 365, 10);

    // Ordre inverse : c'est 2% qui l'emporte => 1098 / 365. Le résultat est donc
    // déterministe (il ne dépend plus du hasard d'un tri stable).
    const reversed = computeWeightedAnnualRate(
      4,
      [
        { date: '2025-07-01', rate: 9 },
        { date: '2025-07-01', rate: 2 },
      ],
      2025
    );
    expect(reversed).toBeCloseTo(1098 / 365, 10);
  });

  it('ignore un changement daté dans le futur', () => {
    // Le changement du 01/09/2026 n'a pas encore eu lieu au 15/06/2026 : tout le
    // cumul de l'année observée est au taux historisé.
    const rate = computeWeightedAnnualRate(3, [{ date: '2026-09-01', rate: 1 }], 2026);
    expect(rate).toBeCloseTo(1, 10);
  });

  it('pondère l\'année en cours jusqu\'à aujourd\'hui seulement', () => {
    // Au 15/06/2026 : 1% du 01/01 au 01/04 (90 j), puis 4% jusqu'au 15/06 (75 j).
    // (90*1 + 75*4) / 165 = 390 / 165
    const rate = computeWeightedAnnualRate(4, [{ date: '2026-04-01', rate: 1 }], 2026);
    expect(rate).toBeCloseTo(390 / 165, 10);
  });

  it('retourne le taux courant pour une année future', () => {
    expect(computeWeightedAnnualRate(5, [{ date: '2020-01-01', rate: 1 }], 2030)).toBe(5);
  });
});

describe('computeCapitalGainsTax (PFU / prélèvements sociaux)', () => {
  const fiscal = DEFAULT_FISCAL_CONFIG; // socialChargesCapital: 0.172, legalMaturity: {pea:5, assuranceVie:8, pee:5}
  const NOW = new Date('2026-01-01T00:00:00Z');

  it("n'applique rien à un gain nul ou négatif", () => {
    const r = computeCapitalGainsTax({ type: AccountType.PEA, openingDate: '2020-01-01' }, 0, fiscal, NOW);
    expect(r).toEqual({ grossInterest: 0, socialCharges: 0, incomeTax: 0, netInterest: 0, regime: 'PFU' });
  });

  it('applique le PFU à 30% (12,8% IR + 17,2% social) sur un PEA récent', () => {
    const r = computeCapitalGainsTax({ type: AccountType.PEA, openingDate: '2024-01-01' }, 1000, fiscal, NOW);
    expect(r.socialCharges).toBeCloseTo(172, 5);
    expect(r.incomeTax).toBeCloseTo(128, 5);
    expect(r.netInterest).toBeCloseTo(700, 5);
    expect(r.regime).toBe('PFU');
  });

  it('exonère un PEA de plus de 5 ans d\'IR, mais garde les 17,2% sociaux', () => {
    const r = computeCapitalGainsTax({ type: AccountType.PEA, openingDate: '2015-01-01' }, 1000, fiscal, NOW);
    expect(r.incomeTax).toBe(0);
    expect(r.socialCharges).toBeCloseTo(172, 5);
    expect(r.netInterest).toBeCloseTo(828, 5);
    expect(r.regime).toBe('EXONERE_IR');
  });

  it('exonère un PEE de plus de 5 ans d\'IR, comme un PEA', () => {
    const r = computeCapitalGainsTax({ type: AccountType.PEE, openingDate: '2015-01-01' }, 1000, fiscal, NOW);
    expect(r.incomeTax).toBe(0);
    expect(r.regime).toBe('EXONERE_IR');
  });

  it('applique le taux réduit 7,5% + 17,2% social sur une Assurance Vie de plus de 8 ans', () => {
    const r = computeCapitalGainsTax({ type: AccountType.ASSURANCE_VIE, openingDate: '2015-01-01' }, 1000, fiscal, NOW);
    expect(r.incomeTax).toBeCloseTo(75, 5);
    expect(r.socialCharges).toBeCloseTo(172, 5);
    expect(r.netInterest).toBeCloseTo(753, 5);
    expect(r.regime).toBe('AV_REDUIT');
  });

  it('applique le PFU complet sur une Assurance Vie de moins de 8 ans', () => {
    const r = computeCapitalGainsTax({ type: AccountType.ASSURANCE_VIE, openingDate: '2024-01-01' }, 1000, fiscal, NOW);
    expect(r.incomeTax).toBeCloseTo(128, 5);
    expect(r.regime).toBe('PFU');
  });

  it('applique le PFU flat sur le crypto quelle que soit la durée de détention', () => {
    const recent = computeCapitalGainsTax({ type: AccountType.CRYPTO, openingDate: '2025-12-01' }, 1000, fiscal, NOW);
    const old = computeCapitalGainsTax({ type: AccountType.CRYPTO, openingDate: '2010-01-01' }, 1000, fiscal, NOW);
    expect(recent.incomeTax).toBeCloseTo(128, 5);
    expect(old.incomeTax).toBeCloseTo(128, 5); // pas d'exonération par ancienneté pour le crypto
    expect(recent.regime).toBe('PFU');
  });

  it("ne modélise pas l'immobilier ou le PER (régimes trop spécifiques)", () => {
    const immo = computeCapitalGainsTax({ type: AccountType.IMMOBILIER, openingDate: '2010-01-01' }, 1000, fiscal, NOW);
    const per = computeCapitalGainsTax({ type: AccountType.PER, openingDate: '2010-01-01' }, 1000, fiscal, NOW);
    expect(immo).toEqual({ grossInterest: 1000, socialCharges: 0, incomeTax: 0, netInterest: 1000, regime: 'NON_MODELISE' });
    expect(per.regime).toBe('NON_MODELISE');
  });

  it("suppose le cas défavorable (compte récent) quand la date d'ouverture est inconnue", () => {
    const r = computeCapitalGainsTax({ type: AccountType.PEA, openingDate: undefined }, 1000, fiscal, NOW);
    expect(r.regime).toBe('PFU'); // jamais d'exonération non prouvée
  });
});

describe('computeParentalInterest', () => {
  it('répartit les intérêts entre part propre et part parentale au prorata du capital', () => {
    const r = computeParentalInterest(
      [{ interestRate: 4, totalAmount: 1000, ownedAmount: 600 }],
      2025
    );
    expect(r.totalAnnual).toBeCloseTo(40, 5);
    expect(r.totalAnnualOwned).toBeCloseTo(24, 5);
    expect(r.totalAnnualParental).toBeCloseTo(16, 5);
  });

  it('ignore les comptes sans taux ou à solde nul', () => {
    const r = computeParentalInterest(
      [
        { interestRate: 0, totalAmount: 1000, ownedAmount: 1000 },
        { interestRate: 3, totalAmount: 0, ownedAmount: 0 },
      ],
      2025
    );
    expect(r).toEqual({ totalAnnual: 0, totalAnnualOwned: 0, totalAnnualParental: 0 });
  });

  it('cumule plusieurs comptes', () => {
    const r = computeParentalInterest(
      [
        { interestRate: 4, totalAmount: 1000, ownedAmount: 1000 }, // 100% à moi
        { interestRate: 2, totalAmount: 2000, ownedAmount: 0 },    // 100% aux parents
      ],
      2025
    );
    expect(r.totalAnnual).toBeCloseTo(80, 5);
    expect(r.totalAnnualOwned).toBeCloseTo(40, 5);
    expect(r.totalAnnualParental).toBeCloseTo(40, 5);
  });

  it('ne renvoie jamais une part parentale négative', () => {
    // Garde-fou : ownedAmount ne devrait jamais dépasser totalAmount, mais si une
    // incohérence de données passait au travers, le résultat reste borné à 0.
    const r = computeParentalInterest(
      [{ interestRate: 4, totalAmount: 1000, ownedAmount: 1500 }],
      2025
    );
    expect(r.totalAnnualParental).toBe(0);
  });
});

describe('computeMaturityCountdown', () => {
  const fiscal = DEFAULT_FISCAL_CONFIG; // legalMaturity: {pea:5, assuranceVie:8, pee:5}
  const NOW = new Date('2026-01-01T00:00:00Z');

  it('annonce le passage en régime favorable pour un PEA pas encore mature', () => {
    // Ouvert le 01/01/2022 : 4 ans révolus au 01/01/2026, maturité à 5 ans -> ~1 an restant.
    const r = computeMaturityCountdown({ type: AccountType.PEA, openingDate: '2022-01-01', interestRate: 5, totalAmount: 1000 }, fiscal, NOW);
    expect(r).not.toBeNull();
    expect(r!.regimeBefore).toBe('PFU');
    expect(r!.regimeAfter).toBe('EXONERE_IR');
    expect(r!.monthsRemaining).toBeGreaterThan(10);
    expect(r!.monthsRemaining).toBeLessThan(14);
    // Économie = 12,8% (part IR du PFU) sur les intérêts annuels actuels (1000*5%=50).
    expect(r!.annualTaxSaving).toBeCloseTo(50 * 0.128, 5);
  });

  it('renvoie null pour un compte déjà mature', () => {
    const r = computeMaturityCountdown({ type: AccountType.PEA, openingDate: '2015-01-01', interestRate: 5, totalAmount: 1000 }, fiscal, NOW);
    expect(r).toBeNull();
  });

  it("renvoie null sans date d'ouverture connue", () => {
    const r = computeMaturityCountdown({ type: AccountType.PEA, openingDate: undefined, interestRate: 5, totalAmount: 1000 }, fiscal, NOW);
    expect(r).toBeNull();
  });

  it("renvoie null pour un type de compte sans notion de maturité (Livret A, Crypto, Immobilier)", () => {
    expect(computeMaturityCountdown({ type: AccountType.LIVRET_A, openingDate: '2024-01-01', totalAmount: 1000 }, fiscal, NOW)).toBeNull();
    expect(computeMaturityCountdown({ type: AccountType.CRYPTO, openingDate: '2024-01-01', totalAmount: 1000 }, fiscal, NOW)).toBeNull();
    expect(computeMaturityCountdown({ type: AccountType.IMMOBILIER, openingDate: '2024-01-01', totalAmount: 1000 }, fiscal, NOW)).toBeNull();
  });

  it('calcule le passage au taux réduit pour une Assurance Vie pas encore mature', () => {
    // Ouverte le 01/01/2019 : 7 ans révolus au 01/01/2026, maturité à 8 ans.
    const r = computeMaturityCountdown({ type: AccountType.ASSURANCE_VIE, openingDate: '2019-01-01', interestRate: 3, totalAmount: 10000 }, fiscal, NOW);
    expect(r).not.toBeNull();
    expect(r!.regimeBefore).toBe('PFU');
    expect(r!.regimeAfter).toBe('AV_REDUIT');
    // Économie = (12,8% - 7,5%) sur les intérêts annuels actuels (10000*3%=300).
    expect(r!.annualTaxSaving).toBeCloseTo(300 * (0.128 - 0.075), 5);
  });

  it("renvoie quand même le compte à rebours sans intérêt connu, avec une économie nulle", () => {
    const r = computeMaturityCountdown({ type: AccountType.PEA, openingDate: '2022-01-01', totalAmount: 1000 }, fiscal, NOW);
    expect(r).not.toBeNull();
    expect(r!.annualTaxSaving).toBe(0);
  });
});

describe('computeAccountBalanceAtDate', () => {
  it('retire les mouvements postérieurs à la date pour reconstruire le solde passé', () => {
    const accounts = [{
      ownedAmount: 1000,
      movements: [
        { id: '1', date: '2026-01-10', amount: 200, label: 'x', type: 'IN' as const },
        { id: '2', date: '2026-01-20', amount: 50, label: 'x', type: 'OUT' as const },
      ],
    }];
    // Avant le 10/01 : on retire le dépôt de 200 ET on annule le retrait de 50 (on l'ajoute).
    expect(computeAccountBalanceAtDate(accounts, '2026-01-05')).toBe(1000 - 200 + 50);
    // Entre les deux mouvements : seul le retrait du 20/01 est encore "futur".
    expect(computeAccountBalanceAtDate(accounts, '2026-01-15')).toBe(1000 + 50);
    // Après les deux : solde actuel intact.
    expect(computeAccountBalanceAtDate(accounts, '2026-01-25')).toBe(1000);
  });

  it('cumule plusieurs comptes', () => {
    const accounts = [{ ownedAmount: 500, movements: [] }, { ownedAmount: 300, movements: [] }];
    expect(computeAccountBalanceAtDate(accounts, '2026-01-01')).toBe(800);
  });
});

describe('computeRecentSavingsRate', () => {
  it('renvoie null sans mouvement dans la fenêtre observée', () => {
    const accounts = [{ ownedAmount: 1000, movements: [] }];
    expect(computeRecentSavingsRate(accounts, 90, new Date('2026-01-01'))).toBeNull();
  });

  it('calcule le rythme mensuel sur la fenêtre glissante (90 jours = 3 mois)', () => {
    const now = new Date('2026-01-01T00:00:00');
    const accounts = [{
      ownedAmount: 1600,
      movements: [
        { id: '1', date: '2025-11-01', amount: 200, label: 'x', type: 'IN' as const },
        { id: '2', date: '2025-12-01', amount: 200, label: 'x', type: 'IN' as const },
        { id: '3', date: '2025-12-15', amount: 200, label: 'x', type: 'IN' as const },
      ],
    }];
    // Les 3 dépôts (600 au total) sont dans la fenêtre des 90 jours -> 600/3 = 200/mois.
    expect(computeRecentSavingsRate(accounts, 90, now)).toBeCloseTo(200, 5);
  });

  it("permet de calculer le rythme d'une fenêtre PASSÉE en décalant asOfDate (utilisé pour la dérive)", () => {
    const accounts = [{
      ownedAmount: 1000,
      movements: [
        { id: '1', date: '2025-08-01', amount: 90, label: 'x', type: 'IN' as const },
      ],
    }];
    // Fenêtre se terminant le 01/09/2025 (donc [03/06 -> 01/09] environ) contient le dépôt.
    const rate = computeRecentSavingsRate(accounts, 90, new Date('2025-09-01T00:00:00'));
    expect(rate).toBeCloseTo(30, 5); // 90 / 3 mois
    // Fenêtre se terminant aujourd'hui (bien après) ne contient plus ce dépôt isolé.
    expect(computeRecentSavingsRate(accounts, 90, new Date('2026-06-01'))).toBeNull();
  });
});
