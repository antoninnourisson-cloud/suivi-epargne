// « J'ai besoin d'argent » enregistré : un virement par ligne vers le compte courant (ou un
// retrait), part des parents intouchable, un seul « Annuler ».
import { describe, it, expect } from 'vitest';
import { AccountType, type SavingsAccount } from '../../types';
import { recordNeedWithdrawal, type CommandState } from './index';
import { applyPatch } from './testHelpers';

const state = (): CommandState => ({
  accounts: [
    { id: 'la', name: 'Livret A', institution: 'B', type: AccountType.LIVRET_A, totalAmount: 1000, ownedAmount: 300, parentalCapital: 700, movements: [] },
    { id: 'ldds', name: 'LDDS', institution: 'B', type: AccountType.LDDS, totalAmount: 2000, ownedAmount: 2000, parentalCapital: 0, movements: [] },
    { id: 'cc', name: 'Compte courant', institution: 'B', type: AccountType.COMPTE_COURANT, totalAmount: 100, ownedAmount: 100, parentalCapital: 0, movements: [] },
  ],
});
const byId = (s: CommandState, id: string): SavingsAccount => s.accounts.find(a => a.id === id)!;

describe('recordNeedWithdrawal', () => {
  it('vire chaque ligne sur le compte courant, en une fois, et un seul « Annuler » remet tout', () => {
    const s = state();
    const r = recordNeedWithdrawal(s, { lines: [{ accountId: 'la', amount: 300 }, { accountId: 'ldds', amount: 500 }], destId: 'cc', date: '2026-11-04' });
    if (!r.ok) throw new Error(r.error);
    const after = applyPatch(s, r.next);
    expect(byId(after, 'la')).toMatchObject({ ownedAmount: 0, parentalCapital: 700, totalAmount: 700 });
    expect(byId(after, 'ldds')).toMatchObject({ ownedAmount: 1500, totalAmount: 1500 });
    expect(byId(after, 'cc')).toMatchObject({ ownedAmount: 900, totalAmount: 900 });
    expect(byId(after, 'cc').movements.map(m => m.label)).toEqual(['Virement de Livret A', 'Virement de LDDS']);
    expect(r.movementIds).toHaveLength(4);
    expect(r.message).toMatch(/^2 retraits, 800\s€ au total, viré sur Compte courant$/);
    expect(applyPatch(after, r.undo(after))).toEqual(s);
    expect(s).toEqual(state());
  });

  it('une seule ligne : le message nomme le compte', () => {
    const r = recordNeedWithdrawal(state(), { lines: [{ accountId: 'ldds', amount: 800 }], destId: 'cc', date: '2026-11-04' });
    expect(r.ok && r.message).toMatch(/^Retrait de 800\s€ sur le LDDS, viré sur Compte courant$/);
  });

  it('sans compte courant : un simple retrait par ligne', () => {
    const s = state();
    const r = recordNeedWithdrawal(s, { lines: [{ accountId: 'ldds', amount: 500 }], date: '2026-11-04' });
    if (!r.ok) throw new Error(r.error);
    const after = applyPatch(s, r.next);
    expect(byId(after, 'ldds').movements).toEqual([expect.objectContaining({ amount: 500, type: 'OUT', label: 'Retrait', date: '2026-11-04' })]);
    expect(byId(after, 'cc')).toEqual(byId(s, 'cc'));
    expect(applyPatch(after, r.undo(after))).toEqual(s);
  });

  it('refuse tout si une ligne entamerait la part des parents ; saisies incohérentes', () => {
    const s = state();
    const r = recordNeedWithdrawal(s, { lines: [{ accountId: 'ldds', amount: 100 }, { accountId: 'la', amount: 300.01 }], destId: 'cc', date: '2026-11-04' });
    expect(r).toMatchObject({ ok: false, code: 'forbidden' });
    expect(recordNeedWithdrawal(s, { lines: [{ accountId: 'la', amount: 0 }], destId: 'cc', date: '2026-11-04' })).toMatchObject({ ok: false, code: 'nothing-to-do' });
    expect(recordNeedWithdrawal(s, { lines: [{ accountId: 'cc', amount: 10 }], destId: 'cc', date: '2026-11-04' })).toMatchObject({ ok: false, code: 'invalid' });
    expect(recordNeedWithdrawal(s, { lines: [{ accountId: 'parti', amount: 10 }], destId: 'cc', date: '2026-11-04' })).toMatchObject({ ok: false, code: 'not-found' });
    expect(recordNeedWithdrawal(s, { lines: [{ accountId: 'parti', amount: 10 }], date: '2026-11-04' })).toMatchObject({ ok: false, code: 'not-found' });
  });
});
