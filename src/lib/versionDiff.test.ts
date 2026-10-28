import { describe, it, expect } from 'vitest';
import { diffVersions, diffHighlights, summarizeVersion } from './versionDiff';
import { APP_SCHEMA_VERSION } from './schema';

const account = (id: string, name: string, total: number, owned: number, movements: unknown[] = []) => ({
  id, name, institution: 'Banque', type: 'Livret A', totalAmount: total, ownedAmount: owned, parentalCapital: round(total - owned), movements,
});
const round = (n: number) => Math.round(n * 100) / 100;
const mv = (id: string, amount: number, type: 'IN' | 'OUT', date: string, label = 'Virement') => ({ id, amount, type, date, label });
const file = (accounts: unknown[], extra: Record<string, unknown> = {}) => ({
  schemaVersion: APP_SCHEMA_VERSION, accounts, expenses: [], history: [],
  config: { grossAnnual: 30000, leisureBudget: 200, projectSavings: 0, taxRateManual: 0, extraMonthlyIncome: 0 },
  ...extra,
});
const LABELS = { local: 'sur cet appareil', remote: 'sur Drive' };

describe('summarizeVersion', () => {
  it('épargne totale = part propre + part des parents, comptes et mouvements comptés', () => {
    const s = summarizeVersion(file([account('a', 'Livret A', 1000, 300, [mv('m1', 50, 'IN', '2026-10-01')]), account('b', 'LDDS', 200.105, 200.105)]));
    expect(s.totalSavings).toBe(1200.11);
    expect(s.ownShare).toBe(500.11);
    expect(s.accountCount).toBe(2);
    expect(s.movementCount).toBe(1);
  });

  it("un contenu illisible donne un résumé vide au lieu de planter", () => {
    expect(summarizeVersion(null)).toEqual({ totalSavings: 0, ownShare: 0, accountCount: 0, movementCount: 0 });
  });
});

describe('diffVersions', () => {
  it('deux versions identiques (ordre des clés, vue, signature et clé Gemini ignorés)', () => {
    const a = file([account('a', 'Livret A', 100, 100)], { lastView: 'pilot', lastWrite: { at: '2026-10-14T08:00:00Z' } });
    const b = { ...file([account('a', 'Livret A', 100, 100)]), config: { extraMonthlyIncome: 0, taxRateManual: 0, projectSavings: 0, leisureBudget: 200, grossAnnual: 30000, geminiApiKey: 'x' } };
    const d = diffVersions(a, b);
    expect(d.identical).toBe(true);
    expect(d.accounts).toEqual([]);
    expect(d.sections).toEqual([]);
  });

  it('solde différent, mouvement présent d’un seul côté, compte ajouté', () => {
    const local = file([account('a', 'Livret A', 150, 150, [mv('m1', 50, 'IN', '2026-10-10', 'Épargne du mois')])]);
    const remote = file([account('a', 'Livret A', 100, 100), account('c', 'PEA', 500, 500)]);
    const d = diffVersions(local, remote);
    expect(d.identical).toBe(false);
    expect(d.accounts).toEqual([
      { id: 'a', name: 'Livret A', local: { total: 150, own: 150 }, remote: { total: 100, own: 100 }, kind: 'balance' },
      { id: 'c', name: 'PEA', remote: { total: 500, own: 500 }, kind: 'only-remote' },
    ]);
    expect(d.onlyLocal.map(m => m.id)).toEqual(['m1']);
    expect(d.onlyRemote).toEqual([]);
    expect(d.local.totalSavings).toBe(150);
    expect(d.remote.totalSavings).toBe(600);
  });

  it('mouvement modifié et réglages changés, même solde', () => {
    const local = file([account('a', 'Livret A', 100, 100, [mv('m1', 50, 'IN', '2026-10-10', 'Courses')])]);
    const remote = file([account('a', 'Livret A', 100, 100, [mv('m1', 50, 'IN', '2026-10-10', 'Courses du samedi')])], {
      config: { grossAnnual: 32000, leisureBudget: 200, projectSavings: 0, taxRateManual: 0, extraMonthlyIncome: 0 },
      goals: [{ id: 'g', name: 'Voyage', target: 1000 }],
    });
    const d = diffVersions(local, remote);
    expect(d.changedMovements).toBe(1);
    expect(d.accounts).toEqual([{ id: 'a', name: 'Livret A', local: { total: 100, own: 100 }, remote: { total: 100, own: 100 }, kind: 'details' }]);
    // L'ancien champ « goals » n'est pas lu : il compte parmi les « Autres données ».
    expect(d.sections).toEqual(['Réglages', 'Autres données']);
  });

  it('les points mensuels de l’historique ne comptent pas, un champ inconnu si', () => {
    const local = file([account('a', 'Livret A', 100, 100)], { history: [{ date: '2026-10-01', totalAmount: 100, ownedAmount: 100 }] });
    const remote = file([account('a', 'Livret A', 100, 100)], { futureFeature: { x: 1 } });
    const d = diffVersions(local, remote);
    expect(d.sections).toEqual(['Autres données']);
  });

  it('comptes rangés dans un autre ordre', () => {
    const d = diffVersions(file([account('a', 'A', 1, 1), account('b', 'B', 2, 2)]), file([account('b', 'B', 2, 2), account('a', 'A', 1, 1)]));
    expect(d.sections).toEqual(['Ordre des comptes']);
    expect(d.identical).toBe(false);
  });

  it('mouvements d’un seul côté triés du plus récent au plus ancien', () => {
    const d = diffVersions(file([account('a', 'A', 1, 1)]), file([account('a', 'A', 1, 1, [mv('x', 1, 'IN', '2026-01-02'), mv('y', 2, 'OUT', '2026-03-04')])]));
    expect(d.onlyRemote.map(m => m.id)).toEqual(['y', 'x']);
  });
});

describe('diffHighlights', () => {
  it('phrases claires, soldes d’abord, limitées', () => {
    const local = file([
      account('a', 'Livret A', 150, 150, [mv('m1', 50, 'IN', '2026-10-10', 'Épargne du mois')]),
      account('b', 'LDDS', 300, 200),
    ]);
    const remote = file([
      account('a', 'Livret A', 100, 100, [mv('m2', 20, 'OUT', '2026-10-12', 'Retrait'), mv('m3', 30, 'OUT', '2026-10-11', 'Retrait')]),
      account('b', 'LDDS', 300, 250),
      account('c', 'PEA', 500, 500),
    ], { config: { grossAnnual: 32000, leisureBudget: 200, projectSavings: 0, taxRateManual: 0, extraMonthlyIncome: 0 } });
    const { lines, more } = diffHighlights(diffVersions(local, remote), LABELS, 10);
    const nb = (s: string) => s.replace(/ | /g, ' ');
    expect(lines.map(nb)).toEqual([
      'Livret A : 150 € sur cet appareil, 100 € sur Drive',
      'LDDS : même solde, mais votre part vaut 200 € sur cet appareil et 250 € sur Drive',
      'Compte « PEA » seulement sur Drive',
      'Seulement sur cet appareil : « Épargne du mois », +50 € le 10 oct. 2026 (Livret A)',
      '2 mouvements seulement sur Drive, dont « Retrait », −20 € le 12 oct. 2026 (Livret A)',
      'Modifié aussi : Réglages',
    ]);
    expect(more).toBe(0);
    const short = diffHighlights(diffVersions(local, remote), LABELS, 2);
    expect(short.lines).toHaveLength(2);
    expect(short.more).toBe(4);
  });

  it('aucune différence : aucune phrase', () => {
    expect(diffHighlights(diffVersions(file([]), file([])), LABELS)).toEqual({ lines: [], more: 0 });
  });
});
