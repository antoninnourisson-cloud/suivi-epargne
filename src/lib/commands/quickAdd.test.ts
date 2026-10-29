import { describe, it, expect } from 'vitest';
import { AccountType, SavingsAccount } from '../../types';
import { computeMonthSavedAmount, isSavingsFlow } from '../finance';
import { applyPatch, CommandState, quickAdd } from './index';
import { isQuickAddInterest } from './quickAdd';

const ok = <T extends { ok: boolean }>(r: T) => { if (!r.ok) throw new Error(JSON.stringify(r)); return r as Extract<T, { ok: true }>; };
const pea = (): SavingsAccount => ({
  id: 'pea', name: 'PEA', institution: 'B', type: AccountType.PEA, totalAmount: 1000, ownedAmount: 1000, parentalCapital: 0,
  totalDeposits: 1000, interestRate: 0, movements: [],
});
const livret = (): SavingsAccount => ({
  id: 'la', name: 'Livret A', institution: 'B', type: AccountType.LIVRET_A, totalAmount: 1000, ownedAmount: 1000, parentalCapital: 0,
  interestRate: 1.7, movements: [],
});

describe('ajout rapide : intérêts hors épargne', () => {
  it('la puce « Intérêts » crée un mouvement hors épargne, et le message le dit', () => {
    const s: CommandState = { accounts: [livret()] };
    const r = ok(quickAdd(s, { accountId: 'la', amount: 17, type: 'IN', label: 'Intérêts', date: '2027-01-05', id: 'i' }));
    const a = applyPatch(s, r.next).accounts[0];
    const m = a.movements.find(x => x.id === 'i')!;
    expect(m.kind).toBe('adjustment');
    expect(isSavingsFlow(m)).toBe(false);
    expect(a.ownedAmount).toBe(1017);
    expect(computeMonthSavedAmount([a], new Date(2027, 0, 20))).toBe(0);
    expect(r.message).toContain('comptés comme intérêts (hors épargne)');
  });

  it('un dépôt ordinaire reste de l’épargne ; un retrait « Intérêts » reste un retrait', () => {
    const s: CommandState = { accounts: [livret()] };
    const r = ok(quickAdd(s, { accountId: 'la', amount: 200, type: 'IN', label: 'Épargne du mois', date: '2027-01-05', id: 'e' }));
    const m = applyPatch(s, r.next).accounts[0].movements.find(x => x.id === 'e')!;
    expect(m.kind).toBeUndefined();
    expect(r.message).not.toContain('intérêts');
    expect(isQuickAddInterest({ type: 'OUT', label: 'Intérêts' })).toBe(false);
    expect(isQuickAddInterest({ type: 'IN', label: 'Intérêts 2026' })).toBe(true);
    expect(isQuickAddInterest({ type: 'IN', label: 'Cadeau' })).toBe(false);
  });

  it("des intérêts sur un placement ne gonflent pas ses versements cumulés", () => {
    const s: CommandState = { accounts: [pea()] };
    const r = ok(quickAdd(s, { accountId: 'pea', amount: 30, type: 'IN', label: 'Intérêts', date: '2027-01-05' }));
    const a = applyPatch(s, r.next).accounts[0];
    expect(a.totalDeposits).toBe(1000);
    expect(a.ownedAmount).toBe(1030);
  });
});
