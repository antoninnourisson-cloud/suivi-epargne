// Ajout rapide d'un versement ou d'un retrait sur la part propre (bouton +, virements de
// paie, mouvements récurrents).
import type { AccountMovement } from '../../types';
import { applyMovement, canWithdrawOwn, restoreBalances, round2, snapshotBalances } from '../accountOps';
import { formatEUR } from '../format';
import { CommandResult, CommandState, fail } from './types';

export interface QuickAddInput {
  accountId: string;
  amount: number;
  type: 'IN' | 'OUT';
  label: string;
  date: string;
  /** Id du mouvement créé (par défaut un UUID). */
  id?: string;
}

/**
 * Enregistre le mouvement (arrondi au centime) et met à jour les versements cumulés d'un
 * placement. Refuse un retrait supérieur à la part propre : le capital des parents ne sort
 * jamais par ici.
 */
export const quickAdd = (state: CommandState, input: QuickAddInput): CommandResult<{ movementId: string }> => {
  const account = state.accounts.find(a => a.id === input.accountId);
  if (!account) return fail('not-found', 'Compte introuvable.');
  const amount = round2(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) return fail('invalid', 'Montant invalide.');
  if (input.type === 'OUT' && !canWithdrawOwn(account, amount)) {
    return fail('forbidden', `Retrait impossible : votre part sur ${account.name} n'est que de ${formatEUR(account.ownedAmount)}.`);
  }
  const movement: AccountMovement = { id: input.id ?? crypto.randomUUID(), date: input.date, amount, label: input.label, type: input.type };
  const snap = snapshotBalances(state.accounts, [account.id]);
  return {
    ok: true,
    movementId: movement.id,
    next: { accounts: state.accounts.map(a => (a.id === account.id ? applyMovement(a, movement, 1, { trackDeposits: true }) : a)) },
    message: `${input.label} — ${account.name}`,
    undo: current => ({ accounts: restoreBalances(current.accounts, snap, [movement.id]) }),
  };
};
