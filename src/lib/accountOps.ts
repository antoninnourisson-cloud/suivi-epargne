// ================================================
// FILE: src/lib/accountOps.ts
// Toutes les opérations qui modifient les soldes d'un compte passent par ici : ajouter ou
// retirer un mouvement, et l'annuler à l'identique. Ce calcul (part propre, part des
// parents, total, versements cumulés, arrondis) n'existe qu'ici : recopié, il dériverait
// d'un écran à l'autre.
// ================================================
import { AccountMovement, SavingsAccount } from '../types';
import { depositsAfterCashFlow, isInitialBalance, tracksDeposits } from './finance';
import { EPS, round2, signedAmount } from './money';

export { round2 };

/**
 * Mouvements qui expliquent le passage d'un solde à un autre (fiche du compte modifiée) :
 * - variation de VOTRE part : un mouvement « {ownLabel} » (de nature `ownKind`, par exemple
 *   `adjustment` pour une correction qui n'est pas de l'épargne) ; sur un placement qui suit
 *   ses versements, l'argent versé/retiré (`cashFlow`) et la variation de valeur
 *   (`valuation`) sont séparés ;
 * - variation de la part des parents : un mouvement `parental` à part.
 */
export const balanceChangeMovements = (
  old: SavingsAccount,
  next: SavingsAccount,
  date: string,
  opts: { ownLabel: string; ownKind?: 'adjustment'; cashFlow?: number; splitValuation?: boolean },
): AccountMovement[] => {
  const out: AccountMovement[] = [];
  const push = (amount: number, label: string, kind?: AccountMovement['kind']) => {
    const a = round2(amount);
    if (Math.abs(a) <= 0.001) return;
    out.push({ id: crypto.randomUUID(), date, amount: Math.abs(a), label: `${label} (${a > 0 ? '+' : '-'})`, type: a > 0 ? 'IN' : 'OUT', ...(kind ? { kind } : {}) });
  };
  const ownDiff = next.ownedAmount - old.ownedAmount;
  if (opts.splitValuation) {
    const cash = opts.cashFlow ?? 0;
    push(cash, cash > 0 ? 'Versement' : 'Retrait');
    push(ownDiff - cash, 'Valorisation', 'valuation');
  } else {
    push(ownDiff, opts.ownLabel, opts.ownKind);
  }
  push(next.parentalCapital - old.parentalCapital, 'Part des parents', 'parental');
  return out;
};

/** Mouvement de restitution aux parents : ne se supprime ni ne se renomme à la main. */
export const isRestitutionMovement = (m: AccountMovement) =>
  m.tag === 'restitution' || (m.kind === 'parental' && m.label === 'Restitution aux parents');

/**
 * Règle du capital des parents : un retrait ne peut porter que sur la part propre. Seule
 * source de cette règle pour l'interface (ajout rapide, virements) comme pour les
 * commandes : `true` si `amount` peut sortir de la part propre (au demi-centime près).
 */
export const canWithdrawOwn = (acc: Pick<SavingsAccount, 'ownedAmount'>, amount: number): boolean =>
  Number.isFinite(amount) && amount > 0 && amount <= acc.ownedAmount + EPS;

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
  const flow = (signedAmount(m)) * sign;
  let ownedAmount = acc.ownedAmount;
  let parentalCapital = acc.parentalCapital;
  let totalDeposits = acc.totalDeposits;
  if (m.kind === 'parental') {
    parentalCapital = round2(Math.max(0, parentalCapital + flow));
  } else {
    ownedAmount = round2(ownedAmount + flow);
    // Le solde initial n'est pas un versement suivi : les versements cumulés saisis avec la
    // fiche le comprennent déjà (le supprimer ne doit pas les réduire).
    if (opts.trackDeposits && !m.kind && !isInitialBalance(m) && totalDeposits !== undefined && tracksDeposits(acc.type)) {
      totalDeposits = sign > 0
        ? depositsAfterCashFlow(acc, flow)
        : Math.max(0, round2(totalDeposits + flow)); // annulation : on retire exactement ce qui avait été ajouté
    }
  }
  const movements = sign > 0 ? [...acc.movements, m] : acc.movements.filter(x => x.id !== m.id);
  return { ...acc, ownedAmount, parentalCapital, totalAmount: round2(ownedAmount + parentalCapital), totalDeposits, movements };
};

/** Instantané des champs de solde de quelques comptes, pour une annulation exacte. */
export type BalanceSnapshot = Record<string, Pick<SavingsAccount, 'ownedAmount' | 'parentalCapital' | 'totalAmount' | 'totalDeposits' | 'movements'>>;

export const snapshotBalances = (accounts: SavingsAccount[], ids: string[]): BalanceSnapshot =>
  Object.fromEntries(accounts.filter(a => ids.includes(a.id)).map(a => [a.id, {
    ownedAmount: a.ownedAmount, parentalCapital: a.parentalCapital, totalAmount: a.totalAmount,
    totalDeposits: a.totalDeposits, movements: [...a.movements],
  }]));

/**
 * Remet ces comptes exactement dans l'état de l'instantané. `createdIds` : mouvements créés
 * par l'opération annulée (jetés). Les autres mouvements apparus depuis sur ces comptes
 * sont conservés et rejoués par-dessus (versements cumulés compris).
 * Garde-fou : si l'annulation rendait une part propre négative (un retrait fait depuis
 * dépendait de l'opération annulée), rien n'est changé.
 */
export const restoreBalances = (accounts: SavingsAccount[], snap: BalanceSnapshot, createdIds: string[] = []): SavingsAccount[] => {
  const created = new Set(createdIds);
  let broken = false;
  const next = accounts.map(a => {
    const s = snap[a.id];
    if (!s) return a;
    const known = new Set(s.movements.map(m => m.id));
    const later = a.movements.filter(m => !known.has(m.id) && !created.has(m.id));
    let restored: SavingsAccount = { ...a, ...s, movements: [...s.movements] };
    for (const m of later) restored = applyMovement(restored, m, 1, { trackDeposits: true });
    if (restored.ownedAmount < -EPS && a.ownedAmount >= -EPS) broken = true;
    return restored;
  });
  return broken ? accounts : next;
};

// ---------------------------------------------------------------------------
// Nettoyage : mouvements qui s'annulent
// ---------------------------------------------------------------------------

export interface CancellingGroup {
  accountId: string;
  accountName: string;
  date: string;
  movements: AccountMovement[];
}

/**
 * Mouvements d'un même compte, le même jour, dont la somme est nulle (ex. « Test +2 € »
 * puis « Test −2 € ») : sans effet sur les soldes, ils ne font qu'encombrer l'historique.
 * Exclus : virements internes, part des parents, valorisations, soldes initiaux.
 */
export const findCancellingGroups = (accounts: SavingsAccount[]): CancellingGroup[] => {
  const out: CancellingGroup[] = [];
  for (const a of accounts) {
    const byDate = new Map<string, AccountMovement[]>();
    for (const m of a.movements) {
      if (m.kind || m.linkId || m.tag) continue;
      byDate.set(m.date, [...(byDate.get(m.date) || []), m]);
    }
    for (const [date, list] of byDate) {
      if (list.length < 2) continue;
      const net = list.reduce((s, m) => s + (signedAmount(m)), 0);
      if (Math.abs(net) < 0.005 && list.some(m => m.type === 'IN') && list.some(m => m.type === 'OUT')) {
        out.push({ accountId: a.id, accountName: a.name, date, movements: list });
      }
    }
  }
  return out.sort((x, y) => y.date.localeCompare(x.date));
};
