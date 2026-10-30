// Calendrier fiscal (Impôts › Calendrier fiscal) : seuls PEA, PEE et assurances-vie, échéance
// à venir ou atteinte, jamais de date inventée.
import { describe, it, expect } from 'vitest';
import { AccountType, type SavingsAccount } from '../types';
import { DEFAULT_FISCAL_CONFIG } from '../constants';
import { computeFiscalClock } from './fiscalClock';

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
