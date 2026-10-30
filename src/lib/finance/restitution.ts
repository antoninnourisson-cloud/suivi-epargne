// Restitution du capital des parents.
// Partie de src/lib/finance.ts (qui réexporte tout) : importez depuis '../finance'.
import { AccountType, AccountMovement, SavingsAccount } from '../../types';
import { formatISODay, parseISODate } from '../dates';
import { round2 } from '../money';
import { computeAccruedInterest } from './interest';
import { SavingsSplit } from './placement';

// ---------------------------------------------------------------------------
// Restitution du capital parental
// ---------------------------------------------------------------------------

export interface RestitutionRow {
  accountId: string;
  name: string;
  type: AccountType;
  amount: number;          // capital parental à rendre
  yearInterest: number;    // intérêts produits par ce capital sur l'année, jusqu'au retrait (offerts)
  lostVsBest: number;      // intérêts perdus par rapport à un retrait le 1er janvier suivant
}

export interface RestitutionPlan {
  interestYear: number;    // année dont les intérêts sont en jeu
  bestDate: string;        // 1er janvier suivant : toute l'année est acquise
  rows: RestitutionRow[];
  total: number;
  totalInterest: number;
  totalLost: number;
}

/** Date conseillée : le 1er janvier qui suit (les livrets créditent l'année au 31/12). */
export const suggestedRestitutionDate = (asOfDate: Date = new Date()) => formatISODay(new Date(asOfDate.getFullYear() + 1, 0, 1));

/**
 * Ce que rapporte le capital parental jusqu'à la date de retrait, et ce qu'un retrait
 * avant le 1er janvier ferait perdre. Même calcul que le reste de l'app
 * (computeAccruedInterest) sur la seule part des parents : taux datés (rateHistory),
 * mouvements parentaux à leur date, règle des quinzaines pour les livrets (un retrait ne
 * rapporte plus rien depuis le dernier 1er ou 16), prorata journalier sinon. Ce montant
 * est figé dans le relevé de restitution : il ne doit pas dépendre du seul taux du jour.
 */
export const computeRestitutionPlan = (accounts: SavingsAccount[], plannedDateISO: string): RestitutionPlan => {
  const planned = parseISODate(plannedDateISO);
  const interestYear = planned.getMonth() === 0 && planned.getDate() === 1 ? planned.getFullYear() - 1 : planned.getFullYear();
  const yearEnd = new Date(interestYear + 1, 0, 1);
  // Intérêts de l'année produits par la part des parents, avec ou sans le retrait prévu.
  const parentalInterest = (a: SavingsAccount, withdrawal: boolean) => {
    const out: AccountMovement[] = withdrawal
      ? [{ id: 'restitution-prevue', date: plannedDateISO, amount: a.parentalCapital, label: RESTITUTION_LABEL, type: 'OUT' }]
      : [];
    const parental = computeAccruedInterest({
      type: a.type, interestRate: a.interestRate, rateHistory: a.rateHistory,
      totalAmount: withdrawal ? 0 : a.parentalCapital,
      movements: [...a.movements.filter(m => m.kind === 'parental').map(m => ({ ...m, kind: undefined })), ...out],
    }, interestYear, yearEnd);
    // Garde-fou, comme computeAccruedParentalInterest : jamais plus que le compte entier.
    const whole = computeAccruedInterest({
      ...a,
      totalAmount: withdrawal ? a.totalAmount - a.parentalCapital : a.totalAmount,
      movements: [...a.movements, ...out],
    }, interestYear, yearEnd);
    return Math.max(0, Math.min(parental, whole));
  };
  const rows = accounts
    .filter(a => a.parentalCapital > 0)
    .map(a => {
      const full = parentalInterest(a, false);
      const atPlanned = parentalInterest(a, true);
      return { accountId: a.id, name: a.name, type: a.type, amount: a.parentalCapital, yearInterest: atPlanned, lostVsBest: Math.max(0, full - atPlanned) };
    });
  return {
    interestYear,
    bestDate: formatISODay(yearEnd),
    rows,
    total: rows.reduce((s, r) => s + r.amount, 0),
    totalInterest: rows.reduce((s, r) => s + r.yearInterest, 0),
    totalLost: rows.reduce((s, r) => s + r.lostVsBest, 0),
  };
};

/** Libellé des mouvements de restitution (reconnus pour l'annulation). */
export const RESTITUTION_LABEL = 'Restitution aux parents';

/**
 * Comptes tels qu'ils seront après la restitution : part parentale retirée, avec un
 * mouvement « part des parents » daté du retrait. Sans ce mouvement, l'app « oublierait »
 * que ce capital a existé et sous-estimerait les intérêts passés.
 */
export const accountsAfterRestitution = <T extends { ownedAmount: number; parentalCapital: number; totalAmount: number; movements: AccountMovement[] }>(accounts: T[], dateISO?: string): T[] =>
  accounts.map(a => ({
    ...a,
    parentalCapital: 0,
    totalAmount: round2(a.ownedAmount),
    movements: dateISO && a.parentalCapital > 0
      ? [...a.movements, { id: `restitution-${dateISO}-${Math.random().toString(36).slice(2, 8)}`, date: dateISO, amount: round2(a.parentalCapital), label: RESTITUTION_LABEL, type: 'OUT' as const, kind: 'parental' as const, tag: 'restitution' as const }]
      : a.movements,
  }));

/** Comptes d'une répartition personnalisée qui n'existent plus (supprimés depuis). */
export const missingSplitAccounts = (split: SavingsSplit | undefined, accounts: { id: string }[]) =>
  (split || []).filter(s => !accounts.some(a => a.id === s.accountId));

/**
 * Mois calendaires avant la restitution prévue (projection du Rendement) ; undefined si
 * aucune n'est prévue ou si elle est faite. Date passée mais restitution pas encore notée :
 * 0 (le capital part tout de suite), comme dans le simulateur, pour que les deux écrans
 * donnent le même solde. Date lue en heure locale (parseISODate) : `new Date('2027-01-01')`
 * tombe le 31 décembre dans un fuseau négatif.
 */
export const monthsUntilRestitution = (r: { plannedDate?: string; done?: unknown } | undefined, now: Date = new Date()): number | undefined => {
  if (!r?.plannedDate || r.done) return undefined;
  const d = parseISODate(r.plannedDate);
  if (Number.isNaN(d.getTime())) return undefined;
  const months = (d.getFullYear() - now.getFullYear()) * 12 + d.getMonth() - now.getMonth();
  return Math.max(0, months);
};
