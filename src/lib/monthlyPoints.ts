// Points mensuels de l'historique (patrimoine, charges fixes) : un seul point par mois,
// daté du jour où il a été créé, mis à jour tant que le mois est en cours.

import type { ExpenseSnapshot, PortfolioSnapshot, SavingsAccount } from '../types';
import { round2 } from './money';

/**
 * Totaux du patrimoine pour le point du mois, au centime : une somme de flottants gardait du
 * bruit (1234,56 + 100,1 = 1334,6599999999999) jusque dans le fichier Drive.
 */
export const portfolioTotals = (accounts: Pick<SavingsAccount, 'totalAmount' | 'ownedAmount'>[]): { totalAmount: number; ownedAmount: number } => ({
  totalAmount: round2(accounts.reduce((s, a) => s + a.totalAmount, 0)),
  ownedAmount: round2(accounts.reduce((s, a) => s + a.ownedAmount, 0)),
});

const byDate = <T extends { date: string }>(a: T, b: T) => a.date.localeCompare(b.date);

/**
 * Historique du patrimoine avec le point du mois `month` ('YYYY-MM') à jour, ou null si le
 * point existe déjà avec ces montants (rien à changer). Un nouveau point est daté `today`.
 */
export const withPortfolioPoint = (
  history: PortfolioSnapshot[] | undefined, totals: { totalAmount: number; ownedAmount: number }, month: string, today: string,
): PortfolioSnapshot[] | null => {
  const prev = history || [];
  const existing = prev.find(s => s.date.startsWith(month));
  if (existing && existing.totalAmount === totals.totalAmount && existing.ownedAmount === totals.ownedAmount) return null;
  const others = prev.filter(s => !s.date.startsWith(month));
  const snapshot: PortfolioSnapshot = { date: existing ? existing.date : today, totalAmount: totals.totalAmount, ownedAmount: totals.ownedAmount };
  return [...others, snapshot].sort(byDate);
};

/** Même chose pour le total des charges fixes du mois. */
export const withExpensePoint = (
  history: ExpenseSnapshot[] | undefined, total: number, month: string, today: string,
): ExpenseSnapshot[] | null => {
  const prev = history || [];
  const existing = prev.find(s => s.date.startsWith(month));
  if (existing && existing.total === total) return null;
  const others = prev.filter(s => !s.date.startsWith(month));
  return [...others, { date: existing ? existing.date : today, total }].sort(byDate);
};
