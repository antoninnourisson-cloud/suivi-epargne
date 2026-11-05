// Courbe d'épargne de « Plus de détails », projection et dérive du rythme.
// (Extrait de home.ts, code déplacé tel quel ; home.ts le ré-exporte.)
import { type SavingsAccount } from '../types';
import { computeAccountBalanceAtDate, computeRecentSavingsRate } from './finance';
import { MS_PER_DAY, daysBetween, formatISODay, parseISODate } from './dates';
import { round2, signedAmount } from './money';

// ---------------------------------------------------------------------------
// Courbe d'épargne (section « Plus de détails »)
// ---------------------------------------------------------------------------

export type StackedPoint = { date: string; displayDate: string; total?: number; [accountId: string]: string | number | undefined };
export interface DateRange { start: string; end: string }

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
/** Période lue sur l'appareil : deux dates AAAA-MM-JJ (une valeur abîmée cassait le graphique). */
export const isDateRange = (v: unknown): v is DateRange =>
  !!v && typeof v === 'object' && typeof (v as DateRange).start === 'string' && typeof (v as DateRange).end === 'string'
  && ISO_DAY.test((v as DateRange).start) && ISO_DAY.test((v as DateRange).end);

/**
 * Ce qui empêche d'utiliser la période saisie : une date effacée (« missing ») ou une date de
 * début après la date de fin (« reversed ») ; null si elle est utilisable. Les deux cas ont
 * chacun leur message : dire « inversée » quand une date manque envoyait chercher ailleurs.
 */
export const dateRangeProblem = (range: DateRange): 'missing' | 'reversed' | null => {
  if (!isDateRange(range)) return 'missing';
  return range.start <= range.end ? null : 'reversed';
};

/**
 * Six derniers mois, en heure locale. Le jour est borné au dernier jour du mois visé
 * (`setMonth(-6)` un 31 débordait : 31 février → 3 mars).
 */
export const defaultDateRange = (now: Date): DateRange => {
  const lastDay = new Date(now.getFullYear(), now.getMonth() - 5, 0).getDate();
  const start = new Date(now.getFullYear(), now.getMonth() - 6, Math.min(now.getDate(), lastDay));
  return { start: formatISODay(start), end: formatISODay(now) };
};

/** Au-delà, la plage est raccourcie : la boucle est journalière (environ cinq ans). */
export const MAX_SERIES_DAYS = 1830;
// Créé une fois : toLocaleDateString en recréait un à chaque jour de la boucle (33 fois plus lent).
const DAY_LABEL = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short' });

/**
 * Votre part, compte par compte, jour par jour sur la période (un point par semaine au-delà
 * de 4 mois, toutes les deux semaines au-delà de 2 ans ; le dernier jour est toujours gardé ;
 * `thin: false` garde tous les jours, pour l'export).
 * On part des soldes actuels corrigés des mouvements postérieurs à la fin, puis on remonte le
 * temps en retirant les mouvements de chaque jour. Dates en minuit LOCAL (parseISODate) :
 * le mélange UTC/local sautait le jour du passage à l'heure d'hiver.
 */
export const buildStackedSeries = (accounts: SavingsAccount[], range: DateRange, opts: { thin?: boolean } = {}): StackedPoint[] => {
  const endDate = parseISODate(range.end);
  const startDate = parseISODate(range.start);
  if (Number.isNaN(endDate.getTime()) || Number.isNaN(startDate.getTime()) || endDate < startDate) return [];
  const effectiveStart = daysBetween(startDate, endDate) > MAX_SERIES_DAYS
    ? new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate() - MAX_SERIES_DAYS)
    : startDate;

  // Départ : soldes à la date de fin, et flux par compte et par jour (index, pas de re-filtrage).
  const balances = new Map<string, number>();
  const flows = new Map<string, Map<string, number>>();
  for (const acc of accounts) {
    let atEnd = acc.ownedAmount;
    const byDate = new Map<string, number>();
    for (const m of acc.movements) {
      if (m.kind === 'parental') continue; // part des parents : hors de « mon épargne »
      const flow = signedAmount(m);
      if (m.date > range.end) atEnd -= flow;
      else byDate.set(m.date, (byDate.get(m.date) || 0) + flow);
    }
    flows.set(acc.id, byDate);
    balances.set(acc.id, atEnd);
  }

  const data: StackedPoint[] = [];
  for (let d = new Date(endDate); d >= effectiveStart; d.setDate(d.getDate() - 1)) {
    const date = formatISODay(d);
    const point: StackedPoint = { date, displayDate: DAY_LABEL.format(d) };
    let total = 0;
    balances.forEach((amount, id) => { const v = round2(amount); point[id] = v; total += v; });
    point.total = round2(total);
    data.push(point);
    for (const acc of accounts) {
      const flow = flows.get(acc.id)?.get(date);
      if (flow) balances.set(acc.id, (balances.get(acc.id) || 0) - flow);
    }
  }
  data.reverse();
  if (opts.thin !== false && data.length > 120) {
    const step = data.length > 730 ? 14 : 7;
    return data.filter((_, i) => i % step === 0 || i === data.length - 1);
  }
  return data;
};

// ---------------------------------------------------------------------------
// Projection et rythme d'épargne
// ---------------------------------------------------------------------------

export interface SavingsProjection {
  monthlyRate: number;
  totalNow: number;
  in6: number;
  in12: number;
  /** Changement de rythme par rapport au trimestre précédent (au moins 25 %), sinon null. */
  drift: { previousMonthlyRate: number; changeRatio: number } | null;
}

/**
 * Extrapole ce qui a été placé ces 90 derniers jours (versements − retraits, comme « Placé » :
 * hors intérêts, corrections et variations de valeur ; indépendant de la période du graphique).
 * null sans historique suffisant ou à rythme quasi nul. La dérive compare au trimestre
 * précédent (jours −180 à −90), seulement si ce rythme-là n'était pas quasi nul.
 */
export const savingsProjection = (accounts: SavingsAccount[], now: Date): SavingsProjection | null => {
  const monthlyRate = computeRecentSavingsRate(accounts, 90, now);
  if (monthlyRate === null || Math.abs(monthlyRate) < 1) return null;
  const totalNow = computeAccountBalanceAtDate(accounts, formatISODay(now));
  const previousMonthlyRate = computeRecentSavingsRate(accounts, 90, new Date(now.getTime() - 90 * MS_PER_DAY));
  let drift: SavingsProjection['drift'] = null;
  if (previousMonthlyRate !== null && Math.abs(previousMonthlyRate) >= 20) {
    const changeRatio = (monthlyRate - previousMonthlyRate) / Math.abs(previousMonthlyRate);
    if (Math.abs(changeRatio) >= 0.25) drift = { previousMonthlyRate, changeRatio };
  }
  return { monthlyRate, totalNow, in6: totalNow + monthlyRate * 6, in12: totalNow + monthlyRate * 12, drift };
};

