// « Les taux ont changé » : taux datés sur tous les comptes du groupe (le LDDS avec le
// Livret A), autres comptes seulement s'ils changent, un seul « Annuler ».
import { describe, it, expect } from 'vitest';
import { AccountType, type SavingsAccount } from '../../types';
import { applyRateChanges, type CommandState } from './index';
import { applyPatch } from './testHelpers';

const acc = (id: string, name: string, type: AccountType, interestRate?: number): SavingsAccount => ({
  id, name, institution: 'B', type, totalAmount: 1000, ownedAmount: 1000, parentalCapital: 0, movements: [], ...(interestRate !== undefined ? { interestRate } : {}),
});
const state = (): CommandState => ({
  accounts: [
    acc('la', 'Livret A', AccountType.LIVRET_A, 1.7),
    acc('ldds', 'LDDS', AccountType.LDDS, 1.7),
    acc('lep', 'LEP', AccountType.LEP, 2.5),
    acc('lb', 'Livret Plus', AccountType.LIVRET_BANCAIRE, 3),
    acc('av', 'Assurance vie', AccountType.ASSURANCE_VIE, 2.6),
    acc('cc', 'Compte courant', AccountType.COMPTE_COURANT),
  ],
});
const byId = (s: CommandState, id: string): SavingsAccount => s.accounts.find(a => a.id === id)!;

describe('applyRateChanges', () => {
  it('Livret A et LDDS ensemble, un autre compte corrigé, l’inchangé laissé ; un seul « Annuler »', () => {
    const s = state();
    const r = applyRateChanges(s, {
      groups: [{ key: 'livretA', rate: 1.5, date: '2027-02-01' }],
      accounts: [{ accountId: 'lb', rate: 2.5, date: '2027-02-01' }, { accountId: 'av', rate: 2.6, date: '2027-02-01' }],
    });
    if (!r.ok) throw new Error(r.error);
    const after = applyPatch(s, r.next);
    expect(r.accountIds).toEqual(['la', 'ldds', 'lb']);
    for (const id of ['la', 'ldds']) {
      expect(byId(after, id)).toMatchObject({ interestRate: 1.5, rateHistory: [{ date: '2027-02-01', rate: 1.7 }] });
    }
    expect(byId(after, 'lb')).toMatchObject({ interestRate: 2.5, rateHistory: [{ date: '2027-02-01', rate: 3 }] });
    expect(byId(after, 'av')).toBe(byId(s, 'av'));
    expect(byId(after, 'lep')).toBe(byId(s, 'lep'));
    expect(r.message).toBe('Taux mis à jour sur 3 comptes');
    expect(applyPatch(after, r.undo(after))).toEqual(s);
    expect(s).toEqual(state());
  });

  it('un seul compte : le message le nomme ; groupe LEP seul', () => {
    const r = applyRateChanges(state(), { groups: [], accounts: [{ accountId: 'av', rate: 2.4, date: '2026-11-04' }] });
    expect(r.ok && r.message).toBe('Taux de l\'Assurance vie : 2,4 %');
    const lep = applyRateChanges(state(), { groups: [{ key: 'lep', rate: 2.2, date: '2027-02-01' }], accounts: [] });
    expect(lep.ok && lep.message).toBe('Taux du LEP : 2,2 %');
  });

  it('refus : rien à changer, taux ou date illisible, groupe inconnu ; compte disparu ignoré', () => {
    const s = state();
    expect(applyRateChanges(s, { groups: [], accounts: [{ accountId: 'lb', rate: 3, date: '2027-02-01' }, { accountId: 'parti', rate: 1, date: '2027-02-01' }] }))
      .toMatchObject({ ok: false, code: 'nothing-to-do' });
    expect(applyRateChanges(s, { groups: [{ key: 'livretA', rate: -1, date: '2027-02-01' }], accounts: [] })).toMatchObject({ ok: false, code: 'invalid' });
    expect(applyRateChanges(s, { groups: [{ key: 'livretA', rate: 21, date: '2027-02-01' }], accounts: [] })).toMatchObject({ ok: false, code: 'invalid' });
    expect(applyRateChanges(s, { groups: [{ key: 'livretA', rate: 1.5, date: '1er février' }], accounts: [] })).toMatchObject({ ok: false, code: 'invalid' });
    expect(applyRateChanges(s, { groups: [{ key: 'pel', rate: 1.5, date: '2027-02-01' }], accounts: [] })).toMatchObject({ ok: false, code: 'invalid' });
  });
});
