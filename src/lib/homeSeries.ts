// Séries de l'accueil (fonctions pures) : la petite courbe des derniers mois sous
// « Mon épargne nette » et la variation sur 30 jours.
//
// La courbe préfère le point mensuel de l'historique (valeur réellement constatée, votre
// part) ; tant que l'historique compte moins de trois mois, elle est reconstituée à partir
// des mouvements (`balanceAt`, même convention que le graphique d'évolution), sinon un
// nouvel utilisateur ne verrait aucune tendance pendant des mois.
import type { PortfolioSnapshot } from '../types';
import { parseISODate, formatISODay } from './dates';
import { round2 } from './money';

const monthOf = (iso: string) => iso.slice(0, 7);

/** Mois `YYYY-MM` décalé de `delta` mois. */
export const shiftMonth = (month: string, delta: number): string => {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

/** Valeur d'un point d'historique : votre part si connue, sinon le total. */
const snapshotValue = (s: PortfolioSnapshot): number =>
  typeof s.ownedAmount === 'number' && Number.isFinite(s.ownedAmount) ? s.ownedAmount : s.totalAmount;

/**
 * Dernier point connu de chacun des `months - 1` mois précédents (les mois sans point
 * sont sautés), puis `current` pour le mois en cours (la valeur du jour fait foi).
 */
export const historySeries = (history: PortfolioSnapshot[], current: number, today: string, months = 12): number[] => {
  const thisMonth = monthOf(today);
  const first = shiftMonth(thisMonth, -(months - 1));
  const byMonth = new Map<string, PortfolioSnapshot>();
  for (const s of history) {
    const k = monthOf(s.date);
    if (k < first || k >= thisMonth) continue;
    const prev = byMonth.get(k);
    if (!prev || s.date >= prev.date) byMonth.set(k, s);
  }
  const past = [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, s]) => snapshotValue(s));
  return [...past, current];
};

/** Dernier jour de chacun des `months - 1` mois précédents, puis `today`. */
export const monthEndDates = (today: string, months = 12): string[] => {
  const t = parseISODate(today);
  const dates: string[] = [];
  for (let i = months - 1; i >= 1; i--) dates.push(formatISODay(new Date(t.getFullYear(), t.getMonth() - i + 1, 0)));
  dates.push(today);
  return dates;
};

/**
 * Points de la courbe de l'accueil : l'historique s'il couvre au moins trois mois, sinon
 * la reconstitution par les mouvements (`balanceAt(dateISO)` = votre part à cette date).
 */
export const homeSparkline = (opts: {
  history: PortfolioSnapshot[];
  current: number;
  today: string;
  balanceAt: (iso: string) => number;
  months?: number;
}): number[] => {
  const { history, current, today, balanceAt, months = 12 } = opts;
  const fromHistory = historySeries(history, current, today, months);
  if (fromHistory.length >= 3) return fromHistory;
  return [...monthEndDates(today, months).slice(0, -1).map(balanceAt), current];
};

/** Date ISO `days` jours avant `today` (calendrier local). */
export const isoDaysBefore = (today: string, days: number): string => {
  const t = parseISODate(today);
  return formatISODay(new Date(t.getFullYear(), t.getMonth(), t.getDate() - days));
};

/** Variation de votre part sur `days` jours (30 par défaut), arrondie au centime. */
export const deltaOverDays = (current: number, balanceAt: (iso: string) => number, today: string, days = 30): number =>
  round2(current - balanceAt(isoDaysBefore(today, days)));

/**
 * Parts de la barre de disponibilité, en pourcentage (montants négatifs comptés pour 0).
 * La somme fait 100 dès qu'un montant est positif.
 */
export const availabilityShares = (amounts: number[]): number[] => {
  const pos = amounts.map(a => Math.max(0, a));
  const total = pos.reduce((s, a) => s + a, 0);
  return pos.map(a => (total > 0 ? (a / total) * 100 : 0));
};
