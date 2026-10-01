import { describe, it, expect } from 'vitest';
import { applyMovement, snapshotBalances, restoreBalances, isRestitutionMovement } from './accountOps';
import { AccountType, SavingsAccount, AccountMovement } from '../types';

const acc = (over: Partial<SavingsAccount> = {}): SavingsAccount => ({
  id: 'a', name: 'A', type: AccountType.LIVRET_A, institution: 'B',
  totalAmount: 1500, ownedAmount: 1000, parentalCapital: 500, movements: [], ...over,
});
const mv = (over: Partial<AccountMovement>): AccountMovement => ({ id: 'm', date: '2026-09-01', amount: 100, label: 'x', type: 'IN', ...over });

describe('applyMovement', () => {
  it('part propre, part des parents et total restent cohérents au centime', () => {
    let a = applyMovement(acc(), mv({ id: '1', amount: 0.1 }), 1);
    a = applyMovement(a, mv({ id: '2', amount: 0.2 }), 1);
    expect(a.ownedAmount).toBe(1000.3);
    a = applyMovement(a, mv({ id: '3', amount: 200, kind: 'parental', type: 'OUT' }), 1);
    expect(a.parentalCapital).toBe(300);
    expect(a.totalAmount).toBe(1300.3);
    expect(a.movements?.map(m => m.id)).toEqual(['1', '2', '3']);
  });
  it('retire un mouvement en annulant exactement son effet, versements cumulés compris', () => {
    const av = acc({ type: AccountType.ASSURANCE_VIE, totalDeposits: 800, parentalCapital: 0, totalAmount: 1000 });
    const m = mv({ amount: 200 });
    const after = applyMovement(av, m, 1, { trackDeposits: true });
    expect(after.totalDeposits).toBe(1000);
    const back = applyMovement(after, m, -1, { trackDeposits: true });
    expect(back).toMatchObject({ ownedAmount: 1000, totalAmount: 1000, totalDeposits: 800 });
    expect(back.movements).toEqual([]);
  });
});

describe('annulation exacte', () => {
  it("rétablit l'état d'avant même si la part des parents avait été plafonnée à 0", () => {
    const a = acc({ parentalCapital: 500, movements: [mv({ id: 'p1', amount: 1500, kind: 'parental' }), mv({ id: 'p2', amount: 1000, kind: 'parental', type: 'OUT' })] });
    const snap = snapshotBalances([a], ['a']);
    const deleted = applyMovement(a, a.movements![0], -1); // 500 − 1500 → 0
    expect(deleted.parentalCapital).toBe(0);
    const [restored] = restoreBalances([deleted], snap);
    expect(restored.parentalCapital).toBe(500);
    expect(restored.movements?.length).toBe(2);
  });
  it('conserve les mouvements ajoutés entre-temps, mais jette ceux de l’opération annulée', () => {
    const a = acc();
    const snap = snapshotBalances([a], ['a']);
    let cur = applyMovement(a, mv({ id: 'op', amount: 500, kind: 'parental', type: 'OUT', tag: 'restitution' }), 1);
    cur = applyMovement(cur, mv({ id: 'later', amount: 50 }), 1);
    const [restored] = restoreBalances([cur], snap, ['op']);
    expect(restored).toMatchObject({ ownedAmount: 1050, parentalCapital: 500, totalAmount: 1550 });
    expect(restored.movements?.map(m => m.id)).toEqual(['later']);
    expect(isRestitutionMovement(mv({ tag: 'restitution', label: 'renommé' }))).toBe(true);
  });
});
