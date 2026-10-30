import { afterEach, describe, it, expect } from 'vitest';
import { DISCREET_AMOUNT, elideDe, elideDu, elideLe, formatEUR, formatSignedEUR, isDiscreetAmounts, plainEUR, setDiscreetAmounts, formatMonth } from './format';

// Intl insère des espaces insécables : on les normalise pour comparer.
const norm = (s: string) => s.replace(/[  ]/g, ' ');

describe('formatEUR', () => {
  it('affiche les centimes sur deux chiffres seulement quand il y en a', () => {
    expect(norm(formatEUR(13.5))).toBe('13,50 €');
    expect(norm(formatEUR(250))).toBe('250 €');
    expect(norm(formatEUR(1250.4))).toBe('1 250,40 €');
  });
  it('arrondit ou force les centimes sur demande', () => {
    expect(norm(formatEUR(1249.6, 0))).toBe('1 250 €');
    expect(norm(formatEUR(250, 2))).toBe('250,00 €');
  });
  it('signe explicitement les écarts', () => {
    expect(norm(formatSignedEUR(13.5))).toBe('+13,50 €');
    expect(norm(formatSignedEUR(-250))).toBe('−250 €');
    expect(formatEUR(NaN)).toBe('—');
  });
});

describe('élision (« d’octobre », « l’Assurance vie »)', () => {
  it('élide devant une voyelle, accentuée ou en capitale', () => {
    expect(['avril', 'août', 'octobre', 'Assurance vie', 'Épargne salariale', 'œuvre', 'LDDS', 'Ouragan'].map(elideDe))
      .toEqual(["d'avril", "d'août", "d'octobre", "d'Assurance vie", "d'Épargne salariale", "d'œuvre", 'de LDDS', "d'Ouragan"]);
    expect(elideLe('Assurance vie')).toBe("l'Assurance vie");
    expect(elideDu('Assurance vie')).toBe("de l'Assurance vie");
  });
  it('garde « de », « le », « du » devant une consonne, un h ou un y', () => {
    expect(['septembre', 'mai', 'Livret A', 'Hello bank', 'Yomoni', 'janvier 2027'].map(elideDe))
      .toEqual(['de septembre', 'de mai', 'de Livret A', 'de Hello bank', 'de Yomoni', 'de janvier 2027']);
    expect(elideLe('Livret A')).toBe('le Livret A');
    expect(elideDu('PEA')).toBe('du PEA');
  });
});

describe('mode discret', () => {
  afterEach(() => { setDiscreetAmounts(false); });
  it('masque tous les montants formatés, signe compris, et revient aux chiffres une fois coupé', () => {
    setDiscreetAmounts(true);
    expect(isDiscreetAmounts()).toBe(true);
    expect(formatEUR(1250.4)).toBe(DISCREET_AMOUNT);
    expect(formatEUR(13.5, 2)).toBe(DISCREET_AMOUNT);
    expect(formatEUR(1249.6, 0)).toBe(DISCREET_AMOUNT);
    expect(formatSignedEUR(-250)).toBe(`−${DISCREET_AMOUNT}`);
    expect(plainEUR(1250)).toBe(DISCREET_AMOUNT);
    // Valeur illisible : toujours le tiret, rien à cacher.
    expect(formatEUR(NaN)).toBe('—');
    setDiscreetAmounts(false);
    expect(norm(formatEUR(250))).toBe('250 €');
    expect(norm(plainEUR(1250))).toBe('1 250 €');
  });
});

describe('formatMonth', () => {
  it('nom du mois, avec l’année sur demande ; valeur illisible rendue telle quelle', () => {
    expect(formatMonth('2026-11')).toBe('novembre');
    expect(formatMonth('2027-01', true)).toBe('janvier 2027');
    expect(formatMonth('bientôt')).toBe('bientôt');
  });
});
