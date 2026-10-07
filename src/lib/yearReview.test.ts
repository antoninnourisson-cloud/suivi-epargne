import { describe, it, expect } from 'vitest';
import { buildYearInReview, defaultReviewYear, yearsWithData } from './yearReview';
import { computeYearReview } from './agenda';
import { AccountMovement, AccountType, GlobalAppData, SavingsAccount } from '../types';

const acc = (over: Partial<SavingsAccount>): SavingsAccount => ({
  id: 'x', name: 'x', type: AccountType.LIVRET_A, institution: 'B',
  totalAmount: 1000, ownedAmount: 1000, parentalCapital: 0, interestRate: 0, movements: [], ...over,
});
const mv = (date: string, amount: number, type: 'IN' | 'OUT' = 'IN'): AccountMovement => ({ id: `${date}-${amount}-${type}`, date, amount, label: 'Épargne', type });

// 2025 : 600 € le 28 de chaque mois (paie le 27), sauf juin (100 €). Livret A à 3 %.
const moves2025 = Array.from({ length: 12 }, (_, m) => mv(`2025-${String(m + 1).padStart(2, '0')}-28`, m === 5 ? 100 : 600));
const total2025 = moves2025.reduce((s, m) => s + m.amount, 0); // 6 700
const base = (over: Partial<GlobalAppData> = {}): GlobalAppData => ({
  accounts: [acc({
    id: 'la', name: 'Livret A', totalAmount: 15000, ownedAmount: 15000, interestRate: 3, openingDate: '2020-01-01',
    movements: [{ id: 'init', date: '2024-12-01', amount: 8300, label: 'Solde initial', type: 'IN', tag: 'initial' }, ...moves2025],
  })],
  expenses: [], history: [],
  config: { grossAnnual: 32000, leisureBudget: 0, projectSavings: 0, taxRateManual: 0, extraMonthlyIncome: 0, paydayDay: 27, paydayAmount: 700 },
  ...over,
});
// Les montants formatés utilisent des espaces insécables : on les normalise.
const plain = (s?: string) => (s ?? '').replace(/[  ]/g, ' ');
const NOW = new Date(2026, 0, 5, 9); // 5 janvier 2026 : 2025 est terminée

describe('buildYearInReview', () => {
  it('raconte une année complète dans l\'ordre, avec les chiffres de computeYearReview', () => {
    const data = base();
    const r = buildYearInReview(data, 2025, NOW);
    const review = computeYearReview(data, 2025, NOW);
    expect(r.complete).toBe(true);
    expect(r.empty).toBe(false);
    expect(review.saved).toBe(total2025);
    expect(r.headline.id).toBe('saved');
    expect(r.headline.label).toBe('Mis de côté en 2025');
    expect(plain(r.headline.value)).toBe('6 700 €');
    const ids = r.pages.map(p => p.id);
    expect(ids[0]).toBe('saved');
    expect(ids).toEqual(expect.arrayContaining(['rate', 'net', 'interest', 'good-months', 'best-month', 'milestones', 'next-year']));
    expect(ids.indexOf('net')).toBeLessThan(ids.indexOf('good-months'));
    expect(ids[ids.length - 1]).toBe('next-year');

    const page = (id: string) => r.pages.find(p => p.id === id)!;
    expect(plain(page('net').value)).toBe('15 000 €');
    expect(plain(page('net').text)).toContain('8 300 €');
    expect(plain(page('net').text)).toMatch(/\+6 700 €.*\+81 %/);
    expect(page('interest').label).toBe('Intérêts gagnés');
    expect(plain(page('best-month').value)).toBe('Janvier');
    // Juin raté (100 €) : couvert par le joker, la série continue.
    expect(plain(page('good-months').value)).toBe('11 sur 12');
    expect(plain(page('good-months').text)).toContain('joker');
    expect(plain(page('good-months').text)).toContain('11 bons mois d\'affilée');
    expect(page('good-months').game).toBe(true);
    expect(page('milestones').items?.map(plain)).toEqual(expect.arrayContaining(['Premier bon mois', '3 bons mois d\'affilée', '6 bons mois d\'affilée', '10 000 € d\'épargne']));
    expect(page('milestones').items).not.toContain('12 bons mois d\'affilée');
    expect(page('next-year').label).toBe('Cap sur 2026');
    expect(plain(page('next-year').text)).toContain('8 400 €');
  });

  it('sans gamification : ni bons mois ni jalons, les chiffres restent', () => {
    const data = base({ config: { ...base().config, gamification: false } });
    const r = buildYearInReview(data, 2025, NOW);
    expect(r.gamification).toBe(false);
    expect(r.pages.some(p => p.game)).toBe(false);
    expect(r.pages.map(p => p.id)).toEqual(expect.arrayContaining(['saved', 'rate', 'net', 'interest', 'best-month']));
  });

  it('année vide : aucune page, mais un chiffre d\'ouverture', () => {
    const r = buildYearInReview(base(), 2023, NOW);
    expect(r.empty).toBe(true);
    expect(r.pages).toEqual([]);
    expect(plain(r.headline.value)).toBe('0 €');
  });

  it('année en cours : libellés « en cours » et intérêts attendus', () => {
    const r = buildYearInReview(base(), 2025, new Date(2025, 9, 7, 9));
    expect(r.complete).toBe(false);
    expect(r.headline.text).toContain("L'année n'est pas finie");
    expect(r.pages.find(p => p.id === 'interest')?.label).toBe('Intérêts attendus sur l\'année');
    expect(r.pages.find(p => p.id === 'net')?.text).toContain('aujourd\'hui');
  });

  it('met en avant la restitution de l\'année et annonce le passage en solo', () => {
    const done = { date: '2025-12-30', accounts: [{ accountId: 'la', name: 'Livret A', amount: 9500 }], interestsOffered: [] };
    const r = buildYearInReview(base({ parentalRestitution: { done } }), 2025, NOW);
    const p = r.pages.find(x => x.id === 'restitution')!;
    expect(plain(p.value)).toBe('9 500 €');
    expect(plain(p.text)).toContain('Vous avez rendu 9 500 € à vos parents');

    const planned = buildYearInReview(base({ parentalRestitution: { plannedDate: '2026-12-31' } }), 2025, NOW);
    expect(planned.pages.some(x => x.id === 'restitution')).toBe(false);
    expect(plain(planned.pages.find(x => x.id === 'next-year')?.text)).toContain('en solo');
  });

  it('suivi commencé en cours d\'année : le solde de départ est reconstitué au 1er janvier', () => {
    const data = base({ history: [{ date: '2025-10-07', totalAmount: 15000, ownedAmount: 15000 }] });
    const net = buildYearInReview(data, 2025, NOW).pages.find(p => p.id === 'net')!;
    expect(plain(net.text)).toContain('8 300 € en début d\'année');
  });

  it('pas de mot pour l\'année suivante quand elle est déjà passée', () => {
    const r = buildYearInReview(base(), 2025, new Date(2027, 5, 1));
    expect(r.pages.some(p => p.id === 'next-year')).toBe(false);
  });
});

describe('yearsWithData / defaultReviewYear', () => {
  it('liste les années racontables, la plus récente d\'abord', () => {
    expect(yearsWithData(base(), NOW)).toEqual([2026, 2025]);
  });
  it('propose l\'année écoulée jusqu\'en mars', () => {
    expect(defaultReviewYear([2026, 2025], NOW)).toBe(2025);
    expect(defaultReviewYear([2026, 2025], new Date(2026, 9, 7))).toBe(2026);
  });
});
