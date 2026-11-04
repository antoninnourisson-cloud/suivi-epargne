// Mise en forme de l'écran Pilotage : barre de la paie, lignes de « Comment c'est calculé »
// et phrases, construites à partir du résultat de la règle de la paie (lib/payDistribution,
// allocatePay) : aucun nouveau calcul financier ici.
import type { PlacementStep } from './finance';
import type { PayAllocation } from './payDistribution';
import { AccountType } from '../types';
import { formatEUR } from './format';

// ---------------------------------------------------------------------------
// La barre de la paie : quatre parts, dans l'ordre des priorités
// ---------------------------------------------------------------------------

export type PayBarKey = 'fixed' | 'savings' | 'projects' | 'leisure';

export interface PayBarPart {
  key: PayBarKey;
  label: string;
  /** Montant de la part (le plaisir n'est jamais négatif sur la barre). */
  amount: number;
  /** Montant prévu, quand la part a été coupée. */
  planned?: number;
}

export interface PayBar {
  parts: PayBarPart[];
  /** Argent réparti : paie reçue + reste du compte courant. */
  total: number;
  /** > 0 : il manque cette somme pour les virements fixes (le plaisir vaut alors 0 sur la barre). */
  missingFixed: number;
  /** Texte complet de la barre (role="img"). */
  label: string;
}

/**
 * Parts de la barre : virements fixes, épargne, épargne projets (si prévue), plaisir. Un
 * versement en plus n'a que l'épargne (et ce qui reste éventuellement sur le compte courant).
 */
export const payBarParts = (a: PayAllocation): PayBar => {
  const cutOf = (amount: number, planned: number) => (planned - amount >= 0.005 ? { planned } : {});
  const parts: PayBarPart[] = a.kind === 'extra'
    ? [
        { key: 'savings', label: 'Épargne', amount: a.savings },
        ...(a.leisure > 0 ? [{ key: 'leisure' as const, label: 'Reste sur le compte courant', amount: a.leisure }] : []),
      ]
    : [
        { key: 'fixed', label: 'Virements fixes', amount: a.fixed },
        { key: 'savings', label: 'Épargne', amount: a.savings, ...cutOf(a.savings - a.surplus, a.target + a.bonus) },
        ...(a.plannedProjects > 0 ? [{ key: 'projects' as const, label: 'Épargne projets', amount: a.projects, ...cutOf(a.projects, a.plannedProjects) }] : []),
        { key: 'leisure', label: 'Plaisir', amount: Math.max(0, a.leisure), ...cutOf(Math.max(0, a.leisure), a.plannedLeisure) },
      ];
  return { parts, total: a.available, missingFixed: a.missingFixed, label: barLabel(parts, a.available, a.missingFixed) };
};

const barLabel = (parts: PayBarPart[], total: number, missingFixed: number): string => {
  const described = parts.map(p => `${p.label.toLowerCase()} ${formatEUR(p.amount)}${p.planned !== undefined ? ` (prévu ${formatEUR(p.planned)})` : ''}`);
  return `Répartition de ${formatEUR(total)} : ${described.join(', ')}.`
    + (missingFixed > 0 ? ` Il manque ${formatEUR(missingFixed)} pour les virements fixes.` : '');
};

/**
 * La barre du rituel pendant qu'on modifie les montants : chaque part prend son montant saisi
 * (le plaisir, ligne d'équilibre, ce qui reste ; négatif, il manque pour les virements fixes).
 * Une part sous son objectif (le prévu de la règle, sinon le conseil) le montre « (prévu …) ».
 */
export const livePayBar = (advised: PayBar, amounts: Partial<Record<PayBarKey, number>>): PayBar => {
  const leisure = amounts.leisure;
  const missingFixed = leisure !== undefined && leisure < 0 ? Math.round(-leisure * 100) / 100 : 0;
  const parts = advised.parts.map(p => {
    const v = amounts[p.key];
    if (v === undefined) return p;
    const amount = Math.max(0, Math.round(v * 100) / 100);
    const target = p.planned ?? p.amount;
    const { planned: _p, ...rest } = p;
    return { ...rest, amount, ...(target - amount >= 0.005 ? { planned: target } : {}) };
  });
  // Versement en plus dont une partie reste sur le compte courant.
  if (leisure !== undefined && leisure >= 0.005 && !parts.some(p => p.key === 'leisure')) {
    parts.push({ key: 'leisure', label: 'Reste sur le compte courant', amount: Math.round(leisure * 100) / 100 });
  }
  return { parts, total: advised.total, missingFixed, label: barLabel(parts, advised.total, missingFixed) };
};

// ---------------------------------------------------------------------------
// « Comment c'est calculé »
// ---------------------------------------------------------------------------

export type WaterfallKind = 'start' | 'minus' | 'subtotal' | 'replace' | 'adjust' | 'total';

export interface WaterfallRow {
  key: string;
  label: string;
  amount: number;
  kind: WaterfallKind;
  note?: string;
}

const EPS = 0.005;

/**
 * Lignes de « Comment c'est calculé » : paie habituelle − virements fixes − épargne projets
 * − solde de départ du mois = épargne visée (ou le montant fixe qui la remplace), puis, pour
 * une paie déclarée ou un mois qui s'écarte du plan, ce qui la fait bouger (reste du mois
 * dernier, prime, écart de paie) et l'épargne de cette paie. Les lignes à zéro sont omises,
 * sauf la paie, les virements fixes et l'épargne visée.
 */
export const howItsComputed = (a: PayAllocation, payLabel = 'Paie habituelle'): WaterfallRow[] => {
  if (a.kind === 'extra') {
    return [
      { key: 'received', label: 'Versement en plus', amount: a.received, kind: 'start', note: "Rien à virer : tout va à l'épargne." },
      { key: 'total', label: 'Épargne de ce versement', amount: a.savings, kind: 'total' },
    ];
  }
  const rows: WaterfallRow[] = [
    { key: 'pay', label: payLabel, amount: a.expectedPay, kind: 'start' },
    { key: 'fixed', label: 'Virements fixes', amount: a.fixed, kind: 'minus', note: 'Charges, commun et abonnements.' },
  ];
  if (a.plannedProjects !== 0) rows.push({ key: 'projects', label: 'Épargne projets', amount: a.plannedProjects, kind: 'minus' });
  if (a.startBalance !== 0) rows.push({ key: 'start', label: 'Solde de départ du mois', amount: a.startBalance, kind: 'minus' });
  rows.push({
    key: 'target', label: 'Épargne visée', amount: Math.max(0, a.computedTarget), kind: 'subtotal',
    note: a.computedTarget < 0 ? `Ramenée à 0 € : il manque ${formatEUR(-a.computedTarget)}.` : undefined,
  });
  if (a.fixedSavings !== undefined) {
    rows.push({ key: 'fixedSavings', label: 'Épargne visée : montant fixe', amount: a.fixedSavings, kind: 'replace', note: `Remplace le calcul (${formatEUR(Math.max(0, a.computedTarget))}).` });
  }
  const declared = Math.abs(a.received - a.expectedPay) >= EPS || a.before !== 0 || a.bonus !== 0;
  if (!declared && Math.abs(a.savings - a.target) < EPS) return rows;
  if (a.before !== 0) rows.push({ key: 'before', label: a.before > 0 ? 'Reste du mois dernier' : 'Découvert avant la paie', amount: a.before, kind: 'adjust' });
  if (a.bonus !== 0) rows.push({ key: 'bonus', label: 'Prime', amount: a.bonus, kind: 'adjust', note: a.cuts.bonus > 0 ? undefined : 'Placée en entier.' });
  if (Math.abs(a.gap) >= EPS) rows.push({ key: 'gap', label: 'Écart de paie', amount: a.gap, kind: 'adjust' });
  // Ce que le plaisir (puis les projets) absorbe ou rend : les lignes tombent juste.
  const base = a.fixedSavings ?? Math.max(0, a.computedTarget);
  const balance = Math.round((a.savings - base - a.before - a.bonus - a.gap) * 100) / 100;
  if (Math.abs(balance) >= EPS) {
    rows.push(a.missingFixed > 0
      ? { key: 'leisure', label: 'Plaisir et projets à zéro', amount: balance, kind: 'adjust', note: `Il manque ${formatEUR(a.missingFixed)} pour les virements fixes.` }
      : { key: 'leisure', label: balance > 0 ? (a.cuts.projects > 0 ? 'Pris sur le plaisir et les projets' : 'Pris sur le plaisir') : 'Laissé au plaisir', amount: balance, kind: 'adjust' });
  }
  rows.push({ key: 'total', label: declared ? 'Épargne de cette paie' : 'Épargne de la paie', amount: a.savings, kind: 'total' });
  return rows;
};

/** La règle des coupes, dite une fois sous « Comment c'est calculé » (le minimum en euros). */
export const payRuleSentence = (a: Pick<PayAllocation, 'floor'>): string =>
  `Si la paie ne suffit pas, le plaisir baisse d'abord, jamais sous les 2/3 du solde de départ du mois (${formatEUR(a.floor)}), puis l'épargne projets, puis l'épargne. Les virements fixes ne bougent jamais, et une prime est placée en entier. Ce qui dépasse va à l'épargne.`;

/** D'où vient l'épargne du plan habituel, en une phrase. */
export const planSentence = (a: PayAllocation): string => {
  if (a.fixedSavings !== undefined) return `Votre montant fixe d'épargne (le calcul donne ${formatEUR(Math.max(0, a.computedTarget), 0)}).`;
  if (a.savings <= 0 && a.computedTarget < 0) {
    return `Rien à placer ce mois-ci : vos virements fixes, l'épargne projets et le solde de départ du mois dépassent votre paie de ${formatEUR(-a.computedTarget, 0)}.`;
  }
  return `Ce qui reste de votre paie de ${formatEUR(a.expectedPay, 0)} une fois les virements fixes, l'épargne projets et le solde de départ du mois (${formatEUR(a.startBalance, 0)}) mis de côté.`;
};

// ---------------------------------------------------------------------------
// Comptes d'épargne
// ---------------------------------------------------------------------------

/** Pourquoi ce compte reçoit ce montant, en une phrase courte (le taux est affiché à part). */
export const placementReason = (step: PlacementStep, custom: boolean): string => {
  if (custom) {
    return step.isLiquid && step.isFullAfter
      ? "Selon votre répartition, jusqu'au plafond du livret"
      : 'Selon votre répartition personnalisée';
  }
  if (step.isLiquid && (step.type === AccountType.CEL || step.type === AccountType.LIVRET_BANCAIRE)) {
    return `Vos livrets réglementés sont pleins : disponible à tout moment, intérêts imposés${step.isFullAfter ? " ; rempli jusqu'au plafond" : ''}`;
  }
  if (step.isLiquid) {
    return `Disponible à tout moment et sans impôt${step.isFullAfter ? " : rempli jusqu'au plafond" : ''}`;
  }
  return 'Vos livrets sont pleins : le reste va sur ce placement à plus long terme';
};
