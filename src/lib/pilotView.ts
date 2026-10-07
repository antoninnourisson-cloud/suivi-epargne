// Mise en forme de l'écran Pilotage : textes et lignes d'explication construits à partir
// des chiffres déjà calculés par l'écran (aucun nouveau calcul financier ici).
import type { PlacementStep } from './finance';
import { formatEUR, formatSignedEUR } from './format';

/** D'où vient le montant à placer : 'calc' (calcul), 'payday' (rappel de paie), 'manual' (saisi). */
export type AmountSource = 'calc' | 'payday' | 'manual';

export type WaterfallKind = 'start' | 'minus' | 'subtotal' | 'replace' | 'adjust' | 'total';

export interface WaterfallRow {
  key: string;
  label: string;
  amount: number;
  kind: WaterfallKind;
  note?: string;
}

export interface WaterfallInput {
  pay: number;
  payLabel: string;
  manualFixed: number;
  subscriptionsFixed: number;
  leisureBudget: number;
  projectSavings: number;
  theoreticalCapacity: number;
  source: AmountSource;
  /** Montant retenu (rappel de paie ou saisie) quand source ≠ 'calc'. */
  retained: number;
  externalSavings: number;
  totalToInvest: number;
}

/**
 * Lignes « D'où vient ce chiffre » : paie − charges − abonnements − budgets = capacité,
 * puis le montant retenu s'il remplace le calcul, la somme en plus, et le total à placer.
 * Les lignes à zéro sont omises, sauf la paie, les charges fixes et les totaux.
 */
export const buildWaterfall = (i: WaterfallInput): WaterfallRow[] => {
  const rows: WaterfallRow[] = [
    { key: 'pay', label: i.payLabel, amount: i.pay, kind: 'start' },
    { key: 'fixed', label: 'Charges fixes', amount: i.manualFixed, kind: 'minus' },
  ];
  if (i.subscriptionsFixed !== 0) rows.push({ key: 'subs', label: 'Abonnements mensuels', amount: i.subscriptionsFixed, kind: 'minus' });
  if (i.leisureBudget !== 0) rows.push({ key: 'leisure', label: 'Argent plaisir', amount: i.leisureBudget, kind: 'minus' });
  if (i.projectSavings !== 0) rows.push({ key: 'projects', label: 'Épargne projets', amount: i.projectSavings, kind: 'minus' });
  rows.push({ key: 'capacity', label: "Capacité d'épargne calculée", amount: i.theoreticalCapacity, kind: 'subtotal' });
  if (i.source !== 'calc') {
    rows.push({
      key: 'retained',
      label: i.source === 'payday' ? 'Montant fixé dans le rappel de paie' : 'Montant que vous avez saisi',
      amount: i.retained,
      kind: 'replace',
      note: 'Remplace la capacité calculée.',
    });
  }
  if (i.externalSavings !== 0) rows.push({ key: 'extra', label: 'Somme en plus ce mois-ci', amount: i.externalSavings, kind: 'adjust' });
  const base = (i.source === 'calc' ? i.theoreticalCapacity : i.retained) + i.externalSavings;
  rows.push({
    key: 'total',
    label: 'À placer ce mois',
    amount: i.totalToInvest,
    kind: 'total',
    note: base < 0 ? `Ramené à 0 € : il manque ${formatEUR(-base)}.` : undefined,
  });
  return rows;
};

export interface HeroContextInput {
  pay: number;
  source: AmountSource;
  theoreticalCapacity: number;
  externalSavings: number;
  totalToInvest: number;
  /** Capacité retenue avant la somme en plus (peut être négative). */
  finalCapacity: number;
}

/** La phrase sous le montant à placer : d'où il vient, en une phrase. */
export const heroContext = (i: HeroContextInput): string => {
  if (i.totalToInvest <= 0 && i.finalCapacity + i.externalSavings < 0) {
    return `Rien à placer ce mois-ci : vos dépenses prévues dépassent votre paie de ${formatEUR(-(i.finalCapacity + i.externalSavings), 0)}.`;
  }
  const base = i.source === 'payday'
    ? `Le montant fixé dans votre rappel de paie (le calcul donne ${formatEUR(i.theoreticalCapacity, 0)}).`
    : i.source === 'manual'
      ? `Le montant que vous avez saisi (le calcul donne ${formatEUR(i.theoreticalCapacity, 0)}).`
      : `Ce qui reste de votre paie de ${formatEUR(i.pay, 0)} une fois vos charges, abonnements et budgets réglés.`;
  return i.externalSavings !== 0 ? `${base} Somme en plus ce mois-ci comprise : ${formatSignedEUR(i.externalSavings, 0)}.` : base;
};

/** Pourquoi ce compte reçoit ce montant, en une phrase courte (le taux est affiché à part). */
export const placementReason = (step: PlacementStep, custom: boolean): string => {
  if (custom) {
    return step.isLiquid && step.isFullAfter
      ? "Selon votre répartition, jusqu'au plafond du livret"
      : 'Selon votre répartition personnalisée';
  }
  if (step.isLiquid) {
    return `Disponible à tout moment et sans impôt${step.isFullAfter ? " : rempli jusqu'au plafond" : ''}`;
  }
  return 'Vos livrets sont pleins : le reste va sur ce placement à plus long terme';
};
