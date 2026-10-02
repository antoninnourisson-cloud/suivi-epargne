// Restitution du capital des parents.
// Partie de src/lib/finance.ts (qui réexporte tout) : importez depuis '../finance'.
import { AccountType, AccountMovement, SavingsAccount } from '../../types';
import { formatISODay, parseISODate, daysBetween } from '../dates';
import { round2 } from '../money';
import { REGULATED_TYPES, quinzaineEffectiveDate, quinzaineStarts } from './interest';
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
 * avant le 1er janvier ferait perdre. Livrets : règle des quinzaines (un retrait ne
 * rapporte plus rien depuis le dernier 1er ou 16) ; autres comptes : prorata journalier.
 * Le capital parental est supposé constant sur l'année (les parents n'y versent pas).
 */
export const computeRestitutionPlan = (accounts: SavingsAccount[], plannedDateISO: string): RestitutionPlan => {
  const planned = parseISODate(plannedDateISO);
  const interestYear = planned.getMonth() === 0 && planned.getDate() === 1 ? planned.getFullYear() - 1 : planned.getFullYear();
  const yearStart = new Date(interestYear, 0, 1);
  const yearEnd = new Date(interestYear + 1, 0, 1);
  const interestUntil = (a: SavingsAccount, until: Date) => {
    const rate = (a.interestRate || 0) / 100;
    if (rate <= 0) return 0;
    if (REGULATED_TYPES.includes(a.type)) {
      const effective = until >= yearEnd ? yearEnd : quinzaineEffectiveDate(until, false);
      const quinzaines = quinzaineStarts(interestYear).filter(q => q < effective).length;
      return a.parentalCapital * rate / 24 * quinzaines;
    }
    const end = until > yearEnd ? yearEnd : until;
    return a.parentalCapital * rate * Math.max(0, daysBetween(yearStart, end)) / 365;
  };
  const rows = accounts
    .filter(a => a.parentalCapital > 0)
    .map(a => {
      const full = interestUntil(a, yearEnd);
      const atPlanned = interestUntil(a, planned);
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
 * mouvement « part des parents » daté du retrait. Sans ce mouvement, l'app « oubliait »
 * que ce capital avait existé et sous-estimait les intérêts passés.
 */
export const accountsAfterRestitution = <T extends { ownedAmount: number; parentalCapital: number; totalAmount: number; movements?: AccountMovement[] }>(accounts: T[], dateISO?: string): T[] =>
  accounts.map(a => ({
    ...a,
    parentalCapital: 0,
    totalAmount: round2(a.ownedAmount),
    movements: dateISO && a.parentalCapital > 0
      ? [...(a.movements || []), { id: `restitution-${dateISO}-${Math.random().toString(36).slice(2, 8)}`, date: dateISO, amount: round2(a.parentalCapital), label: RESTITUTION_LABEL, type: 'OUT' as const, kind: 'parental' as const, tag: 'restitution' as const }]
      : a.movements,
  }));

/** Comptes d'une répartition personnalisée qui n'existent plus (supprimés depuis). */
export const missingSplitAccounts = (split: SavingsSplit | undefined, accounts: { id: string }[]) =>
  (split || []).filter(s => !accounts.some(a => a.id === s.accountId));
