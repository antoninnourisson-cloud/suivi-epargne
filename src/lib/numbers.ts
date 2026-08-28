// ================================================
// FILE: src/lib/numbers.ts
// Interprétation des saisies numériques au format français.
// ================================================

/**
 * Interprète une saisie numérique au format français. Renvoie `null` si la saisie n'est pas
 * interprétable, pour que l'appelant distingue « valeur invalide » de « zéro » — distinction
 * essentielle quand la valeur est un solde bancaire.
 *
 * Historique du bug que ça corrige : `NumberInput` passait en `type="number"` pendant le
 * focus. Or un input `type="number"` renvoie `''` dès que son contenu est invalide *à ses
 * yeux* — et `"12,5"` en fait partie. La virgule étant LE séparateur décimal du clavier
 * français (et celui que l'app affiche elle-même via `toLocaleString('fr-FR')`), retaper un
 * montant lu à l'écran produisait `''` → `parseFloat('')` = NaN → `0` enregistré
 * silencieusement. C'est donc à nous de parser, pas au navigateur.
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
 * Variante pour les `<input type="number">` bruts encore présents dans l'app : garantit
 * qu'un champ vidé ou invalide ne propage JAMAIS `NaN` dans les données persistées.
 * `fallback` est la valeur retenue dans ce cas.
 */
export const safeNumber = (raw: string, fallback = 0): number => {
  const parsed = parseFrenchNumber(raw);
  return parsed === null ? fallback : parsed;
};
