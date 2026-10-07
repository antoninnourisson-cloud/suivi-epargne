// Aides pures pour les graphiques : graduations en euros, phrases de synthèse lues par
// tous (et par les lecteurs d'écran), échantillonnage des tableaux de données.
import { formatEUR, formatSignedEUR } from './format';
import { parseISODate } from './dates';

const K_FMT = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });

/**
 * Graduation d'axe en euros : « 1 200 € », ou « 12,5 k€ » dès que l'échelle atteint
 * 10 000 € (les libellés longs mangeaient la largeur du graphique sur mobile).
 */
export const formatAxisEUR = (value: number, scaleMax: number): string =>
  Math.abs(scaleMax) >= 10_000 ? `${K_FMT.format(value / 1000)} k€` : formatEUR(value, 0);

/** Plus grande valeur absolue d'une série de points, pour choisir le format des graduations. */
export const maxAbs = (values: number[]): number => values.reduce((m, v) => (Number.isFinite(v) ? Math.max(m, Math.abs(v)) : m), 0);

/** Durée lisible entre deux dates ISO : « 12 jours », « 1 mois », « 14 mois » ; '' si une date est illisible. */
export const durationLabel = (startISO: string, endISO: string): string => {
  const days = Math.max(0, Math.round((parseISODate(endISO).getTime() - parseISODate(startISO).getTime()) / 86_400_000));
  if (!Number.isFinite(days)) return '';
  if (days < 45) return `${days} jour${days > 1 ? 's' : ''}`;
  const months = Math.round(days / 30.4375);
  return `${months} mois`;
};

/** Accord du sujet : féminin, masculin, féminin pluriel. */
export type Agreement = 'f' | 'm' | 'fp';
const VERBS: Record<Agreement, [string, string]> = {
  f: ['est passée', 'est restée'], m: ['est passé', 'est resté'], fp: ['sont passées', 'sont restées'],
};

/**
 * Phrase de synthèse d'une évolution : « Votre épargne est passée de 18 000 € à 24 400 €
 * en 6 mois (+6 400 €). » Sans variation : « … est restée à 18 000 € … ».
 */
export const describeEvolution = (subject: string, from: number, to: number, startISO: string, endISO: string, agreement: Agreement = 'f'): string => {
  const span = durationLabel(startISO, endISO) ? ` en ${durationLabel(startISO, endISO)}` : '';
  const delta = Math.round(to) - Math.round(from);
  const [moved, stayed] = VERBS[agreement];
  if (delta === 0) return `${subject} ${stayed} à ${formatEUR(to, 0)}${span}.`;
  return `${subject} ${moved} de ${formatEUR(from, 0)} à ${formatEUR(to, 0)}${span} (${formatSignedEUR(delta, 0)}).`;
};

/**
 * Un point par mois (le dernier de chaque mois), plus le tout dernier point : le tableau
 * de données d'une courbe journalière reste lisible.
 */
export const lastPointPerMonth = <T extends { date: string }>(points: T[]): T[] => {
  const byMonth = new Map<string, T>();
  points.forEach(p => byMonth.set(p.date.slice(0, 7), p));
  return [...byMonth.values()];
};

/**
 * Regroupe des comptes par établissement (insensible à la casse et aux espaces) en
 * additionnant `amountOf(compte)`. Trié du plus gros au plus petit.
 */
export const groupByInstitution = <A extends { institution?: string }>(accounts: A[], amountOf: (a: A) => number): { name: string; value: number }[] => {
  const groups = new Map<string, { name: string; value: number }>();
  accounts.forEach(a => {
    const name = (a.institution || 'Sans établissement').trim().replace(/\s+/g, ' ');
    const key = name.toLowerCase();
    const g = groups.get(key) ?? { name, value: 0 };
    g.value += amountOf(a);
    groups.set(key, g);
  });
  return [...groups.values()].sort((a, b) => b.value - a.value);
};

/**
 * Graduations « rondes » de 0 à au moins `max` (pas de 1, 2, 2,5 ou 5 × 10ⁿ), environ
 * `count` intervalles au plus : 0 / 10 k€ / 20 k€ / 30 k€ plutôt que 0 / 8,5 k€ / 17 k€.
 */
export const niceTicks = (max: number, count = 5): number[] => {
  if (!Number.isFinite(max) || max <= 0) return [0, 1];
  const raw = max / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map(m => m * pow).find(s => s >= raw) ?? 10 * pow;
  const ticks: number[] = [];
  for (let v = 0; v < max + step - 1e-9; v += step) ticks.push(Math.round(v * 100) / 100);
  return ticks;
};
