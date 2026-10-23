// Modifications sans effet sur les soldes, autrefois écrites dans l'interface : libellé d'un
// mouvement, marque « ajustement », annulation d'un changement de taux des livrets.
import type { SavingsAccount } from '../../types';
import { isRestitutionMovement } from '../accountOps';
import { REGULATED_RATE_GROUPS } from '../finance';
import { CommandResult, CommandState, fail } from './types';

/**
 * Renomme un mouvement. Le libellé d'une restitution aux parents ne change pas (il sert à la
 * reconnaître) ; un libellé vide est ignoré. Renvoie la même liste quand rien ne change.
 */
export const renameMovement = (accounts: SavingsAccount[], accountId: string, movementId: string, label: string): SavingsAccount[] => {
  const movement = accounts.find(a => a.id === accountId)?.movements?.find(m => m.id === movementId);
  if (!label || !movement || isRestitutionMovement(movement)) return accounts;
  return accounts.map(acc => (acc.id !== accountId ? acc : {
    ...acc, movements: acc.movements?.map(m => (m.id === movementId ? { ...m, label } : m)),
  }));
};

/** Marque (ou démarque) un mouvement comme ajustement : il ne compte plus comme épargne. */
export const toggleMovementAdjustment = (accounts: SavingsAccount[], accountId: string, movementId: string): SavingsAccount[] =>
  accounts.map(a => (a.id !== accountId ? a : {
    ...a,
    movements: (a.movements || []).map(m => (m.id !== movementId ? m : m.kind === 'adjustment' ? { ...m, kind: undefined } : { ...m, kind: 'adjustment' as const })),
  }));

/**
 * Annule un changement de taux (entrée `entryDate` de l'historique des taux) sur TOUT le
 * groupe changé ensemble (Livret A et LDDS) : le taux d'avant revient, l'entrée disparaît, et
 * le rappel de révision reprend si la révision datait de ce changement ou d'après.
 * « Rétablir » remet exactement les taux, historiques et révisions d'avant l'annulation.
 */
export const revertRateChange = (state: CommandState, req: { accountId: string; entryDate: string }): CommandResult<{ count: number }> => {
  const source = state.accounts.find(a => a.id === req.accountId);
  if (!source) return fail('not-found', 'Compte introuvable.');
  const group = REGULATED_RATE_GROUPS.find(g => g.types.includes(source.type));
  const ids = state.accounts
    .filter(a => a.id === req.accountId || (!!group && group.types.includes(a.type) && (a.rateHistory || []).some(h => h.date === req.entryDate)))
    .map(a => a.id);
  const before = state.accounts
    .filter(a => ids.includes(a.id))
    .map(a => ({ id: a.id, interestRate: a.interestRate, rateHistory: a.rateHistory, rateReviewedAt: a.rateReviewedAt }));
  const accounts = state.accounts.map(a => {
    if (!ids.includes(a.id)) return a;
    const entry = (a.rateHistory || []).find(h => h.date === req.entryDate);
    if (!entry) return a;
    const rest = (a.rateHistory || []).filter(h => h !== entry);
    return {
      ...a, interestRate: entry.rate, rateHistory: rest.length > 0 ? rest : undefined,
      rateReviewedAt: a.rateReviewedAt && a.rateReviewedAt >= req.entryDate ? undefined : a.rateReviewedAt,
    };
  });
  return {
    ok: true,
    next: { accounts },
    count: ids.length,
    message: ids.length > 1 ? `Changement de taux annulé (${ids.length} comptes)` : 'Changement de taux annulé',
    undo: current => ({
      accounts: current.accounts.map(a => {
        const b = before.find(x => x.id === a.id);
        return b ? { ...a, interestRate: b.interestRate, rateHistory: b.rateHistory, rateReviewedAt: b.rateReviewedAt } : a;
      }),
    }),
  };
};
