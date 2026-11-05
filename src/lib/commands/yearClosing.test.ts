// Clôture de l'année enregistrée en une fois : intérêts, relevés et soldes, taux servi ; un
// seul « Annuler » remet l'état d'avant.
import { describe, it, expect } from 'vitest';
import { AccountType, type SavingsAccount } from '../../types';
import { recordYearClosing } from './yearClosing';
import { applyPatch } from './testHelpers';

const livret: SavingsAccount = {
  id: 'la', name: 'Livret A', type: AccountType.LIVRET_A, institution: 'B', totalAmount: 10000, ownedAmount: 10000, parentalCapital: 0, interestRate: 3,
  balanceCheckedAt: '2026-12-10', movements: [{ id: 'i', date: '2020-01-01', amount: 10000, label: 'Solde initial', type: 'IN', tag: 'initial' }],
};
const lep: SavingsAccount = { ...livret, id: 'lep', name: 'LEP', type: AccountType.LEP, interestRate: 4, totalAmount: 5000, ownedAmount: 5000 };
const av: SavingsAccount = {
  id: 'av', name: 'Assurance vie', type: AccountType.ASSURANCE_VIE, institution: 'A', totalAmount: 5000, ownedAmount: 5000, parentalCapital: 0,
  totalDeposits: 4000, interestRate: 2.5, movements: [],
};

describe('recordYearClosing', () => {
  it('intérêts, relevé et solde en une fois, puis un seul « Annuler »', () => {
    const state = { accounts: [livret, lep, av] };
    const r = recordYearClosing(state, {
      updates: [
        { accountId: 'la', date: '2026-12-31', owned: 10297.7, parental: 0, interest: 297.7, interestLabel: 'Intérêts 2026', interestDate: '2026-12-31' },
        { accountId: 'lep', date: '2026-12-31', owned: 5000, parental: 0, confirm: true },
        { accountId: 'av', date: '2026-12-31', owned: 5300, parental: 0, deposits: 4000, cashFlow: 200, confirm: true },
      ],
      rates: [{ accountId: 'av', rate: 2.7 }],
      date: '2027-01-10',
    });
    if (!r.ok) throw new Error(r.error);
    const after = applyPatch(state, r.next);
    const [la, l, a] = after.accounts;
    expect(la.ownedAmount).toBe(10297.7);
    expect(la.movements.at(-1)).toEqual(expect.objectContaining({ kind: 'adjustment', amount: 297.7, date: '2026-12-31', label: 'Intérêts 2026' }));
    expect(l.balanceCheckedAt).toBe('2026-12-31');
    expect(a.ownedAmount).toBe(5300);
    expect(a.totalDeposits).toBe(4200);
    expect(a.interestRate).toBe(2.7);
    expect(r.accountIds.sort()).toEqual(['av', 'la', 'lep']);

    const undone = applyPatch(after, r.undo(after));
    expect(undone.accounts.map(x => [x.ownedAmount, x.movements.length, x.balanceCheckedAt, x.interestRate, x.totalDeposits])).toEqual(
      state.accounts.map(x => [x.ownedAmount, x.movements.length, x.balanceCheckedAt, x.interestRate, x.totalDeposits]));
    expect(undone.accounts[2].rateHistory).toBeUndefined();
  });

  it('taux inchangé : noté sur le compte ; rien à faire : refus', () => {
    const r = recordYearClosing({ accounts: [av] }, { updates: [], rates: [{ accountId: 'av', rate: 2.5 }], date: '2027-01-10' });
    if (!r.ok) throw new Error(r.error);
    expect(r.next.accounts![0].rateReviewedAt).toBe('2027-01-10');
    expect(recordYearClosing({ accounts: [av] }, { updates: [], rates: [], date: '2027-01-10' })).toEqual(expect.objectContaining({ ok: false, code: 'nothing-to-do' }));
    expect(recordYearClosing({ accounts: [av] }, { updates: [], rates: [{ accountId: 'av', rate: 99 }], date: '2027-01-10' })).toEqual(expect.objectContaining({ ok: false, code: 'invalid' }));
  });
});
