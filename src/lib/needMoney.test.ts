// « J'ai besoin d'argent » : ordre de choix, coût en euros, meilleur jour, phrase de précaution.
import { describe, it, expect } from 'vitest';
import { AccountType, type SavingsAccount } from '../types';
import { DEFAULT_FISCAL_CONFIG } from '../constants';
import { computeWithdrawalTax } from './finance';
import { bestWithdrawalDay, needSources, planNeed, plannedDay, precautionAfter, withdrawalCost } from './needMoney';

const CFG = DEFAULT_FISCAL_CONFIG;
const TODAY = '2026-11-04';
const acc = (id: string, type: AccountType, owned: number, over: Partial<SavingsAccount> = {}): SavingsAccount => ({
  id, name: id, institution: 'B', type, totalAmount: owned + (over.parentalCapital ?? 0), ownedAmount: owned, parentalCapital: 0, movements: [], ...over,
});

const bancaire = acc('bancaire', AccountType.LIVRET_BANCAIRE, 1000, { interestRate: 3 });
const livretA = acc('livretA', AccountType.LIVRET_A, 1000, { interestRate: 1.7 });
const cel = acc('cel', AccountType.CEL, 1000, { interestRate: 1 });
const lep = acc('lep', AccountType.LEP, 1000, { interestRate: 2.5 });
const av = acc('av', AccountType.ASSURANCE_VIE, 1000, { interestRate: 2.6, openingDate: '2024-06-15', totalDeposits: 900 });
const peaOld = acc('peaOld', AccountType.PEA, 1000, { openingDate: '2015-01-01', totalDeposits: 800 });
const never = [
  acc('peaYoung', AccountType.PEA, 1000, { openingDate: '2024-01-01', totalDeposits: 800 }),
  acc('peaSansDate', AccountType.PEA, 1000, { totalDeposits: 800 }),
  acc('per', AccountType.PER, 1000), acc('pee', AccountType.PEE, 1000), acc('pel', AccountType.PEL, 1000, { openingDate: '2010-01-01' }),
  acc('cat', AccountType.COMPTE_A_TERME, 1000), acc('immo', AccountType.IMMOBILIER, 1000), acc('cc', AccountType.COMPTE_COURANT, 1000),
  acc('cto', AccountType.CTO, 1000), acc('crypto', AccountType.CRYPTO, 1000), acc('autre', AccountType.AUTRE, 1000),
];

describe('planNeed : le moins cher d’abord', () => {
  it('livrets du plus petit taux au plus grand, LEP en dernier, puis assurance vie, puis PEA', () => {
    const all = [peaOld, av, lep, bancaire, livretA, cel, ...never];
    const p = planNeed(all, CFG, 5500, TODAY, TODAY);
    expect(p.lines.map(l => l.accountId)).toEqual(['cel', 'livretA', 'bancaire', 'lep', 'av', 'peaOld']);
    expect(p.lines.map(l => l.amount)).toEqual([1000, 1000, 1000, 1000, 1000, 500]);
    expect(p.missing).toBe(0);
    // Petit besoin : un seul livret, aucun placement.
    expect(planNeed(all, CFG, 300, TODAY, TODAY).lines).toEqual([{ accountId: 'cel', amount: 300 }]);
  });

  it('ne propose jamais PER, PEE, PEL, compte à terme, immobilier, ni un PEA de moins de 5 ans', () => {
    expect(needSources(never, CFG, new Date(2026, 10, 4))).toEqual([]);
    expect(planNeed(never, CFG, 500, TODAY, TODAY)).toEqual({ lines: [], missing: 500 });
  });

  it('ne touche jamais la part des parents, et dit ce qui manque', () => {
    const shared = acc('livretA', AccountType.LIVRET_A, 300, { parentalCapital: 9700, interestRate: 1.7 });
    expect(planNeed([shared], CFG, 800, TODAY, TODAY)).toEqual({ lines: [{ accountId: 'livretA', amount: 300 }], missing: 500 });
    expect(planNeed([acc('vide', AccountType.LDDS, 0, { parentalCapital: 5000 })], CFG, 100, TODAY, TODAY).lines).toEqual([]);
  });

  it('à coût égal, un seul compte plutôt que plusieurs', () => {
    const small = acc('petit', AccountType.LIVRET_A, 300, { interestRate: 1.7 });
    const big = acc('grand', AccountType.LDDS, 1000, { interestRate: 1.7 });
    expect(planNeed([small, big], CFG, 800, TODAY, TODAY).lines).toEqual([{ accountId: 'grand', amount: 800 }]);
    // Aucun ne couvre tout : le plus garni d'abord.
    expect(planNeed([small, big], CFG, 1200, TODAY, TODAY).lines).toEqual([{ accountId: 'grand', amount: 1000 }, { accountId: 'petit', amount: 200 }]);
  });
});

describe('withdrawalCost : ce que coûte un retrait, en euros', () => {
  it('livret : les intérêts perdus d’ici la fin de l’année (quinzaines)', () => {
    const la = acc('la', AccountType.LIVRET_A, 5000, { interestRate: 1.7 });
    // Retiré le 4 novembre : plus rien depuis le 1er, soit 4 quinzaines sur 2 400 €.
    const c = withdrawalCost(la, 2400, CFG, '2026-11-04');
    expect(c.lostInterest).toBeCloseTo(2400 * 0.017 / 24 * 4, 6);
    expect(c).toMatchObject({ tax: 0, taxKnown: true });
    // Retiré le 16 novembre : une quinzaine de gardée.
    expect(withdrawalCost(la, 2400, CFG, '2026-11-16').lostInterest).toBeCloseTo(2400 * 0.017 / 24 * 3, 6);
    expect(withdrawalCost(acc('zero', AccountType.LDDS, 1000), 500, CFG, '2026-11-04').total).toBe(0);
  });

  it('assurance vie et PEA : l’impôt du retrait (computeWithdrawalTax)', () => {
    const w = computeWithdrawalTax(av, 500, CFG, new Date(2026, 10, 4));
    const c = withdrawalCost(av, 500, CFG, '2026-11-04');
    expect(c.tax).toBeCloseTo(w.incomeTax + w.socialCharges, 6);
    expect(c.tax).toBeGreaterThan(0);
    expect(c.lostInterest).toBeGreaterThan(0);
    // PEA de plus de 5 ans : prélèvements sociaux seulement.
    const p = computeWithdrawalTax(peaOld, 500, CFG, new Date(2026, 10, 4));
    expect(p.incomeTax).toBe(0);
    expect(withdrawalCost(peaOld, 500, CFG, '2026-11-04').tax).toBeCloseTo(p.socialCharges, 6);
    // Versements cumulés inconnus : impôt inconnu.
    expect(withdrawalCost(acc('pea', AccountType.PEA, 1000, { openingDate: '2015-01-01' }), 500, CFG, '2026-11-04')).toMatchObject({ tax: 0, taxKnown: false });
  });
});

describe('bestWithdrawalDay : le meilleur jour, jamais après le besoin', () => {
  const la = { type: AccountType.LIVRET_A, interestRate: 1.7 };
  it('livret : le dernier 1er ou 16 avant le besoin', () => {
    expect(bestWithdrawalDay(la, 2400, TODAY, '2026-11-20')).toBe('2026-11-16');
    expect(bestWithdrawalDay(la, 2400, TODAY, '2026-12-05')).toBe('2026-12-01');
    expect(bestWithdrawalDay(la, 2400, TODAY, '2026-11-16')).toBe('2026-11-16');
    // Aucune borne d'ici là : le jour du besoin.
    expect(bestWithdrawalDay(la, 2400, TODAY, '2026-11-10')).toBe('2026-11-10');
    expect(bestWithdrawalDay(la, 2400, '2026-11-16', '2026-11-30')).toBe('2026-11-30');
  });

  it('aujourd’hui : aujourd’hui ; autres comptes et petits montants : le jour du besoin', () => {
    expect(bestWithdrawalDay(la, 2400, TODAY, TODAY)).toBe(TODAY);
    expect(bestWithdrawalDay({ type: AccountType.ASSURANCE_VIE, interestRate: 3 }, 2400, TODAY, '2026-11-20')).toBe('2026-11-20');
    expect(bestWithdrawalDay(la, 10, TODAY, '2026-11-20')).toBe('2026-11-20');
  });

  it('ne tombe jamais après le besoin ni avant aujourd’hui', () => {
    for (let d = 4; d <= 60; d++) {
      const need = new Date(2026, 10, d);
      const iso = `${need.getFullYear()}-${String(need.getMonth() + 1).padStart(2, '0')}-${String(need.getDate()).padStart(2, '0')}`;
      const day = bestWithdrawalDay(la, 2400, TODAY, iso);
      expect(day <= iso && day >= TODAY).toBe(true);
    }
  });

  it('retrait prévu : le plus tôt des jours conseillés de ses lignes', () => {
    const accounts = [acc('la', AccountType.LIVRET_A, 5000, { interestRate: 1.7 }), av];
    expect(plannedDay([{ accountId: 'la', amount: 2400 }, { accountId: 'av', amount: 500 }], accounts, TODAY, '2026-11-20')).toBe('2026-11-16');
    expect(plannedDay([{ accountId: 'av', amount: 500 }], accounts, TODAY, '2026-11-20')).toBe('2026-11-20');
    expect(plannedDay([{ accountId: 'la', amount: 2400 }], accounts, TODAY, TODAY)).toBe(TODAY);
  });
});

describe('precautionAfter : prévenir seulement', () => {
  const la = acc('la', AccountType.LIVRET_A, 5000);
  const cc = acc('cc', AccountType.COMPTE_COURANT, 1000);
  const emergency = { target: 6000, cashBuffer: 1000 };
  it('dit le montant d’après quand il passe sous l’objectif', () => {
    expect(precautionAfter([la, cc], [{ accountId: 'la', amount: 800 }], emergency)).toEqual({ after: 4200, target: 6000 });
  });
  it('rien si l’objectif reste atteint, si la précaution ne bouge pas ou sans objectif', () => {
    expect(precautionAfter([acc('la', AccountType.LIVRET_A, 10000), cc], [{ accountId: 'la', amount: 800 }], emergency)).toBeNull();
    expect(precautionAfter([la, cc, av], [{ accountId: 'av', amount: 800 }], emergency)).toBeNull();
    expect(precautionAfter([la, cc], [{ accountId: 'la', amount: 800 }], null)).toBeNull();
  });
});
