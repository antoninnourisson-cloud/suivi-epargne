import { describe, it, expect, afterEach } from 'vitest';
import { AccountType, type AppDoc, type PayslipRecord } from '../types';
import { emptyData } from './schema';
import { payGapSentence, recommendPayDistribution } from './payDistribution';
import { DISCREET_AMOUNT, setDiscreetAmounts } from './format';

afterEach(() => setDiscreetAmounts(false));

// Paie estimée 2 500 € (fiche de référence), 800 € de charges, 250 € d'argent plaisir :
// 1 450 € à placer. Livret A à 500 € du plafond, puis assurance vie.
const payslip = { id: 'f', fileId: 'x', fileName: 'f.pdf', addedAt: '2026-10-27', reviewed: true, extracted: { period: '2026-10', netPaid: 2500 } } as PayslipRecord;
const data = (config: Partial<AppDoc['config']> = {}): AppDoc => {
  const d = emptyData();
  return {
    ...d,
    payslips: [payslip], activePayslipId: 'f',
    expenses: [{ id: 'loyer', name: 'Revolut commun', amount: 800 }],
    accounts: [
      { id: 'la', name: 'Livret A', institution: 'B', type: AccountType.LIVRET_A, totalAmount: d.fiscalConfig.ceilings.livretA - 500, ownedAmount: d.fiscalConfig.ceilings.livretA - 500, parentalCapital: 0, interestRate: 2.4, movements: [] },
      { id: 'av', name: 'Assurance vie', institution: 'A', type: AccountType.ASSURANCE_VIE, totalAmount: 4000, ownedAmount: 4000, parentalCapital: 0, totalDeposits: 4000, movements: [] },
    ],
    config: { ...d.config, leisureBudget: 250, projectSavings: 0, ...config },
  };
};
const saved = (lines: { kind: string; amount: number }[]) => Math.round(lines.filter(l => l.kind === 'saving').reduce((s, l) => s + l.amount, 0) * 100) / 100;

describe('répartition conseillée pour la paie reçue', () => {
  it('paie conforme : virements de la paie puis épargne par compte, au meilleur taux d\'abord', () => {
    const d = recommendPayDistribution(data(), { amount: 2500, receivedOn: '2026-10-27' });
    expect(d).toMatchObject({ expectedPay: 2500, plannedSpending: 1050, gap: 0, capacity: 1450, bonus: 0, toSave: 1450, shortfall: 0, customSplit: false });
    expect(d.lines.map(l => [l.key, l.amount])).toEqual([['t:e:loyer', 800], ['t:leisure', 250], ['s:la', 500], ['s:av', 950]]);
    expect(payGapSentence(d, {})).toBeUndefined();
  });

  it('paie plus basse : les dépenses ne bougent pas, l\'épargne baisse d\'autant (et Pécule le dit)', () => {
    const d = recommendPayDistribution(data(), { amount: 2300 });
    expect(d).toMatchObject({ gap: -200, capacity: 1250, toSave: 1250, shortfall: 0 });
    expect(saved(d.lines)).toBe(1250);
    expect(payGapSentence(d, {})).toMatch(/^Paie inférieure de 200\s€ à l'estimation : vos dépenses prévues ne changent pas, l'épargne conseillée baisse d'autant\.$/);
  });

  it('paie trop basse : rien à placer, et ce qu\'il manque pour les virements', () => {
    const d = recommendPayDistribution(data(), { amount: 900 });
    expect(d).toMatchObject({ capacity: 0, toSave: 0, shortfall: 150 });
    expect(saved(d.lines)).toBe(0);
    expect(payGapSentence(d, {})).toMatch(/il ne reste rien à placer sur cette paie\.$/);
  });

  it('paie plus haute : la différence va à l\'épargne', () => {
    const d = recommendPayDistribution(data(), { amount: 2700 });
    expect(d).toMatchObject({ gap: 200, toSave: 1650 });
    expect(payGapSentence(d, {})).toMatch(/^Paie supérieure de 200\s€/);
  });

  it('prime comprise dans la paie : placée en entier, l\'écart se calcule hors prime', () => {
    const d = recommendPayDistribution(data(), { amount: 3000, bonus: 500 });
    expect(d).toMatchObject({ gap: 0, capacity: 1450, bonus: 500, toSave: 1950 });
    expect(saved(d.lines)).toBe(1950);
    // Une prime plus grande que la paie est ramenée à la paie.
    expect(recommendPayDistribution(data(), { amount: 300, bonus: 900 })).toMatchObject({ bonus: 300 });
  });

  it('« À placer sur cette paie » saisi : remplace le calcul, prime en plus, sans phrase d\'écart', () => {
    const d = recommendPayDistribution(data(), { amount: 2300, bonus: 100, toSave: 600 });
    expect(d).toMatchObject({ capacity: 600, toSave: 700 });
    expect(payGapSentence(d, { toSave: 600 })).toBeUndefined();
    // Plus que ce que la paie permet : il manque la différence.
    expect(recommendPayDistribution(data(), { amount: 2500, toSave: 1600 }).shortfall).toBe(150);
  });

  it('montant fixe du rappel de paie : l\'écart à la paie estimée s\'y ajoute ; trop haut, il manque', () => {
    expect(recommendPayDistribution(data({ paydayAmount: 1000 }), { amount: 2400 })).toMatchObject({ capacity: 900, shortfall: 0 });
    expect(recommendPayDistribution(data({ paydayAmount: 1600 }), { amount: 2500 })).toMatchObject({ capacity: 1600, shortfall: 150 });
  });

  it('versement en plus : rien à virer, 100 % épargne', () => {
    const d = recommendPayDistribution(data(), { amount: 300, bonus: 100, kind: 'extra' });
    expect(d).toMatchObject({ transfers: [], plannedSpending: 0, gap: 0, capacity: 300, bonus: 0, toSave: 300, shortfall: 0 });
    expect(d.lines.map(l => [l.key, l.amount])).toEqual([['s:la', 300]]);
    expect(payGapSentence(d, { kind: 'extra' })).toBeUndefined();
    expect(recommendPayDistribution(data(), { amount: 300, kind: 'extra', toSave: 120 }).toSave).toBe(120);
  });

  it('répartition personnalisée respectée à la date de la paie', () => {
    const split = [{ accountId: 'la', pct: 20 }, { accountId: 'av', pct: 80 }];
    const d = recommendPayDistribution(data({ savingsSplit: split, savingsSplitFrom: '2026-10-01' }), { amount: 2500, receivedOn: '2026-10-27' });
    expect(d.customSplit).toBe(true);
    expect(d.lines.filter(l => l.kind === 'saving').map(l => [l.key, l.amount])).toEqual([['s:la', 290], ['s:av', 1160]]);
    // Paie reçue avant la date d'effet : répartition automatique.
    expect(recommendPayDistribution(data({ savingsSplit: split, savingsSplitFrom: '2026-11-01' }), { amount: 2500, receivedOn: '2026-10-27' }).customSplit).toBe(false);
  });

  it('montant illisible : compté 0 ; mode discret : la phrase ne montre pas le montant', () => {
    expect(recommendPayDistribution(data(), { amount: Number.NaN })).toMatchObject({ toSave: 0, shortfall: 1050 });
    setDiscreetAmounts(true);
    expect(payGapSentence(recommendPayDistribution(data(), { amount: 2300 }), {})).toContain(DISCREET_AMOUNT);
  });
});
