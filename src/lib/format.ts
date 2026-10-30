// ================================================
// FILE: src/lib/format.ts
// Formatage des montants, identique sur tous les écrans : « 13,50 € », « 1 250 € ».
// ================================================

const EUR_CENTS = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const EUR_ROUND = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });

/**
 * Mode discret (réglage de cet appareil, hooks/useDiscreetMode) : tous les montants affichés
 * deviennent « •••• € ». Appliqué ici, au formatage, pour couvrir d'un coup les écrans, les
 * phrases générées, les graphiques et les alertes. Ces formateurs ne servent qu'à l'affichage :
 * rien de ce qui part sur Drive ou vers Gemini n'en sort, et les champs de saisie gardent
 * leurs chiffres (NumberInput a son propre format).
 */
// Espace insécable : jamais « •••• » en fin de ligne et « € » à la suivante.
export const DISCREET_AMOUNT = '•••• €';
let discreetAmounts = false;
export const setDiscreetAmounts = (on: boolean): void => { discreetAmounts = on; };
export const isDiscreetAmounts = (): boolean => discreetAmounts;

/**
 * Montant en euros, format français.
 * - 'auto' (défaut) : centimes affichés sur deux chiffres seulement s'il y en a
 *   (13,50 € mais 250 €) — jamais « 13,5 € » ;
 * - 2 : toujours les centimes ;
 * - 0 : arrondi à l'euro, pour les estimations et les totaux.
 */
export const formatEUR = (n: number, decimals: 'auto' | 0 | 2 = 'auto'): string => {
  if (!Number.isFinite(n)) return '—';
  if (discreetAmounts) return DISCREET_AMOUNT;
  if (decimals === 0) return EUR_ROUND.format(n);
  if (decimals === 2) return EUR_CENTS.format(n);
  return Math.round(n * 100) % 100 === 0 ? EUR_ROUND.format(n) : EUR_CENTS.format(n);
};

/** Idem avec un signe explicite : « +13,50 € », « −250 € » (« +•••• € » en mode discret). */
export const formatSignedEUR = (n: number, decimals: 'auto' | 0 | 2 = 'auto'): string =>
  `${n > 0 ? '+' : n < 0 ? '−' : ''}${formatEUR(Math.abs(n), decimals)}`;

/**
 * Arrondi à l'euro, en texte simple (« 1 250 € », espace ordinaire avant le symbole) :
 * phrases générées par les calculs (conseils, propositions de la veille fiscale).
 */
export const plainEUR = (n: number): string => (discreetAmounts ? DISCREET_AMOUNT : `${Math.round(n).toLocaleString('fr-FR')} €`);

/** Valeur éditable dans un champ texte, à la française : « 410,80 », « 250 ». */
export const toInputAmount = (n: number): string =>
  Math.round(n * 100) % 100 === 0 ? String(Math.round(n)) : n.toFixed(2).replace('.', ',');

/** Taux en pourcentage, à la française : « 2,5 % ». */
export const formatRate = (pct: number): string =>
  `${pct.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} %`;

/** « 2026-09 » → « septembre 2026 » ; toute autre valeur est rendue telle quelle. */
export const formatPeriod = (period: string): string => {
  const m = /^(\d{4})-(\d{2})$/.exec(period.trim());
  if (!m) return period;
  return new Date(Number(m[1]), Number(m[2]) - 1, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
};

/** « 1er octobre », « 4 octobre » : l'ordinal du premier du mois, comme en français courant. */
export const frenchDay = (d: Date, withWeekday = false): string => {
  const month = d.toLocaleDateString('fr-FR', { month: 'long' });
  const day = d.getDate() === 1 ? '1er' : String(d.getDate());
  const weekday = withWeekday ? `${d.toLocaleDateString('fr-FR', { weekday: 'long' })} ` : '';
  return `${weekday}${day} ${month}`;
};

/**
 * Élision devant une voyelle, pour les textes assemblés (mois, noms de comptes) :
 * « d'octobre », « de septembre », « l'Assurance vie », « du Livret A ». Le h n'élide pas
 * (h muet ou aspiré, on ne peut pas savoir : « de Hello bank »), ni le y (« de Yomoni »).
 */
const startsWithVowel = (word: string): boolean => /^[aeiouœæ]/i.test(word.trim().normalize('NFD'));
/** « d'avril », « de mai ». */
export const elideDe = (word: string): string => (startsWithVowel(word) ? `d'${word}` : `de ${word}`);
/** « l'Assurance vie », « le Livret A ». */
export const elideLe = (word: string): string => (startsWithVowel(word) ? `l'${word}` : `le ${word}`);
/** « de l'Assurance vie », « du Livret A ». */
export const elideDu = (word: string): string => (startsWithVowel(word) ? `de l'${word}` : `du ${word}`);

/**
 * « 2026-11 » → « novembre » (« novembre 2027 » avec `withYear`) : mois d'épargne, mois de
 * paie. Toute autre valeur est rendue telle quelle.
 */
export const formatMonth = (key: string, withYear = false): string => {
  const m = /^(\d{4})-(\d{2})$/.exec(key.trim());
  if (!m) return key;
  return new Date(Number(m[1]), Number(m[2]) - 1, 1).toLocaleDateString('fr-FR', withYear ? { month: 'long', year: 'numeric' } : { month: 'long' });
};
