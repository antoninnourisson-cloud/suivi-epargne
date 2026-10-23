// Virement interne lié : part propre seulement, montant au centime, deux lignes appariées,
// annulation exacte des deux côtés.
import { describe, it, expect } from 'vitest';
import { AccountType, type SavingsAccount } from '../../types';
import { applyPatch, deleteMovement, linkedTransfer, quickAdd, type CommandState } from './index';

const ids = { linkId: 'l1', out: 'out1', in: 'in1' };
const state = (): CommandState => ({
  accounts: [
    { id: 'a', name: 'Livret A', institution: 'B', type: AccountType.LIVRET_A, totalAmount: 1000, ownedAmount: 300, parentalCapital: 700, movements: [] },
    { id: 'b', name: 'LDDS', institution: 'B', type: AccountType.LDDS, totalAmount: 0, ownedAmount: 0, parentalCapital: 0, movements: [] },
    { id: 'av', name: 'Assurance vie', institution: 'A', type: AccountType.ASSURANCE_VIE, totalAmount: 4300, ownedAmount: 4300, parentalCapital: 0, totalDeposits: 4000, movements: [] },
  ],
});
const byId = (s: CommandState, id: string): SavingsAccount => s.accounts.find(a => a.id === id)!;

describe('linkedTransfer', () => {
  it('déplace la part propre, garde le capital des parents et les totaux', () => {
    const s = state();
    const r = linkedTransfer(s, { sourceId: 'a', destId: 'b', amount: 300, date: '2026-10-02', ids });
    if (!r.ok) throw new Error(r.error);
    const after = applyPatch(s, r.next);
    expect(byId(after, 'a')).toMatchObject({ ownedAmount: 0, parentalCapital: 700, totalAmount: 700 });
    expect(byId(after, 'b')).toMatchObject({ ownedAmount: 300, parentalCapital: 0, totalAmount: 300 });
    expect(byId(after, 'a').movements).toEqual([{ id: 'out1', date: '2026-10-02', amount: 300, label: 'Virement vers LDDS', type: 'OUT', linkId: 'l1' }]);
    expect(byId(after, 'b').movements).toEqual([{ id: 'in1', date: '2026-10-02', amount: 300, label: 'Virement de Livret A', type: 'IN', linkId: 'l1' }]);
    expect(r).toMatchObject({ linkId: 'l1', movementIds: ['out1', 'in1'] });
    expect(r.message).toMatch(/^Virement de 300,00\s€ : Livret A → LDDS$/);
    // Entrée intacte (commande pure).
    expect(s).toEqual(state());
  });

  it('refuse ce qui entamerait la part des parents, et les saisies incohérentes', () => {
    const s = state();
    const tooMuch = linkedTransfer(s, { sourceId: 'a', destId: 'b', amount: 300.01, date: '2026-10-02' });
    expect(tooMuch).toMatchObject({ ok: false, code: 'forbidden' });
    expect(!tooMuch.ok && tooMuch.error).toMatch(/Fonds insuffisants : votre part sur Livret A/);
    expect(linkedTransfer(s, { sourceId: 'a', destId: 'a', amount: 10, date: '2026-10-02' })).toMatchObject({ ok: false, code: 'invalid' });
    expect(linkedTransfer(s, { sourceId: 'a', destId: 'b', amount: 0, date: '2026-10-02' })).toMatchObject({ ok: false, code: 'invalid' });
    expect(linkedTransfer(s, { sourceId: 'a', destId: 'b', amount: Number.NaN, date: '2026-10-02' })).toMatchObject({ ok: false, code: 'invalid' });
    expect(linkedTransfer(s, { sourceId: 'a', destId: 'zz', amount: 10, date: '2026-10-02' })).toMatchObject({ ok: false, code: 'not-found' });
    expect(linkedTransfer(s, { sourceId: 'zz', destId: 'b', amount: 10, date: '2026-10-02' })).toMatchObject({ ok: false, code: 'not-found' });
  });

  it('arrondit le montant au centime : mouvements et soldes restent d’accord', () => {
    const s = state();
    const r = linkedTransfer(s, { sourceId: 'a', destId: 'b', amount: 10.005, date: '2026-10-02', ids });
    if (!r.ok) throw new Error(r.error);
    const after = applyPatch(s, r.next);
    expect([...byId(after, 'a').movements!, ...byId(after, 'b').movements!].map(m => m.amount)).toEqual([10.01, 10.01]);
    expect(byId(after, 'a').ownedAmount).toBe(289.99);
    expect(byId(after, 'b').ownedAmount).toBe(10.01);
  });

  it('les versements cumulés d’un placement suivent l’argent réellement déplacé', () => {
    const s = state();
    const r = linkedTransfer(s, { sourceId: 'av', destId: 'b', amount: 500, date: '2026-10-02', ids });
    if (!r.ok) throw new Error(r.error);
    // Retrait sur l'assurance vie (4 300 € dont 4 000 € versés) : les versements baissent au
    // prorata (une part des 500 € est du gain), 4 000 × 3 800 / 4 300 = 3 534,88 €.
    expect(byId(applyPatch(s, r.next), 'av')).toMatchObject({ ownedAmount: 3800, totalAmount: 3800, totalDeposits: 3534.88 });
    // Et sur le compte d'arrivée qui les suit, ils augmentent du montant reçu.
    const back = linkedTransfer(applyPatch(s, r.next), { sourceId: 'b', destId: 'av', amount: 200, date: '2026-10-03' });
    if (!back.ok) throw new Error(back.error);
    expect(byId(applyPatch(applyPatch(s, r.next), back.next), 'av')).toMatchObject({ ownedAmount: 4000, totalDeposits: 3734.88 });
  });

  it('« Annuler » rend les deux comptes à l’identique, et garde ce qui a été fait depuis', () => {
    const s = state();
    const r = linkedTransfer(s, { sourceId: 'a', destId: 'b', amount: 120, date: '2026-10-02', ids });
    if (!r.ok) throw new Error(r.error);
    const after = applyPatch(s, r.next);
    expect(applyPatch(after, r.undo(after))).toEqual(s);

    // Un dépôt fait entre-temps sur le compte d'arrivée reste après l'annulation.
    const dep = quickAdd(after, { accountId: 'b', amount: 50, type: 'IN', label: 'Dépôt', date: '2026-10-03', id: 'd1' });
    if (!dep.ok) throw new Error(dep.error);
    const later = applyPatch(after, dep.next);
    const undone = applyPatch(later, r.undo(later));
    expect(byId(undone, 'a')).toEqual(byId(s, 'a'));
    expect(byId(undone, 'b')).toMatchObject({ ownedAmount: 50, totalAmount: 50 });
    expect(byId(undone, 'b').movements!.map(m => m.id)).toEqual(['d1']);
  });

  it('supprimer une des deux lignes retire le virement entier', () => {
    const s = state();
    const r = linkedTransfer(s, { sourceId: 'a', destId: 'b', amount: 100, date: '2026-10-02', ids });
    if (!r.ok) throw new Error(r.error);
    const after = applyPatch(s, r.next);
    const del = deleteMovement(after, { accountId: 'b', movementId: 'in1' });
    if (!del.ok) throw new Error(del.error);
    expect(del.removed).toBe(2);
    const cleared = applyPatch(after, del.next);
    expect(byId(cleared, 'a')).toMatchObject({ ownedAmount: 300, totalAmount: 1000, movements: [] });
    expect(byId(cleared, 'b')).toMatchObject({ ownedAmount: 0, totalAmount: 0, movements: [] });
  });
});
