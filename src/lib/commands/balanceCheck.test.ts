// Date du dernier solde constaté (`balanceCheckedAt`) : posée par « Actualiser » et par la
// fiche du compte, jamais par un versement prévu ; annulée avec l'opération.
import { describe, it, expect } from 'vitest';
import { AccountType, SavingsAccount } from '../../types';
import { applyPatch, CommandState, quickAdd, saveAccount, updateBalances, laterDay } from './index';

const ok = <T extends { ok: boolean }>(r: T) => { if (!r.ok) throw new Error(JSON.stringify(r)); return r as Extract<T, { ok: true }>; };
const acc = (s: CommandState, id: string) => s.accounts.find(a => a.id === id)!;
const livret = (over: Partial<SavingsAccount> = {}): SavingsAccount => ({
  id: 'la', name: 'Livret A', institution: 'B', type: AccountType.LIVRET_A, totalAmount: 1000, ownedAmount: 1000, parentalCapital: 0,
  interestRate: 1.7, movements: [], balanceCheckedAt: '2026-05-01', ...over,
});

describe('laterDay', () => {
  it('garde la plus récente des deux dates', () => {
    expect(laterDay(undefined, '2026-10-01')).toBe('2026-10-01');
    expect(laterDay('2026-11-01', '2026-10-01')).toBe('2026-11-01');
    expect(laterDay('2026-09-01', '2026-10-01')).toBe('2026-10-01');
  });
});

describe('fiche du compte', () => {
  it('nouveau compte : solde constaté le jour de la création', () => {
    const r = ok(saveAccount({ accounts: [] }, { account: livret({ id: 'n', balanceCheckedAt: undefined }), today: '2026-10-21' }));
    expect(acc(applyPatch({ accounts: [] }, r.next), 'n').balanceCheckedAt).toBe('2026-10-21');
  });

  it('solde corrigé : constaté aujourd’hui ; simple renommage : date inchangée', () => {
    const s: CommandState = { accounts: [livret()] };
    const changed = ok(saveAccount(s, { account: { ...livret(), ownedAmount: 1200, totalAmount: 1200 }, today: '2026-10-21' }));
    expect(acc(applyPatch(s, changed.next), 'la').balanceCheckedAt).toBe('2026-10-21');
    const renamed = ok(saveAccount(s, { account: { ...livret(), name: 'Livret A Banque' }, today: '2026-10-21' }));
    expect(acc(applyPatch(s, renamed.next), 'la').balanceCheckedAt).toBe('2026-05-01');
  });

  it('« Solde vérifié » : la date passée est gardée, et l’annulation la remet', () => {
    const s: CommandState = { accounts: [livret()] };
    const r = ok(saveAccount(s, { account: { ...livret(), balanceCheckedAt: '2026-10-21' }, today: '2026-10-21' }));
    const next = applyPatch(s, r.next);
    expect(acc(next, 'la').balanceCheckedAt).toBe('2026-10-21');
    expect(acc(next, 'la').movements).toEqual([]);
    expect(acc(applyPatch(next, r.undo(next)), 'la').balanceCheckedAt).toBe('2026-05-01');
  });
});

describe('Actualiser', () => {
  const update = (date: string, owned = 1100) => ({ accountId: 'la', date, owned, parental: 0 });

  it('pose la date du relevé, sans jamais la faire reculer ; l’annulation remet l’ancienne', () => {
    const s: CommandState = { accounts: [livret()] };
    const r = ok(updateBalances(s, { updates: [update('2026-10-20')] }));
    const next = applyPatch(s, r.next);
    expect(acc(next, 'la').balanceCheckedAt).toBe('2026-10-20');
    expect(acc(applyPatch(next, r.undo(next)), 'la').balanceCheckedAt).toBe('2026-05-01');

    const older = ok(updateBalances({ accounts: [livret({ balanceCheckedAt: '2026-10-21' })] }, { updates: [update('2026-09-30')] }));
    expect(older.next.accounts![0].balanceCheckedAt).toBe('2026-10-21');
  });

  it('annulation d’un compte jamais vérifié : le champ disparaît', () => {
    const s: CommandState = { accounts: [livret({ balanceCheckedAt: undefined })] };
    const r = ok(updateBalances(s, { updates: [update('2026-10-20')] }));
    const next = applyPatch(s, r.next);
    expect('balanceCheckedAt' in acc(applyPatch(next, r.undo(next)), 'la')).toBe(false);
  });

  it('un versement de la paie (ajout rapide) ne compte pas comme un solde constaté', () => {
    const s: CommandState = { accounts: [livret()] };
    const r = ok(quickAdd(s, { accountId: 'la', amount: 200, type: 'IN', label: 'Épargne du mois', date: '2026-10-21' }));
    expect(acc(applyPatch(s, r.next), 'la').balanceCheckedAt).toBe('2026-05-01');
  });
});
