// ================================================
// FILE: src/constants.ts
// ================================================
import { FiscalConfig } from './types';

export const DEFAULT_FISCAL_CONFIG: FiscalConfig = {
  // Ajusté pour profil Pasteur/Post-doc (~22.32%)
  salaryChargesRate: 0.2232, 
  // Prélèvements sociaux sur capital (17.2%)
  socialChargesCapital: 0.172,
  // Abattement forfaire 10%
  standardAllowance: 0.10,
  
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

  // Barème 2025 sur revenus 2024
  taxBrackets: [
    { limit: 11294, rate: 0 },
    { limit: 28797, rate: 0.11 },
    { limit: 82341, rate: 0.30 },
    { limit: 177106, rate: 0.41 },
    { limit: Infinity, rate: 0.45 }
  ]
};

// On garde ça pour les taux par défaut à l'ouverture de compte
export const DEFAULT_RATES = {
  LIVRET_A: 3.0,
  LEP: 4.0,
  FONDS_EURO: 2.5
};