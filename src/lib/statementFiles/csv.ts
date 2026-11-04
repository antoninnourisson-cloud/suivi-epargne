// Lecteur CSV « générique » → relevé de Pécule : séparateur, ligne d'en-tête et colonnes sont
// devinés ; quand la détection n'est pas sûre, l'écran demande de choisir les colonnes
// (`CsvMapping`). Fonctions pures, le fichier ne quitte pas l'appareil.
import { normalizeLabel, sanitizeStatement, type StatementData } from '../statementImport';
import { parseAmount, parseDate, StatementFileError } from './common';

/** Numéros de colonnes (à partir de 0) ; -1 : pas de colonne. Montant seul, ou débit et/ou crédit. */
export interface CsvMapping { date: number; label: number; amount: number; debit: number; credit: number; balance: number }

/** Fichier découpé : ligne d'en-tête, puis les lignes de données (toutes de la même largeur). */
export interface CsvTable { header: string[]; rows: string[][] }

export interface CsvGuess { table: CsvTable; mapping: CsvMapping; /** Détection incertaine : à faire confirmer. */ ambiguous: boolean }

const SEPARATORS = [';', ',', '\t'] as const;

/** Découpe en lignes et en champs (guillemets respectés, « "" » pour un guillemet). */
export const parseDelimited = (text: string, sep: string): string[][] => {
  const rows: string[][] = [];
  let row: string[] = [], field = '', quoted = false, touched = false;
  const endField = () => { row.push(field); field = ''; };
  const endRow = () => { endField(); if (touched || row.some(c => c.trim())) rows.push(row); row = []; touched = false; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; } else field += c;
    } else if (c === '"' && field.trim() === '') { quoted = true; field = ''; touched = true; }
    else if (c === sep) { endField(); touched = true; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; endRow(); }
    else field += c;
  }
  if (field !== '' || row.length > 0) endRow();
  return rows;
};

/** Séparateur le plus régulier sur les premières lignes (`;`, `,` ou tabulation). */
export const detectSeparator = (text: string): string => {
  const sample = text.split(/\r\n|\r|\n/).filter(l => l.trim()).slice(0, 25).join('\n');
  let best: string = ';', bestScore = 0;
  for (const sep of SEPARATORS) {
    const widths = parseDelimited(sample, sep).map(r => r.length).filter(n => n > 1);
    if (widths.length === 0) continue;
    const counts = new Map<number, number>();
    widths.forEach(w => counts.set(w, (counts.get(w) ?? 0) + 1));
    const [width, lines] = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0];
    const score = lines * width;
    if (score > bestScore) { best = sep; bestScore = score; }
  }
  return best;
};

// Noms de colonne reconnus (sans accents ni casse), du plus sûr au moins sûr : poids décroissant.
const NAMES: Record<'date' | 'label' | 'amount' | 'debit' | 'credit' | 'balance', [string, number][]> = {
  date: [['date operation', 5], ['date', 4], ['date comptable', 3], ['date de comptabilisation', 3], ['date valeur', 1], ['date de valeur', 1]],
  label: [['libelle', 5], ['libelle operation', 5], ['description', 4], ['intitule', 3], ['operation', 3], ['detail', 2], ['libelle simplifie', 2]],
  amount: [['montant', 5]],
  debit: [['debit', 5]],
  credit: [['credit', 5]],
  balance: [['solde', 5]],
};
type Role = keyof typeof NAMES;

/**
 * Poids d'un nom de colonne pour un rôle (0 : ne convient pas). Le nom exact l'emporte ;
 * « Montant (EUR) » vaut un peu moins que « Montant », sauf pour la date (« Date valeur »
 * n'est pas « Date »).
 */
const weight = (name: string, role: Role): number => {
  const n = normalizeLabel(name);
  let best = 0;
  for (const [key, w] of NAMES[role]) {
    if (n === key) best = Math.max(best, w);
    else if (role !== 'date' && n.startsWith(`${key} `)) best = Math.max(best, w - 0.5);
  }
  return best;
};

/** Meilleure colonne pour un rôle : `{ index }` si une seule, `{ index: -1, tie }` sinon. */
const pick = (header: string[], role: Role): { index: number; tie: boolean } => {
  let best = 0, index = -1, tie = false;
  header.forEach((h, i) => {
    const w = weight(h, role);
    if (w > best) { best = w; index = i; tie = false; } else if (w > 0 && w === best) tie = true;
  });
  return { index, tie };
};

const guessMapping = (header: string[]): { mapping: CsvMapping; ambiguous: boolean } => {
  const date = pick(header, 'date'), label = pick(header, 'label'), amount = pick(header, 'amount');
  const debit = pick(header, 'debit'), credit = pick(header, 'credit'), balance = pick(header, 'balance');
  const useAmount = amount.index >= 0 && !amount.tie;
  const split = !useAmount && (debit.index >= 0 || credit.index >= 0);
  const mapping: CsvMapping = {
    date: date.tie ? -1 : date.index, label: label.tie ? -1 : label.index,
    amount: useAmount ? amount.index : -1,
    debit: split && !debit.tie ? debit.index : -1, credit: split && !credit.tie ? credit.index : -1,
    balance: balance.tie ? -1 : balance.index,
  };
  // Débit seul ou crédit seul : possible, mais à faire confirmer.
  const amountsOk = mapping.amount >= 0 || (mapping.debit >= 0 && mapping.credit >= 0);
  return { mapping, ambiguous: mapping.date < 0 || mapping.label < 0 || !amountsOk || date.tie || label.tie };
};

const isDateLike = (v: string) => parseDate(v) !== null;
const isAmountLike = (v: string) => /\d/.test(v) && parseAmount(v) !== null;

/** Ligne d'en-tête : la première dont au moins deux noms sont reconnus, y compris la date. */
const findHeader = (rows: string[][]): number => {
  const limit = Math.min(rows.length, 40);
  for (let i = 0; i < limit; i++) {
    const h = rows[i];
    if (h.length < 3 || h.some(isDateLike)) continue;
    const roles = (['date', 'label', 'amount', 'debit', 'credit'] as Role[]).filter(r => h.some(c => weight(c, r) > 0));
    if (roles.includes('date') && roles.length >= 3) return i;
  }
  return -1;
};

/**
 * Premier regard sur un CSV : tableau (en-tête et lignes de données) et colonnes devinées.
 * Sans ligne d'en-tête reconnue, la première ligne de la largeur du tableau en tient lieu et
 * la détection est déclarée incertaine.
 */
export const guessCsv = (text: string): CsvGuess => {
  if (text.slice(0, 2000).includes('\u0000')) throw new StatementFileError("Ce fichier ne ressemble pas à un relevé CSV (il n'est pas du texte).");
  if (!text.trim()) throw new StatementFileError('Ce fichier est vide.');
  const rows = parseDelimited(text, detectSeparator(text));
  const widths = new Map<number, number>();
  rows.forEach(r => { if (r.length > 1) widths.set(r.length, (widths.get(r.length) ?? 0) + 1); });
  if (widths.size === 0) throw new StatementFileError("Ce fichier n'est pas un relevé CSV lisible (aucune colonne trouvée).");
  const width = [...widths.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];

  let at = findHeader(rows);
  const found = at >= 0;
  if (!found) {
    // Pas de nom reconnu : la ligne suivant les lignes de banque, de la bonne largeur et sans date ni montant.
    at = rows.findIndex(r => r.length === width && !r.some(c => isDateLike(c) || isAmountLike(c)));
  }
  const fit = (r: string[]) => (r.length >= width ? r.slice(0, width) : [...r, ...Array<string>(width - r.length).fill('')]);
  const header = at >= 0 ? fit(rows[at]).map(c => c.trim()) : Array.from({ length: width }, (_, i) => `Colonne ${i + 1}`);
  const data = rows.slice(at + 1).filter(r => r.length > 1 || r[0]?.trim()).map(fit);
  if (data.length === 0) throw new StatementFileError("Aucune opération trouvée dans ce fichier : seul l'en-tête est présent.");
  const guess = guessMapping(header);
  return { table: { header, rows: data }, mapping: guess.mapping, ambiguous: !found || guess.ambiguous };
};

/** Colonnes cohérentes ? (date, libellé, et un montant ou un débit/crédit ; solde facultatif) */
export const mappingIsComplete = (m: CsvMapping): boolean =>
  m.date >= 0 && m.label >= 0 && (m.amount >= 0 || m.debit >= 0 || m.credit >= 0);

/**
 * Relevé tiré des lignes d'après les colonnes choisies. Un débit est toujours négatif, même
 * écrit sans signe ; le solde est celui de la ligne la plus récente (sans colonne Solde, pas
 * de solde : la relecture ne propose alors que les opérations). Le compte porte le nom du
 * fichier ; un seul compte par CSV.
 */
export const buildCsvStatement = (table: CsvTable, m: CsvMapping, fileName: string): StatementData => {
  if (!mappingIsComplete(m)) throw new StatementFileError('Choisissez au moins la date, le libellé et le montant (ou le débit et le crédit).');
  const cell = (r: string[], i: number) => (i >= 0 ? (r[i] ?? '').trim() : '');
  let ignored = 0;
  const movements: { date: string; label: string; amount: number; direction: 'CREDIT' | 'DEBIT' }[] = [];
  const dated: { date: string; balance: number }[] = [];
  for (const r of table.rows) {
    const date = parseDate(cell(r, m.date));
    let amount: number | null = null;
    if (m.amount >= 0) amount = parseAmount(cell(r, m.amount));
    else {
      const debit = parseAmount(cell(r, m.debit)), credit = parseAmount(cell(r, m.credit));
      if (debit !== null && debit !== 0) amount = -Math.abs(debit);
      else if (credit !== null && credit !== 0) amount = Math.abs(credit);
    }
    if (date && m.balance >= 0) {
      const balance = parseAmount(cell(r, m.balance));
      if (balance !== null) dated.push({ date, balance });
    }
    if (!date && !cell(r, m.label) && amount === null) continue; // ligne vide ou de total sans rien de lisible
    if (!date || amount === null || amount === 0) { ignored++; continue; }
    movements.push({ date, label: cell(r, m.label), amount: Math.abs(amount), direction: amount < 0 ? 'DEBIT' : 'CREDIT' });
  }
  if (movements.length === 0 && dated.length === 0) throw new StatementFileError('Aucune opération lisible avec ces colonnes : vérifiez la date et le montant.');

  // Ligne la plus récente ; à date égale, la dernière du fichier si les dates montent, la première si elles descendent.
  let closing: { date: string; balance: number } | undefined;
  if (dated.length > 0) {
    const descending = dated[0].date > dated[dated.length - 1].date;
    closing = dated.reduce((best, cur) => (cur.date > best.date || (cur.date === best.date && !descending) ? cur : best));
  }
  const dates = movements.map(x => x.date).sort();
  const base = fileName.replace(/\.[^.]*$/, '').replace(/[_-]+/g, ' ').trim();
  const data = sanitizeStatement({
    periodStart: dates[0], periodEnd: dates[dates.length - 1],
    accounts: [{
      name: base || 'Compte du fichier', closingBalance: closing?.balance, closingDate: closing?.date,
      movements,
    }],
  });
  // Les lignes écartées ici s'ajoutent à celles que le filtrage écarte.
  if (data.accounts[0]) data.accounts[0].ignored += ignored;
  return data;
};
