import { describe, it, expect } from 'vitest';
import { computeMonthRoutine } from './monthRoutine';
import { AccountType, type PayRecord, type PayslipRecord, type SavingsAccount } from '../types';

// 29 octobre 2026, paie le 27 : mois d'épargne de novembre (paie du 27 octobre, fiche d'octobre).
const NOW = new Date(2026, 9, 29, 12);
const acc = (over: Partial<SavingsAccount>): SavingsAccount => ({
  id: 'a', name: 'Livret A', type: AccountType.LIVRET_A, institution: 'B', totalAmount: 100, ownedAmount: 100, parentalCapital: 0, movements: [], ...over,
});
const slip = (period: string): PayslipRecord => ({ id: period, fileId: 'f', fileName: 'fiche.pdf', addedAt: '2026-10-28', extracted: { period }, reviewed: true });
const pay = (done: string[], over: Partial<PayRecord> = {}): PayRecord => ({
  id: 'pay-2026-11', receivedOn: '2026-10-27', savingsMonth: '2026-11', amount: 2400,
  lines: [{ key: 't:Loyer', label: 'Loyer', amount: 700, kind: 'transfer' }, { key: 's:a', label: 'Livret A', amount: 300, kind: 'saving', accountId: 'a' }],
  done: Object.fromEntries(done.map(k => [k, { amount: 1 }])),
  ...over,
});

const base = {
  accounts: [acc({ balanceCheckedAt: '2026-10-28' })],
  payslips: [slip('2026-09')],
  monthlyPay: 2400,
  paydayDay: 27,
  now: NOW,
  payReviewKey: '2026-10',
  payReviewsDone: [] as string[],
};

describe('routine du mois', () => {
  it("suit le mois d'épargne et le nomme, en trois étapes, avec les élisions", () => {
    const r = computeMonthRoutine(base)!;
    expect(r.periodKey).toBe('2026-11');
    expect(r.monthName).toBe('novembre');
    expect(r.payDeclared).toBe(false);
    expect(r.steps.map(s => s.label)).toEqual(['Paie reçue et répartie', 'Fiche de paie d\'octobre 2026', 'Soldes actualisés']);
    // Avant le 27 : encore l'épargne d'octobre (paie du 27 septembre, fiche de septembre).
    const before = computeMonthRoutine({ ...base, now: new Date(2026, 9, 20, 12) })!;
    expect(before.periodKey).toBe('2026-10');
    expect(before.steps[1]).toMatchObject({ label: 'Fiche de paie de septembre 2026', done: true });
  });

  it('paie reçue et répartie : déclarée, virements faits, bilan du mois précédent validé', () => {
    // Pas déclarée, bilan à valider : le rituel s'ouvre sur le bilan.
    let step = computeMonthRoutine(base)!.steps[0];
    expect(step).toMatchObject({ key: 'pay', done: false, detail: "Bilan d'octobre à valider, puis paie à déclarer", action: "J'ai reçu ma paie" });
    step = computeMonthRoutine({ ...base, payReviewsDone: ['2026-10'] })!.steps[0];
    expect(step).toMatchObject({ done: false, detail: 'Pas encore déclarée', action: "J'ai reçu ma paie" });

    // Déclarée, un virement sur deux fait.
    let r = computeMonthRoutine({ ...base, payReviewsDone: ['2026-10'], pays: [pay(['t:Loyer'])] })!;
    expect(r.payDeclared).toBe(true);
    expect(r.steps[0]).toMatchObject({ done: false, detail: '1 sur 2 faits', action: 'Voir' });

    // Tout fait, mais le bilan n'a pas été vu (paie cochée depuis le Pilotage).
    r = computeMonthRoutine({ ...base, pays: [pay(['t:Loyer', 's:a'])] })!;
    expect(r.steps[0]).toMatchObject({ done: false, detail: "Bilan d'octobre à valider", action: 'Voir le bilan' });

    // Tout fait, bilan validé dans le rituel (reviewedAt de la paie du mois précédent) ou sur l'Accueil.
    const previous = pay([], { id: 'pay-2026-10', receivedOn: '2026-09-27', savingsMonth: '2026-10', reviewedAt: '2026-10-27' });
    r = computeMonthRoutine({ ...base, payslips: [slip('2026-10')], pays: [previous, pay(['t:Loyer', 's:a'])] })!;
    expect(r.steps[0]).toMatchObject({ done: true, detail: 'Reçue le 27 octobre' });
    expect(r.steps.every(s => s.done)).toBe(true);
    expect(r.complete).toBe(true);
  });

  it('un versement supprimé à la main décoche sa ligne', () => {
    const p = pay(['t:Loyer'], { done: { 't:Loyer': { amount: 700 }, 's:a': { amount: 300, movementId: 'disparu' } } });
    const r = computeMonthRoutine({ ...base, payReviewsDone: ['2026-10'], pays: [p] })!;
    expect(r.steps[0].detail).toBe('1 sur 2 faits');
  });

  it("la fiche de paie liée à la paie compte, même rangée sous une autre période", () => {
    const linked = { ...slip('2026-09'), id: 'fiche' };
    const r = computeMonthRoutine({ ...base, payslips: [linked], pays: [pay([], { payslipId: 'fiche' })] })!;
    expect(r.steps.find(s => s.key === 'payslip')).toMatchObject({ done: true, detail: 'Importée' });
  });

  it('les soldes : comptes courants et livrets vérifiés depuis la paie, aucun compte en retard', () => {
    // Livret vérifié avant la paie : à actualiser.
    let r = computeMonthRoutine({ ...base, accounts: [acc({ balanceCheckedAt: '2026-10-20' })] })!;
    expect(r.steps.find(s => s.key === 'balances')).toMatchObject({ done: false, detail: '1 compte à actualiser' });
    // Paie reçue en avance le 25 : vérifié le 26, c'est à jour.
    r = computeMonthRoutine({ ...base, accounts: [acc({ balanceCheckedAt: '2026-10-26' })], pays: [pay([], { receivedOn: '2026-10-25' })] })!;
    expect(r.steps.find(s => s.key === 'balances')!.done).toBe(true);
    // Assurance vie vérifiée il y a deux mois : pas un rappel mensuel ; un compte vide est ignoré.
    r = computeMonthRoutine({ ...base, accounts: [
      acc({ balanceCheckedAt: '2026-10-28' }),
      acc({ id: 'av', name: 'AV', type: AccountType.ASSURANCE_VIE, balanceCheckedAt: '2026-08-15' }),
      acc({ id: 'vide', name: 'Vide', totalAmount: 0 }),
    ] })!;
    expect(r.steps.find(s => s.key === 'balances')!.done).toBe(true);
    // Assurance vie jamais vérifiée : en retard, donc à actualiser.
    r = computeMonthRoutine({ ...base, accounts: [acc({ balanceCheckedAt: '2026-10-28' }), acc({ id: 'av', name: 'AV', type: AccountType.ASSURANCE_VIE }), acc({ id: 'cc', name: 'CC', type: AccountType.COMPTE_COURANT })] })!;
    expect(r.steps.find(s => s.key === 'balances')!.detail).toBe('2 comptes à actualiser');
  });

  it('retire les étapes qui ne concernent pas l’utilisateur, et rien sous deux étapes', () => {
    const r = computeMonthRoutine({ ...base, payslips: [], payReviewKey: undefined })!;
    expect(r.steps.map(s => s.key)).toEqual(['pay', 'balances']);
    expect(computeMonthRoutine({ ...base, payslips: [], payReviewKey: undefined, monthlyPay: 0 })).toBeNull();
    // Sans paie au Pilotage mais avec une paie déclarée : l'étape reste.
    expect(computeMonthRoutine({ ...base, payslips: [], payReviewKey: undefined, monthlyPay: 0, pays: [pay([])] })!.steps.map(s => s.key)).toEqual(['pay', 'balances']);
    expect(computeMonthRoutine({ ...base, accounts: [] })).toBeNull();
  });
});
