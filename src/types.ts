export enum AccountType {
  LIVRET_A = 'Livret A',
  LDDS = 'LDDS',
  LEP = 'LEP',
  ASSURANCE_VIE = 'Assurance Vie',
  PEE = 'PEE (Plan Epargne Entreprise)',
  PEA = 'PEA',
  PER = 'PER',
  COMPTE_COURANT = 'Compte Courant',
  IMMOBILIER = 'Immobilier (SCPI/Physique)',
  CRYPTO = 'Cryptomonnaies',
  AUTRE = 'Autre'
}

export interface AccountMovement {
  id: string;
  date: string;
  amount: number;      // Positif pour crédit, négatif pour débit
  label: string;       // Ex: "Virement salaire", "Dépôt test +500", etc.
  type: 'IN' | 'OUT'; // Flux entrant ou sortant
  linkId?: string;
}

export interface SavingsAccount {
  id: string;
  name: string;
  type: AccountType;
  institution: string; 
  totalAmount: number; 
  ownedAmount: number; 
  parentalCapital: number; 
  interestRate?: number; 
  recentHighRate?: number;
  recentLowRate?: number;
  openingDate?: string; 
  contractEndDate?: string; 
  ceiling?: number; 
  isRevolut?: boolean; 
  isTaxable?: boolean;
  movements: AccountMovement[]; 
}

export interface PortfolioSnapshot {
  date: string; 
  totalAmount: number;
  ownedAmount: number;
}

export enum PaymentMethod {
  VIREMENT = 'Virement Permanent',
  PRELEVEMENT = 'Prélèvement',
  CARTE = 'Carte Bancaire',
  CHEQUE = 'Chèque',
  AUTRE = 'Autre'
}

export interface Expense {
  id: string;
  name: string;
  amount: number;
  paymentMethod: PaymentMethod;
}

// --- NOUVEAU : STRUCTURE DU CHAT ---
export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  content: string;
  timestamp: number;
}

// Configuration for generating an image (Conservé pour compatibilité si besoin)
export interface ImageGenerationConfig {
  prompt: string;
  size: '1K' | '2K' | '4K';
}

export interface ImageEditConfig {
  prompt: string;
  base64Image: string;
  mimeType: string;
}
export interface TaxBracket {
  limit: number;
  rate: number;
}

export interface FiscalConfig {
  salaryChargesRate: number;     // Ex: 0.2232
  socialChargesCapital: number;  // Ex: 0.172
  standardAllowance: number;     // Ex: 0.10
  ceilings: {
    livretA: number;
    ldds: number;
    lep: number;
  };
  legalMaturity: {
    pea: number;
    assuranceVie: number;
    pee: number;
  };
  taxBrackets: TaxBracket[];
}

export interface GlobalAppData {
  accounts: SavingsAccount[];
  expenses: Expense[];
  history: PortfolioSnapshot[];
  // Ajout de la config fiscale
  fiscalConfig?: FiscalConfig; 
  config: {
    grossAnnual: number;
    leisureBudget: number;
    projectSavings: number;
    navigoBase: number;
    navigoRate: number;
    taxRateManual: number;
    extraMonthlyIncome: number;
  };
  goalPrompt?: string;
  financing?: {
    interestRate: number;
    insuranceRate: number;
  };
  lastView?: string;
  chatHistory?: ChatMessage[];
}