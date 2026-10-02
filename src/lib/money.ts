// Petits outils pour les montants : arrondi au centime, sens d'un mouvement, tolérance.
// Un seul endroit plutôt qu'une vingtaine de copies de `Math.round(x * 100) / 100`.
import type { AccountMovement } from '../types';

/** Arrondi au centime. */
export const round2 = (n: number) => Math.round(n * 100) / 100;

/** Écart sous lequel deux montants sont considérés égaux (un demi-centime). */
export const EPS = 0.005;

/** Montant signé d'un mouvement : positif pour une entrée, négatif pour une sortie. */
export const signedAmount = (m: Pick<AccountMovement, 'type' | 'amount'>) => (m.type === 'IN' ? m.amount : -m.amount);
