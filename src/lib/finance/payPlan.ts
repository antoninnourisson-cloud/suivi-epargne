// Paie : période de paie, virements à faire, liste à cocher.
// Partie de src/lib/finance.ts (qui réexporte tout) : importez depuis '../finance'.
import { Subscription, Expense, PayChecklistLine } from '../../types';
import { round2 } from '../money';
import { PlacementStep } from './placement';
import { subscriptionsAsExpenses } from './subscriptions';
import { currentSavingsMonth, PayCalendarData } from '../payCalendar';
import { formatISODay, parseISODate } from '../dates';

// ---------------------------------------------------------------------------
// Répartition de la paie, virement par virement
// ---------------------------------------------------------------------------

export interface PayTransfer {
  key: string;     // stable : deux charges du même nom ne partagent plus une case
  label: string;
  amount: number;
}

/**
 * Virements de la paie hors épargne : chaque charge saisie (ex. « Revolut commun »), les
 * abonnements mensuels (avec leur compte s'ils partent tous du même), l'épargne projets,
 * puis l'argent plaisir qui reste sur le compte courant. Les montants de l'épargne projets
 * et du plaisir sont ceux de la règle de la paie (lib/payDistribution, allocatePay) : le
 * plaisir est ce qui reste réellement sur le compte, pas le solde de départ du mois.
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
  if (input.leisureBudget > 0) out.push({ key: PAY_LEISURE_LINE, label: 'Argent plaisir (reste sur le compte courant)', amount: input.leisureBudget });
  return out;
};

// ---------------------------------------------------------------------------
// Lignes de la liste des virements de paie (app et rappel serveur)
// ---------------------------------------------------------------------------

/** Ligne du plaisir : ce qui reste sur le compte courant, rien à virer ni à cocher. */
export const PAY_LEISURE_LINE = 't:leisure';

/**
 * Ligne à faire (et à cocher) : toutes sauf le plaisir. Seules ces lignes comptent dans
 * « 3/7 faits », la pastille de l'icône, la routine du mois et la relance du serveur.
 */
export const isPayTodoLine = (l: { key: string }): boolean => l.key !== PAY_LEISURE_LINE;

const isFixedTransfer = (t: PayTransfer) => t.key !== 't:projects' && t.key !== PAY_LEISURE_LINE;
const transferLine = (t: PayTransfer): PayChecklistLine => ({ key: t.key, label: t.label, amount: round2(t.amount), kind: 'transfer' });

/**
 * Lignes dans l'ordre des virements : virements fixes, épargne par compte, épargne projets,
 * puis le plaisir (ce qui reste sur le compte courant).
 */
export const buildPayLines = (transfers: PayTransfer[], steps: PlacementStep[]): PayChecklistLine[] => [
  ...transfers.filter(isFixedTransfer).map(transferLine),
  ...steps.filter(st => !st.alert && st.accountId).map(st => ({
    key: `s:${st.accountId}`, label: st.accountName, amount: round2(st.fillAmount), kind: 'saving' as const,
    accountId: st.accountId,
    detail: `${st.type}${st.rate ? ` · ${st.rate.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} %` : ''}`,
  })),
  ...transfers.filter(t => t.key === 't:projects').map(transferLine),
  ...transfers.filter(t => t.key === PAY_LEISURE_LINE).map(transferLine),
];

// ---------------------------------------------------------------------------
// Période de paie
// ---------------------------------------------------------------------------

export { effectivePayday } from '../payCalendar';

/**
 * Paie en cours, d'après la règle unique de lib/payCalendar (façade, en attendant que chaque
 * écran lise directement le mois d'épargne) : avec une paie le 27, le 1er octobre on gère
 * encore la paie de septembre, versée le 27 septembre, qui finance l'épargne d'octobre.
 *  - `key` : mois de VERSEMENT de la paie ('2026-09'), clé historique des écrans et des
 *    rappels ; `savingsMonth` : mois d'épargne qu'elle finance ('2026-10') ;
 *  - `payDate` : début de la fenêtre (paie déclarée, fiche de paie, jour de paie ou 1er).
 * Sans `cal` (fiches, paies déclarées), seul le jour de paie compte ; sans jour de paie
 * connu, le mois calendaire.
 */
export const payPeriodOf = (
  paydayDay: number | undefined,
  asOfDate: Date = new Date(),
  cal: Omit<PayCalendarData, 'paydayDay'> = {},
): { key: string; savingsMonth: string; payDate: Date } => {
  const w = currentSavingsMonth({ ...cal, paydayDay }, formatISODay(asOfDate));
  return { key: w.payMonth, savingsMonth: w.key, payDate: parseISODate(w.start) };
};
