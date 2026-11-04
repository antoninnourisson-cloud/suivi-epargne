// Objectif annuel (`config.yearGoals`), fixé à la clôture de l'année d'avant : une ligne dans
// la carte de l'objectif du mois de l'Accueil (« Objectif 2027 : 1 200 € sur 9 000 € »). Le mis
// de côté depuis le 1er janvier se compte comme dans « Votre année » (computeYearReview).
// Chargé à part avec les calculs datés de l'Accueil (app/seasonal).
import type { GlobalAppData } from '../types';
import { computeYearReview } from './agenda';

export interface YearGoalProgress { year: number; goal: number; saved: number }

/** Objectif de l'année en cours et mis de côté depuis le 1er janvier ; `null` sans objectif. */
export const yearGoalProgress = (data: GlobalAppData, now: Date = new Date()): YearGoalProgress | null => {
  const year = now.getFullYear();
  const goal = data.config?.yearGoals?.[String(year)];
  if (!(typeof goal === 'number' && goal > 0)) return null;
  return { year, goal, saved: Math.round(computeYearReview(data, year, now).saved) };
};
