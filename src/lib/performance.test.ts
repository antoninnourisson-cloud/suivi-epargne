import { describe, it, expect } from 'vitest';
import { averageRateBetween } from './finance';
import { xirr, accountPerformance, livretAOverPeriod, assumedAnnualRate, withAssumedRates, isMarketAccount, OBSERVED_RATE_CAP, OBSERVED_RATE_FLOOR, OBSERVED_RATE_MIN_YEARS } from './performance';
import { AccountMovement, AccountType, SavingsAccount } from '../types';

const NOW = new Date(2026, 9, 21);
const mv = (id: string, date: string, amount: number, over: Partial<AccountMovement> = {}): AccountMovement =>
  ({ id, date, amount: Math.abs(amount), type: amount >= 0 ? 'IN' : 'OUT', label: 'x', ...over });
const acc = (over: Partial<SavingsAccount>): SavingsAccount => ({
  id: 'a', name: 'PEA', type: AccountType.PEA, institution: 'B', totalAmount: 0, ownedAmount: 0, parentalCapital: 0, movements: [], ...over,
});

describe('xirr', () => {
  it('un an pile : le gain simple', () => {
    expect(xirr([{ date: '2025-01-01', amount: -1000 }, { date: '2026-01-01', amount: 1100 }])).toBeCloseTo(0.1, 6);
  });

  it("retrouve l'exemple de référence des tableurs (37,34 %)", () => {
    const r = xirr([
      { date: '2008-01-01', amount: -10000 }, { date: '2008-03-01', amount: 2750 }, { date: '2008-10-30', amount: 4250 },
      { date: '2009-02-15', amount: 3250 }, { date: '2009-04-01', amount: 2750 },
    ]);
    expect(r).toBeCloseTo(0.373362535, 5);
  });

  it('une perte donne un taux négatif ; des flux tous du même signe, aucun taux', () => {
    expect(xirr([{ date: '2025-01-01', amount: -1000 }, { date: '2026-01-01', amount: 900 }])).toBeCloseTo(-0.1, 6);
    expect(xirr([{ date: '2025-01-01', amount: -1000 }, { date: '2026-01-01', amount: -5 }])).toBeNull();
    expect(xirr([])).toBeNull();
  });
});

describe('accountPerformance', () => {
  // 3 000 € à l'ouverture, +300 € au relevé du 31/12, puis 5 versements de 200 €.
  const av = acc({
    type: AccountType.ASSURANCE_VIE, name: 'AV', totalAmount: 4300, ownedAmount: 4300, totalDeposits: 4000,
    movements: [
      mv('i', '2024-06-15', 3000, { tag: 'initial', label: 'Solde initial' }),
      mv('v', '2025-12-31', 300, { kind: 'valuation' }),
      ...['2026-02-28', '2026-04-30', '2026-06-29', '2026-08-28', '2026-09-29'].map((d, i) => mv(`p${i}`, d, 200)),
    ],
  });

  it('valeur, versements, gain et rendement annuel pondéré par les dates', () => {
    const p = accountPerformance(av, NOW)!;
    expect(p.value).toBe(4300);
    expect(p.since).toBe('2024-06-15');
    expect(p.contributions).toBe(4000);
    expect(p.gain).toBe(300);
    expect(p.measured).toBe(true);
    expect(p.years).toBeGreaterThan(2.3);
    // Le même calcul, refait à la main sur les flux.
    const ref = xirr([
      { date: '2024-06-15', amount: -3000 },
      ...['2026-02-28', '2026-04-30', '2026-06-29', '2026-08-28', '2026-09-29'].map(date => ({ date, amount: -200 })),
      { date: '2026-10-21', amount: 4300 },
    ])!;
    expect(p.annualized).toBeCloseTo(ref, 9);
    expect(p.annualized!).toBeGreaterThan(0.03);
    expect(p.annualized!).toBeLessThan(0.06);
    expect(p.periodReturn!).toBeCloseTo(Math.pow(1 + ref, p.years) - 1, 9);
  });

  it('sans versements cumulés connus, le gain vient des mouvements', () => {
    const p = accountPerformance({ ...av, totalDeposits: undefined }, NOW)!;
    expect(p.gain).toBe(300);
    expect(p.totalDeposits).toBeUndefined();
  });

  it("rien de mesuré tant qu'aucune valeur n'a été actualisée : jamais un 0 % inventé", () => {
    const p = accountPerformance(acc({ totalAmount: 1200, ownedAmount: 1200, movements: [mv('i', '2025-01-10', 1000, { tag: 'initial' }), mv('p', '2025-06-10', 200)] }), NOW)!;
    expect(p.measured).toBe(false);
    expect(p.annualized).toBeNull();
    expect(p.periodReturn).toBeNull();
    expect(p.gain).toBe(0);
  });

  it("moins d'un an : rendement sur la période, pas annualisé", () => {
    const p = accountPerformance(acc({ totalAmount: 1050, ownedAmount: 1050, movements: [mv('i', '2026-04-21', 1000, { tag: 'initial' }), mv('v', '2026-10-01', 50, { kind: 'valuation' })] }), NOW)!;
    expect(p.annualized).toBeNull();
    expect(p.periodReturn).toBeCloseTo(0.05, 6);
  });

  it('valeur de départ déduite du solde, mouvements à venir ignorés, part des parents comptée comme un versement', () => {
    const p = accountPerformance(acc({
      totalAmount: 2700, ownedAmount: 2200, parentalCapital: 500,
      movements: [
        mv('p', '2025-10-21', 500, { kind: 'parental' }),
        mv('v', '2026-10-20', 200, { kind: 'adjustment' }),
        mv('f', '2026-12-01', 100), // à venir : ignoré
      ],
    }), NOW)!;
    // Valeur au 21/10/2026 : 2 600 ; départ : 2 600 − 500 − 200 = 1 900 au 21/10/2025.
    expect(p.value).toBe(2600);
    expect(p.contributions).toBe(2400);
    expect(p.annualized).toBeCloseTo(200 / 2400, 6);
  });

  it('rien sans mouvement, ni quand les mouvements dépassent le solde', () => {
    expect(accountPerformance(acc({ totalAmount: 1000 }), NOW)).toBeNull();
    expect(accountPerformance(acc({ totalAmount: 100, movements: [mv('i', '2025-01-01', 1000)] }), NOW)).toBeNull();
  });
});

describe('hypothèse de rendement', () => {
  // Deux ans et dix mois de suivi : 1 000 € devenus 1 150 € (≈ +5 % par an).
  const measured = acc({
    totalAmount: 1150, ownedAmount: 1150,
    movements: [mv('i', '2024-01-01', 1000, { tag: 'initial' }), mv('v', '2026-01-01', 150, { kind: 'valuation' })],
  });

  it('livret : le taux saisi ; placement : le rendement supposé saisi', () => {
    expect(isMarketAccount({ type: AccountType.LIVRET_A })).toBe(false);
    expect(assumedAnnualRate(acc({ type: AccountType.LIVRET_A, interestRate: 1.7 }), NOW)).toEqual({ rate: 1.7, source: 'entered' });
    expect(assumedAnnualRate(acc({ type: AccountType.LDDS }), NOW)).toEqual({ rate: 0, source: 'entered' });
    expect(assumedAnnualRate({ ...measured, interestRate: 5 }, NOW)).toEqual({ rate: 5, source: 'entered' });
    // Un rendement saisi par l'utilisateur est son choix : jamais plafonné.
    expect(assumedAnnualRate({ ...measured, type: AccountType.CRYPTO, interestRate: 30 }, NOW)).toEqual({ rate: 30, source: 'entered' });
  });

  it('placement sans taux (vide ou ancien 0 %) : performance observée sur deux ans, sinon à renseigner', () => {
    const r = assumedAnnualRate({ ...measured, interestRate: 0 }, NOW);
    expect(r.source).toBe('observed');
    expect(r.since).toBe('2024-01-01');
    expect(r.rate).toBeGreaterThan(4.5);
    expect(r.rate).toBeLessThan(5.5);
    expect(r.observedRate).toBeUndefined();
    expect(assumedAnnualRate(acc({ totalAmount: 500, movements: [mv('i', '2026-09-01', 500, { tag: 'initial' })] }), NOW))
      .toEqual({ rate: 0, source: 'missing' });
  });

  it('mesure de moins de deux ans : pas une hypothèse (à renseigner)', () => {
    const short = acc({ totalAmount: 1100, movements: [mv('i', '2025-01-01', 1000, { tag: 'initial' }), mv('v', '2026-01-01', 100, { kind: 'valuation' })] });
    expect(accountPerformance(short, NOW)!.annualized).not.toBeNull();
    expect(assumedAnnualRate(short, NOW)).toEqual({ rate: 0, source: 'missing', reason: 'short' });
  });

  it("crypto : jamais la performance observée, si forte soit-elle (+379 %/an sur 13 mois ne se projette pas)", () => {
    const crypto = acc({
      type: AccountType.CRYPTO, totalAmount: 2940, ownedAmount: 2940,
      movements: [
        mv('i', '2025-09-01', 100, { tag: 'initial' }), mv('v1', '2025-10-01', 40, { kind: 'valuation' }),
        mv('d', '2026-09-15', 2000), mv('v2', '2026-10-15', 800, { kind: 'valuation' }),
      ],
    });
    expect(accountPerformance(crypto, new Date(2026, 9, 22))!.annualized).toBeGreaterThan(3);
    expect(assumedAnnualRate(crypto, new Date(2026, 9, 22))).toEqual({ rate: 0, source: 'missing', reason: 'volatile' });
    // Même mesurée sur trois ans.
    expect(assumedAnnualRate(crypto, new Date(2028, 9, 22)).source).toBe('missing');
  });

  it('performance extrême mesurée sur deux ans et plus : ramenée entre −5 % et +8 % par an', () => {
    const boom = acc({ totalAmount: 3000, movements: [mv('i', '2023-01-01', 1000, { tag: 'initial' }), mv('v', '2026-01-01', 2000, { kind: 'valuation' })] });
    const up = assumedAnnualRate(boom, NOW);
    expect(up).toMatchObject({ rate: OBSERVED_RATE_CAP, source: 'observed', since: '2023-01-01' });
    expect(up.observedRate).toBeGreaterThan(30);
    const crash = acc({ totalAmount: 400, movements: [mv('i', '2023-01-01', 1000, { tag: 'initial' }), mv('v', '2026-01-01', -600, { kind: 'valuation' })] });
    const down = assumedAnnualRate(crash, NOW);
    expect(down).toMatchObject({ rate: OBSERVED_RATE_FLOOR, source: 'observed' });
    expect(down.observedRate).toBeLessThan(-20);
    expect(OBSERVED_RATE_MIN_YEARS).toBe(2);
  });

  it('projection : taux observé pour les intérêts seulement, comptes inchangés', () => {
    const missing = acc({ id: 'c', name: 'Crypto', type: AccountType.CRYPTO, totalAmount: 500 });
    const livret = acc({ id: 'l', name: 'Livret A', type: AccountType.LIVRET_A, interestRate: 1.7 });
    const input = [{ ...measured, managementFee: 0.5 }, missing, livret];
    const { rates, assumptions } = withAssumedRates(input, NOW);
    expect(Object.keys(rates)).toEqual(['a']);
    expect(rates.a).toBeGreaterThan(4.5);
    expect(input[0].interestRate).toBeUndefined();
    expect(assumptions.map(a => [a.name, a.source])).toEqual([['PEA', 'observed'], ['Crypto', 'missing']]);
  });
});

describe('Livret A sur la même période', () => {
  // Convention : une entrée datée du jour J porte l'ANCIEN taux, valable jusqu'à J.
  const livretA = acc({ id: 'la', name: 'Livret A', type: AccountType.LIVRET_A, interestRate: 1.7, rateHistory: [
    { date: '2025-02-01', rate: 3 }, { date: '2025-08-01', rate: 2.4 },
  ] });

  it('moyenne des taux datés, pondérée par les jours', () => {
    // 2025-01-01 → 2026-01-01 : 31 j à 3 %, 181 j à 2,4 %, 153 j à 1,7 %.
    expect(averageRateBetween(livretA, '2025-01-01', '2026-01-01')).toBeCloseTo((31 * 3 + 181 * 2.4 + 153 * 1.7) / 365, 9);
    // Un seul taux sur la période, et période vide : le taux du jour de début.
    expect(averageRateBetween(livretA, '2025-09-01', '2026-03-01')).toBeCloseTo(1.7, 9);
    expect(averageRateBetween(livretA, '2025-03-01', '2025-03-01')).toBe(2.4);
    // Sans historique : le taux saisi.
    expect(averageRateBetween({ interestRate: 1.7 }, '2020-01-01', '2026-01-01')).toBe(1.7);
  });

  it('comparé à la performance mesurée depuis son premier mouvement', () => {
    const asOf = new Date(2026, 0, 1);
    const perf = { since: '2025-01-01', years: 1, periodReturn: 0.05 };
    const cmp = livretAOverPeriod(perf, [acc({}), livretA], asOf)!;
    expect(cmp.annualRate).toBeCloseTo(averageRateBetween(livretA, '2025-01-01', '2026-01-01'), 9);
    expect(cmp.periodReturn).toBeCloseTo(cmp.annualRate / 100, 9);
    // Moins d'un an : le gain du Livret A sur la période seulement.
    const half = livretAOverPeriod({ since: '2025-08-01', years: 153 / 365, periodReturn: 0.01 }, [livretA], asOf)!;
    expect(half.annualRate).toBeCloseTo(1.7, 9);
    expect(half.periodReturn).toBeCloseTo(0.017 * 153 / 365, 9);
  });

  it('rien sans Livret A, sans taux, ou sans mesure', () => {
    const perf = { since: '2025-01-01', years: 1, periodReturn: 0.05 };
    expect(livretAOverPeriod(perf, [acc({})])).toBeNull();
    expect(livretAOverPeriod(perf, [{ ...livretA, interestRate: 0, rateHistory: [] }])).toBeNull();
    expect(livretAOverPeriod({ ...perf, periodReturn: null }, [livretA])).toBeNull();
  });
});
