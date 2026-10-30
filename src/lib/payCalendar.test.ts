import { describe, it, expect } from 'vitest';
import {
  savingsMonthOf, expectedPayDate, payWindows, currentSavingsMonth, savingsMonthOfPay, paySavingsMonths, shiftMonth, validPayday,
} from './payCalendar';
import { payPeriodOf } from './finance';
import type { PayRecord, PayslipRecord } from '../types';

const pay = (id: string, receivedOn: string, over: Partial<PayRecord> = {}): PayRecord =>
  ({ id, receivedOn, savingsMonth: savingsMonthOf(receivedOn), amount: 2500, lines: [], done: {}, ...over });
const slip = (period: string, addedAt: string): Pick<PayslipRecord, 'addedAt' | 'extracted'> => ({ addedAt, extracted: { period } });

describe('règle du 15 : date de paie → mois d\'épargne', () => {
  it('à partir du 15, le mois suivant ; avant, le mois même', () => {
    expect(savingsMonthOf('2026-10-14')).toBe('2026-10');
    expect(savingsMonthOf('2026-10-15')).toBe('2026-11');
    expect(savingsMonthOf('2026-10-27')).toBe('2026-11');
    // Paie d'octobre versée en retard le 3 novembre : épargne de novembre aussi.
    expect(savingsMonthOf('2026-11-03')).toBe('2026-11');
  });
  it('décembre → janvier de l\'année suivante', () => {
    expect(savingsMonthOf('2026-12-27')).toBe('2027-01');
    expect(savingsMonthOf('2026-12-31')).toBe('2027-01');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2027-01', -1)).toBe('2026-12');
  });
  it('mois choisi à la main gardé, sinon recalculé', () => {
    expect(savingsMonthOfPay({ receivedOn: '2026-10-14', savingsMonth: '2026-11' })).toBe('2026-11');
    expect(savingsMonthOfPay({ receivedOn: '2026-10-27', savingsMonth: 'novembre' })).toBe('2026-11');
    expect(paySavingsMonths([pay('a', '2026-10-27'), pay('b', '2026-11-03', { savingsMonth: '2026-10' })])).toEqual(new Map([['a', '2026-11'], ['b', '2026-10']]));
  });
});

describe('date attendue', () => {
  it('le 31 devient le 30 ou le 28 ; sans jour de paie, le 1er', () => {
    expect(expectedPayDate(31, '2026-09')).toBe('2026-09-30');
    expect(expectedPayDate(31, '2026-02')).toBe('2026-02-28');
    expect(expectedPayDate(31, '2028-02')).toBe('2028-02-29');
    expect(expectedPayDate(undefined, '2026-09')).toBe('2026-09-01');
  });
  it('un jour de paie illisible vaut « inconnu »', () => {
    expect(validPayday(27)).toBe(27);
    expect([0, 32, 2.5, Number.NaN, '27'].map(validPayday)).toEqual([undefined, undefined, undefined, undefined, undefined]);
    expect(expectedPayDate(0, '2026-09')).toBe('2026-09-01');
  });
  it('paie le 31 de février : 28, donc mois suivant', () => {
    expect(savingsMonthOf(expectedPayDate(31, '2026-02'))).toBe('2026-03');
  });
});

describe('fenêtres des mois d\'épargne', () => {
  it('paie attendue le 27 : la fenêtre du 27 au 27 est l\'épargne du mois suivant', () => {
    const w = payWindows({ paydayDay: 27 }, '2026-10-02', 3);
    expect(w.map(x => [x.key, x.start, x.end, x.source, x.payMonth])).toEqual([
      ['2026-08', '2026-07-27', '2026-08-27', 'payday', '2026-07'],
      ['2026-09', '2026-08-27', '2026-09-27', 'payday', '2026-08'],
      ['2026-10', '2026-09-27', '2026-10-27', 'payday', '2026-09'],
    ]);
  });
  it('paie avant le 15 : la fenêtre porte le mois même', () => {
    const w = payWindows({ paydayDay: 5 }, '2026-10-20', 2);
    expect(w.map(x => [x.key, x.start, x.end])).toEqual([['2026-09', '2026-09-05', '2026-10-05'], ['2026-10', '2026-10-05', '2026-11-04']]);
  });
  it('sans jour de paie ni paie déclarée : mois civils', () => {
    const w = payWindows({}, '2026-10-20', 2);
    expect(w.map(x => [x.key, x.start, x.end, x.source])).toEqual([['2026-09', '2026-09-01', '2026-10-01', 'calendar'], ['2026-10', '2026-10-01', '2026-10-31', 'calendar']]);
  });
  it('fiche de paie enregistrée à une semaine près : elle ouvre la fenêtre (même mois d\'épargne)', () => {
    const w = payWindows({ paydayDay: 27, payslips: [slip('2026-09', '2026-09-24T08:00:00Z')] }, '2026-10-02', 2);
    expect(w[1]).toMatchObject({ key: '2026-10', start: '2026-09-24', source: 'payslip', payMonth: '2026-09' });
    expect(w[0].end).toBe('2026-09-24');
  });
  it('paie déclarée : elle remplace la paie attendue du même mois d\'épargne, à sa vraie date', () => {
    const w = payWindows({ paydayDay: 27, pays: [pay('oct', '2026-10-26')] }, '2026-11-02', 2);
    expect(w.map(x => [x.key, x.start, x.source, x.payId])).toEqual([
      ['2026-10', '2026-09-27', 'payday', undefined],
      ['2026-11', '2026-10-26', 'received', 'oct'],
    ]);
    expect(w[0].end).toBe('2026-10-26');
    expect(w[1].payMonth).toBe('2026-10');
  });
  it('décembre : la paie du 27 décembre ouvre janvier de l\'année suivante', () => {
    const w = currentSavingsMonth({ paydayDay: 27, pays: [pay('dec', '2026-12-23')] }, '2026-12-28');
    expect(w).toMatchObject({ key: '2027-01', start: '2026-12-23', source: 'received', payMonth: '2026-12' });
  });
  it('paie en retard (3 novembre pour octobre) : épargne de novembre, à partir du 3', () => {
    const w = payWindows({ paydayDay: 27, pays: [pay('late', '2026-11-03')] }, '2026-11-05', 2);
    expect(w.map(x => [x.key, x.start, x.end])).toEqual([['2026-10', '2026-09-27', '2026-11-03'], ['2026-11', '2026-11-03', '2026-12-03']]);
  });
  it('paie déclarée après coup (antidatée) : les fenêtres passées sont corrigées', () => {
    const before = payWindows({ paydayDay: 27 }, '2026-11-05', 2);
    expect(before[1].start).toBe('2026-10-27');
    const after = payWindows({ paydayDay: 27, pays: [pay('oct', '2026-10-24')] }, '2026-11-05', 2);
    expect(after.map(x => [x.key, x.start, x.end])).toEqual([['2026-10', '2026-09-27', '2026-10-24'], ['2026-11', '2026-10-24', '2026-11-23']]);
  });
  it('deux paies sur le même mois d\'épargne : la première ouvre la fenêtre ; un versement en plus n\'ouvre rien', () => {
    const pays = [pay('b', '2026-10-30'), pay('a', '2026-10-27'), pay('prime', '2026-11-10', { kind: 'extra', savingsMonth: '2026-11' })];
    const w = payWindows({ paydayDay: 27, pays }, '2026-11-12', 1);
    expect(w).toEqual([expect.objectContaining({ key: '2026-11', start: '2026-10-27', payId: 'a' })]);
    // Ordre des déclarations sans effet.
    expect(payWindows({ paydayDay: 27, pays: [...pays].reverse() }, '2026-11-12', 1)).toEqual(w);
  });
  it('déclarations dans le désordre : fenêtres triées, sans chevauchement', () => {
    const pays = [pay('nov', '2026-11-26'), pay('sep', '2026-09-28'), pay('oct', '2026-10-27')];
    const w = payWindows({ paydayDay: 27, pays }, '2026-12-01', 3);
    expect(w.map(x => [x.key, x.start, x.end])).toEqual([
      ['2026-10', '2026-09-28', '2026-10-27'],
      ['2026-11', '2026-10-27', '2026-11-26'],
      ['2026-12', '2026-11-26', '2026-12-26'],
    ]);
  });
  it("cas tordus : la règle s'applique telle quelle, le mois se change à la main", () => {
    // Paie reçue le 14 octobre : rangée en octobre (règle du 15), elle remplace la paie
    // attendue du 27 septembre, qui ouvrait octobre ; septembre s'étire jusqu'au 14.
    const w = payWindows({ paydayDay: 27, pays: [pay('o', '2026-10-14')] }, '2026-10-20', 2);
    expect(w.map(x => [x.key, x.start, x.end])).toEqual([['2026-09', '2026-08-27', '2026-10-14'], ['2026-10', '2026-10-14', '2026-11-13']]);
    // Mois choisi à la main après la paie suivante : novembre reste vide, rien ne chevauche.
    const odd = payWindows({ paydayDay: 27, pays: [pay('o', '2026-10-28', { savingsMonth: '2027-01' })] }, '2026-11-02', 2);
    expect(odd.map(x => [x.key, x.start, x.end])).toEqual([['2026-11', '2026-10-27', '2026-10-28'], ['2027-01', '2026-10-28', '2026-11-27']]);
  });
  it('une paie pas encore tombée n\'ouvre pas de fenêtre', () => {
    const w = payWindows({ paydayDay: 27, pays: [pay('futur', '2026-10-27')] }, '2026-10-20', 1);
    expect(w[0]).toMatchObject({ key: '2026-10', start: '2026-09-27', source: 'payday' });
  });
});

describe('payPeriodOf : façade sur la même règle', () => {
  it('garde le mois de versement comme clé et donne le mois d\'épargne', () => {
    const p = payPeriodOf(27, new Date(2026, 9, 28));
    expect(p).toMatchObject({ key: '2026-10', savingsMonth: '2026-11' });
    expect(p.payDate.getDate()).toBe(27);
  });
  it('suit la fiche de paie et la paie déclarée quand on les lui donne (plus d\'écart avec l\'Accueil)', () => {
    const asOf = new Date(2026, 9, 25);
    expect(payPeriodOf(27, asOf).key).toBe('2026-09');
    const withSlip = payPeriodOf(27, asOf, { payslips: [slip('2026-10', '2026-10-24T09:00:00Z')] });
    expect(withSlip).toMatchObject({ key: '2026-10', savingsMonth: '2026-11' });
    expect(payWindows({ paydayDay: 27, payslips: [slip('2026-10', '2026-10-24T09:00:00Z')] }, '2026-10-25', 1)[0].key).toBe(withSlip.savingsMonth);
    expect(payPeriodOf(27, asOf, { pays: [pay('o', '2026-10-23')] })).toMatchObject({ key: '2026-10', savingsMonth: '2026-11' });
  });
});
