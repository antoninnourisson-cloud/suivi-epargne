// ================================================
// FILE: src/lib/performance.ts
// Performance des placements dont la valeur bouge (PEA, compte-titres, assurance vie, PER,
// PEE, crypto) : valeur face aux versements nets, gain, et rendement annuel pondéré par
// l'argent (TRI, « XIRR » des tableurs) calculé sur les versements et retraits datés et la
// valeur actuelle. Sert aussi d'hypothèse de rendement quand aucun taux n'est saisi : jamais
// un 0 % implicite. Fonctions pures, testées.
// ================================================
import { AccountMovement, AccountType, SavingsAccount } from '../types';
import { MS_PER_DAY, formatISODay } from './dates';
import { averageRateBetween, tracksDeposits } from './finance';
import { round2, signedAmount } from './money';

/** Flux du point de vue de l'épargnant : argent versé négatif, argent retiré ou valeur finale positifs. */
export interface CashFlow { date: string; amount: number }

const DAYS_PER_YEAR = 365;

/** Numéro de jour d'une date 'YYYY-MM-DD' (jours civils, sans effet du changement d'heure). */
const dayNumber = (iso: string): number => {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return Date.UTC(y, m - 1, d) / MS_PER_DAY;
};

/**
 * Taux annuel r (fraction) qui annule la valeur actuelle des flux :
 * Σ montant × (1 + r)^(−jours depuis le premier flux / 365) = 0 (convention des tableurs).
 * `null` s'il n'existe pas : flux tous du même signe, ou aucun taux entre −99,99 % et +10 000 %.
 * Résolution par dichotomie (la fonction est monotone pour un placement classique : des
 * versements puis une valeur finale), précise au millionième.
 */
export const xirr = (flows: CashFlow[]): number | null => {
  const valid = flows.filter(f => Number.isFinite(f.amount) && Math.abs(f.amount) > 1e-9);
  if (!valid.some(f => f.amount > 0) || !valid.some(f => f.amount < 0)) return null;
  const t0 = Math.min(...valid.map(f => dayNumber(f.date)));
  const points = valid.map(f => ({ t: (dayNumber(f.date) - t0) / DAYS_PER_YEAR, a: f.amount }));
  const npv = (r: number) => points.reduce((s, p) => s + p.a / Math.pow(1 + r, p.t), 0);
  let lo = -0.9999, hi = 100;
  let fLo = npv(lo), fHi = npv(hi);
  if (!Number.isFinite(fLo) || !Number.isFinite(fHi) || fLo * fHi > 0) return null;
  for (let i = 0; i < 200 && hi - lo > 1e-9; i++) {
    const mid = (lo + hi) / 2;
    const fMid = npv(mid);
    if (fMid === 0) return mid;
    if (fMid * fLo < 0) { hi = mid; fHi = fMid; } else { lo = mid; fLo = fMid; }
  }
  return (lo + hi) / 2;
};

export interface AccountPerformance {
  /** Valeur du compte à la date (part des parents comprise). */
  value: number;
  /** Début de la mesure : date du premier mouvement enregistré. */
  since: string;
  /** Durée de la mesure, en années. */
  years: number;
  /** Argent versé net depuis `since` (valeur de départ comprise, retraits déduits). */
  contributions: number;
  /** Versements cumulés du relevé (depuis l'ouverture), s'ils sont connus. */
  totalDeposits?: number;
  /** Gain : valeur − versements (ceux du relevé s'ils sont connus, sinon ceux de la mesure). */
  gain: number;
  /** Au moins une variation de valeur constatée depuis `since` : sinon rien n'est mesuré. */
  measured: boolean;
  /** Rendement pondéré par l'argent sur toute la période (fraction), `null` si non mesuré. */
  periodReturn: number | null;
  /** Rendement annuel (TRI, fraction), seulement sur au moins un an de mesure. */
  annualized: number | null;
}

/** Variation de valeur (cours, intérêts crédités, correction) : fait partie du rendement, ce n'est pas de l'argent versé. */
const isReturnMovement = (m: AccountMovement) => m.kind === 'valuation' || m.kind === 'adjustment';

/**
 * Performance d'un compte à `asOf` d'après ses mouvements :
 * - valeur de départ = valeur actuelle − tous les mouvements enregistrés (elle compte comme
 *   un versement à la date du premier mouvement, le solde initial y compris) ;
 * - versements et retraits (les vôtres comme ceux des parents) = flux d'argent ;
 * - valorisations, intérêts crédités et corrections = rendement ;
 * - mouvements datés après `asOf` ignorés.
 * `null` sans mouvement daté, ou si les mouvements ne collent pas au solde (valeur de départ
 * négative) : on ne devine rien.
 */
export const accountPerformance = (account: SavingsAccount, asOf: Date = new Date()): AccountPerformance | null => {
  const asOfISO = formatISODay(asOf);
  const all = account.movements;
  const past = all.filter(m => m.date <= asOfISO).sort((a, b) => a.date.localeCompare(b.date));
  if (past.length === 0) return null;
  const value = round2(account.totalAmount - all.filter(m => m.date > asOfISO).reduce((s, m) => s + signedAmount(m), 0));
  const startValue = round2(value - past.reduce((s, m) => s + signedAmount(m), 0));
  if (startValue < -0.01) return null;
  const since = past[0].date;
  const years = Math.max(0, (dayNumber(asOfISO) - dayNumber(since)) / DAYS_PER_YEAR);

  const flows: CashFlow[] = [];
  if (startValue > 0.005) flows.push({ date: since, amount: -startValue });
  let contributions = Math.max(0, startValue);
  for (const m of past) {
    if (isReturnMovement(m)) continue;
    flows.push({ date: m.date, amount: -signedAmount(m) });
    contributions += signedAmount(m);
  }
  flows.push({ date: asOfISO, amount: value });
  contributions = round2(contributions);

  const measured = past.some(isReturnMovement);
  const rate = measured && years >= 7 / DAYS_PER_YEAR ? xirr(flows) : null;
  const periodReturn = rate === null ? null : Math.pow(1 + rate, years) - 1;
  return {
    value, since, years, contributions,
    totalDeposits: account.totalDeposits,
    gain: round2(value - (account.totalDeposits ?? contributions)),
    measured,
    periodReturn,
    annualized: rate !== null && years >= 1 ? rate : null,
  };
};

/** Ce qu'aurait rapporté le Livret A sur la même période qu'une performance mesurée. */
export interface LivretAComparison {
  /** Taux annuel moyen du Livret A sur la période (en %), d'après son historique daté. */
  annualRate: number;
  /** Gain du Livret A sur la période (fraction, intérêts simples : moins d'un an). */
  periodReturn: number;
}

/**
 * Livret A sur la même période que `perf` (de `perf.since` à `asOf`), avec les taux datés
 * gardés sur le compte Livret A (révisions de février et d'août). `null` sans Livret A,
 * sans taux connu, ou si la performance n'est pas mesurée.
 */
export const livretAOverPeriod = (
  perf: Pick<AccountPerformance, 'since' | 'years' | 'periodReturn'>,
  accounts: Pick<SavingsAccount, 'type' | 'interestRate' | 'rateHistory'>[],
  asOf: Date = new Date(),
): LivretAComparison | null => {
  if (perf.periodReturn === null) return null;
  const livretA = accounts.find(a => a.type === AccountType.LIVRET_A);
  if (!livretA) return null;
  const annualRate = averageRateBetween(livretA, perf.since, formatISODay(asOf));
  if (!(annualRate > 0)) return null;
  return { annualRate, periodReturn: annualRate / 100 * perf.years };
};

/** Placement dont la valeur bouge avec les marchés : on y mesure une performance. */
export const isMarketAccount = (account: Pick<SavingsAccount, 'type'>): boolean => tracksDeposits(account.type);

export type RateSource = 'entered' | 'observed' | 'missing';

/**
 * Garde-fous d'une performance observée prise comme hypothèse de projection (5 à 20 ans) :
 * une mesure courte, ou un versement fait juste avant une hausse, donne un taux annuel extrême
 * qu'une projection composerait pendant des années. Elle n'est donc retenue que mesurée sur au
 * moins deux ans, jamais pour une crypto (trop variable), et ramenée entre −5 % et +8 % par
 * an. Sinon le placement reste « à renseigner » : c'est à l'utilisateur de choisir.
 */
export const OBSERVED_RATE_MIN_YEARS = 2;
export const OBSERVED_RATE_FLOOR = -5;
export const OBSERVED_RATE_CAP = 8;

export interface AssumedRate {
  /** Taux annuel retenu pour les projections, en %. */
  rate: number;
  source: RateSource;
  /** Début de la mesure, pour une performance observée. */
  since?: string;
  /** Performance observée brute (en %), quand elle a été ramenée dans la fourchette prudente. */
  observedRate?: number;
  /** Pourquoi une performance mesurée n'est pas retenue : crypto, ou moins de deux ans de suivi. */
  reason?: 'volatile' | 'short';
}

/**
 * Rendement annuel à supposer pour un compte, en % :
 * - taux saisi (le seul cas pour un livret ou un compte courant) ;
 * - placement sans taux saisi (vide ou 0, ce que l'ancienne fiche enregistrait par défaut) :
 *   performance annuelle observée, mesurée sur au moins deux ans (jamais pour une crypto),
 *   ramenée entre OBSERVED_RATE_FLOOR et OBSERVED_RATE_CAP ;
 * - sinon « à renseigner » : la projection compte 0 % et le dit.
 */
export const assumedAnnualRate = (account: SavingsAccount, asOf: Date = new Date()): AssumedRate => {
  if (!isMarketAccount(account)) return { rate: account.interestRate ?? 0, source: 'entered' };
  if (account.interestRate !== undefined && account.interestRate !== 0) return { rate: account.interestRate, source: 'entered' };
  const perf = accountPerformance(account, asOf);
  if (!perf || perf.annualized === null) return { rate: 0, source: 'missing' };
  if (account.type === AccountType.CRYPTO) return { rate: 0, source: 'missing', reason: 'volatile' };
  if (perf.years < OBSERVED_RATE_MIN_YEARS) return { rate: 0, source: 'missing', reason: 'short' };
  const raw = round2(perf.annualized * 100);
  const rate = Math.min(OBSERVED_RATE_CAP, Math.max(OBSERVED_RATE_FLOOR, raw));
  return { rate, source: 'observed', since: perf.since, ...(rate !== raw ? { observedRate: raw } : {}) };
};

export interface ProjectionAssumption {
  id: string;
  name: string;
  rate: number;
  source: Exclude<RateSource, 'entered'>;
  since?: string;
  observedRate?: number;
  reason?: AssumedRate['reason'];
}

/**
 * Hypothèses d'une projection : un placement sans taux saisi prend sa performance observée
 * (déjà nette de frais : les frais de gestion ne sont pas retirés une seconde fois).
 * `rates` (identifiant → taux annuel en %) ne sert qu'aux intérêts : les comptes eux-mêmes ne
 * changent pas, donc le plan de placement (qui classe les comptes selon leur taux SAISI)
 * reste celui du Pilotage. `assumptions` liste ces hypothèses et les placements « à renseigner ».
 */
export const withAssumedRates = (accounts: SavingsAccount[], asOf: Date = new Date()): { rates: Record<string, number>; assumptions: ProjectionAssumption[] } => {
  const assumptions: ProjectionAssumption[] = [];
  const rates: Record<string, number> = {};
  for (const a of accounts) {
    const r = assumedAnnualRate(a, asOf);
    if (r.source === 'entered') continue;
    assumptions.push({ id: a.id, name: a.name, rate: r.rate, source: r.source, since: r.since, observedRate: r.observedRate, reason: r.reason });
    if (r.source === 'observed') rates[a.id] = r.rate;
  }
  return { rates, assumptions };
};

/** Hypothèses de rendement d'une projection (withAssumedRates). */
export type ProjectionHypotheses = ReturnType<typeof withAssumedRates>;

/**
 * Le compte tel que les projections le font fructifier : avec son rendement supposé
 * (`assumedRates`, voir withAssumedRates) s'il en a un, sinon tel quel. Une performance
 * observée est déjà nette des frais du contrat : ils ne sont pas retirés une seconde fois.
 * Ne sert qu'au calcul des intérêts : soldes et répartition des versements ne changent pas.
 * Rendement, simulateur « Et si… », plan solo et alertes l'appliquent tous : même compte,
 * même croissance partout.
 */
export const growthView = (account: SavingsAccount, assumedRates?: Readonly<Record<string, number>>): SavingsAccount => {
  const assumed = assumedRates?.[account.id];
  return assumed === undefined ? account : { ...account, interestRate: assumed, managementFee: undefined };
};
