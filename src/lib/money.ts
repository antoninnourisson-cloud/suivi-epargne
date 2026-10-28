// Petits outils pour les montants : arrondi au centime, sens d'un mouvement, tolérance.
// Un seul endroit plutôt qu'une vingtaine de copies de `Math.round(x * 100) / 100`.
import type { AccountMovement } from '../types';

/**
 * Arrondi au centime, au plus proche, les demi-centimes s'éloignant de zéro (comme à la
 * main) : 1,005 → 1,01 et −1,005 → −1,01.
 * `Math.round(n * 100) / 100` se trompe sur les demi-centimes, que le binaire ne sait pas
 * représenter exactement (1,005 × 100 = 100,49999… → 1,00), et n'est pas symétrique
 * (Math.round(−100,5) = −100). Le produit par 100 est donc ramené à 15 chiffres significatifs
 * (la précision d'un double) avant l'arrondi, ce qui efface ce bruit sans changer les autres
 * montants. Jamais de « −0 » (affiché « −0,00 € »).
 */
export const round2 = (n: number): number => {
  if (!Number.isFinite(n)) return n;
  const cents = Math.round(Number((Math.abs(n) * 100).toPrecision(15)));
  return cents === 0 ? 0 : (Math.sign(n) * cents) / 100;
};

/** Écart sous lequel deux montants sont considérés égaux (un demi-centime). */
export const EPS = 0.005;

/** Montant signé d'un mouvement : positif pour une entrée, négatif pour une sortie. */
export const signedAmount = (m: Pick<AccountMovement, 'type' | 'amount'>) => (m.type === 'IN' ? m.amount : -m.amount);
