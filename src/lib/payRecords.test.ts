import { describe, it, expect } from 'vitest';
import { findMovement, isPayReviewDone, liveDone, newPayId, openPay, payChecklistOf, payForPayslipPeriod, payMovements, payslipForMonth, payslipPeriodOf, suggestedPayKind, withPayReviewed } from './payRecords';
import type { PayChecklist, PayRecord, PayslipRecord } from '../types';

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


describe('fiche de paie de la paie', () => {
  const pays: PayRecord[] = [
    { id: 'oct', receivedOn: '2026-10-27', savingsMonth: '2026-11', amount: 2500, lines: [], done: {} },
    { id: 'prime', receivedOn: '2026-10-29', savingsMonth: '2026-11', amount: 300, kind: 'extra', lines: [], done: {} },
    // Paie de novembre versée en retard, le 3 décembre : épargne de décembre, fiche de novembre.
    { id: 'nov', receivedOn: '2026-12-03', savingsMonth: '2026-12', amount: 2450, lines: [], done: {} },
  ];
  const slip = (id: string, period: string, addedAt: string, extra: Partial<PayslipRecord> = {}): PayslipRecord =>
    ({ id, fileId: '', fileName: `${id}.pdf`, addedAt, reviewed: true, extracted: { period, netPaid: 2512 }, ...extra });

  it("fiche du mois qui précède le mois d'épargne, dans les deux sens", () => {
    expect(payslipPeriodOf('2026-11')).toBe('2026-10');
    expect(payslipPeriodOf('2027-01')).toBe('2026-12');
    expect(payForPayslipPeriod(pays, '2026-10')?.id).toBe('oct');
    expect(payForPayslipPeriod(pays, '2026-11')?.id).toBe('nov');
    expect(payForPayslipPeriod(pays, '2026-09')).toBeUndefined();
    expect(payForPayslipPeriod(pays, 'octobre')).toBeUndefined();
    expect(payForPayslipPeriod(undefined, '2026-10')).toBeUndefined();
  });

  it("la fiche liée d'abord, sinon la plus récente du mois (pas une fiche qui s'ajoute)", () => {
    const slips = [
      slip('a', '2026-10', '2026-10-26T08:00:00Z'),
      slip('b', '2026-10', '2026-10-28T08:00:00Z'),
      slip('c', '2026-10', '2026-10-29T08:00:00Z', { addsToPeriod: true }),
      slip('d', '2026-09', '2026-09-27T08:00:00Z'),
    ];
    expect(payslipForMonth(slips, '2026-11')?.id).toBe('b');
    expect(payslipForMonth(slips, '2026-11', 'a')?.id).toBe('a');
    expect(payslipForMonth(slips, '2026-11', 'disparue')?.id).toBe('b');
    expect(payslipForMonth(slips, '2026-12')).toBeUndefined();
    expect(payslipForMonth(undefined, '2026-11')).toBeUndefined();
  });
});

describe("bilan du mois d'épargne", () => {
  const pays: PayRecord[] = [{ id: 'oct', receivedOn: '2026-10-27', savingsMonth: '2026-11', amount: 2500, lines: [], done: {} }];
  it("validé sur l'Accueil (payReviewsDone) ou dans le rituel (reviewedAt)", () => {
    expect(isPayReviewDone('2026-11', [], pays)).toBe(false);
    expect(isPayReviewDone('2026-11', ['2026-11'], pays)).toBe(true);
    const reviewed = withPayReviewed(pays, '2026-11', '2026-12-01');
    expect(reviewed[0].reviewedAt).toBe('2026-12-01');
    expect(isPayReviewDone('2026-11', undefined, reviewed)).toBe(true);
    // Déjà noté : rien ne change ; pas de paie ce mois-là : rien à noter.
    expect(withPayReviewed(reviewed, '2026-11', '2026-12-05')).toBe(reviewed);
    expect(withPayReviewed(pays, '2026-10', '2026-12-01')).toBe(pays);
    expect(isPayReviewDone('2026-10', undefined, undefined)).toBe(false);
  });
});
