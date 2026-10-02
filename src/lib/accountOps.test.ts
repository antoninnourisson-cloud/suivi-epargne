import { describe, it, expect } from 'vitest';
import { applyMovement, balanceChangeMovements, snapshotBalances, restoreBalances, isRestitutionMovement, findCancellingGroups } from './accountOps';
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

describe('findCancellingGroups', () => {
  it('repère les mouvements du même jour qui s’annulent, pas les autres', () => {
    const a = acc({ movements: [
      mv({ id: '1', date: '2026-08-26', amount: 2, label: 'Test final A' }),
      mv({ id: '2', date: '2026-08-26', amount: 2, type: 'OUT', label: 'Test final B' }),
      mv({ id: '3', date: '2026-08-26', amount: 1 }), mv({ id: '4', date: '2026-08-26', amount: 1, type: 'OUT' }),
      mv({ id: '5', date: '2026-09-01', amount: 500 }), mv({ id: '6', date: '2026-09-01', amount: 200, type: 'OUT' }),
      mv({ id: '7', date: '2026-09-02', amount: 100, linkId: 'l' }), mv({ id: '8', date: '2026-09-02', amount: 100, type: 'OUT', linkId: 'l' }),
    ] });
    const g = findCancellingGroups([a]);
    expect(g.map(x => x.date)).toEqual(['2026-08-26']);
    expect(g[0].movements.map(m => m.id)).toEqual(['1', '2', '3', '4']);
  });
});

describe('balanceChangeMovements', () => {
  const base = { id: 'a', name: 'A', institution: 'B', type: 'Livret A', totalAmount: 150, ownedAmount: 100, parentalCapital: 50, movements: [] } as any;
  it('trace votre part et celle des parents séparément', () => {
    const m = balanceChangeMovements(base, { ...base, ownedAmount: 120, parentalCapital: 40, totalAmount: 160 }, '2026-10-02', { ownLabel: 'Correction de solde' });
    expect(m.map(x => [x.label, x.type, x.amount, x.kind])).toEqual([
      ['Correction de solde (+)', 'IN', 20, undefined],
      ['Part des parents (-)', 'OUT', 10, 'parental'],
    ]);
  });
  it('sépare versement et variation de valeur sur un placement', () => {
    const av = { ...base, type: 'Assurance Vie', parentalCapital: 0, totalAmount: 100, totalDeposits: 90 };
    const m = balanceChangeMovements(av, { ...av, ownedAmount: 160, totalAmount: 160 }, '2026-10-02', { ownLabel: 'Actualisation', cashFlow: 50, splitValuation: true });
    expect(m.map(x => [x.label, x.amount, x.kind])).toEqual([['Versement (+)', 50, undefined], ['Valorisation (+)', 10, 'valuation']]);
  });
  it('ne crée rien sans changement', () => {
    expect(balanceChangeMovements(base, { ...base }, '2026-10-02', { ownLabel: 'X' })).toEqual([]);
  });
});
