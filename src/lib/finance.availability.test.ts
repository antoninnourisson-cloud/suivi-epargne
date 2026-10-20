import { describe, it, expect } from 'vitest';
import { computePeeAvailability, computeAvailabilityBreakdown, accountAvailabilityStatus, describeMaturity, computeMaturityCountdown } from './finance';
import { DEFAULT_FISCAL_CONFIG as CFG } from '../constants';
import { AccountMovement, AccountType, SavingsAccount } from '../types';

// PEE : chaque versement est bloqué 5 ans à compter de sa date (Code du travail,
// art. L3332-25 : https://code.travail.gouv.fr/code-du-travail/l3332-25).
const NOW = new Date(2026, 9, 19); // 19 octobre 2026
const pay = (date: string, amount: number, over: Partial<AccountMovement> = {}): AccountMovement =>
  ({ id: `${date}-${amount}-${over.type || 'IN'}-${over.kind || ''}`, date, amount, label: 'Versement', type: 'IN', ...over });
const yearly = ['2020', '2021', '2022', '2023', '2024', '2025'].map(y => pay(`${y}-03-01`, 1000));
const pee = (over: Partial<SavingsAccount> = {}): SavingsAccount => ({
  id: 'pee', name: 'PEE', institution: 'E', type: AccountType.PEE, openingDate: '2020-03-01',
  totalAmount: 6000, ownedAmount: 6000, parentalCapital: 0, movements: yearly, ...over,
});

describe('PEE : déblocage versement par versement', () => {
  it("ne libère que les versements de plus de 5 ans, pas tout le plan 5 ans après l'ouverture", () => {
    const r = computePeeAvailability(pee(), CFG, NOW);
    // 2020 et 2021 libres (01/03/2025 et 01/03/2026) ; 2022 à 2025 encore bloqués.
    expect(r.available).toBeCloseTo(2000, 6);
    expect(r.blocked).toBeCloseTo(4000, 6);
    expect(r.undated).toBe(false);
    expect(r.nextRelease).toEqual({ date: '2027-03-01', monthsRemaining: 5, amount: 1000, last: false });
  });

  it('un retrait consomme les versements les plus anciens d’abord', () => {
    const r = computePeeAvailability(pee({ totalAmount: 4500, ownedAmount: 4500, movements: [...yearly, pay('2026-01-10', 1500, { type: 'OUT', label: 'Retrait' })] }), CFG, NOW);
    // Reste : 500 € de 2021 (libres), 4 000 € de 2022 à 2025.
    expect(r.available).toBeCloseTo(500, 6);
    expect(r.blocked).toBeCloseTo(4000, 6);
  });

  it('les gains suivent les versements au prorata', () => {
    const r = computePeeAvailability(pee({ totalAmount: 6600, ownedAmount: 6600, movements: [...yearly, pay('2026-06-30', 600, { kind: 'valuation', label: 'Valorisation' })] }), CFG, NOW);
    expect(r.available).toBeCloseTo(2200, 6);
    expect(r.nextRelease?.amount).toBeCloseTo(1100, 6);
  });

  it('un solde sans date de versement connue reste bloqué', () => {
    const r = computePeeAvailability(pee({ totalAmount: 8000, ownedAmount: 8000 }), CFG, NOW);
    expect(r.undated).toBe(true);
    expect(r.available).toBeCloseTo(2000, 6);
    expect(r.blocked).toBeCloseTo(6000, 6);
    const none = computePeeAvailability(pee({ movements: [] }), CFG, NOW);
    expect(none).toMatchObject({ available: 0, blocked: 6000, undated: true, nextRelease: undefined });
  });

  it('ignore la part des parents et les mouvements à venir', () => {
    // ownedAmount compte le versement à venir (comme le fait applyMovement), pas la part des parents.
    const r = computePeeAvailability(pee({ totalAmount: 11300, ownedAmount: 6300, parentalCapital: 5000, movements: [...yearly, pay('2020-01-01', 5000, { kind: 'parental' }), pay('2026-12-01', 300)] }), CFG, NOW);
    expect(r.available).toBeCloseTo(2000, 6);
    expect(r.blocked).toBeCloseTo(4000, 6);
  });

  it('par défaut, prend votre part à la date de calcul (versement à venir neutralisé)', () => {
    // ownedAmount compte déjà le versement du 01/12/2026 ; à ce jour, la part est de 6 000 €.
    const acc = pee({ totalAmount: 6300, ownedAmount: 6300, movements: [...yearly, pay('2026-12-01', 300)] });
    const r = computePeeAvailability(acc, CFG, NOW);
    expect(r).toEqual(computePeeAvailability(acc, CFG, NOW, 6000));
    expect(r.available).toBeCloseTo(2000, 6);
    expect(r.blocked).toBeCloseTo(4000, 6);
    expect(r.undated).toBe(false);
    expect(r.nextRelease).toMatchObject({ date: '2027-03-01', amount: 1000, last: false });
  });
});

describe('PEE : solde initial d’un plan plus ancien que son ajout à l’app', () => {
  const initial = (date: string, amount: number) => pay(date, amount, { label: 'Solde initial', tag: 'initial' });

  it('ne devine aucune date : bloqué par prudence, sans déblocage annoncé', () => {
    // Plan ouvert en 2015, ajouté à l'app le 01/02/2025 : les versements ont eu lieu entre
    // les deux, à des dates inconnues. Jamais « libre le 01/02/2030 ».
    const r = computePeeAvailability(pee({ openingDate: '2015-01-01', totalAmount: 10000, ownedAmount: 10000, movements: [initial('2025-02-01', 10000)] }), CFG, NOW);
    expect(r).toEqual({ available: 0, blocked: 10000, undated: true, nextRelease: undefined });
  });

  it('date d’ouverture inconnue : même prudence', () => {
    const r = computePeeAvailability(pee({ openingDate: undefined, totalAmount: 3000, ownedAmount: 3000, movements: [initial('2024-02-01', 3000)] }), CFG, NOW);
    expect(r).toMatchObject({ available: 0, blocked: 3000, undated: true, nextRelease: undefined });
  });

  it('les versements notés ensuite gardent leur date ; « tout » n’est jamais annoncé', () => {
    const r = computePeeAvailability(pee({ openingDate: '2015-01-01', totalAmount: 11000, ownedAmount: 11000, movements: [initial('2025-02-01', 10000), pay('2026-03-01', 1000)] }), CFG, NOW);
    expect(r.undated).toBe(true);
    expect(r.available).toBe(0);
    expect(r.nextRelease).toEqual({ date: '2031-03-01', monthsRemaining: 53, amount: 1000, last: false });
  });

  it('libre à coup sûr 5 ans après la date du solde initial', () => {
    const r = computePeeAvailability(pee({ openingDate: '2015-01-01', totalAmount: 10000, ownedAmount: 10000, movements: [initial('2021-01-01', 10000)] }), CFG, NOW);
    expect(r).toEqual({ available: 10000, blocked: 0, undated: false, nextRelease: undefined });
  });

  it('plan ouvert le jour du solde initial : la date est connue', () => {
    const r = computePeeAvailability(pee({ openingDate: '2024-02-01', totalAmount: 3000, ownedAmount: 3000, movements: [initial('2024-02-01', 3000)] }), CFG, NOW);
    expect(r.undated).toBe(false);
    expect(r.nextRelease).toMatchObject({ date: '2029-02-01', amount: 3000, last: true });
  });

  it('un retrait consomme d’abord le solde initial (le plus ancien)', () => {
    const r = computePeeAvailability(pee({ openingDate: '2015-01-01', totalAmount: 2000, ownedAmount: 2000,
      movements: [initial('2025-02-01', 10000), pay('2025-06-01', 2000), pay('2026-01-10', 10000, { type: 'OUT', label: 'Déblocage anticipé' })] }), CFG, NOW);
    expect(r.undated).toBe(false);
    expect(r.nextRelease).toMatchObject({ date: '2030-06-01', amount: 2000, last: true });
  });

  it('une date de fin de contrat passée libère tout ; à venir, elle borne le prochain déblocage', () => {
    expect(computePeeAvailability(pee({ contractEndDate: '2026-01-01' }), CFG, NOW)).toMatchObject({ available: 6000, blocked: 0 });
    const r = computePeeAvailability(pee({ contractEndDate: '2026-12-31' }), CFG, NOW);
    expect(r.nextRelease).toEqual({ date: '2026-12-31', monthsRemaining: 3, amount: 4000, last: true });
  });

  it('annonce « tout » quand le dernier versement se libère', () => {
    const r = computePeeAvailability(pee({ totalAmount: 1000, ownedAmount: 1000, movements: [pay('2023-05-02', 1000)] }), CFG, NOW);
    expect(r.nextRelease).toMatchObject({ date: '2028-05-02', amount: 1000, last: true });
  });
});

describe('répartition par disponibilité', () => {
  const acc = (over: Partial<SavingsAccount>): SavingsAccount => ({
    id: over.name || 'x', name: 'x', institution: 'B', type: AccountType.LIVRET_A,
    totalAmount: 1000, ownedAmount: 1000, parentalCapital: 0, movements: [], ...over,
  });

  it('range chaque compte, le PEE versement par versement', () => {
    const b = computeAvailabilityBreakdown([
      acc({ name: 'LA', ownedAmount: 1000 }),
      acc({ name: 'PEA récent', type: AccountType.PEA, openingDate: '2023-01-01', ownedAmount: 3000 }),
      acc({ name: 'PEA ancien', type: AccountType.PEA, openingDate: '2021-10-19', ownedAmount: 500 }),
      acc({ name: 'PER', type: AccountType.PER, ownedAmount: 700 }),
      pee(),
    ], CFG, a => a.ownedAmount, NOW);
    expect(b.available).toBeCloseTo(1000 + 500 + 2000, 6);
    expect(b.taxLocked).toBeCloseTo(3000, 6);
    expect(b.hardLocked).toBeCloseTo(700 + 4000, 6);
    expect(b.peeNextRelease).toMatchObject({ name: 'PEE', date: '2027-03-01' });
    expect(b.peeUndated).toBe(false);
  });

  it('par défaut, part à la date de calcul ; signale un PEE aux dates inconnues', () => {
    const b = computeAvailabilityBreakdown([
      acc({ name: 'LA', ownedAmount: 1500, movements: [{ id: 'f', date: '2026-11-02', amount: 500, label: 'Versement', type: 'IN' }] }),
      pee({ openingDate: '2015-01-01', totalAmount: 10000, ownedAmount: 10000, movements: [pay('2025-02-01', 10000, { label: 'Solde initial', tag: 'initial' })] }),
    ], CFG, undefined, NOW);
    expect(b.available).toBeCloseTo(1000, 6);
    expect(b.hardLocked).toBeCloseTo(10000, 6);
    expect(b.peeUndated).toBe(true);
    expect(b.peeNextRelease).toBeUndefined();
  });

  it('PEA et assurance vie : mûrs au jour anniversaire', () => {
    expect(accountAvailabilityStatus({ type: AccountType.PEA, openingDate: '2021-10-20' }, CFG, NOW)).toBe('TAX_LOCKED');
    expect(accountAvailabilityStatus({ type: AccountType.PEA, openingDate: '2021-10-19' }, CFG, NOW)).toBe('AVAILABLE');
    expect(accountAvailabilityStatus({ type: AccountType.ASSURANCE_VIE, openingDate: '2018-10-20' }, CFG, NOW)).toBe('TAX_LOCKED');
    expect(accountAvailabilityStatus({ type: AccountType.PEE, openingDate: '2010-01-01' }, CFG, NOW)).toBe('HARD_LOCKED');
  });
});

describe('libellé de maturité', () => {
  it('PEE : pas de « exonéré dans N mois » (il l’est déjà)', () => {
    expect(computeMaturityCountdown({ type: AccountType.PEE, openingDate: '2023-01-01', totalAmount: 1000 }, CFG, NOW)).toBeNull();
  });

  it('PEA : dit que les prélèvements sociaux (18,6 %) restent dus', () => {
    const m = computeMaturityCountdown({ type: AccountType.PEA, openingDate: '2022-01-01', totalAmount: 1000 }, CFG, NOW)!;
    const t = describeMaturity({ type: AccountType.PEA }, m, CFG);
    expect(t.short).toBe('Sans impôt sur le revenu dans 3 mois');
    expect(t.detail).toBe('Gains sans impôt sur le revenu ; les prélèvements sociaux (18,6 %) restent dus au retrait');
  });

  it('assurance vie : impôt réduit au-delà de l’abattement, 17,2 % de prélèvements sociaux', () => {
    const m = computeMaturityCountdown({ type: AccountType.ASSURANCE_VIE, openingDate: '2021-01-01', totalAmount: 1000 }, CFG, NOW)!;
    const t = describeMaturity({ type: AccountType.ASSURANCE_VIE }, m, CFG);
    expect(t.short).toBe('Impôt réduit dans 27 mois');
    expect(t.detail).toMatch(/^Impôt sur le revenu réduit à 7,5 % au-delà de 4\s600 € de gains retirés par an ; prélèvements sociaux \(17,2 %\) toujours dus$/);
  });
});
