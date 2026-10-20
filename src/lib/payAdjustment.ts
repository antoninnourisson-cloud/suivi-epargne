// ================================================
// FILE: src/lib/payAdjustment.ts
// Objectif d'épargne de la paie en cours. Le Pilotage permet d'ajuster une paie :
// « Capacité d'épargne du mois » (remplace le calcul) et « Somme en plus à placer » (prime,
// cadeau, remboursement…). Ces réglages sont enregistrés dans le fichier de données avec le
// mois de la paie (payPeriodOf) : ils valent jusqu'à la paie suivante, puis sont ignorés.
// Une seule règle pour le Pilotage, la jauge de l'Accueil et la relance de paie du serveur.
// ================================================
import type { GlobalAppData, PayAdjustment } from '../types';
import { computeMonthlySavingsCapacity, payPeriodOf } from './finance';
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

/** Réglage de la paie en cours, ou `undefined` s'il n'y en a pas ou s'il date d'une autre paie. */
export const currentPayAdjustment = (
  config: Pick<GlobalAppData['config'], 'payAdjustment' | 'paydayDay'> | undefined,
  asOf: Date = new Date()
): PayAdjustment | undefined => {
  const adj = config?.payAdjustment;
  if (!adj || adj.period !== payPeriodOf(config?.paydayDay, asOf).key) return undefined;
  return adj;
};

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

/** Objectif de la paie en cours, à partir des données complètes (Accueil, serveur). */
export const computeMonthTarget = (data: GlobalAppData, asOf: Date = new Date()): MonthTarget =>
  combineMonthTarget({
    computed: computeMonthlySavingsCapacity(data),
    paydayAmount: data.config?.paydayAmount,
    adjustment: currentPayAdjustment(data.config, asOf),
  });

/**
 * Nouveau réglage après une saisie dans le Pilotage, pour la paie `period`. `null` efface la
 * valeur (retour au calcul) ; une somme en plus nulle est effacée ; le réglage d'une paie
 * passée est remplacé. Renvoie `undefined` quand il ne reste rien à garder.
 */
export const updatePayAdjustment = (
  current: PayAdjustment | undefined,
  period: string,
  patch: { capacity?: number | null; extra?: number | null }
): PayAdjustment | undefined => {
  const next: PayAdjustment = current && current.period === period ? { ...current } : { period };
  if (patch.capacity !== undefined) {
    if (patch.capacity === null || !Number.isFinite(patch.capacity)) delete next.capacity;
    else next.capacity = round2(patch.capacity);
  }
  if (patch.extra !== undefined) {
    if (patch.extra === null || !Number.isFinite(patch.extra) || patch.extra === 0) delete next.extra;
    else next.extra = round2(patch.extra);
  }
  return next.capacity === undefined && next.extra === undefined ? undefined : next;
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
