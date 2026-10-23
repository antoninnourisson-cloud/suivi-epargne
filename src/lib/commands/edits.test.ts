import { describe, it, expect } from 'vitest';
import { AccountType, type SavingsAccount } from '../../types';
import { renameMovement, revertRateChange, toggleMovementAdjustment } from './edits';
import { applyPatch } from './types';

const account = (id: string, type: AccountType, extra: Partial<SavingsAccount> = {}): SavingsAccount => ({
  id, name: id, institution: 'Banque', type, totalAmount: 100, ownedAmount: 100, parentalCapital: 0, movements: [], ...extra,
});

describe('renommer un mouvement', () => {
  const accounts = [account('a', AccountType.LIVRET_A, {
    movements: [
      { id: 'm1', date: '2026-01-05', amount: 10, label: 'Ancien', type: 'IN' },
      { id: 'r1', date: '2027-01-01', amount: 50, label: 'Restitution aux parents', type: 'OUT', kind: 'parental', tag: 'restitution' },
    ],
  })];
  it('change seulement le libellé du mouvement visé', () => {
    const next = renameMovement(accounts, 'a', 'm1', 'Nouveau');
    expect(next[0].movements![0]).toEqual({ ...accounts[0].movements![0], label: 'Nouveau' });
    expect(next[0].movements![1]).toBe(accounts[0].movements![1]);
  });
  it('libellé vide, mouvement introuvable ou restitution aux parents : rien ne change', () => {
    expect(renameMovement(accounts, 'a', 'm1', '')).toBe(accounts);
    expect(renameMovement(accounts, 'a', 'absent', 'X')).toBe(accounts);
    expect(renameMovement(accounts, 'a', 'r1', 'X')).toBe(accounts);
  });
});

describe('marquer un mouvement comme ajustement', () => {
  it('pose puis retire la marque, sans toucher aux autres mouvements', () => {
    const accounts = [account('a', AccountType.LIVRET_A, {
      movements: [
        { id: 'm1', date: '2026-01-05', amount: 10, label: 'Intérêts', type: 'IN' },
        { id: 'm2', date: '2026-01-06', amount: 5, label: 'Autre', type: 'IN' },
      ],
    }), account('b', AccountType.LDDS)];
    const marked = toggleMovementAdjustment(accounts, 'a', 'm1');
    expect(marked[0].movements![0].kind).toBe('adjustment');
    expect(marked[0].movements![1].kind).toBeUndefined();
    expect(marked[1]).toBe(accounts[1]);
    expect(toggleMovementAdjustment(marked, 'a', 'm1')[0].movements![0].kind).toBeUndefined();
  });
});

describe('annuler un changement de taux', () => {
  const change = '2026-08-01';
  const state = () => ({
    accounts: [
      account('la', AccountType.LIVRET_A, { interestRate: 1.7, rateHistory: [{ date: '2026-02-01', rate: 2.4 }, { date: change, rate: 2.4 }], rateReviewedAt: '2026-08-02' }),
      account('ldds', AccountType.LDDS, { interestRate: 1.7, rateHistory: [{ date: change, rate: 2.4 }], rateReviewedAt: '2026-07-01' }),
      account('lep', AccountType.LEP, { interestRate: 2.7, rateHistory: [{ date: change, rate: 3.5 }] }),
    ],
  });

  it('annule sur tout le groupe Livret A et LDDS, jamais sur le LEP', () => {
    const r = revertRateChange(state(), { accountId: 'la', entryDate: change });
    if (!r.ok) throw new Error(r.error);
    expect(r.count).toBe(2);
    expect(r.message).toBe('Changement de taux annulé (2 comptes)');
    const [la, ldds, lep] = r.next.accounts!;
    expect(la).toMatchObject({ interestRate: 2.4, rateHistory: [{ date: '2026-02-01', rate: 2.4 }] });
    // Révision faite à partir du changement : le rappel de révision reprend.
    expect(la.rateReviewedAt).toBeUndefined();
    // Dernière entrée retirée : plus d'historique ; révision plus ancienne gardée.
    expect(ldds).toMatchObject({ interestRate: 2.4, rateHistory: undefined, rateReviewedAt: '2026-07-01' });
    expect(lep).toEqual(state().accounts[2]);
  });

  it('« Rétablir » remet exactement les taux, historiques et révisions d’avant', () => {
    const before = state();
    const r = revertRateChange(before, { accountId: 'la', entryDate: change });
    if (!r.ok) throw new Error(r.error);
    const after = applyPatch(before, r.next);
    const restored = applyPatch(after, r.undo(after));
    for (const id of ['la', 'ldds']) {
      const a = restored.accounts.find(x => x.id === id)!;
      const b = before.accounts.find(x => x.id === id)!;
      expect({ rate: a.interestRate, history: a.rateHistory, reviewed: a.rateReviewedAt })
        .toEqual({ rate: b.interestRate, history: b.rateHistory, reviewed: b.rateReviewedAt });
    }
  });

  it('un seul compte concerné : message au singulier ; compte disparu : refus silencieux', () => {
    const r = revertRateChange(state(), { accountId: 'lep', entryDate: change });
    expect(r.ok && r.message).toBe('Changement de taux annulé');
    const missing = revertRateChange(state(), { accountId: 'absent', entryDate: change });
    expect(missing).toMatchObject({ ok: false, code: 'not-found' });
  });
});
