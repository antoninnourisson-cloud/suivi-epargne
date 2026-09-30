// ================================================
// FILE: src/lib/format.ts
// Formatage des montants, identique sur tous les écrans : « 13,50 € », « 1 250 € ».
// ================================================

const EUR_CENTS = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const EUR_ROUND = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });

/**
 * Montant en euros, format français.
 * - 'auto' (défaut) : centimes affichés sur deux chiffres seulement s'il y en a
 *   (13,50 € mais 250 €) — jamais « 13,5 € » ;
 * - 2 : toujours les centimes ;
 * - 0 : arrondi à l'euro, pour les estimations et les totaux.
 */
export const formatEUR = (n: number, decimals: 'auto' | 0 | 2 = 'auto'): string => {
  if (!Number.isFinite(n)) return '—';
  if (decimals === 0) return EUR_ROUND.format(n);
  if (decimals === 2) return EUR_CENTS.format(n);
  return Math.round(n * 100) % 100 === 0 ? EUR_ROUND.format(n) : EUR_CENTS.format(n);
};

/** Idem avec un signe explicite : « +13,50 € », « −250 € ». */
export const formatSignedEUR = (n: number, decimals: 'auto' | 0 | 2 = 'auto'): string =>
  `${n > 0 ? '+' : n < 0 ? '−' : ''}${formatEUR(Math.abs(n), decimals)}`;
