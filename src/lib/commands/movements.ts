// Suppression et annulation de mouvements : le solde est recalculé par applyMovement et
// l'annulation rend l'état EXACT d'avant (instantané), y compris quand la part des parents
// avait été plafonnée à 0 pendant la suppression.
import type { AccountMovement, SavingsAccount } from '../../types';
import { applyMovement, CancellingGroup, isRestitutionMovement, restoreBalances, snapshotBalances } from '../accountOps';
import { EPS, signedAmount } from '../money';
import { CommandResult, CommandState, fail } from './types';

export type MovementLeg = { accountId: string; movement: AccountMovement };

/**
 * Toutes les lignes qu'une suppression retire : un virement interne en compte deux (le OUT
 * côté source et le IN côté destination, appariés par `linkId`). Vide si le mouvement
 * n'existe plus.
 */
const collectMovementLegs = (accounts: SavingsAccount[], accountId: string, movementId: string): MovementLeg[] => {
  const movement = accounts.find(a => a.id === accountId)?.movements?.find(m => m.id === movementId);
  if (!movement) return [];
  if (!movement.linkId) return [{ accountId, movement }];
  const legs: MovementLeg[] = [];
  accounts.forEach(acc => (acc.movements || []).forEach(m => {
    if (m.linkId === movement.linkId) legs.push({ accountId: acc.id, movement: m });
  }));
  return legs;
};

const RESTITUTION_DELETE_ERROR = 'La restitution s\'annule depuis Part parentale.';

/**
 * Ce que la suppression d'un mouvement retirerait, pour la confirmation : refus si le
 * mouvement a disparu ou si c'est une restitution (elle s'annule depuis Part parentale).
 */
export const planMovementDeletion = (accounts: SavingsAccount[], accountId: string, movementId: string):
  { ok: true; movement: AccountMovement; legs: MovementLeg[]; isTransfer: boolean } | { ok: false; code: 'not-found' | 'forbidden'; error: string } => {
  const movement = accounts.find(a => a.id === accountId)?.movements?.find(m => m.id === movementId);
  if (!movement) return { ok: false, code: 'not-found', error: 'Mouvement introuvable.' };
  const legs = collectMovementLegs(accounts, accountId, movementId);
  if (legs.some(l => isRestitutionMovement(l.movement))) return { ok: false, code: 'forbidden', error: RESTITUTION_DELETE_ERROR };
  return { ok: true, movement, legs, isTransfer: legs.length > 1 };
};

const removeLegs = (state: CommandState, legs: MovementLeg[], opts: { trackDeposits?: boolean } = {}) => {
  const ids = [...new Set(legs.map(l => l.accountId))];
  const snap = snapshotBalances(state.accounts, ids);
  const accounts = state.accounts.map(acc => legs
    .filter(l => l.accountId === acc.id)
    .reduce((cur, l) => applyMovement(cur, l.movement, -1, opts), acc));
  return { accounts, undo: (current: CommandState) => ({ accounts: restoreBalances(current.accounts, snap) }) };
};

/** Supprime un mouvement (et l'autre moitié d'un virement interne) depuis le journal ou la fiche du compte. */
export const deleteMovement = (state: CommandState, input: { accountId: string; movementId: string }): CommandResult<{ removed: number }> => {
  const plan = planMovementDeletion(state.accounts, input.accountId, input.movementId);
  if (!plan.ok) return fail(plan.code, plan.error);
  const { accounts, undo } = removeLegs(state, plan.legs);
  return {
    ok: true,
    removed: plan.legs.length,
    next: { accounts },
    message: plan.isTransfer ? `Virement supprimé (${plan.legs.length} lignes)` : 'Mouvement supprimé',
    undo,
  };
};

/**
 * Annule un versement enregistré depuis la liste des virements de paie : retire le
 * mouvement et rétablit solde ET versements cumulés.
 */
export const cancelDeposit = (state: CommandState, input: { accountId: string; movementId: string }): CommandResult => {
  const movement = state.accounts.find(a => a.id === input.accountId)?.movements?.find(m => m.id === input.movementId);
  if (!movement) return fail('not-found', 'Versement introuvable.');
  if (isRestitutionMovement(movement)) return fail('forbidden', RESTITUTION_DELETE_ERROR);
  const { accounts, undo } = removeLegs(state, [{ accountId: input.accountId, movement }], { trackDeposits: true });
  return { ok: true, next: { accounts }, message: 'Versement annulé', undo };
};

/**
 * Nettoyage des mouvements qui s'annulent (voir findCancellingGroups) : leur somme est
 * nulle, ils sont retirés de l'historique sans toucher aux soldes.
 */
export const removeCancellingMovements = (state: CommandState, groups: CancellingGroup[]): CommandResult<{ removed: number }> => {
  const ids = new Set(groups.flatMap(g => g.movements.map(m => m.id)));
  if (ids.size === 0) return fail('nothing-to-do', 'Aucun mouvement à supprimer.');
  // Garde-fou : on ne retire sans recalcul que ce qui, compte par compte, s'annule vraiment
  // (et uniquement sur la part propre).
  for (const a of state.accounts) {
    const removed = (a.movements || []).filter(m => ids.has(m.id));
    if (removed.some(m => m.kind === 'parental' || isRestitutionMovement(m))) return fail('forbidden', 'Ces mouvements touchent la part des parents.');
    if (Math.abs(removed.reduce((s, m) => s + signedAmount(m), 0)) >= EPS) return fail('invalid', 'Ces mouvements ne s\'annulent pas : les soldes changeraient.');
  }
  const snap = snapshotBalances(state.accounts, [...new Set(groups.map(g => g.accountId))]);
  return {
    ok: true,
    removed: ids.size,
    next: { accounts: state.accounts.map(a => ({ ...a, movements: (a.movements || []).filter(m => !ids.has(m.id)) })) },
    message: `${ids.size} mouvements supprimés (soldes inchangés)`,
    undo: current => ({ accounts: restoreBalances(current.accounts, snap) }),
  };
};
