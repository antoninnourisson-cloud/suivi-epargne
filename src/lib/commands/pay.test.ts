import { describe, it, expect } from 'vitest';
import { AccountType, type PayChecklistLine, type PayRecord, type SavingsAccount } from '../../types';
import { computeMonthSavedAmount } from '../finance';
import { applyPatch, CommandState, deletePay, deleteMovement, quickAdd, recordPay, uncheckPayLine, updatePay, PAY_DEPOSIT_LABEL } from './index';
import { payChecklistOf } from '../payRecords';

const ok = <T extends { ok: boolean }>(r: T) => { if (!r.ok) throw new Error(JSON.stringify(r)); return r as Extract<T, { ok: true }>; };

// Livret A avec une part des parents, assurance vie (versements cumulés suivis), compte courant.
const state = (pays?: PayRecord[]): CommandState => ({
  accounts: [
    { id: 'la', name: 'Livret A', institution: 'B', type: AccountType.LIVRET_A, totalAmount: 15200, ownedAmount: 8200, parentalCapital: 7000, interestRate: 2.4, movements: [] },
    { id: 'av', name: 'Assurance vie', institution: 'A', type: AccountType.ASSURANCE_VIE, totalAmount: 4300, ownedAmount: 4300, parentalCapital: 0, totalDeposits: 4000, movements: [] },
    { id: 'pea', name: 'PEA', institution: 'C', type: AccountType.PEA, totalAmount: 1000, ownedAmount: 1000, parentalCapital: 0, totalDeposits: 1000, movements: [] },
  ],
  parentalRestitution: { plannedDate: '2027-01-01' },
  ...(pays ? { pays } : {}),
});
const acc = (s: CommandState, id: string) => s.accounts.find(a => a.id === id)!;

const lines: PayChecklistLine[] = [
  { key: 't:e:loyer', label: 'Revolut commun', amount: 800, kind: 'transfer' },
  { key: 't:leisure', label: 'Argent plaisir', amount: 250, kind: 'transfer' },
  { key: 's:la', label: 'Livret A', amount: 500, kind: 'saving', accountId: 'la' },
  { key: 's:av', label: 'Assurance vie', amount: 400, kind: 'saving', accountId: 'av' },
];
const newPay = { receivedOn: '2026-10-27', amount: 2512.345 };
const allDone = lines.map(l => ({ key: l.key, amount: l.amount }));

describe('recordPay : enregistrer la paie et ce qui a été fait', () => {
  it('« Tout est fait comme conseillé » : la paie, les coches et un versement par ligne d\'épargne, rattachés à la paie', () => {
    const s0 = state([]);
    const r = ok(recordPay(s0, { pay: newPay, lines, done: allDone, transferDate: '2026-10-28', ids: { movements: ['m1', 'm2'] } }));
    const s1 = applyPatch(s0, r.next);
    expect(r.payId).toBe('pay-2026-11');
    expect(r.movementIds).toEqual(['m1', 'm2']);
    expect(r.message).toMatch(/^Paie enregistrée : 2 versements, 900\s€ placés$/);
    expect(s1.pays).toEqual([{
      id: 'pay-2026-11', receivedOn: '2026-10-27', savingsMonth: '2026-11', amount: 2512.35, lines,
      done: {
        't:e:loyer': { amount: 800 }, 't:leisure': { amount: 250 },
        's:la': { amount: 500, movementId: 'm1' }, 's:av': { amount: 400, movementId: 'm2' },
      },
    }]);
    // Versements datés du jour des virements (pas de la paie), libellé habituel, payId.
    expect(acc(s1, 'la').movements).toEqual([{ id: 'm1', date: '2026-10-28', amount: 500, label: PAY_DEPOSIT_LABEL, type: 'IN', payId: 'pay-2026-11' }]);
    expect(acc(s1, 'la')).toMatchObject({ ownedAmount: 8700, parentalCapital: 7000, totalAmount: 15700 });
    expect(acc(s1, 'av')).toMatchObject({ ownedAmount: 4700, totalDeposits: 4400 });
    // Les virements de la paie (charges, plaisir) ne créent rien ; le PEA n'est pas touché.
    expect(acc(s1, 'pea')).toEqual(acc(s0, 'pea'));
    // De l'épargne réelle (pas de `kind`).
    expect(computeMonthSavedAmount(s1.accounts, new Date(2026, 9, 30))).toBe(900);
  });

  it('une seule annulation remet tout exactement (paies et soldes)', () => {
    const s0 = state([]);
    const r = ok(recordPay(s0, { pay: newPay, lines, done: allDone, transferDate: '2026-10-28' }));
    const s1 = applyPatch(s0, r.next);
    expect(applyPatch(s1, r.undo(s1))).toEqual(s0);
    // Sans liste de paies au départ (ancien état) : rendue telle quelle aussi.
    const bare = state();
    const r2 = ok(recordPay(bare, { pay: newPay, lines, done: allDone, transferDate: '2026-10-28' }));
    const b1 = applyPatch(bare, r2.next);
    expect(applyPatch(b1, r2.undo(b1))).toEqual(bare);
  });

  it('annulation après d\'autres changements : la paie retirée, le reste gardé', () => {
    const other: PayRecord = { id: 'sep', receivedOn: '2026-09-26', savingsMonth: '2026-10', amount: 2400, lines: [], done: {} };
    const s0 = state([other]);
    const r = ok(recordPay(s0, { pay: newPay, lines, done: allDone.slice(2, 3), transferDate: '2026-10-28', ids: { movements: ['m1'] } }));
    let s1 = applyPatch(s0, r.next);
    // Entre-temps : la paie de septembre est modifiée, un versement à la main sur le Livret A.
    s1 = applyPatch(s1, ok(updatePay(s1, { payId: 'sep', amount: 2450 })).next);
    s1 = applyPatch(s1, ok(quickAdd(s1, { accountId: 'la', amount: 20, type: 'IN', label: 'x', date: '2026-10-29', id: 'q' })).next);
    const s2 = applyPatch(s1, r.undo(s1));
    expect(s2.pays).toEqual([{ ...other, amount: 2450 }]);
    expect(acc(s2, 'la').movements.map(m => m.id)).toEqual(['q']);
    expect(acc(s2, 'la').ownedAmount).toBe(8220);
  });

  it('montants réels, compte changé et « Autre compte »', () => {
    const s0 = state([]);
    const other: PayChecklistLine = { key: 'a:pea', label: 'PEA', amount: 0, kind: 'saving', accountId: 'pea', added: true };
    const r = ok(recordPay(s0, {
      pay: newPay, lines: [...lines, other],
      done: [
        { key: 's:la', amount: 450.004 },
        { key: 's:av', amount: 400, accountId: 'pea' },
        { key: 'a:pea', amount: 75 },
      ],
      transferDate: '2026-10-28', ids: { movements: ['m1', 'm2', 'm3'] },
    }));
    const s1 = applyPatch(s0, r.next);
    expect(s1.pays![0].done).toEqual({
      's:la': { amount: 450, movementId: 'm1' },
      's:av': { amount: 400, movementId: 'm2', accountId: 'pea' },
      'a:pea': { amount: 75, movementId: 'm3' },
    });
    expect(s1.pays![0].lines.at(-1)).toEqual(other);
    expect(acc(s1, 'la').ownedAmount).toBe(8650);
    expect(acc(s1, 'av')).toEqual(acc(s0, 'av'));
    expect(acc(s1, 'pea')).toMatchObject({ ownedAmount: 1475, totalDeposits: 1475 });
    expect(acc(s1, 'pea').movements.map(m => [m.id, m.amount, m.payId])).toEqual([['m2', 400, 'pay-2026-11'], ['m3', 75, 'pay-2026-11']]);
  });

  it('partiel, puis la suite : le plan reste figé, les lignes faites ne sont pas refaites', () => {
    const s0 = state([]);
    const first = ok(recordPay(s0, { pay: newPay, lines, done: [{ key: 's:la', amount: 500 }], transferDate: '2026-10-28', ids: { movements: ['m1'] } }));
    expect(first.message).toMatch(/^Virement de paie : \+500\s€ sur Livret A$/);
    const s1 = applyPatch(s0, first.next);
    // Plan recalculé ailleurs (soldes changés) : ignoré, il est figé.
    const recomputed = lines.map(l => ({ ...l, amount: l.amount + 1 }));
    const second = ok(recordPay(s1, {
      pay: { id: 'pay-2026-11' }, lines: recomputed,
      done: [{ key: 's:la', amount: 500 }, { key: 't:e:loyer', amount: 800 }], transferDate: '2026-10-30',
    }));
    const s2 = applyPatch(s1, second.next);
    expect(second.movementIds).toEqual([]);
    expect(second.message).toBe('Fait');
    expect(s2.pays![0].lines).toEqual(lines);
    expect(Object.keys(s2.pays![0].done)).toEqual(['s:la', 't:e:loyer']);
    expect(acc(s2, 'la').movements).toHaveLength(1);
    expect(s2.pays![0]).toMatchObject({ receivedOn: '2026-10-27', amount: 2512.35 });
  });

  it('rien de fait : le plan se remplace encore (règle du gel)', () => {
    const s0 = state([]);
    const s1 = applyPatch(s0, ok(recordPay(s0, { pay: newPay, lines, done: [], transferDate: '2026-10-28' })).next);
    expect(s1.pays![0]).toMatchObject({ lines, done: {} });
    const recomputed = lines.slice(2);
    const s2 = applyPatch(s1, ok(recordPay(s1, { pay: { id: 'pay-2026-11' }, lines: recomputed, done: [], transferDate: '2026-10-28' })).next);
    expect(s2.pays![0].lines).toEqual(recomputed);
  });

  it('« Déjà enregistré » : coché avec son montant, sans second versement', () => {
    const s0 = state([]);
    const r = ok(recordPay(s0, { pay: newPay, lines, done: [{ key: 's:av', amount: 380, alreadyRecorded: true }], transferDate: '2026-10-28' }));
    const s1 = applyPatch(s0, r.next);
    expect(r.movementIds).toEqual([]);
    expect(s1.pays![0].done).toEqual({ 's:av': { amount: 380, alreadyRecorded: true } });
    expect(s1.accounts).toEqual(s0.accounts);
  });

  it('un versement supprimé à la main décoche sa ligne : elle peut être refaite', () => {
    const s0 = state([]);
    const s1 = applyPatch(s0, ok(recordPay(s0, { pay: newPay, lines, done: [{ key: 's:la', amount: 500 }], transferDate: '2026-10-28', ids: { movements: ['m1'] } })).next);
    const s2 = applyPatch(s1, ok(deleteMovement(s1, { accountId: 'la', movementId: 'm1' })).next);
    expect(payChecklistOf({ ...s2, config: { paydayDay: 27 } }, new Date(2026, 10, 2))?.done).toEqual({});
    const again = ok(recordPay(s2, { pay: { id: 'pay-2026-11' }, lines, done: [{ key: 's:la', amount: 500 }], transferDate: '2026-10-29', ids: { movements: ['m2'] } }));
    const s3 = applyPatch(s2, again.next);
    expect(s3.pays![0].done).toEqual({ 's:la': { amount: 500, movementId: 'm2' } });
    expect(acc(s3, 'la').ownedAmount).toBe(8700);
  });

  it('compte supprimé depuis le plan : rien n\'est enregistré', () => {
    const s0 = state([]);
    const ghost: PayChecklistLine = { key: 's:ldds', label: 'LDDS', amount: 100, kind: 'saving', accountId: 'ldds' };
    const r = recordPay(s0, { pay: newPay, lines: [...lines, ghost], done: [{ key: 's:la', amount: 500 }, { key: 's:ldds', amount: 100 }], transferDate: '2026-10-28' });
    expect(r).toMatchObject({ ok: false, code: 'not-found', error: expect.stringContaining('« LDDS » n\'existe plus') });
    // Coché comme déjà enregistré, ou à 0 : pas de versement, donc pas de refus.
    expect(recordPay(s0, { pay: newPay, lines: [ghost], done: [{ key: 's:ldds', amount: 100, alreadyRecorded: true }], transferDate: '2026-10-28' }).ok).toBe(true);
  });

  it('le capital des parents n\'est jamais touché', () => {
    const s0 = state([]);
    const s1 = applyPatch(s0, ok(recordPay(s0, { pay: newPay, lines, done: allDone, transferDate: '2026-10-28' })).next);
    for (const a of s1.accounts) expect(a.parentalCapital).toBe(acc(s0, a.id).parentalCapital);
    expect(s1.parentalRestitution).toEqual(s0.parentalRestitution);
  });

  it('saisies refusées', () => {
    const s0 = state([]);
    const base = { pay: newPay, lines, done: [], transferDate: '2026-10-28' };
    expect(recordPay(s0, { ...base, pay: { ...newPay, receivedOn: '27/10' } })).toMatchObject({ ok: false, code: 'invalid' });
    expect(recordPay(s0, { ...base, pay: { receivedOn: '2026-10-27' } })).toMatchObject({ ok: false, error: 'Montant reçu invalide.' });
    expect(recordPay(s0, { ...base, pay: { ...newPay, amount: -1 } })).toMatchObject({ ok: false, code: 'invalid' });
    expect(recordPay(s0, { ...base, pay: { ...newPay, bonus: Number.NaN } })).toMatchObject({ ok: false, error: 'Prime invalide.' });
    expect(recordPay(s0, { ...base, pay: { ...newPay, toSave: -5 } })).toMatchObject({ ok: false, error: 'Montant à placer invalide.' });
    expect(recordPay(s0, { ...base, pay: { ...newPay, savingsMonth: '2026-13' } })).toMatchObject({ ok: false, code: 'invalid' });
    expect(recordPay(s0, { ...base, transferDate: '' })).toMatchObject({ ok: false, error: 'Date des virements invalide.' });
    expect(recordPay(s0, { ...base, done: [{ key: 'inconnue', amount: 1 }] })).toMatchObject({ ok: false, error: 'Ligne de paie inconnue.' });
    expect(recordPay(s0, { ...base, done: [{ key: 's:la', amount: 1 }, { key: 's:la', amount: 2 }] })).toMatchObject({ ok: false, code: 'invalid' });
    expect(recordPay(s0, { ...base, lines: [lines[2], lines[2]] })).toMatchObject({ ok: false, code: 'invalid' });
    expect(recordPay(s0, { ...base, done: [{ key: 's:la', amount: -3 }] })).toMatchObject({ ok: false, error: 'Montant invalide pour « Livret A ».' });
    expect(recordPay(s0, { ...base, pay: { id: 'disparue' } })).toMatchObject({ ok: false, code: 'not-found' });
  });

  it('mois d\'épargne : règle du 15, choix à la main, 27 décembre → janvier', () => {
    const s0 = state([]);
    const dec = ok(recordPay(s0, { pay: { receivedOn: '2026-12-27', amount: 2500 }, lines: [], done: [], transferDate: '2026-12-28' }));
    expect(applyPatch(s0, dec.next).pays![0]).toMatchObject({ id: 'pay-2027-01', savingsMonth: '2027-01' });
    const early = ok(recordPay(s0, { pay: { receivedOn: '2026-11-03', amount: 2500 }, lines: [], done: [], transferDate: '2026-11-03' }));
    expect(applyPatch(s0, early.next).pays![0].savingsMonth).toBe('2026-11');
    const chosen = ok(recordPay(s0, { pay: { receivedOn: '2026-11-14', savingsMonth: '2026-12', amount: 2500 }, lines: [], done: [], transferDate: '2026-11-14' }));
    const s1 = applyPatch(s0, chosen.next);
    expect(s1.pays![0]).toMatchObject({ id: 'pay-2026-12', savingsMonth: '2026-12' });
    // Le choix reste quand on complète la paie sans changer sa date.
    const s2 = applyPatch(s1, ok(recordPay(s1, { pay: { id: 'pay-2026-12', amount: 2600 }, lines: [], done: [], transferDate: '2026-11-20' })).next);
    expect(s2.pays![0]).toMatchObject({ savingsMonth: '2026-12', amount: 2600 });
  });

  it('versement en plus (deuxième paie du mois) : son propre identifiant, prime et fiche gardées', () => {
    const regular: PayRecord = { id: 'pay-2026-11', receivedOn: '2026-10-27', savingsMonth: '2026-11', amount: 2500, lines: [], done: {} };
    const s0 = state([regular]);
    const extraLines: PayChecklistLine[] = [{ key: 's:la', label: 'Livret A', amount: 300, kind: 'saving', accountId: 'la' }];
    const r = ok(recordPay(s0, { pay: { receivedOn: '2026-11-05', amount: 300, kind: 'extra', payslipId: 'f9' }, lines: extraLines, done: [{ key: 's:la', amount: 300 }], transferDate: '2026-11-05', ids: { movements: ['x'] } }));
    const s1 = applyPatch(s0, r.next);
    expect(s1.pays).toEqual([regular, {
      id: 'pay-2026-11-2', receivedOn: '2026-11-05', savingsMonth: '2026-11', amount: 300, kind: 'extra', payslipId: 'f9',
      lines: extraLines, done: { 's:la': { amount: 300, movementId: 'x' } },
    }]);
    expect(acc(s1, 'la').movements[0].payId).toBe('pay-2026-11-2');
  });

  it('prime et « à placer » saisis, champs inconnus d\'une paie gardés', () => {
    const existing = { id: 'p', receivedOn: '2026-10-27', savingsMonth: '2026-11', amount: 2500, lines: [], done: {}, reviewedAt: '2026-10-28', futur: 1 } as PayRecord;
    const s0 = state([existing]);
    const s1 = applyPatch(s0, ok(recordPay(s0, { pay: { id: 'p', amount: 3000, bonus: 500, toSave: 900.456 }, lines, done: [], transferDate: '2026-10-28' })).next);
    expect(s1.pays![0]).toEqual({ ...existing, amount: 3000, bonus: 500, toSave: 900.46, lines });
  });
});

describe('uncheckPayLine : décocher une ligne', () => {
  const recorded = () => {
    const s0 = state([]);
    return applyPatch(s0, ok(recordPay(s0, { pay: newPay, lines, done: allDone, transferDate: '2026-10-28', ids: { movements: ['m1', 'm2'] } })).next);
  };

  it('le versement est retiré (solde et versements cumulés), annulation exacte', () => {
    const s1 = recorded();
    const r = ok(uncheckPayLine(s1, { payId: 'pay-2026-11', key: 's:av' }));
    const s2 = applyPatch(s1, r.next);
    expect(r.message).toBe('Versement annulé');
    expect(acc(s2, 'av')).toMatchObject({ ownedAmount: 4300, totalDeposits: 4000, movements: [] });
    expect(s2.pays![0].done['s:av']).toBeUndefined();
    expect(applyPatch(s2, r.undo(s2))).toEqual(s1);
  });

  it('virement de la paie ou versement déjà supprimé : seule la coche part', () => {
    const s1 = recorded();
    const t = ok(uncheckPayLine(s1, { payId: 'pay-2026-11', key: 't:leisure' }));
    expect(t.next.accounts).toBeUndefined();
    const s2 = applyPatch(s1, ok(deleteMovement(s1, { accountId: 'la', movementId: 'm1' })).next);
    const gone = ok(uncheckPayLine(s2, { payId: 'pay-2026-11', key: 's:la' }));
    expect(gone.message).toBe('Ligne décochée');
    expect(gone.next.accounts).toBeUndefined();
    expect(uncheckPayLine(s2, { payId: 'pay-2026-11', key: 'absente' })).toMatchObject({ ok: false, code: 'not-found' });
  });

  it('refusé si un retrait fait depuis dépend du versement (part propre négative)', () => {
    const s1 = recorded();
    const s2 = applyPatch(s1, ok(quickAdd(s1, { accountId: 'av', amount: 4700, type: 'OUT', label: 'Retrait', date: '2026-10-29' })).next);
    expect(uncheckPayLine(s2, { payId: 'pay-2026-11', key: 's:av' })).toMatchObject({ ok: false, code: 'forbidden' });
  });
});

describe('updatePay : modifier la paie', () => {
  const pay: PayRecord = { id: 'p', receivedOn: '2026-10-27', savingsMonth: '2026-11', amount: 2500, bonus: 200, toSave: 800, lines, done: {} };

  it('montant, date (mois recalculé), « à placer » et prime ; annulation exacte', () => {
    const s0 = state([pay]);
    const r = ok(updatePay(s0, { payId: 'p', amount: 2600.004, receivedOn: '2026-11-03', toSave: null, bonus: 0 }));
    const s1 = applyPatch(s0, r.next);
    expect(s1.pays![0]).toEqual({ id: 'p', receivedOn: '2026-11-03', savingsMonth: '2026-11', amount: 2600, lines, done: {} });
    expect(r.message).toBe('Paie modifiée');
    expect(applyPatch(s1, r.undo(s1))).toEqual(s0);
    const s2 = applyPatch(s0, ok(updatePay(s0, { payId: 'p', receivedOn: '2026-10-10' })).next);
    expect(s2.pays![0].savingsMonth).toBe('2026-10');
  });

  it('un mois choisi à la main reste ; un mois donné l\'emporte', () => {
    const s0 = state([{ ...pay, receivedOn: '2026-11-14', savingsMonth: '2026-12' }]);
    expect(applyPatch(s0, ok(updatePay(s0, { payId: 'p', receivedOn: '2026-11-13' })).next).pays![0].savingsMonth).toBe('2026-12');
    expect(applyPatch(s0, ok(updatePay(s0, { payId: 'p', savingsMonth: '2026-11' })).next).pays![0].savingsMonth).toBe('2026-11');
  });

  it('nouveau plan seulement si rien n\'est fait ; les versements suivent la paie (payId)', () => {
    const s0 = state([pay]);
    const fresh = lines.slice(0, 1);
    expect(applyPatch(s0, ok(updatePay(s0, { payId: 'p', lines: fresh })).next).pays![0].lines).toEqual(fresh);
    const s1 = applyPatch(s0, ok(recordPay(s0, { pay: { id: 'p' }, lines, done: [{ key: 's:la', amount: 500 }], transferDate: '2026-10-28', ids: { movements: ['m1'] } })).next);
    const s2 = applyPatch(s1, ok(updatePay(s1, { payId: 'p', lines: fresh, receivedOn: '2026-11-02' })).next);
    expect(s2.pays![0].lines).toEqual(lines);
    expect(s2.accounts).toBe(s1.accounts);
  });

  it('saisies refusées', () => {
    const s0 = state([pay]);
    expect(updatePay(s0, { payId: 'x' })).toMatchObject({ ok: false, code: 'not-found' });
    expect(updatePay(s0, { payId: 'p', amount: -1 })).toMatchObject({ ok: false, code: 'invalid' });
    expect(updatePay(s0, { payId: 'p', receivedOn: 'demain' })).toMatchObject({ ok: false, code: 'invalid' });
    expect(updatePay(s0, { payId: 'p', savingsMonth: '11-2026' })).toMatchObject({ ok: false, code: 'invalid' });
    expect(updatePay(s0, { payId: 'p', toSave: Number.POSITIVE_INFINITY })).toMatchObject({ ok: false, code: 'invalid' });
    expect(updatePay(s0, { payId: 'p', bonus: -2 })).toMatchObject({ ok: false, error: 'Prime invalide.' });
  });
});

describe('deletePay : supprimer la paie', () => {
  const recorded = () => {
    const other: PayRecord = { id: 'sep', receivedOn: '2026-09-26', savingsMonth: '2026-10', amount: 2400, lines: [], done: {} };
    const s0 = state([other]);
    return applyPatch(s0, ok(recordPay(s0, { pay: newPay, lines, done: allDone, transferDate: '2026-10-28', ids: { movements: ['m1', 'm2'] } })).next);
  };

  it('avec ses versements : tout part, une seule annulation remet tout', () => {
    const s1 = recorded();
    const r = ok(deletePay(s1, { payId: 'pay-2026-11', withMovements: true }));
    const s2 = applyPatch(s1, r.next);
    expect(r.removed).toBe(2);
    expect(r.message).toBe('Paie supprimée, avec ses 2 versements');
    expect(s2.pays!.map(p => p.id)).toEqual(['sep']);
    expect(acc(s2, 'la')).toMatchObject({ ownedAmount: 8200, parentalCapital: 7000, movements: [] });
    expect(acc(s2, 'av')).toMatchObject({ ownedAmount: 4300, totalDeposits: 4000, movements: [] });
    expect(applyPatch(s2, r.undo(s2))).toEqual(s1);
  });

  it('sans ses versements : ils restent, détachés de la paie disparue ; annulation exacte', () => {
    const s1 = recorded();
    const r = ok(deletePay(s1, { payId: 'pay-2026-11', withMovements: false }));
    const s2 = applyPatch(s1, r.next);
    expect(r.message).toBe('Paie supprimée');
    expect(acc(s2, 'la')).toMatchObject({ ownedAmount: 8700 });
    expect(acc(s2, 'la').movements[0]).toEqual({ id: 'm1', date: '2026-10-28', amount: 500, label: PAY_DEPOSIT_LABEL, type: 'IN' });
    expect(applyPatch(s2, r.undo(s2))).toEqual(s1);
  });

  it('un versement déjà supprimé à la main est ignoré ; paie sans versement : rien d\'autre ne bouge', () => {
    const s1 = recorded();
    const s2 = applyPatch(s1, ok(deleteMovement(s1, { accountId: 'la', movementId: 'm1' })).next);
    const r = ok(deletePay(s2, { payId: 'pay-2026-11', withMovements: true }));
    expect(r.removed).toBe(1);
    expect(r.message).toBe('Paie supprimée, avec son versement');
    const plain = ok(deletePay(s2, { payId: 'sep', withMovements: true }));
    expect(plain.next.accounts).toBeUndefined();
    expect(deletePay(s2, { payId: 'absente', withMovements: true })).toMatchObject({ ok: false, code: 'not-found' });
  });

  it('refusé si un retrait fait depuis dépend d\'un de ses versements', () => {
    const s1 = recorded();
    const s2 = applyPatch(s1, ok(quickAdd(s1, { accountId: 'av', amount: 4700, type: 'OUT', label: 'Retrait', date: '2026-10-29' })).next);
    expect(deletePay(s2, { payId: 'pay-2026-11', withMovements: true })).toMatchObject({ ok: false, code: 'forbidden' });
    // Sans les versements, rien ne s'y oppose.
    expect(deletePay(s2, { payId: 'pay-2026-11', withMovements: false }).ok).toBe(true);
  });

  it('les comptes passés ne sont pas modifiés par la commande', () => {
    const s1 = recorded();
    const frozen = JSON.stringify(s1);
    deletePay(s1, { payId: 'pay-2026-11', withMovements: true });
    deletePay(s1, { payId: 'pay-2026-11', withMovements: false });
    expect(JSON.stringify(s1)).toBe(frozen);
    const sample: SavingsAccount = acc(s1, 'la');
    expect(sample.movements).toHaveLength(1);
  });
});
