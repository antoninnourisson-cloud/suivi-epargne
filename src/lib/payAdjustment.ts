// ================================================
// FILE: src/lib/payAdjustment.ts
// Objectif d'épargne du mois d'épargne en cours. Paie pas encore déclarée : la capacité
// calculée (ou le montant du rappel de paie). Paie déclarée dans le rituel « J'ai reçu ma
// paie » : la répartition conseillée pour le montant REÇU (lib/payDistribution, « À placer
// sur cette paie » et prime compris), plus les versements en plus du même mois. Les anciens
// réglages de la paie en cours (« Capacité d'épargne du mois », « Somme en plus », schéma v2)
// sont devenus PayRecord.toSave / bonus (lib/schema).
// Une seule règle pour le Pilotage, la jauge de l'Accueil et la relance de paie du serveur.
// ================================================
import type { GlobalAppData, PayAdjustment } from '../types';
import { computeMonthlySavingsCapacity } from './finance';
import { openPay, payAdjustmentOf, PayData } from './payRecords';
import { recommendPayDistribution } from './payDistribution';
import { savingsMonthOfPay } from './payCalendar';
import { round2 } from './money';

/** D'où vient la capacité retenue : saisie pour cette paie, rappel de paie, ou calcul. */
export type MonthTargetSource = 'manual' | 'payday' | 'calc';

export interface MonthTarget {
  /** Capacité calculée : paie nette − charges fixes − budgets. */
  computed: number;
  /** Capacité retenue : saisie pour cette paie, sinon montant du rappel de paie, sinon calcul. */
  capacity: number;
  /** Somme en plus à placer sur cette paie (0 si aucune). */
  extra: number;
  /** À placer sur cette paie : capacité retenue + somme en plus, jamais négatif. */
  total: number;
  source: MonthTargetSource;
}

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const finiteOrUndefined = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;

/** Réglage de la paie en cours (paie du mois d'épargne en cours), ou `undefined`. */
export const currentPayAdjustment = (data: PayData, asOf: Date = new Date()): PayAdjustment | undefined =>
  payAdjustmentOf(data, asOf);

/** Combine capacité calculée, montant du rappel de paie et réglage de la paie en cours. */
export const combineMonthTarget = (input: {
  computed: number;
  paydayAmount?: number;
  adjustment?: PayAdjustment;
}): MonthTarget => {
  const manual = finiteOrUndefined(input.adjustment?.capacity);
  const payday = finiteOrUndefined(input.paydayAmount);
  const capacity = manual ?? payday ?? input.computed;
  const extra = finiteOrUndefined(input.adjustment?.extra) ?? 0;
  return {
    computed: input.computed,
    capacity,
    extra,
    total: Math.max(0, round2(capacity + extra)),
    source: manual !== undefined ? 'manual' : payday !== undefined ? 'payday' : 'calc',
  };
};

/**
 * Objectif du mois d'épargne en cours, à partir des données complètes (Pilotage, Accueil,
 * Agenda, serveur). Paie déclarée : ce qui est conseillé pour le montant reçu ; les
 * versements en plus du mois (prime à part, deuxième employeur) s'y ajoutent.
 */
export const computeMonthTarget = (data: GlobalAppData, asOf: Date = new Date()): MonthTarget => {
  const computed = computeMonthlySavingsCapacity(data);
  const { window, pay } = openPay(data, asOf);
  const extras = (data.pays ?? [])
    .filter(p => p.kind === 'extra' && savingsMonthOfPay(p) === window.key)
    .reduce((sum, p) => sum + recommendPayDistribution(data, { amount: p.amount, toSave: p.toSave, kind: 'extra', receivedOn: p.receivedOn }).toSave, 0);
  if (!pay) {
    const base = combineMonthTarget({ computed, paydayAmount: data.config?.paydayAmount });
    return { ...base, extra: round2(base.extra + extras), total: round2(base.total + extras) };
  }
  const d = recommendPayDistribution(data, { amount: pay.amount, bonus: pay.bonus, toSave: pay.toSave, receivedOn: pay.receivedOn });
  const payday = finiteOrUndefined(data.config?.paydayAmount);
  return {
    computed,
    capacity: d.capacity,
    extra: round2(d.bonus + extras),
    total: round2(d.toSave + extras),
    source: finiteOrUndefined(pay.toSave) !== undefined ? 'manual' : payday !== undefined ? 'payday' : 'calc',
  };
};

/**
 * Lecture d'un fichier (migrate) : écarte un réglage sans mois de paie lisible et les montants
 * illisibles. Les champs inconnus sont conservés.
 */
export const sanitizePayAdjustment = (raw: unknown): PayAdjustment | undefined => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  if (typeof r.period !== 'string' || !PERIOD.test(r.period)) return undefined;
  const out: Record<string, unknown> = { ...r };
  for (const k of ['capacity', 'extra'] as const) {
    if (out[k] !== undefined && finiteOrUndefined(out[k]) === undefined) delete out[k];
  }
  return out as unknown as PayAdjustment;
};
