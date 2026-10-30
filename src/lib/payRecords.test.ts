import { describe, it, expect } from 'vitest';
import { findMovement, liveDone, newPayId, openPay, payAdjustmentOf, payChecklistOf, payMovements, suggestedPayKind, withPayAdjustment } from './payRecords';
import type { PayChecklist, PayRecord } from '../types';

// Paie le 27 : le 2 novembre 2026, la paie en cours est celle du 27 octobre (épargne de novembre).
const NOV_2 = new Date(2026, 10, 2, 12);
const config = { paydayDay: 27 };
const list: PayChecklist = {
  month: '2026-10',
  lines: [{ key: 's:la', label: 'Livret A', amount: 500, kind: 'saving', accountId: 'la' }],
  done: { 's:la': { amount: 500, movementId: 'm1' } },
};

describe('paie ouverte', () => {
  it('celle du mois d\'épargne en cours ; un versement en plus n\'en est pas une', () => {
    const pays: PayRecord[] = [
      { id: 'prime', receivedOn: '2026-10-29', savingsMonth: '2026-11', amount: 300, kind: 'extra', lines: [], done: {} },
      { id: 'sep', receivedOn: '2026-09-27', savingsMonth: '2026-10', amount: 2400, lines: [], done: {} },
    ];
    expect(openPay({ pays, config }, NOV_2)).toMatchObject({ window: { key: '2026-11', payMonth: '2026-10' }, pay: undefined });
    const withOct = [...pays, { id: 'oct', receivedOn: '2026-10-27', savingsMonth: '2026-11', amount: 2500, lines: [], done: {} }];
    expect(openPay({ pays: withOct, config }, NOV_2).pay?.id).toBe('oct');
  });
});

describe('liste à cocher (forme historique)', () => {
  const pay: PayRecord = { id: 'pay-2026-11', receivedOn: '2026-10-27', savingsMonth: '2026-11', amount: 2512.35, lines: list.lines, done: list.done };
  it('la liste figée de la paie ouverte se relit telle quelle ; plus rien à la paie suivante', () => {
    expect(payChecklistOf({ pays: [pay], config }, NOV_2)).toEqual(list);
    expect(payChecklistOf({ pays: [pay], config }, new Date(2026, 10, 28))).toBeUndefined();
    // Plan pas encore figé : pas de liste.
    expect(payChecklistOf({ pays: [{ ...pay, lines: [], done: {} }], config }, NOV_2)).toBeUndefined();
  });
  it('un versement supprimé à la main décoche sa ligne ; les coches sans versement restent', () => {
    const done = { ...list.done, 't:loyer': { amount: 800 }, 's:pea': { amount: 50, alreadyRecorded: true } };
    const accounts = [{ id: 'la', movements: [] }];
    expect(payChecklistOf({ pays: [{ ...pay, done }], config, accounts }, NOV_2)?.done).toEqual({ 't:loyer': { amount: 800 }, 's:pea': { amount: 50, alreadyRecorded: true } });
    const kept = [{ id: 'av', movements: [{ id: 'm1', date: '2026-11-01', amount: 500, label: 'Virement de paie', type: 'IN' as const }] }];
    expect(liveDone(done, kept)).toEqual(done);
    expect(payMovements({ done }, kept)).toEqual([{ accountId: 'av', movement: kept[0].movements[0] }]);
    expect(findMovement(kept, 'absent')).toBeUndefined();
  });
});

describe('nouvelle paie', () => {
  it('identifiant libre par mois d\'épargne', () => {
    expect(newPayId([], '2026-11')).toBe('pay-2026-11');
    expect(newPayId([{ id: 'pay-2026-11' }, { id: 'pay-2026-11-2' }], '2026-11')).toBe('pay-2026-11-3');
  });
  it('deuxième paie du même mois d\'épargne : proposée en versement en plus', () => {
    const pays: PayRecord[] = [
      { id: 'oct', receivedOn: '2026-10-27', savingsMonth: '2026-11', amount: 2500, lines: [], done: {} },
      { id: 'prime', receivedOn: '2026-11-05', savingsMonth: '2026-11', amount: 300, kind: 'extra', lines: [], done: {} },
    ];
    expect(suggestedPayKind(pays, '2026-11')).toBe('extra');
    expect(suggestedPayKind(pays, '2026-11', 'oct')).toBeUndefined();
    expect(suggestedPayKind(pays, '2026-12')).toBeUndefined();
    expect(suggestedPayKind(undefined, '2026-12')).toBeUndefined();
  });
});

describe('réglages de la paie en cours (forme historique)', () => {
  it('« Capacité » et « Somme en plus » vont sur la paie ouverte ; le montant reçu suit la prime', () => {
    const a = withPayAdjustment({ pays: [], config }, { period: '2026-10', extra: 300 }, NOV_2, 2500);
    expect(a).toEqual([{ id: 'pay-2026-11', receivedOn: '2026-10-27', savingsMonth: '2026-11', amount: 2800, bonus: 300, lines: [], done: {} }]);
    expect(payAdjustmentOf({ pays: a, config }, NOV_2)).toEqual({ period: '2026-10', extra: 300 });
    const b = withPayAdjustment({ pays: a, config }, { period: '2026-10', capacity: 700.456, extra: 200 }, NOV_2, 0);
    expect(b[0]).toMatchObject({ amount: 2700, bonus: 200, toSave: 700.46 });
    const c = withPayAdjustment({ pays: b, config }, undefined, NOV_2, 0);
    expect(c[0]).toEqual({ id: 'pay-2026-11', receivedOn: '2026-10-27', savingsMonth: '2026-11', amount: 2500, lines: [], done: {} });
    expect(payAdjustmentOf({ pays: c, config }, NOV_2)).toBeUndefined();
    // Rien à enregistrer et pas de paie : rien n'est créé.
    expect(withPayAdjustment({ pays: [], config }, undefined, NOV_2, 2500)).toEqual([]);
  });
  it('un réglage de la paie précédente ne s\'applique plus', () => {
    const pays: PayRecord[] = [{ id: 'sep', receivedOn: '2026-09-27', savingsMonth: '2026-10', amount: 2400, toSave: 900, lines: [], done: {} }];
    expect(payAdjustmentOf({ pays, config }, new Date(2026, 9, 20))).toEqual({ period: '2026-09', capacity: 900 });
    expect(payAdjustmentOf({ pays, config }, NOV_2)).toBeUndefined();
  });
});
