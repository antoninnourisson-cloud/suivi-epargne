// ================================================
// FILE: src/lib/finance.ts
// Logique fiscale centralisée (calcul du "super net", impôt par tranches).
// Fonctions pures, testables, réutilisées par le Pilotage et le Dashboard.
// ================================================
import { FiscalConfig, TaxBracket, WorkBenefits, RateChange, AccountType, AccountMovement } from '../types';
import { DEFAULT_STANDARD_ALLOWANCE_CAP } from '../constants';
import { MS_PER_DAY } from './dates';

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
// utilisé par aucun calcul : l'export fiscal de Rendement listait des intérêts BRUTS. Ce qui
// suit modélise le régime le plus courant par type de compte — volontairement simplifié, pas
// une simulation fiscale complète (voir les limites documentées sur chaque cas).
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
  // Économie d'IR annuelle estimée une fois mature, sur les intérêts ACTUELS (taux × solde
  // du jour) — évoluera si le solde ou le taux changent d'ici la maturité. 0 si le compte
  // ne produit pas encore d'intérêt connu.
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
  const nowStr = asOfDate.toISOString().split('T')[0];
  const pastStr = past.toISOString().split('T')[0];

  const hasMovementsInWindow = accounts.some(a => (a.movements || []).some(m => m.date > pastStr && m.date <= nowStr));
  if (!hasMovementsInWindow) return null;

  const totalNow = computeAccountBalanceAtDate(accounts, nowStr);
  const totalPast = computeAccountBalanceAtDate(accounts, pastStr);
  return (totalNow - totalPast) / (windowDays / 30);
};
