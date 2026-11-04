// « Les taux ont changé » appliqué en une fois (lib/rateChanges) : les taux réglementés relevés
// par la veille, sur tous les comptes du groupe (le LDDS avec le Livret A, REGULATED_RATE_GROUPS),
// et les taux corrigés des autres comptes (livrets bancaires, assurance vie), chacun daté
// (applyRateChange : l'ancien taux court jusqu'à la date d'effet). Un compte des autres comptes
// dont le taux ne change pas est laissé tel quel. Un seul « Annuler » remet tout.
import type { SavingsAccount } from '../../types';
import { REGULATED_RATE_GROUPS, applyRateChange } from '../finance';
import { elideDu, formatRate } from '../format';
import { CommandResult, CommandState, fail } from './types';

export interface RateChangesInput {
  /** Taux réglementés : un par groupe (clé de REGULATED_RATE_GROUPS). */
  groups: { key: string; rate: number; date: string }[];
  /** Autres comptes : appliqué seulement si le taux diffère du taux actuel. */
  accounts: { accountId: string; rate: number; date: string }[];
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RATE = 20;
const validRate = (r: number) => Number.isFinite(r) && r >= 0 && r <= MAX_RATE;
const sameRate = (a: number, b: number) => Math.abs(a - b) < 1e-9;

export const applyRateChanges = (state: CommandState, input: RateChangesInput): CommandResult<{ accountIds: string[] }> => {
  const all = [...input.groups, ...input.accounts];
  if (all.some(c => !validRate(c.rate))) return fail('invalid', `Un taux doit être compris entre 0 et ${MAX_RATE} %.`);
  if (all.some(c => !ISO_DAY.test(c.date))) return fail('invalid', 'Date d\'effet illisible.');

  // Compte → nouveau taux daté.
  const changes = new Map<string, { rate: number; date: string }>();
  for (const g of input.groups) {
    const group = REGULATED_RATE_GROUPS.find(x => x.key === g.key);
    if (!group) return fail('invalid', 'Groupe de livrets inconnu.');
    for (const a of state.accounts) if (group.types.includes(a.type)) changes.set(a.id, { rate: g.rate, date: g.date });
  }
  for (const c of input.accounts) {
    const a = state.accounts.find(x => x.id === c.accountId);
    if (!a || changes.has(a.id) || sameRate(a.interestRate || 0, c.rate)) continue;
    changes.set(a.id, { rate: c.rate, date: c.date });
  }
  if (changes.size === 0) return fail('nothing-to-do', 'Aucun taux à changer.');

  const ids = [...changes.keys()];
  const before = state.accounts
    .filter(a => changes.has(a.id))
    .map(a => ({ id: a.id, interestRate: a.interestRate, rateHistory: a.rateHistory, rateReviewedAt: a.rateReviewedAt }));
  const accounts: SavingsAccount[] = state.accounts.map(a => {
    const c = changes.get(a.id);
    return c ? applyRateChange(a, c.rate, c.date) : a;
  });
  const first = state.accounts.find(a => a.id === ids[0])!;
  const message = ids.length === 1
    ? `Taux ${elideDu(first.name)} : ${formatRate(changes.get(first.id)!.rate)}`
    : `Taux mis à jour sur ${ids.length} comptes`;
  return {
    ok: true,
    next: { accounts },
    accountIds: ids,
    message,
    undo: current => ({
      accounts: current.accounts.map(a => {
        const b = before.find(x => x.id === a.id);
        return b ? { ...a, interestRate: b.interestRate, rateHistory: b.rateHistory, rateReviewedAt: b.rateReviewedAt } : a;
      }),
    }),
  };
};
