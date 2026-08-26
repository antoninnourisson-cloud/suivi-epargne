// ================================================
// FILE: src/lib/finance.ts
// Logique fiscale centralisée (calcul du "super net", impôt par tranches).
// Fonctions pures, testables, réutilisées par le Pilotage et le Dashboard.
// ================================================
import { FiscalConfig, TaxBracket, WorkBenefits, RateChange } from '../types';
import { DEFAULT_STANDARD_ALLOWANCE_CAP } from '../constants';

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
  const netAnnualBeforeAllowance = (netSalaryOnly + input.extraMonthlyIncome) * 12;
  // L'abattement de 10 % est plafonné par la loi ; sans plafond l'impôt des hauts revenus est
  // fortement sous-estimé. Le champ étant récent, on retombe sur le plafond par défaut si les
  // données de l'utilisateur ne le contiennent pas (ou contiennent une valeur inexploitable),
  // afin de ne jamais propager un NaN dans tout le calcul du reste à vivre.
  const allowanceCap = Number.isFinite(fiscalConfig.standardAllowanceCap as number)
    ? (fiscalConfig.standardAllowanceCap as number)
    : DEFAULT_STANDARD_ALLOWANCE_CAP;
  const standardAllowanceAmount = Math.min(
    Math.max(0, netAnnualBeforeAllowance * fiscalConfig.standardAllowance),
    allowanceCap
  );
  const netTaxableYear = Math.max(0, netAnnualBeforeAllowance - standardAllowanceAmount);

  const taxAmount = computeIncomeTax(netTaxableYear, fiscalConfig.taxBrackets);
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

/**
 * Taux moyen pondéré par le temps sur l'année civile donnée, à partir de l'historique
 * des changements de taux. Si aucun historique n'est renseigné, retourne simplement
 * le taux courant (comportement identique à avant l'ajout de l'historisation).
 */
export const computeWeightedAnnualRate = (
  currentRate: number,
  rateHistory: RateChange[] | undefined,
  year: number
): number => {
  if (!rateHistory || rateHistory.length === 0) return currentRate;

  const yearStart = Date.UTC(year, 0, 1);
  // Borne EXCLUSIVE au 1er janvier suivant : avec le 31/12 comme borne, une année pleine ne
  // pesait que 364 jours et un changement daté du 31/12 avait un poids nul.
  const yearEnd = Date.UTC(year + 1, 0, 1);
  const now = Date.now();
  const effectiveEnd = Math.min(now, yearEnd);
  // Année encore à venir : rien à pondérer, le taux courant est la seule information.
  if (effectiveEnd <= yearStart) return currentRate;

  // Deux changements à la même date sont contradictoires. On ne garde que la DERNIÈRE saisie
  // du tableau, pour que le résultat ne dépende plus de l'ordre d'un tri stable.
  const lastRateByDate = new Map<string, number>();
  for (const change of rateHistory) lastRateByDate.set(change.date, change.rate);

  const changes = [...lastRateByDate.entries()]
    .map(([date, rate]) => ({ date, rate }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Un changement daté du jour J marque la FIN de validité du taux historisé (l'app stocke
  // l'ANCIEN taux le jour où il est remplacé) : le taux historisé i court donc du changement
  // précédent jusqu'au sien, et le taux COURANT prend le relais depuis le dernier changement
  // jusqu'à la fin de la période — et non depuis aujourd'hui, ce qui lui donnait quelques
  // heures de poids sur l'année en cours et zéro jour sur une année passée.
  const segments = changes.map((change, i) => ({
    // null = "depuis toujours" : le tout premier taux couvre aussi le début de l'année.
    start: i === 0 ? null : Date.parse(changes[i - 1].date),
    end: Date.parse(change.date) as number | null,
    rate: change.rate,
  }));
  segments.push({
    start: Date.parse(changes[changes.length - 1].date),
    end: null,
    rate: currentRate,
  });

  let totalDays = 0;
  let weightedSum = 0;

  for (const segment of segments) {
    const start = Math.max(segment.start ?? -Infinity, yearStart);
    const end = Math.min(segment.end ?? Infinity, effectiveEnd);
    const days = (end - start) / (1000 * 3600 * 24);
    if (days > 0) {
      totalDays += days;
      weightedSum += days * segment.rate;
    }
  }

  return totalDays > 0 ? weightedSum / totalDays : currentRate;
};
