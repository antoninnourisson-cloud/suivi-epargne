// ================================================
// FILE: src/lib/payDistribution.ts
// Répartition conseillée pour une paie RÉELLEMENT reçue (rituel « Ma paie », commande
// recordPay). Même chemin que le Pilotage : virements de la paie (computePayTransfers),
// puis épargne par compte (computePlacementStrategy, répartition personnalisée comprise),
// lignes à cocher (buildPayLines). Ce qui change : le montant de départ est la paie reçue,
// pas la paie estimée.
//  - À placer = reçu (hors prime) − dépenses prévues, jamais négatif, plus la prime placée en
//    entier. Une paie plus basse que prévu fait baisser l'épargne (les dépenses ne bougent
//    pas) ; plus haute, elle la fait monter. Avec un « montant fixe à placer » (rappel de
//    paie), l'écart à la paie estimée s'y ajoute de la même façon.
//  - « À placer sur cette paie » saisi (toSave) remplace ce calcul, prime en plus.
//  - Versement en plus (prime à part, deuxième employeur) : rien à virer, 100 % épargne.
// Fonction pure, partagée par l'app (et le serveur si besoin).
// ================================================
import type { GlobalAppData, PayChecklistLine } from '../types';
import {
  activeSavingsSplit, buildPayLines, computeMonthlyPay, computePayTransfers, computePlacementStrategy,
  PayTransfer, PlacementStep, totalFixedCharges,
} from './finance';
import { DEFAULT_FISCAL_CONFIG } from '../constants';
import { parseISODate } from './dates';
import { formatEUR } from './format';
import { round2 } from './money';

/** Écart (en euros) en dessous duquel la paie reçue « vaut » la paie estimée. */
const GAP_TOLERANCE = 0.5;

export interface PayDistributionInput {
  /** Net reçu, prime comprise. */
  amount: number;
  /** Dont prime ou exceptionnel (placé en entier). */
  bonus?: number;
  /** « À placer sur cette paie » saisi : remplace le calcul (prime en plus). */
  toSave?: number;
  kind?: 'extra';
  /** Date de réception ('YYYY-MM-DD') : date d'effet de la répartition personnalisée. */
  receivedOn?: string;
}

export interface PayDistribution {
  /** Paie estimée (fiche de paie de référence, sinon formule) : la base du Pilotage. */
  expectedPay: number;
  /** Dépenses prévues avant l'épargne : charges fixes, abonnements, argent plaisir, projets. */
  plannedSpending: number;
  /** Reçu hors prime − paie estimée (0 pour un versement en plus). */
  gap: number;
  /** À placer hors prime. */
  capacity: number;
  bonus: number;
  /** À placer sur cette paie, prime comprise, jamais négatif. */
  toSave: number;
  /** > 0 : les virements (et l'épargne prévue) dépassent la paie reçue. */
  shortfall: number;
  transfers: PayTransfer[];
  steps: PlacementStep[];
  /** Lignes à cocher : virements de la paie puis épargne par compte. */
  lines: PayChecklistLine[];
  /** Répartition personnalisée active (change le « pourquoi » de chaque compte, placementReason). */
  customSplit: boolean;
}

const finite = (v: number | undefined): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

export const recommendPayDistribution = (data: GlobalAppData, input: PayDistributionInput): PayDistribution => {
  const c = data.config || ({} as GlobalAppData['config']);
  const amount = Math.max(0, finite(input.amount) ?? 0);
  const asOf = input.receivedOn ? parseISODate(input.receivedOn) : new Date();
  const split = activeSavingsSplit(c, asOf);
  const expectedPay = round2(computeMonthlyPay(data));
  const forced = finite(input.toSave);
  const extra = input.kind === 'extra';

  const transfers = extra ? [] : computePayTransfers({
    expenses: data.expenses || [], subscriptions: data.subscriptions || [],
    leisureBudget: c.leisureBudget ?? 0, projectSavings: c.projectSavings ?? 0,
  });
  const plannedSpending = extra ? 0
    : round2(totalFixedCharges(data.expenses || [], data.subscriptions || []) + (c.leisureBudget ?? 0) + (c.projectSavings ?? 0));
  // Prime : jamais plus que la paie elle-même ; un versement en plus est tout entier « en plus ».
  const bonus = extra ? 0 : Math.min(amount, Math.max(0, finite(input.bonus) ?? 0));
  const base = amount - bonus;
  const gap = extra ? 0 : round2(base - expectedPay);
  // Épargne prévue sur la paie estimée (montant fixe du rappel de paie, sinon calcul), à
  // laquelle s'ajoute l'écart entre la paie reçue et la paie estimée.
  const planned = finite(c.paydayAmount) ?? (expectedPay - plannedSpending);
  const raw = extra ? (forced ?? amount) : (forced ?? planned + gap);
  const capacity = Math.max(0, round2(raw));
  const toSave = Math.max(0, round2(capacity + bonus));
  // Ce qui manque : les virements seuls dépassent la paie, ou virements + épargne prévue.
  const shortfall = extra ? 0 : Math.max(0, round2(plannedSpending - base), round2(plannedSpending + raw - base));

  const steps = computePlacementStrategy(toSave, data.accounts || [], data.fiscalConfig || DEFAULT_FISCAL_CONFIG, split);
  return {
    expectedPay, plannedSpending, gap, capacity, bonus, toSave, shortfall, transfers, steps,
    lines: buildPayLines(transfers, steps),
    customSplit: !!split,
  };
};

/**
 * La phrase qui explique l'écart à la paie estimée (rien sans écart, avec un montant saisi
 * ou pour un versement en plus) : c'est l'épargne qui bouge, pas les dépenses prévues.
 */
export const payGapSentence = (d: Pick<PayDistribution, 'gap' | 'capacity'>, input: Pick<PayDistributionInput, 'toSave' | 'kind'>): string | undefined => {
  if (input.kind === 'extra' || finite(input.toSave) !== undefined || Math.abs(d.gap) < GAP_TOLERANCE) return undefined;
  if (d.gap < 0) {
    return d.capacity > 0
      ? `Paie inférieure de ${formatEUR(-d.gap)} à l'estimation : vos dépenses prévues ne changent pas, l'épargne conseillée baisse d'autant.`
      : `Paie inférieure de ${formatEUR(-d.gap)} à l'estimation : après vos dépenses prévues, il ne reste rien à placer sur cette paie.`;
  }
  return `Paie supérieure de ${formatEUR(d.gap)} à l'estimation : la différence s'ajoute à l'épargne conseillée.`;
};
