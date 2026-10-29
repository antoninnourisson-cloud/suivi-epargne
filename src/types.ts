// ================================================
// FILE: src/types.ts
// ================================================

// Valeurs enregistrées telles quelles dans le fichier : ne jamais en renommer une. L'ordre
// est celui de la liste « Type » de la fiche d'un compte.
export enum AccountType {
  LIVRET_A = 'Livret A',
  LDDS = 'LDDS',
  LEP = 'LEP',
  // Livret d'une banque (souvent à taux promotionnel) : intérêts imposés chaque année.
  LIVRET_BANCAIRE = 'Livret bancaire',
  // Épargne logement : régime fiscal selon la date d'ouverture (voir lib/finance/capitalTax).
  CEL = 'CEL',
  PEL = 'PEL',
  // Argent placé jusqu'à une échéance (`contractEndDate`), intérêts imposés.
  COMPTE_A_TERME = 'Compte à terme',
  COMPTE_COURANT = 'Compte Courant',
  PEA = 'PEA',
  // Compte-titres ordinaire : plus-values imposées à la vente, versements suivis.
  CTO = 'Compte-titres',
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
  // un retrait d'argent. Exclu du « placé ce mois-ci ».
  // 'parental' : mouvement de la PART DES PARENTS (ajout, correction, restitution). Exclu
  // de tout ce qui concerne votre part, mais compté pour reconstituer le solde total
  // passé (intérêts). Absent = argent de votre part réellement bougé.
  // 'adjustment' : correction de solde qui n'est PAS de l'épargne (ex. erreur de saisie,
  // intérêts crédités, argent qui n'a fait que transiter). Compte dans les soldes, pas dans
  // « Placé », le taux d'épargne ni les bilans.
  kind?: 'valuation' | 'parental' | 'adjustment';
  // Marque stable des mouvements spéciaux (le libellé, lui, peut être renommé).
  tag?: 'initial' | 'restitution';
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
  // Toujours présent (migrate() le crée vide) : jamais `undefined` après chargement.
  movements: AccountMovement[];
  isTaxable?: boolean;
  rateHistory?: RateChange[];
  tags?: string[];
  // Versements cumulés (PEA, Assurance Vie, Crypto…), distincts de la valeur du compte :
  // la différence est la plus-value latente, seule part imposée lors d'un retrait.
  // Absent = inconnu (l'app ne devine pas).
  totalDeposits?: number;
  // Frais de gestion annuels (%) d'un contrat (unités de compte). Le taux servi d'un fonds
  // euros est déjà net de frais : laisser vide. Absent = 0.
  managementFee?: number;
  // Assurance vie : part du contrat en fonds euros (%). Sur cette part, les prélèvements
  // sociaux sont déjà payés chaque année : un retrait n'en redoit pas. Absent = prudent
  // (tout compté au retrait).
  euroFundPct?: number;
  // Dernière vérification du taux (même inchangé) : éteint le rappel de révision.
  rateReviewedAt?: string;
  // Compte tenu par un établissement à l'étranger (néobanque, courtier, plateforme crypto) :
  // à déclarer chaque année (case 8UU, formulaire 3916 ou 3916-bis). Absent = non précisé.
  heldAbroad?: boolean;
  // Dernier solde constaté ('YYYY-MM-DD') : posé par « Actualiser » et par la fiche du compte,
  // jamais par un versement prévu (liste de paie, mouvement régulier). Absent = d'après les
  // mouvements (voir lib/freshness).
  balanceCheckedAt?: string;
  // « Autre » : argent bloqué (retrait impossible avant une date). Absent = disponible.
  blocked?: boolean;
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
  // Anciens prix (le plus récent en dernier) : repère les hausses.
  priceHistory?: { date: string; amount: number }[];
  // Dernière confirmation « toujours utile » (revue tous les 6 mois).
  reviewedAt?: string;
  // Préavis de résiliation en jours (abonnements trimestriels, semestriels, annuels).
  noticeDays?: number;
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

// Virements de la paie du mois, cochés un par un (voir PayChecklist).
export interface PayChecklistLine {
  key: string;              // 't:<libellé>' (virement sortant) ou 's:<compte>' (épargne)
  label: string;
  amount: number;           // montant prévu
  kind: 'transfer' | 'saving';
  accountId?: string;       // épargne : compte de l'app crédité
  detail?: string;
}
export interface PayChecklist {
  month: string;            // 'YYYY-MM' : le plan est figé pour ce mois-là
  lines: PayChecklistLine[];
  // Virements faits : montant réel (peut différer du prévu) et mouvement enregistré.
  done: Record<string, { amount: number; movementId?: string; alreadyRecorded?: boolean }>;
}

// Réglages de la paie en cours, saisis dans le Pilotage (voir lib/payAdjustment) : ils
// valent jusqu'à la paie suivante, puis sont ignorés.
export interface PayAdjustment {
  period: string;           // 'YYYY-MM' : mois de la paie concernée (payPeriodOf)
  capacity?: number;        // « Capacité d'épargne du mois » saisie (remplace le calcul)
  extra?: number;           // « Somme en plus à placer » (prime, cadeau…)
}

// Restitution du capital parental (prévue fin 2026).
export interface ParentalRestitution {
  plannedDate?: string; // 'YYYY-MM-DD' : date prévue du retrait (rappels)
  done?: {
    date: string;                                                     // date du retrait réel
    accounts: { accountId: string; name: string; amount: number }[];  // capital rendu par compte
    interestsOffered: { year: number; amount: number }[];             // intérêts de leur capital, offerts
  };
}

// Clôture d'une année (voir lib/yearClosing). Les étapes que l'app constate d'après les
// données (soldes, intérêts, relevés, restitution) n'y sont pas : seules les coches à la main.
export interface YearClosingRecord {
  closedOn?: string;   // 'YYYY-MM-DD' : année marquée comme clôturée
  checked?: string[];  // coches à la main (« review », « tax-return », « archive-json »…)
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
  // Deuxième fiche du même mois enregistrée avec « Ajouter » (deuxième employeur, rappel
  // de salaire) : additionnée aux autres. Sans ce marquage, seule la fiche la plus récente
  // d'un mois compte dans les sommes (lib/payslipChecks, countedPayslips).
  addsToPeriod?: boolean;
}

export interface TaxBracket {
  limit: number;
  rate: number;
}

export interface FiscalConfig {
  salaryChargesRate: number;
  // Prélèvements sociaux sur les revenus du capital (18,6 % depuis le 1er janvier 2026 :
  // dividendes, plus-values, PEA, PEE, crypto…).
  socialChargesCapital: number;
  // Prélèvements sociaux propres à l'assurance vie (restés à 17,2 % en 2026). Absent dans
  // les anciens fichiers : migré au chargement.
  socialChargesLifeInsurance?: number;
  // Décote de l'impôt pour une personne seule : impôt − (montant − taux × impôt) quand
  // l'impôt brut est sous le seuil. 2026 : 897 €, 45,25 %, seuil 1 982 €.
  decote?: { single: number; rate: number; threshold: number };
  // Minimum de l'abattement de 10 % (509 € pour les revenus 2025).
  standardAllowanceMin?: number;
  // Plafond LEP : ajout par demi-part au-delà de la 1re part (6 149 € en 2026).
  lepCeilingPerHalfPart?: number;
  // Dons : plafond des dons à 75 % (2 000 € depuis le 14 octobre 2025 ; 2025 garde 1 000 €
  // pour les dons d'avant, voir lib/finance/donations).
  donation75Ceiling?: number;
  // Remboursement transport : dernière année de revenus où la prise en charge facultative
  // (jusqu'à 75 % du prix) est exonérée. Absent = 2026, la date connue (lib/finance/income) ;
  // une prorogation votée la repousse (veille fiscale).
  transportExemptUntil?: number;
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
  // Année du barème officiel appliqué (ex. 2026 = barème publié en 2026, revenus 2025).
  // Absent = barème saisi à la main, ou fichier antérieur à ce suivi.
  taxScaleYear?: number;
  // Barèmes remplacés, conservés pour mémoire (le plus récent en dernier).
  taxBracketsHistory?: { year?: number; replacedOn: string; brackets: TaxBracket[] }[];
  // Dernière année pour laquelle les paramètres fiscaux ont été vérifiés (rappel de janvier).
  paramsReviewedYear?: number;
  // Inflation annuelle moyenne publiée par l'INSEE (indice des prix à la consommation), en %,
  // pour l'année `year`. Mise à jour par la veille fiscale ; absent = valeur livrée avec l'app
  // (DEFAULT_INFLATION de lib/inflation, datée et sourcée).
  inflation?: { rate: number; year: number; source?: string };
}

// Avantages salariaux (Paramètres) : comptés dans la paie nette du Pilotage.
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
  // Version du format (voir src/lib/schema.ts). Absent = fichier antérieur à la v2.
  schemaVersion?: number;
  accounts: SavingsAccount[];
  expenses: Expense[];
  history: PortfolioSnapshot[];
  expensesHistory?: ExpenseSnapshot[];
  fiscalConfig?: FiscalConfig;
  workBenefits?: WorkBenefits;
  config: {
    grossAnnual: number;
    leisureBudget: number;
    projectSavings: number;
    taxRateManual: number;
    extraMonthlyIncome: number;
    // Clés API saisies par l'utilisateur, stockées en clair dans son propre fichier Drive
    // (même logique de confiance que le CLIENT_ID applicatif) : jamais transmises ailleurs
    // qu'à l'API du fournisseur concerné (Google Picker / Gemini) depuis le navigateur.
    geminiApiKey?: string;
    pickerApiKey?: string;
    // Rappel push le jour de paie avec le plan de placement du Pilotage. Absent = désactivé.
    paydayDay?: number; // 1-31 (ramené au dernier jour des mois plus courts)
    // Montant à placer chaque mois. Absent = capacité d'épargne calculée par le Pilotage.
    paydayAmount?: number;
    // Répartition personnalisée de l'épargne (ex. 50 % Livret A, 50 % Assurance Vie) au
    // lieu du plan automatique « meilleur taux d'abord ». Facultative.
    savingsSplit?: { accountId: string; pct: number }[];
    savingsSplitFrom?: string; // 'YYYY-MM-DD' : appliquée à partir de cette date
    // « Repartir de zéro » : seuls les mouvements à partir de cette date comptent comme
    // épargne (Placé, taux d'épargne, bilans). Soldes, intérêts et historique inchangés.
    trackingStartDate?: string;
    // Types de notifications désactivés (id de catégorie → false). Voir lib/notificationPrefs.
    notificationPrefs?: Record<string, boolean>;
    // Notifications sans montant (écran verrouillé) : appliqué par le serveur.
    discreetNotifications?: boolean;
    // Épargne de précaution : nombre de mois de dépenses à garder sur les livrets.
    emergencyMonths?: number;
    // Revenu fiscal de référence relevé sur les avis d'imposition, par année de revenus
    // (éligibilité au LEP). Absent = estimé à partir des fiches de paie ou du salaire.
    rfrByYear?: Record<string, number>;
    // Dernier export JSON téléchargé (rappel trimestriel).
    lastExportAt?: string;
    // Motivation (voir src/lib/motivation.ts) : bons mois, séries, jalons, point de paie.
    // Absent = activé ; false = tout est masqué.
    gamification?: boolean;
    // Seuil d'un « bon mois » : argent mis de côté sur une paie (défaut 500 €).
    goodMonthThreshold?: number;
    // Jalons déjà montrés comme « nouveaux » (célébrés une seule fois, sur tous les appareils).
    milestonesSeen?: string[];
    // Points de paie validés (clés 'YYYY-MM' de la paie).
    payReviewsDone?: string[];
    // Capacité d'épargne et somme en plus de la paie en cours (Pilotage, Accueil, relance).
    payAdjustment?: PayAdjustment;
    // « Plafond épargne retraite » imprimé sur l'avis d'impôt : versements PER déductibles
    // l'année `year` (l'avis 2026, sur les revenus 2025, donne le plafond des versements 2026).
    retirementCeiling?: { year: number; amount: number };
    // Clôture de l'année (lib/yearClosing), par année (« 2026 ») : étapes cochées à la main et
    // date de clôture. Une année clôturée n'a plus de rappel de clôture (Accueil, agenda, serveur).
    yearClosings?: Record<string, YearClosingRecord>;
  };
  // Les anciens fichiers peuvent contenir `goals` (objectifs d'épargne) : jamais lu, gardé tel
  // quel par migrate() comme tout champ inconnu.
  lastView?: string;
  payslips?: PayslipRecord[];
  recurringMovements?: RecurringMovement[];
  subscriptions?: Subscription[];
  donations?: Donation[];
  payChecklist?: PayChecklist;
  parentalRestitution?: ParentalRestitution;
  // Fiche de paie actuellement utilisée comme référence exacte dans le Pilotage Budgétaire
  // (bascule le détail charges/impôt sur les vrais chiffres au lieu de la formule
  // théorique). `undefined` = mode estimation (comportement historique, pour simuler des
  // salaires hypothétiques).
  activePayslipId?: string;
}

/**
 * Données une fois passées par migrate() (src/lib/schema.ts), seule conversion depuis un
 * fichier, un import ou une copie locale : ces listes et réglages y sont toujours présents.
 * `GlobalAppData`, lui, décrit le fichier tel qu'il peut arriver (champs facultatifs).
 */
export type AppDoc = GlobalAppData & Required<Pick<GlobalAppData,
  'expensesHistory' | 'fiscalConfig' | 'workBenefits' | 'payslips' | 'recurringMovements' | 'subscriptions' | 'donations'>>;