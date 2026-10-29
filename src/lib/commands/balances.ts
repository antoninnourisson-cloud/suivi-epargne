// « Actualiser les soldes » : nouveaux soldes constatés sur un ou plusieurs comptes, ventilés
// en mouvements de la bonne nature :
// - intérêts crédités → `adjustment` (comptent dans les soldes, jamais comme épargne) ;
// - placement qui suit ses versements (PEA, AV…) → argent versé/retiré (épargne) et
//   variation de valeur (`valuation`) ;
// - reste de la hausse d'un livret ou d'un compte → versement/retrait (épargne) ;
// - part des parents → `parental`.
// Saisie illisible = refus (jamais 0), montants arrondis au centime, part propre ≥ 0.
import type { AccountMovement, SavingsAccount } from '../../types';
import { restoreBalances, round2, snapshotBalances } from '../accountOps';
import { depositsAfterCashFlow, tracksDeposits } from '../finance';
import { formatEUR } from '../format';
import { EPS } from '../money';
import { CommandResult, CommandState, fail } from './types';
import { laterDay } from './accounts';

export interface BalanceUpdate {
  accountId: string;
  /** Date du relevé, 'YYYY-MM-DD'. */
  date: string;
  /** Nouvelle part propre et nouvelle part des parents, déjà lues (`null` = saisie illisible). */
  owned: number | null;
  parental: number | null;
  /**
   * Placements suivis seulement (ignoré ailleurs) : versements cumulés saisis
   * (`undefined` = inconnus, `null` = illisibles). Inchangés + `cashFlow` : mis à jour d'après lui.
   */
  deposits?: number | null;
  /** Part de la hausse de VOTRE part qui est des intérêts crédités (hors épargne). */
  interest?: number;
  /** Libellé du mouvement d'intérêts (« Intérêts 2026 »). */
  interestLabel?: string;
  /**
   * Date du mouvement d'intérêts quand elle diffère du relevé : les intérêts d'une année,
   * crédités au 31 décembre et vus en janvier, sont datés `AAAA-12-31` (sinon ils tombaient
   * dans l'année suivante : patrimoine de fin d'année et « Votre année » sous-estimés).
   * Jamais après la date du relevé.
   */
  interestDate?: string;
  /** Placements suivis : argent réellement versé (+) ou retiré (−) ; le reste de l'écart est une valorisation. */
  cashFlow?: number;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Nouveau compte et mouvements créés, ou message d'erreur ; `null` si rien ne change. */
export const planBalanceUpdate = (acc: SavingsAccount, u: BalanceUpdate): { account: SavingsAccount; created: AccountMovement[] } | { error: string } | null => {
  const name = acc.name;
  if (u.owned === null || u.parental === null || !Number.isFinite(u.owned) || !Number.isFinite(u.parental)) return { error: `${name} : montant illisible.` };
  const owned = round2(u.owned);
  const parental = round2(u.parental);
  if (owned < 0) return { error: `${name} : votre part ne peut pas être négative.` };
  if (parental < 0) return { error: `${name} : la part des parents ne peut pas être négative.` };
  if (!ISO_DAY.test(u.date)) return { error: `${name} : date du relevé invalide.` };
  const tracked = tracksDeposits(acc.type);
  if (tracked && (u.deposits === null || (u.deposits !== undefined && !(Number.isFinite(u.deposits) && u.deposits >= 0)))) {
    return { error: `${name} : versements cumulés illisibles.` };
  }
  const ownDiff = round2(owned - acc.ownedAmount);
  const interest = round2(Math.max(0, u.interest ?? 0));
  if (!Number.isFinite(interest)) return { error: `${name} : intérêts illisibles.` };
  if (interest > Math.max(0, ownDiff) + EPS) {
    return { error: `${name} : les intérêts (${formatEUR(interest, 2)}) dépassent la hausse de votre part (${formatEUR(Math.max(0, ownDiff), 2)}).` };
  }
  const cash = tracked ? round2(u.cashFlow ?? 0) : 0;
  if (!Number.isFinite(cash)) return { error: `${name} : versement illisible.` };
  if (cash < 0 && -cash > acc.ownedAmount + EPS) return { error: `${name} : retrait supérieur à votre part (${formatEUR(acc.ownedAmount, 2)}).` };

  const created: AccountMovement[] = [];
  const push = (amount: number, label: string, kind?: AccountMovement['kind'], signed = true, date = u.date) => {
    const a = round2(amount);
    if (Math.abs(a) <= 0.001) return;
    created.push({
      id: crypto.randomUUID(), date, amount: Math.abs(a), type: a > 0 ? 'IN' : 'OUT',
      label: signed ? `${label} (${a > 0 ? '+' : '-'})` : label, ...(kind ? { kind } : {}),
    });
  };
  const interestDate = u.interestDate && ISO_DAY.test(u.interestDate) && u.interestDate < u.date ? u.interestDate : u.date;
  push(interest, u.interestLabel?.trim() || 'Intérêts', 'adjustment', false, interestDate);
  if (tracked) {
    push(cash, cash > 0 ? 'Versement' : 'Retrait');
    push(ownDiff - interest - cash, 'Valorisation', 'valuation');
  } else {
    push(ownDiff - interest, 'Actualisation');
  }
  push(parental - acc.parentalCapital, 'Part des parents', 'parental');

  let totalDeposits = acc.totalDeposits;
  if (tracked) {
    const typed = u.deposits ?? undefined;
    if (typed === undefined) totalDeposits = undefined;
    else if (acc.totalDeposits === undefined || Math.abs(typed - acc.totalDeposits) > EPS) totalDeposits = round2(typed);
    else if (cash !== 0) totalDeposits = depositsAfterCashFlow(acc, cash);
  }
  if (created.length === 0 && totalDeposits === acc.totalDeposits) return null;
  return {
    account: {
      ...acc, ownedAmount: owned, parentalCapital: parental, totalAmount: round2(owned + parental), totalDeposits,
      // Solde constaté à la date du relevé (jamais reculée par un relevé plus ancien).
      balanceCheckedAt: laterDay(acc.balanceCheckedAt, u.date),
      movements: [...acc.movements, ...created],
    },
    created,
  };
};

/**
 * Enregistre les nouveaux soldes. Refus global si une seule saisie est invalide (rien n'est
 * enregistré à moitié). Un compte disparu entre-temps est ignoré.
 */
export const updateBalances = (state: CommandState, input: { updates: BalanceUpdate[] }): CommandResult<{ changedIds: string[]; createdIds: string[] }> => {
  const planned = new Map<string, SavingsAccount>();
  const createdIds: string[] = [];
  for (const u of input.updates) {
    const acc = state.accounts.find(a => a.id === u.accountId);
    if (!acc) continue;
    const p = planBalanceUpdate(acc, u);
    if (!p) continue;
    if ('error' in p) return fail('invalid', p.error);
    planned.set(acc.id, p.account);
    createdIds.push(...p.created.map(m => m.id));
  }
  if (planned.size === 0) return fail('nothing-to-do', 'Aucun solde modifié.');
  const changedIds = [...planned.keys()];
  const snap = snapshotBalances(state.accounts, changedIds);
  const checkedBefore = new Map(state.accounts.filter(a => planned.has(a.id)).map(a => [a.id, a.balanceCheckedAt]));
  const only = planned.size === 1 ? [...planned.values()][0] : undefined;
  return {
    ok: true,
    changedIds,
    createdIds,
    next: { accounts: state.accounts.map(a => planned.get(a.id) ?? a) },
    message: only ? `${only.name} actualisé` : `${planned.size} comptes actualisés`,
    // Soldes exacts d'avant, et la date du dernier constat d'avant.
    undo: current => {
      const restored = restoreBalances(current.accounts, snap, createdIds);
      // Annulation refusée (part propre qui deviendrait négative) : rien ne change.
      if (restored === current.accounts) return { accounts: restored };
      return {
        accounts: restored.map(a => {
          if (!checkedBefore.has(a.id)) return a;
          const { balanceCheckedAt: _now, ...rest } = a;
          const before = checkedBefore.get(a.id);
          return before ? { ...rest, balanceCheckedAt: before } : rest;
        }),
      };
    },
  };
};
