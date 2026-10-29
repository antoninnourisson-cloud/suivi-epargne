import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { fractionToPercent, isAmbiguousThousands, parseFrenchNumber, percentToFraction, safeNumber } from './numbers';

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

describe('formats ambigus ou exotiques refusés (FIN-06)', () => {
  it('« 12.500 » : point des milliers ou décimales ? refusé au lieu de lire 12,5', () => {
    for (const t of ['12.500', '1.250', '-1.250', '999.000', '12.500 €', '+12.500']) {
      expect(parseFrenchNumber(t)).toBeNull();
      expect(isAmbiguousThousands(t)).toBe(true);
    }
  });

  it('les formats sans ambiguïté restent lisibles', () => {
    expect(parseFrenchNumber('12 500')).toBe(12500);
    expect(parseFrenchNumber('12500')).toBe(12500);
    expect(parseFrenchNumber('12 500,50')).toBe(12500.5);
    expect(parseFrenchNumber('12500,5')).toBe(12500.5);
    expect(parseFrenchNumber('12.5')).toBe(12.5);
    expect(parseFrenchNumber('12.50')).toBe(12.5);
    expect(parseFrenchNumber('1234.567')).toBe(1234.567); // 4 chiffres avant le point : pas des milliers
    expect(parseFrenchNumber('0.125')).toBe(0.125);        // un groupe de milliers ne suit jamais « 0 »
    expect(parseFrenchNumber('1,725')).toBe(1.725);        // la virgule est toujours décimale (taux)
    expect(parseFrenchNumber('0,2232')).toBe(0.2232);
    expect(parseFrenchNumber(',5')).toBe(0.5);
    expect(parseFrenchNumber('+5')).toBe(5);
    expect(isAmbiguousThousands('12,500')).toBe(false);
    expect(isAmbiguousThousands('12.5')).toBe(false);
  });

  it('exposant, hexadécimal, binaire, séparateurs multiples : refusés', () => {
    for (const t of ['2,5e3', '1e5', '0x10', '0b11', '0o7', '1.234,56', '1,234.56', '1.2.3', '1_000', '.', ',', '-', '12-3']) {
      expect(parseFrenchNumber(t)).toBeNull();
    }
  });

  it('propriété : tout montant réaffiché à la française (toLocaleString) se relit à l’identique', () => {
    fc.assert(fc.property(fc.integer({ min: -100_000_000, max: 100_000_000 }), cents => {
      const n = cents / 100;
      const shown = n.toLocaleString('fr-FR', { maximumFractionDigits: 2 });
      expect(parseFrenchNumber(shown)).toBe(n);
      expect(parseFrenchNumber(`${shown} €`)).toBe(n);
    }), { numRuns: 300 });
  });

  it('propriété : jamais de lecture 1 000 fois trop petite d’un nombre « à milliers pointés »', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 999 }), fc.integer({ min: 0, max: 999 }), (head, tail) => {
      expect(parseFrenchNumber(`${head}.${String(tail).padStart(3, '0')}`)).toBeNull();
    }), { numRuns: 300 });
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

describe('taux en pourcentage', () => {
  it('affiche une fraction en % sans bruit et la rend exacte', () => {
    expect(fractionToPercent(0.186)).toBe(18.6);
    expect(fractionToPercent(0.2232)).toBe(22.32);
    expect(fractionToPercent(0.4525)).toBe(45.25);
    expect(percentToFraction(18.6)).toBe(0.186);
    expect(percentToFraction(17.2)).toBe(0.172);
    expect(percentToFraction(22.32)).toBe(0.2232);
    for (const f of [0, 0.11, 0.3, 0.41, 0.45, 0.1, 0.0975]) expect(percentToFraction(fractionToPercent(f))).toBe(f);
  });
});
