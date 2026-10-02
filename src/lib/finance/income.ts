// Revenus : impôt par tranches, décote, super net.
// Partie de src/lib/finance.ts (qui réexporte tout) : importez depuis '../finance'.
import { FiscalConfig, TaxBracket, WorkBenefits, AccountType } from '../../types';
import { DEFAULT_STANDARD_ALLOWANCE_CAP, DEFAULT_STANDARD_ALLOWANCE_MIN, DEFAULT_DECOTE, SOCIAL_CHARGES_LIFE_INSURANCE } from '../../constants';

export interface IncomeInput {
  grossAnnual: number;
  extraMonthlyIncome: number;
  navigoBase: number;   // fallback rétro-compat si workBenefits.navigo inactif
  navigoRate: number;   // idem
  taxRateManual: number; // > 0 pour forcer un taux d'imposition
}

export interface IncomeBreakdown {
  grossMonth: number;
  socialCharges: number;
  netSalaryOnly: number;
  navigoGain: number;
  mutuelleCost: number;
  swileCost: number;
  netBeforeTax: number;
  netTaxableYear: number;
  netTaxableBeforeAllowance: number; // salaires imposables avant l'abattement de 10 % (case 1AJ)
  taxAmount: number;          // impôt annuel (barème)
  monthlyTax: number;         // impôt mensuel (barème auto)
  autoRate: number;           // taux effectif du barème (%)
  effectiveMonthlyTax: number; // tient compte du taux forcé éventuel
  superNetRaw: number;        // net avant impôt, après mutuelle/tickets
  superNet: number;           // reste à vivre réel (après impôt effectif)
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

/** Prélèvements sociaux applicables aux gains d'un compte (l'assurance vie a son propre taux). */
export const socialChargesRateFor = (type: AccountType, cfg: FiscalConfig): number =>
  type === AccountType.ASSURANCE_VIE ? (cfg.socialChargesLifeInsurance ?? SOCIAL_CHARGES_LIFE_INSURANCE) : cfg.socialChargesCapital;

// Part de la CSG/CRDS non déductible (2,4 % + 0,5 % sur 98,25 % du brut) : retenue sur le
// salaire, mais imposable. L'oublier sous-estime le net imposable d'environ 2,85 % du brut.
const NON_DEDUCTIBLE_CSG_RATE = 0.9825 * 0.029;

/**
 * Décompose le revenu en net avant impôt, coûts (mutuelle/tickets), impôt
 * et "super net" (reste à vivre réel).
 */
export const computeIncome = (
  input: IncomeInput,
  fiscalConfig: FiscalConfig,
  workBenefits: WorkBenefits
): IncomeBreakdown => {
  const grossMonth = input.grossAnnual / 12;
  const socialCharges = grossMonth * fiscalConfig.salaryChargesRate;
  const netSalaryOnly = grossMonth - socialCharges;

  const navigoGain = workBenefits.navigo.active
    ? workBenefits.navigo.basePrice * (workBenefits.navigo.refundRate / 100)
    : (input.navigoBase || 0) * ((input.navigoRate || 0) / 100);

  const mutuelleCost = workBenefits.mutuelle.active
    ? workBenefits.mutuelle.totalCost * (1 - workBenefits.mutuelle.employerRate / 100)
    : 0;

  const swileCost = workBenefits.mealVouchers.active
    ? workBenefits.mealVouchers.faceValue *
      workBenefits.mealVouchers.daysPerMonth *
      (1 - workBenefits.mealVouchers.employerRate / 100)
    : 0;

  const netBeforeTax = netSalaryOnly + navigoGain + input.extraMonthlyIncome;

  // Le remboursement transport est exonéré : il est volontairement absent de l'assiette.
  // En revanche la CSG/CRDS non déductible et la part patronale de la mutuelle sont imposables.
  const nonDeductibleCsg = grossMonth * NON_DEDUCTIBLE_CSG_RATE;
  const mutuelleEmployerPart = workBenefits.mutuelle.active
    ? workBenefits.mutuelle.totalCost * (workBenefits.mutuelle.employerRate / 100)
    : 0;
  const netAnnualBeforeAllowance = (netSalaryOnly + nonDeductibleCsg + mutuelleEmployerPart + input.extraMonthlyIncome) * 12;
  // L'abattement de 10 % est plafonné par la loi ; sans plafond l'impôt des hauts revenus est
  // fortement sous-estimé. Le champ étant récent, on retombe sur le plafond par défaut si les
  // données de l'utilisateur ne le contiennent pas (ou contiennent une valeur inexploitable),
  // afin de ne jamais propager un NaN dans tout le calcul du reste à vivre.
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
  const autoRate = netTaxableYear > 0 ? (taxAmount / netTaxableYear) * 100 : 0;

  // Le taux forcé doit porter sur la MÊME assiette imposable que le barème automatique :
  // l'appliquer à netBeforeTax revenait à imposer le remboursement Navigo, non imposable.
  const effectiveMonthlyTax =
    input.taxRateManual > 0
      ? (netTaxableYear / 12) * (input.taxRateManual / 100)
      : monthlyTax;

  const superNetRaw = netBeforeTax - mutuelleCost - swileCost;
  const superNet = superNetRaw - effectiveMonthlyTax;

  return {
    grossMonth,
    socialCharges,
    netSalaryOnly,
    navigoGain,
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
