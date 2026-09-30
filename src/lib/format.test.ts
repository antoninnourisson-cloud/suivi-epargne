import { describe, it, expect } from 'vitest';
import { formatEUR, formatSignedEUR } from './format';

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
