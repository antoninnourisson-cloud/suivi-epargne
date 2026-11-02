import { describe, it, expect, afterEach } from 'vitest';
import fc from 'fast-check';
import { howItsComputed, payBarParts, payRuleSentence, placementReason, planSentence } from './pilotView';
import { allocatePay, type AllocatePayInput } from './payDistribution';
import { DISCREET_AMOUNT, setDiscreetAmounts } from './format';
import { AccountType } from '../types';

afterEach(() => setDiscreetAmounts(false));

// Paie habituelle 2 000 €, virements fixes 1 050 €, projets 100 €, solde de départ 400 €.
const usual = { expectedPay: 2000, fixed: 1050, projects: 100, startBalance: 400 };
const run = (patch: Partial<AllocatePayInput> = {}) => allocatePay({ received: 2000, ...usual, ...patch });
const nb = (s: string) => s.replace(/[  ]/g, ' ');

describe('payBarParts : la barre de la paie', () => {
  it('quatre parts dans l\'ordre des priorités, total = paie + reste, texte complet', () => {
    const bar = payBarParts(run({ before: 30 }));
    expect(bar.parts.map(p => [p.key, p.amount, p.planned])).toEqual([
      ['fixed', 1050, undefined], ['savings', 480, undefined], ['projects', 100, undefined], ['leisure', 400, undefined],
    ]);
    expect(bar.total).toBe(2030);
    expect(bar.parts.reduce((s, p) => s + p.amount, 0)).toBe(bar.total);
    expect(nb(bar.label)).toBe('Répartition de 2 030 € : virements fixes 1 050 €, épargne 480 €, épargne projets 100 €, plaisir 400 €.');
  });

  it('une part coupée garde son prévu', () => {
    const bar = payBarParts(run({ received: 1350, before: -50 }));
    expect(bar.parts.map(p => [p.key, p.amount, p.planned])).toEqual([
      ['fixed', 1050, undefined], ['savings', 0, 450], ['projects', 0, 100], ['leisure', 250, 400],
    ]);
    expect(nb(bar.label)).toMatch(/plaisir 250 € \(prévu 400 €\)\.$/);
  });

  it('sans projets prévus, pas de part projets ; fixes non couverts : plaisir à 0 et ce qu\'il manque', () => {
    expect(payBarParts(allocatePay({ received: 2000, ...usual, projects: 0 })).parts.map(p => p.key)).toEqual(['fixed', 'savings', 'leisure']);
    const bar = payBarParts(run({ received: 900 }));
    expect(bar.parts.find(p => p.key === 'leisure')).toMatchObject({ amount: 0, planned: 400 });
    expect(bar).toMatchObject({ total: 900, missingFixed: 150 });
    expect(nb(bar.label)).toMatch(/Il manque 150 € pour les virements fixes\.$/);
  });

  it('versement en plus : l\'épargne seule (et ce qui reste sur le compte courant)', () => {
    expect(payBarParts(allocatePay({ received: 300, kind: 'extra', ...usual })).parts.map(p => p.key)).toEqual(['savings']);
    expect(payBarParts(allocatePay({ received: 300, fixedSavings: 100, kind: 'extra', ...usual })).parts.map(p => [p.key, p.amount])).toEqual([['savings', 100], ['leisure', 200]]);
  });

  it('mode discret : aucun montant dans le texte', () => {
    setDiscreetAmounts(true);
    expect(payBarParts(run()).label).not.toMatch(/\d/);
    expect(payBarParts(run()).label).toContain(DISCREET_AMOUNT);
  });
});

describe('howItsComputed : « Comment c\'est calculé »', () => {
  it('plan habituel : paie − fixes − projets − solde de départ = épargne visée', () => {
    const rows = howItsComputed(run());
    expect(rows.map(r => [r.key, r.amount, r.kind])).toEqual([
      ['pay', 2000, 'start'], ['fixed', 1050, 'minus'], ['projects', 100, 'minus'], ['start', 400, 'minus'], ['target', 450, 'subtotal'],
    ]);
    expect(howItsComputed(run(), 'Net réel perçu (fiche de paie)')[0].label).toBe('Net réel perçu (fiche de paie)');
  });

  it('paie déclarée : reste, prime et écart, puis l\'épargne de cette paie', () => {
    const rows = howItsComputed(run({ received: 2350, bonus: 500, before: 30 }));
    expect(rows.slice(5).map(r => [r.key, r.amount, r.label])).toEqual([
      ['before', 30, 'Reste du mois dernier'], ['bonus', 500, 'Prime'], ['gap', -150, 'Écart de paie'], ['leisure', 120, 'Pris sur le plaisir'], ['total', 950, 'Épargne de cette paie'],
    ]);
    expect(howItsComputed(run({ received: 1350, before: -50 })).find(r => r.key === 'leisure')?.label).toBe('Pris sur le plaisir et les projets');
    expect(howItsComputed(run({ fixedSavings: 500, received: 2100 })).find(r => r.key === 'leisure')).toMatchObject({ label: 'Laissé au plaisir', amount: -50 });
    const short = howItsComputed(run({ received: 900 })).find(r => r.key === 'leisure')!;
    expect(short.label).toBe('Plaisir et projets à zéro');
    expect(nb(short.note!)).toBe('Il manque 150 € pour les virements fixes.');
    expect(rows.find(r => r.key === 'bonus')?.note).toBe('Placée en entier.');
    expect(howItsComputed(run({ before: -300 })).find(r => r.key === 'before')?.label).toBe('Découvert avant la paie');
    expect(howItsComputed(run({ received: 1500, bonus: 500 })).find(r => r.key === 'bonus')?.note).toBeUndefined();
  });

  it('montant fixe : il remplace le calcul ; épargne visée négative ramenée à 0', () => {
    const rows = howItsComputed(run({ fixedSavings: 500 }));
    expect(rows.find(r => r.key === 'fixedSavings')).toMatchObject({ amount: 500, kind: 'replace' });
    expect(nb(rows.find(r => r.key === 'fixedSavings')!.note!)).toBe('Remplace le calcul (450 €).');
    const neg = howItsComputed(allocatePay({ received: 1500, expectedPay: 1500, fixed: 1050, projects: 0, startBalance: 500 }));
    expect(neg.find(r => r.key === 'target')).toMatchObject({ amount: 0 });
    expect(nb(neg.find(r => r.key === 'target')!.note!)).toBe('Ramenée à 0 € : il manque 50 €.');
    // Sans solde de départ ni projets : lignes omises.
    expect(howItsComputed(allocatePay({ received: 2000, expectedPay: 2000, fixed: 1000, projects: 0, startBalance: 0 })).map(r => r.key)).toEqual(['pay', 'fixed', 'target']);
  });

  it('propriété : l\'épargne visée (ou le montant fixe) plus les ajustements donne l\'épargne de la paie', () => {
    const e = (max: number) => fc.integer({ min: 0, max: max * 100 }).map(c => c / 100);
    fc.assert(fc.property(e(6000), e(1000), fc.integer({ min: -200000, max: 200000 }).map(c => c / 100), e(5000), e(3000), e(500), e(1200), fc.option(e(2500), { nil: undefined }),
      (received, bonusMax, before, expectedPay, fixed, projects, startBalance, fixedSavings) => {
        const a = allocatePay({ received, bonus: Math.min(received, bonusMax), before, expectedPay, fixed, projects, startBalance, fixedSavings });
        const rows = howItsComputed(a);
        const from = rows.find(r => r.key === 'fixedSavings') ?? rows.find(r => r.key === 'target')!;
        const adjust = rows.filter(r => r.kind === 'adjust').reduce((s, r) => s + Math.round(r.amount * 100), 0);
        const total = rows.find(r => r.key === 'total')?.amount ?? from.amount;
        expect(Math.round(from.amount * 100) + adjust).toBe(Math.round(total * 100));
        expect(total).toBe(a.savings);
      }), { numRuns: 300 });
  });

  it('versement en plus : tout à l\'épargne', () => {
    expect(howItsComputed(allocatePay({ received: 300, kind: 'extra', ...usual })).map(r => [r.key, r.amount])).toEqual([['received', 300], ['total', 300]]);
  });

  it('la règle des coupes, avec le minimum en euros', () => {
    expect(nb(payRuleSentence(run()))).toBe('Si la paie ne suffit pas, le plaisir baisse d\'abord, jamais sous les 2/3 du solde de départ du mois (267 €), puis l\'épargne projets, puis l\'épargne. Les virements fixes ne bougent jamais, et une prime est placée en entier. Ce qui dépasse va à l\'épargne.');
  });
});

describe('planSentence', () => {
  it('dit d\'où vient l\'épargne du plan habituel', () => {
    expect(nb(planSentence(run()))).toBe('Ce qui reste de votre paie de 2 000 € une fois les virements fixes, l\'épargne projets et le solde de départ du mois (400 €) mis de côté.');
    expect(nb(planSentence(run({ fixedSavings: 500 })))).toBe('Votre montant fixe d\'épargne (le calcul donne 450 €).');
    expect(nb(planSentence(allocatePay({ received: 1500, expectedPay: 1500, fixed: 1050, projects: 100, startBalance: 400 }))))
      .toBe('Rien à placer ce mois-ci : vos virements fixes, l\'épargne projets et le solde de départ du mois dépassent votre paie de 50 €.');
  });
});

describe('placementReason', () => {
  const step = { accountId: 'a', accountName: 'Livret A', type: AccountType.LIVRET_A, rate: 3, fillAmount: 100, isFullAfter: true, isLiquid: true };
  it('explique le choix du compte', () => {
    expect(placementReason(step, false)).toMatch(/^Disponible à tout moment et sans impôt : rempli jusqu'au plafond$/);
    expect(placementReason({ ...step, isLiquid: false, isFullAfter: false }, false)).toMatch(/livrets sont pleins/);
    expect(placementReason({ ...step, isFullAfter: false }, true)).toBe('Selon votre répartition personnalisée');
  });
  it('ne dit pas « sans impôt » pour un CEL ou un livret bancaire', () => {
    expect(placementReason({ ...step, type: AccountType.CEL }, false)).toBe("Vos livrets réglementés sont pleins : disponible à tout moment, intérêts imposés ; rempli jusqu'au plafond");
    expect(placementReason({ ...step, type: AccountType.LIVRET_BANCAIRE, isFullAfter: false }, false)).toBe('Vos livrets réglementés sont pleins : disponible à tout moment, intérêts imposés');
  });
});
