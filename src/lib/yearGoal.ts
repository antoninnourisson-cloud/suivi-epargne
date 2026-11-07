// Objectif annuel (`config.yearGoals`), fixé à la clôture de l'année d'avant : une ligne dans
// la carte de l'objectif du mois de l'Accueil (« Objectif 2027 : 1 200 € sur 9 000 € »). Le mis
// de côté depuis le 1er janvier se compte comme dans « Votre année » (computeYearReview).
// Chargé à part avec les calculs datés de l'Accueil (app/seasonal).
import type { GlobalAppData } from '../types';
import { computeYearReview } from './agenda';
import { computeMonthlySavingsCapacity } from './finance';

/**
 * Rythme d'épargne prévu par le plan de l'app, en euros par mois : le montant du plan de paie
 * (Pilotage) s'il existe, sinon la capacité d'épargne calculée. 0 : pas de plan. Même source
 * que la page « Cap sur » de « Votre année » (lib/yearReview) et que l'objectif proposé à la
 * clôture de l'année (lib/yearClosingSheet).
 */
export const plannedMonthlySaving = (data: GlobalAppData): number => {
  const plan = data.config?.paydayAmount ?? computeMonthlySavingsCapacity(data);
  return Number.isFinite(plan) && plan > 0 ? plan : 0;
};

export interface YearGoalProgress { year: number; goal: number; saved: number }

/** Objectif de l'année en cours et mis de côté depuis le 1er janvier ; `null` sans objectif. */
export const yearGoalProgress = (data: GlobalAppData, now: Date = new Date()): YearGoalProgress | null => {
  const year = now.getFullYear();
  const goal = data.config?.yearGoals?.[String(year)];
  if (!(typeof goal === 'number' && goal > 0)) return null;
  return { year, goal, saved: Math.round(computeYearReview(data, year, now).saved) };
};
