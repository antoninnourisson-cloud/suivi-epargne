// Export CSV de la courbe d'épargne.
// (Extrait de home.ts, code déplacé tel quel ; home.ts le ré-exporte.)
import { buildStackedSeries, type DateRange } from './homeChart';
import { type SavingsAccount } from '../types';
import { csvAmount, type CsvCell } from './csv';

// ---------------------------------------------------------------------------
// Export de la courbe (section « Plus de détails »)
// ---------------------------------------------------------------------------

export interface PeriodExport {
  /** Nom du fichier, avec les dates réellement exportées. */
  fileName: string;
  rows: CsvCell[][];
}

/**
 * Export CSV de la période choisie au-dessus de la courbe : exactement ce que montre le
 * graphique (votre part, compte par compte), un jour par ligne, sans les points espacés de
 * l'affichage. null si la période est vide ou inversée. Ce n'est pas une sauvegarde : celle-ci
 * est l'export JSON des Paramètres, le seul qui se réimporte.
 */
export const periodCsvExport = (accounts: SavingsAccount[], range: DateRange): PeriodExport | null => {
  const series = buildStackedSeries(accounts, range, { thin: false });
  if (series.length === 0) return null;
  const first = series[0].date, last = series[series.length - 1].date;
  const amount = (v: unknown) => (typeof v === 'number' ? csvAmount(v) : '');
  return {
    fileName: `pecule-evolution-${first}-au-${last}.csv`,
    rows: [
      ['Date', ...accounts.map(a => `${a.name} (€)`), 'Total, votre part (€)'],
      ...series.map(p => [p.date, ...accounts.map(a => amount(p[a.id])), amount(p.total)]),
    ],
  };
};

