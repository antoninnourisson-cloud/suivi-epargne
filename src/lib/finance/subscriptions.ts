// Abonnements : coût mensuel, prochain prélèvement, rappels.
// Partie de src/lib/finance.ts (qui réexporte tout) : importez depuis '../finance'.
import { Subscription, Expense } from '../../types';
import { formatISODay, parseISODate, daysBetween } from '../dates';
import { round2 } from '../money';
import { depositsAfterWithdrawal } from './capitalTax';

// ---------------------------------------------------------------------------
// Abonnements
// ---------------------------------------------------------------------------

const FREQUENCY_MONTHS: Record<Exclude<Subscription['frequency'], 'weekly'>, number> = {
  monthly: 1, quarterly: 3, semiannual: 6, yearly: 12,
};

/** Coût mensuel équivalent d'un abonnement. */
export const subscriptionMonthlyCost = (s: Pick<Subscription, 'amount' | 'frequency'>): number =>
  s.frequency === 'weekly' ? s.amount * 52 / 12 : s.amount / FREQUENCY_MONTHS[s.frequency];

/**
 * Prochain prélèvement à partir de `from` (inclus), déduit d'une date de prélèvement
 * connue. Mensuel le 31 → dernier jour des mois plus courts, sans dériver ensuite.
 */
export const nextSubscriptionDate = (s: Pick<Subscription, 'frequency' | 'anchorDate'>, from: Date = new Date()): Date => {
  const anchor = parseISODate(s.anchorDate);
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  if (anchor >= start) return anchor;
  if (s.frequency === 'weekly') {
    const weeks = Math.ceil(daysBetween(anchor, start) / 7);
    return new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + weeks * 7);
  }
  const step = FREQUENCY_MONTHS[s.frequency];
  const monthsApart = (start.getFullYear() - anchor.getFullYear()) * 12 + start.getMonth() - anchor.getMonth();
  for (let k = Math.max(0, Math.floor(monthsApart / step)); ; k++) {
    const y = anchor.getFullYear(), m = anchor.getMonth() + k * step;
    const lastDay = new Date(y, m + 1, 0).getDate();
    const d = new Date(y, m, Math.min(anchor.getDate(), lastDay));
    if (d >= start) return d;
  }
};

/** Seuil à partir duquel on prévient une semaine avant, au lieu de la veille. */
export const SUBSCRIPTION_BIG_AMOUNT = 100;
export const subscriptionLeadDays = (amount: number) => amount >= SUBSCRIPTION_BIG_AMOUNT ? 7 : 1;

export interface DueSubscription {
  subscription: Subscription;
  dueDate: string;   // 'YYYY-MM-DD'
  daysUntil: number; // 1..leadDays
}

/**
 * Abonnements à annoncer aujourd'hui : prélèvement dans 1 à 7 jours pour les montants
 * d'au moins 100 €, uniquement la veille sinon.
 */
export const findDueSubscriptions = (subs: Subscription[], asOfDate: Date = new Date()): DueSubscription[] => {
  const today = new Date(asOfDate.getFullYear(), asOfDate.getMonth(), asOfDate.getDate());
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  return subs
    .filter(s => s.active && s.amount > 0 && s.anchorDate)
    .flatMap(s => {
      const next = nextSubscriptionDate(s, tomorrow);
      const daysUntil = Math.round(daysBetween(today, next));
      return daysUntil >= 1 && daysUntil <= subscriptionLeadDays(s.amount)
        ? [{ subscription: s, dueDate: formatISODay(next), daysUntil }]
        : [];
    });
};

/**
 * Versements cumulés après un mouvement d'argent réel (versement si `flowAmount` > 0,
 * retrait sinon). Inchangés (undefined) si le compte ne les suit pas.
 */
export const depositsAfterCashFlow = (
  account: { totalDeposits?: number; totalAmount: number },
  flowAmount: number
): number | undefined => {
  if (account.totalDeposits === undefined) return undefined;
  const next = flowAmount >= 0
    ? account.totalDeposits + flowAmount
    : depositsAfterWithdrawal(account.totalDeposits, account.totalAmount, -flowAmount);
  return round2(next);
};

/** Seuls ces abonnements reviennent chaque mois : les autres ne font que déclencher un rappel. */
export const isMonthlyCharge = (s: Pick<Subscription, 'frequency'>) =>
  s.frequency === 'monthly' || s.frequency === 'weekly';

/**
 * Abonnements mensuels (et hebdomadaires, ramenés au mois) vus comme des charges fixes.
 * Les trimestriels, semestriels et annuels n'y figurent PAS : ils sont payés quand ils
 * tombent, l'app se contente de prévenir avant. Identifiants préfixés `sub:` : jamais
 * confondus avec une charge saisie.
 */
export const subscriptionsAsExpenses = (subs: Subscription[]): Expense[] =>
  subs
    .filter(s => s.active && s.amount > 0 && isMonthlyCharge(s))
    .map(s => ({
      id: `sub:${s.id}`,
      name: s.name,
      amount: Math.round(subscriptionMonthlyCost(s) * 100) / 100,
      paymentMethod: s.debitAccount || undefined,
    }));

/** Charges fixes mensuelles : charges saisies + abonnements actifs. */
export const totalFixedCharges = (expenses: Expense[], subs: Subscription[] = []): number =>
  expenses.reduce((sum, e) => sum + e.amount, 0) +
  subscriptionsAsExpenses(subs).reduce((sum, e) => sum + e.amount, 0);
