// Intérêts : quinzaines, taux datés, intérêts attendus, relevés annuels.
// Partie de src/lib/finance.ts (qui réexporte tout) : importez depuis '../finance'.
import { FiscalConfig, RateChange, AccountType, AccountMovement, SavingsAccount } from '../../types';
import { DEFAULT_FISCAL_CONFIG } from '../../constants';
import { formatISODay, parseISODate, daysBetween } from '../dates';
import { signedAmount } from '../money';
import { computeWeightedAnnualRate, tracksDeposits } from './capitalTax';
import { isInitialBalance, isSavingsFlow } from './savings';

// --- INTÉRÊTS RÉELLEMENT ACQUIS SUR UNE ANNÉE ---
// Jusqu'ici, tout se calculait `taux × solde du jour`. C'est honnête pour un RYTHME annuel
// ("voilà ce que rapportent mes comptes en l'état"), mais faux dès qu'on annonce une ANNÉE
// précise : 5 000 € déposés en novembre se voyaient créditer une année pleine d'intérêts.
// Deux endroits annoncent une année et étaient donc surévalués : les gains nets si retrait
// ("Intérêts 2026") et le rappel de décembre sur les intérêts
// parentaux. D'où ce calcul, qui suit le mouvement réel de l'argent.

/** Livrets réglementés : seuls comptes soumis à la règle des quinzaines. */
export const REGULATED_TYPES = [AccountType.LIVRET_A, AccountType.LDDS, AccountType.LEP];

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
    if (m.date >= key) balance -= signedAmount(m);
  });
  return balance;
};

/** Bornes de quinzaine de l'année : les 1er et 16 de chaque mois (24 au total). */
export const quinzaineStarts = (year: number): Date[] => {
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
export const quinzaineEffectiveDate = (d: Date, isDeposit: boolean): Date => {
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
  accountIn: { type: AccountType; totalAmount: number; movements?: AccountMovement[]; interestRate?: number; rateHistory?: RateChange[]; openingDate?: string },
  year: number,
  asOfDate: Date = new Date()
): number => {
  // Un « Solde initial » est l'argent présent à la création du compte dans l'app : il
  // rapporte depuis l'ouverture réelle du compte (ou depuis toujours si elle est inconnue),
  // pas depuis le jour de la saisie.
  const account = {
    ...accountIn,
    movements: (accountIn.movements || []).map(m => isInitialBalance(m)
      ? { ...m, date: accountIn.openingDate && accountIn.openingDate <= m.date ? accountIn.openingDate : m.date }
      : m),
  };
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
    balance += signedAmount(m);
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
  accounts: { id: string; name: string; type: AccountType; interestRate?: number; rateHistory?: RateChange[]; rateReviewedAt?: string }[],
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
      const touched = (a.rateHistory || []).some(c => parseISODate(c.date) >= revision.date)
        || (!!a.rateReviewedAt && parseISODate(a.rateReviewedAt) >= revision.date);
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
 * Estime si le LEP reste accessible. Perdre l'éligibilité oblige à sortir le capital du
 * livret réglementé le mieux rémunéré vers un support moins rémunérateur : autant le voir venir.
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

  // Grille officielle : un montant fixe ajouté par demi-part au-delà de la première part
  // (6 149 € en 2026), et non une multiplication du plafond.
  const parts = fiscalConfig.lepHouseholdParts && fiscalConfig.lepHouseholdParts > 0 ? fiscalConfig.lepHouseholdParts : 1;
  const perHalf = fiscalConfig.lepCeilingPerHalfPart ?? DEFAULT_FISCAL_CONFIG.lepCeilingPerHalfPart ?? 0;
  const ceiling = base + Math.max(0, Math.round((parts - 1) * 2)) * perHalf;
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
 * La part des parents est reconstituée par ses propres mouvements (`kind: 'parental'` :
 * ajouts, corrections, restitution), datés : une restitution ou une correction en cours
 * d'année ne s'applique qu'à partir de sa date. Sans mouvement parental, leur capital est
 * supposé constant sur l'année.
 */
export const computeAccruedParentalInterest = (
  accounts: { type: AccountType; interestRate?: number; rateHistory?: RateChange[]; totalAmount: number; ownedAmount: number; parentalCapital?: number; movements?: AccountMovement[]; openingDate?: string }[],
  year: number,
  asOfDate: Date = new Date()
): ParentalInterestBreakdown => {
  let totalAnnual = 0;
  let totalAnnualParental = 0;
  accounts.forEach(a => {
    const accrued = computeAccruedInterest(a, year, asOfDate);
    if (accrued <= 0) return;
    totalAnnual += accrued;
    const parentalNow = a.parentalCapital ?? Math.max(0, a.totalAmount - a.ownedAmount);
    // Vue « part des parents seule » : leur capital actuel et leurs mouvements.
    const parentalView = {
      type: a.type, interestRate: a.interestRate, rateHistory: a.rateHistory,
      totalAmount: parentalNow,
      movements: (a.movements || []).filter(m => m.kind === 'parental').map(m => ({ ...m, kind: undefined })),
    };
    totalAnnualParental += Math.min(accrued, computeAccruedInterest(parentalView, year, asOfDate));
  });
  return { totalAnnual, totalAnnualOwned: Math.max(0, totalAnnual - totalAnnualParental), totalAnnualParental };
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
// Intérêts attendus sur l'année, conseil de retrait
// ---------------------------------------------------------------------------

/**
 * Intérêts de l'année entière si les soldes ne bougent plus d'ici le 31 décembre :
 * acquis à ce jour + quinzaines (ou jours) restantes au solde actuel.
 */
export const computeExpectedYearInterest = (
  accounts: Parameters<typeof computeAccruedParentalInterest>[0],
  year: number
): { total: number; parental: number; own: number } => {
  const r = computeAccruedParentalInterest(accounts, year, new Date(year + 1, 0, 1));
  return { total: r.totalAnnual, parental: r.totalAnnualParental, own: r.totalAnnualOwned };
};

/**
 * Retrait d'un livret réglementé en cours de quinzaine : il ne rapporte déjà plus rien
 * depuis le 1er ou le 16. Attendre la prochaine borne garde la quinzaine en cours.
 * `null` si sans objet (autre compte, ou retrait pile le 1er ou le 16).
 */
export const quinzaineWithdrawalTip = (
  account: { type: AccountType; interestRate?: number },
  amount: number,
  date: Date
): { waitUntil: string; gain: number } | null => {
  if (!REGULATED_TYPES.includes(account.type) || amount <= 0) return null;
  const day = date.getDate();
  if (day === 1 || day === 16) return null;
  const gain = amount * ((account.interestRate || 0) / 100) / 24;
  if (gain < 0.5) return null;
  const next = day < 16 ? new Date(date.getFullYear(), date.getMonth(), 16) : new Date(date.getFullYear(), date.getMonth() + 1, 1);
  return { waitUntil: formatISODay(next), gain };
};

// ---------------------------------------------------------------------------
// Taux servi de l'Assurance Vie (publié chaque début d'année)
// ---------------------------------------------------------------------------

/**
 * Assurances Vie dont le taux n'a pas été revu depuis le 1er janvier : le taux servi du
 * fonds euros de l'année écoulée est publié par l'assureur en janvier. Signalé du 15
 * janvier au 31 mars.
 */
export const findAvRateUpdatesDue = (accounts: SavingsAccount[], asOfDate: Date = new Date()): SavingsAccount[] => {
  const m = asOfDate.getMonth(), d = asOfDate.getDate();
  if (!((m === 0 && d >= 15) || m === 1 || m === 2)) return [];
  const yearStart = `${asOfDate.getFullYear()}-01-01`;
  return accounts.filter(a =>
    a.type === AccountType.ASSURANCE_VIE && a.totalAmount > 0 &&
    !(a.rateHistory || []).some(r => r.date >= yearStart)
  );
};

// ---------------------------------------------------------------------------
// Changement de taux daté
// ---------------------------------------------------------------------------

/** Livrets dont le taux est fixé ensemble par l'État (Livret A et LDDS ont toujours le même). */
export const REGULATED_RATE_GROUPS: { key: string; label: string; types: AccountType[] }[] = [
  { key: 'livretA', label: 'Livret A et LDDS', types: [AccountType.LIVRET_A, AccountType.LDDS] },
  { key: 'lep', label: 'LEP', types: [AccountType.LEP] },
];

/**
 * Nouveau taux à partir de `effectiveISO` (ex. 1,7 % au 1er août 2026), même saisi plus
 * tard. Convention de `rateHistory` : une entrée { date, rate } = « `rate` courait
 * jusqu'à `date` ». Les entrées postérieures à la date d'effet sont remplacées (le nouveau
 * taux s'applique depuis cette date).
 */
export const applyRateChange = <T extends { interestRate?: number; rateHistory?: RateChange[]; rateReviewedAt?: string }>(
  account: T,
  newRate: number,
  effectiveISO: string
): T => {
  const effective = parseISODate(effectiveISO);
  const before = rateAtDate(account.interestRate || 0, account.rateHistory, new Date(effective.getTime() - 1));
  const kept = (account.rateHistory || []).filter(c => c.date < effectiveISO);
  const rateHistory = Math.abs(before - newRate) > 1e-9 ? [...kept, { date: effectiveISO, rate: before }] : kept;
  // Taux vérifié (même inchangé) : le rappel de révision est éteint.
  const reviewed = formatISODay(new Date()) > effectiveISO ? formatISODay(new Date()) : effectiveISO;
  return { ...account, interestRate: newRate, rateHistory: rateHistory.length > 0 ? rateHistory : undefined, rateReviewedAt: reviewed };
};

/**
 * Argent mis de côté (part propre) depuis une date incluse jusqu'à `asOfDate` : versements
 * − retraits, hors valorisations, part parentale et soldes initiaux.
 */
export const computeSavedSince = (
  accounts: { type: AccountType; movements?: AccountMovement[] }[],
  fromISO: string,
  asOfDate: Date = new Date(),
  trackingStartISO?: string
): number => {
  const todayKey = formatISODay(asOfDate);
  let total = 0;
  for (const a of accounts) {
    if (a.type === AccountType.COMPTE_COURANT || a.type === AccountType.IMMOBILIER) continue;
    for (const m of a.movements || []) {
      if (!isSavingsFlow(m, trackingStartISO) || m.date < fromISO || m.date > todayKey) continue;
      total += signedAmount(m);
    }
  }
  return total;
};
