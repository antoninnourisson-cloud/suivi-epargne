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
 */
export const parseFrenchNumber = (input: string): number | null => {
  // `\s` couvre aussi les espaces insécables (U+00A0 / U+202F) que produit `toLocaleString`
  // comme séparateur de milliers, donc un montant réaffiché puis resoumis reste valide.
  const cleaned = input.replace(/\s/g, '').replace(/€/g, '').replace(',', '.');
  if (cleaned === '') return null;
  // `Number()` et non `parseFloat` : ce dernier accepte "12abc" et renvoie 12, ce qui
  // transformerait une faute de frappe en montant plausible.
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
};

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
