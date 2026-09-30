// ================================================
// FILE: src/lib/finance.ts
// Logique fiscale centralisée (calcul du "super net", impôt par tranches).
// Fonctions pures, testables, réutilisées par le Pilotage et le Dashboard.
// ================================================
import { FiscalConfig, TaxBracket, WorkBenefits, RateChange, AccountType, AccountMovement, RecurringMovement, SavingsAccount, GlobalAppData, PayslipExtractedData, Subscription, Expense, Donation } from '../types';
import { DEFAULT_STANDARD_ALLOWANCE_CAP, DEFAULT_FISCAL_CONFIG, DEFAULT_WORK_BENEFITS } from '../constants';
import { MS_PER_DAY, formatISODay, parseISODate, daysBetween } from './dates';

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

// --- FISCALITÉ DU CAPITAL (PFU / prélèvements sociaux) ---
// `socialChargesCapital` (17,2 %) existait dans FiscalConfig depuis le début mais n'était
// utilisé par aucun calcul. Ce qui suit modélise le régime le plus courant par type de compte
// — volontairement simplifié, pas une simulation fiscale complète (voir les limites
// documentées sur chaque cas).
//
// ATTENTION au sens du résultat : PEA et Assurance Vie sont à fiscalité DIFFÉRÉE — l'impôt
// n'est dû qu'au retrait, pas chaque année. Ce calcul donne donc le net qu'on toucherait EN
// RETIRANT les gains, jamais un montant « à déclarer » pour l'année.
const PFU_INCOME_TAX_RATE = 0.128; // part "impôt" du Prélèvement Forfaitaire Unique à 30 % (12,8 % IR + 17,2 % social)
// Taux réduit d'IR sur les gains d'Assurance Vie après 8 ans (art. 125-0 A du CGI), HORS
// abattement annuel de 4 600 €/9 200 € : celui-ci porte sur l'ensemble des contrats d'une
// personne (pas par compte) et dépend de versements antérieurs au 27/09/2017 — non modélisable
// ici sans ces informations. Le net réel après 8 ans est donc, dans la pratique, souvent
// LÉGÈREMENT MEILLEUR que ce que ce calcul affiche pour de petits montants de gains annuels.
const AV_REDUCED_INCOME_TAX_RATE = 0.075;

export type CapitalTaxRegime = 'PFU' | 'EXONERE_IR' | 'AV_REDUIT' | 'NON_MODELISE';

export interface CapitalTaxBreakdown {
  grossInterest: number;
  socialCharges: number;
  incomeTax: number;
  netInterest: number;
  regime: CapitalTaxRegime;
}

/**
 * Répartit des intérêts/gains bruts entre prélèvements sociaux, impôt sur le revenu et net
 * réel, selon le type de compte et son ancienneté par rapport aux seuils légaux configurés.
 *
 * `asOfDate` est injectable pour les tests (sinon non-déterministe).
 */
export const computeCapitalGainsTax = (
  account: { type: AccountType; openingDate?: string },
  grossInterest: number,
  fiscalConfig: FiscalConfig,
  asOfDate: Date = new Date()
): CapitalTaxBreakdown => {
  if (grossInterest <= 0) {
    return { grossInterest, socialCharges: 0, incomeTax: 0, netInterest: grossInterest, regime: 'PFU' };
  }

  // Date d'ouverture inconnue => on ne peut pas prouver l'ancienneté requise pour une
  // exonération : on suppose le cas le moins favorable (compte récent) plutôt que d'afficher
  // un net optimiste et faux.
  const ageYears = account.openingDate
    ? (asOfDate.getTime() - new Date(account.openingDate).getTime()) / (1000 * 3600 * 24 * 365.25)
    : 0;

  const socialCharges = grossInterest * fiscalConfig.socialChargesCapital;

  const withMaturity = (maturityYears: number, reducedRate: number, regimeIfMature: CapitalTaxRegime): CapitalTaxBreakdown => {
    const mature = ageYears >= maturityYears;
    const incomeTax = grossInterest * (mature ? reducedRate : PFU_INCOME_TAX_RATE);
    return {
      grossInterest, socialCharges, incomeTax,
      netInterest: grossInterest - socialCharges - incomeTax,
      regime: mature ? regimeIfMature : 'PFU',
    };
  };

  switch (account.type) {
    // Passé le seuil légal, les gains PEA/PEE sont exonérés d'IR (mais pas des 17,2 % sociaux,
    // dus dans tous les cas sur du capital).
    case AccountType.PEA:
      return withMaturity(fiscalConfig.legalMaturity.pea, 0, 'EXONERE_IR');
    case AccountType.PEE:
      return withMaturity(fiscalConfig.legalMaturity.pee, 0, 'EXONERE_IR');
    case AccountType.ASSURANCE_VIE:
      return withMaturity(fiscalConfig.legalMaturity.assuranceVie, AV_REDUCED_INCOME_TAX_RATE, 'AV_REDUIT');
    // Crypto : flat tax 30 % quelle que soit la durée de détention, pas de notion de maturité.
    case AccountType.CRYPTO: {
      const incomeTax = grossInterest * PFU_INCOME_TAX_RATE;
      return { grossInterest, socialCharges, incomeTax, netInterest: grossInterest - socialCharges - incomeTax, regime: 'PFU' };
    }
    default:
      // Immobilier (paliers d'abattement par durée de détention, distinction résidence
      // principale...), PER (fiscalité dépend du mode de sortie et de la déductibilité à
      // l'entrée) : régimes trop spécifiques pour un calcul fiable ici plutôt qu'un faux net.
      return { grossInterest, socialCharges: 0, incomeTax: 0, netInterest: grossInterest, regime: 'NON_MODELISE' };
  }
};

// --- COMPTE À REBOURS DE MATURITÉ FISCALE (PEA / PEE / Assurance Vie) ---
// Le régime fiscal ne dépend QUE du type de compte et de son ancienneté — pas du montant
// des gains — donc indépendant de `computeCapitalGainsTax` (qui, lui, court-circuite à
// 'PFU' quand `grossInterest` est nul, ce qui serait faux ici pour un compte mature sans
// intérêt renseigné).
const regimeForAge = (type: AccountType, ageYears: number, fiscalConfig: FiscalConfig): CapitalTaxRegime => {
  switch (type) {
    case AccountType.PEA: return ageYears >= fiscalConfig.legalMaturity.pea ? 'EXONERE_IR' : 'PFU';
    case AccountType.PEE: return ageYears >= fiscalConfig.legalMaturity.pee ? 'EXONERE_IR' : 'PFU';
    case AccountType.ASSURANCE_VIE: return ageYears >= fiscalConfig.legalMaturity.assuranceVie ? 'AV_REDUIT' : 'PFU';
    default: return 'NON_MODELISE';
  }
};

const CAPITAL_INCOME_TAX_RATE: Partial<Record<CapitalTaxRegime, number>> = {
  PFU: PFU_INCOME_TAX_RATE,
  EXONERE_IR: 0,
  AV_REDUIT: AV_REDUCED_INCOME_TAX_RATE,
};

export interface MaturityCountdown {
  maturityDate: string;   // ISO
  monthsRemaining: number; // toujours >= 1 tant que le compte n'est pas mature
  regimeBefore: CapitalTaxRegime;
  regimeAfter: CapitalTaxRegime;
  // Impôt en moins, AU MOMENT D'UN RETRAIT, sur une année de gains (taux × solde du jour)
  // une fois le compte mature — ce n'est pas une économie versée chaque année, la fiscalité
  // étant différée. 0 si le compte ne produit pas encore d'intérêt connu.
  annualTaxSaving: number;
}

/**
 * `null` si : pas de date d'ouverture connue, type de compte sans notion de maturité
 * (Livret réglementé, Crypto, Immobilier, PER...), ou déjà mature — dans tous ces cas, rien
 * à annoncer.
 */
export const computeMaturityCountdown = (
  account: { type: AccountType; openingDate?: string; interestRate?: number; totalAmount: number },
  fiscalConfig: FiscalConfig,
  asOfDate: Date = new Date()
): MaturityCountdown | null => {
  if (!account.openingDate) return null;

  let maturityYears: number | undefined;
  if (account.type === AccountType.PEA) maturityYears = fiscalConfig.legalMaturity.pea;
  else if (account.type === AccountType.ASSURANCE_VIE) maturityYears = fiscalConfig.legalMaturity.assuranceVie;
  else if (account.type === AccountType.PEE) maturityYears = fiscalConfig.legalMaturity.pee;
  if (maturityYears === undefined) return null;

  const opening = new Date(account.openingDate);
  const ageYearsNow = (asOfDate.getTime() - opening.getTime()) / (MS_PER_DAY * 365.25);
  if (ageYearsNow >= maturityYears) return null; // déjà mature

  const maturityDate = new Date(opening.getTime() + maturityYears * 365.25 * MS_PER_DAY);
  const monthsRemaining = Math.max(1, Math.ceil((maturityDate.getTime() - asOfDate.getTime()) / (MS_PER_DAY * 30.4375)));

  const regimeBefore = regimeForAge(account.type, ageYearsNow, fiscalConfig);
  // À l'exact instant de maturité, l'ancienneté vaut `maturityYears` par construction : le
  // régime obtenu est donc forcément le régime "mature" de ce type de compte.
  const regimeAfter = regimeForAge(account.type, maturityYears, fiscalConfig);

  const grossInterest = Math.max(0, account.totalAmount * ((account.interestRate || 0) / 100));
  const rateBefore = CAPITAL_INCOME_TAX_RATE[regimeBefore] ?? 0;
  const rateAfter = CAPITAL_INCOME_TAX_RATE[regimeAfter] ?? 0;
  const annualTaxSaving = Math.max(0, grossInterest * (rateBefore - rateAfter));

  return { maturityDate: maturityDate.toISOString().split('T')[0], monthsRemaining, regimeBefore, regimeAfter, annualTaxSaving };
};

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


// --- INTÉRÊTS RÉELLEMENT ACQUIS SUR UNE ANNÉE ---
// Jusqu'ici, tout se calculait `taux × solde du jour`. C'est honnête pour un RYTHME annuel
// ("voilà ce que rapportent mes comptes en l'état"), mais faux dès qu'on annonce une ANNÉE
// précise : 5 000 € déposés en novembre se voyaient créditer une année pleine d'intérêts.
// Deux endroits annoncent une année et étaient donc surévalués : les gains nets si retrait
// ("Intérêts 2026") et le rappel de décembre sur les intérêts
// parentaux. D'où ce calcul, qui suit le mouvement réel de l'argent.

/** Livrets réglementés : seuls comptes soumis à la règle des quinzaines. */
const REGULATED_TYPES = [AccountType.LIVRET_A, AccountType.LDDS, AccountType.LEP];

/**
 * Taux en vigueur à une date donnée, d'après l'historique.
 * Convention de `rateHistory` (identique à computeWeightedAnnualRate) : une entrée datée du
 * jour J porte l'ANCIEN taux, valable JUSQU'À J. Le taux courant prend le relais après le
 * dernier changement.
 */
const rateAtDate = (currentRate: number, rateHistory: RateChange[] | undefined, at: Date): number => {
  if (!rateHistory || rateHistory.length === 0) return currentRate;
  const lastByDate = new Map<string, number>();
  for (const c of rateHistory) lastByDate.set(c.date, c.rate);
  const sorted = [...lastByDate.entries()]
    // parseISODate (minuit LOCAL) et non Date.parse (minuit UTC) : comparé à des bornes de
    // quinzaine construites en local, un changement daté du 1er juillet tombait 2 h APRÈS
    // la borne du 1er juillet et décalait le nouveau taux d'une quinzaine entière.
    .map(([date, rate]) => ({ t: parseISODate(date).getTime(), rate }))
    .sort((a, b) => a.t - b.t);
  for (const c of sorted) {
    if (c.t > at.getTime()) return c.rate; // ce taux courait encore à `at`
  }
  return currentRate;
};

/** Solde du compte juste AVANT `date` (on retire les mouvements postérieurs ou égaux). */
const accountBalanceBefore = (
  account: { totalAmount: number; movements?: AccountMovement[] },
  date: Date
): number => {
  const key = formatISODay(date);
  let balance = account.totalAmount;
  (account.movements || []).forEach(m => {
    if (m.date >= key) balance -= m.type === 'IN' ? m.amount : -m.amount;
  });
  return balance;
};

/** Bornes de quinzaine de l'année : les 1er et 16 de chaque mois (24 au total). */
const quinzaineStarts = (year: number): Date[] => {
  const out: Date[] = [];
  for (let m = 0; m < 12; m++) {
    out.push(new Date(year, m, 1));
    out.push(new Date(year, m, 16));
  }
  return out;
};

/**
 * Date à partir de laquelle un mouvement compte, selon la règle des quinzaines :
 * - un VERSEMENT produit des intérêts à compter de la première borne STRICTEMENT après lui
 *   (versé le 3 mars → rapporte à partir du 16 mars) ;
 * - un RETRAIT cesse d'en produire dès la dernière borne à ou avant lui
 *   (retiré le 3 mars → ne rapporte plus depuis le 1er mars).
 */
const quinzaineEffectiveDate = (d: Date, isDeposit: boolean): Date => {
  const y = d.getFullYear(), m = d.getMonth(), day = d.getDate();
  if (isDeposit) return day < 16 ? new Date(y, m, 16) : new Date(y, m + 1, 1);
  return day >= 16 ? new Date(y, m, 16) : new Date(y, m, 1);
};

/**
 * Intérêts RÉELLEMENT acquis sur l'année civile `year`, en tenant compte de la date à
 * laquelle chaque euro est arrivé (ou parti).
 *
 * - Livrets réglementés : règle des quinzaines, exactement comme la banque (24 quinzaines,
 *   taux annuel / 24 par quinzaine).
 * - Autres comptes (AV, PEA...) : prorata journalier — approximation assumée, ces contrats
 *   ont chacun leurs propres règles de valorisation, mais c'est bien plus proche du réel
 *   que de compter une année pleine sur le solde du jour.
 *
 * Année en cours : ne compte que jusqu'à `asOfDate`.
 */
export const computeAccruedInterest = (
  account: { type: AccountType; totalAmount: number; movements?: AccountMovement[]; interestRate?: number; rateHistory?: RateChange[] },
  year: number,
  asOfDate: Date = new Date()
): number => {
  const currentRate = account.interestRate || 0;
  if (currentRate <= 0 && !(account.rateHistory && account.rateHistory.length > 0)) return 0;

  const yearStart = new Date(year, 0, 1);
  const yearEnd = new Date(year + 1, 0, 1);
  const end = asOfDate < yearEnd ? asOfDate : yearEnd;
  if (end <= yearStart) return 0; // année entièrement future

  // Solde au 31/12 de l'année précédente : point de départ, les mouvements de l'année
  // viennent ensuite s'y appliquer à leur date d'effet.
  const startBalance = accountBalanceBefore(account, yearStart);
  const yearMovements = (account.movements || []).filter(m => {
    const d = parseISODate(m.date);
    return d >= yearStart && d < yearEnd;
  });

  if (REGULATED_TYPES.includes(account.type)) {
    let interest = 0;
    for (const q of quinzaineStarts(year)) {
      if (q >= end) break;
      let balance = startBalance;
      for (const m of yearMovements) {
        const isDeposit = m.type === 'IN';
        if (quinzaineEffectiveDate(parseISODate(m.date), isDeposit) <= q) {
          balance += isDeposit ? m.amount : -m.amount;
        }
      }
      if (balance > 0) interest += balance * (rateAtDate(currentRate, account.rateHistory, q) / 100) / 24;
    }
    return interest;
  }

  // Prorata journalier : on avance de mouvement en mouvement.
  const events = [...yearMovements].sort((a, b) => a.date.localeCompare(b.date));
  let balance = startBalance;
  let cursor = yearStart;
  let interest = 0;
  const accrue = (from: Date, to: Date, bal: number) => {
    // daysBetween arrondit en jours calendaires entiers : une division brute par MS_PER_DAY
    // renvoie 184,04 jours sur une période traversant le passage à l'heure d'hiver.
    const days = daysBetween(from, to);
    if (days > 0 && bal > 0) interest += bal * (rateAtDate(currentRate, account.rateHistory, from) / 100) * (days / 365);
  };
  for (const m of events) {
    const at = parseISODate(m.date);
    if (at >= end) break;
    accrue(cursor, at, balance);
    balance += m.type === 'IN' ? m.amount : -m.amount;
    cursor = at;
  }
  accrue(cursor, end, balance);
  return interest;
};

/**
 * Dernière révision réglementaire des taux (Livret A / LDDS / LEP) à la date donnée.
 * Ces taux sont fixés par arrêté et révisés au 1er février et au 1er août. Un taux périmé
 * saisi dans l'app fausse TOUT l'aval (rendement, projection, stratégie de placement,
 * manque à gagner) sans le moindre signal — d'où ce rappel.
 */
export const lastRateRevision = (asOfDate: Date = new Date()): { key: string; date: Date; label: string } => {
  const y = asOfDate.getFullYear();
  const feb = new Date(y, 1, 1);
  const aug = new Date(y, 7, 1);
  if (asOfDate >= aug) return { key: `${y}-08`, date: aug, label: `1er août ${y}` };
  if (asOfDate >= feb) return { key: `${y}-02`, date: feb, label: `1er février ${y}` };
  return { key: `${y - 1}-08`, date: new Date(y - 1, 7, 1), label: `1er août ${y - 1}` };
};

/**
 * Comptes réglementés dont le taux n'a pas été retouché depuis la dernière révision.
 * Un `rateHistory` contient une entrée datée du jour où l'ancien taux a été remplacé :
 * une entrée postérieure à la révision prouve donc que l'utilisateur s'en est occupé.
 *
 * `null` si la révision est trop ancienne pour être encore d'actualité (au-delà de la
 * fenêtre de rappel) ou si tous les comptes sont à jour.
 */
export const findStaleRegulatedRates = (
  accounts: { id: string; name: string; type: AccountType; interestRate?: number; rateHistory?: RateChange[] }[],
  asOfDate: Date = new Date(),
  reminderWindowDays = 45
): { revision: { key: string; date: Date; label: string }; accounts: { id: string; name: string }[] } | null => {
  const revision = lastRateRevision(asOfDate);
  // Passé la fenêtre, on cesse de harceler : si l'utilisateur n'a rien changé après 45
  // jours, c'est vraisemblablement que le taux de son livret n'a pas bougé.
  if (daysBetween(revision.date, asOfDate) > reminderWindowDays) return null;

  const stale = accounts
    .filter(a => REGULATED_TYPES.includes(a.type))
    .filter(a => {
      const touched = (a.rateHistory || []).some(c => parseISODate(c.date) >= revision.date);
      return !touched;
    })
    .map(a => ({ id: a.id, name: a.name }));

  return stale.length > 0 ? { revision, accounts: stale } : null;
};

export interface LepEligibility {
  ceiling: number;          // plafond ajusté au nombre de parts
  estimatedRfr: number;     // estimation du RFR à partir du net imposable
  status: 'ok' | 'approaching' | 'exceeded';
  marginPct: number;        // écart au plafond, en % (négatif = dépassement)
}

/**
 * Estime si le LEP reste accessible. Perdre l'éligibilité oblige à sortir le capital d'un
 * livret à ~4 % vers un support moins rémunérateur : autant le voir venir.
 *
 * APPROXIMATION ASSUMÉE, à afficher comme telle : le vrai Revenu Fiscal de Référence
 * figure sur l'avis d'imposition, porte sur le FOYER, et la banque contrôle celui de
 * l'année N-2. On l'estime ici à partir du net imposable annuel du seul salaire connu.
 * Le résultat sert à alerter, jamais à conclure.
 *
 * `null` si aucun LEP, ou si le plafond n'est pas renseigné dans la configuration.
 */
export const computeLepEligibility = (
  accounts: { type: AccountType }[],
  netTaxableYear: number,
  fiscalConfig: FiscalConfig
): LepEligibility | null => {
  if (!accounts.some(a => a.type === AccountType.LEP)) return null;
  const base = fiscalConfig.lepIncomeCeiling;
  if (!base || base <= 0 || netTaxableYear <= 0) return null;

  // Le plafond augmente avec les parts (approximation linéaire de la grille officielle,
  // qui ajoute une fraction par demi-part).
  const parts = fiscalConfig.lepHouseholdParts && fiscalConfig.lepHouseholdParts > 0 ? fiscalConfig.lepHouseholdParts : 1;
  const ceiling = base * parts;
  const marginPct = ((ceiling - netTaxableYear) / ceiling) * 100;

  const status: LepEligibility['status'] =
    netTaxableYear > ceiling ? 'exceeded' : marginPct < 10 ? 'approaching' : 'ok';

  return { ceiling, estimatedRfr: netTaxableYear, status, marginPct };
};

export interface ParentalInterestBreakdown {
  totalAnnual: number;
  totalAnnualOwned: number;
  // Intérêts produits par le capital des parents : ils reviennent à l'utilisateur en fin
  // d'année (le capital, lui, reste intouchable) — voir Yield.tsx pour le raisonnement complet.
  totalAnnualParental: number;
}

/**
 * Centralise le calcul "intérêts annuels, dont part parentale" déjà utilisé par Rendement,
 * pour que le rappel de fin d'année (Dashboard) ne puisse pas en dériver avec une formule
 * légèrement différente.
 */
export const computeParentalInterest = (
  accounts: { interestRate?: number; rateHistory?: RateChange[]; totalAmount: number; ownedAmount: number }[],
  year: number
): ParentalInterestBreakdown => {
  let totalAnnual = 0;
  let totalAnnualOwned = 0;
  accounts.forEach(a => {
    if (!((a.interestRate || 0) > 0) || a.totalAmount <= 0) return;
    const weightedRate = computeWeightedAnnualRate(a.interestRate || 0, a.rateHistory, year);
    totalAnnual += a.totalAmount * (weightedRate / 100);
    totalAnnualOwned += a.ownedAmount * (weightedRate / 100);
  });
  return { totalAnnual, totalAnnualOwned, totalAnnualParental: Math.max(0, totalAnnual - totalAnnualOwned) };
};

/**
 * Variante de `computeParentalInterest` basée sur les intérêts RÉELLEMENT ACQUIS
 * (computeAccruedInterest) et non sur le rythme annualisé. À utiliser partout où l'on
 * annonce « cette année » : rappel de fin d'année, gains nets si retrait.
 *
 * La répartition moi/parents se fait au prorata du capital détenu à ce jour — les
 * mouvements ne distinguent pas la part parentale de la part propre, donc affiner
 * davantage serait une fausse précision.
 */
export const computeAccruedParentalInterest = (
  accounts: { type: AccountType; interestRate?: number; rateHistory?: RateChange[]; totalAmount: number; ownedAmount: number; movements?: AccountMovement[] }[],
  year: number,
  asOfDate: Date = new Date()
): ParentalInterestBreakdown => {
  let totalAnnual = 0;
  let totalAnnualOwned = 0;
  accounts.forEach(a => {
    const accrued = computeAccruedInterest(a, year, asOfDate);
    if (accrued <= 0) return;
    totalAnnual += accrued;
    const ownedShare = a.totalAmount > 0 ? a.ownedAmount / a.totalAmount : 1;
    totalAnnualOwned += accrued * Math.min(1, Math.max(0, ownedShare));
  });
  return { totalAnnual, totalAnnualOwned, totalAnnualParental: Math.max(0, totalAnnual - totalAnnualOwned) };
};

// --- RYTHME D'ÉPARGNE RÉEL OBSERVÉ ---
// Extrait du Dashboard (carte "Projection de trajectoire") pour être réutilisable ailleurs
// (Objectifs) sans dupliquer la reconstruction ni risquer que les deux écrans divergent.

/**
 * Reconstruit le total possédé (hors part parentale) à une date passée, en retirant les
 * mouvements postérieurs à cette date. Suppose que les mouvements enregistrés reflètent
 * bien tout le flux depuis l'ouverture du compte (même limite que `stackedData` du
 * Dashboard, dont c'est la méthode d'origine).
 */
export const computeAccountBalanceAtDate = (
  accounts: { ownedAmount: number; movements?: AccountMovement[] }[],
  dateStr: string
): number =>
  accounts.reduce((total, acc) => {
    let balance = acc.ownedAmount;
    (acc.movements || []).filter(m => m.date > dateStr).forEach(m => {
      balance += m.type === 'IN' ? -m.amount : m.amount;
    });
    return total + balance;
  }, 0);

/**
 * Rythme d'épargne mensuel réellement observé sur `windowDays` jours se terminant à
 * `asOfDate` (paramétrable : passer une date passée donne le rythme de la fenêtre
 * PRÉCÉDENTE, ce que la détection de dérive du Dashboard exploite en rappelant cette
 * fonction avec `asOfDate` décalé d'un trimestre).
 *
 * `null` si la fenêtre ne contient pas assez de mouvements pour extrapoler quoi que ce
 * soit (compte neuf, période creuse) — jamais un chiffre fondé sur du vide.
 *
 * Division par `windowDays / 30` (mois de 30 jours) et non par `AVG_DAYS_PER_MONTH`
 * (30,4375) : ce calcul reprend tel quel celui déjà livré et vérifié en conditions
 * réelles sur le Dashboard — changer de convention aurait légèrement changé des chiffres
 * déjà montrés à l'utilisateur, pour un gain de précision négligeable.
 */
export const computeRecentSavingsRate = (
  accounts: { ownedAmount: number; movements?: AccountMovement[] }[],
  windowDays: number = 90,
  asOfDate: Date = new Date()
): number | null => {
  const past = new Date(asOfDate.getTime() - windowDays * MS_PER_DAY);
  // Cles de jour en heure LOCALE : les mouvements sont dates en local, une cle UTC
  // decalait la fenetre d'un jour entre minuit et ~2h du matin a Paris.
  const nowStr = formatISODay(asOfDate);
  const pastStr = formatISODay(past);

  const hasMovementsInWindow = accounts.some(a => (a.movements || []).some(m => m.date > pastStr && m.date <= nowStr));
  if (!hasMovementsInWindow) return null;

  const totalNow = computeAccountBalanceAtDate(accounts, nowStr);
  const totalPast = computeAccountBalanceAtDate(accounts, pastStr);
  return (totalNow - totalPast) / (windowDays / 30);
};

// --- MOUVEMENTS RÉCURRENTS ---

export interface DueRecurring {
  recurring: RecurringMovement;
  dueDate: string; // 'YYYY-MM-DD' local, échéance de ce mois
}

/**
 * Échéances récurrentes arrivées à terme ce mois-ci et pas encore enregistrées.
 *
 * « Déjà enregistrée » = un mouvement existe ce mois-ci sur le même compte, de même sens
 * et de même montant. Le libellé n'est volontairement PAS exigé : un versement saisi à la
 * main via l'ajout rapide (libellé différent) ne doit pas être proposé une seconde fois.
 * `skipped` : identifiants déjà écartés par l'utilisateur pour ce mois.
 */
export const findDueRecurring = (
  recurrings: RecurringMovement[],
  accounts: { id: string; movements?: AccountMovement[] }[],
  asOfDate: Date = new Date(),
  skipped: Set<string> = new Set()
): DueRecurring[] => {
  const y = asOfDate.getFullYear();
  const m = asOfDate.getMonth();
  const monthKey = `${y}-${String(m + 1).padStart(2, '0')}`;
  const lastDay = new Date(y, m + 1, 0).getDate();

  return recurrings
    .filter(r => r.active && r.amount > 0 && !skipped.has(r.id))
    .flatMap(r => {
      const day = Math.min(Math.max(1, Math.round(r.dayOfMonth)), lastDay);
      if (asOfDate.getDate() < day) return [];
      const account = accounts.find(a => a.id === r.accountId);
      if (!account) return []; // compte supprimé depuis
      const alreadyDone = (account.movements || []).some(mv =>
        mv.date.startsWith(monthKey) && mv.type === r.type && Math.abs(mv.amount - r.amount) < 0.005
      );
      if (alreadyDone) return [];
      return [{ recurring: r, dueDate: formatISODay(new Date(y, m, day)) }];
    });
};

// ---------------------------------------------------------------------------
// Capacité d'épargne et plan de placement (Pilotage)
// ---------------------------------------------------------------------------
// Sortis du composant pour que le serveur (rappel du jour de paie) calcule EXACTEMENT le
// même plan que l'écran Pilotage.

/** « Super net » réel d'une fiche de paie : net payé, sinon net avant impôt − impôt prélevé. */
export const payslipSuperNet = (e: PayslipExtractedData): number | undefined =>
  e.netPaid ?? (e.netAmount !== undefined && e.incomeTaxWithheld !== undefined
    ? e.netAmount - e.incomeTaxWithheld
    : undefined);

/**
 * Capacité d'épargne mensuelle théorique : super net − charges fixes − loisirs − projets.
 * Le super net vient de la fiche de paie de référence si elle en donne un, sinon de la
 * formule (même règle que le Pilotage).
 */
/** Paie mensuelle nette (« super net ») : fiche de paie de référence, sinon la formule. */
export const computeMonthlyPay = (data: GlobalAppData): number => {
  const c = data.config || ({} as GlobalAppData['config']);
  const formula = computeIncome(
    {
      grossAnnual: c.grossAnnual ?? 0,
      extraMonthlyIncome: c.extraMonthlyIncome ?? 0,
      navigoBase: c.navigoBase ?? 90.80,
      navigoRate: c.navigoRate ?? 67.24,
      taxRateManual: c.taxRateManual ?? 0,
    },
    data.fiscalConfig || DEFAULT_FISCAL_CONFIG,
    data.workBenefits || DEFAULT_WORK_BENEFITS
  ).superNet;
  const payslip = (data.payslips || []).find(p => p.id === data.activePayslipId);
  return (payslip && payslipSuperNet(payslip.extracted)) ?? formula;
};

export const computeMonthlySavingsCapacity = (data: GlobalAppData): number => {
  const c = data.config || ({} as GlobalAppData['config']);
  const superNet = computeMonthlyPay(data);
  const totalFixed = totalFixedCharges(data.expenses || [], data.subscriptions || []);
  return computeSavingsCapacity(superNet, totalFixed, c.leisureBudget ?? 0, c.projectSavings ?? 0);
};

export interface PlacementStep {
  accountId?: string;     // absent pour la suggestion « Ouvrir un PEA/AV »
  accountName: string;
  type: AccountType;
  rate?: number;
  fillAmount: number;
  isFullAfter: boolean;
  isLiquid: boolean;
  alert?: boolean; // aucun compte de repli : suggestion d'en ouvrir un
}

/**
 * Répartit `totalToInvest` : livrets réglementés d'abord (meilleur taux, puis LEP > Livret A
 * > LDDS) jusqu'à leur plafond, le reste sur le premier autre placement (ou suggestion
 * d'ouvrir un PEA/AV).
 */
export const computePlacementStrategy = (
  totalToInvest: number,
  accounts: SavingsAccount[],
  fiscalConfig: FiscalConfig
): PlacementStep[] => {
  let remainingMoney = totalToInvest;
  const steps: PlacementStep[] = [];
  const liquidTypes = [AccountType.LEP, AccountType.LIVRET_A, AccountType.LDDS];
  const userLiquidAccounts = accounts.filter(a => liquidTypes.includes(a.type));
  const userOtherAccounts = accounts.filter(a => !liquidTypes.includes(a.type) && ![AccountType.COMPTE_COURANT, AccountType.IMMOBILIER].includes(a.type));

  const priority: Partial<Record<AccountType, number>> = { [AccountType.LEP]: 3, [AccountType.LIVRET_A]: 2, [AccountType.LDDS]: 1 };
  const sortAccounts = (a: SavingsAccount, b: SavingsAccount) => {
    const rateA = a.interestRate || 0;
    const rateB = b.interestRate || 0;
    if (rateA !== rateB) return rateB - rateA;
    return (priority[b.type] || 0) - (priority[a.type] || 0);
  };
  userLiquidAccounts.sort(sortAccounts);
  userOtherAccounts.sort(sortAccounts);

  // Plafond du compte s'il est renseigné, sinon celui de la config (même règle que
  // le remplissage des livrets et les alertes du Dashboard).
  const defaults: Partial<Record<AccountType, number>> = {
    [AccountType.LEP]: fiscalConfig.ceilings.lep,
    [AccountType.LIVRET_A]: fiscalConfig.ceilings.livretA,
    [AccountType.LDDS]: fiscalConfig.ceilings.ldds,
  };
  for (const acc of userLiquidAccounts) {
    if (remainingMoney <= 0) break;
    const ceiling = (acc.ceiling && acc.ceiling > 0) ? acc.ceiling : (defaults[acc.type] || 0);
    const availableSpace = Math.max(0, ceiling - acc.totalAmount);
    if (availableSpace > 0) {
      const amountAllocated = Math.min(remainingMoney, availableSpace);
      steps.push({ accountId: acc.id, accountName: acc.name, type: acc.type, rate: acc.interestRate, fillAmount: amountAllocated, isFullAfter: amountAllocated >= availableSpace, isLiquid: true });
      remainingMoney -= amountAllocated;
    }
  }

  if (remainingMoney > 0) {
    if (userOtherAccounts.length > 0) {
      const o = userOtherAccounts[0];
      steps.push({ accountId: o.id, accountName: o.name, type: o.type, rate: o.interestRate, fillAmount: remainingMoney, isFullAfter: false, isLiquid: false });
    } else {
      steps.push({ accountName: 'Ouvrir un PEA/AV', type: AccountType.AUTRE, rate: 0, fillAmount: remainingMoney, isFullAfter: false, isLiquid: false, alert: true });
    }
  }
  return steps;
};

// ---------------------------------------------------------------------------
// Versements cumulés et fiscalité d'un retrait
// ---------------------------------------------------------------------------

/** Comptes dont la valeur bouge avec les marchés : on y suit les versements cumulés. */
export const DEPOSIT_TRACKED_TYPES = [AccountType.PEA, AccountType.ASSURANCE_VIE, AccountType.PEE, AccountType.PER, AccountType.CRYPTO];
export const tracksDeposits = (type: AccountType) => DEPOSIT_TRACKED_TYPES.includes(type);

/** Plafond légal des VERSEMENTS sur un PEA (la valorisation peut le dépasser). */
export const PEA_DEPOSIT_CEILING = 150_000;
/** Abattement annuel sur les gains d'Assurance Vie de plus de 8 ans (personne seule). */
export const AV_ANNUAL_ALLOWANCE = 4_600;

/**
 * Versements cumulés après un retrait de `amount` : un retrait emporte versements et gains
 * au prorata de leur poids dans la valeur (règle fiscale des rachats partiels).
 */
export const depositsAfterWithdrawal = (totalDeposits: number, value: number, amount: number): number =>
  value <= 0 ? totalDeposits : Math.max(0, totalDeposits * (1 - Math.min(1, amount / value)));

export interface WithdrawalTax {
  known: boolean;        // false : versements cumulés inconnus, ou fiscalité non modélisée
  gainPart: number;      // part de gains contenue dans le montant retiré
  socialCharges: number;
  incomeTax: number;
  net: number;           // ce qui arrive réellement sur le compte courant
  closesPea: boolean;    // retrait d'un PEA de moins de 5 ans : le plan est clôturé
}

/**
 * Impôt dû sur un retrait de `amount`. Seule la part de gains est imposée :
 * gains retirés = montant × (valeur − versements) / valeur.
 * - PEA / PEE : 17,2 % de prélèvements sociaux, IR exonéré après la maturité légale ;
 * - Assurance Vie : IR à 7,5 % après 8 ans, sur la part de gains au-delà de l'abattement
 *   annuel (4 600 €, supposé non entamé cette année) ; PFU avant 8 ans. Sur un fonds euros,
 *   les prélèvements sociaux sont en réalité déjà retenus chaque année : on les compte ici
 *   quand même (cas prudent, et exact pour les unités de compte) ;
 * - Crypto : PFU 30 % sur la part de plus-value ;
 * - autres (PER, immobilier…) : non modélisé.
 */
export const computeWithdrawalTax = (
  account: { type: AccountType; openingDate?: string; totalAmount: number; totalDeposits?: number },
  amount: number,
  fiscalConfig: FiscalConfig,
  asOfDate: Date = new Date()
): WithdrawalTax => {
  const ageYears = account.openingDate
    ? (asOfDate.getTime() - parseISODate(account.openingDate).getTime()) / (MS_PER_DAY * 365.25)
    : 0;
  const closesPea = account.type === AccountType.PEA && ageYears < fiscalConfig.legalMaturity.pea;
  const unknown: WithdrawalTax = { known: false, gainPart: 0, socialCharges: 0, incomeTax: 0, net: amount, closesPea };
  const modeled = [AccountType.PEA, AccountType.PEE, AccountType.ASSURANCE_VIE, AccountType.CRYPTO].includes(account.type);
  if (!modeled || account.totalDeposits === undefined || account.totalAmount <= 0) return unknown;

  const gainRatio = Math.max(0, (account.totalAmount - account.totalDeposits) / account.totalAmount);
  const gainPart = Math.min(amount, account.totalAmount) * gainRatio;
  const socialCharges = gainPart * fiscalConfig.socialChargesCapital;
  let incomeTax: number;
  switch (account.type) {
    case AccountType.PEA:
      incomeTax = closesPea ? gainPart * PFU_INCOME_TAX_RATE : 0; break;
    case AccountType.PEE:
      incomeTax = ageYears >= fiscalConfig.legalMaturity.pee ? 0 : gainPart * PFU_INCOME_TAX_RATE; break;
    case AccountType.ASSURANCE_VIE:
      incomeTax = ageYears >= fiscalConfig.legalMaturity.assuranceVie
        ? Math.max(0, gainPart - AV_ANNUAL_ALLOWANCE) * AV_REDUCED_INCOME_TAX_RATE
        : gainPart * PFU_INCOME_TAX_RATE;
      break;
    default:
      incomeTax = gainPart * PFU_INCOME_TAX_RATE;
  }
  return { known: true, gainPart, socialCharges, incomeTax, net: amount - socialCharges - incomeTax, closesPea };
};

// ---------------------------------------------------------------------------
// Placé ce mois-ci
// ---------------------------------------------------------------------------

/**
 * Argent réellement mis de côté ce mois-ci (part propre) : versements − retraits sur les
 * comptes d'épargne. Les virements entre deux comptes d'épargne s'annulent d'eux-mêmes ;
 * les variations de valeur des placements (`kind: 'valuation'`) ne comptent pas.
 */
export const computeMonthSavedAmount = (
  accounts: { type: AccountType; movements?: AccountMovement[] }[],
  asOfDate: Date = new Date()
): number => {
  const monthKey = `${asOfDate.getFullYear()}-${String(asOfDate.getMonth() + 1).padStart(2, '0')}`;
  const todayKey = formatISODay(asOfDate);
  let total = 0;
  for (const a of accounts) {
    if (a.type === AccountType.COMPTE_COURANT || a.type === AccountType.IMMOBILIER) continue;
    for (const m of a.movements || []) {
      if (m.kind === 'valuation' || !m.date.startsWith(monthKey) || m.date > todayKey) continue;
      total += m.type === 'IN' ? m.amount : -m.amount;
    }
  }
  return total;
};

// ---------------------------------------------------------------------------
// Abonnements
// ---------------------------------------------------------------------------

const FREQUENCY_MONTHS: Record<Exclude<Subscription['frequency'], 'weekly'>, number> = {
  monthly: 1, quarterly: 3, semiannual: 6, yearly: 12,
};

/** Coût mensuel équivalent d'un abonnement. */
export const subscriptionMonthlyCost = (s: Pick<Subscription, 'amount' | 'frequency'>): number =>
  s.frequency === 'weekly' ? s.amount * 52 / 12 : s.amount / FREQUENCY_MONTHS[s.frequency];

/**
 * Prochain prélèvement à partir de `from` (inclus), déduit d'une date de prélèvement
 * connue. Mensuel le 31 → dernier jour des mois plus courts, sans dériver ensuite.
 */
export const nextSubscriptionDate = (s: Pick<Subscription, 'frequency' | 'anchorDate'>, from: Date = new Date()): Date => {
  const anchor = parseISODate(s.anchorDate);
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  if (anchor >= start) return anchor;
  if (s.frequency === 'weekly') {
    const weeks = Math.ceil(daysBetween(anchor, start) / 7);
    return new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + weeks * 7);
  }
  const step = FREQUENCY_MONTHS[s.frequency];
  const monthsApart = (start.getFullYear() - anchor.getFullYear()) * 12 + start.getMonth() - anchor.getMonth();
  for (let k = Math.max(0, Math.floor(monthsApart / step)); ; k++) {
    const y = anchor.getFullYear(), m = anchor.getMonth() + k * step;
    const lastDay = new Date(y, m + 1, 0).getDate();
    const d = new Date(y, m, Math.min(anchor.getDate(), lastDay));
    if (d >= start) return d;
  }
};

/** Seuil à partir duquel on prévient une semaine avant, au lieu de la veille. */
export const SUBSCRIPTION_BIG_AMOUNT = 100;
export const subscriptionLeadDays = (amount: number) => amount >= SUBSCRIPTION_BIG_AMOUNT ? 7 : 1;

export interface DueSubscription {
  subscription: Subscription;
  dueDate: string;   // 'YYYY-MM-DD'
  daysUntil: number; // 1..leadDays
}

/**
 * Abonnements à annoncer aujourd'hui : prélèvement dans 1 à 7 jours pour les montants
 * d'au moins 100 €, uniquement la veille sinon.
 */
export const findDueSubscriptions = (subs: Subscription[], asOfDate: Date = new Date()): DueSubscription[] => {
  const today = new Date(asOfDate.getFullYear(), asOfDate.getMonth(), asOfDate.getDate());
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  return subs
    .filter(s => s.active && s.amount > 0 && s.anchorDate)
    .flatMap(s => {
      const next = nextSubscriptionDate(s, tomorrow);
      const daysUntil = Math.round(daysBetween(today, next));
      return daysUntil >= 1 && daysUntil <= subscriptionLeadDays(s.amount)
        ? [{ subscription: s, dueDate: formatISODay(next), daysUntil }]
        : [];
    });
};

/**
 * Versements cumulés après un mouvement d'argent réel (versement si `signedAmount` > 0,
 * retrait sinon). Inchangés (undefined) si le compte ne les suit pas.
 */
export const depositsAfterCashFlow = (
  account: { totalDeposits?: number; totalAmount: number },
  signedAmount: number
): number | undefined => {
  if (account.totalDeposits === undefined) return undefined;
  const next = signedAmount >= 0
    ? account.totalDeposits + signedAmount
    : depositsAfterWithdrawal(account.totalDeposits, account.totalAmount, -signedAmount);
  return Math.round(next * 100) / 100;
};

/** Seuls ces abonnements reviennent chaque mois : les autres ne font que déclencher un rappel. */
export const isMonthlyCharge = (s: Pick<Subscription, 'frequency'>) =>
  s.frequency === 'monthly' || s.frequency === 'weekly';

/**
 * Abonnements mensuels (et hebdomadaires, ramenés au mois) vus comme des charges fixes.
 * Les trimestriels, semestriels et annuels n'y figurent PAS : ils sont payés quand ils
 * tombent, l'app se contente de prévenir avant. Identifiants préfixés `sub:` : jamais
 * confondus avec une charge saisie.
 */
export const subscriptionsAsExpenses = (subs: Subscription[]): Expense[] =>
  subs
    .filter(s => s.active && s.amount > 0 && isMonthlyCharge(s))
    .map(s => ({
      id: `sub:${s.id}`,
      name: s.name,
      amount: Math.round(subscriptionMonthlyCost(s) * 100) / 100,
      paymentMethod: s.debitAccount || undefined,
    }));

/** Charges fixes mensuelles : charges saisies + abonnements actifs. */
export const totalFixedCharges = (expenses: Expense[], subs: Subscription[] = []): number =>
  expenses.reduce((sum, e) => sum + e.amount, 0) +
  subscriptionsAsExpenses(subs).reduce((sum, e) => sum + e.amount, 0);

// ---------------------------------------------------------------------------
// Répartition de la paie, virement par virement
// ---------------------------------------------------------------------------

export interface PayTransfer {
  label: string;
  amount: number;
}

/**
 * Ce qui part de la paie AVANT l'épargne, dans l'ordre des virements : chaque charge
 * saisie (ex. « Revolut commun »), les abonnements mensuels (avec leur compte s'ils
 * partent tous du même), l'épargne projets, puis l'argent plaisir qui reste sur le compte.
 * Ce qui reste est l'épargne, répartie par computePlacementStrategy.
 */
export const computePayTransfers = (input: {
  expenses: Expense[];
  subscriptions?: Subscription[];
  leisureBudget: number;
  projectSavings: number;
}): PayTransfer[] => {
  const out: PayTransfer[] = input.expenses
    .filter(e => e.amount > 0)
    .map(e => ({ label: e.name, amount: e.amount }));
  const subs = subscriptionsAsExpenses(input.subscriptions || []);
  const subsTotal = Math.round(subs.reduce((sum, e) => sum + e.amount, 0) * 100) / 100;
  if (subsTotal > 0) {
    const accounts = new Set(subs.map(e => e.paymentMethod || ''));
    const only = accounts.size === 1 ? [...accounts][0] : '';
    out.push({ label: only ? `Abonnements (${only})` : 'Abonnements mensuels', amount: subsTotal });
  }
  if (input.projectSavings > 0) out.push({ label: 'Épargne projets', amount: input.projectSavings });
  if (input.leisureBudget > 0) out.push({ label: 'Argent plaisir (reste sur le compte courant)', amount: input.leisureBudget });
  return out;
};

// ---------------------------------------------------------------------------
// Taux d'épargne
// ---------------------------------------------------------------------------

export interface MonthSavingsRate {
  month: string;  // 'YYYY-MM'
  saved: number;  // versements − retraits du mois (voir computeMonthSavedAmount)
  rate: number;   // part de la paie, en % (0 si paie inconnue)
}

/**
 * Taux d'épargne des `months` derniers mois, mois en cours inclus (partiel). Rapporté à la
 * paie ACTUELLE : l'app ne connaît pas l'historique exact des salaires.
 */
export const computeSavingsRateHistory = (
  accounts: { type: AccountType; movements?: AccountMovement[] }[],
  monthlyPay: number,
  months: number = 12,
  asOfDate: Date = new Date()
): MonthSavingsRate[] => {
  const out: MonthSavingsRate[] = [];
  for (let k = months - 1; k >= 0; k--) {
    const end = k === 0
      ? asOfDate
      : new Date(asOfDate.getFullYear(), asOfDate.getMonth() - k + 1, 0);
    const saved = computeMonthSavedAmount(accounts, end);
    out.push({
      month: `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}`,
      saved,
      rate: monthlyPay > 0 ? (saved / monthlyPay) * 100 : 0,
    });
  }
  return out;
};

// ---------------------------------------------------------------------------
// Relevés annuels des placements
// ---------------------------------------------------------------------------

/**
 * Placements (PEA, AV…) dont la valeur n'a pas encore été actualisée cette année : en
 * janvier, les relevés au 31/12 arrivent, c'est le moment de reporter valeur et versements.
 */
export const findAccountsAwaitingAnnualStatement = (
  accounts: SavingsAccount[],
  asOfDate: Date = new Date()
): SavingsAccount[] => {
  const yearStart = `${asOfDate.getFullYear()}-01-01`;
  return accounts.filter(a =>
    tracksDeposits(a.type) && a.totalAmount > 0 &&
    !(a.movements || []).some(m => m.kind === 'valuation' && m.date >= yearStart)
  );
};

// ---------------------------------------------------------------------------
// Dons aux associations (réduction d'impôt)
// ---------------------------------------------------------------------------

// Plafond des dons ouvrant droit au taux de 75 % (aide aux personnes en difficulté) ; au-delà,
// ils basculent à 66 %. Montant fixé par la loi de finances : à revoir chaque année.
export const DONATION_75_CEILING = 1000;

export interface DonationSummary {
  year: number;
  count: number;
  total: number;
  total66: number;        // à déclarer au taux de 66 % (y compris l'excédent des dons à 75 %)
  total75: number;        // à déclarer au taux de 75 % (plafonné)
  reduction: number;      // réduction d'impôt estimée
  missingReceipts: Donation[];
}

/**
 * Récapitulatif d'une année de dons. Simplifié : ne vérifie pas le plafond global de 20 %
 * du revenu imposable (l'excédent se reporte sur 5 ans), rarement atteint.
 */
export const computeDonationSummary = (donations: Donation[], year: number): DonationSummary => {
  const ofYear = donations.filter(d => d.date.startsWith(`${year}-`) && d.amount > 0);
  const raw75 = ofYear.filter(d => d.rate === 75).reduce((sum, d) => sum + d.amount, 0);
  const raw66 = ofYear.filter(d => d.rate !== 75).reduce((sum, d) => sum + d.amount, 0);
  const total75 = Math.min(raw75, DONATION_75_CEILING);
  const total66 = raw66 + (raw75 - total75);
  return {
    year,
    count: ofYear.length,
    total: raw66 + raw75,
    total66,
    total75,
    reduction: total75 * 0.75 + total66 * 0.66,
    missingReceipts: ofYear.filter(d => !d.receiptReceived),
  };
};
