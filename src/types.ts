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
  // 'valuation' : variation de valeur d'un placement (cours, gains) et non un versement ou
  // un retrait d'argent. Exclu du « placé ce mois-ci ». Absent = argent réellement bougé.
  kind?: 'valuation';
}

export interface RateChange {
  date: string;   // date à laquelle ce taux est devenu actif
  rate: number;   // taux (%) en vigueur à partir de cette date
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
  openingDate?: string;
  contractEndDate?: string;
  ceiling?: number;
  movements?: AccountMovement[];
  isTaxable?: boolean;
  rateHistory?: RateChange[];
  tags?: string[];
  // Versements cumulés (PEA, Assurance Vie, Crypto…), distincts de la valeur du compte :
  // la différence est la plus-value latente, seule part imposée lors d'un retrait.
  // Absent = inconnu (l'app ne devine pas).
  totalDeposits?: number;
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

export interface SavingsGoal {
  id: string;
  name: string;
  targetAmount: number;
  savedAmount: number;
  deadline?: string; // date ISO optionnelle
}

// Champs extraits d'une fiche de paie par l'IA. Tous optionnels : une extraction
// partielle (fiche illisible, champ absent) ne doit jamais bloquer l'enregistrement,
// l'utilisateur complète/corrige à la main avant de valider.
export interface PayslipExtractedData {
  employer?: string;
  period?: string;        // "2026-08" par ex.
  grossAmount?: number;
  // Cotisations et contributions salariales totales retenues sur le brut ce mois.
  socialCharges?: number;
  netAmount?: number;      // Net à payer AVANT impôt sur le revenu
  netTaxable?: number;     // Net imposable (assiette, différent du net à payer)
  navigoRefund?: number;
  mealVouchers?: number;
  // Part salariale de la mutuelle retenue ce mois.
  mutuelleCost?: number;
  // Prélèvement à la source réellement appliqué ce mois (pas une estimation de barème).
  incomeTaxWithheld?: number;
  // Net réellement viré en banque après impôt — la vérité de terrain à laquelle
  // comparer le "Super Net" théorique du Pilotage.
  netPaid?: number;
}

// Versement (ou retrait) qui revient chaque mois. L'app ne l'écrit JAMAIS toute seule :
// elle le propose le moment venu, l'utilisateur confirme (cohérent avec le reste de l'app,
// où aucun montant n'entre dans les données sans validation humaine).
export interface RecurringMovement {
  id: string;
  accountId: string;
  amount: number;
  type: 'IN' | 'OUT';
  label: string;
  dayOfMonth: number; // 1-31 ; ramené au dernier jour pour les mois plus courts
  active: boolean;
}

export type SubscriptionFrequency = 'weekly' | 'monthly' | 'quarterly' | 'semiannual' | 'yearly';

// Abonnement prélevé sur un compte (courant en général) : ne touche jamais aux soldes de
// l'app, sert uniquement aux rappels avant prélèvement.
export interface Subscription {
  id: string;
  name: string;
  amount: number;
  debitAccount: string; // texte libre : « Compte joint BP », « Carte Boursorama »…
  frequency: SubscriptionFrequency;
  anchorDate: string; // 'YYYY-MM-DD' d'un prélèvement connu : les suivants en découlent
  active: boolean;
}

// Don à une association, noté pour la déclaration de revenus (réduction d'impôt).
export interface Donation {
  id: string;
  date: string;          // 'YYYY-MM-DD' : l'année du don = l'année de revenus déclarée
  amount: number;
  organization: string;
  // 75 : organisme d'aide aux personnes en difficulté (repas, soins, logement) ;
  // 66 : tout autre organisme d'intérêt général.
  rate: 66 | 75;
  receiptReceived: boolean;
  receiptFileId?: string;   // reçu fiscal choisi sur le Drive (Google Picker)
  receiptFileName?: string;
  note?: string;
}

export interface PayslipRecord {
  id: string;
  // Fichier resté à sa place sur le Drive de l'utilisateur (sélectionné via Google
  // Picker) : jamais de copie, juste la référence pour le rouvrir depuis Drive.
  fileId: string;
  fileName: string;
  addedAt: string; // date ISO d'import dans l'app
  extracted: PayslipExtractedData;
  // L'utilisateur a relu/corrigé l'extraction avant de l'enregistrer : sert à distinguer
  // une extraction encore brute d'une donnée validée, avant tout usage (ex: pré-remplissage).
  reviewed: boolean;
}

export interface TaxBracket {
  limit: number;
  rate: number;
}

export interface FiscalConfig {
  salaryChargesRate: number;
  socialChargesCapital: number;
  standardAllowance: number;
  // Plafond légal de l'abattement forfaitaire. Optionnel : les fichiers de données
  // enregistrés avant son introduction n'ont pas ce champ, le calcul retombe alors
  // sur DEFAULT_STANDARD_ALLOWANCE_CAP.
  standardAllowanceCap?: number;
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
  // Plafond de Revenu Fiscal de Référence ouvrant droit au LEP, pour UNE part fiscale.
  // Révisé chaque année. Optionnel : les fichiers antérieurs n'ont pas ce champ, l'alerte
  // d'éligibilité est alors simplement désactivée.
  lepIncomeCeiling?: number;
  // Nombre de parts du foyer fiscal, pour ajuster le plafond ci-dessus.
  lepHouseholdParts?: number;
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
    // Clés API saisies par l'utilisateur, stockées en clair dans son propre fichier Drive
    // (même logique de confiance que le CLIENT_ID applicatif) : jamais transmises ailleurs
    // qu'à l'API du fournisseur concerné (Google Picker / Gemini) depuis le navigateur.
    geminiApiKey?: string;
    pickerApiKey?: string;
    // Rappel push le jour de paie avec le plan de placement du Pilotage. Absent = désactivé.
    paydayDay?: number; // 1-31 (ramené au dernier jour des mois plus courts)
    // Montant à placer chaque mois. Absent = capacité d'épargne calculée par le Pilotage.
    paydayAmount?: number;
  };
  goals?: SavingsGoal[];
  lastView?: string;
  payslips?: PayslipRecord[];
  recurringMovements?: RecurringMovement[];
  subscriptions?: Subscription[];
  donations?: Donation[];
  // Fiche de paie actuellement utilisée comme référence exacte dans le Pilotage Budgétaire
  // (bascule le détail charges/impôt sur les vrais chiffres au lieu de la formule
  // théorique). `undefined` = mode estimation (comportement historique, pour simuler des
  // salaires hypothétiques).
  activePayslipId?: string;
}