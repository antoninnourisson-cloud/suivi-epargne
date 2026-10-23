import { describe, it, expect } from 'vitest';
import { AccountType, type SavingsAccount } from '../../types';
import { applyPatch, importStatement, quickAdd, type CommandState } from './index';

const ok = <T extends { ok: boolean }>(r: T) => { if (!r.ok) throw new Error(JSON.stringify(r)); return r as Extract<T, { ok: true }>; };
const get = (s: CommandState, id: string) => s.accounts.find(a => a.id === id)!;

const livretA = (): SavingsAccount => ({
  id: 'la', name: 'Livret A', institution: 'B', type: AccountType.LIVRET_A, totalAmount: 15200, ownedAmount: 8200, parentalCapital: 7000,
  balanceCheckedAt: '2026-09-10', movements: [{ id: 'i', date: '2024-01-01', amount: 8200, label: 'Solde initial', type: 'IN', tag: 'initial' }],
});
const courant = (): SavingsAccount => ({
  id: 'cc', name: 'Compte courant', institution: 'B', type: AccountType.COMPTE_COURANT, totalAmount: 3900, ownedAmount: 3900, parentalCapital: 0, movements: [],
});
const av = (): SavingsAccount => ({
  id: 'av', name: 'Assurance vie', institution: 'A', type: AccountType.ASSURANCE_VIE, totalAmount: 4300, ownedAmount: 4300, parentalCapital: 0, totalDeposits: 4000, movements: [],
});
const state = (): CommandState => ({ accounts: [livretA(), courant(), av()] });

describe('importStatement', () => {
  it("ajoute les opérations cochées puis fixe le solde du relevé ; l'annulation est exacte", () => {
    const s0 = state();
    const r = ok(importStatement(s0, { items: [
      { accountId: 'la', date: '2026-09-30', closingBalance: 15362.3, movements: [
        { date: '2026-09-20', label: 'VIR PRIME', amount: 150, type: 'IN' },
        { date: '2026-09-30', label: 'INTERETS', amount: 12.3, type: 'IN', interest: true },
      ] },
      { accountId: 'cc', date: '2026-09-30', closingBalance: 3087.6, movements: [] },
    ] }));
    expect(r.message).toBe("2 comptes mis à jour d'après le relevé (2 opérations ajoutées)");
    expect(r.changedIds).toEqual(['la', 'cc']);
    expect(r.added).toBe(2);
    const s1 = applyPatch(s0, r.next);
    const la = get(s1, 'la');
    // Part des parents intacte, total = part propre + parents.
    expect(la).toMatchObject({ ownedAmount: 8362.3, parentalCapital: 7000, totalAmount: 15362.3, balanceCheckedAt: '2026-09-30' });
    const added = la.movements!.slice(1);
    expect(added.map(m => [m.label, m.amount, m.type, m.kind])).toEqual([['VIR PRIME', 150, 'IN', undefined], ['INTERETS', 12.3, 'IN', 'adjustment']]);
    // Compte courant : écart enregistré comme dans Actualiser.
    const cc = get(s1, 'cc');
    expect(cc).toMatchObject({ ownedAmount: 3087.6, totalAmount: 3087.6, balanceCheckedAt: '2026-09-30' });
    expect(cc.movements!.map(m => [m.label, m.amount, m.type])).toEqual([['Actualisation (-)', 812.4, 'OUT']]);
    expect(r.createdIds).toHaveLength(3);

    const back = applyPatch(s1, r.undo(s1));
    expect(back.accounts).toEqual(s0.accounts);
  });

  it("l'annulation garde ce qui a été fait depuis", () => {
    const s0 = state();
    const r = ok(importStatement(s0, { items: [{ accountId: 'la', date: '2026-09-30', movements: [{ date: '2026-09-20', label: 'VIR', amount: 100, type: 'IN' }] }] }));
    expect(r.message).toBe("Livret A mis à jour d'après le relevé (1 opération ajoutée)");
    const s1 = applyPatch(s0, r.next);
    const later = ok(quickAdd(s1, { accountId: 'la', amount: 50, type: 'IN', label: 'Après', date: '2026-10-01' }));
    const s2 = applyPatch(s1, later.next);
    const back = applyPatch(s2, r.undo(s2));
    expect(get(back, 'la')).toMatchObject({ ownedAmount: 8250, totalAmount: 15250, balanceCheckedAt: '2026-09-10' });
    expect(get(back, 'la').movements!.map(m => m.label)).toEqual(['Solde initial', 'Après']);
  });

  it('placement suivi : versements cumulés mis à jour, reste de l\'écart en valorisation', () => {
    const s0 = state();
    const r = ok(importStatement(s0, { items: [{ accountId: 'av', date: '2026-09-30', closingBalance: 4600, movements: [{ date: '2026-09-15', label: 'Versement', amount: 200, type: 'IN' }] }] }));
    const a = get(applyPatch(s0, r.next), 'av');
    expect(a).toMatchObject({ ownedAmount: 4600, totalDeposits: 4200 });
    expect(a.movements!.map(m => [m.label, m.amount, m.kind])).toEqual([['Versement', 200, undefined], ['Valorisation (+)', 100, 'valuation']]);
  });

  it('solde identique : seule la date du constat avance ; rien à faire sinon', () => {
    const s0 = state();
    const r = ok(importStatement(s0, { items: [{ accountId: 'la', date: '2026-09-30', closingBalance: 15200, movements: [] }] }));
    const la = get(applyPatch(s0, r.next), 'la');
    expect(la).toMatchObject({ ownedAmount: 8200, balanceCheckedAt: '2026-09-30' });
    expect(la.movements).toHaveLength(1);
    expect(r.message).toBe("Livret A mis à jour d'après le relevé");
    // Relevé plus ancien que le dernier constat, même solde : rien ne change.
    const none = importStatement(s0, { items: [{ accountId: 'la', date: '2026-08-31', closingBalance: 15200, movements: [] }] });
    expect(none).toMatchObject({ ok: false, code: 'nothing-to-do' });
    // Compte disparu, compte en double : ignorés.
    expect(importStatement(s0, { items: [{ accountId: 'x', date: '2026-09-30', closingBalance: 1, movements: [] }] })).toMatchObject({ ok: false, code: 'nothing-to-do' });
    const twice = ok(importStatement(s0, { items: [
      { accountId: 'cc', date: '2026-09-30', closingBalance: 4000, movements: [] },
      { accountId: 'cc', date: '2026-09-30', closingBalance: 9000, movements: [] },
    ] }));
    expect(get(applyPatch(s0, twice.next), 'cc').totalAmount).toBe(4000);
  });

  it("le solde d'un relevé plus ancien que le compte n'est repris que sur choix explicite", () => {
    const s0 = state();
    // Dernier solde vérifié du Livret A : 10/09.
    const checked = importStatement(s0, { items: [{ accountId: 'la', date: '2026-08-31', closingBalance: 15000, movements: [] }] });
    expect(checked).toMatchObject({ ok: false, code: 'invalid' });
    expect(!checked.ok && checked.error).toBe("Livret A : ce relevé (31/08/2026) est plus ancien que votre dernier solde vérifié (10/09/2026) : son solde n'est pas repris.");
    // Mouvement enregistré après la date du relevé.
    const s1 = applyPatch(s0, ok(quickAdd(s0, { accountId: 'cc', amount: 100, type: 'OUT', label: 'CB', date: '2026-10-05' })).next);
    const moved = importStatement(s1, { items: [{ accountId: 'cc', date: '2026-09-30', closingBalance: 3900, movements: [] }] });
    expect(!moved.ok && moved.error).toContain("plus ancien qu'un mouvement déjà enregistré (05/10/2026)");
    // Choisi quand même : repris, la date du dernier constat ne recule pas.
    const forced = ok(importStatement(s0, { items: [{ accountId: 'la', date: '2026-08-31', closingBalance: 15000, allowOlder: true, movements: [] }] }));
    expect(get(applyPatch(s0, forced.next), 'la')).toMatchObject({ totalAmount: 15000, ownedAmount: 8000, balanceCheckedAt: '2026-09-10' });
    expect(applyPatch(s0, forced.undo(applyPatch(s0, forced.next))).accounts).toEqual(s0.accounts);
  });

  it('la part des parents ne peut jamais être retirée', () => {
    const s0 = state();
    const tooBig = importStatement(s0, { items: [{ accountId: 'la', date: '2026-09-30', movements: [{ date: '2026-09-20', label: 'GROS RETRAIT', amount: 9000, type: 'OUT' }] }] });
    expect(tooBig).toMatchObject({ ok: false, code: 'forbidden' });
    expect(!tooBig.ok && tooBig.error).toContain('GROS RETRAIT');
    const below = importStatement(s0, { items: [{ accountId: 'la', date: '2026-09-30', closingBalance: 6000, movements: [] }] });
    expect(below).toMatchObject({ ok: false, code: 'forbidden' });
    expect(!below.ok && below.error).toContain('part de vos parents');
    const negative = importStatement(s0, { items: [{ accountId: 'cc', date: '2026-09-30', closingBalance: -20, movements: [] }] });
    expect(!negative.ok && negative.error).toContain('négatif');
    // Le même jour, une entrée passe avant une sortie (virement reçu puis dépensé).
    const sameDay = ok(importStatement(s0, { items: [{ accountId: 'cc', date: '2026-09-30', movements: [
      { date: '2026-09-20', label: 'CB', amount: 4000, type: 'OUT' },
      { date: '2026-09-20', label: 'SALAIRE', amount: 2000, type: 'IN' },
    ] }] }));
    expect(get(applyPatch(s0, sameDay.next), 'cc').ownedAmount).toBe(1900);
  });

  it('tout ou rien : un compte refusé, rien n\'est enregistré ; saisies illisibles refusées', () => {
    const s0 = state();
    const r = importStatement(s0, { items: [
      { accountId: 'cc', date: '2026-09-30', closingBalance: 4000, movements: [] },
      { accountId: 'la', date: '2026-09-30', closingBalance: 10, movements: [] },
    ] });
    expect(r.ok).toBe(false);
    expect(importStatement(s0, { items: [{ accountId: 'la', date: '30/09/2026', closingBalance: 1, movements: [] }] })).toMatchObject({ ok: false, code: 'invalid' });
    expect(importStatement(s0, { items: [{ accountId: 'la', date: '2026-09-30', movements: [{ date: '2026-09-31', label: 'X', amount: 1, type: 'IN' }] }] })).toMatchObject({ ok: false, code: 'invalid' });
    expect(importStatement(s0, { items: [{ accountId: 'la', date: '2026-09-30', movements: [{ date: '2026-09-20', label: 'X', amount: 0, type: 'IN' }] }] })).toMatchObject({ ok: false, code: 'invalid' });
    expect(importStatement(s0, { items: [{ accountId: 'la', date: '2026-09-30', closingBalance: Number.NaN, movements: [] }] })).toMatchObject({ ok: false, code: 'invalid' });
    // Libellé vide : « Opération ».
    const blank = ok(importStatement(s0, { items: [{ accountId: 'la', date: '2026-09-30', movements: [{ date: '2026-09-20', label: '  ', amount: 1, type: 'IN' }] }] }));
    expect(get(applyPatch(s0, blank.next), 'la').movements!.at(-1)!.label).toBe('Opération');
  });

  it("annulation refusée si un retrait fait depuis dépendait de l'import : rien ne change", () => {
    const s0 = state();
    const r = ok(importStatement(s0, { items: [{ accountId: 'cc', date: '2026-09-30', closingBalance: 9000, movements: [] }] }));
    const s1 = applyPatch(s0, r.next);
    const spent = ok(quickAdd(s1, { accountId: 'cc', amount: 8000, type: 'OUT', label: 'Achat', date: '2026-10-01' }));
    const s2 = applyPatch(s1, spent.next);
    expect(r.undo(s2).accounts).toBe(s2.accounts);
  });
});
