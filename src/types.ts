// Définition des types de comptes disponibles
export enum AccountType {
  LIVRET_A = 'Livret A',
  LDDS = 'LDDS',
  LEP = 'LEP',
  CEL = 'CEL',
  PEL = 'PEL',
  AV = 'Assurance Vie',
  PEA = 'PEA',
  PER = 'PER',
  PEE = 'PEE',
  CTO = 'Compte Titres',
  CAT = 'Compte à Terme',
  IMMOBILIER = 'Immobilier', // <--- C'est cette ligne qui manquait !
  AUTRE = 'Autre'
}

export interface SavingsAccount {
  id: string;
  name: string;
  type: AccountType;
  ownedAmount: number;
  interestRate: number;
  ceiling?: number;
  openingDate?: string;
  contractEndDate?: string;
  notes?: string;
}

export interface Expense {
  id: string;
  name: string;
  amount: number;
  category?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  content: string;
  timestamp: number;
}

// Interface globale pour la sauvegarde JSON
export interface GlobalAppData {
  accounts: SavingsAccount[];
  expenses: Expense[];
  config: any;
  history: ChatMessage[];
}

export interface AccountMovement {
  id: string;
  date: string;
  amount: number;
  type: 'DEPOSIT' | 'WITHDRAWAL' | 'INTEREST';
}

export interface PortfolioSnapshot {
  date: string;
  totalAmount: number;
  breakdown: Record<string, number>;
}