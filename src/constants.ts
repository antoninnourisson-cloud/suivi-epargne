// --- CONSTANTES FISCALES (Barème 2025 sur revenus 2024) ---
export const TAX_BRACKETS = [
  { limit: 11294, rate: 0 },
  { limit: 28797, rate: 0.11 },
  { limit: 82341, rate: 0.30 },
  { limit: 177106, rate: 0.41 },
  { limit: Infinity, rate: 0.45 }
];

export const STANDARD_ALLOWANCE = 0.10; 
export const SOCIAL_CHARGES_CAPITAL = 0.172; 

// Ajusté pour correspondre à ton profil (Pasteur/Post-doc) : ~22.32%
export const SALARY_CHARGES_RATE = 0.2232; 

// --- DURÉES LÉGALES DE BLOCAGE (Années) ---
export const LEGAL_MATURITY = {
  PEA: 5,
  ASSURANCE_VIE: 8,
  PEE: 5 
};

export const ACCOUNT_CEILINGS = {
  LIVRET_A: 22950,
  LDDS: 12000,
  LEP: 10000
};

export const DEFAULT_RATES = {
  LIVRET_A: 3.0,
  LEP: 4.0,
  FONDS_EURO: 2.5
};