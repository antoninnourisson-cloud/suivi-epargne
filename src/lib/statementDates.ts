// Dates d'un relevé, utiles aussi à la commande d'import (lib/commands/statement.ts) : à part
// de statementImport, chargé seulement avec l'écran d'import, pour rester hors du code de
// démarrage.
import type { SavingsAccount } from '../types';

/** Jour AAAA-MM-JJ qui existe au calendrier (années 2000 à 2100). */
export const isISODay = (v: unknown): v is string => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split('-').map(Number);
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(y, m, 0).getDate();
};

/**
 * Solde du relevé plus ancien que ce que le compte sait déjà : son dernier solde vérifié
 * (`checked`), ou un mouvement enregistré après la date du relevé (`movement`, le plus récent).
 * Le reprendre ramènerait le compte en arrière : ce qui a bougé depuis serait effacé par une
 * fausse « Actualisation ».
 */
export interface OlderBalance { since: string; reason: 'checked' | 'movement' }

/** Voir `OlderBalance` ; `null` : le relevé n'est pas plus ancien que le compte. */
export const olderThanBalance = (account: Pick<SavingsAccount, 'balanceCheckedAt' | 'movements'>, closingDate: string): OlderBalance | null => {
  if (account.balanceCheckedAt && isISODay(account.balanceCheckedAt) && account.balanceCheckedAt > closingDate) {
    return { since: account.balanceCheckedAt, reason: 'checked' };
  }
  let latest: string | undefined;
  for (const m of account.movements) {
    if (isISODay(m.date) && m.date > closingDate && (!latest || m.date > latest)) latest = m.date;
  }
  return latest ? { since: latest, reason: 'movement' } : null;
};
