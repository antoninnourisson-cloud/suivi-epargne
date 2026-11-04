// « J'ai besoin d'argent » enregistré en une fois (lib/needMoney) : pour chaque ligne, un
// virement du compte d'épargne vers le compte courant (la commande linkedTransfer, enchaînée),
// ou un simple retrait s'il n'y a pas de compte courant. Votre part seulement (les commandes
// enchaînées refusent d'entamer la part des parents) ; un seul « Annuler » remet tout.
import type { PlannedWithdrawalLine } from '../../types';
import { restoreBalances, snapshotBalances } from '../accountOps';
import { elideLe, formatEUR } from '../format';
import { linkedTransfer } from './transfer';
import { quickAdd } from './quickAdd';
import { CommandResult, CommandState, fail } from './types';

export interface NeedWithdrawalInput {
  lines: PlannedWithdrawalLine[];
  /** Compte courant d'arrivée ; absent : un simple retrait sur chaque compte. */
  destId?: string;
  date: string;
}

export const recordNeedWithdrawal = (state: CommandState, input: NeedWithdrawalInput): CommandResult<{ movementIds: string[] }> => {
  const lines = input.lines.filter(l => l.amount > 0);
  if (lines.length === 0) return fail('nothing-to-do', 'Aucun montant à retirer.');
  if (input.destId && lines.some(l => l.accountId === input.destId)) return fail('invalid', 'Le compte courant ne peut pas être aussi le compte où puiser.');
  const touched = [...new Set([...lines.map(l => l.accountId), ...(input.destId ? [input.destId] : [])])];
  const snap = snapshotBalances(state.accounts, touched);
  let accounts = state.accounts;
  const created: string[] = [];
  for (const l of lines) {
    const step = { ...state, accounts };
    if (input.destId) {
      const r = linkedTransfer(step, { sourceId: l.accountId, destId: input.destId, amount: l.amount, date: input.date });
      if (!r.ok) return r;
      accounts = r.next.accounts!;
      created.push(...r.movementIds);
    } else {
      const r = quickAdd(step, { accountId: l.accountId, amount: l.amount, type: 'OUT', label: 'Retrait', date: input.date });
      if (!r.ok) return r;
      accounts = r.next.accounts!;
      created.push(r.movementId);
    }
  }
  const total = lines.reduce((s, l) => s + l.amount, 0);
  const dest = input.destId ? state.accounts.find(a => a.id === input.destId) : undefined;
  const one = lines.length === 1 ? state.accounts.find(a => a.id === lines[0].accountId) : undefined;
  // Le montant figure dans le message : une faute de frappe se voit (et s'annule) tout de suite.
  const message = (one ? `Retrait de ${formatEUR(total)} sur ${elideLe(one.name)}` : `${lines.length} retraits, ${formatEUR(total)} au total`)
    + (dest ? `, viré sur ${dest.name}` : '');
  return {
    ok: true,
    movementIds: created,
    next: { accounts },
    message,
    undo: current => ({ accounts: restoreBalances(current.accounts, snap, created) }),
  };
};
