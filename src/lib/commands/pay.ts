// Commandes de la paie reçue (rituel « Ma paie », liste « Où le placer ») : enregistrer la
// paie et ce qui en a été fait, la modifier, la supprimer. Une seule commande crée tous les
// versements d'épargne cochés (IN, « Virement de paie », date des virements, rattachés à la
// paie par `payId`) ; les virements de la paie (charges, plaisir…) sont de simples coches, et
// « Déjà enregistré » coche sans rien créer. Une seule annulation remet tout à l'identique :
// soldes (instantané, voir restoreBalances) ET paie.
// Le plan conseillé (lines) est calculé par l'appelant (lib/payDistribution) : il est figé
// dès qu'une ligne est faite, et ne se remplace que tant que rien n'est fait.
import type { AccountMovement, PayChecklist, PayChecklistLine, PayRecord, SavingsAccount } from '../../types';
import { applyMovement, isRestitutionMovement, restoreBalances, snapshotBalances } from '../accountOps';
import { EPS, round2 } from '../money';
import { formatEUR, formatSignedEUR } from '../format';
import { savingsMonthOf, savingsMonthOfPay } from '../payCalendar';
import { liveDone, newPayId, payMovements } from '../payRecords';
import { CommandResult, CommandState, fail } from './types';

/** Libellé des versements créés par la paie (le même qu'avant, cherchable dans le Journal). */
export const PAY_DEPOSIT_LABEL = 'Virement de paie';

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/;
const isDay = (v: unknown): v is string => typeof v === 'string' && ISO_DAY.test(v);
const amountOk = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

type Done = PayChecklist['done'];

/** La paie : nouvelle (sans `id`) ou existante (`id`, seuls les champs donnés changent). */
export interface PayInput {
  id?: string;
  receivedOn?: string;
  /** Mois d'épargne choisi ; absent : règle du 15 (ou le choix déjà fait pour cette paie). */
  savingsMonth?: string;
  amount?: number;
  bonus?: number;
  kind?: 'extra';
  toSave?: number;
  payslipId?: string;
}

/** Une ligne faite : montant réel, compte réellement crédité s'il change, ou déjà enregistrée. */
export interface PayLineDone {
  key: string;
  amount: number;
  accountId?: string;
  alreadyRecorded?: boolean;
}

export interface RecordPayInput {
  pay: PayInput;
  /** Répartition conseillée pour ce montant (lignes « Autre compte » comprises, `added`). */
  lines: PayChecklistLine[];
  done: PayLineDone[];
  /** Date des virements ('YYYY-MM-DD') : date des versements créés. */
  transferDate: string;
  /** Identifiants imposés (tests) : paie, puis versements dans l'ordre des lignes faites. */
  ids?: { pay?: string; movements?: string[] };
}

// ---------------------------------------------------------------------------
// Annulation : paie et soldes
// ---------------------------------------------------------------------------

/**
 * Annulation de la paie `payId` : si rien n'a bougé depuis, la liste d'avant telle quelle
 * (exacte) ; sinon la paie d'avant remise à sa place (ou retirée si elle est nouvelle), les
 * autres paies modifiées depuis sont gardées.
 */
const restorePays = (before: PayRecord[] | undefined, after: PayRecord[], payId: string) => (current: CommandState): PayRecord[] | undefined => {
  if (current.pays === after) return before;
  const list = current.pays ?? [];
  const prev = before?.find(p => p.id === payId);
  if (!prev) return list.filter(p => p.id !== payId);
  if (list.some(p => p.id === payId)) return list.map(p => (p.id === payId ? prev : p));
  const at = Math.min(before!.findIndex(p => p.id === payId), list.length);
  return [...list.slice(0, at), prev, ...list.slice(at)];
};

const replaceOrAdd = (pays: PayRecord[], next: PayRecord) =>
  pays.some(p => p.id === next.id) ? pays.map(p => (p.id === next.id ? next : p)) : [...pays, next];

/** Premier compte dont la part propre deviendrait négative (et ne l'était pas déjà). */
const negativeAfter = (after: SavingsAccount[], before: SavingsAccount[]) =>
  after.find(a => a.ownedAmount < -EPS && (before.find(b => b.id === a.id)?.ownedAmount ?? 0) >= -EPS);

/** Retire des versements (soldes ET versements cumulés), avec le garde-fou de la part propre. */
const removeDeposits = (state: CommandState, legs: { accountId: string; movement: AccountMovement }[]):
  { ok: true; accounts: SavingsAccount[] } | { ok: false; code: 'forbidden'; error: string } => {
  if (legs.some(l => isRestitutionMovement(l.movement))) return { ok: false, code: 'forbidden', error: 'La restitution s\'annule depuis Part parentale.' };
  const accounts = state.accounts.map(acc => legs
    .filter(l => l.accountId === acc.id)
    .reduce((cur, l) => applyMovement(cur, l.movement, -1, { trackDeposits: true }), acc));
  const negative = negativeAfter(accounts, state.accounts);
  if (negative) {
    return { ok: false, code: 'forbidden', error: `Impossible de retirer ces versements : votre part sur ${negative.name} passerait à ${formatEUR(negative.ownedAmount, 2)}. Supprimez d'abord les retraits qui en dépendent.` };
  }
  return { ok: true, accounts };
};

// ---------------------------------------------------------------------------
// Enregistrer la paie et ce qui a été fait
// ---------------------------------------------------------------------------

/**
 * Enregistre (ou complète) la paie et ses lignes faites. Les versements d'épargne cochés
 * sont créés en une fois : compte de la ligne ou compte choisi, montant réel, date des
 * virements, `payId`. Une ligne déjà faite (et dont le versement existe toujours) n'est pas
 * refaite. Le capital des parents n'est jamais touché (versements sur la part propre).
 */
export const recordPay = (state: CommandState, input: RecordPayInput): CommandResult<{ payId: string; movementIds: string[] }> => {
  const pays = state.pays ?? [];
  const existing = input.pay.id ? pays.find(p => p.id === input.pay.id) : undefined;
  if (input.pay.id && !existing) return fail('not-found', 'Paie introuvable.');
  const receivedOn = input.pay.receivedOn ?? existing?.receivedOn;
  if (!isDay(receivedOn)) return fail('invalid', 'Date de réception invalide.');
  if (!isDay(input.transferDate)) return fail('invalid', 'Date des virements invalide.');
  const amount = input.pay.amount ?? existing?.amount;
  if (!amountOk(amount)) return fail('invalid', 'Montant reçu invalide.');
  for (const k of ['bonus', 'toSave'] as const) {
    if (input.pay[k] !== undefined && !amountOk(input.pay[k])) return fail('invalid', k === 'bonus' ? 'Prime invalide.' : 'Montant à placer invalide.');
  }
  if (input.pay.savingsMonth !== undefined && !MONTH_KEY.test(input.pay.savingsMonth)) return fail('invalid', 'Mois d\'épargne invalide.');

  // Coches encore valables : un versement supprimé à la main laisse sa ligne à refaire.
  const doneBefore: Done = existing ? liveDone(existing.done, state.accounts) : {};
  const frozen = !!existing && existing.lines.length > 0 && Object.keys(doneBefore).length > 0;
  // Plan figé dès qu'une ligne est faite : seules les lignes ajoutées (« Autre compte ») s'y greffent.
  const lines = frozen
    ? [...existing!.lines, ...input.lines.filter(l => !existing!.lines.some(x => x.key === l.key))]
    : input.lines;
  if (new Set(lines.map(l => l.key)).size !== lines.length) return fail('invalid', 'Deux lignes de la paie ont la même clé.');

  const todo = input.done.filter(d => !doneBefore[d.key]);
  if (new Set(todo.map(d => d.key)).size !== todo.length) return fail('invalid', 'Une ligne est cochée deux fois.');
  const payId = existing?.id ?? input.ids?.pay ?? newPayId(pays, input.pay.savingsMonth ?? savingsMonthOf(receivedOn));

  const created: { accountId: string; movement: AccountMovement }[] = [];
  const done: Done = { ...doneBefore };
  for (const d of todo) {
    const line = lines.find(l => l.key === d.key);
    if (!line) return fail('invalid', 'Ligne de paie inconnue.');
    const value = round2(d.amount);
    if (!amountOk(value)) return fail('invalid', `Montant invalide pour « ${line.label} ».`);
    const accountId = d.accountId ?? line.accountId;
    const deposit = line.kind === 'saving' && !d.alreadyRecorded && value > 0;
    let movementId: string | undefined;
    if (deposit) {
      const account = accountId ? state.accounts.find(a => a.id === accountId) : undefined;
      // Compte supprimé depuis le plan : rien n'est enregistré (pas de virement fantôme).
      if (!account) return fail('not-found', `Le compte « ${line.label} » n'existe plus : choisissez-en un autre.`);
      movementId = input.ids?.movements?.[created.length] ?? crypto.randomUUID();
      created.push({
        accountId: account.id,
        movement: { id: movementId, date: input.transferDate, amount: value, label: PAY_DEPOSIT_LABEL, type: 'IN', payId },
      });
    }
    done[d.key] = {
      amount: value,
      ...(movementId ? { movementId } : {}),
      ...(d.alreadyRecorded ? { alreadyRecorded: true } : {}),
      ...(accountId && accountId !== line.accountId ? { accountId } : {}),
    };
  }

  const base: Partial<PayRecord> = existing ?? {};
  const { bonus: _b, toSave: _t, kind: _k, ...rest } = base;
  const bonus = input.pay.bonus !== undefined ? input.pay.bonus : base.bonus;
  const toSave = input.pay.toSave !== undefined ? input.pay.toSave : base.toSave;
  const kind = input.pay.kind ?? base.kind;
  // Mois d'épargne : celui choisi, sinon celui déjà retenu pour cette date, sinon la règle du 15.
  const savingsMonth = input.pay.savingsMonth
    ?? (existing && existing.receivedOn === receivedOn ? savingsMonthOfPay(existing) : savingsMonthOf(receivedOn));
  const payslipId = input.pay.payslipId ?? base.payslipId;
  const pay: PayRecord = {
    ...rest,
    id: payId, receivedOn, savingsMonth, amount: round2(amount),
    ...(bonus ? { bonus: round2(bonus) } : {}),
    ...(kind === 'extra' ? { kind } : {}),
    ...(toSave !== undefined ? { toSave: round2(toSave) } : {}),
    ...(payslipId ? { payslipId } : {}),
    lines, done,
  };
  const nextPays = replaceOrAdd(pays, pay);
  const snap = snapshotBalances(state.accounts, [...new Set(created.map(c => c.accountId))]);
  const accounts = created.length === 0 ? state.accounts : state.accounts.map(acc => created
    .filter(c => c.accountId === acc.id)
    .reduce((cur, c) => applyMovement(cur, c.movement, 1, { trackDeposits: true }), acc));
  const movementIds = created.map(c => c.movement.id);
  const total = round2(created.reduce((s, c) => s + c.movement.amount, 0));
  const one = created.length === 1 ? created[0] : undefined;
  // Le montant figure dans le message : une faute de frappe se voit (et s'annule) tout de suite.
  const message = one
    ? `${PAY_DEPOSIT_LABEL} : ${formatSignedEUR(one.movement.amount)} sur ${state.accounts.find(a => a.id === one.accountId)!.name}`
    : created.length > 1 ? `Paie enregistrée : ${created.length} versements, ${formatEUR(total)} placés`
      : todo.length > 0 ? 'Fait' : 'Paie enregistrée';
  const undoPays = restorePays(state.pays, nextPays, payId);
  return {
    ok: true,
    payId,
    movementIds,
    next: { pays: nextPays, ...(created.length > 0 ? { accounts } : {}) },
    message,
    undo: current => ({
      pays: undoPays(current),
      ...(created.length > 0 ? { accounts: restoreBalances(current.accounts, snap, movementIds) } : {}),
    }),
  };
};

// ---------------------------------------------------------------------------
// Décocher une ligne
// ---------------------------------------------------------------------------

/** Décoche une ligne : son versement (s'il existe encore) est retiré, solde et versements cumulés compris. */
export const uncheckPayLine = (state: CommandState, input: { payId: string; key: string }): CommandResult => {
  const pays = state.pays ?? [];
  const pay = pays.find(p => p.id === input.payId);
  const entry = pay?.done[input.key];
  if (!pay || !entry) return fail('not-found', 'Ligne introuvable.');
  const { [input.key]: _removed, ...done } = pay.done;
  const nextPays = pays.map(p => (p.id === pay.id ? { ...pay, done } : p));
  const leg = payMovements({ done: { [input.key]: entry } }, state.accounts)[0];
  const undoPays = restorePays(state.pays, nextPays, pay.id);
  if (!leg) return { ok: true, next: { pays: nextPays }, message: 'Ligne décochée', undo: current => ({ pays: undoPays(current) }) };
  const removed = removeDeposits(state, [leg]);
  if (!removed.ok) return fail(removed.code, removed.error);
  const snap = snapshotBalances(state.accounts, [leg.accountId]);
  return {
    ok: true,
    next: { pays: nextPays, accounts: removed.accounts },
    message: 'Versement annulé',
    undo: current => ({ pays: undoPays(current), accounts: restoreBalances(current.accounts, snap) }),
  };
};

// ---------------------------------------------------------------------------
// Modifier, supprimer
// ---------------------------------------------------------------------------

export interface UpdatePayInput {
  payId: string;
  amount?: number;
  receivedOn?: string;
  savingsMonth?: string;
  /** `null` : retour au calcul. */
  toSave?: number | null;
  /** `null` ou 0 : plus de prime. */
  bonus?: number | null;
  /** Nouveau plan conseillé : appliqué seulement si rien n'est fait (règle du gel). */
  lines?: PayChecklistLine[];
}

/**
 * Modifie la paie (montant, date, mois d'épargne, « À placer »). Les versements déjà faits
 * ne bougent pas : rattachés par `payId`, ils suivent la paie dans son nouveau mois. Changer
 * la date recalcule le mois d'épargne, sauf s'il avait été choisi à la main.
 */
export const updatePay = (state: CommandState, input: UpdatePayInput): CommandResult => {
  const pays = state.pays ?? [];
  const pay = pays.find(p => p.id === input.payId);
  if (!pay) return fail('not-found', 'Paie introuvable.');
  if (input.amount !== undefined && !amountOk(input.amount)) return fail('invalid', 'Montant reçu invalide.');
  if (input.receivedOn !== undefined && !isDay(input.receivedOn)) return fail('invalid', 'Date de réception invalide.');
  if (input.savingsMonth !== undefined && !MONTH_KEY.test(input.savingsMonth)) return fail('invalid', 'Mois d\'épargne invalide.');
  for (const k of ['bonus', 'toSave'] as const) {
    const v = input[k];
    if (v !== undefined && v !== null && !amountOk(v)) return fail('invalid', k === 'bonus' ? 'Prime invalide.' : 'Montant à placer invalide.');
  }
  const receivedOn = input.receivedOn ?? pay.receivedOn;
  const chosenByHand = savingsMonthOfPay(pay) !== savingsMonthOf(pay.receivedOn);
  const savingsMonth = input.savingsMonth ?? (chosenByHand ? savingsMonthOfPay(pay) : savingsMonthOf(receivedOn));
  const { bonus: _b, toSave: _t, ...rest } = pay;
  const bonus = input.bonus === undefined ? pay.bonus : input.bonus || undefined;
  const toSave = input.toSave === undefined ? pay.toSave : input.toSave ?? undefined;
  const nothingDone = Object.keys(liveDone(pay.done, state.accounts)).length === 0;
  const updated: PayRecord = {
    ...rest,
    receivedOn, savingsMonth,
    amount: input.amount !== undefined ? round2(input.amount) : pay.amount,
    ...(bonus ? { bonus: round2(bonus) } : {}),
    ...(toSave !== undefined ? { toSave: round2(toSave) } : {}),
    ...(input.lines && nothingDone ? { lines: input.lines, done: {} } : {}),
  };
  const nextPays = pays.map(p => (p.id === pay.id ? updated : p));
  const undoPays = restorePays(state.pays, nextPays, pay.id);
  return { ok: true, next: { pays: nextPays }, message: 'Paie modifiée', undo: current => ({ pays: undoPays(current) }) };
};

/**
 * Supprime la paie. `withMovements` : retire aussi les versements qu'elle a créés (ceux qui
 * existent encore), sinon ils restent comme versements ordinaires, rattachés par leur date.
 * Une seule annulation remet la paie et les soldes.
 */
export const deletePay = (state: CommandState, input: { payId: string; withMovements: boolean }): CommandResult<{ removed: number }> => {
  const pays = state.pays ?? [];
  const pay = pays.find(p => p.id === input.payId);
  if (!pay) return fail('not-found', 'Paie introuvable.');
  const legs = input.withMovements ? payMovements(pay, state.accounts) : [];
  const nextPays = pays.filter(p => p.id !== pay.id);
  const undoPays = restorePays(state.pays, nextPays, pay.id);
  // Versements gardés : ils ne pointent plus vers une paie disparue.
  const kept = new Set(input.withMovements ? [] : payMovements(pay, state.accounts).map(l => l.movement.id));
  const detach = (accounts: SavingsAccount[]) => kept.size === 0 ? accounts : accounts.map(a => (a.movements.some(m => kept.has(m.id))
    ? { ...a, movements: a.movements.map(m => (kept.has(m.id) ? (({ payId: _p, ...m2 }) => m2)(m) : m)) }
    : a));
  let accounts = detach(state.accounts);
  if (legs.length > 0) {
    const removed = removeDeposits(state, legs);
    if (!removed.ok) return fail(removed.code, removed.error);
    accounts = removed.accounts;
  }
  const touched = [...new Set([...legs.map(l => l.accountId), ...state.accounts.filter(a => a.movements.some(m => kept.has(m.id))).map(a => a.id)])];
  const snap = snapshotBalances(state.accounts, touched);
  return {
    ok: true,
    removed: legs.length,
    next: { pays: nextPays, ...(touched.length > 0 ? { accounts } : {}) },
    message: legs.length === 0 ? 'Paie supprimée' : `Paie supprimée, avec ${legs.length === 1 ? 'son versement' : `ses ${legs.length} versements`}`,
    undo: current => ({
      pays: undoPays(current),
      ...(touched.length > 0 ? { accounts: restoreBalances(current.accounts, snap) } : {}),
    }),
  };
};
