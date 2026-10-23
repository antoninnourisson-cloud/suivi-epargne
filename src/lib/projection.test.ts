import { describe, it, expect } from 'vitest';
import { netAnnualRate, netMonthlyRateSchedule, projectSavings, detectPayRaise, computeBadgeCount, IDLE_ACCOUNT_ID } from './projection';
import { DEFAULT_FISCAL_CONFIG as CFG } from '../constants';
import { AccountType, GlobalAppData, SavingsAccount, PayslipRecord } from '../types';

const acc = (over: Partial<SavingsAccount>): SavingsAccount => ({
  id: 'x', name: 'x', type: AccountType.LIVRET_A, institution: 'B',
  totalAmount: 0, ownedAmount: 0, parentalCapital: 0, movements: [], ...over,
});

// Valeurs attendues FIGÉES (2026), jamais recalculées depuis la configuration testée :
// prélèvements sociaux 18,6 % (17,2 % sur l'assurance vie) et part « impôt » du PFU 12,8 %.
// https://www.service-public.gouv.fr/particuliers/vosdroits/F2329
// https://www.impots.gouv.fr/particulier/questions/jai-realise-une-plus-value-mobiliere-comment-est-elle-imposee
// https://www.impots.gouv.fr/particulier/questions/comment-declarer-les-plus-ou-moins-values-sur-cessions-dactifs-numeriques
describe('netAnnualRate', () => {
  const AT = new Date(2026, 9, 1); // 1er octobre 2026

  it('livrets réglementés : le taux affiché', () => {
    expect(netAnnualRate(acc({ interestRate: 1.7 }), CFG, AT)).toBe(1.7);
  });

  it('assurance vie de moins de 8 ans (ou ancienneté inconnue) : 17,2 % + 12,8 % retenus', () => {
    expect(netAnnualRate(acc({ type: AccountType.ASSURANCE_VIE, interestRate: 3 }), CFG, AT)).toBeCloseTo(2.1, 10);
    expect(netAnnualRate(acc({ type: AccountType.ASSURANCE_VIE, interestRate: 3, openingDate: '2024-06-15' }), CFG, AT)).toBeCloseTo(2.1, 10);
    // Frais de gestion déduits d'abord : (3 − 0,6) × 0,7.
    expect(netAnnualRate(acc({ type: AccountType.ASSURANCE_VIE, interestRate: 3, managementFee: 0.6 }), CFG, AT)).toBeCloseTo(1.68, 10);
  });

  it('assurance vie de 8 ans et plus : prélèvements sociaux seuls (gains sous l’abattement)', () => {
    expect(netAnnualRate(acc({ type: AccountType.ASSURANCE_VIE, interestRate: 3, openingDate: '2018-01-01' }), CFG, AT)).toBeCloseTo(2.484, 10);
  });

  it('PEA : 18,6 % + 12,8 % avant 5 ans, 18,6 % ensuite', () => {
    expect(netAnnualRate(acc({ type: AccountType.PEA, interestRate: 5, openingDate: '2023-01-01' }), CFG, AT)).toBeCloseTo(3.43, 10);
    expect(netAnnualRate(acc({ type: AccountType.PEA, interestRate: 5, openingDate: '2020-01-01' }), CFG, AT)).toBeCloseTo(4.07, 10);
  });

  it('crypto et « Autre » : PFU de 31,4 % quelle que soit l’ancienneté', () => {
    expect(netAnnualRate(acc({ type: AccountType.CRYPTO, interestRate: 8, openingDate: '2010-01-01' }), CFG, AT)).toBeCloseTo(5.488, 10);
    expect(netAnnualRate(acc({ type: AccountType.AUTRE, interestRate: 3, openingDate: '2010-01-01' }), CFG, AT)).toBeCloseTo(2.058, 10);
  });

  it('PEE : toujours sans impôt sur le revenu, prélèvements sociaux seuls', () => {
    expect(netAnnualRate(acc({ type: AccountType.PEE, interestRate: 5, openingDate: '2026-01-01' }), CFG, AT)).toBeCloseTo(4.07, 10);
  });
});

describe('netMonthlyRateSchedule', () => {
  it('passe au taux mûr le mois du 5e anniversaire d’un PEA', () => {
    // Ouvert le 01/03/2022, projection au 01/10/2026 : maturité le 01/03/2027, dans 5 mois.
    const rate = netMonthlyRateSchedule(acc({ type: AccountType.PEA, interestRate: 5, openingDate: '2022-03-01' }), CFG, new Date(2026, 9, 1));
    expect(rate(4)).toBeCloseTo(3.43 / 1200, 12);
    expect(rate(5)).toBeCloseTo(4.07 / 1200, 12);
  });
  it('taux constant sans maturité à venir', () => {
    const rate = netMonthlyRateSchedule(acc({ type: AccountType.CRYPTO, interestRate: 8 }), CFG, new Date(2026, 9, 1));
    expect(rate(0)).toBeCloseTo(5.488 / 1200, 12);
    expect(rate(120)).toBeCloseTo(5.488 / 1200, 12);
  });
});

describe('projectSavings : rien ne se perd', () => {
  it('ce qui ne trouve pas de place reste compté sur le compte courant', () => {
    // Livret A plein, sans LDDS, AV ni PEA : 500 € par mois pendant un an n'ont nulle part où aller.
    const full = acc({ id: 'la', name: 'Livret A', interestRate: 0, totalAmount: 22950, ownedAmount: 22950 });
    const r = projectSavings([full], CFG, 500, 1, undefined, undefined, new Date(2026, 9, 1));
    expect(r.unplaced).toBe(6000);
    expect(r.byAccount.find(b => b.accountId === IDLE_ACCOUNT_ID)?.amount).toBe(6000);
    expect(r.total).toBe(22950 + 6000);
    expect(r.interest).toBe(0);
  });
  it('un compte courant saisi garde cet argent, sans intérêts', () => {
    const full = acc({ id: 'la', name: 'Livret A', interestRate: 0, totalAmount: 22950, ownedAmount: 22950 });
    const cc = acc({ id: 'cc', name: 'Compte courant', type: AccountType.COMPTE_COURANT, interestRate: 2, totalAmount: 1000, ownedAmount: 1000 });
    const r = projectSavings([full, cc], CFG, 500, 1, undefined, undefined, new Date(2026, 9, 1));
    expect(r.byAccount.find(b => b.accountId === 'cc')?.amount).toBe(7000);
    expect(r.total).toBe(22950 + 7000);
  });
});

describe('projectSavings', () => {
  const la = acc({ id: 'la', name: 'Livret A', interestRate: 1.7 });
  const av = acc({ id: 'av', name: 'AV', type: AccountType.ASSURANCE_VIE, interestRate: 3 });

  it('compose les intérêts nets et répartit selon la répartition', () => {
    const r = projectSavings([la, av], CFG, 1000, 1, [{ accountId: 'la', pct: 50 }, { accountId: 'av', pct: 50 }]);
    expect(r.deposited).toBe(12000);
    expect(r.interest).toBeGreaterThan(0);
    expect(r.byAccount.find(b => b.accountId === 'la')!.amount).toBeGreaterThan(6000);
  });
  it('ne verse plus au-delà du plafond du Livret A (seuls les intérêts le dépassent, comme en vrai)', () => {
    const r = projectSavings([la, av], CFG, 1000, 3, [{ accountId: 'la', pct: 100 }]);
    expect(r.byAccount.find(b => b.accountId === 'la')!.amount).toBeLessThan(CFG.ceilings.livretA * 1.03);
    expect(r.byAccount.find(b => b.accountId === 'av')!.amount).toBeGreaterThan(10000);
  });
});

describe('projectSavings : rendement supposé (performance observée)', () => {
  const AT = new Date(2026, 9, 1);
  const full = acc({ id: 'la', name: 'Livret A', interestRate: 0, totalAmount: 22950, ownedAmount: 22950 });
  const pea = acc({ id: 'pea', name: 'PEA', type: AccountType.PEA, totalAmount: 5000, ownedAmount: 5000, openingDate: '2018-01-01' });
  const av = acc({ id: 'av', name: 'AV', type: AccountType.ASSURANCE_VIE, interestRate: 2.6 });

  it('change les intérêts du placement, jamais la répartition du vrai plan', () => {
    const real = projectSavings([full, pea, av], CFG, 500, 1, undefined, undefined, AT);
    const assumed = projectSavings([full, pea, av], CFG, 500, 1, undefined, undefined, AT, { pea: 8 });
    const own = (r: typeof real, id: string) => r.byAccount.find(b => b.accountId === id)?.amount ?? 0;
    // Même destination des versements que le plan du Pilotage (taux saisis : le PEA sans taux
    // ne passe pas devant l'assurance vie à 2,6 %).
    expect(own(real, 'av')).toBeGreaterThan(6000);
    expect(own(assumed, 'av')).toBeCloseTo(own(real, 'av'), 6);
    // L'ancienne façon (taux du compte remplacé) envoyait l'excédent au PEA.
    const mutated = projectSavings([full, { ...pea, interestRate: 8 }, av], CFG, 500, 1, undefined, undefined, AT);
    expect(own(mutated, 'av')).toBeLessThan(own(real, 'av'));
    expect(own(real, 'pea')).toBe(5000);
    // PEA de plus de 5 ans : 8 % moins 18,6 % de prélèvements sociaux, sur un an.
    expect(own(assumed, 'pea')).toBeCloseTo(5000 * Math.pow(1 + 0.08 * 0.814 / 12, 12), 2);
  });

  it('frais de gestion non retirés une seconde fois (la performance observée en est déjà nette)', () => {
    const withFee = { ...pea, managementFee: 0.5 };
    const a = projectSavings([full, withFee, av], CFG, 0, 1, undefined, undefined, AT, { pea: 8 });
    const b = projectSavings([full, pea, av], CFG, 0, 1, undefined, undefined, AT, { pea: 8 });
    expect(a.total).toBeCloseTo(b.total, 6);
  });
});

describe('detectPayRaise', () => {
  const slip = (id: string, period: string, netPaid: number): PayslipRecord =>
    ({ id, fileId: id, fileName: id, period, extracted: { period, netPaid } } as unknown as PayslipRecord);
  it('repère une hausse du net entre les deux dernières fiches', () => {
    const r = detectPayRaise([slip('a', '2026-08', 2938), slip('b', '2026-09', 3397)]);
    expect(r?.delta).toBeCloseTo(459);
    expect(detectPayRaise([slip('a', '2026-08', 2938), slip('b', '2026-09', 2940)])).toBeNull();
  });
});

describe('computeBadgeCount', () => {
  it('compte les virements de la paie en cours non cochés', () => {
    const data: GlobalAppData = {
      accounts: [acc({ id: 'la', interestRate: 1.7, totalAmount: 1000, ownedAmount: 1000 })],
      expenses: [{ id: 'e', name: 'Commun', amount: 900 }], history: [],
      config: { grossAnnual: 0, leisureBudget: 0, projectSavings: 0, taxRateManual: 0, extraMonthlyIncome: 0, paydayDay: 27, paydayAmount: 500 },
      fiscalConfig: { ...CFG, paramsReviewedYear: 2026 },
      payChecklist: { month: '2026-09', lines: [
        { key: 't:Commun', label: 'Commun', amount: 900, kind: 'transfer' },
        { key: 's:la', label: 'Livret A', amount: 500, kind: 'saving', accountId: 'la' },
      ], done: { 't:Commun': { amount: 900 } } },
    };
    expect(computeBadgeCount(data, new Date(2026, 9, 1))).toBe(1);
  });
});

describe('projectSavings et restitution', () => {
  it('libère la place sous le plafond après la restitution du capital parental', () => {
    const la = { id: 'la', name: 'Livret A', institution: 'B', type: AccountType.LIVRET_A, totalAmount: 22950, ownedAmount: 12950, parentalCapital: 10000, interestRate: 0, movements: [] } as any;
    const av = { id: 'av', name: 'AV', institution: 'B', type: AccountType.ASSURANCE_VIE, totalAmount: 0, ownedAmount: 0, parentalCapital: 0, interestRate: 0, movements: [] } as any;
    const without = projectSavings([la, av], CFG, 1000, 1);
    const withRestitution = projectSavings([la, av], CFG, 1000, 1, undefined, 0);
    const laOwn = (r: any) => r.byAccount.find((b: any) => b.accountId === 'la').amount;
    expect(laOwn(without)).toBeCloseTo(12950);
    expect(laOwn(withRestitution)).toBeGreaterThan(12950);
  });
});
