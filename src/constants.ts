// ================================================
// FILE: src/constants.ts
// ================================================
import { FiscalConfig, WorkBenefits, TaxBracket } from './types';

// Barèmes officiels de l'impôt sur le revenu (1 part), du plus ancien au plus récent.
// `limit` = borne HAUTE de la tranche. Source : service-public.fr. En ajouter un chaque
// année : l'app propose alors de l'appliquer (voir findFiscalReview).
export interface TaxScale { year: number; label: string; brackets: TaxBracket[] }
export const TAX_SCALES: TaxScale[] = [
  {
    year: 2024, label: 'Barème 2024 (revenus 2023)',
    brackets: [
      { limit: 11294, rate: 0 },
      { limit: 28797, rate: 0.11 },
      { limit: 82341, rate: 0.30 },
      { limit: 177106, rate: 0.41 },
      { limit: Infinity, rate: 0.45 },
    ],
  },
  {
    year: 2026, label: 'Barème 2026 (revenus 2025)',
    brackets: [
      { limit: 11600, rate: 0 },
      { limit: 29579, rate: 0.11 },
      { limit: 84577, rate: 0.30 },
      { limit: 181917, rate: 0.41 },
      { limit: Infinity, rate: 0.45 },
    ],
  },
];
export const LATEST_TAX_SCALE = TAX_SCALES[TAX_SCALES.length - 1];

// Plafond légal de l'abattement de 10 % sur les salaires. Exporté à part pour servir de
// repli aux données utilisateur antérieures à l'ajout du champ (rétrocompatibilité).
export const DEFAULT_STANDARD_ALLOWANCE_CAP = 14171;

export const DEFAULT_FISCAL_CONFIG: FiscalConfig = {
  salaryChargesRate: 0.2232,
  socialChargesCapital: 0.172,
  standardAllowance: 0.10,
  standardAllowanceCap: DEFAULT_STANDARD_ALLOWANCE_CAP,

  ceilings: {
    livretA: 22950,
    ldds: 12000,
    lep: 10000
  },
  
  legalMaturity: {
    pea: 5,
    assuranceVie: 8,
    pee: 5
  },
  // Plafond RFR LEP 2025 pour 1 part (métropole). À réviser chaque année : le montant est
  // publié avec la loi de finances.
  lepIncomeCeiling: 22419,
  lepHouseholdParts: 1,

  taxBrackets: LATEST_TAX_SCALE.brackets,
  taxScaleYear: LATEST_TAX_SCALE.year,
};

export const DEFAULT_WORK_BENEFITS: WorkBenefits = {
  navigo: {
    active: true,
    basePrice: 90.80,
    refundRate: 67.24
  },
  mutuelle: {
    active: true,
    totalCost: 50.00,
    employerRate: 50.00
  },
  mealVouchers: {
    active: true,
    faceValue: 10.00,
    employerRate: 60.00,
    daysPerMonth: 20
  }
};