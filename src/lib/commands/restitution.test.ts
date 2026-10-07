import { describe, it, expect } from 'vitest';
import { AccountType, SavingsAccount } from '../../types';
import { isRestitutionMovement } from '../accountOps';
import { applyPatch, CommandState, recordRestitution, undoRestitution, quickAdd, deleteMovement } from './index';

const accounts = (): SavingsAccount[] => [
  { id: 'la', name: 'Livret A', institution: 'B', type: AccountType.LIVRET_A, totalAmount: 15200, ownedAmount: 8200, parentalCapital: 7000, interestRate: 2.4,
    movements: [{ id: 'm1', date: '2026-03-01', amount: 200, label: 'Versement', type: 'IN' }] },
  { id: 'lep', name: 'LEP', institution: 'B', type: AccountType.LEP, totalAmount: 10000, ownedAmount: 7500, parentalCapital: 2500, interestRate: 3.5, movements: [] },
  { id: 'av', name: 'Assurance vie', institution: 'A', type: AccountType.ASSURANCE_VIE, totalAmount: 4300, ownedAmount: 4300, parentalCapital: 0, totalDeposits: 4000, interestRate: 2.6, movements: [] },
];
const initial = (): CommandState => ({ accounts: accounts(), parentalRestitution: { plannedDate: '2027-01-01' } });
const ok = <T extends { ok: boolean }>(r: T) => { if (!r.ok) throw new Error(JSON.stringify(r)); return r as Extract<T, { ok: true }>; };

describe('recordRestitution', () => {
  it("retire exactement la part des parents de chaque compte, sans toucher à la part propre, et passe en mode solo", () => {
    const s0 = initial();
    const r = ok(recordRestitution(s0, { date: '2027-01-01' }));
    const s1 = applyPatch(s0, r.next);
    for (const before of s0.accounts) {
      const after = s1.accounts.find(a => a.id === before.id)!;
      expect(after.parentalCapital).toBe(0);
      expect(after.ownedAmount).toBe(before.ownedAmount);
      expect(after.totalDeposits).toBe(before.totalDeposits);
      expect(after.totalAmount).toBe(before.ownedAmount);
      const restit = (after.movements || []).filter(isRestitutionMovement);
      expect(restit.map(m => [m.amount, m.type, m.kind, m.date])).toEqual(before.parentalCapital > 0 ? [[before.parentalCapital, 'OUT', 'parental', '2027-01-01']] : []);
    }
    expect(s1.accounts.some(a => a.parentalCapital > 0)).toBe(false);
    expect(r.total).toBe(9500);
    expect(r.message).toMatch(/^Restitution enregistrée : 9\s500\s€$/);
    // l'entrée d'origine n'est pas modifiée
    expect(s0).toEqual(initial());
  });

  it('enregistre le relevé : montants par compte et intérêts offerts de l’année', () => {
    const r = ok(recordRestitution(initial(), { date: '2027-01-01' }));
    const done = r.next.parentalRestitution?.done;
    expect(r.next.parentalRestitution?.plannedDate).toBe('2027-01-01');
    expect(done?.date).toBe('2027-01-01');
    expect(done?.accounts).toEqual([
      { accountId: 'la', name: 'Livret A', amount: 7000 },
      { accountId: 'lep', name: 'LEP', amount: 2500 },
    ]);
    // année 2026 complète : 7000 × 2,4 % + 2500 × 3,5 % = 168 + 87,5
    expect(done?.interestsOffered).toEqual([{ year: 2026, amount: 255.5 }]);
  });

  it('refuse de tourner deux fois, une date invalide, ou sans part parentale', () => {
    const s0 = initial();
    const s1 = applyPatch(s0, ok(recordRestitution(s0, { date: '2027-01-01' })).next);
    expect(recordRestitution(s1, { date: '2027-01-02' })).toMatchObject({ ok: false, code: 'already-done' });
    expect(recordRestitution(s0, { date: '' })).toMatchObject({ ok: false, code: 'invalid' });
    const solo: CommandState = { accounts: s0.accounts.map(a => ({ ...a, parentalCapital: 0, totalAmount: a.ownedAmount })) };
    expect(recordRestitution(solo, { date: '2027-01-01' })).toMatchObject({ ok: false, code: 'nothing-to-do' });
  });

  it("l'annulation (toast) rend soldes, mouvements et relevé à l'identique", () => {
    const s0 = initial();
    const r = ok(recordRestitution(s0, { date: '2027-01-01' }));
    const s1 = applyPatch(s0, r.next);
    expect(applyPatch(s1, r.undo(s1))).toEqual(s0);
  });

  it("l'annulation conserve ce qui a été fait depuis (sans jamais recréer de part parentale fantôme)", () => {
    const s0 = initial();
    const r = ok(recordRestitution(s0, { date: '2027-01-01' }));
    let s = applyPatch(s0, r.next);
    const add = ok(quickAdd(s, { accountId: 'la', amount: 100, type: 'IN', label: 'Paie', date: '2027-01-05', id: 'later' }));
    s = applyPatch(s, add.next);
    s = applyPatch(s, r.undo(s));
    const la = s.accounts.find(a => a.id === 'la')!;
    expect(la).toMatchObject({ ownedAmount: 8300, parentalCapital: 7000, totalAmount: 15300 });
    expect(la.movements?.map(m => m.id)).toEqual(['m1', 'later']);
    expect(s.parentalRestitution).toEqual({ plannedDate: '2027-01-01' });
  });
});

describe('undoRestitution (depuis l’écran)', () => {
  it('retire les mouvements de restitution et rétablit la part des parents exactement', () => {
    const s0 = initial();
    const s1 = applyPatch(s0, ok(recordRestitution(s0, { date: '2027-01-01' })).next);
    const u = ok(undoRestitution(s1));
    const s2 = applyPatch(s1, u.next);
    expect(s2).toEqual(s0);
    expect(u.message).toBe('Restitution annulée : la part de vos parents est rétablie');
    // …et cette annulation s'annule à son tour
    expect(applyPatch(s2, u.undo(s2))).toEqual(s1);
  });

  it("ne fait rien s'il n'y a pas de restitution", () => {
    expect(undoRestitution(initial())).toMatchObject({ ok: false, code: 'nothing-to-do' });
  });

  it('un mouvement de restitution ne se supprime pas à la main', () => {
    const s0 = initial();
    const s1 = applyPatch(s0, ok(recordRestitution(s0, { date: '2027-01-01' })).next);
    const id = s1.accounts[0].movements!.find(isRestitutionMovement)!.id;
    expect(deleteMovement(s1, { accountId: 'la', movementId: id })).toMatchObject({ ok: false, code: 'forbidden', error: 'La restitution s\'annule depuis Part parentale.' });
  });
});
