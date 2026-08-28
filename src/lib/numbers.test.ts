import { describe, it, expect } from 'vitest';
import { parseFrenchNumber, safeNumber } from './numbers';

describe('parseFrenchNumber', () => {
  it('accepte la virgule décimale française', () => {
    // LE cas de régression : c'est la saisie qui produisait 0 silencieusement.
    expect(parseFrenchNumber('12,5')).toBe(12.5);
    expect(parseFrenchNumber('0,01')).toBe(0.01);
    expect(parseFrenchNumber('1234,56')).toBe(1234.56);
  });

  it('accepte aussi le point décimal', () => {
    expect(parseFrenchNumber('12.5')).toBe(12.5);
  });

  it('accepte un montant tel que réaffiché par toLocaleString (séparateurs de milliers)', () => {
    // toLocaleString('fr-FR') utilise selon le moteur l'espace insécable U+00A0 ou
    // l'espace fine insécable U+202F : les deux doivent repasser.
    expect(parseFrenchNumber('10 584,39')).toBe(10584.39);
    expect(parseFrenchNumber('10 584,39')).toBe(10584.39);
    expect(parseFrenchNumber('10 584,39')).toBe(10584.39);
    expect(parseFrenchNumber('22 950')).toBe(22950);
  });

  it("tolère le symbole € et les espaces autour", () => {
    expect(parseFrenchNumber('  1 500,50 € ')).toBe(1500.5);
  });

  it('renvoie null sur une saisie vide (à distinguer de zéro)', () => {
    expect(parseFrenchNumber('')).toBeNull();
    expect(parseFrenchNumber('   ')).toBeNull();
  });

  it('rejette une saisie partiellement numérique au lieu de la tronquer', () => {
    // parseFloat('12abc') vaut 12 : une faute de frappe deviendrait un montant plausible.
    expect(parseFrenchNumber('12abc')).toBeNull();
    expect(parseFrenchNumber('abc')).toBeNull();
    expect(parseFrenchNumber('--5')).toBeNull();
    expect(parseFrenchNumber('1,2,3')).toBeNull();
  });

  it('rejette les non-finis', () => {
    expect(parseFrenchNumber('Infinity')).toBeNull();
    expect(parseFrenchNumber('NaN')).toBeNull();
  });

  it('accepte zéro et les négatifs (le clamp éventuel est la responsabilité de l’appelant)', () => {
    expect(parseFrenchNumber('0')).toBe(0);
    expect(parseFrenchNumber('-5,5')).toBe(-5.5);
  });
});

describe('safeNumber', () => {
  it('ne propage jamais NaN', () => {
    expect(safeNumber('')).toBe(0);
    expect(safeNumber('abc')).toBe(0);
    expect(Number.isNaN(safeNumber('abc'))).toBe(false);
  });

  it('respecte le fallback fourni', () => {
    expect(safeNumber('', 0.2232)).toBe(0.2232);
    expect(safeNumber('abc', 42)).toBe(42);
  });

  it('parse normalement une valeur valide', () => {
    expect(safeNumber('0,2232')).toBe(0.2232);
    expect(safeNumber('12')).toBe(12);
  });
});
