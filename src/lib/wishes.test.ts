// Envies : nettoyage (migrate), catégories, regroupement, totaux, ancienneté du prix, opérations.
import { describe, it, expect } from 'vitest';
import type { Wish } from '../types';
import {
  addWishCategory, boughtWishes, DEFAULT_WISH_CATEGORIES, groupWishes, isPriceStale, markWishBought, moveWishes, normalizeWishUrl, openWishes,
  removeWishCategory, renameWishCategory, restoreWish, safeWishUrl, sanitizeWishCategories, sanitizeWishes, stalePriceNote, wishCategoriesOf,
  wishCountIn, wishesToComplete, wishesTotal,
} from './wishes';

const wish = (id: string, over: Partial<Wish> = {}): Wish => ({ id, name: `Envie ${id}`, price: 100, priceDate: '2026-11-01', category: 'Maison', ...over });

describe('sanitizeWishes', () => {
  it('écarte les entrées illisibles : nom vide, identifiant absent ou en double', () => {
    const out = sanitizeWishes([
      wish('ok'),
      wish('a', { name: '   ' }),
      { name: 'sans id', price: 5, priceDate: '2026-11-01', category: 'Maison' },
      { ...wish('ok'), name: 'doublon' },
      null, 'texte', 42,
    ]);
    expect(out?.map(w => w.id)).toEqual(['ok']);
  });

  it("garde l'envie sans prix ; un prix présent mais illisible est retiré avec sa date, l'envie reste à compléter", () => {
    const out = sanitizeWishes([
      { id: 'sans', name: 'Valise', category: 'Loisirs' },
      wish('b', { price: Number.NaN }),
      wish('c', { price: -1 }),
      wish('d', { priceDate: '2026-02-31' }),
      wish('e', { priceDate: 'hier' }),
      { ...wish('f'), price: '12' },
      wish('ok', { price: 0 }),
    ])!;
    expect(out.map(w => w.id)).toEqual(['sans', 'b', 'c', 'd', 'e', 'f', 'ok']);
    for (const w of out.slice(0, 6)) { expect('price' in w).toBe(false); expect('priceDate' in w).toBe(false); }
    expect(out[6]).toMatchObject({ price: 0, priceDate: '2026-11-01' });
  });

  it("retire un lien qui n'est pas en http(s), garde l'envie", () => {
    const out = sanitizeWishes([
      wish('a', { url: 'javascript:alert(1)' }),
      wish('b', { url: 'ftp://exemple.fr/x' }),
      wish('c', { url: 'https://exemple.fr/livre' }),
      wish('d', { url: 'http://exemple.fr' }),
      wish('e', { url: 42 as unknown as string }),
    ])!;
    expect(out.map(w => w.url)).toEqual([undefined, undefined, 'https://exemple.fr/livre', 'http://exemple.fr', undefined]);
    expect(out).toHaveLength(5);
  });

  it('nettoie les textes, donne « Autres » à une catégorie absente, garde les champs inconnus', () => {
    const [w] = sanitizeWishes([{ ...wish('a'), name: '  Livre  ', category: '', note: '  ', extra: 'garde-moi' }])!;
    expect(w.name).toBe('Livre');
    expect(w.category).toBe('Autres');
    expect(w.note).toBeUndefined();
    expect((w as unknown as { extra: string }).extra).toBe('garde-moi');
  });

  it("une date d'achat illisible remet l'envie à acheter ; un prix payé illisible reprend le prix", () => {
    const out = sanitizeWishes([
      wish('a', { boughtAt: 'bientôt', boughtPrice: 50 }),
      wish('b', { boughtAt: '2026-10-10', boughtPrice: Number.NaN }),
      wish('c', { boughtAt: '2026-10-10', boughtPrice: 80 }),
    ])!;
    expect(out[0].boughtAt).toBeUndefined();
    expect(out[0].boughtPrice).toBeUndefined();
    expect(out[1]).toMatchObject({ boughtAt: '2026-10-10', boughtPrice: 100 });
    expect(out[2]).toMatchObject({ boughtAt: '2026-10-10', boughtPrice: 80 });
  });

  it("n'est pas une liste : rien ; une liste vide reste vide", () => {
    expect(sanitizeWishes(undefined)).toBeUndefined();
    expect(sanitizeWishes({})).toBeUndefined();
    expect(sanitizeWishes([])).toEqual([]);
  });

  it('est stable : nettoyer deux fois donne le même résultat', () => {
    const once = sanitizeWishes([wish('a', { url: ' https://exemple.fr ', note: ' n ' }), wish('b', { boughtAt: '2026-10-10' })])!;
    expect(sanitizeWishes(once)).toEqual(once);
  });
});

describe('liens', () => {
  it('safeWishUrl : http et https seulement', () => {
    expect(safeWishUrl('https://exemple.fr/a?b=1')).toBe('https://exemple.fr/a?b=1');
    expect(safeWishUrl('HTTP://exemple.fr')).toBe('HTTP://exemple.fr');
    for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'ftp://x.fr', 'exemple.fr', '', 'https://', undefined, null, 3]) expect(safeWishUrl(bad)).toBeUndefined();
  });
  it('normalizeWishUrl : ajoute https:// à une saisie sans schéma, refuse un autre schéma', () => {
    expect(normalizeWishUrl('exemple.fr/livre')).toBe('https://exemple.fr/livre');
    expect(normalizeWishUrl('  http://exemple.fr ')).toBe('http://exemple.fr');
    expect(normalizeWishUrl('javascript:alert(1)')).toBeUndefined();
    expect(normalizeWishUrl('mailto:a@b.fr')).toBeUndefined();
    expect(normalizeWishUrl('')).toBeUndefined();
  });
});

describe('catégories', () => {
  it('par défaut tant que le fichier n’en a pas', () => {
    expect(wishCategoriesOf(undefined)).toEqual([...DEFAULT_WISH_CATEGORIES]);
    expect(wishCategoriesOf([])).toEqual([...DEFAULT_WISH_CATEGORIES]);
    expect(wishCategoriesOf(['Voyages'])).toEqual(['Voyages']);
    expect([...DEFAULT_WISH_CATEGORIES]).toEqual(['Maison', 'Livres', 'Gros projets', 'Loisirs', 'Tech']);
  });
  it('sanitizeWishCategories : noms nettoyés, sans doublon (casse comprise), rien si rien de lisible', () => {
    expect(sanitizeWishCategories([' Maison ', 'maison', '', 3, 'Livres'])).toEqual(['Maison', 'Livres']);
    expect(sanitizeWishCategories([' ', null])).toBeUndefined();
    expect(sanitizeWishCategories('Maison')).toBeUndefined();
  });
  it('ajout : refuse un nom vide ou déjà pris', () => {
    expect(addWishCategory(['Maison'], '  Voyages ')).toEqual({ ok: true, categories: ['Maison', 'Voyages'] });
    expect(addWishCategory(['Maison'], ' ')).toMatchObject({ ok: false });
    expect(addWishCategory(['Maison'], 'MAISON')).toMatchObject({ ok: false });
  });
  it('renommage : change le nom à sa place, refuse un nom pris par une autre', () => {
    expect(renameWishCategory(['Maison', 'Livres'], 'Livres', 'Lecture')).toEqual({ ok: true, categories: ['Maison', 'Lecture'] });
    expect(renameWishCategory(['Maison', 'Livres'], 'Livres', 'maison')).toMatchObject({ ok: false });
    expect(renameWishCategory(['Maison', 'Livres'], 'Livres', 'livres')).toEqual({ ok: true, categories: ['Maison', 'livres'] });
    expect(renameWishCategory(['Maison'], 'Maison', ' ')).toMatchObject({ ok: false });
  });
  it('retrait : sans envie direct ; avec envies, seulement en les déplaçant ; jamais la dernière', () => {
    expect(removeWishCategory(['Maison', 'Livres'], 'Livres', 0)).toEqual({ ok: true, categories: ['Maison'] });
    expect(removeWishCategory(['Maison', 'Livres'], 'Livres', 2)).toMatchObject({ ok: false });
    expect(removeWishCategory(['Maison', 'Livres'], 'Livres', 2, 'Livres')).toMatchObject({ ok: false });
    expect(removeWishCategory(['Maison', 'Livres'], 'Livres', 2, 'Inconnue')).toMatchObject({ ok: false });
    expect(removeWishCategory(['Maison', 'Livres'], 'Livres', 2, 'Maison')).toEqual({ ok: true, categories: ['Maison'] });
    expect(removeWishCategory(['Maison'], 'Maison', 0)).toMatchObject({ ok: false });
  });
  it('déplacement et compte, achetées comprises', () => {
    const list = [wish('a'), wish('b', { category: 'Livres' }), wish('c', { category: 'Livres', boughtAt: '2026-10-10' })];
    expect(wishCountIn(list, 'Livres')).toBe(2);
    expect(moveWishes(list, 'Livres', 'Maison').map(w => w.category)).toEqual(['Maison', 'Maison', 'Maison']);
  });
});

describe('regroupement et totaux', () => {
  const list = [
    wish('a', { price: 349.99 }),
    wish('b', { price: 45, category: 'Livres' }),
    wish('c', { price: 10.01 }),
    wish('d', { price: 199, category: 'Tech', boughtAt: '2026-10-10' }),
    wish('e', { price: 20, category: 'Vieille catégorie' }),
  ];
  it("groupe dans l'ordre des catégories, avec totaux exacts, sans catégorie vide ni envie achetée", () => {
    const groups = groupWishes(list, ['Livres', 'Maison', 'Tech']);
    expect(groups.map(g => [g.category, g.total, g.wishes.length])).toEqual([['Livres', 45, 1], ['Maison', 360, 2], ['Vieille catégorie', 20, 1]]);
  });
  it('total général : seulement ce qui reste à acheter', () => {
    expect(wishesTotal(openWishes(list))).toBe(425);
    expect(wishesTotal([])).toBe(0);
    expect(wishesTotal([wish('x', { price: 0.1 }), wish('y', { price: 0.2 })])).toBe(0.3);
  });
  it('une envie sans prix ne compte pas dans les totaux ; les envies à compléter sont comptées, achetées exclues', () => {
    const noPrice = (id: string, over: Partial<Wish> = {}): Wish => ({ id, name: id, category: 'Maison', ...over });
    const mixed = [wish('a', { price: 30 }), noPrice('b'), noPrice('c', { boughtAt: '2026-10-10' }), noPrice('d')];
    expect(wishesTotal(openWishes(mixed))).toBe(30);
    expect(groupWishes(mixed, ['Maison'])[0].total).toBe(30);
    expect(wishesToComplete(mixed)).toBe(2);
    expect(wishesToComplete([wish('a')])).toBe(0);
    expect(wishesToComplete([])).toBe(0);
  });
  it('acheter une envie sans prix : pas de prix payé inventé', () => {
    const done = markWishBought([{ id: 'a', name: 'a', category: 'Maison' }], 'a', '2026-11-05');
    expect(done[0].boughtAt).toBe('2026-11-05');
    expect('boughtPrice' in done[0]).toBe(false);
  });
  it('achetées : la plus récente d’abord', () => {
    const got = boughtWishes([wish('a', { boughtAt: '2026-09-01' }), wish('b'), wish('c', { boughtAt: '2026-10-10' })]);
    expect(got.map(w => w.id)).toEqual(['c', 'a']);
  });
});

describe('ancienneté du prix', () => {
  const at = (y: number, m: number, d: number) => new Date(y, m - 1, d);
  it('à revérifier au-delà de 3 mois, pas avant', () => {
    expect(isPriceStale('2026-08-06', at(2026, 11, 6))).toBe(false);
    expect(isPriceStale('2026-08-06', at(2026, 11, 7))).toBe(true);
    expect(isPriceStale('2026-11-01', at(2026, 11, 5))).toBe(false);
    expect(isPriceStale('2025-01-01', at(2026, 11, 5))).toBe(true);
  });
  it('une date illisible ne déclenche rien', () => {
    expect(isPriceStale('', at(2026, 11, 5))).toBe(false);
  });
  it('la mention reprend le vocabulaire de l’app', () => {
    expect(stalePriceNote('2026-08-06', at(2026, 11, 20))).toBe('prix du 6 août : à revérifier');
    expect(stalePriceNote('2026-08-01', at(2026, 11, 20))).toBe('prix du 1er août : à revérifier');
    expect(stalePriceNote('2026-10-20', at(2026, 11, 20))).toBeNull();
  });
});

describe('achat et retour en envie', () => {
  it("l'achat garde la date et le prix ; seule l'envie visée change ; deux fois ne change rien", () => {
    const list = [wish('a', { price: 120 }), wish('b')];
    const done = markWishBought(list, 'a', '2026-11-05');
    expect(done[0]).toMatchObject({ boughtAt: '2026-11-05', boughtPrice: 120 });
    expect(done[1]).toBe(list[1]);
    expect(markWishBought(done, 'a', '2026-12-01')[0].boughtAt).toBe('2026-11-05');
    expect(markWishBought(list, 'a', '2026-11-05', 99)[0].boughtPrice).toBe(99);
  });
  it('« Remettre en envie » défait l’achat', () => {
    const back = restoreWish(markWishBought([wish('a')], 'a', '2026-11-05'), 'a')[0];
    expect(back.boughtAt).toBeUndefined();
    expect('boughtPrice' in back).toBe(false);
    expect(back).toMatchObject({ name: 'Envie a', price: 100, category: 'Maison' });
  });
});
