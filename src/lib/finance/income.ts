// Revenus : impôt par tranches, décote, super net.
// Partie de src/lib/finance.ts (qui réexporte tout) : importez depuis '../finance'.
import { FiscalConfig, TaxBracket, WorkBenefits, AccountType } from '../../types';
import { DEFAULT_STANDARD_ALLOWANCE_CAP, DEFAULT_STANDARD_ALLOWANCE_MIN, DEFAULT_DECOTE, SOCIAL_CHARGES_LIFE_INSURANCE } from '../../constants';

export interface IncomeInput {
  grossAnnual: number;
  /**
   * Autre SALAIRE (second employeur), net par mois. Traité comme un salaire : il entre dans les
   * salaires imposables (case 1AJ) et dans l'abattement forfaitaire de 10 %, qui ne vaut que pour
   * les salaires, une fois par personne avec un minimum et un plafond
   * (https://www.service-public.gouv.fr/particuliers/vosdroits/F1989). Ce n'est donc pas la place
   * des revenus d'indépendant ni des loyers, qui ont leurs propres règles : le Pilotage le dit.
   */
  extraMonthlyIncome: number;
  /** > 0 pour forcer un taux de prélèvement à la source (appliqué au net imposable AVANT l'abattement de 10 %). */
  taxRateManual: number;
}

export interface IncomeBreakdown {
  grossMonth: number;
  socialCharges: number;
  netSalaryOnly: number;
  navigoGain: number;
  /** Part du remboursement transport au-delà du plafond d'exonération de l'année : imposable. */
  navigoTaxable: number;
  mutuelleCost: number;
  swileCost: number;
  netBeforeTax: number;
  netTaxableYear: number;
  netTaxableBeforeAllowance: number; // salaires imposables avant l'abattement de 10 % (case 1AJ)
  taxAmount: number;          // impôt annuel (barème)
  monthlyTax: number;         // impôt mensuel (barème auto)
  autoRate: number;           // taux du barème équivalent au prélèvement à la source (%, sur le net imposable avant abattement)
  effectiveMonthlyTax: number; // tient compte du taux forcé éventuel
  superNetRaw: number;        // net avant impôt, après mutuelle/tickets
  superNet: number;           // paie nette après impôt (impôt effectif déduit)
}

/**
 * Impôt sur le revenu annuel calculé par tranches progressives.
 * `limit` = borne supérieure de la tranche (Infinity ou undefined = dernière tranche).
 */
export const computeIncomeTax = (taxableAnnual: number, brackets: TaxBracket[]): number => {
  // Le barème est éditable dans les Paramètres, et « Ajouter tranche » insère {limit:0} en FIN
  // de liste : on ne peut donc jamais supposer qu'il arrive trié. Sans ce tri, deux tranches
  // permutées gonflent l'impôt (et une tranche Infinity placée en 1re position taxe tout le
  // revenu au taux marginal maximum).
  const sorted = brackets
    .map(bracket => ({
      limit:
        bracket.limit === null || bracket.limit === undefined ? Infinity : bracket.limit,
      rate: bracket.rate,
    }))
    // Comparaison protégée : Infinity - Infinity vaut NaN et casserait le tri.
    .sort((a, b) => (a.limit === b.limit ? 0 : a.limit - b.limit));

  // Une assiette négative (revenu nul, abattement supérieur au net) ne génère aucun impôt.
  const taxableTotal = Math.max(0, taxableAnnual);

  let taxAmount = 0;
  let previousLimit = 0;
  for (const bracket of sorted) {
    if (taxableTotal <= previousLimit) break;
    const taxable = Math.max(0, Math.min(taxableTotal, bracket.limit) - previousLimit);
    taxAmount += taxable * bracket.rate;
    // previousLimit doit rester monotone : une borne en doublon ou inférieure ne doit pas
    // faire reculer le curseur, sinon la même part de revenu serait taxée deux fois.
    previousLimit = Math.max(previousLimit, bracket.limit);
  }
  return taxAmount;
};

/**
 * Décote d'une personne seule (art. 197 du CGI) : réduit fortement l'impôt des revenus
 * modestes. impôt − (montant − taux × impôt), jamais négatif, seulement sous le seuil.
 */
export const applyDecote = (grossTax: number, cfg: Pick<FiscalConfig, 'decote'>): number => {
  const d = cfg.decote ?? DEFAULT_DECOTE;
  if (!(grossTax > 0) || grossTax >= d.threshold) return Math.max(0, grossTax);
  return Math.max(0, grossTax - Math.max(0, d.single - d.rate * grossTax));
};

/**
 * Prélèvements sociaux applicables aux gains d'un compte. En 2026, l'assurance vie, le PEL et
 * le CEL restent à 17,2 % (`socialChargesLifeInsurance`) ; le reste passe à 18,6 % (livrets
 * bancaires, comptes à terme, PEA, compte-titres…). Vérifié le 2026-10-21 :
 * https://www.service-public.gouv.fr/particuliers/vosdroits/F2329
 */
export const socialChargesRateFor = (type: AccountType, cfg: FiscalConfig): number =>
  type === AccountType.ASSURANCE_VIE || type === AccountType.PEL || type === AccountType.CEL
    ? (cfg.socialChargesLifeInsurance ?? SOCIAL_CHARGES_LIFE_INSURANCE) : cfg.socialChargesCapital;

// Part de la CSG/CRDS non déductible (2,4 % + 0,5 % sur 98,25 % du brut) : retenue sur le
// salaire, mais imposable. L'oublier sous-estime le net imposable d'environ 2,85 % du brut.
// CSG 9,2 % dont 6,8 % déductibles, CRDS 0,5 %, assiette 98,25 % du brut (jusqu'à 4 plafonds
// de la Sécurité sociale) : https://www.service-public.gouv.fr/particuliers/vosdroits/F2971 ;
// les 2,4 points restants et la CRDS ne sont pas déductibles (brochure IR, traitements et
// salaires : https://www.impots.gouv.fr/www2/fichiers/documentation/brochure/ir_2025/pdf_som/06-traitements_salaires_83a112.pdf).
const NON_DEDUCTIBLE_CSG_RATE = 0.9825 * 0.029;

/**
 * CSG/CRDS non déductible mensuelle d'un salaire connu par son NET avant impôt (l'autre
 * salaire du Pilotage) : le brut est retrouvé avec le même taux de charges que le salaire
 * principal, faute de mieux. Taux de charges ≥ 100 % (saisie erronée) : le net sert de brut.
 */
export const nonDeductibleCsgFromNet = (netMonthly: number, salaryChargesRate: number): number => {
  if (!(netMonthly > 0)) return 0;
  const netShare = 1 - salaryChargesRate;
  const grossMonthly = netShare > 0 ? netMonthly / netShare : netMonthly;
  return grossMonthly * NON_DEDUCTIBLE_CSG_RATE;
};

// --- Remboursement de l'abonnement de transport (Navigo) ---
// Vérifié le 2026-10-21, BOFiP BOI-RSA-CHAMP-20-30-10-20-20260407 § 50 et 200-220
// (https://bofip.impots.gouv.fr/bofip/5601-PGP.html/identifiant=BOI-RSA-CHAMP-20-30-10-20-20260407) :
// - la prise en charge OBLIGATOIRE (50 % du prix de l'abonnement) est exonérée d'impôt
//   (CGI art. 81, 19° ter a) ;
// - pour les revenus 2022 à 2026, la prise en charge facultative au-delà est aussi exonérée
//   dans la limite de 25 % du prix (soit 75 % au total) : loi n° 2022-1157 du 16 août 2022,
//   art. 2 III, prorogée par l'art. 68 de la loi n° 2026-103 du 19 février 2026 ;
// - au-delà (ou après cette période), l'avantage est imposable.
// Confirmé le 2026-10-22 par service-public (« Pour l'année 2026 […] l'exonération fiscale
// s'applique au maximum jusqu'à 75 % du coût du titre d'abonnement »), rien d'annoncé après :
// https://www.service-public.gouv.fr/particuliers/vosdroits/F19846
// Une nouvelle prorogation se règle par `fiscalConfig.transportExemptUntil` (veille fiscale).
/** Part de l'abonnement exonérée en tout temps (prise en charge obligatoire), en %. */
export const TRANSPORT_MANDATORY_SHARE = 50;
/** Part exonérée pendant le régime temporaire (obligatoire + facultative), en %. */
const TRANSPORT_TEMPORARY_EXEMPT_SHARE = 75;
/** Premières et dernières années de revenus du régime temporaire, connues à ce jour. */
const TRANSPORT_TEMPORARY_FIRST_YEAR = 2022;
export const TRANSPORT_TEMPORARY_LAST_YEAR = 2026;

/** Dernière année du régime temporaire : celle des paramètres si la veille l'a prolongé. */
export const transportExemptUntil = (cfg: Pick<FiscalConfig, 'transportExemptUntil'>): number =>
  typeof cfg.transportExemptUntil === 'number' && Number.isInteger(cfg.transportExemptUntil) && cfg.transportExemptUntil > TRANSPORT_TEMPORARY_LAST_YEAR
    ? cfg.transportExemptUntil : TRANSPORT_TEMPORARY_LAST_YEAR;

/** Part du prix de l'abonnement exonérée d'impôt pour les revenus de `year`, en %. */
export const transportExemptShare = (year: number, cfg: Pick<FiscalConfig, 'transportExemptUntil'> = {}): number =>
  year >= TRANSPORT_TEMPORARY_FIRST_YEAR && year <= transportExemptUntil(cfg) ? TRANSPORT_TEMPORARY_EXEMPT_SHARE : TRANSPORT_MANDATORY_SHARE;

/**
 * Remboursement transport mensuel, découpé en part exonérée et part imposable (celle qui
 * dépasse le plafond d'exonération de l'année). Avantage inactif : 0 et 0.
 */
export const splitTransportRefund = (
  navigo: WorkBenefits['navigo'], year: number, cfg: Pick<FiscalConfig, 'transportExemptUntil'> = {},
): { refund: number; taxable: number } => {
  if (!navigo.active) return { refund: 0, taxable: 0 };
  const rate = Math.max(0, navigo.refundRate);
  const refund = navigo.basePrice * (rate / 100);
  const taxable = navigo.basePrice * (Math.max(0, rate - transportExemptShare(year, cfg)) / 100);
  return { refund, taxable: Math.max(0, taxable) };
};

/** Impôt estimé des salaires d'une année de revenus (dons, aide à la déclaration). */
export interface SalaryTaxEstimate {
  /** Impôt annuel après décote. */
  taxDue: number;
  /** Revenu imposable des salaires, après l'abattement de 10 %. */
  taxableIncome: number;
  /** Salaires imposables avant l'abattement (case 1AJ). */
  beforeAllowance: number;
}

/**
 * Même calcul que computeIncome, pour l'année de revenus `year` : la part du remboursement
 * transport exonérée dépend de l'année (75 % pour les revenus 2026, 50 % ensuite sauf
 * prorogation). Les revenus de l'an passé se déclarent au printemps : leur estimation suit
 * donc la règle de cette année-là, pas celle de l'année en cours.
 */
export const salaryTaxEstimate = (
  input: IncomeInput, fiscalConfig: FiscalConfig, workBenefits: WorkBenefits, year: number,
): SalaryTaxEstimate => {
  const b = computeIncome(input, fiscalConfig, workBenefits, year);
  return { taxDue: b.taxAmount, taxableIncome: b.netTaxableYear, beforeAllowance: b.netTaxableBeforeAllowance };
};

/**
 * Décompose le revenu en net avant impôt, coûts (mutuelle/tickets), impôt
 * et "super net" (paie nette après impôt). `year` : année des revenus (exonération du
 * remboursement transport, voir plus haut).
 */
export const computeIncome = (
  input: IncomeInput,
  fiscalConfig: FiscalConfig,
  workBenefits: WorkBenefits,
  year: number = new Date().getFullYear(),
): IncomeBreakdown => {
  const grossMonth = input.grossAnnual / 12;
  const socialCharges = grossMonth * fiscalConfig.salaryChargesRate;
  const netSalaryOnly = grossMonth - socialCharges;

  // Seule source : l'avantage Navigo. Désactivé ⇒ aucun remboursement.
  const transport = splitTransportRefund(workBenefits.navigo, year, fiscalConfig);
  const navigoGain = transport.refund;

  const mutuelleCost = workBenefits.mutuelle.active
    ? workBenefits.mutuelle.totalCost * (1 - workBenefits.mutuelle.employerRate / 100)
    : 0;

  const swileCost = workBenefits.mealVouchers.active
    ? workBenefits.mealVouchers.faceValue *
      workBenefits.mealVouchers.daysPerMonth *
      (1 - workBenefits.mealVouchers.employerRate / 100)
    : 0;

  const netBeforeTax = netSalaryOnly + navigoGain + input.extraMonthlyIncome;

  // Le remboursement transport est exonéré dans la limite de l'année (75 % du prix en 2026,
  // 50 % ensuite sauf prorogation) : seule la part au-delà entre dans l'assiette.
  // En revanche la CSG/CRDS non déductible et la part patronale de la mutuelle sont imposables.
  // L'autre salaire est saisi net : sa CSG/CRDS non déductible est ajoutée de la même façon
  // (la part patronale de sa mutuelle, inconnue, ne l'est pas).
  const nonDeductibleCsg = grossMonth * NON_DEDUCTIBLE_CSG_RATE
    + nonDeductibleCsgFromNet(input.extraMonthlyIncome, fiscalConfig.salaryChargesRate);
  const mutuelleEmployerPart = workBenefits.mutuelle.active
    ? workBenefits.mutuelle.totalCost * (workBenefits.mutuelle.employerRate / 100)
    : 0;
  const netAnnualBeforeAllowance = (netSalaryOnly + nonDeductibleCsg + mutuelleEmployerPart + transport.taxable + input.extraMonthlyIncome) * 12;
  // L'abattement de 10 % est plafonné par la loi ; sans plafond l'impôt des hauts revenus est
  // fortement sous-estimé. Le champ étant récent, on retombe sur le plafond par défaut si les
  // données de l'utilisateur ne le contiennent pas (ou contiennent une valeur inexploitable),
  // afin de ne jamais propager un NaN dans tout le calcul de la paie nette après impôt.
  const allowanceCap = Number.isFinite(fiscalConfig.standardAllowanceCap as number)
    ? (fiscalConfig.standardAllowanceCap as number)
    : DEFAULT_STANDARD_ALLOWANCE_CAP;
  const allowanceMin = Number.isFinite(fiscalConfig.standardAllowanceMin as number)
    ? (fiscalConfig.standardAllowanceMin as number)
    : DEFAULT_STANDARD_ALLOWANCE_MIN;
  // Minimum légal (sans dépasser le revenu lui-même), puis plafond.
  const standardAllowanceAmount = Math.min(
    Math.max(Math.min(allowanceMin, Math.max(0, netAnnualBeforeAllowance)), netAnnualBeforeAllowance * fiscalConfig.standardAllowance),
    allowanceCap
  );
  const netTaxableYear = Math.max(0, netAnnualBeforeAllowance - standardAllowanceAmount);

  const taxAmount = applyDecote(computeIncomeTax(netTaxableYear, fiscalConfig.taxBrackets), fiscalConfig);
  const monthlyTax = taxAmount / 12;
  // Taux équivalent au prélèvement à la source : l'assiette du PAS est le net imposable
  // AVANT la déduction de 10 % (CGI art. 204 F ; BOI-IR-PAS-20-20-10 § 60). Même base que
  // le taux forcé ci-dessous : forcer ce taux redonne exactement l'impôt du barème.
  const autoRate = netAnnualBeforeAllowance > 0 && taxAmount > 0 ? (taxAmount / netAnnualBeforeAllowance) * 100 : 0;

  // Taux forcé (celui de la fiche de paie / de l'avis) : appliqué comme le vrai prélèvement
  // à la source, au net imposable avant abattement, hors part exonérée du remboursement transport.
  // L'appliquer après l'abattement sous-estimait la retenue d'environ 10 %.
  const effectiveMonthlyTax =
    input.taxRateManual > 0
      ? (Math.max(0, netAnnualBeforeAllowance) / 12) * (input.taxRateManual / 100)
      : monthlyTax;

  const superNetRaw = netBeforeTax - mutuelleCost - swileCost;
  const superNet = superNetRaw - effectiveMonthlyTax;

  return {
    grossMonth,
    socialCharges,
    netSalaryOnly,
    navigoGain,
    navigoTaxable: transport.taxable,
    mutuelleCost,
    swileCost,
    netBeforeTax,
    netTaxableYear,
    netTaxableBeforeAllowance: netAnnualBeforeAllowance,
    taxAmount,
    monthlyTax,
    autoRate,
    effectiveMonthlyTax,
    superNetRaw,
    superNet,
  };
};

/**
 * Capacité d'épargne mensuelle = super net - charges fixes - plaisir - projets.
 */
export const computeSavingsCapacity = (
  superNet: number,
  totalFixedExpenses: number,
  leisureBudget: number,
  projectSavings: number
): number => superNet - totalFixedExpenses - leisureBudget - projectSavings;
