import { describe, expect, it } from 'vitest';
import { computeMonthTarget, sanitizePayAdjustment } from './payAdjustment';
import { openPay } from './payRecords';
import { emptyData, migrate } from './schema';
import { computeMonthlyPay, computeMonthlySavingsCapacity } from './finance';
import type { GlobalAppData, PayRecord } from '../types';

// Paie le 27 : le 19 octobre 2026, on gère encore la paie de septembre.
const OCT_19 = new Date(2026, 9, 19);
const OCT_28 = new Date(2026, 9, 28);

// Réglages écrits par l'app d'avant le schéma v3 (config.payAdjustment), passés par migrate()
// comme à l'ouverture du fichier : ils vivent ensuite sur la paie de leur mois d'épargne, et
// l'objectif doit rester exactement le même.
const withConfig = (patch: Partial<GlobalAppData['config']>): GlobalAppData => {
  const d = emptyData();
  return migrate({ ...d, schemaVersion: 2, config: { ...d.config, ...patch } });
};

// Les anciens réglages de la paie en cours (schéma v2) vivent sur la paie de leur mois
// d'épargne (toSave, bonus) : ils ne valent que pour ce mois-là.
describe('réglages de la paie en cours migrés', () => {
  it('ne gardent que le réglage de la paie en cours', () => {
    const data = withConfig({ paydayDay: 27, payAdjustment: { period: '2026-09', extra: 500 } });
    expect(openPay(data, OCT_19).pay).toMatchObject({ savingsMonth: '2026-10', bonus: 500 });
    // Paie suivante (27 octobre) : le réglage de septembre ne vaut plus.
    expect(openPay(data, OCT_28).pay).toBeUndefined();
  });

  it('sans jour de paie, la période est le mois calendaire', () => {
    expect(openPay(withConfig({ payAdjustment: { period: '2026-10', capacity: 900 } }), OCT_19).pay).toMatchObject({ savingsMonth: '2026-10', toSave: 900 });
    expect(openPay(withConfig({ payAdjustment: { period: '2026-09', capacity: 900 } }), OCT_19).pay).toBeUndefined();
  });
});

describe('computeMonthTarget', () => {
  // Paie déclarée dans le rituel : l'objectif suit le montant REÇU (lib/payDistribution).
  it('paie déclarée : à placer selon le montant reçu, prime et versements en plus du mois compris', () => {
    const base = withConfig({ paydayDay: 27 });
    const computed = computeMonthlySavingsCapacity(base);
    const pay = computeMonthlyPay(base);
    const received = (patch: Partial<PayRecord>): GlobalAppData => ({
      ...base,
      pays: [{ id: 'pay-2026-11', receivedOn: '2026-10-27', savingsMonth: '2026-11', amount: pay, lines: [], done: {}, ...patch }],
    });
    // Reçu = estimé : même objectif qu'avant la déclaration.
    expect(computeMonthTarget(received({}), OCT_28)).toMatchObject({ source: 'calc' });
    expect(computeMonthTarget(received({}), OCT_28).total).toBeCloseTo(Math.max(0, computed), 2);
    // 100 € de moins : le plaisir (300 €, minimum 200 €) absorbe, l'épargne tient ; 300 € de
    // moins : plaisir au minimum, projets (200 €) coupés ; 400 € de moins : l'épargne baisse
    // de 100 €. Une prime de 300 € s'ajoute en entier.
    expect(computeMonthTarget(received({ amount: pay - 100 }), OCT_28).total).toBeCloseTo(Math.max(0, computed), 2);
    expect(computeMonthTarget(received({ amount: pay - 300 }), OCT_28).total).toBeCloseTo(Math.max(0, computed), 2);
    expect(computeMonthTarget(received({ amount: pay - 400 }), OCT_28).total).toBeCloseTo(Math.max(0, computed - 100), 2);
    // Reste du compte courant noté avec la paie : il rejoint l'épargne ; « Je ne sais pas » : 0.
    expect(computeMonthTarget(received({ balance: { before: 40, seen: pay + 40, source: 'typed' } }), OCT_28).total).toBeCloseTo(Math.max(0, computed) + 40, 2);
    expect(computeMonthTarget(received({ balance: { before: 40, source: 'unknown' } }), OCT_28).total).toBeCloseTo(Math.max(0, computed), 2);
    expect(computeMonthTarget(received({ amount: pay + 300, bonus: 300 }), OCT_28)).toMatchObject({ extra: 300 });
    // « À placer sur cette paie » saisi : il remplace le calcul.
    expect(computeMonthTarget(received({ toSave: 640 }), OCT_28)).toMatchObject({ capacity: 640, total: 640, source: 'manual' });
    // Versement en plus du même mois (prime à part) : placé en entier, même sans paie déclarée.
    const extra: PayRecord = { id: 'prime', receivedOn: '2026-10-30', savingsMonth: '2026-11', amount: 250, kind: 'extra', lines: [], done: {} };
    const withExtra = received({ toSave: 640 });
    expect(computeMonthTarget({ ...withExtra, pays: [...withExtra.pays!, extra] }, OCT_28)).toMatchObject({ total: 890, extra: 250 });
    expect(computeMonthTarget({ ...base, pays: [extra] }, OCT_28).total).toBeCloseTo(Math.max(0, computed) + 250, 2);
  });

  it('même objectif que le Pilotage : calcul + réglage de la paie en cours', () => {
    const base = withConfig({ paydayDay: 27 });
    const computed = computeMonthlySavingsCapacity(base);
    const data = withConfig({ paydayDay: 27, payAdjustment: { period: '2026-09', extra: 500 } });
    expect(computeMonthTarget(data, OCT_19).total).toBeCloseTo(Math.max(0, computed + 500), 2);
    // À la paie suivante, la prime n'est plus comptée.
    expect(computeMonthTarget(data, OCT_28).total).toBeCloseTo(Math.max(0, computed), 2);
  });

  it('le montant du rappel de paie reste la base quand rien n’est saisi pour cette paie', () => {
    const data = withConfig({ paydayDay: 27, paydayAmount: 650, payAdjustment: { period: '2026-08', capacity: 100 } });
    expect(computeMonthTarget(data, OCT_19)).toMatchObject({ capacity: 650, extra: 0, total: 650, source: 'payday' });
    // Sans paie déclarée : le plan de la paie habituelle, avec ce montant fixe.
    expect(computeMonthTarget(withConfig({ paydayDay: 27, paydayAmount: 650 }), OCT_19)).toMatchObject({ total: 650, source: 'payday' });
    expect(computeMonthTarget(withConfig({ paydayDay: 27 }), OCT_19)).toMatchObject({ source: 'calc' });
    expect(computeMonthTarget(withConfig({ paydayDay: 27 }), OCT_19).computed).toBeCloseTo(computeMonthlySavingsCapacity(withConfig({ paydayDay: 27 })), 2);
  });
});

describe('sanitizePayAdjustment et migrate', () => {
  it('écarte un réglage illisible, garde les champs inconnus', () => {
    expect(sanitizePayAdjustment(null)).toBeUndefined();
    expect(sanitizePayAdjustment({ capacity: 3 })).toBeUndefined();
    expect(sanitizePayAdjustment({ period: '2026-13', capacity: 3 })).toBeUndefined();
    expect(sanitizePayAdjustment({ period: '2026-09', capacity: 'beaucoup', extra: 200, note: 'prime' })).toEqual({ period: '2026-09', extra: 200, note: 'prime' });
  });

  it('migrate() reporte un réglage valide sur sa paie et retire un réglage abîmé', () => {
    const ok = migrate({ config: { payAdjustment: { period: '2026-09', capacity: 900, extra: 500 } } });
    expect(ok.config.payAdjustment).toBeUndefined();
    expect(ok.pays).toEqual([expect.objectContaining({ savingsMonth: '2026-09', toSave: 900, bonus: 500 })]);
    const broken = migrate({ config: { payAdjustment: 'prime' } });
    expect('payAdjustment' in broken.config).toBe(false);
    expect(broken.pays).toEqual([]);
    expect(migrate({ config: {} }).config.payAdjustment).toBeUndefined();
  });
});
