// Solde d'un avis d'imposition (reste à payer ou remboursement) : la phrase affichée dans le
// panneau « Avis d'imposition ». Uniquement ce qui est écrit sur l'avis : aucune règle
// d'échelonnement ni de date n'est déduite par Pécule.
import type { TaxNoticeBalance } from '../types';
import { formatEUR, frenchDay } from './format';
import { parseISODate } from './dates';

/** « Reste à payer : 320 €, prélevé le 15 décembre 2026 » ou « Remboursement : 150 €, versé vers le … ». */
export const taxBalanceSentence = (b: TaxNoticeBalance): string => {
  const when = b.date ? parseISODate(b.date) : null;
  const day = when ? `${frenchDay(when)} ${when.getFullYear()}` : '';
  const amount = formatEUR(b.amount, b.amount % 1 === 0 ? 0 : 2);
  return b.kind === 'due'
    ? `Reste à payer : ${amount}${day ? `, prélevé le ${day}` : ''}`
    : `Remboursement : ${amount}${day ? `, versé vers le ${day}` : ''}`;
};

/** Solde d'un avis enregistré pour une année de revenus ; un avis sans solde retire l'ancien. */
export const withTaxNoticeBalance = (
  balances: Record<string, TaxNoticeBalance> | undefined, incomeYear: number, balance: TaxNoticeBalance | undefined,
): Record<string, TaxNoticeBalance> | undefined => {
  const next = { ...(balances ?? {}) };
  if (balance) next[String(incomeYear)] = balance; else delete next[String(incomeYear)];
  return Object.keys(next).length > 0 ? next : undefined;
};
