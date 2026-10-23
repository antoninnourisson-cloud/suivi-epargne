// « Lire un relevé » : opérations et nouveaux soldes d'un relevé bancaire, relus et validés
// par l'utilisateur (voir lib/statementImport), enregistrés en une fois sur un ou plusieurs
// comptes :
// - chaque opération cochée devient un mouvement de VOTRE part (versement ou retrait ; les
//   intérêts crédités sont hors épargne, `adjustment`, comme dans Actualiser) ;
// - le nouveau solde du relevé (total du compte) fixe votre part = total − part des parents ;
//   l'écart restant est enregistré comme dans Actualiser (« Actualisation », ou
//   « Valorisation » pour un placement qui suit ses versements).
// La part des parents ne bouge jamais : un retrait qui l'entamerait, ou un nouveau solde
// inférieur à elle, est refusé. Le solde d'un relevé plus ancien que le compte n'est repris
// que sur choix explicite (`allowOlder`). Tout ou rien, avec annulation exacte.
import type { AccountMovement, SavingsAccount } from '../../types';
import { applyMovement, canWithdrawOwn, restoreBalances, round2, snapshotBalances } from '../accountOps';
import { formatEUR } from '../format';
import { EPS } from '../money';
import { isISODay, olderThanBalance } from '../statementImport';
import { laterDay } from './accounts';
import { planBalanceUpdate } from './balances';
import { CommandResult, CommandState, fail } from './types';

export interface StatementImportMovement {
  date: string;
  label: string;
  /** Montant positif. */
  amount: number;
  type: 'IN' | 'OUT';
  /** Intérêts crédités : hors épargne. */
  interest?: boolean;
}

export interface StatementImportItem {
  accountId: string;
  /** Date du nouveau solde, AAAA-MM-JJ. */
  date: string;
  /** Solde total affiché par la banque ; absent = seules les opérations sont ajoutées. */
  closingBalance?: number;
  /**
   * Solde plus ancien que celui du compte (dernier solde vérifié, ou mouvement enregistré
   * après `date`) repris quand même : choix explicite à la relecture. Sans lui, un tel solde
   * qui changerait le compte est refusé (il le ramènerait en arrière).
   */
  allowOlder?: boolean;
  movements: StatementImportMovement[];
}

const frDay = (iso: string) => iso.split('-').reverse().join('/');

/** Compte après l'import, mouvements créés ; ou message d'erreur ; `null` si rien ne change. */
const planItem = (acc: SavingsAccount, item: StatementImportItem): { account: SavingsAccount; created: string[] } | { error: string; code: 'invalid' | 'forbidden' } | null => {
  const name = acc.name;
  if (!isISODay(item.date)) return { code: 'invalid', error: `${name} : date du relevé invalide.` };
  // Ordre du relevé ; le même jour, les entrées d'abord (un virement reçu puis dépensé).
  const moves = [...item.movements].sort((a, b) => a.date.localeCompare(b.date) || (a.type === b.type ? 0 : a.type === 'IN' ? -1 : 1));
  let current = acc;
  const created: string[] = [];
  for (const m of moves) {
    const amount = round2(m.amount);
    if (!isISODay(m.date) || !Number.isFinite(amount) || amount <= 0) return { code: 'invalid', error: `${name} : opération illisible (« ${m.label} »).` };
    if (m.type === 'OUT' && !canWithdrawOwn(current, amount)) {
      return { code: 'forbidden', error: `${name} : le retrait « ${m.label} » du ${frDay(m.date)} (${formatEUR(amount, 2)}) dépasserait votre part. La part de vos parents ne peut pas être retirée : vérifiez le compte choisi.` };
    }
    const movement: AccountMovement = {
      id: crypto.randomUUID(), date: m.date, amount, label: m.label.trim() || 'Opération', type: m.type,
      ...(m.interest && m.type === 'IN' ? { kind: 'adjustment' as const } : {}),
    };
    current = applyMovement(current, movement, 1, { trackDeposits: true });
    created.push(movement.id);
  }
  if (item.closingBalance !== undefined) {
    const total = round2(item.closingBalance);
    if (!Number.isFinite(total)) return { code: 'invalid', error: `${name} : solde du relevé illisible.` };
    // Relevé plus ancien que le compte (comparé AVANT l'import) : son solde effacerait ce qui
    // a bougé depuis, par une fausse « Actualisation » datée dans le passé.
    const older = item.allowOlder ? null : olderThanBalance(acc, item.date);
    if (older && Math.abs(total - current.totalAmount) > EPS) {
      return {
        code: 'invalid',
        error: older.reason === 'checked'
          ? `${name} : ce relevé (${frDay(item.date)}) est plus ancien que votre dernier solde vérifié (${frDay(older.since)}) : son solde n'est pas repris.`
          : `${name} : ce relevé (${frDay(item.date)}) est plus ancien qu'un mouvement déjà enregistré (${frDay(older.since)}) : son solde n'est pas repris.`,
      };
    }
    if (total < current.parentalCapital - EPS) {
      return {
        code: 'forbidden',
        error: current.parentalCapital > 0
          ? `${name} : le solde du relevé (${formatEUR(total, 2)}) est inférieur à la part de vos parents (${formatEUR(current.parentalCapital, 2)}). Elle ne peut pas être retirée : vérifiez le compte choisi.`
          : `${name} : le solde du relevé est négatif (${formatEUR(total, 2)}) : il ne peut pas être enregistré.`,
      };
    }
    // Même calcul qu'Actualiser : écart restant ventilé, date du constat posée.
    const plan = planBalanceUpdate(current, {
      accountId: acc.id, date: item.date, owned: Math.max(0, round2(total - current.parentalCapital)), parental: current.parentalCapital,
      deposits: current.totalDeposits, cashFlow: 0,
    });
    if (plan && 'error' in plan) return { code: 'invalid', error: plan.error };
    if (plan) { current = plan.account; created.push(...plan.created.map(m => m.id)); }
    // Solde identique : seule la date du constat avance (jamais reculée par un relevé plus ancien).
    else if (laterDay(current.balanceCheckedAt, item.date) !== current.balanceCheckedAt) current = { ...current, balanceCheckedAt: item.date };
  }
  if (current === acc) return null;
  return { account: current, created };
};

/**
 * Enregistre un relevé validé. Refus global si un seul compte est refusé (rien n'est
 * enregistré à moitié) ; un compte disparu entre-temps est ignoré.
 */
export const importStatement = (state: CommandState, input: { items: StatementImportItem[] }): CommandResult<{ changedIds: string[]; createdIds: string[]; added: number }> => {
  const planned = new Map<string, SavingsAccount>();
  const createdIds: string[] = [];
  let added = 0;
  for (const item of input.items) {
    const acc = state.accounts.find(a => a.id === item.accountId);
    if (!acc || planned.has(acc.id)) continue;
    const p = planItem(acc, item);
    if (!p) continue;
    if ('error' in p) return fail(p.code, p.error);
    planned.set(acc.id, p.account);
    createdIds.push(...p.created);
    added += item.movements.length;
  }
  if (planned.size === 0) return fail('nothing-to-do', 'Rien à importer.');
  const changedIds = [...planned.keys()];
  const snap = snapshotBalances(state.accounts, changedIds);
  const checkedBefore = new Map(state.accounts.filter(a => planned.has(a.id)).map(a => [a.id, a.balanceCheckedAt]));
  const only = planned.size === 1 ? [...planned.values()][0] : undefined;
  const ops = added > 0 ? ` (${added} opération${added > 1 ? 's' : ''} ajoutée${added > 1 ? 's' : ''})` : '';
  return {
    ok: true,
    changedIds,
    createdIds,
    added,
    next: { accounts: state.accounts.map(a => planned.get(a.id) ?? a) },
    message: `${only ? `${only.name} mis à jour` : `${planned.size} comptes mis à jour`} d'après le relevé${ops}`,
    // Soldes exacts d'avant, mouvements créés retirés, date du dernier constat d'avant ; ce
    // qui a été fait depuis sur ces comptes est conservé (voir restoreBalances).
    undo: current => {
      const restored = restoreBalances(current.accounts, snap, createdIds);
      if (restored === current.accounts) return { accounts: restored };
      return {
        accounts: restored.map(a => {
          if (!checkedBefore.has(a.id)) return a;
          const { balanceCheckedAt: _after, ...rest } = a;
          const before = checkedBefore.get(a.id);
          return before ? { ...rest, balanceCheckedAt: before } : rest;
        }),
      };
    },
  };
};
