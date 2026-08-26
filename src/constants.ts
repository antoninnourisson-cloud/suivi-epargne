// ================================================
// FILE: src/constants.ts
// ================================================
import { FiscalConfig, WorkBenefits } from './types';

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

  taxBrackets: [
    { limit: 11294, rate: 0 },
    { limit: 28797, rate: 0.11 },
    { limit: 82341, rate: 0.30 },
    { limit: 177106, rate: 0.41 },
    { limit: Infinity, rate: 0.45 }
  ]
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

export const DEFAULT_RATES = {
  LIVRET_A: 3.0,
  LEP: 4.0,
  FONDS_EURO: 2.5
};