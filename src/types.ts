// ================================================
// FILE: src/types.ts
// ================================================

export enum AccountType {
  LIVRET_A = 'Livret A',
  LDDS = 'LDDS',
  LEP = 'LEP',
  COMPTE_COURANT = 'Compte Courant',
  PEA = 'PEA',
  PER = 'PER',
  ASSURANCE_VIE = 'Assurance Vie',
  PEE = 'PEE',
  CRYPTO = 'Crypto',
  IMMOBILIER = 'Immobilier',
  AUTRE = 'Autre'
}

export interface AccountMovement {
  id: string;
  date: string;
  amount: number;
  label: string;
  type: 'IN' | 'OUT';
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
  movements?: AccountMovement[];
  isRevolut?: boolean;
  isTaxable?: boolean;
}

export interface PortfolioSnapshot {
  date: string;
  totalAmount: number;
  ownedAmount: number;
}

export interface ExpenseSnapshot {
  date: string;
  total: number;
}

export interface Expense {
  id: string;
  name: string;
  amount: number;
  paymentMethod?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  content: string;
  timestamp: number;
}

export interface SavingsGoal {
  id: string;
  name: string;
  targetAmount: number;
  savedAmount: number;
  deadline?: string; // date ISO optionnelle
}

export interface TaxBracket {
  limit: number;
  rate: number;
}

export interface FiscalConfig {
  salaryChargesRate: number;
  socialChargesCapital: number;
  standardAllowance: number;
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

// --- NOUVELLE INTERFACE ---
export interface WorkBenefits {
  navigo: {
    active: boolean;
    basePrice: number;    // ex: 90.80
    refundRate: number;   // ex: 67.24
  };
  mutuelle: {
    active: boolean;
    totalCost: number;    // Coût total mensuel contrat
    employerRate: number; // % prise en charge employeur
  };
  mealVouchers: {
    active: boolean;
    faceValue: number;    // Valeur faciale titre
    employerRate: number; // % prise en charge employeur
    daysPerMonth: number; // Nb jours moyen
  };
}

export interface GlobalAppData {
  accounts: SavingsAccount[];
  expenses: Expense[];
  history: PortfolioSnapshot[];
  expensesHistory?: ExpenseSnapshot[];
  fiscalConfig?: FiscalConfig;
  workBenefits?: WorkBenefits; // <--- AJOUT
  config: {
    grossAnnual: number;
    leisureBudget: number;
    projectSavings: number;
    navigoBase?: number; // Gardé pour rétrocompatibilité
    navigoRate?: number; // Gardé pour rétrocompatibilité
    taxRateManual: number;
    extraMonthlyIncome: number;
    parentsEmail?: string; // <--- NOUVEAU CHAMP
  };
  goals?: SavingsGoal[];
  lastView?: string;
  chatHistory?: ChatMessage[];
}