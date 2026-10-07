import { describe, it, expect } from 'vitest';
import { buildWaterfall, heroContext, placementReason, WaterfallInput } from './pilotView';
import { AccountType } from '../types';

const base: WaterfallInput = {
  pay: 3000, payLabel: 'Salaire net après impôt',
  manualFixed: 1000, subscriptionsFixed: 50, leisureBudget: 400, projectSavings: 0,
  theoreticalCapacity: 1550, source: 'calc', retained: 1550, externalSavings: 0, totalToInvest: 1550,
};

describe('buildWaterfall', () => {
  it('part de la paie, retire charges et budgets, et omet les lignes à zéro', () => {
    const rows = buildWaterfall(base);
    expect(rows.map(r => r.key)).toEqual(['pay', 'fixed', 'subs', 'leisure', 'capacity', 'total']);
    expect(rows.at(-1)).toMatchObject({ amount: 1550, kind: 'total', note: undefined });
  });

  it('montre le montant retenu et la somme en plus quand ils changent le résultat', () => {
    const rows = buildWaterfall({ ...base, source: 'payday', retained: 1200, externalSavings: 300, totalToInvest: 1500 });
    expect(rows.map(r => r.key)).toEqual(['pay', 'fixed', 'subs', 'leisure', 'capacity', 'retained', 'extra', 'total']);
    expect(rows.find(r => r.key === 'retained')?.label).toBe('Montant fixé dans le rappel de paie');
  });

  it('explique un total ramené à zéro', () => {
    const rows = buildWaterfall({ ...base, theoreticalCapacity: -200, retained: -200, totalToInvest: 0 });
    expect(rows.at(-1)?.note).toMatch(/Ramené à 0 €/);
  });
});

describe('heroContext', () => {
  const ctx = { pay: 3000, source: 'calc' as const, theoreticalCapacity: 1550, externalSavings: 0, totalToInvest: 1550, finalCapacity: 1550 };
  it('dit d’où vient le montant', () => {
    expect(heroContext(ctx)).toMatch(/^Ce qui reste de votre paie de 3/);
    expect(heroContext({ ...ctx, source: 'manual' })).toMatch(/^Le montant que vous avez saisi/);
    expect(heroContext({ ...ctx, source: 'payday', externalSavings: 200 })).toMatch(/rappel de paie.*Somme en plus ce mois-ci comprise : \+200/);
  });
  it('signale un mois sans rien à placer', () => {
    expect(heroContext({ ...ctx, finalCapacity: -100, totalToInvest: 0 })).toMatch(/^Rien à placer ce mois-ci/);
  });
});

describe('placementReason', () => {
  const step = { accountId: 'a', accountName: 'Livret A', type: AccountType.LIVRET_A, rate: 3, fillAmount: 100, isFullAfter: true, isLiquid: true };
  it('explique le choix du compte', () => {
    expect(placementReason(step, false)).toMatch(/^Disponible à tout moment et sans impôt : rempli jusqu'au plafond$/);
    expect(placementReason({ ...step, isLiquid: false, isFullAfter: false }, false)).toMatch(/livrets sont pleins/);
    expect(placementReason({ ...step, isFullAfter: false }, true)).toBe('Selon votre répartition personnalisée');
  });
});
