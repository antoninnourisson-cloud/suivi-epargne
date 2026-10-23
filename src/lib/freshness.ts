// ================================================
// FILE: src/lib/freshness.ts
// Fraîcheur des soldes, compte par compte : date du dernier solde constaté et comptes à
// revérifier, avec un délai adapté à chaque type de compte. Un versement prévu (liste de la
// paie, mouvement régulier, ajout rapide) ne compte PAS comme un constat : seul un solde lu à
// la banque (« Actualiser », fiche du compte, « Solde vérifié ») le fait. Fonctions pures,
// partagées par l'app (À faire, Mes comptes, alertes) et le serveur de notifications.
// ================================================
import { AccountMovement, AccountType, SavingsAccount } from '../types';
import { MS_PER_DAY, formatISODay, parseISODate } from './dates';
import { isInitialBalance } from './finance';

/**
 * Délai, en jours, au-delà duquel le solde d'un compte est à revérifier (`null` : jamais).
 * - compte courant : un mois (il bouge tous les jours et sert aux alertes « argent qui dort ») ;
 * - livrets, crypto, « Autre » : trois mois ;
 * - placements à relevé annuel (assurance vie, PEA, compte-titres, PER, PEE) et comptes dont
 *   les intérêts tombent une fois par an (PEL, compte à terme) : treize mois, le temps du relevé ;
 * - immobilier : pas de rappel (valeur estimée, rarement revue).
 */
export const freshnessLimitDays = (type: AccountType): number | null => {
  switch (type) {
    case AccountType.COMPTE_COURANT: return 30;
    case AccountType.ASSURANCE_VIE:
    case AccountType.PEA:
    case AccountType.CTO:
    case AccountType.PER:
    case AccountType.PEE:
    case AccountType.PEL:
    case AccountType.COMPTE_A_TERME:
      return 400;
    case AccountType.IMMOBILIER: return null;
    default: return 90;
  }
};

/**
 * Mouvement qui reflète un solde lu (fichiers d'avant `balanceCheckedAt`) : solde initial,
 * variation de valeur, correction ou intérêts, actualisation d'un livret. Un versement ou un
 * retrait ordinaire n'en est pas un.
 */
const isObservation = (m: AccountMovement): boolean =>
  isInitialBalance(m) || m.kind === 'valuation' || m.kind === 'adjustment' || /^Actualisation\b/.test(m.label);

/** Dernier solde constaté ('YYYY-MM-DD', jamais après `todayISO`), ou `undefined` s'il n'y en a aucun. */
export const lastBalanceCheck = (account: Pick<SavingsAccount, 'balanceCheckedAt' | 'movements'>, todayISO: string): string | undefined => {
  let latest = account.balanceCheckedAt ? (account.balanceCheckedAt > todayISO ? todayISO : account.balanceCheckedAt) : undefined;
  for (const m of account.movements || []) {
    if (m.date <= todayISO && isObservation(m) && (!latest || m.date > latest)) latest = m.date;
  }
  return latest;
};

export interface BalanceFreshness {
  /** Dernier solde constaté, ou `undefined` (jamais). */
  checkedOn?: string;
  /** Jours écoulés depuis, ou `null` (jamais). */
  days: number | null;
  /** Délai du type de compte (`null` : pas de rappel). */
  limit: number | null;
  stale: boolean;
}

export const balanceFreshness = (account: SavingsAccount, now: Date = new Date()): BalanceFreshness => {
  const today = formatISODay(now);
  const checkedOn = lastBalanceCheck(account, today);
  const days = checkedOn ? Math.round((parseISODate(today).getTime() - parseISODate(checkedOn).getTime()) / MS_PER_DAY) : null;
  const limit = freshnessLimitDays(account.type);
  return { checkedOn, days, limit, stale: limit !== null && (days === null || days >= limit) };
};

export interface StaleBalance extends BalanceFreshness {
  id: string;
  name: string;
  type: AccountType;
}

/**
 * Comptes dont le solde est à revérifier, le plus en retard d'abord (jamais vérifié en tête).
 * Un compte vide est ignoré, même avec des mouvements (livret vidé à la restitution, compte
 * fermé) : il n'y a rien à vérifier, et le rappel ne doit pas revenir tous les trois mois.
 */
export const findStaleBalances = (accounts: SavingsAccount[], now: Date = new Date()): StaleBalance[] =>
  accounts
    .filter(a => a.totalAmount > 0.005)
    .map(a => ({ id: a.id, name: a.name, type: a.type, ...balanceFreshness(a, now) }))
    .filter(s => s.stale)
    .sort((x, y) => (y.days === null ? Infinity : y.days - (y.limit ?? 0)) - (x.days === null ? Infinity : x.days - (x.limit ?? 0))
      || x.name.localeCompare(y.name));

/** « vérifié aujourd'hui », « vérifié il y a 41 jours », « vérifié il y a 14 mois », « jamais vérifié ». */
export const describeCheckAge = (days: number | null): string => {
  if (days === null) return 'jamais vérifié';
  if (days <= 0) return "vérifié aujourd'hui";
  if (days === 1) return 'vérifié hier';
  if (days < 60) return `vérifié il y a ${days} jours`;
  const months = Math.round(days / 30.4375);
  return `vérifié il y a ${months} mois`;
};

/**
 * Phrase de rappel qui nomme les comptes à revérifier (trois au plus, puis « et N autres »),
 * ou `null` s'il n'y en a aucun.
 */
export const describeStaleBalances = (stale: StaleBalance[]): string | null => {
  if (stale.length === 0) return null;
  const shown = stale.slice(0, 3).map(s => `${s.name} (${describeCheckAge(s.days)})`);
  const rest = stale.length - shown.length;
  const list = rest > 0 ? `${shown.join(', ')} et ${rest} autre${rest > 1 ? 's' : ''}` : shown.length > 1 ? `${shown.slice(0, -1).join(', ')} et ${shown[shown.length - 1]}` : shown[0];
  return `${stale.length > 1 ? 'Soldes à vérifier' : 'Solde à vérifier'} : ${list}.`;
};

/**
 * Âge maximal (jours) du solde du compte courant pour chiffrer l'argent qui « dort » dessus
 * (alerte de l'Accueil, manque à gagner de Rendement) : au-delà, il a pu fondre depuis.
 */
export const CURRENT_ACCOUNT_FRESH_DAYS = 15;

/**
 * Proposer « Solde vérifié » (confirmer en un geste un solde inchangé) : solde à revérifier,
 * ou compte courant constaté il y a plus de CURRENT_ACCOUNT_FRESH_DAYS jours. Sans cela,
 * l'argent qui dort ne serait plus chiffré pendant la moitié du mois, et « Actualiser »
 * n'enregistre que des soldes qui changent.
 */
export const offersBalanceCheck = (type: AccountType, f: Pick<BalanceFreshness, 'days' | 'stale'>): boolean =>
  f.stale || (type === AccountType.COMPTE_COURANT && (f.days === null || f.days > CURRENT_ACCOUNT_FRESH_DAYS));

/** Solde constaté il y a `maxDays` jours au plus. */
export const isRecentlyChecked = (account: Pick<SavingsAccount, 'balanceCheckedAt' | 'movements'>, maxDays: number, now: Date = new Date()): boolean => {
  const today = formatISODay(now);
  const checked = lastBalanceCheck(account, today);
  return !!checked && Math.round((parseISODate(today).getTime() - parseISODate(checked).getTime()) / MS_PER_DAY) <= maxDays;
};
