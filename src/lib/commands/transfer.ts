// Virement interne entre deux de vos comptes : une sortie sur le compte de départ, une entrée
// sur le compte d'arrivée, appariées par `linkId` (supprimées ensemble, voir movements.ts).
// Seule la part propre circule : le capital des parents ne sort jamais par ici.
import type { AccountMovement } from '../../types';
import { applyMovement, canWithdrawOwn, restoreBalances, round2, snapshotBalances } from '../accountOps';
import { formatEUR } from '../format';
import { CommandResult, CommandState, fail } from './types';

export interface LinkedTransferInput {
  sourceId: string;
  destId: string;
  amount: number;
  date: string;
  /** Identifiants imposés (tests) ; par défaut des UUID. */
  ids?: { linkId: string; out: string; in: string };
}

/**
 * Enregistre le virement (montant arrondi au centime, comme les soldes : une saisie « 10,005 »
 * laissait sinon des mouvements dont la somme différait des soldes d'un centime). Les
 * versements cumulés des placements qui les suivent bougent avec (argent réellement déplacé).
 * Annulation exacte : les deux comptes reviennent à leur état d'avant, ce qui a été fait
 * depuis sur ces comptes est gardé.
 */
export const linkedTransfer = (state: CommandState, input: LinkedTransferInput): CommandResult<{ linkId: string; movementIds: [string, string] }> => {
  if (input.sourceId === input.destId) return fail('invalid', 'Source et destination doivent être différentes.');
  const source = state.accounts.find(a => a.id === input.sourceId);
  const dest = state.accounts.find(a => a.id === input.destId);
  if (!source || !dest) return fail('not-found', 'Compte introuvable.');
  const amount = round2(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) return fail('invalid', 'Montant invalide.');
  if (!canWithdrawOwn(source, amount)) {
    return fail('forbidden', `Fonds insuffisants : votre part sur ${source.name} n'est que de ${formatEUR(source.ownedAmount)}.`);
  }
  const ids = input.ids ?? { linkId: crypto.randomUUID(), out: crypto.randomUUID(), in: crypto.randomUUID() };
  const moveOut: AccountMovement = { id: ids.out, date: input.date, amount, label: `Virement vers ${dest.name}`, type: 'OUT', linkId: ids.linkId };
  const moveIn: AccountMovement = { id: ids.in, date: input.date, amount, label: `Virement de ${source.name}`, type: 'IN', linkId: ids.linkId };
  const snap = snapshotBalances(state.accounts, [source.id, dest.id]);
  return {
    ok: true,
    linkId: ids.linkId,
    movementIds: [moveOut.id, moveIn.id],
    next: {
      accounts: state.accounts.map(a => (a.id === source.id ? applyMovement(a, moveOut, 1, { trackDeposits: true })
        : a.id === dest.id ? applyMovement(a, moveIn, 1, { trackDeposits: true }) : a)),
    },
    // Le montant figure dans le message : une faute de frappe se voit (et s'annule) tout de suite.
    message: `Virement de ${formatEUR(amount, 2)} : ${source.name} → ${dest.name}`,
    undo: current => ({ accounts: restoreBalances(current.accounts, snap, [moveOut.id, moveIn.id]) }),
  };
};
