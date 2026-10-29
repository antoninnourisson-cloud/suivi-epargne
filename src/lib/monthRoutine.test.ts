import { describe, it, expect } from 'vitest';
import { computeMonthRoutine } from './monthRoutine';
import { AccountType, type PayChecklist, type PayslipRecord, type SavingsAccount } from '../types';

// 29 octobre 2026, paie le 27 : on gère la paie d'octobre (versée le 27 octobre).
const NOW = new Date(2026, 9, 29, 12);
const acc = (over: Partial<SavingsAccount>): SavingsAccount => ({
  id: 'a', name: 'Livret A', type: AccountType.LIVRET_A, institution: 'B', totalAmount: 100, ownedAmount: 100, parentalCapital: 0, movements: [], ...over,
});
const slip = (period: string): PayslipRecord => ({ id: period, fileId: 'f', fileName: 'fiche.pdf', addedAt: '2026-10-28', extracted: { period }, reviewed: true });
const checklist = (month: string, done: string[]): PayChecklist => ({
  month,
  lines: [{ key: 't:Loyer', label: 'Loyer', amount: 700, kind: 'transfer' }, { key: 's:a', label: 'Livret A', amount: 300, kind: 'saving', accountId: 'a' }],
  done: Object.fromEntries(done.map(k => [k, { amount: 1 }])),
});

const base = {
  accounts: [acc({ balanceCheckedAt: '2026-10-28' })],
  payslips: [slip('2026-09')],
  monthlyPay: 2400,
  paydayDay: 27,
  now: NOW,
  payReviewKey: '2026-09',
  payReviewsDone: [] as string[],
};

describe('routine du mois', () => {
  it('suit la paie en cours et nomme le mois, avec les élisions', () => {
    const r = computeMonthRoutine(base)!;
    expect(r.periodKey).toBe('2026-10');
    expect(r.monthName).toBe('octobre');
    expect(r.steps.map(s => s.label)).toEqual(['Fiche de paie d\'octobre 2026', 'Virements de la paie', 'Soldes actualisés', 'Point de paie de septembre 2026']);
    // Avant le 27 : encore la paie de septembre.
    expect(computeMonthRoutine({ ...base, now: new Date(2026, 9, 20, 12) })!.periodKey).toBe('2026-09');
  });

  it('déduit chaque étape des données : fiche, virements cochés, soldes, point de paie', () => {
    let r = computeMonthRoutine(base)!;
    expect(r.steps.map(s => s.done)).toEqual([false, false, true, false]);
    expect(r.doneCount).toBe(1);
    expect(r.steps[1].detail).toBe('À cocher dans le Pilotage');

    r = computeMonthRoutine({ ...base, payslips: [slip('2026-09'), slip('2026-10')], payChecklist: checklist('2026-10', ['t:Loyer']) })!;
    expect(r.steps[0]).toMatchObject({ done: true, detail: 'Importée' });
    expect(r.steps[1]).toMatchObject({ done: false, detail: '1 sur 2 cochés' });

    r = computeMonthRoutine({
      ...base, payslips: [slip('2026-10')], payChecklist: checklist('2026-10', ['t:Loyer', 's:a']), payReviewsDone: ['2026-09'],
    })!;
    expect(r.steps.every(s => s.done)).toBe(true);
    expect(r.complete).toBe(true);
  });

  it('une liste de virements d’une autre paie ne compte pas', () => {
    const r = computeMonthRoutine({ ...base, payChecklist: checklist('2026-09', ['t:Loyer', 's:a']) })!;
    expect(r.steps.find(s => s.key === 'transfers')!.done).toBe(false);
  });

  it('les soldes : comptes courants et livrets vérifiés depuis la paie, aucun compte en retard', () => {
    // Livret vérifié avant la paie : à actualiser.
    let r = computeMonthRoutine({ ...base, accounts: [acc({ balanceCheckedAt: '2026-10-20' })] })!;
    expect(r.steps.find(s => s.key === 'balances')).toMatchObject({ done: false, detail: '1 compte à actualiser' });
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
    expect(r.steps.map(s => s.key)).toEqual(['transfers', 'balances']);
    expect(computeMonthRoutine({ ...base, payslips: [], payReviewKey: undefined, monthlyPay: 0 })).toBeNull();
    expect(computeMonthRoutine({ ...base, accounts: [] })).toBeNull();
  });
});
