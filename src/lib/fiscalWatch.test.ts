import { describe, it, expect } from 'vitest';
import { diffFiscalWatch, parseFiscalWatch, isWatchDue } from './fiscalWatch';
import { DEFAULT_FISCAL_CONFIG } from '../constants';
import { AccountType } from '../types';

const la = { id: 'la', name: 'Livret A', institution: 'B', type: AccountType.LIVRET_A, totalAmount: 1000, ownedAmount: 1000, parentalCapital: 0, interestRate: 1.7, movements: [] } as any;

describe('veille fiscale', () => {
  it('lit le JSON même entouré de texte', () => {
    expect(parseFiscalWatch('Voici :\n```json\n{"lepRate":{"value":2.5}}\n```')?.lepRate?.value).toBe(2.5);
    expect(parseFiscalWatch('pas de json')).toBeNull();
  });
  it("ne propose rien quand tout est à jour", () => {
    const r = { livretARate: { value: 1.7 }, socialChargesGeneral: { value: 0.186 }, decoteSingle: { value: 897 } };
    expect(diffFiscalWatch(r, DEFAULT_FISCAL_CONFIG, [la])).toEqual([]);
  });
  it('propose un nouveau taux et l\'applique à la date d\'effet', () => {
    const r = { livretARate: { value: 1.5, effectiveDate: '2027-02-01', source: 'https://www.service-public.fr/x' } };
    const [p] = diffFiscalWatch(r, DEFAULT_FISCAL_CONFIG, [la]);
    expect(p.key).toBe('rate.livretA');
    expect(p.source).toContain('service-public');
    const next = p.apply({ fiscal: DEFAULT_FISCAL_CONFIG, accounts: [la] });
    expect(next.accounts[0].interestRate).toBe(1.5);
    expect(next.accounts[0].rateHistory?.[0]).toEqual({ date: '2027-02-01', rate: 1.7 });
  });
  it('écarte les valeurs aberrantes et les sources non https', () => {
    const r = { socialChargesGeneral: { value: 18.6 }, lepCeiling: { value: 10, source: 'javascript:alert(1)' }, allowanceCap: { value: 14700, source: 'http://x' } };
    const ps = diffFiscalWatch(r, DEFAULT_FISCAL_CONFIG, [la]);
    expect(ps.map(p => p.key)).toEqual(['standardAllowanceCap']);
    expect(ps[0].source).toBeUndefined();
  });
  it('vérifie un barème cohérent avant de le proposer', () => {
    const bad = { taxBrackets: { value: [{ limit: 30000, rate: 0.11 }, { limit: 10000, rate: 0.3 }, { limit: 50000, rate: 0.41 }, { limit: null, rate: 0.45 }] } } as any;
    expect(diffFiscalWatch(bad, DEFAULT_FISCAL_CONFIG, [la])).toEqual([]);
    const good = { taxBrackets: { year: 2027, value: [{ limit: 11700, rate: 0 }, { limit: 29800, rate: 11 }, { limit: 85000, rate: 30 }, { limit: 183000, rate: 41 }, { limit: null, rate: 45 }] } } as any;
    const [p] = diffFiscalWatch(good, DEFAULT_FISCAL_CONFIG, [la]);
    const next = p.apply({ fiscal: DEFAULT_FISCAL_CONFIG, accounts: [] });
    expect(next.fiscal.taxBrackets[1]).toEqual({ limit: 29800, rate: 0.11 });
    expect(next.fiscal.taxScaleYear).toBe(2027);
  });
  it('relance une vérification après 7 jours', () => {
    const now = new Date('2026-10-10T12:00:00');
    expect(isWatchDue(undefined, now)).toBe(true);
    expect(isWatchDue('2026-10-05T12:00:00', now)).toBe(false);
    expect(isWatchDue('2026-10-03T11:00:00', now)).toBe(true);
  });
});

describe('lecture robuste de la réponse', () => {
  it('accepte un bloc ```json, des citations [1] et une virgule finale', () => {
    const txt = 'Voici les valeurs :\n```json\n{"lepRate": {"value": 2.5, "source": "https://x.gouv.fr"} [1], "livretARate": {"value": 1.7},}\n```\nSources : {voir ci-dessus}';
    const r = parseFiscalWatch(txt);
    expect(r?.lepRate?.value).toBe(2.5);
    expect(r?.livretARate?.value).toBe(1.7);
  });
  it('prend le premier objet équilibré même avec du texte après', () => {
    expect(parseFiscalWatch('{"lepRate":{"value":2.5,"source":"https://a.fr/{x}"}} puis {autre}')?.lepRate?.value).toBe(2.5);
  });
});
