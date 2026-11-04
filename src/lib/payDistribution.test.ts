import { describe, it, expect, afterEach } from 'vitest';
import fc from 'fast-check';
import { AccountType, type AppDoc, type PayslipRecord, type SavingsAccount } from '../types';
import { emptyData } from './schema';
import {
  allocatePay, allocationSentence, balanceForAmount, balanceIncludesPay, currentAccountPrefill, leisureFloorOf, payAccountOf,
  payBalanceBefore, recommendPayDistribution, usualPayDistribution,
  type AllocatePayInput,
} from './payDistribution';
import { DISCREET_AMOUNT, setDiscreetAmounts } from './format';

afterEach(() => setDiscreetAmounts(false));

const cents = (n: number) => Math.round(n * 100);
const parts = (a: ReturnType<typeof allocatePay>) => [a.fixed, a.savings, a.projects, a.leisure];
const nb = (s: string | undefined) => s?.replace(/[\s  ]/g, ' ');

// ---------------------------------------------------------------------------
// La règle (allocatePay) : les exemples de la proposition et de sa vérification, avec le
// plancher des 2/3 (400 € → 267 €) décidé par le propriétaire.
// Paie habituelle 2 000 €, virements fixes 1 050 €, projets 100 €, solde de départ 400 € :
// épargne visée 450 €.
// ---------------------------------------------------------------------------

const usual = { expectedPay: 2000, fixed: 1050, projects: 100, startBalance: 400 };
const run = (patch: Partial<AllocatePayInput>) => allocatePay({ received: 2000, ...usual, ...patch });

describe('plancher du plaisir : 2/3 du solde de départ, arrondi à l\'euro', () => {
  it('400 € → 267 €, jamais plus que le solde de départ, jamais négatif', () => {
    expect(leisureFloorOf(400)).toBe(267);
    expect(leisureFloorOf(300)).toBe(200);
    expect(leisureFloorOf(0)).toBe(0);
    expect(leisureFloorOf(-50)).toBe(0);
    expect(leisureFloorOf(0.9)).toBe(0.9);
    expect(leisureFloorOf(Number.NaN)).toBe(0);
    expect(run({}).floor).toBe(267);
  });
});

describe('allocatePay : les exemples chiffrés', () => {
  it.each([
    // [cas, paie, prime, reste, fixes, épargne, projets, plaisir]
    ['1. mois normal, 30 € restants', 2000, 0, 30, 1050, 480, 100, 400],
    ['2. reste plus grand que le solde de départ', 2000, 0, 550, 1050, 1000, 100, 400],
    ['3. paie 150 € plus basse', 1850, 0, 30, 1050, 450, 100, 280],
    ['4. prime de 500 €', 2500, 500, 30, 1050, 980, 100, 400],
    ['5. mois très court et découvert', 1350, 0, -50, 1050, 0, 0, 250],
    ['6. reste > départ, paie basse de 700 €', 1300, 0, 550, 1050, 450, 83, 267],
    ['7. reste > départ, paie basse de 300 €', 1700, 0, 550, 1050, 700, 100, 400],
    ['8. prime dans un mois très court', 1500, 500, 0, 1050, 450, 0, 0],
    ['9. paie plus petite que les fixes, avec un reste', 900, 0, 200, 1050, 0, 0, 50],
    ['10. paie plus petite que les fixes, sans reste', 900, 0, 0, 1050, 0, 0, -150],
    ['12. déjà à découvert', 2000, 0, -300, 1050, 383, 0, 267],
    ['13. solde inconnu : le plan d\'aujourd\'hui', 2000, 0, 0, 1050, 450, 100, 400],
    ['D.2 prime et paie de base basse de 300 €', 2200, 500, 0, 1050, 883, 0, 267],
  ] as const)('%s', (_name, received, bonus, before, fixed, savings, projects, leisure) => {
    const a = run({ received, bonus, before });
    expect(parts(a)).toEqual([fixed, savings, projects, leisure]);
    expect(cents(a.fixed + a.savings + a.projects + a.leisure)).toBe(cents(received + before));
  });

  it('11. sans solde de départ : plancher 0, les projets sont coupés d\'abord', () => {
    const a = allocatePay({ received: 1900, expectedPay: 2000, fixed: 1050, projects: 100, startBalance: 0 });
    expect(a).toMatchObject({ target: 850, floor: 0, savings: 850, projects: 0, leisure: 0 });
    // Le plaisir valait déjà 0 : pas de « coupe du plaisir ».
    expect(a.cuts).toEqual({ leisure: 0, projects: 100, savings: 0, bonus: 0 });
  });

  it('14. versement en plus : rien à virer, tout placé, le reste du compte n\'est pas recompté', () => {
    const a = allocatePay({ received: 300, before: 999, bonus: 100, kind: 'extra', ...usual });
    expect(a).toMatchObject({ kind: 'extra', fixed: 0, projects: 0, savings: 300, leisure: 0, before: 0, bonus: 0, available: 300 });
    // Montant choisi : jamais plus que reçu, le reste reste sur le compte courant.
    expect(allocatePay({ received: 300, fixedSavings: 120, kind: 'extra', ...usual })).toMatchObject({ savings: 120, leisure: 180, fixedSavings: 120 });
    expect(allocatePay({ received: 300, fixedSavings: 900, kind: 'extra', ...usual }).savings).toBe(300);
    expect(allocatePay({ received: 300, fixedSavings: -5, kind: 'extra', ...usual }).savings).toBe(0);
  });

  it('les coupes se comptent sur le résultat (correction 1)', () => {
    // Cas 5 : le plaisir baisse de 150 € (400 → 250), les projets de 100 €, l'épargne de 450 €.
    expect(run({ received: 1350, before: -50 }).cuts).toEqual({ leisure: 150, projects: 100, savings: 450, bonus: 0 });
    expect(run({ received: 1350, before: -50 }).belowFloor).toBe(17);
    // Cas 3 : seul le plaisir baisse.
    expect(run({ received: 1850, before: 30 }).cuts).toEqual({ leisure: 120, projects: 0, savings: 0, bonus: 0 });
    // Fixes non couverts : plaisir, projets, épargne et prime coupés en entier.
    expect(run({ received: 900, bonus: 50 })).toMatchObject({
      missingFixed: 150, belowFloor: 0, cuts: { leisure: 400, projects: 100, savings: 450, bonus: 50 },
    });
  });

  it('le surplus se compte sur le résultat, pas sur le reste seul (correction 2)', () => {
    expect(run({ received: 1300, before: 550 }).surplus).toBe(0);
    expect(run({ received: 1700, before: 550 }).surplus).toBe(250);
    expect(run({ received: 2000, before: 550 }).surplus).toBe(550);
    expect(run({ received: 2100 }).surplus).toBe(100);
  });

  it('la prime est placée en entier, même dans un mois court ; entamée seulement si la paie de base ne couvre pas les fixes', () => {
    // D.2 : le plaisir descend à son minimum, l'épargne hors prime baisse, la prime reste entière.
    expect(run({ received: 2200, bonus: 500 })).toMatchObject({ bonusPlaced: 500, cuts: { leisure: 133, projects: 100, savings: 67, bonus: 0 } });
    // Cas 8 : paie de base 1 000 € < fixes 1 050 € : la prime paie les 50 € qui manquent.
    expect(run({ received: 1500, bonus: 500 })).toMatchObject({ bonusPlaced: 450, leisure: 0, belowFloor: 267, cuts: { bonus: 50 } });
  });

  it('montant fixe : tenu sur une paie normale, plus haut que le calcul il fait baisser le plaisir', () => {
    // 500 € au lieu de 450 € : il reste 350 € de plaisir (correction 12).
    expect(run({ fixedSavings: 500 })).toMatchObject({ savings: 500, leisure: 350, plannedLeisure: 400, computedTarget: 450, fixedSavings: 500 });
    // Si haut que le plaisir passerait sous son minimum : les projets sont coupés, puis l'épargne.
    expect(run({ fixedSavings: 700 })).toMatchObject({ savings: 683, projects: 0, leisure: 267 });
    expect(run({ fixedSavings: 600 })).toMatchObject({ savings: 600, projects: 83, leisure: 267 });
    // Plus bas que le calcul : le plaisir prévu monte d'autant, l'épargne reste le montant fixe.
    expect(run({ fixedSavings: 300 })).toMatchObject({ savings: 300, leisure: 550, plannedLeisure: 550 });
    // Paie plus haute, ou reste du mois dernier : le surplus va à l'épargne.
    expect(run({ fixedSavings: 300, received: 2100, before: 20 })).toMatchObject({ savings: 420, leisure: 550 });
  });

  it('entrées illisibles : comptées 0 ; prime ramenée à la paie', () => {
    expect(allocatePay({ received: Number.NaN, expectedPay: Number.NaN, fixed: Number.NaN, projects: Number.NaN, startBalance: Number.NaN }))
      .toMatchObject({ available: 0, savings: 0, leisure: 0, missingFixed: 0 });
    expect(run({ received: 300, bonus: 900 }).bonus).toBe(300);
    expect(run({ received: -100 }).received).toBe(0);
  });

  it('épargne visée négative (dépenses plus grandes que la paie habituelle) : ramenée à 0, le plaisir baisse', () => {
    const a = allocatePay({ received: 1500, expectedPay: 1500, fixed: 1050, projects: 100, startBalance: 400 });
    expect(a).toMatchObject({ computedTarget: -50, target: 0, savings: 0, projects: 100, leisure: 350 });
  });
});

// ---------------------------------------------------------------------------
// Propriétés : argent conservé, ordre des coupes, plancher, prime, centimes.
// ---------------------------------------------------------------------------

const euros = (max: number) => fc.integer({ min: 0, max: max * 100 }).map(c => c / 100);
const signedEuros = (max: number) => fc.integer({ min: -max * 100, max: max * 100 }).map(c => c / 100);
const inputArb = fc.record({
  received: euros(8000), bonusShare: fc.double({ min: 0, max: 1, noNaN: true }), before: signedEuros(3000),
  expectedPay: euros(6000), fixed: euros(4000), projects: euros(800), startBalance: euros(1500),
  fixedSavings: fc.option(euros(3000), { nil: undefined }),
}).map(({ bonusShare, ...r }) => ({ ...r, bonus: Math.round(r.received * bonusShare * 100) / 100 }));

describe('allocatePay : propriétés', () => {
  it('fixes + épargne + projets + plaisir = paie + reste, au centime près, et chaque part au centime', () => {
    fc.assert(fc.property(inputArb, i => {
      const a = allocatePay(i);
      expect(cents(a.fixed) + cents(a.savings) + cents(a.projects) + cents(a.leisure)).toBe(cents(i.received) + cents(i.before));
      for (const v of [a.fixed, a.savings, a.projects, a.leisure, a.bonusPlaced, a.surplus]) expect(Math.abs(v * 100 - Math.round(v * 100))).toBeLessThan(1e-6);
    }));
  });

  it('les virements fixes ne sont jamais réduits ; rien de négatif sauf le plaisir quand ils ne sont pas couverts', () => {
    fc.assert(fc.property(inputArb, i => {
      const a = allocatePay(i);
      expect(a.fixed).toBe(i.fixed);
      expect(a.savings).toBeGreaterThanOrEqual(0);
      expect(a.projects).toBeGreaterThanOrEqual(0);
      expect(a.projects).toBeLessThanOrEqual(i.projects);
      if (a.missingFixed > 0) expect(a).toMatchObject({ savings: 0, projects: 0, leisure: -a.missingFixed });
      else expect(a.leisure).toBeGreaterThanOrEqual(0);
    }));
  });

  it('ordre des coupes : plaisir jusqu\'au plancher, puis projets, puis épargne, la prime en dernier', () => {
    fc.assert(fc.property(inputArb, i => {
      const a = allocatePay(i);
      if (a.missingFixed > 0) return;
      // Projets coupés : le plaisir est à son plancher (ou en dessous si tout est coupé).
      if (a.cuts.projects > 0) expect(a.leisure).toBeLessThanOrEqual(a.floor);
      // Épargne coupée : plus de projets.
      if (a.cuts.savings > 0) expect(a.projects).toBe(0);
      // Prime entamée : plus d'épargne hors prime, plus de plaisir.
      if (a.cuts.bonus > 0) expect(a).toMatchObject({ projects: 0, leisure: 0, savings: a.bonusPlaced });
      // Sous le plancher : tout ce qui pouvait l'être a été coupé.
      if (a.belowFloor > 0) expect(a.projects).toBe(0);
      // Le plaisir ne dépasse jamais le prévu ; le surplus n'existe que plaisir plein.
      expect(a.leisure).toBeLessThanOrEqual(a.plannedLeisure);
      if (a.surplus > 0) expect(a.leisure).toBe(a.plannedLeisure);
    }));
  });

  it('sans reste ni écart, le plan habituel : épargne visée et solde de départ', () => {
    fc.assert(fc.property(inputArb, i => {
      const a = allocatePay({ ...i, received: i.expectedPay, bonus: 0, before: 0, fixedSavings: undefined });
      if (a.computedTarget >= 0) expect(a).toMatchObject({ savings: a.computedTarget, leisure: a.startBalance, projects: i.projects, surplus: 0 });
    }));
  });
});

// ---------------------------------------------------------------------------
// La répartition d'une paie (données complètes)
// ---------------------------------------------------------------------------

// Paie habituelle 2 500 € (fiche de référence), 800 € de virements fixes, solde de départ
// 250 € (plancher 167 €) : 1 450 € à placer. Livret A à 500 € du plafond, puis assurance vie.
const payslip = { id: 'f', fileId: 'x', fileName: 'f.pdf', addedAt: '2026-10-27', reviewed: true, extracted: { period: '2026-10', netPaid: 2500 } } as PayslipRecord;
const data = (config: Partial<AppDoc['config']> = {}, accounts?: SavingsAccount[]): AppDoc => {
  const d = emptyData();
  return {
    ...d,
    payslips: [payslip], activePayslipId: 'f',
    expenses: [{ id: 'loyer', name: 'Revolut commun', amount: 800 }],
    accounts: accounts ?? [
      { id: 'la', name: 'Livret A', institution: 'B', type: AccountType.LIVRET_A, totalAmount: d.fiscalConfig.ceilings.livretA - 500, ownedAmount: d.fiscalConfig.ceilings.livretA - 500, parentalCapital: 0, interestRate: 2.4, movements: [] },
      { id: 'av', name: 'Assurance vie', institution: 'A', type: AccountType.ASSURANCE_VIE, totalAmount: 4000, ownedAmount: 4000, parentalCapital: 0, totalDeposits: 4000, movements: [] },
    ],
    config: { ...d.config, leisureBudget: 250, projectSavings: 0, ...config },
  };
};
const saved = (lines: { kind: string; amount: number }[]) => Math.round(lines.filter(l => l.kind === 'saving').reduce((s, l) => s + l.amount, 0) * 100) / 100;

describe('répartition conseillée pour la paie reçue', () => {
  it('paie conforme : virements fixes, épargne par compte (meilleur taux d\'abord), projets, plaisir', () => {
    const d = recommendPayDistribution(data({ projectSavings: 50 }), { amount: 2500, receivedOn: '2026-10-27' });
    expect(d).toMatchObject({ expectedPay: 2500, plannedSpending: 1100, gap: 0, capacity: 1400, bonus: 0, toSave: 1400, shortfall: 0, customSplit: false });
    expect(d.lines.map(l => [l.key, l.amount])).toEqual([['t:e:loyer', 800], ['s:la', 500], ['s:av', 900], ['t:projects', 50], ['t:leisure', 250]]);
    expect(allocationSentence(d.allocation)).toBeUndefined();
  });

  it('paie plus basse : le plaisir baisse d\'abord, jusqu\'à son minimum, puis l\'épargne', () => {
    const d = recommendPayDistribution(data(), { amount: 2300 });
    expect(d).toMatchObject({ gap: -200, capacity: 1333, toSave: 1333, shortfall: 0 });
    expect(d.lines.find(l => l.key === 't:leisure')?.amount).toBe(167);
    expect(saved(d.lines)).toBe(1333);
    expect(nb(allocationSentence(d.allocation))).toBe('Paie inférieure de 200 € à l\'habitude : le plaisir descend à son minimum (167 €) et l\'épargne baisse de 117 €. Les virements fixes sont tenus.');
    // 50 € de moins seulement : le plaisir absorbe tout.
    const small = recommendPayDistribution(data(), { amount: 2450 });
    expect(small).toMatchObject({ toSave: 1450 });
    expect(nb(allocationSentence(small.allocation))).toBe('Paie inférieure de 50 € à l\'habitude : le plaisir passe à 200 € au lieu de 250 € (minimum 167 €). Épargne tenue.');
  });

  it('reste du compte courant : il rejoint l\'épargne ; la ligne plaisir porte ce qui reste vraiment', () => {
    const d = recommendPayDistribution(data(), { amount: 2500, before: 30 });
    expect(d).toMatchObject({ toSave: 1480 });
    expect(d.lines.find(l => l.key === 't:leisure')?.amount).toBe(250);
    expect(nb(allocationSentence(d.allocation))).toBe('Le compte courant démarre à 250 € : 30 € de plus vont à l\'épargne (il restait 30 € du mois dernier).');
  });

  it('paie trop basse pour les virements fixes : rien à placer, ce qu\'il manque', () => {
    const d = recommendPayDistribution(data(), { amount: 700 });
    expect(d).toMatchObject({ capacity: 0, toSave: 0, shortfall: 100 });
    expect(d.lines.map(l => l.key)).toEqual(['t:e:loyer']);
    expect(nb(allocationSentence(d.allocation))).toMatch(/^La paie ne couvre pas les virements fixes \(il manque 100 €\)/);
    // Couvre les fixes mais pas le minimum : tout est coupé, le plaisir reste sous son minimum.
    const low = recommendPayDistribution(data(), { amount: 900 });
    expect(low).toMatchObject({ toSave: 0, shortfall: 0 });
    expect(nb(allocationSentence(low.allocation))).toBe('Paie inférieure de 1 600 € à l\'habitude : le plaisir descend à 100 €, sous son minimum de 167 € et l\'épargne baisse de 1 450 €. Les virements fixes sont tenus.');
  });

  it('paie plus haute : la différence va à l\'épargne', () => {
    const d = recommendPayDistribution(data(), { amount: 2700 });
    expect(d).toMatchObject({ gap: 200, toSave: 1650 });
    expect(nb(allocationSentence(d.allocation))).toBe('Le compte courant démarre à 250 € : 200 € de plus vont à l\'épargne (paie supérieure de 200 € à l\'habitude).');
  });

  it('prime comprise dans la paie : placée en entier, l\'écart se calcule hors prime', () => {
    const d = recommendPayDistribution(data(), { amount: 3000, bonus: 500 });
    expect(d).toMatchObject({ gap: 0, capacity: 1450, bonus: 500, toSave: 1950 });
    expect(saved(d.lines)).toBe(1950);
    expect(recommendPayDistribution(data(), { amount: 300, bonus: 900 })).toMatchObject({ bonus: 300 });
  });

  it('ancien « À placer sur cette paie » (toSave) : épargne visée hors prime, tenue', () => {
    const d = recommendPayDistribution(data(), { amount: 2300, bonus: 100, toSave: 600 });
    expect(d).toMatchObject({ capacity: 600, toSave: 700 });
    // Plus que ce que la paie permet : le plaisir descend à son minimum, l'épargne s'ajuste.
    expect(recommendPayDistribution(data(), { amount: 2500, toSave: 1600 })).toMatchObject({ toSave: 1533, shortfall: 0 });
  });

  it('montant fixe : tenu sur la paie habituelle ; une paie plus basse fait baisser le plaisir', () => {
    expect(recommendPayDistribution(data({ paydayAmount: 1000 }), { amount: 2500 })).toMatchObject({ capacity: 1000 });
    expect(recommendPayDistribution(data({ paydayAmount: 1000 }), { amount: 2400 })).toMatchObject({ capacity: 1000 });
    expect(recommendPayDistribution(data({ paydayAmount: 1600 }), { amount: 2500 })).toMatchObject({ capacity: 1533, shortfall: 0 });
  });

  it('versement en plus : rien à virer, 100 % épargne', () => {
    const d = recommendPayDistribution(data({ paydayAmount: 50 }), { amount: 300, bonus: 100, kind: 'extra', before: 400 });
    expect(d).toMatchObject({ transfers: [], plannedSpending: 0, gap: 0, capacity: 300, bonus: 0, toSave: 300, shortfall: 0 });
    expect(d.lines.map(l => [l.key, l.amount])).toEqual([['s:la', 300]]);
    expect(allocationSentence(d.allocation)).toBeUndefined();
    expect(recommendPayDistribution(data(), { amount: 300, kind: 'extra', toSave: 120 }).toSave).toBe(120);
  });

  it('répartition personnalisée respectée à la date de la paie', () => {
    const split = [{ accountId: 'la', pct: 20 }, { accountId: 'av', pct: 80 }];
    const d = recommendPayDistribution(data({ savingsSplit: split, savingsSplitFrom: '2026-10-01' }), { amount: 2500, receivedOn: '2026-10-27' });
    expect(d.customSplit).toBe(true);
    expect(d.lines.filter(l => l.kind === 'saving').map(l => [l.key, l.amount])).toEqual([['s:la', 290], ['s:av', 1160]]);
    expect(recommendPayDistribution(data({ savingsSplit: split, savingsSplitFrom: '2026-11-01' }), { amount: 2500, receivedOn: '2026-10-27' }).customSplit).toBe(false);
  });

  it('répartition par compte au centime : la somme des comptes vaut l\'épargne (100 € en trois tiers)', () => {
    const acc = (id: string): SavingsAccount => ({ id, name: id, institution: 'B', type: AccountType.ASSURANCE_VIE, totalAmount: 0, ownedAmount: 0, parentalCapital: 0, movements: [] });
    const split = [{ accountId: 'a', pct: 1 }, { accountId: 'b', pct: 1 }, { accountId: 'c', pct: 1 }];
    // 2 500 − 800 − 250 − 1 350 de projets = 100 € à placer.
    const d = recommendPayDistribution(data({ projectSavings: 1350, savingsSplit: split }, [acc('a'), acc('b'), acc('c')]), { amount: 2500 });
    const amounts = d.lines.filter(l => l.kind === 'saving').map(l => l.amount);
    expect(d.toSave).toBe(100);
    expect(amounts.reduce((s, v) => s + cents(v), 0)).toBe(10000);
    expect(amounts.sort()).toEqual([33.33, 33.33, 33.34]);
  });

  it('propriété : la somme des lignes (sans les projets coupés) vaut paie + reste, au centime', () => {
    fc.assert(fc.property(euros(6000), signedEuros(1500), euros(500), fc.integer({ min: 1, max: 99 }), (amount, before, bonusMax, pct) => {
      const bonus = Math.min(amount, bonusMax);
      const accounts: SavingsAccount[] = [
        { id: 'la', name: 'Livret A', institution: 'B', type: AccountType.LIVRET_A, totalAmount: 22_950 - 333.333, ownedAmount: 0, parentalCapital: 0, interestRate: 2.4, movements: [] },
        { id: 'av', name: 'Assurance vie', institution: 'A', type: AccountType.ASSURANCE_VIE, totalAmount: 0, ownedAmount: 0, parentalCapital: 0, movements: [] },
      ];
      const split = pct % 2 ? [{ accountId: 'la', pct }, { accountId: 'av', pct: 100 - pct }] : undefined;
      const d = recommendPayDistribution(data({ projectSavings: 75.5, savingsSplit: split }, accounts), { amount, bonus, before });
      const a = d.allocation;
      const leisureLine = d.lines.find(l => l.key === 't:leisure')?.amount ?? 0;
      const total = d.lines.reduce((s, l) => s + cents(l.amount), 0);
      // Le plaisir négatif (fixes non couverts) n'a pas de ligne.
      expect(total).toBe(cents(amount) + cents(before) - (a.leisure < 0 ? cents(a.leisure) : 0));
      expect(leisureLine).toBe(Math.max(0, a.leisure));
      expect(saved(d.lines)).toBe(d.toSave);
    }), { numRuns: 200 });
  });

  it('montant illisible : compté 0 ; mode discret : la phrase ne montre pas les montants', () => {
    expect(recommendPayDistribution(data(), { amount: Number.NaN })).toMatchObject({ toSave: 0, shortfall: 800 });
    setDiscreetAmounts(true);
    expect(allocationSentence(recommendPayDistribution(data(), { amount: 2300 }).allocation)).toContain(DISCREET_AMOUNT);
  });

  it('plan habituel : la paie habituelle, sans reste', () => {
    const d = usualPayDistribution(data(), new Date(2026, 9, 27));
    expect(d).toMatchObject({ toSave: 1450, gap: 0 });
    expect(d.allocation.before).toBe(0);
  });
});

describe('phrases : chaque cause, chaque coupe', () => {
  const s = (patch: Partial<AllocatePayInput>) => nb(allocationSentence(run(patch)));
  it.each([
    [{ received: 1850, before: 30 }, 'Paie inférieure de 150 € à l\'habitude, en partie compensée par les 30 € restants : le plaisir passe à 280 € au lieu de 400 € (minimum 267 €). Épargne et projets tenus.'],
    [{ received: 1300, before: 550 }, 'Paie inférieure de 700 € à l\'habitude, en partie compensée par les 550 € restants : le plaisir descend à son minimum (267 €) et l\'épargne projets baisse de 17 €. Les virements fixes sont tenus.'],
    [{ received: 1350, before: -50 }, 'Paie inférieure de 650 € à l\'habitude et compte à découvert de 50 € avant la paie : le plaisir descend à 250 €, sous son minimum de 267 €, l\'épargne projets est suspendue ce mois-ci et l\'épargne baisse de 450 €. Les virements fixes sont tenus.'],
    [{ received: 2000, before: -300 }, 'Compte à découvert de 300 € avant la paie : le plaisir descend à son minimum (267 €), l\'épargne projets est suspendue ce mois-ci et l\'épargne baisse de 67 €. Les virements fixes sont tenus.'],
    [{ received: 1500, bonus: 500 }, 'Paie inférieure de 1 000 € à l\'habitude : le plaisir descend à 0 €, sous son minimum de 267 €, l\'épargne projets est suspendue ce mois-ci, l\'épargne baisse de 450 € et la prime n\'est placée qu\'en partie (450 € sur 500 €). Les virements fixes sont tenus.'],
    [{ fixedSavings: 500 }, 'Votre montant fixe d\'épargne dépasse le calcul : le plaisir passe à 350 € au lieu de 400 € (minimum 267 €). Épargne et projets tenus.'],
    [{ received: 2000, before: 550 }, 'Le compte courant démarre à 400 € : 550 € de plus vont à l\'épargne (il restait 550 € du mois dernier).'],
    [{ received: 1700, before: 550 }, 'Le compte courant démarre à 400 € : 250 € de plus vont à l\'épargne (il restait 550 € du mois dernier, paie inférieure de 300 €).'],
    [{ received: 2600, before: -100 }, 'Le compte courant démarre à 400 € : 500 € de plus vont à l\'épargne (paie supérieure de 600 € à l\'habitude, découvert de 100 € avant la paie).'],
    [{ received: 1970, before: 30 }, 'Le compte courant démarre à 400 € : épargne et projets tenus.'],
    [{}, undefined],
  ] as const)('%o', (patch, expected) => {
    expect(s(patch)).toBe(expected);
  });

  it('sans projets : « Épargne tenue » ; dépenses plus grandes que la paie habituelle', () => {
    expect(nb(allocationSentence(allocatePay({ received: 1900, expectedPay: 2000, fixed: 1050, projects: 0, startBalance: 400 }))))
      .toBe('Paie inférieure de 100 € à l\'habitude : le plaisir passe à 300 € au lieu de 400 € (minimum 267 €). Épargne tenue.');
    expect(nb(allocationSentence(allocatePay({ received: 1500, expectedPay: 1500, fixed: 1050, projects: 100, startBalance: 400 }))))
      .toBe('Vos dépenses prévues dépassent la paie : le plaisir passe à 350 € au lieu de 400 € (minimum 267 €). Épargne et projets tenus.');
    // Montant fixe plus bas que le calcul, paie habituelle : rien à dire.
    expect(nb(allocationSentence(run({ fixedSavings: 300 })))).toBeUndefined();
    expect(nb(allocationSentence(run({ fixedSavings: 300, received: 2100 })))).toBe('Le compte courant démarre à 550 € : 100 € de plus vont à l\'épargne (paie supérieure de 100 € à l\'habitude).');
  });
});

describe('payBalanceBefore', () => {
  it('reste du compte courant d\'une paie déclarée ; 0 si inconnu, ancien ou versement en plus', () => {
    expect(payBalanceBefore(undefined)).toBe(0);
    expect(payBalanceBefore({})).toBe(0);
    expect(payBalanceBefore({ balance: { before: 30, seen: 2030, source: 'typed' } })).toBe(30);
    expect(payBalanceBefore({ balance: { before: -50, source: 'estimated' } })).toBe(-50);
    expect(payBalanceBefore({ balance: { before: 30, source: 'unknown' } })).toBe(0);
    expect(payBalanceBefore({ kind: 'extra', balance: { before: 30, source: 'typed' } })).toBe(0);
    expect(payBalanceBefore({ balance: { before: Number.NaN, source: 'typed' } })).toBe(0);
  });
});

describe('compte courant du rituel', () => {
  const cc = (id: string, over: Partial<SavingsAccount> = {}): SavingsAccount => ({
    id, name: `Compte ${id}`, institution: 'B', type: AccountType.COMPTE_COURANT, totalAmount: 430, ownedAmount: 430, parentalCapital: 0, movements: [], ...over,
  });
  const livret: SavingsAccount = { id: 'la', name: 'Livret A', institution: 'B', type: AccountType.LIVRET_A, totalAmount: 1000, ownedAmount: 1000, parentalCapital: 0, movements: [] };
  const data = (accounts: SavingsAccount[], payAccountId?: string) => ({ accounts, config: { ...emptyData().config, ...(payAccountId ? { payAccountId } : {}) } });

  it('compte où arrive la paie : celui choisi, sinon le premier compte courant, sinon aucun', () => {
    expect(payAccountOf(data([livret, cc('a'), cc('b')]))?.id).toBe('a');
    expect(payAccountOf(data([livret, cc('a'), cc('b')], 'b'))?.id).toBe('b');
    expect(payAccountOf(data([livret, cc('a')], 'disparu'))?.id).toBe('a');
    expect(payAccountOf(data([livret]))).toBeUndefined();
  });

  it('préremplissage : constaté après la paie tel quel, récent estimé (+ paie), plus de 15 jours ou jamais : rien', () => {
    const input = { receivedOn: '2026-10-27', amount: 2000, today: '2026-10-30' };
    // Constaté le 29, après la paie du 27 : il la comprend déjà.
    expect(currentAccountPrefill(data([cc('a', { balanceCheckedAt: '2026-10-29' })]), input))
      .toMatchObject({ seen: 430, source: 'known', checkedOn: '2026-10-29', days: 1, known: 430 });
    // Constaté le jour même de la paie : il peut dater d'avant son arrivée, donc estimation.
    expect(currentAccountPrefill(data([cc('a', { balanceCheckedAt: '2026-10-27' })]), input)).toMatchObject({ seen: 2430, source: 'estimated', days: 3 });
    // Il y a 15 jours : encore proposé ; 16 jours : trop ancien.
    expect(currentAccountPrefill(data([cc('a', { balanceCheckedAt: '2026-10-15' })]), input)).toMatchObject({ seen: 2430, source: 'estimated', days: 15 });
    const old = currentAccountPrefill(data([cc('a', { balanceCheckedAt: '2026-10-14' })]), input);
    expect(old).toMatchObject({ checkedOn: '2026-10-14', days: 16 });
    expect(old.seen).toBeUndefined();
    const never = currentAccountPrefill(data([cc('a')]), input);
    expect(never.account?.id).toBe('a');
    expect(never.seen).toBeUndefined();
    expect(currentAccountPrefill(data([livret]), input)).toEqual({});
    // Découvert connu : l'estimation le garde (−50 € + 1 350 €).
    expect(currentAccountPrefill(data([cc('a', { totalAmount: -50, ownedAmount: -50, balanceCheckedAt: '2026-10-25' })]), { ...input, amount: 1350 }).seen).toBe(1300);
  });

  it('la paie est-elle dans le solde lu ; le montant change : ce qui restait suit seulement dans ce cas', () => {
    expect(balanceIncludesPay({ seen: 2030, before: 30 })).toBe(true);
    expect(balanceIncludesPay({ seen: 30, before: 30 })).toBe(false);
    expect(balanceIncludesPay({ before: 30 })).toBe(true);
    expect(balanceForAmount({ seen: 2030, before: 30, source: 'typed' }, 2000, 1990.5)).toEqual({ seen: 2030, before: 39.5, source: 'typed' });
    const without = { seen: 30, before: 30, source: 'typed' as const };
    expect(balanceForAmount(without, 2000, 1990)).toBe(without);
    const unknown = { before: 0, source: 'unknown' as const };
    expect(balanceForAmount(unknown, 2000, 1990)).toBe(unknown);
    expect(balanceForAmount(undefined, 2000, 1990)).toBeUndefined();
  });
});
