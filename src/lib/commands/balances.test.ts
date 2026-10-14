import { describe, it, expect } from 'vitest';
import { AccountType, SavingsAccount } from '../../types';
import { balanceChangeMovements } from '../accountOps';
import { computeGoodMonths, computePayReview } from '../motivation';
import { computeSavedSince, suggestCreditedInterest } from '../finance';
import { breakdownDraft, draftToUpdate, type Draft } from '../../components/update/draft';
import { applyPatch, CommandState, quickAdd, updateBalances } from './index';

const ok = <T extends { ok: boolean }>(r: T) => { if (!r.ok) throw new Error(JSON.stringify(r)); return r as Extract<T, { ok: true }>; };
const acc = (s: CommandState, id: string) => s.accounts.find(a => a.id === id)!;
const draft = (over: Partial<Draft>): Draft => ({ owned: '', parental: '0', date: '2027-01-05', deposits: '', cashFlow: 0, ...over });

const livretA = (): SavingsAccount => ({
  id: 'la', name: 'Livret A', institution: 'B', type: AccountType.LIVRET_A, totalAmount: 10000, ownedAmount: 10000, parentalCapital: 0,
  interestRate: 2.4, movements: [{ id: 'i', date: '2024-01-01', amount: 10000, label: 'Solde initial', type: 'IN', tag: 'initial' }],
});
const av = (): SavingsAccount => ({
  id: 'av', name: 'Assurance vie', institution: 'A', type: AccountType.ASSURANCE_VIE, totalAmount: 4300, ownedAmount: 4300, parentalCapital: 0,
  totalDeposits: 4000, interestRate: 2.6, movements: [],
});

describe('intérêts crédités proposés à part', () => {
  it("propose de janvier à mars les intérêts de l'année écoulée, moins ce qui est déjà enregistré", () => {
    expect(suggestCreditedInterest(livretA(), '2027-01-05')).toEqual({ year: 2026, amount: 240 });
    expect(suggestCreditedInterest(livretA(), '2027-04-01')).toBeNull();
    const recorded = { ...livretA(), totalAmount: 10200, ownedAmount: 10200, movements: [...livretA().movements!, { id: 'x', date: '2027-01-03', amount: 200, label: 'Intérêts 2026', type: 'IN' as const, kind: 'adjustment' as const }] };
    expect(suggestCreditedInterest(recorded, '2027-01-05')).toEqual({ year: 2026, amount: 40 });
    expect(suggestCreditedInterest({ ...livretA(), interestRate: 0 }, '2027-01-05')).toBeNull();
  });

  it('régression : 300 € versés + intérêts de janvier saisis via Actualiser ⇒ PAS un bon mois', () => {
    let s: CommandState = { accounts: [livretA()] };
    s = applyPatch(s, ok(quickAdd(s, { accountId: 'la', amount: 300, type: 'IN', label: 'Virement de paie', date: '2027-01-02' })).next);
    // Le relevé du 5 janvier affiche 300 € de versement + 240 € d'intérêts 2026.
    const before = acc(s, 'la');
    const d = draft({ owned: '10540' });
    const b = breakdownDraft(before, d);
    expect(b).toMatchObject({ interest: 240, interestLabel: 'Intérêts 2026', rest: 0, changed: true });
    const r = ok(updateBalances(s, { updates: [draftToUpdate(before, d, b)] }));
    s = applyPatch(s, r.next);
    expect(acc(s, 'la')).toMatchObject({ ownedAmount: 10540, totalAmount: 10540 });
    expect(acc(s, 'la').movements!.slice(-1).map(m => [m.label, m.amount, m.kind])).toEqual([['Intérêts 2026', 240, 'adjustment']]);

    const months = computeGoodMonths({ accounts: s.accounts, today: '2027-01-28', paydayDay: 27 });
    const january = months.months.find(m => m.start === '2026-12-27')!;
    expect(january).toMatchObject({ saved: 300, good: false });
    expect(computePayReview({ accounts: s.accounts, goodMonths: months, today: '2027-01-28' })).toMatchObject({ deposits: 300, good: false });
    expect(computeSavedSince(s.accounts, '2027-01-01', new Date(2027, 0, 28))).toBe(300);

    // Sans la ventilation (ancien comportement), le même relevé faisait un « bon mois ».
    const legacy = applyPatch({ accounts: [livretA()] }, ok(updateBalances({ accounts: [livretA()] }, { updates: [{ accountId: 'la', date: '2027-01-05', owned: 10540, parental: 0 }] })).next);
    expect(computeSavedSince(legacy.accounts, '2027-01-01', new Date(2027, 0, 28))).toBe(540);
  });

  it("l'utilisateur corrige la proposition ; au-delà de la hausse, refus", () => {
    const d = draft({ owned: '10540', interest: '100' });
    const b = breakdownDraft(livretA(), d);
    expect(b).toMatchObject({ interest: 100, rest: 440 });
    expect(breakdownDraft(livretA(), draft({ owned: '10540', interest: '600' })).errors.interest).toBeDefined();
    const r = updateBalances({ accounts: [livretA()] }, { updates: [{ accountId: 'la', date: '2027-01-05', owned: 10100, parental: 0, interest: 150 }] });
    expect(r).toMatchObject({ ok: false, code: 'invalid' });
  });

  it('en cours d’année, une hausse de livret reste un versement', () => {
    const b = breakdownDraft(livretA(), draft({ owned: '10300', date: '2026-10-14' }));
    expect(b).toMatchObject({ suggestion: null, interest: 0, rest: 300 });
  });
});

describe('placements : versement ou valorisation', () => {
  it('versements cumulés relevés ⇒ la hausse correspondante est un versement (épargne)', () => {
    const d = draft({ owned: '4500', deposits: '4200' });
    const b = breakdownDraft(av(), d);
    expect(b).toMatchObject({ tracked: true, cash: 200, rest: 0 });
    const s = applyPatch({ accounts: [av()] }, ok(updateBalances({ accounts: [av()] }, { updates: [draftToUpdate(av(), d, b)] })).next);
    expect(acc(s, 'av')).toMatchObject({ ownedAmount: 4500, totalDeposits: 4200 });
    expect(acc(s, 'av').movements!.map(m => [m.label, m.amount, m.kind])).toEqual([['Versement (+)', 200, undefined]]);
  });

  it('versements inchangés ⇒ variation de valeur par défaut ; « dont versé » corrigé ⇒ versements mis à jour', () => {
    const b = breakdownDraft(av(), draft({ owned: '4400', deposits: '4000' }));
    expect(b).toMatchObject({ cash: 0, rest: 100 });
    const d = draft({ owned: '4400', deposits: '4000', cash: '150' });
    const s = applyPatch({ accounts: [av()] }, ok(updateBalances({ accounts: [av()] }, { updates: [draftToUpdate(av(), d)] })).next);
    expect(acc(s, 'av')).toMatchObject({ ownedAmount: 4400, totalDeposits: 4150 });
    expect(acc(s, 'av').movements!.map(m => [m.label, m.amount, m.kind])).toEqual([['Versement (+)', 150, undefined], ['Valorisation (-)', 50, 'valuation']]);
  });

  it('baisse des versements cumulés ⇒ retrait estimé (règle du prorata)', () => {
    // Retrait de 430 € : versements × (1 − 430 / 4 300) = 3 600.
    const b = breakdownDraft(av(), draft({ owned: '3870', deposits: '3600' }));
    expect(b.cash).toBeCloseTo(-430, 2);
    expect(b.rest).toBeCloseTo(0, 2);
  });
});

describe('updateBalances : garde-fous et annulation', () => {
  const state = (): CommandState => ({ accounts: [livretA(), av(), { id: 'lep', name: 'LEP', institution: 'B', type: AccountType.LEP, totalAmount: 10000, ownedAmount: 7500, parentalCapital: 2500, movements: [] }] });

  it('saisie illisible, part négative ou date invalide : refus, jamais 0 €', () => {
    const s = state();
    expect(updateBalances(s, { updates: [{ accountId: 'la', date: '2027-01-05', owned: null, parental: 0 }] })).toMatchObject({ ok: false, code: 'invalid' });
    expect(updateBalances(s, { updates: [{ accountId: 'la', date: '2027-01-05', owned: -0.02, parental: 0 }] })).toMatchObject({ ok: false, code: 'invalid' });
    expect(updateBalances(s, { updates: [{ accountId: 'lep', date: '2027-01-05', owned: 7500, parental: -1 }] })).toMatchObject({ ok: false, code: 'invalid' });
    expect(updateBalances(s, { updates: [{ accountId: 'la', date: '', owned: 1, parental: 0 }] })).toMatchObject({ ok: false, code: 'invalid' });
    expect(updateBalances(s, { updates: [{ accountId: 'av', date: '2027-01-05', owned: 4300, parental: 0, deposits: null }] })).toMatchObject({ ok: false, code: 'invalid' });
    expect(updateBalances(s, { updates: [{ accountId: 'av', date: '2027-01-05', owned: 4300, parental: 0, deposits: 4000, cashFlow: -5000 }] })).toMatchObject({ ok: false, code: 'invalid' });
    expect(updateBalances(s, { updates: [{ accountId: 'la', date: '2027-01-05', owned: 10000, parental: 0 }] })).toMatchObject({ ok: false, code: 'nothing-to-do' });
    expect(breakdownDraft(livretA(), draft({ owned: '1.234,56' })).errors.owned).toBe('Montant non reconnu.');
  });

  it('arrondit au centime, trace la part des parents à part, et s’annule exactement', () => {
    const s0 = state();
    const r = ok(updateBalances(s0, { updates: [
      { accountId: 'lep', date: '2026-10-14', owned: 7600.004, parental: 2400, interest: 0 },
      { accountId: 'la', date: '2026-10-14', owned: 9900, parental: 0 },
      { accountId: 'disparu', date: '2026-10-14', owned: 1, parental: 0 },
    ] }));
    const s1 = applyPatch(s0, r.next);
    expect(r).toMatchObject({ message: '2 comptes actualisés', changedIds: ['lep', 'la'] });
    expect(acc(s1, 'lep')).toMatchObject({ ownedAmount: 7600, parentalCapital: 2400, totalAmount: 10000 });
    expect(acc(s1, 'lep').movements!.map(m => [m.label, m.amount, m.kind])).toEqual([['Actualisation (+)', 100, undefined], ['Part des parents (-)', 100, 'parental']]);
    expect(applyPatch(s1, r.undo(s1))).toEqual(s0);
  });

  it('le repli par le hook (balanceChangeMovements) reprend exactement les mouvements préparés', () => {
    const s0 = state();
    const r = ok(updateBalances(s0, { updates: [{ accountId: 'la', date: '2027-01-05', owned: 10540, parental: 0, interest: 240, interestLabel: 'Intérêts 2026' }] }));
    const planned = acc(applyPatch(s0, r.next), 'la');
    const replayed = balanceChangeMovements(acc(s0, 'la'), planned, '2027-01-05', { ownLabel: 'Actualisation' });
    expect(replayed).toEqual(planned.movements!.slice(-2));
    const avPlanned = acc(applyPatch(s0, ok(updateBalances(s0, { updates: [{ accountId: 'av', date: '2027-01-05', owned: 4500, parental: 0, deposits: 4200, cashFlow: 200 }] })).next), 'av');
    expect(balanceChangeMovements(av(), avPlanned, '2027-01-05', { ownLabel: 'Actualisation', splitValuation: true })).toEqual(avPlanned.movements);
  });
});
