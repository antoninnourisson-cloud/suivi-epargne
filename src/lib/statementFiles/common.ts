// Briques communes aux lecteurs de fichiers de relevé (OFX, CSV) : décodage du texte, montants
// et dates. Fonctions pures : le fichier est lu sur l'appareil, rien n'est envoyé.
import { round2 } from '../money';
import { isISODay } from '../statementDates';

/** Fichier illisible ou refusé : le message est écrit pour l'écran. */
export class StatementFileError extends Error {}

/** Texte d'un fichier : UTF-8 strict (avec ou sans BOM), sinon windows-1252 (banques françaises). */
export const decodeText = (buf: ArrayBuffer): string => {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    text = new TextDecoder('windows-1252').decode(buf);
  }
  return text.replace(/^﻿/, '');
};

/** Octets d'un fichier (Blob.arrayBuffer, sinon FileReader pour les navigateurs plus anciens). */
export const fileBytes = (file: Blob): Promise<ArrayBuffer> =>
  typeof file.arrayBuffer === 'function'
    ? file.arrayBuffer()
    : new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as ArrayBuffer);
      r.onerror = () => reject(r.error);
      r.readAsArrayBuffer(file);
    });

/**
 * Montant écrit à la française ou à l'anglaise : « 1 234,56 », « -12,5 € », « (45,00) »,
 * « 1.234,56 », « 12.50 ». Un séparateur unique suivi d'exactement trois chiffres est un
 * séparateur de milliers (un montant en euros n'a pas trois décimales). `null` si illisible.
 */
export const parseAmount = (raw: string): number | null => {
  let s = raw.replace(/[\s  ]/g, '').replace(/€|eur(os?)?/gi, '').replace(/[−–]/g, '-');
  let negative = false;
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); }
  if (s.startsWith('-')) { negative = !negative; s = s.slice(1); } else if (s.startsWith('+')) s = s.slice(1);
  if (s.endsWith('-')) { negative = !negative; s = s.slice(0, -1); }
  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return null;

  const comma = s.lastIndexOf(','), dot = s.lastIndexOf('.');
  let normalized: string;
  if (comma >= 0 && dot >= 0) {
    // Les deux : le dernier est la virgule décimale, l'autre sépare les milliers.
    const decimal = comma > dot ? ',' : '.';
    const thousands = decimal === ',' ? '.' : ',';
    if (s.split(decimal).length > 2 || s.lastIndexOf(thousands) > s.lastIndexOf(decimal)) return null;
    normalized = s.split(thousands).join('').replace(decimal, '.');
  } else if (comma >= 0 || dot >= 0) {
    const sep = comma >= 0 ? ',' : '.';
    const parts = s.split(sep);
    const after = parts[parts.length - 1];
    const many = parts.length > 2;
    if (many && !parts.slice(1).every(p => p.length === 3)) return null;
    const thousands = many || (after.length === 3 && parts[0] !== '' && parts[0] !== '0');
    normalized = thousands ? parts.join('') : `${parts[0] || '0'}.${after}`;
  } else normalized = s;
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;
  const n = Number(normalized);
  return Number.isFinite(n) ? round2(negative ? -n : n) : null;
};

/** JJ/MM/AAAA, JJ/MM/AA, JJ-MM-AAAA, JJ.MM.AAAA, AAAA-MM-JJ ou AAAAMMJJ (heure ignorée) → AAAA-MM-JJ ; `null` si absent ou impossible. */
export const parseDate = (raw: string): string | null => {
  const s = raw.trim();
  let y: string, m: string, d: string;
  let hit = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:\D.*)?$/.exec(s);
  if (hit) [, y, m, d] = hit;
  else if ((hit = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})(?:\D.*)?$/.exec(s))) {
    [, d, m, y] = hit;
    if (y.length === 2) y = `20${y}`;
  } else if ((hit = /^(\d{4})(\d{2})(\d{2})\d{0,6}(?:\D.*)?$/.exec(s))) [, y, m, d] = hit;
  else return null;
  const iso = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  return isISODay(iso) ? iso : null;
};
