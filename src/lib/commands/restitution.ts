// Restitution du capital des parents (prévue vers le 1er janvier 2027) et son annulation.
// La part des parents sort de chaque compte par un mouvement `parental` étiqueté
// « restitution » ; la part propre ne bouge pas ; un relevé est gardé ; l'app passe en
// mode solo (plus aucune part parentale).
import type { AccountMovement, ParentalRestitution } from '../../types';
import { applyMovement, isRestitutionMovement, restoreBalances, round2, snapshotBalances } from '../accountOps';
import { computeRestitutionPlan, RESTITUTION_LABEL } from '../finance';
import { formatEUR } from '../format';
import { CommandResult, CommandState, fail } from './types';

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Id stable du mouvement de restitution d'un compte (un seul par compte et par date). */
export const restitutionMovementId = (dateISO: string, accountId: string) => `restitution-${dateISO}-${accountId}`;

/**
 * Enregistre la restitution à la date du retrait réel :
 * - chaque compte perd exactement sa part parentale (mouvement « Restitution aux parents ») ;
 * - la part propre et les versements cumulés ne changent pas ;
 * - relevé : capital rendu par compte, intérêts de l'année offerts (seule l'année de la
 *   restitution est chiffrée avec certitude : les années précédentes dépendaient d'une part
 *   parentale qui a pu varier, on ne l'invente pas).
 * Refusée si elle est déjà enregistrée ou s'il n'y a rien à rendre.
 */
export const recordRestitution = (state: CommandState, input: { date: string }): CommandResult<{ total: number }> => {
  const { date } = input;
  if (state.parentalRestitution?.done) return fail('already-done', `La restitution est déjà enregistrée (le ${state.parentalRestitution.done.date}).`);
  if (!ISO_DAY.test(date || '')) return fail('invalid', 'Date de retrait invalide.');
  const plan = computeRestitutionPlan(state.accounts, date);
  if (plan.total <= 0) return fail('nothing-to-do', 'Aucune part parentale à rendre.');

  const previous = state.parentalRestitution;
  const ids = plan.rows.map(r => r.accountId);
  const snap = snapshotBalances(state.accounts, ids);
  const created: string[] = [];
  const accounts = state.accounts.map(a => {
    if (!ids.includes(a.id)) return a;
    const m: AccountMovement = {
      id: restitutionMovementId(date, a.id), date, amount: round2(a.parentalCapital),
      label: RESTITUTION_LABEL, type: 'OUT', kind: 'parental', tag: 'restitution',
    };
    created.push(m.id);
    return applyMovement(a, m, 1);
  });
  const interestsOffered = plan.totalInterest >= 0.5 ? [{ year: plan.interestYear, amount: round2(plan.totalInterest) }] : [];
  const parentalRestitution: ParentalRestitution = {
    ...previous,
    done: { date, accounts: plan.rows.map(r => ({ accountId: r.accountId, name: r.name, amount: r.amount })), interestsOffered },
  };
  return {
    ok: true,
    total: plan.total,
    next: { accounts, parentalRestitution },
    message: `Restitution enregistrée : ${formatEUR(plan.total)}`,
    undo: current => ({ accounts: restoreBalances(current.accounts, snap, created), parentalRestitution: previous }),
  };
};

/**
 * Annulation après coup (depuis l'écran Part parentale) : les mouvements de restitution
 * sont retirés, ce qui rend leur part aux parents ; le relevé est effacé (la date prévue
 * reste).
 */
export const undoRestitution = (state: CommandState): CommandResult => {
  const previous = state.parentalRestitution;
  if (!previous?.done) return fail('nothing-to-do', 'Aucune restitution à annuler.');
  const touched = state.accounts.filter(a => (a.movements || []).some(isRestitutionMovement)).map(a => a.id);
  const snap = snapshotBalances(state.accounts, touched);
  const accounts = state.accounts.map(a => (a.movements || [])
    .filter(isRestitutionMovement)
    .reduce((cur, m) => applyMovement(cur, m, -1), a));
  const { done: _done, ...rest } = previous;
  return {
    ok: true,
    next: { accounts, parentalRestitution: rest },
    message: 'Restitution annulée : la part de vos parents est rétablie',
    undo: current => ({ accounts: restoreBalances(current.accounts, snap), parentalRestitution: previous }),
  };
};
