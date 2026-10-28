// Exports CSV de l'app (relevé de restitution, dons, gains si retrait, soldes de l'Accueil) :
// un seul format, pensé pour Excel en français, qui ouvre le fichier d'un double clic.
// - séparateur « ; » : Excel en français attend le point-virgule (la virgule y est le
//   séparateur décimal), sinon tout tient dans une seule colonne ;
// - BOM UTF-8 en tête : sans lui, Excel lit le fichier en Windows-1252 et les accents
//   s'affichent mal (« Ã© ») ;
// - nombres à virgule décimale (« 1234,50 »), sans séparateur de milliers : Excel les lit
//   comme des nombres, pas comme du texte ;
// - échappement RFC 4180 : une cellule qui contient « ; », un guillemet ou un retour à la
//   ligne est entourée de guillemets, et ses guillemets sont doublés ;
// - un texte saisi qui commence par = + - @ (ou une tabulation) est précédé d'une apostrophe :
//   un tableur ne l'exécute pas comme une formule (injection de formule, OWASP). Un montant
//   négatif seul (« -12,50 », écrit par csvAmount) n'en est pas une : il reste un nombre.
// Fonctions pures : le téléchargement lui-même est dans services/fileDownload.

export type CsvCell = string | number | boolean | null | undefined;

const CSV_SEPARATOR = ';';
export const CSV_BOM = '﻿';

/** Montant au centime, virgule décimale : 1234.5 → « 1234,50 » (vide si le nombre est illisible). */
export const csvAmount = (n: number): string => (Number.isFinite(n) ? n.toFixed(2).replace('.', ',') : '');

const FORMULA_START = /^[=+\-@\t\r]/;
/** Montant écrit à la française (csvAmount) : un nombre pour le tableur, jamais une formule, même négatif. */
const PLAIN_AMOUNT = /^-?\d+(?:,\d+)?$/;
const NEEDS_QUOTES = /[";\r\n]/;

/** Une cellule, prête à écrire : nombres à la française, texte échappé et neutralisé. */
export const csvCell = (value: CsvCell): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'oui' : 'non';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value).replace('.', ',') : '';
  const text = FORMULA_START.test(value) && !PLAIN_AMOUNT.test(value) ? `'${value}` : value;
  return NEEDS_QUOTES.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/** Fichier CSV complet (BOM compris), lignes terminées par CRLF comme le veut la RFC 4180. */
export const toCsv = (rows: CsvCell[][]): string =>
  CSV_BOM + rows.map(row => row.map(csvCell).join(CSV_SEPARATOR)).join('\r\n') + '\r\n';
