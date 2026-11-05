// Lecture locale d'un relevé OFX ou CSV (chargée à la demande avec l'écran « Lire un relevé ») :
// aucun envoi, aucune clé. Le résultat passe ensuite par la même relecture que les relevés de Gemini.
import type { StatementData } from '../statementImport';
import { buildCsvStatement, guessCsv, mappingIsComplete, type CsvMapping, type CsvTable } from './csv';
import { decodeText, fileBytes, StatementFileError } from './common';
import { parseOfx } from './ofx';

export { buildCsvStatement, mappingIsComplete, StatementFileError };
export type { CsvMapping, CsvTable };

/** Résultat de la lecture : un relevé prêt, ou un CSV dont les colonnes sont à confirmer. */
export type LocalRead =
  | { kind: 'statement'; data: StatementData }
  | { kind: 'columns'; table: CsvTable; mapping: CsvMapping; fileName: string };

const OFX_CONTENT = /<OFX[\s>]|OFXHEADER:/i;
/** Reconnu à son contenu : un fichier partagé peut s'appeler « document ». L'extension n'est qu'un indice. */
const isOfx = (file: Pick<File, 'name'>, bytes: ArrayBuffer) =>
  OFX_CONTENT.test(decodeText(bytes).slice(0, 20000)) || /\.(ofx|qfx)$/i.test(file.name);

/**
 * Lit un fichier .ofx, .qfx ou .csv. Lève une StatementFileError (message en clair) si le fichier
 * ne convient pas. Un CSV dont les colonnes ne sont pas sûres renvoie `columns` : à l'écran de
 * faire choisir les colonnes, puis d'appeler `buildCsvStatement`.
 */
export const readLocalStatement = async (file: File): Promise<LocalRead> => {
  const bytes = await fileBytes(file);
  if (isOfx(file, bytes)) return { kind: 'statement', data: parseOfx(bytes) };
  const guess = guessCsv(decodeText(bytes));
  if (!guess.ambiguous && mappingIsComplete(guess.mapping)) {
    try {
      return { kind: 'statement', data: buildCsvStatement(guess.table, guess.mapping, file.name) };
    } catch (e) {
      // Colonnes devinées mais rien de lisible dedans : à corriger à la main.
      if (!(e instanceof StatementFileError)) throw e;
    }
  }
  return { kind: 'columns', table: guess.table, mapping: guess.mapping, fileName: file.name };
};
