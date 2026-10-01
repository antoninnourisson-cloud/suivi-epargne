// ================================================
// FILE: src/lib/accountOps.ts
// Toutes les opérations qui modifient les soldes d'un compte passent par ici : ajouter ou
// retirer un mouvement, et l'annuler à l'identique. Avant, ce calcul (part propre, part
// des parents, total, versements cumulés, arrondis) était recopié à six endroits et
// dérivait d'un endroit à l'autre.
// ================================================
import { AccountMovement, SavingsAccount } from '../types';
import { depositsAfterCashFlow, tracksDeposits } from './finance';

export const round2 = (n: number) => Math.round(n * 100) / 100;

/** Mouvement de restitution aux parents : ne se supprime ni ne se renomme à la main. */
export const isRestitutionMovement = (m: AccountMovement) =>
  m.tag === 'restitution' || (m.kind === 'parental' && m.label === 'Restitution aux parents');

/**
 * Applique (`sign` = 1) ou retire (`sign` = -1) un mouvement :
 * - part des parents (`kind: 'parental'`) → capital parental ;
 * - sinon → part propre (versement, retrait, valorisation) ;
 * - argent réellement versé/retiré sur un placement qui suit ses versements cumulés →
 *   versements cumulés mis à jour (`trackDeposits`).
 * Le total reste toujours égal à part propre + part des parents, au centime.
 */
export const applyMovement = (
  acc: SavingsAccount,
  m: AccountMovement,
  sign: 1 | -1,
  opts: { trackDeposits?: boolean } = {}
): SavingsAccount => {
  const flow = (m.type === 'IN' ? m.amount : -m.amount) * sign;
  let ownedAmount = acc.ownedAmount;
  let parentalCapital = acc.parentalCapital;
  let totalDeposits = acc.totalDeposits;
  if (m.kind === 'parental') {
    parentalCapital = round2(Math.max(0, parentalCapital + flow));
  } else {
    ownedAmount = round2(ownedAmount + flow);
    if (opts.trackDeposits && !m.kind && totalDeposits !== undefined && tracksDeposits(acc.type)) {
      totalDeposits = sign > 0
        ? depositsAfterCashFlow(acc, flow)
        : Math.max(0, round2(totalDeposits + flow)); // annulation : on retire exactement ce qui avait été ajouté
    }
  }
  const movements = sign > 0 ? [...(acc.movements || []), m] : (acc.movements || []).filter(x => x.id !== m.id);
  return { ...acc, ownedAmount, parentalCapital, totalAmount: round2(ownedAmount + parentalCapital), totalDeposits, movements };
};

/** Instantané des champs de solde de quelques comptes, pour une annulation exacte. */
export type BalanceSnapshot = Record<string, Pick<SavingsAccount, 'ownedAmount' | 'parentalCapital' | 'totalAmount' | 'totalDeposits' | 'movements'>>;

export const snapshotBalances = (accounts: SavingsAccount[], ids: string[]): BalanceSnapshot =>
  Object.fromEntries(accounts.filter(a => ids.includes(a.id)).map(a => [a.id, {
    ownedAmount: a.ownedAmount, parentalCapital: a.parentalCapital, totalAmount: a.totalAmount,
    totalDeposits: a.totalDeposits, movements: [...(a.movements || [])],
  }]));

/**
 * Remet ces comptes exactement dans l'état de l'instantané. `createdIds` : mouvements créés
 * par l'opération annulée (jetés). Les autres mouvements apparus depuis sur ces comptes
 * sont conservés et rejoués par-dessus.
 */
export const restoreBalances = (accounts: SavingsAccount[], snap: BalanceSnapshot, createdIds: string[] = []): SavingsAccount[] =>
  accounts.map(a => {
    const s = snap[a.id];
    if (!s) return a;
    const known = new Set((s.movements || []).map(m => m.id));
    const created = new Set(createdIds);
    const later = (a.movements || []).filter(m => !known.has(m.id) && !created.has(m.id));
    let restored: SavingsAccount = { ...a, ...s, movements: [...(s.movements || [])] };
    for (const m of later) restored = applyMovement(restored, m, 1);
    return restored;
  });
