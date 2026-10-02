import { describe, it, expect } from 'vitest';
import {
  computeWithdrawalTax,
  depositsAfterWithdrawal,
  computeMonthSavedAmount,
  nextSubscriptionDate,
  findDueSubscriptions,
  subscriptionMonthlyCost,
  subscriptionsAsExpenses,
  totalFixedCharges,
  computeSavingsRateHistory,
  computeDonationSummary,
  accountAgeYears,
  computeUnlockCost,
  findFiscalReview,
  applyTaxScale,
  normalizeAccounts,
  dedupeMonthlySnapshots,
  computeExpectedYearInterest,
  quinzaineWithdrawalTip,
  computeRestitutionPlan,
  suggestedRestitutionDate,
  accountsAfterRestitution,
  payPeriodOf,
  computePlacementStrategy,
  findAvRateUpdatesDue,
  applyRateChange,
  activeSavingsSplit,
  computeSavedSince,
  computeAccruedInterest,
} from './finance';
import { DEFAULT_FISCAL_CONFIG as CFG, TAX_SCALES, LATEST_TAX_SCALE } from '../constants';
import { AccountType, SavingsAccount, Subscription } from '../types';
import { formatISODay } from './dates';

const acc = (over: Partial<SavingsAccount>): SavingsAccount => ({
  id: over.name || 'x', name: 'x', type: AccountType.LIVRET_A, institution: 'B',
  totalAmount: 10000, ownedAmount: 10000, parentalCapital: 0, movements: [], ...over,
});
const NOW = new Date(2026, 8, 30, 9); // 30 septembre 2026

describe('computeWithdrawalTax', () => {
  it("n'impose que la part de gains contenue dans le retrait", () => {
    // PEA de 10 ans : 10 000 € dont 4 000 € de gains → 1 000 € retirés contiennent 400 € de gains.
    const t = computeWithdrawalTax(acc({ type: AccountType.PEA, openingDate: '2016-01-01', totalDeposits: 6000 }), 1000, CFG, NOW);
    expect(t.known).toBe(true);
    expect(t.gainPart).toBeCloseTo(400);
    expect(t.incomeTax).toBe(0);
    expect(t.socialCharges).toBeCloseTo(400 * CFG.socialChargesCapital);
    expect(t.closesPea).toBe(false);
  });

  it('signale la clôture d’un PEA de moins de 5 ans et applique le PFU', () => {
    const t = computeWithdrawalTax(acc({ type: AccountType.PEA, openingDate: '2024-01-01', totalDeposits: 6000 }), 1000, CFG, NOW);
    expect(t.closesPea).toBe(true);
    expect(t.incomeTax).toBeCloseTo(400 * 0.128);
  });

  it('Assurance Vie de plus de 8 ans : abattement de 4 600 € avant le taux réduit', () => {
    const av = acc({ type: AccountType.ASSURANCE_VIE, openingDate: '2010-01-01', totalAmount: 100000, ownedAmount: 100000, totalDeposits: 50000 });
    expect(computeWithdrawalTax(av, 5000, CFG, NOW).incomeTax).toBe(0); // 2 500 € de gains < abattement
    expect(computeWithdrawalTax(av, 20000, CFG, NOW).incomeTax).toBeCloseTo((10000 - 4600) * 0.075);
  });

  it('reste « inconnu » sans versements cumulés', () => {
    expect(computeWithdrawalTax(acc({ type: AccountType.PEA }), 1000, CFG, NOW).known).toBe(false);
  });

  it('un retrait emporte les versements au prorata', () => {
    expect(depositsAfterWithdrawal(6000, 10000, 1000)).toBeCloseTo(5400);
    expect(depositsAfterWithdrawal(6000, 10000, 20000)).toBe(0);
  });
});

describe('computeMonthSavedAmount', () => {
  it('compte versements − retraits du mois, hors valorisation et hors compte courant', () => {
    const accounts = [
      acc({ movements: [
        { id: '1', date: '2026-09-05', amount: 300, label: 'x', type: 'IN' },
        { id: '2', date: '2026-09-20', amount: 50, label: 'x', type: 'OUT' },
        { id: '3', date: '2026-08-31', amount: 999, label: 'x', type: 'IN' },
      ] }),
      acc({ type: AccountType.PEA, movements: [
        { id: '4', date: '2026-09-10', amount: 200, label: 'Versement', type: 'IN' },
        { id: '5', date: '2026-09-10', amount: 80, label: 'Valorisation', type: 'IN', kind: 'valuation' },
      ] }),
      acc({ type: AccountType.COMPTE_COURANT, movements: [{ id: '6', date: '2026-09-02', amount: 2000, label: 'Salaire', type: 'IN' }] }),
    ];
    expect(computeMonthSavedAmount(accounts, NOW)).toBe(450);
  });
});

describe('abonnements', () => {
  const sub = (over: Partial<Subscription>): Subscription => ({
    id: 's', name: 'Netflix', amount: 13.49, debitAccount: 'BP', frequency: 'monthly', anchorDate: '2026-01-31', active: true, ...over,
  });

  it('ramène le 31 au dernier jour sans dériver', () => {
    expect(formatISODay(nextSubscriptionDate(sub({}), new Date(2026, 1, 10)))).toBe('2026-02-28');
    expect(formatISODay(nextSubscriptionDate(sub({}), new Date(2026, 2, 1)))).toBe('2026-03-31');
  });

  it('gère annuel, trimestriel et hebdomadaire', () => {
    expect(formatISODay(nextSubscriptionDate(sub({ frequency: 'yearly', anchorDate: '2024-03-15' }), NOW))).toBe('2027-03-15');
    expect(formatISODay(nextSubscriptionDate(sub({ frequency: 'quarterly', anchorDate: '2026-01-10' }), NOW))).toBe('2026-10-10');
    expect(formatISODay(nextSubscriptionDate(sub({ frequency: 'weekly', anchorDate: '2026-09-01' }), NOW))).toBe('2026-10-06');
  });

  it('prévient la veille sous 100 €, une semaine avant au-delà', () => {
    const small = sub({ anchorDate: '2026-10-05' });
    const big = sub({ id: 'b', amount: 120, anchorDate: '2026-10-05' });
    const ids = (d: Date) => findDueSubscriptions([small, big], d).map(x => x.subscription.id);
    expect(ids(new Date(2026, 8, 27))).toEqual([]);
    expect(ids(new Date(2026, 8, 28))).toEqual(['b']);
    expect(ids(new Date(2026, 9, 4))).toEqual(['s', 'b']);
    expect(ids(new Date(2026, 9, 5))).toEqual([]); // le jour même : trop tard
  });

  it('ignore les abonnements désactivés et calcule le coût mensuel', () => {
    expect(findDueSubscriptions([sub({ active: false, anchorDate: '2026-10-01' })], NOW)).toEqual([]);
    expect(subscriptionMonthlyCost({ amount: 120, frequency: 'yearly' })).toBe(10);
  });

  it('ajoute les seuls abonnements mensuels actifs aux charges fixes', () => {
    const subs = [
      sub({ id: 'n', amount: 13.49 }),
      sub({ id: 'a', name: 'Assurance', amount: 120, frequency: 'yearly' }),
      sub({ id: 'p', name: 'En pause', amount: 50, active: false }),
    ];
    // L'annuel ne pèse pas sur les charges mensuelles : il ne fait que déclencher un rappel.
    expect(subscriptionsAsExpenses(subs).map(e => e.id)).toEqual(['sub:n']);
    expect(totalFixedCharges([{ id: 'loyer', name: 'Loyer', amount: 800 }], subs)).toBeCloseTo(800 + 13.49);
  });
});

describe("taux d'épargne", () => {
  it('rapporte les versements de chaque mois à la paie, mois en cours inclus', () => {
    const accounts = [acc({ movements: [
      { id: '1', date: '2026-08-05', amount: 500, label: 'x', type: 'IN' },
      { id: '2', date: '2026-09-05', amount: 250, label: 'x', type: 'IN' },
    ] })];
    const h = computeSavingsRateHistory(accounts, 2500, 3, NOW);
    expect(h.map(m => m.month)).toEqual(['2026-07', '2026-08', '2026-09']);
    expect(h.map(m => m.rate)).toEqual([0, 20, 10]);
  });
});

describe('dons', () => {
  it('plafonne le taux de 75 % et bascule l’excédent à 66 %', () => {
    const s = computeDonationSummary([
      { id: 'a', date: '2026-02-01', amount: 2200, organization: 'Restos', rate: 75, receiptReceived: true },
      { id: 'b', date: '2026-06-01', amount: 100, organization: 'MSF', rate: 66, receiptReceived: false },
      { id: 'c', date: '2025-06-01', amount: 500, organization: 'Autre année', rate: 66, receiptReceived: false },
    ], 2026);
    // Plafond à 75 % : 2 000 € depuis le 14 octobre 2025.
    expect(s.total).toBe(2300);
    expect(s.total75).toBe(2000);
    expect(s.total66).toBe(300);
    expect(s.reduction).toBeCloseTo(1500 + 198);
    expect(s.missingReceipts.map(d => d.id)).toEqual(['b']);
  });
});

describe('ancienneté et déblocage', () => {
  it("compte les années au jour anniversaire près", () => {
    expect(Math.floor(accountAgeYears('2021-03-12', new Date(2026, 2, 11)))).toBe(4);
    expect(accountAgeYears('2021-03-12', new Date(2026, 2, 12))).toBe(5);
  });

  it("chiffre l'impôt en plus d'un retrait avant maturité et la date de libération", () => {
    const av = acc({ name: 'AV', type: AccountType.ASSURANCE_VIE, openingDate: '2022-06-01', totalAmount: 20000, ownedAmount: 20000, totalDeposits: 15000 });
    const pea = acc({ name: 'PEA', type: AccountType.PEA, openingDate: '2023-01-15', totalDeposits: 8000 });
    const u = computeUnlockCost([av, pea, acc({ name: 'Inconnu', type: AccountType.PEA, openingDate: '2024-01-01' })], CFG, NOW);
    // AV : 5 000 € de gains → 12,8 % maintenant, 7,5 % au-delà de l'abattement de 4 600 € après 8 ans.
    // PEA : 2 000 € de gains → 12,8 % maintenant, exonéré après 5 ans.
    expect(u.extraTax).toBeCloseTo(5000 * 0.128 - 400 * 0.075 + 2000 * 0.128);
    expect(u.closesPea).toBe(true);
    expect(u.unknown).toEqual(['Inconnu']);
    expect(u.nextFree).toEqual({ date: '2028-01-15', name: 'PEA' });
  });
});

describe('barème et vérification annuelle', () => {
  const old = { ...CFG, taxBrackets: TAX_SCALES[0].brackets, taxScaleYear: undefined };
  it('propose le nouveau barème et garde l’ancien en historique', () => {
    expect(findFiscalReview(old, NOW).newScale?.year).toBe(LATEST_TAX_SCALE.year);
    const next = applyTaxScale(old, LATEST_TAX_SCALE, NOW);
    expect(findFiscalReview(next, NOW).newScale).toBeUndefined();
    expect(next.taxBracketsHistory?.[0]).toMatchObject({ year: 2024, replacedOn: '2026-09-30' });
  });
  it('reconnaît un barème revenu du JSON (Infinity → null)', () => {
    const fromJson = JSON.parse(JSON.stringify({ ...CFG }));
    expect(findFiscalReview(fromJson, NOW).newScale).toBeUndefined();
  });
  it('ne propose rien pour un barème saisi à la main plus récent', () => {
    expect(findFiscalReview({ ...CFG, taxBrackets: [{ limit: Infinity, rate: 0.2 }], taxScaleYear: 2030 }, NOW).newScale).toBeUndefined();
  });
  it('demande la vérification de janvier à mars, une fois par an', () => {
    expect(findFiscalReview(CFG, new Date(2027, 1, 1)).annualCheckDue).toBe(true);
    expect(findFiscalReview({ ...CFG, paramsReviewedYear: 2027 }, new Date(2027, 1, 1)).annualCheckDue).toBe(false);
    expect(findFiscalReview(CFG, NOW).annualCheckDue).toBe(false);
  });
});

describe('nettoyage au chargement', () => {
  it('retire les espaces superflus des noms et établissements', () => {
    const [a] = normalizeAccounts([acc({ name: ' LEP  - BPVF ', institution: 'BPVF ' })]);
    expect(a.name).toBe('LEP - BPVF');
    expect(a.institution).toBe('BPVF');
  });
  it("garde un point d'historique par mois, le plus récent", () => {
    const h = dedupeMonthlySnapshots([
      { date: '2026-01-03', v: 1 }, { date: '2026-01-28', v: 2 }, { date: '2026-02-10', v: 3 }, { date: '2026-01-15', v: 4 },
    ]);
    expect(h.map(x => x.v)).toEqual([2, 3]);
  });
});

describe('intérêts attendus et conseil de retrait', () => {
  it("compte l'année entière aux soldes actuels, part parentale à part", () => {
    // 10 000 € toute l'année à 3 %, dont 4 000 € aux parents.
    const a = acc({ interestRate: 3, totalAmount: 10000, ownedAmount: 6000, parentalCapital: 4000, movements: [{ id: 'm', date: '2025-06-01', amount: 6000, label: 'x', type: 'IN' }] });
    const e = computeExpectedYearInterest([a], 2026);
    expect(e.total).toBeCloseTo(300);
    expect(e.parental).toBeCloseTo(120);
  });
  it('conseille d’attendre la prochaine quinzaine pour un retrait de livret', () => {
    expect(quinzaineWithdrawalTip({ type: AccountType.LIVRET_A, interestRate: 2.4 }, 5000, new Date(2026, 8, 10))).toEqual({ waitUntil: '2026-09-16', gain: 5 });
    expect(quinzaineWithdrawalTip({ type: AccountType.LIVRET_A, interestRate: 2.4 }, 5000, new Date(2026, 8, 16))).toBeNull();
    expect(quinzaineWithdrawalTip({ type: AccountType.ASSURANCE_VIE, interestRate: 3 }, 5000, new Date(2026, 8, 10))).toBeNull();
  });
});

describe('restitution du capital parental', () => {
  const lep = acc({ id: 'lep', name: 'LEP', type: AccountType.LEP, interestRate: 2.4, totalAmount: 10000, ownedAmount: 1754, parentalCapital: 8246 });
  const av = acc({ id: 'av', name: 'AV', type: AccountType.ASSURANCE_VIE, interestRate: 3, totalAmount: 400, ownedAmount: 400, parentalCapital: 0 });

  it('conseille le 1er janvier : toute l’année est acquise', () => {
    expect(suggestedRestitutionDate(NOW)).toBe('2027-01-01');
    const p = computeRestitutionPlan([lep, av], '2027-01-01');
    expect(p.interestYear).toBe(2026);
    expect(p.rows.map(r => r.accountId)).toEqual(['lep']);
    expect(p.total).toBe(8246);
    expect(p.totalInterest).toBeCloseTo(8246 * 0.024);
    expect(p.totalLost).toBe(0);
  });

  it('chiffre la perte d’un retrait mi-décembre (dernière quinzaine)', () => {
    const p = computeRestitutionPlan([lep], '2026-12-20');
    expect(p.totalLost).toBeCloseTo(8246 * 0.024 / 24);
  });

  it('retire la part parentale sans toucher à la part propre', () => {
    const [after] = accountsAfterRestitution([lep]);
    expect(after.parentalCapital).toBe(0);
    expect(after.ownedAmount).toBe(1754);
    expect(after.totalAmount).toBe(1754);
  });
});

describe('période de paie', () => {
  it('rattache le début du mois à la paie du mois précédent', () => {
    expect(payPeriodOf(27, new Date(2026, 9, 1)).key).toBe('2026-09');
    expect(payPeriodOf(27, new Date(2026, 9, 27)).key).toBe('2026-10');
    expect(payPeriodOf(27, new Date(2027, 0, 5)).key).toBe('2026-12');
    expect(payPeriodOf(undefined, new Date(2026, 9, 1)).key).toBe('2026-10');
  });
  it('ramène le 31 au dernier jour du mois', () => {
    const p = payPeriodOf(31, new Date(2026, 8, 30));
    expect(p.key).toBe('2026-09');
    expect(p.payDate.getDate()).toBe(30);
  });
});

describe('LDDS et taux servi', () => {
  const fullLep = acc({ id: 'lep', name: 'LEP', type: AccountType.LEP, interestRate: 2.5, totalAmount: 10000, ownedAmount: 10000 });
  const fullLa = acc({ id: 'la', name: 'Livret A', type: AccountType.LIVRET_A, interestRate: 1.5, totalAmount: 22950, ownedAmount: 22950 });
  const av = acc({ id: 'av', name: 'AV', type: AccountType.ASSURANCE_VIE, interestRate: 3, totalAmount: 400, ownedAmount: 400 });

  it("suggère un LDDS sans retirer l'argent de l'Assurance Vie existante", () => {
    const steps = computePlacementStrategy(500, [fullLep, fullLa, av], CFG);
    expect(steps.map(s => s.accountName)).toEqual(['Ouvrir un LDDS', 'AV']);
    expect(steps[0].infoOnly).toBe(true);
    expect(steps[1].fillAmount).toBe(500);
  });
  it("place sur le LDDS à ouvrir quand il n'y a aucun autre placement", () => {
    const steps = computePlacementStrategy(500, [fullLep, fullLa], CFG);
    expect(steps.map(s => [s.accountName, s.fillAmount, !!s.infoOnly])).toEqual([['Ouvrir un LDDS', 500, false]]);
  });
  it("demande le nouveau taux servi de l'AV après le 15 janvier", () => {
    expect(findAvRateUpdatesDue([av], new Date(2027, 0, 20)).map(a => a.id)).toEqual(['av']);
    expect(findAvRateUpdatesDue([{ ...av, rateHistory: [{ date: '2027-01-18', rate: 2.8 }] }], new Date(2027, 0, 20))).toEqual([]);
    expect(findAvRateUpdatesDue([av], new Date(2027, 5, 1))).toEqual([]);
  });
});

describe('solde initial', () => {
  it("n'est compté ni comme épargne du mois ni dans la reconstitution du passé", () => {
    const a = acc({ totalAmount: 5300, ownedAmount: 5300, movements: [
      { id: 'i', date: '2026-09-02', amount: 5000, label: 'Solde initial', type: 'IN' },
      { id: 'v', date: '2026-09-10', amount: 300, label: 'Virement', type: 'IN' },
    ] });
    expect(computeMonthSavedAmount([a], NOW)).toBe(300);
  });
});

describe('changement de taux daté', () => {
  it("applique 1,7 % à partir du 1er août, l'ancien taux avant", () => {
    const la = acc({ interestRate: 1.5, totalAmount: 2400, ownedAmount: 2400, movements: [{ id: 'm', date: '2025-01-01', amount: 2400, label: 'x', type: 'IN' }] });
    const next = applyRateChange(la, 1.7, '2026-08-01');
    expect(next.interestRate).toBe(1.7);
    expect(next.rateHistory).toEqual([{ date: '2026-08-01', rate: 1.5 }]);
    // 14 quinzaines à 1,5 % puis 10 à 1,7 % sur 2 400 €.
    expect(computeAccruedInterest(next, 2026, new Date(2027, 0, 1))).toBeCloseTo(2400 * (0.015 * 14 + 0.017 * 10) / 24);
  });
  it('remplace un changement saisi plus tard par erreur (daté du jour de saisie)', () => {
    const la = acc({ interestRate: 1.7, rateHistory: [{ date: '2026-10-01', rate: 1.5 }] });
    const next = applyRateChange(la, 1.7, '2026-08-01');
    expect(next.rateHistory).toEqual([{ date: '2026-08-01', rate: 1.5 }]);
  });
});

describe('répartition personnalisée', () => {
  const la = acc({ id: 'la', name: 'Livret A', interestRate: 1.7, totalAmount: 8310, ownedAmount: 8310 });
  const av = acc({ id: 'av', name: 'AV', type: AccountType.ASSURANCE_VIE, interestRate: 3, totalAmount: 400, ownedAmount: 400 });
  const lep = acc({ id: 'lep', name: 'LEP', type: AccountType.LEP, interestRate: 2.5, totalAmount: 1754, ownedAmount: 1754 });
  const split = [{ accountId: 'la', pct: 50 }, { accountId: 'av', pct: 50 }];

  it('répartit 1 000 € à 50/50, même si le LEP a de la place', () => {
    const steps = computePlacementStrategy(1000, [la, av, lep], CFG, split);
    expect(steps.map(s => [s.accountName, s.fillAmount])).toEqual([['Livret A', 500], ['AV', 500]]);
  });
  it("reporte l'excédent d'un livret plein sur le compte sans plafond", () => {
    const fullish = { ...la, totalAmount: 22800 };
    const steps = computePlacementStrategy(1000, [fullish, av], CFG, split);
    expect(steps.find(s => s.accountId === 'la')?.fillAmount).toBeCloseTo(150);
    expect(steps.find(s => s.accountId === 'av')?.fillAmount).toBeCloseTo(850);
    expect(steps.some(s => s.infoOnly && s.hint?.includes('plein'))).toBe(true);
  });
  it('ramène les pourcentages à 100 et ne s’applique qu’à partir de la date choisie', () => {
    const steps = computePlacementStrategy(900, [la, av], CFG, [{ accountId: 'la', pct: 1 }, { accountId: 'av', pct: 2 }]);
    expect(steps.map(s => s.fillAmount)).toEqual([300, 600]);
    expect(activeSavingsSplit({ savingsSplit: split, savingsSplitFrom: '2027-01-01' }, NOW)).toBeUndefined();
    expect(activeSavingsSplit({ savingsSplit: split, savingsSplitFrom: '2027-01-01' }, new Date(2027, 0, 1))).toEqual(split);
  });
});

describe('part des parents tracée', () => {
  const lep = acc({ id: 'lep', name: 'LEP', type: AccountType.LEP, interestRate: 2.4, totalAmount: 10000, ownedAmount: 1754, parentalCapital: 8246, movements: [{ id: 'o', date: '2025-01-01', amount: 1754, label: 'x', type: 'IN' }] });

  it('la restitution laisse un mouvement et ne réécrit pas les intérêts de l’année', () => {
    const before = computeAccruedInterest(lep, 2026, new Date(2027, 0, 1));
    const [after] = accountsAfterRestitution([lep], '2027-01-01');
    expect(after.movements?.some(m => m.kind === 'parental' && m.type === 'OUT' && m.amount === 8246)).toBe(true);
    expect(computeAccruedInterest(after, 2026, new Date(2027, 0, 1))).toBeCloseTo(before);
  });

  it("n'est jamais comptée comme votre épargne", () => {
    const a = acc({ movements: [
      { id: 'p', date: '2026-09-05', amount: 500, label: 'Part des parents (+)', type: 'IN', kind: 'parental' },
      { id: 'v', date: '2026-09-06', amount: 100, label: 'Virement', type: 'IN' },
    ] });
    expect(computeMonthSavedAmount([a], NOW)).toBe(100);
    expect(computeSavedSince([a], '2026-09-01', NOW)).toBe(100);
  });

  it('un solde initial rapporte depuis l’ouverture du compte', () => {
    const la = acc({ interestRate: 2.4, totalAmount: 2400, ownedAmount: 2400, openingDate: '2020-01-01',
      movements: [{ id: 'i', date: '2026-06-10', amount: 2400, label: 'Solde initial', type: 'IN' }] });
    expect(computeAccruedInterest(la, 2026, new Date(2027, 0, 1))).toBeCloseTo(2400 * 0.024);
  });
});

describe('corrections et point de départ du suivi', () => {
  const a = acc({ movements: [
    { id: '1', date: '2026-09-27', amount: 850, label: 'Actualisation (+)', type: 'IN', kind: 'adjustment' },
    { id: '2', date: '2026-09-10', amount: 300, label: 'Virement', type: 'IN' },
    { id: '3', date: '2026-09-28', amount: 200, label: 'Virement', type: 'IN' },
  ] });
  it("une correction n'est pas de l'épargne", () => {
    expect(computeMonthSavedAmount([a], NOW)).toBe(500);
  });
  it('seuls les mouvements après le point de départ comptent', () => {
    expect(computeMonthSavedAmount([a], NOW, '2026-09-20')).toBe(200);
    expect(computeSavedSince([a], '2026-09-01', NOW, '2026-09-20')).toBe(200);
  });
});

describe('fonds euros et petites cessions de crypto', () => {
  it("ne compte pas de prélèvements sociaux sur la part en fonds euros", () => {
    const av = acc({ type: AccountType.ASSURANCE_VIE, openingDate: '2024-01-01', totalDeposits: 6000 });
    const all = computeWithdrawalTax(av, 1000, CFG, NOW);
    const euro = computeWithdrawalTax({ ...av, euroFundPct: 100 }, 1000, CFG, NOW);
    const half = computeWithdrawalTax({ ...av, euroFundPct: 50 }, 1000, CFG, NOW);
    expect(all.socialCharges).toBeGreaterThan(0);
    expect(euro.socialCharges).toBe(0);
    expect(half.socialCharges).toBeCloseTo(all.socialCharges / 2);
  });
  it('exonère une cession de crypto de 305 € au plus', () => {
    const c = acc({ type: AccountType.CRYPTO, totalDeposits: 6000 });
    expect(computeWithdrawalTax(c, 300, CFG, NOW).incomeTax).toBe(0);
    expect(computeWithdrawalTax(c, 1000, CFG, NOW).incomeTax).toBeGreaterThan(0);
  });
});
