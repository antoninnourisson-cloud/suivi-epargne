// Création, modification et suppression d'un compte depuis sa fiche.
import type { SavingsAccount } from '../../types';
import { balanceChangeMovements, restoreBalances, round2, snapshotBalances } from '../accountOps';
import { CommandResult, CommandState, fail } from './types';

/**
 * Enregistre la fiche d'un compte :
 * - total recalculé : il vaut TOUJOURS part propre + part des parents (le formulaire
 *   pouvait le rompre, et la première opération suivante faisait alors bondir le solde) ;
 * - nouveau compte : un mouvement « Solde initial » pour la part propre ;
 * - compte existant : les mêmes mouvements que « Actualiser » (correction de votre part,
 *   part des parents à part), sinon l'historique ne totalise plus le solde. Le compte
 *   reste à sa place dans la liste.
 */
export const saveAccount = (state: CommandState, input: { account: SavingsAccount; today: string }): CommandResult<{ isNew: boolean }> => {
  const { account: acc, today } = input;
  const owned = Number.isFinite(acc.ownedAmount) ? round2(acc.ownedAmount) : 0;
  const parental = Number.isFinite(acc.parentalCapital) ? round2(acc.parentalCapital) : 0;
  if (parental < 0) return fail('invalid', 'La part des parents ne peut pas être négative.');
  const normalized: SavingsAccount = { ...acc, ownedAmount: owned, parentalCapital: parental, totalAmount: round2(owned + parental) };

  const existing = state.accounts.find(a => a.id === normalized.id);
  if (!existing) {
    const withInitial: SavingsAccount = normalized.ownedAmount > 0
      ? { ...normalized, movements: [{ id: crypto.randomUUID(), date: today, amount: normalized.ownedAmount, label: 'Solde initial', type: 'IN', tag: 'initial' }] }
      : normalized;
    return {
      ok: true, isNew: true,
      next: { accounts: [...state.accounts, withInitial] },
      message: `« ${normalized.name} » ajouté`,
      undo: current => ({ accounts: current.accounts.filter(a => a.id !== normalized.id) }),
    };
  }
  const added = balanceChangeMovements(existing, normalized, today, { ownLabel: 'Correction de solde' });
  const snap = snapshotBalances(state.accounts, [existing.id]);
  return {
    ok: true, isNew: false,
    next: { accounts: state.accounts.map(a => (a.id === existing.id ? { ...normalized, movements: [...(a.movements || []), ...added] } : a)) },
    message: `« ${normalized.name} » enregistré`,
    // La fiche d'avant (nom, taux…) puis ses soldes exacts ; les mouvements ajoutés depuis sont rejoués.
    undo: current => ({
      accounts: restoreBalances(
        current.accounts.map(a => (a.id === existing.id ? { ...existing, movements: a.movements } : a)),
        snap, added.map(m => m.id),
      ),
    }),
  };
};

/** Supprime un compte ; l'annulation le remet à sa place d'origine (pas en fin de liste). */
export const deleteAccount = (state: CommandState, input: { accountId: string }): CommandResult => {
  const index = state.accounts.findIndex(a => a.id === input.accountId);
  if (index < 0) return fail('not-found', 'Compte introuvable.');
  const removed = state.accounts[index];
  return {
    ok: true,
    next: { accounts: state.accounts.filter(a => a.id !== removed.id) },
    message: `« ${removed.name} » supprimé`,
    undo: current => {
      if (current.accounts.some(a => a.id === removed.id)) return {};
      const accounts = [...current.accounts];
      accounts.splice(Math.min(index, accounts.length), 0, removed);
      return { accounts };
    },
  };
};
