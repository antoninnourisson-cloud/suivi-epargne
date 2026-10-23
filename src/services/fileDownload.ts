// Téléchargement d'un fichier créé dans le navigateur : export des données, version mise de
// côté, exports CSV. Un seul endroit pour le lien temporaire et sa libération.
import { toCsv, type CsvCell } from '../lib/csv';

/** Propose `blob` au téléchargement sous le nom `fileName`. */
export const downloadBlob = (fileName: string, blob: Blob): void => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  // Attaché au document le temps du clic : certains navigateurs ignorent un lien détaché.
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Libéré un peu plus tard : le navigateur peut lire l'adresse après le clic.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

/** Fichier JSON lisible (indenté). */
export const downloadJSON = (fileName: string, value: unknown): void =>
  downloadBlob(fileName, new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));

/** Fichier CSV pour Excel en français (voir lib/csv). */
export const downloadCsv = (fileName: string, rows: CsvCell[][]): void =>
  downloadBlob(fileName, new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' }));
