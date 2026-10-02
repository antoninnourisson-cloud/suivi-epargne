// Paie : période de paie, virements à faire, liste à cocher.
// Partie de src/lib/finance.ts (qui réexporte tout) : importez depuis '../finance'.
import { Subscription, Expense, PayChecklistLine } from '../../types';
import { round2 } from '../money';
import { PlacementStep } from './placement';
import { subscriptionsAsExpenses } from './subscriptions';

// ---------------------------------------------------------------------------
// Répartition de la paie, virement par virement
// ---------------------------------------------------------------------------

export interface PayTransfer {
  key: string;     // stable : deux charges du même nom ne partagent plus une case
  label: string;
  amount: number;
}

/**
 * Ce qui part de la paie AVANT l'épargne, dans l'ordre des virements : chaque charge
 * saisie (ex. « Revolut commun »), les abonnements mensuels (avec leur compte s'ils
 * partent tous du même), l'épargne projets, puis l'argent plaisir qui reste sur le compte.
 * Ce qui reste est l'épargne, répartie par computePlacementStrategy.
 */
export const computePayTransfers = (input: {
  expenses: Expense[];
  subscriptions?: Subscription[];
  leisureBudget: number;
  projectSavings: number;
}): PayTransfer[] => {
  const out: PayTransfer[] = input.expenses
    .filter(e => e.amount > 0)
    .map(e => ({ key: `t:e:${e.id}`, label: e.name, amount: e.amount }));
  const subs = subscriptionsAsExpenses(input.subscriptions || []);
  const subsTotal = Math.round(subs.reduce((sum, e) => sum + e.amount, 0) * 100) / 100;
  if (subsTotal > 0) {
    const accounts = new Set(subs.map(e => e.paymentMethod || ''));
    const only = accounts.size === 1 ? [...accounts][0] : '';
    out.push({ key: 't:subscriptions', label: only ? `Abonnements (${only})` : 'Abonnements mensuels', amount: subsTotal });
  }
  if (input.projectSavings > 0) out.push({ key: 't:projects', label: 'Épargne projets', amount: input.projectSavings });
  if (input.leisureBudget > 0) out.push({ key: 't:leisure', label: 'Argent plaisir (reste sur le compte courant)', amount: input.leisureBudget });
  return out;
};

// ---------------------------------------------------------------------------
// Lignes de la liste des virements de paie (app et rappel serveur)
// ---------------------------------------------------------------------------

/** Virements sortants puis versements d'épargne, dans l'ordre de la liste à cocher. */
export const buildPayLines = (transfers: PayTransfer[], steps: PlacementStep[]): PayChecklistLine[] => [
  ...transfers.map(t => ({ key: t.key, label: t.label, amount: round2(t.amount), kind: 'transfer' as const })),
  ...steps.filter(st => !st.alert && st.accountId).map(st => ({
    key: `s:${st.accountId}`, label: st.accountName, amount: round2(st.fillAmount), kind: 'saving' as const,
    accountId: st.accountId,
    detail: `${st.type}${st.rate ? ` · ${st.rate.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} %` : ''}`,
  })),
];

// ---------------------------------------------------------------------------
// Période de paie
// ---------------------------------------------------------------------------

/** Jour de paie effectif d'un mois (le 31 devient le 30 ou le 28). */
export const effectivePayday = (paydayDay: number, year: number, month: number) =>
  Math.min(paydayDay, new Date(year, month + 1, 0).getDate());

/**
 * Mois de la paie en cours : avec une paie le 27, le 1er octobre on gère encore la paie
 * de septembre (versée le 27 septembre). Sans jour de paie connu : le mois calendaire.
 */
export const payPeriodOf = (paydayDay: number | undefined, asOfDate: Date = new Date()): { key: string; payDate: Date } => {
  let y = asOfDate.getFullYear(), m = asOfDate.getMonth();
  if (paydayDay && asOfDate.getDate() < effectivePayday(paydayDay, y, m)) {
    m -= 1;
    if (m < 0) { m = 11; y -= 1; }
  }
  const payDate = new Date(y, m, paydayDay ? effectivePayday(paydayDay, y, m) : 1);
  return { key: `${y}-${String(m + 1).padStart(2, '0')}`, payDate };
};
