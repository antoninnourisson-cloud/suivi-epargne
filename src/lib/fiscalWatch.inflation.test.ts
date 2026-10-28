// Veille fiscale : l'inflation annuelle de l'INSEE est une valeur datée que la veille propose
// de mettre à jour (jamais appliquée sans clic), comme les taux et les plafonds.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { diffFiscalWatch } from './fiscalWatch';
import { FISCAL_WATCH_PROMPT, buildSourcesPrompt } from '../services/fiscalWatchGemini';
import { DEFAULT_FISCAL_CONFIG } from '../constants';
import { inflationOf } from './inflation';

const INSEE = 'https://www.insee.fr/fr/statistiques/4268033';

afterEach(() => vi.useRealTimers());
const at = (d: Date) => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(d); };

describe('inflation INSEE dans la veille fiscale', () => {
  it('rien à proposer quand le chiffre est celui de l’app', () => {
    expect(diffFiscalWatch({ inflationAnnual: { value: 0.9, year: 2025, source: INSEE } }, DEFAULT_FISCAL_CONFIG, [])).toEqual([]);
    expect(diffFiscalWatch({ inflationAnnual: { value: 0.9, source: INSEE }, inflationYear: { value: 2025 } }, DEFAULT_FISCAL_CONFIG, [])).toEqual([]);
  });

  it("propose le chiffre d'une nouvelle année close, avec sa source, et l'applique daté", () => {
    at(new Date(2027, 0, 20));
    const [p] = diffFiscalWatch({ inflationAnnual: { value: 1.4, source: INSEE }, inflationYear: { value: 2026 } }, DEFAULT_FISCAL_CONFIG, []);
    expect(p).toMatchObject({ key: 'inflation', label: 'Inflation annuelle (INSEE)', current: '0,9 % (2025)', proposed: '1,4 % (2026)', source: INSEE });
    const next = p.apply({ fiscal: DEFAULT_FISCAL_CONFIG, accounts: [] });
    expect(next.fiscal.inflation).toEqual({ rate: 1.4, year: 2026, source: INSEE });
    expect(inflationOf(next.fiscal)).toEqual({ rate: 1.4, year: 2026, source: INSEE });
  });

  it('chiffre révisé pour la même année : proposé ; année plus ancienne : ignorée', () => {
    expect(diffFiscalWatch({ inflationAnnual: { value: 1.0, year: 2025, source: INSEE } }, DEFAULT_FISCAL_CONFIG, []).map(p => p.key)).toEqual(['inflation']);
    expect(diffFiscalWatch({ inflationAnnual: { value: 2.0, year: 2024, source: INSEE } }, DEFAULT_FISCAL_CONFIG, [])).toEqual([]);
  });

  it('année absente : la dernière année close ; valeurs aberrantes écartées', () => {
    at(new Date(2027, 1, 1));
    const [p] = diffFiscalWatch({ inflationAnnual: { value: 1.1, source: INSEE } }, DEFAULT_FISCAL_CONFIG, []);
    expect(p.proposed).toBe('1,1 % (2026)');
    expect(diffFiscalWatch({ inflationAnnual: { value: 45, source: INSEE } }, DEFAULT_FISCAL_CONFIG, [])).toEqual([]);
  });

  it("année en cours ou future (un glissement sur un mois, pas une moyenne annuelle) : rien n'est proposé", () => {
    at(new Date(2027, 1, 1));
    expect(diffFiscalWatch({ inflationAnnual: { value: 1.2, year: 2027, source: INSEE } }, DEFAULT_FISCAL_CONFIG, [])).toEqual([]);
    expect(diffFiscalWatch({ inflationAnnual: { value: 1.1, year: 2031, source: INSEE } }, DEFAULT_FISCAL_CONFIG, [])).toEqual([]);
    expect(diffFiscalWatch({ inflationAnnual: { value: 1.1, source: INSEE }, inflationYear: { value: 2027 } }, DEFAULT_FISCAL_CONFIG, [])).toEqual([]);
  });

  it("seulement lu sur insee.fr ou un site de l'État", () => {
    at(new Date(2027, 1, 1));
    const ask = (source?: string) => diffFiscalWatch({ inflationAnnual: { value: 1.1, year: 2026, source } }, DEFAULT_FISCAL_CONFIG, []).map(p => p.key);
    expect(ask(undefined)).toEqual([]);
    expect(ask('https://www.example.com/inflation-2026')).toEqual([]);
    expect(ask('https://insee.fr.example.com/x')).toEqual([]);
    expect(ask('http://www.insee.fr/fr/statistiques/4268033')).toEqual([]);
    expect(ask(INSEE)).toEqual(['inflation']);
    expect(ask('https://www.economie.gouv.fr/inflation')).toEqual(['inflation']);
  });

  it('les deux questions posées à Gemini demandent l’inflation en moyenne annuelle', () => {
    expect(FISCAL_WATCH_PROMPT).toContain('"inflationAnnual"');
    expect(buildSourcesPrompt([{ url: INSEE, topic: 'Inflation', text: '+0,9 %' }])).toContain('"inflationAnnual"');
  });
});
