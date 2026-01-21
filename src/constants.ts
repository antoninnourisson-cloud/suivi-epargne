// --- CONSTANTES FISCALES (Barème 2025 sur revenus 2024) ---
export const TAX_BRACKETS = [
  { limit: 11294, rate: 0 },
  { limit: 28797, rate: 0.11 },
  { limit: 82341, rate: 0.30 },
  { limit: 177106, rate: 0.41 },
  { limit: Infinity, rate: 0.45 }
];

export const STANDARD_ALLOWANCE = 0.10; // Abattement 10% frais professionnels
export const SOCIAL_CHARGES_CAPITAL = 0.172; // CSG/CRDS 17.2% sur placements
export const SALARY_CHARGES_RATE = 0.223; // Charges sociales salariales (22.3%)

// --- PLAFONDS RÉGLEMENTÉS ---
export const ACCOUNT_CEILINGS = {
  LIVRET_A: 22950,
  LDDS: 12000,
  LEP: 10000
};

// --- RENDEMENTS THÉORIQUES ---
export const DEFAULT_RATES = {
  LIVRET_A: 3.0,
  LEP: 4.0,
  FONDS_EURO: 2.5
  };
  // ... (Garde le reste du fichier comme avant : TAX_BRACKETS, etc.)

// --- DURÉES LÉGALES DE BLOCAGE (Années) ---
export const LEGAL_MATURITY = {
  PEA: 5,
  ASSURANCE_VIE: 8,
  PEE: 5 // Par défaut si pas de date de fin contrat

};