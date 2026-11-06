// Envies d'achats (onglet « Envies » du Pilotage) : catégories, nettoyage pour migrate (sans
// changer de version du schéma), regroupement, totaux, ancienneté du prix et opérations pures
// sur la liste. Module léger (aucun calcul financier) : lu par migrate et par l'écran.
// Une envie ne touche jamais aux soldes ; elle n'est jamais envoyée à Gemini (askSnapshot).
import type { Wish } from '../types';
import { formatISODay, parseISODate } from './dates';
import { frenchDay } from './format';
import { round2 } from './money';

/** Catégories proposées tant que l'utilisateur n'a pas fait les siennes. */
export const DEFAULT_WISH_CATEGORIES: readonly string[] = ['Maison', 'Livres', 'Gros projets', 'Loisirs', 'Tech'];
/** Catégorie d'une envie lue sans catégorie dans un fichier abîmé. */
export const FALLBACK_WISH_CATEGORY = 'Autres';
/** Au-delà de ce nombre de mois, un prix est « à revérifier ». */
export const STALE_PRICE_MONTHS = 3;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Jour 'AAAA-MM-JJ' qui existe vraiment (pas de 31 février). */
export const isValidDay = (v: unknown): v is string => typeof v === 'string' && ISO_DAY.test(v) && formatISODay(parseISODate(v)) === v;

// ---------------------------------------------------------------------------
// Liens
// ---------------------------------------------------------------------------

/** Lien http ou https lisible (tel quel), sinon `undefined` : jamais « javascript: » ni autre schéma. */
export const safeWishUrl = (raw: unknown): string | undefined => {
  if (typeof raw !== 'string') return undefined;
  const text = raw.trim();
  if (!/^https?:\/\//i.test(text)) return undefined;
  try {
    const u = new URL(text);
    return (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname ? text : undefined;
  } catch { return undefined; }
};

/** Saisie d'un lien : « exemple.fr/livre » devient « https://exemple.fr/livre » ; un autre schéma est refusé. */
export const normalizeWishUrl = (input: string): string | undefined => {
  const text = input.trim();
  if (!text) return undefined;
  if (/^[a-z][a-z0-9+.-]*:/i.test(text) && !/^https?:\/\//i.test(text)) return undefined;
  return safeWishUrl(/^https?:\/\//i.test(text) ? text : `https://${text}`);
};

// ---------------------------------------------------------------------------
// Catégories
// ---------------------------------------------------------------------------

const sameName = (a: string, b: string) => a.trim().toLocaleLowerCase('fr') === b.trim().toLocaleLowerCase('fr');

/** Catégories lisibles (migrate) : noms nettoyés, sans doublon ; `undefined` s'il n'en reste aucune. */
export const sanitizeWishCategories = (raw: unknown): string[] | undefined => {
  if (!Array.isArray(raw)) return undefined;
  const out: string[] = [];
  for (const c of raw) {
    if (typeof c !== 'string') continue;
    const name = c.trim();
    if (name && !out.some(o => sameName(o, name))) out.push(name);
  }
  return out.length > 0 ? out : undefined;
};

/** Catégories à afficher : celles du fichier, sinon celles par défaut. */
export const wishCategoriesOf = (stored: readonly string[] | undefined): string[] =>
  (stored && stored.length > 0 ? [...stored] : [...DEFAULT_WISH_CATEGORIES]);

/** Ajoute une catégorie : refus (texte) si le nom est vide ou déjà pris. */
export const addWishCategory = (categories: readonly string[], name: string): { ok: true; categories: string[] } | { ok: false; error: string } => {
  const n = name.trim();
  if (!n) return { ok: false, error: 'Donnez un nom à la catégorie.' };
  if (categories.some(c => sameName(c, n))) return { ok: false, error: 'Cette catégorie existe déjà.' };
  return { ok: true, categories: [...categories, n] };
};

/** Renomme une catégorie (et seulement elle) ; refus si le nouveau nom est vide ou pris par une autre. */
export const renameWishCategory = (categories: readonly string[], from: string, to: string): { ok: true; categories: string[] } | { ok: false; error: string } => {
  const n = to.trim();
  if (!n) return { ok: false, error: 'Donnez un nom à la catégorie.' };
  if (categories.some(c => c !== from && sameName(c, n))) return { ok: false, error: 'Cette catégorie existe déjà.' };
  return { ok: true, categories: categories.map(c => (c === from ? n : c)) };
};

/** Envies d'une catégorie (achetées comprises) : elle ne peut pas être retirée tant qu'il en reste. */
export const wishCountIn = (wishes: readonly Wish[], category: string): number => wishes.filter(w => w.category === category).length;

/** Déplace toutes les envies d'une catégorie vers une autre (renommage ou retrait avec déplacement). */
export const moveWishes = (wishes: Wish[], from: string, to: string): Wish[] =>
  wishes.map(w => (w.category === from ? { ...w, category: to } : w));

// ---------------------------------------------------------------------------
// Nettoyage (migrate)
// ---------------------------------------------------------------------------

/**
 * Envies lisibles (migrate) : une entrée sans nom, au prix non fini ou négatif ou à la date
 * invalide est écartée ; un lien qui n'est pas en http(s) est retiré (l'envie reste) ; une date
 * d'achat illisible fait revenir l'envie dans la liste. Champs inconnus conservés.
 * `undefined` si ce n'est pas une liste.
 */
export const sanitizeWishes = (raw: unknown): Wish[] | undefined => {
  if (!Array.isArray(raw)) return undefined;
  const seen = new Set<string>();
  return raw.flatMap((e): Wish[] => {
    if (!isObj(e) || typeof e.id !== 'string' || !e.id || seen.has(e.id)) return [];
    const name = typeof e.name === 'string' ? e.name.trim() : '';
    const price = typeof e.price === 'number' ? e.price : Number.NaN;
    if (!name || !Number.isFinite(price) || price < 0 || !isValidDay(e.priceDate)) return [];
    seen.add(e.id);
    const { url: _url, note: _note, boughtAt: _boughtAt, boughtPrice: _boughtPrice, ...rest } = e;
    const wish: Wish = {
      ...(rest as unknown as Wish), id: e.id, name, price: round2(price), priceDate: e.priceDate,
      category: typeof e.category === 'string' && e.category.trim() ? e.category.trim() : FALLBACK_WISH_CATEGORY,
    };
    const url = safeWishUrl(e.url);
    if (url) wish.url = url;
    if (typeof e.note === 'string' && e.note.trim()) wish.note = e.note.trim();
    if (isValidDay(e.boughtAt)) {
      wish.boughtAt = e.boughtAt;
      const paid = typeof e.boughtPrice === 'number' && Number.isFinite(e.boughtPrice) && e.boughtPrice >= 0 ? round2(e.boughtPrice) : price;
      wish.boughtPrice = paid;
    }
    return [wish];
  });
};

// ---------------------------------------------------------------------------
// Regroupement et totaux
// ---------------------------------------------------------------------------

export const isBought = (w: Wish): boolean => w.boughtAt !== undefined;
export const openWishes = (wishes: readonly Wish[]): Wish[] => wishes.filter(w => !isBought(w));
/** Achetées, la plus récente d'abord. */
export const boughtWishes = (wishes: readonly Wish[]): Wish[] =>
  wishes.filter(isBought).sort((a, b) => (b.boughtAt ?? '').localeCompare(a.boughtAt ?? ''));

/** Total des prix (euros et centimes exacts). */
export const wishesTotal = (wishes: readonly Wish[]): number => round2(wishes.reduce((s, w) => s + w.price, 0));

export interface WishGroup { category: string; wishes: Wish[]; total: number }

/**
 * Envies à acheter, groupées par catégorie : dans l'ordre des catégories, puis celles que
 * seule une envie connaît (fichier plus ancien, catégorie retirée ailleurs). Une catégorie
 * sans envie à acheter n'est pas listée. Dans un groupe : l'ordre d'ajout.
 */
export const groupWishes = (wishes: readonly Wish[], categories: readonly string[]): WishGroup[] => {
  const open = openWishes(wishes);
  const names = [...categories];
  for (const w of open) if (!names.includes(w.category)) names.push(w.category);
  return names
    .map(category => {
      const list = open.filter(w => w.category === category);
      return { category, wishes: list, total: wishesTotal(list) };
    })
    .filter(g => g.wishes.length > 0);
};

// ---------------------------------------------------------------------------
// Ancienneté du prix
// ---------------------------------------------------------------------------

/** Le prix date de plus de 3 mois (jour pour jour : relevé le 6 août, à revérifier à partir du 7 novembre). */
export const isPriceStale = (priceDate: string, today: Date): boolean => {
  if (!isValidDay(priceDate)) return false;
  const d = parseISODate(priceDate);
  const limit = new Date(d.getFullYear(), d.getMonth() + STALE_PRICE_MONTHS, d.getDate());
  const day = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return day.getTime() > limit.getTime();
};

/** « prix du 6 août : à revérifier », ou `null` tant que le prix est récent. */
export const stalePriceNote = (priceDate: string, today: Date): string | null =>
  (isPriceStale(priceDate, today) ? `prix du ${frenchDay(parseISODate(priceDate))} : à revérifier` : null);

// ---------------------------------------------------------------------------
// Opérations sur la liste
// ---------------------------------------------------------------------------

/** Envie achetée : date et prix payé gardés (le prix de l'envie, sauf indication). */
export const markWishBought = (wishes: Wish[], id: string, todayISO: string, paid?: number): Wish[] =>
  wishes.map(w => (w.id === id && !isBought(w) ? { ...w, boughtAt: todayISO, boughtPrice: paid ?? w.price } : w));

/** « Remettre en envie » : l'achat est défait, l'envie retrouve sa catégorie et son prix. */
export const restoreWish = (wishes: Wish[], id: string): Wish[] =>
  wishes.map(w => {
    if (w.id !== id) return w;
    const { boughtAt: _a, boughtPrice: _p, ...rest } = w;
    return rest;
  });

/**
 * Retire une catégorie. Tant qu'elle a des envies (`count`), il faut dire où les ranger
 * (`moveTo`, une autre catégorie de la liste) ; la dernière catégorie ne se retire pas.
 */
export const removeWishCategory = (
  categories: readonly string[], name: string, count: number, moveTo?: string,
): { ok: true; categories: string[] } | { ok: false; error: string } => {
  if (categories.length <= 1) return { ok: false, error: 'Gardez au moins une catégorie.' };
  if (count > 0 && (!moveTo || moveTo === name || !categories.includes(moveTo))) return { ok: false, error: 'Choisissez où ranger ses envies.' };
  return { ok: true, categories: categories.filter(c => c !== name) };
};
