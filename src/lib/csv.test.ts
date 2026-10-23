import { describe, expect, it } from 'vitest';
import { csvAmount, csvCell, toCsv, CSV_BOM } from './csv';

describe('csv', () => {
  it('starts with a UTF-8 BOM, separates with semicolons and ends lines with CRLF', () => {
    const out = toCsv([['Compte', 'Montant'], ['Livret A', 12.5]]);
    expect(out.startsWith(CSV_BOM)).toBe(true);
    expect(out.slice(1)).toBe('Compte;Montant\r\nLivret A;12,5\r\n');
  });

  it('quotes cells containing the separator, quotes or line breaks (RFC 4180)', () => {
    expect(csvCell('Livret A; BNP')).toBe('"Livret A; BNP"');
    expect(csvCell('Le "bon" compte')).toBe('"Le ""bon"" compte"');
    expect(csvCell('ligne 1\nligne 2')).toBe('"ligne 1\nligne 2"');
    // La virgule n'est plus un séparateur : rien à échapper.
    expect(csvCell('Livret A, BNP')).toBe('Livret A, BNP');
  });

  it('neutralises text that a spreadsheet would run as a formula', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe('"\'=HYPERLINK(""x"")"');
    expect(csvCell('+33 6')).toBe("'+33 6");
    expect(csvCell('-5 € test')).toBe("'-5 € test");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    // Les nombres, eux, gardent leur signe.
    expect(csvCell(-12.5)).toBe('-12,5');
    // Un montant négatif écrit par csvAmount reste un nombre pour Excel (pas d'apostrophe)…
    expect(toCsv([[csvAmount(-12.5), csvAmount(-0.1), '-3']]).slice(1)).toBe('-12,50;-0,10;-3\r\n');
    // …mais ce qui ressemble seulement à un nombre est neutralisé.
    expect(csvCell('-12,50+A1')).toBe("'-12,50+A1");
    expect(csvCell('-1,2,3')).toBe("'-1,2,3");
    expect(csvCell('+12,50')).toBe("'+12,50");
  });

  it('writes numbers with a French decimal comma, readable by Excel', () => {
    expect(csvCell(1234.56)).toBe('1234,56');
    expect(csvCell(7)).toBe('7');
    expect(csvCell(Number.NaN)).toBe('');
    expect(csvAmount(1234.5)).toBe('1234,50');
    expect(csvAmount(-0.1)).toBe('-0,10');
    expect(csvAmount(Infinity)).toBe('');
  });

  it('writes empty cells for missing values and oui/non for booleans', () => {
    expect(toCsv([[null, undefined, true, false]]).slice(1)).toBe(';;oui;non\r\n');
  });
});
