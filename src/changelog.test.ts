// ================================================
// FILE: src/changelog.test.ts
// Garde-fous sur l'historique des mises à jour : la fenêtre « Quoi de neuf » et le tag de
// release (deploy.yml) se basent sur l'entrée en tête, il faut donc un ordre et un format
// sans ambiguïté.
// ================================================
import { describe, it, expect } from 'vitest';
import { CHANGELOG } from './changelog';

const VERSION_RE = /^\d{4}\.\d{2}\.\d{2}(-\d+)?$/;

/** '2026.10.01-3' → { date: '2026.10.01', n: 3 }. Sans suffixe = première mise à jour du jour (1). */
const parse = (v: string) => {
  const [date, suffix] = v.split('-');
  return { date, n: suffix === undefined ? 1 : Number(suffix) };
};

describe('CHANGELOG', () => {
  it('a au moins une entrée', () => {
    expect(CHANGELOG.length).toBeGreaterThan(0);
  });

  it.each(CHANGELOG.map(e => [e.version, e] as const))('%s : version au format AAAA.MM.JJ(-n)', (_v, e) => {
    expect(e.version).toMatch(VERSION_RE);
  });

  it('versions uniques', () => {
    const versions = CHANGELOG.map(e => e.version);
    expect(new Set(versions).size).toBe(versions.length);
  });

  it('versions strictement décroissantes (date, puis numéro du jour)', () => {
    for (let i = 1; i < CHANGELOG.length; i++) {
      const prev = parse(CHANGELOG[i - 1].version);
      const cur = parse(CHANGELOG[i].version);
      const newer = prev.date > cur.date || (prev.date === cur.date && prev.n > cur.n);
      expect(newer, `${CHANGELOG[i - 1].version} doit être plus récente que ${CHANGELOG[i].version}`).toBe(true);
    }
  });

  it.each(CHANGELOG.map(e => [e.version, e] as const))('%s : date = partie date de la version', (_v, e) => {
    expect(e.date).toBe(parse(e.version).date.replace(/\./g, '-'));
  });

  it.each(CHANGELOG.map(e => [e.version, e] as const))('%s : 1 à 6 éléments', (_v, e) => {
    expect(e.items.length).toBeGreaterThanOrEqual(1);
    expect(e.items.length).toBeLessThanOrEqual(6);
  });
});
