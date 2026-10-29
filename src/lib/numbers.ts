// ================================================
// FILE: src/lib/numbers.ts
// Interprétation des saisies numériques au format français.
// ================================================

/**
 * Interprète une saisie numérique au format français. Renvoie `null` si la saisie n'est pas
 * interprétable, pour que l'appelant distingue « valeur invalide » de « zéro » — distinction
 * essentielle quand la valeur est un solde bancaire.
 *
 * Pourquoi ne pas laisser faire le navigateur : un input `type="number"` renvoie `''` dès que
 * son contenu est invalide *à ses yeux* — et `"12,5"` en fait partie. La virgule étant LE
 * séparateur décimal du clavier français (et celui que l'app affiche elle-même via
 * `toLocaleString('fr-FR')`), un montant relu à l'écran puis retapé donnerait `''` →
 * `parseFloat('')` = NaN → `0` enregistré sans rien dire. C'est donc à nous de parser.
 *
 * Formats acceptés : chiffres, un seul séparateur décimal (virgule, ou point), espaces de
 * milliers, signe, « € ». Refusés (`null`) plutôt que devinés : exposant (« 2,5e3 »),
 * hexadécimal (« 0x10 »), plusieurs séparateurs (« 1.234,56 ») et le point suivi d'un
 * groupe de 3 chiffres après 1 à 3 chiffres (« 12.500 ») : point des milliers (copié d'un
 * site) ou décimales ? Il était lu 12,5, mille fois trop peu, sans rien dire. « 12 500 »,
 * « 12500 », « 12,5 », « 12.5 », « 1,725 » et « 0.125 » restent lisibles.
 */
export const parseFrenchNumber = (input: string): number | null => {
  // `\s` couvre aussi les espaces insécables (U+00A0 / U+202F) que produit `toLocaleString`
  // comme séparateur de milliers, donc un montant réaffiché puis resoumis reste valide.
  const cleaned = input.replace(/\s/g, '').replace(/€/g, '');
  if (!PLAIN_NUMBER.test(cleaned) || isAmbiguousThousands(input)) return null;
  // `Number()` et non `parseFloat` : ce dernier accepte "12abc" et renvoie 12, ce qui
  // transformerait une faute de frappe en montant plausible.
  const parsed = Number(cleaned.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
};

/** Signe facultatif, chiffres, au plus un séparateur décimal suivi de chiffres. */
const PLAIN_NUMBER = /^[+-]?(\d+([.,]\d*)?|[.,]\d+)$/;

/**
 * « 12.500 », « -1.250 € » : 1 à 3 chiffres (sans zéro en tête), un point, exactement
 * 3 chiffres. Ambigu (point des milliers ou décimales) : refusé, l'écran peut le dire.
 */
export const isAmbiguousThousands = (input: string): boolean =>
  /^[+-]?[1-9]\d{0,2}\.\d{3}$/.test(input.replace(/\s/g, '').replace(/€/g, ''));

/**
 * Variante avec valeur de repli : un champ vidé ou invalide ne propage JAMAIS `NaN` dans les
 * données enregistrées. `fallback` est la valeur retenue dans ce cas.
 */
export const safeNumber = (raw: string, fallback = 0): number => {
  const parsed = parseFrenchNumber(raw);
  return parsed === null ? fallback : parsed;
};

/**
 * Taux stocké en fraction (0,186) ↔ affiché en pourcentage (18,6 %). Arrondi pour effacer le
 * bruit des nombres à virgule (18,6 / 100 donne 0,18600000000000003) sans perdre une
 * décimale utile (0,2232 → 22,32 %).
 */
export const fractionToPercent = (fraction: number): number => Math.round(fraction * 100 * 1e6) / 1e6;
export const percentToFraction = (percent: number): number => Math.round((percent / 100) * 1e8) / 1e8;
