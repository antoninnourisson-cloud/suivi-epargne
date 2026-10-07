import { describe, it, expect } from 'vitest';
import { AccountType, SavingsAccount } from '../../types';
import { findCancellingGroups } from '../accountOps';
import { applyPatch, CommandState, quickAdd, deleteMovement, cancelDeposit, removeCancellingMovements, saveAccount, deleteAccount, planMovementDeletion } from './index';

const state = (): CommandState => ({
  accounts: [
    { id: 'la', name: 'Livret A', institution: 'B', type: AccountType.LIVRET_A, totalAmount: 15200, ownedAmount: 8200, parentalCapital: 7000,
      movements: [
        { id: 'p+', date: '2025-01-01', amount: 9000, label: 'Part des parents (+)', type: 'IN', kind: 'parental' },
        { id: 'p-', date: '2025-06-01', amount: 2000, label: 'Part des parents (-)', type: 'OUT', kind: 'parental' },
        { id: 't1', date: '2026-08-26', amount: 2, label: 'Test', type: 'IN' },
        { id: 't2', date: '2026-08-26', amount: 2, label: 'Test', type: 'OUT' },
      ] },
    { id: 'av', name: 'Assurance vie', institution: 'A', type: AccountType.ASSURANCE_VIE, totalAmount: 4300, ownedAmount: 4300, parentalCapital: 0, totalDeposits: 4000,
      movements: [{ id: 'v1', date: '2026-09-01', amount: 300, label: 'Virement', type: 'IN', linkId: 'L' }] },
    { id: 'cc', name: 'Compte courant', institution: 'B', type: AccountType.COMPTE_COURANT, totalAmount: 1400, ownedAmount: 1400, parentalCapital: 0,
      movements: [{ id: 'v2', date: '2026-09-01', amount: 300, label: 'Virement', type: 'OUT', linkId: 'L' }] },
  ],
});
const ok = <T extends { ok: boolean }>(r: T) => { if (!r.ok) throw new Error(JSON.stringify(r)); return r as Extract<T, { ok: true }>; };
const acc = (s: CommandState, id: string) => s.accounts.find(a => a.id === id)!;

describe('quickAdd', () => {
  it('ajoute un versement arrondi au centime et suit les versements cumulés', () => {
    const s0 = state();
    const r = ok(quickAdd(s0, { accountId: 'av', amount: 100.004, type: 'IN', label: 'Virement de paie', date: '2026-10-01', id: 'x' }));
    const s1 = applyPatch(s0, r.next);
    expect(acc(s1, 'av')).toMatchObject({ ownedAmount: 4400, totalAmount: 4400, totalDeposits: 4100 });
    expect(r).toMatchObject({ movementId: 'x', message: 'Virement de paie — Assurance vie' });
    expect(applyPatch(s1, r.undo(s1))).toEqual(s0);
  });

  it('refuse un retrait supérieur à la part propre (le capital des parents est intouchable)', () => {
    const r = quickAdd(state(), { accountId: 'la', amount: 8200.01, type: 'OUT', label: 'Retrait', date: '2026-10-01' });
    expect(r).toMatchObject({ ok: false, code: 'forbidden' });
    expect(!r.ok && r.error).toMatch(/^Retrait impossible : votre part sur Livret A n'est que de 8\s200\s€\.$/);
    // …mais autorise toute la part propre
    const all = ok(quickAdd(state(), { accountId: 'la', amount: 8200, type: 'OUT', label: 'Retrait', date: '2026-10-01' }));
    expect(acc(applyPatch(state(), all.next), 'la')).toMatchObject({ ownedAmount: 0, parentalCapital: 7000, totalAmount: 7000 });
  });

  it('refuse un compte inconnu ou un montant invalide', () => {
    expect(quickAdd(state(), { accountId: 'zz', amount: 5, type: 'IN', label: 'x', date: '2026-10-01' })).toMatchObject({ ok: false, code: 'not-found' });
    for (const amount of [0, -3, Number.NaN]) expect(quickAdd(state(), { accountId: 'la', amount, type: 'IN', label: 'x', date: '2026-10-01' })).toMatchObject({ ok: false, code: 'invalid' });
  });
});

describe('deleteMovement', () => {
  it('rétablit les soldes exactement à l’annulation, même quand la part des parents a été plafonnée à 0', () => {
    const s0 = state();
    const r = ok(deleteMovement(s0, { accountId: 'la', movementId: 'p+' })); // 7000 − 9000 → 0
    const s1 = applyPatch(s0, r.next);
    expect(acc(s1, 'la')).toMatchObject({ parentalCapital: 0, ownedAmount: 8200, totalAmount: 8200 });
    expect(r.message).toBe('Mouvement supprimé');
    expect(applyPatch(s1, r.undo(s1))).toEqual(s0);
  });

  it('supprime les deux lignes d’un virement interne ensemble', () => {
    const s0 = state();
    const plan = planMovementDeletion(s0.accounts, 'av', 'v1');
    expect(plan).toMatchObject({ ok: true, isTransfer: true });
    const r = ok(deleteMovement(s0, { accountId: 'av', movementId: 'v1' }));
    const s1 = applyPatch(s0, r.next);
    expect(r.message).toBe('Virement supprimé (2 lignes)');
    expect(acc(s1, 'av')).toMatchObject({ ownedAmount: 4000, totalAmount: 4000, totalDeposits: 4000, movements: [] });
    expect(acc(s1, 'cc')).toMatchObject({ ownedAmount: 1700, totalAmount: 1700, movements: [] });
    expect(applyPatch(s1, r.undo(s1))).toEqual(s0);
  });

  it('refuse un mouvement disparu', () => {
    expect(deleteMovement(state(), { accountId: 'la', movementId: 'nope' })).toMatchObject({ ok: false, code: 'not-found' });
  });
});

describe('cancelDeposit (virements de paie)', () => {
  it('retire le versement et rétablit solde et versements cumulés', () => {
    const s0 = state();
    const add = ok(quickAdd(s0, { accountId: 'av', amount: 250, type: 'IN', label: 'Virement de paie', date: '2026-10-01', id: 'pay' }));
    const s1 = applyPatch(s0, add.next);
    const c = ok(cancelDeposit(s1, { accountId: 'av', movementId: 'pay' }));
    const s2 = applyPatch(s1, c.next);
    expect(s2).toEqual(s0);
    expect(applyPatch(s2, c.undo(s2))).toEqual(s1);
    expect(cancelDeposit(s2, { accountId: 'av', movementId: 'pay' })).toMatchObject({ ok: false, code: 'not-found' });
  });
});

describe('removeCancellingMovements', () => {
  it('retire les mouvements qui s’annulent sans toucher aux soldes, et l’annulation les remet', () => {
    const s0 = state();
    const r = ok(removeCancellingMovements(s0, findCancellingGroups(s0.accounts)));
    const s1 = applyPatch(s0, r.next);
    expect(r.message).toBe('2 mouvements supprimés (soldes inchangés)');
    expect(acc(s1, 'la')).toMatchObject({ ownedAmount: 8200, parentalCapital: 7000, totalAmount: 15200 });
    expect(acc(s1, 'la').movements?.map(m => m.id)).toEqual(['p+', 'p-']);
    expect(applyPatch(s1, r.undo(s1))).toEqual(s0);
  });
  it('refuse des mouvements qui ne s’annulent pas ou touchent la part des parents', () => {
    const s0 = state();
    const la = acc(s0, 'la');
    expect(removeCancellingMovements(s0, [{ accountId: 'la', accountName: 'Livret A', date: '2026-08-26', movements: [la.movements![2]] }])).toMatchObject({ ok: false, code: 'invalid' });
    expect(removeCancellingMovements(s0, [{ accountId: 'la', accountName: 'Livret A', date: 'x', movements: la.movements!.slice(0, 1) }])).toMatchObject({ ok: false, code: 'forbidden' });
  });
});

describe('saveAccount / deleteAccount', () => {
  const edited = (over: Partial<SavingsAccount>): SavingsAccount => ({ ...state().accounts[0], ...over });

  it('recalcule le total, trace la correction et rétablit la fiche à l’annulation', () => {
    const s0 = state();
    const r = ok(saveAccount(s0, { account: edited({ name: 'LA', ownedAmount: 8300, parentalCapital: 6900, totalAmount: 1 }), today: '2026-10-07' }));
    const s1 = applyPatch(s0, r.next);
    expect(s1.accounts.map(a => a.id)).toEqual(['la', 'av', 'cc']);
    expect(acc(s1, 'la')).toMatchObject({ name: 'LA', ownedAmount: 8300, parentalCapital: 6900, totalAmount: 15200 });
    expect(acc(s1, 'la').movements?.slice(-2).map(m => [m.label, m.amount, m.kind])).toEqual([['Correction de solde (+)', 100, undefined], ['Part des parents (-)', 100, 'parental']]);
    expect(applyPatch(s1, r.undo(s1))).toEqual(s0);
  });

  it('nouveau compte : solde initial, annulable ; part des parents négative refusée', () => {
    const s0 = state();
    const r = ok(saveAccount(s0, { account: { id: 'n', name: 'PEA', institution: 'B', type: AccountType.PEA, totalAmount: 0, ownedAmount: 500, parentalCapital: 0 }, today: '2026-10-07' }));
    const s1 = applyPatch(s0, r.next);
    expect(acc(s1, 'n')).toMatchObject({ totalAmount: 500, movements: [{ label: 'Solde initial', amount: 500, tag: 'initial' }] });
    expect(applyPatch(s1, r.undo(s1))).toEqual(s0);
    expect(saveAccount(s0, { account: edited({ parentalCapital: -1 }), today: '2026-10-07' })).toMatchObject({ ok: false, code: 'invalid' });
  });

  it('suppression de compte : l’annulation le remet à sa place', () => {
    const s0 = state();
    const r = ok(deleteAccount(s0, { accountId: 'av' }));
    const s1 = applyPatch(s0, r.next);
    expect(s1.accounts.map(a => a.id)).toEqual(['la', 'cc']);
    expect(r.message).toBe('« Assurance vie » supprimé');
    expect(applyPatch(s1, r.undo(s1))).toEqual(s0);
  });
});
