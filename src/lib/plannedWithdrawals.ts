// Retraits prévus par « J'ai besoin d'argent » (config.plannedWithdrawals, voir lib/needMoney) :
// nettoyage pour migrate, sans changer de version du schéma, et tâches du jour de l'Accueil.
// Module léger (sans calcul financier) : lu par migrate et l'Accueil.
import type { PlannedWithdrawal, PlannedWithdrawalLine } from '../types';

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Retraits prévus lisibles (migrate) ; `undefined` s'il n'en reste aucun. Champs inconnus conservés. */
export const sanitizePlannedWithdrawals = (raw: unknown): PlannedWithdrawal[] | undefined => {
  if (!Array.isArray(raw)) return undefined;
  const out = raw.flatMap((p): PlannedWithdrawal[] => {
    if (!isObj(p) || typeof p.id !== 'string' || !p.id) return [];
    if (typeof p.date !== 'string' || !ISO_DAY.test(p.date) || typeof p.needDate !== 'string' || !ISO_DAY.test(p.needDate)) return [];
    const lines = (Array.isArray(p.lines) ? p.lines : []).filter((l): l is PlannedWithdrawalLine =>
      isObj(l) && typeof l.accountId === 'string' && !!l.accountId && typeof l.amount === 'number' && Number.isFinite(l.amount) && l.amount > 0);
    return lines.length > 0 ? [{ ...p, lines } as PlannedWithdrawal] : [];
  });
  return out.length > 0 ? out : undefined;
};

/** Retraits prévus dont le jour est venu. */
export const duePlannedWithdrawals = (plans: PlannedWithdrawal[] | undefined, todayISO: string): PlannedWithdrawal[] =>
  (plans ?? []).filter(p => p.date <= todayISO);
