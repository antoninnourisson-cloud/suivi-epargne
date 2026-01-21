
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

export interface SavingsAccount {
  id: string;
  name: string;
  type: AccountType;
  institution: string; 
  totalAmount: number; // Capital total présent sur le compte
  ownedAmount: number; // Part appartenant réellement à l'utilisateur (Part Personnelle)
  parentalCapital: number; // Part appartenant aux parents (intouchable)
  interestRate?: number; 
  recentHighRate?: number; // Taux haut récent net de frais
  recentLowRate?: number; // Taux bas récent net de frais
  openingDate?: string; 
  contractEndDate?: string; 
  ceiling?: number; 
  isRevolut?: boolean; 
  isTaxable?: boolean; // Soumis aux prélèvements sociaux (17.2%)
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

// Configuration for generating an image with Gemini 3 Pro Image Preview
export interface ImageGenerationConfig {
  prompt: string;
  size: '1K' | '2K' | '4K';
}

// Configuration for editing an image with Gemini 2.5 Flash Image
export interface ImageEditConfig {
  prompt: string;
  base64Image: string;
  mimeType: string;
}

// Structure globale du fichier sauvegardé sur Drive
export interface GlobalAppData {
  accounts: SavingsAccount[];
  expenses: Expense[];
  history: PortfolioSnapshot[];
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
}