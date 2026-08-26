/**
 * Helpers de dates partagés par les composants.
 *
 * POURQUOI ce fichier : le calcul « combien de mois me reste-t-il avant cette
 * échéance ? » était fait en approximant le résidu de jours par
 * `(to.getDate() - from.getDate()) / 30`. Ce résidu peut être fortement négatif
 * quand on compare une fin de mois à un début de mois (31/08 → 01/09 donnait
 * exactement 0, donc l'UI annonçait « échéance dépassée » pour demain). On
 * calcule donc sur des jours réels.
 */

export const MS_PER_DAY = 86_400_000;

/** Nombre moyen de jours par mois sur le cycle grégorien (365,25 / 12). */
export const AVG_DAYS_PER_MONTH = 30.4375;

/**
 * Parse une chaîne 'YYYY-MM-DD' en date locale à minuit.
 * POURQUOI : `new Date('2026-08-31')` est interprété en UTC par la spec, ce qui
 * décale la date d'un jour dans les fuseaux négatifs (et fausse les
 * comparaisons avec `new Date()` qui est, lui, local).
 */
export const parseISODate = (iso: string): Date => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
};

/** Ramène une date au début de sa journée locale (on compare des jours, pas des instants). */
export const startOfDay = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/**
 * Écart en jours calendaires entiers entre deux dates (négatif si `to` est passé).
 * L'arrondi absorbe les décalages d'une heure introduits par les changements
 * d'heure (été/hiver) entre les deux minuits locaux.
 */
export const daysBetween = (from: Date, to: Date): number =>
  Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / MS_PER_DAY);

/**
 * Écart en mois (fractionnaire) entre deux dates, basé sur les jours réels.
 * Négatif si `to` est antérieur à `from`, 0 si même jour.
 */
export const monthsBetween = (from: Date, to: Date): number =>
  daysBetween(from, to) / AVG_DAYS_PER_MONTH;
