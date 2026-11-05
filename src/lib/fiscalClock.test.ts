// Calendrier fiscal (Impôts › Calendrier fiscal) : seuls PEA, PEE et assurances-vie, échéance
// à venir ou atteinte, jamais de date inventée.
import { describe, it, expect } from 'vitest';
import { AccountType, type SavingsAccount } from '../types';
import { DEFAULT_FISCAL_CONFIG } from '../constants';
import { computeFiscalClock, describeFiscalAnniversary, findFiscalAnniversaries } from './fiscalClock';

const acc = (id: string, type: AccountType, extra: Partial<SavingsAccount> = {}): SavingsAccount => ({
  id, name: id, institution: 'B', type, totalAmount: 1000, ownedAmount: 1000, parentalCapital: 0, movements: [], ...extra,
});

describe('computeFiscalClock', () => {
  it('ne garde que PEA, PEE et assurance-vie ; sans date d’ouverture, un PEA n’apparaît pas', () => {
    const items = computeFiscalClock([
      acc('livret', AccountType.LIVRET_A), acc('pea-sans-date', AccountType.PEA),
      acc('pea', AccountType.PEA, { openingDate: '2010-01-15' }),
    ], DEFAULT_FISCAL_CONFIG);
    expect(items.map(i => i.id)).toEqual(['pea']);
    expect(items[0]).toMatchObject({ isAvailable: true, timeLeft: 'Disponible' });
  });

  it('échéance à venir : date, délai et précision sur l’impôt', () => {
    const next = new Date();
    const opening = `${next.getFullYear() - 1}-06-15`;
    const [item] = computeFiscalClock([acc('av', AccountType.ASSURANCE_VIE, { openingDate: opening })], DEFAULT_FISCAL_CONFIG);
    expect(item.isAvailable).toBe(false);
    expect(item.date).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
    expect(item.timeLeft).toMatch(/^(\d+a )?\d+m$/);
    expect(item.note).toMatch(/^Retirable avant, avec plus d'impôt\. À l'échéance : /);
  });
});

describe('findFiscalAnniversaries', () => {
  const pea = acc('pea', AccountType.PEA, { openingDate: '2021-03-12' });
  const find = (accounts: SavingsAccount[], d: Date, days?: number) => findFiscalAnniversaries(accounts, DEFAULT_FISCAL_CONFIG, d, days);

  it('le jour du 5e anniversaire du PEA : 0 jour écoulé, date et phrase du badge de maturité', () => {
    const [a] = find([pea], new Date(2026, 2, 12, 15));
    expect(a).toMatchObject({ accountId: 'pea', years: 5, date: '2026-03-12', daysSince: 0 });
    expect(a.detail).toMatch(/^Gains sans impôt sur le revenu/);
    expect(describeFiscalAnniversary(a).title).toBe("Anniversaire fiscal : pea a 5 ans aujourd'hui.");
  });
  it("jamais la veille ; après, jusqu'à la fin de la fenêtre seulement", () => {
    expect(find([pea], new Date(2026, 2, 11))).toEqual([]);
    expect(find([pea], new Date(2026, 3, 10))[0].daysSince).toBe(29);
    expect(find([pea], new Date(2026, 3, 11))).toEqual([]);
    expect(find([pea], new Date(2026, 2, 14), 3)[0].daysSince).toBe(2);
    expect(find([pea], new Date(2026, 2, 15), 3)).toEqual([]);
  });
  it('assurance vie : 8 ans ; durée prise dans les paramètres fiscaux', () => {
    const av = acc('av', AccountType.ASSURANCE_VIE, { openingDate: '2018-06-01' });
    expect(find([av], new Date(2026, 5, 1))[0].years).toBe(8);
    expect(findFiscalAnniversaries([av], { ...DEFAULT_FISCAL_CONFIG, legalMaturity: { ...DEFAULT_FISCAL_CONFIG.legalMaturity, assuranceVie: 9 } }, new Date(2026, 5, 1), 30)).toEqual([]);
  });
  it("ignore PEE, comptes vides et sans date d'ouverture", () => {
    expect(find([acc('pee', AccountType.PEE, { openingDate: '2021-03-12' })], new Date(2026, 2, 12))).toEqual([]);
    expect(find([{ ...pea, totalAmount: 0 }], new Date(2026, 2, 12))).toEqual([]);
    expect(find([{ ...pea, openingDate: undefined }], new Date(2026, 2, 12))).toEqual([]);
  });
});
