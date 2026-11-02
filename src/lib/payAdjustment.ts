// ================================================
// FILE: src/lib/payAdjustment.ts
// Objectif d'épargne du mois d'épargne en cours, par la règle unique de la paie
// (lib/payDistribution, allocatePay). Paie pas encore déclarée : le plan de la paie habituelle
// (épargne visée, ou montant fixe). Paie déclarée dans le rituel « J'ai reçu ma paie » :
// l'épargne de la paie REÇUE (reste du compte courant, prime et ancien « À placer » compris),
// plus les versements en plus du même mois. Les anciens réglages de la paie en cours
// (« Capacité d'épargne du mois », « Somme en plus », schéma v2) sont devenus
// PayRecord.toSave / bonus (lib/schema).
// Une seule règle pour le Pilotage, la jauge de l'Accueil, l'agenda et le serveur.
// ================================================
import type { GlobalAppData, PayAdjustment } from '../types';
import { openPay } from './payRecords';
import { payBalanceBefore, recommendPayDistribution, usualPayDistribution } from './payDistribution';
import { savingsMonthOfPay } from './payCalendar';
import { round2 } from './money';

/** D'où vient l'épargne visée : saisie pour cette paie (ancien « À placer »), montant fixe, ou calcul. */
export type MonthTargetSource = 'manual' | 'payday' | 'calc';

export interface MonthTarget {
  /** Épargne que donne le calcul : paie habituelle − virements fixes − projets − solde de départ du mois. */
  computed: number;
  /** Épargne de la paie hors prime (et hors versements en plus). */
  capacity: number;
  /** Prime placée et versements en plus du mois (0 si aucun). */
  extra: number;
  /** À placer sur ce mois d'épargne : épargne de la paie + versements en plus, jamais négatif. */
  total: number;
  source: MonthTargetSource;
}

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const finiteOrUndefined = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;

/**
 * Objectif du mois d'épargne en cours, à partir des données complètes (Pilotage, Accueil,
 * Agenda, serveur). Paie déclarée : son épargne selon la règle de la paie ; les versements
 * en plus du mois (prime à part, deuxième employeur) s'y ajoutent, sans recompter les
 * virements fixes ni l'épargne visée.
 */
export const computeMonthTarget = (data: GlobalAppData, asOf: Date = new Date()): MonthTarget => {
  const { window, pay } = openPay(data, asOf);
  const extras = round2((data.pays ?? [])
    .filter(p => p.kind === 'extra' && savingsMonthOfPay(p) === window.key)
    .reduce((sum, p) => sum + recommendPayDistribution(data, { amount: p.amount, toSave: p.toSave, kind: 'extra', receivedOn: p.receivedOn }).toSave, 0));
  const d = pay
    ? recommendPayDistribution(data, { amount: pay.amount, bonus: pay.bonus, toSave: pay.toSave, before: payBalanceBefore(pay), receivedOn: pay.receivedOn })
    : usualPayDistribution(data, asOf);
  const a = d.allocation;
  return {
    computed: a.computedTarget,
    capacity: d.capacity,
    extra: round2(a.bonusPlaced + extras),
    total: round2(d.toSave + extras),
    source: finiteOrUndefined(pay?.toSave) !== undefined ? 'manual' : finiteOrUndefined(data.config?.paydayAmount) !== undefined ? 'payday' : 'calc',
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
