// ================================================
// FILE: src/lib/monthRoutine.ts
// « Routine du mois » de l'Accueil : la suite d'étapes de chaque paie, aujourd'hui répartie
// sur quatre écrans (fiche de paie, virements du Pilotage, Actualiser, point de paie). Chaque
// étape est déduite des données déjà là, sans case à cocher en plus :
//  1. la fiche de paie du mois est importée (Fiches de paie) ;
//  2. les virements de la paie sont tous cochés (Pilotage › Où le placer) ;
//  3. les soldes sont actualisés : comptes courants et livrets vérifiés depuis la paie, et
//     aucun compte en retard (Actualiser) ;
//  4. le point de paie de la paie précédente est validé (carte de l'Accueil).
// Une étape qui ne concerne pas l'utilisateur est retirée (aucune fiche de paie jamais
// importée, Pilotage sans paie, motivation coupée). Fonction pure, testée.
// ================================================
import type { PayChecklist, PayslipRecord, SavingsAccount } from '../types';
import { payPeriodOf } from './finance';
import { findStaleBalances, freshnessLimitDays, lastBalanceCheck } from './freshness';
import { formatISODay } from './dates';
import { elideDe, formatPeriod } from './format';

export type RoutineStepKey = 'payslip' | 'transfers' | 'balances' | 'review';

export interface RoutineStep {
  key: RoutineStepKey;
  label: string;
  /** Où en est l'étape, en quelques mots (« 3 sur 5 cochés », « 2 comptes à actualiser »). */
  detail: string;
  done: boolean;
  /** Bouton qui mène à l'étape (absent une fois faite). */
  action: string;
}

export interface MonthRoutine {
  /** Paie concernée ('YYYY-MM', payPeriodOf). */
  periodKey: string;
  /** Mois de la paie, en toutes lettres (« octobre »). */
  monthName: string;
  steps: RoutineStep[];
  doneCount: number;
  complete: boolean;
}

/** Délai de fraîcheur au-delà duquel un compte n'est pas revu chaque mois (placements à relevé annuel). */
const MONTHLY_LIMIT_DAYS = 90;

const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`;

export const computeMonthRoutine = (input: {
  accounts: SavingsAccount[];
  payslips?: PayslipRecord[];
  payChecklist?: PayChecklist;
  /** Paie nette mensuelle du Pilotage : sans elle, pas de virements de paie à cocher. */
  monthlyPay?: number;
  paydayDay?: number;
  now: Date;
  /** Point de paie proposé (lib/motivation) : absent si la motivation est coupée. */
  payReviewKey?: string;
  payReviewsDone?: string[];
}): MonthRoutine | null => {
  const { accounts, payslips = [], payChecklist, now } = input;
  if (accounts.length === 0) return null;
  const period = payPeriodOf(input.paydayDay, now);
  const monthName = period.payDate.toLocaleDateString('fr-FR', { month: 'long' });
  const steps: RoutineStep[] = [];

  // 1. Fiche de paie du mois : seulement pour qui en importe.
  if (payslips.length > 0) {
    const done = payslips.some(p => p.extracted.period?.trim() === period.key);
    steps.push({ key: 'payslip', label: `Fiche de paie ${elideDe(formatPeriod(period.key))}`, detail: done ? 'Importée' : 'À importer', done, action: 'Importer' });
  }

  // 2. Virements de la paie, cochés dans le Pilotage (liste figée pour cette paie).
  if ((input.monthlyPay ?? 0) > 0 || payChecklist) {
    const frozen = payChecklist && payChecklist.month === period.key ? payChecklist : undefined;
    const total = frozen?.lines.length ?? 0;
    const checked = frozen ? frozen.lines.filter(l => frozen.done[l.key]).length : 0;
    const done = !!frozen && checked === total;
    steps.push({
      key: 'transfers', label: 'Virements de la paie',
      detail: done ? 'Tous cochés' : frozen ? `${checked} sur ${total} cochés` : 'À cocher dans le Pilotage',
      done, action: 'Cocher',
    });
  }

  // 3. Soldes : comptes revus chaque mois vérifiés depuis la paie, et aucun compte en retard.
  const todayISO = formatISODay(now);
  const payISO = formatISODay(period.payDate);
  const toCheck = new Set(findStaleBalances(accounts, now).map(s => s.id));
  for (const a of accounts) {
    const limit = freshnessLimitDays(a.type);
    if (a.totalAmount <= 0.005 || limit === null || limit > MONTHLY_LIMIT_DAYS) continue;
    const checkedOn = lastBalanceCheck(a, todayISO);
    if (!checkedOn || checkedOn < payISO) toCheck.add(a.id);
  }
  steps.push({
    key: 'balances', label: 'Soldes actualisés',
    detail: toCheck.size === 0 ? 'À jour' : `${plural(toCheck.size, 'compte')} à actualiser`,
    done: toCheck.size === 0, action: 'Actualiser',
  });

  // 4. Point de paie (bilan de la paie précédente), validé sur l'Accueil.
  if (input.payReviewKey) {
    const done = (input.payReviewsDone ?? []).includes(input.payReviewKey);
    steps.push({ key: 'review', label: `Point de paie ${elideDe(formatPeriod(input.payReviewKey))}`, detail: done ? 'Validé' : 'À valider', done, action: 'Voir' });
  }

  // Une seule étape : pas une routine, la liste « À faire » suffit.
  if (steps.length < 2) return null;
  const doneCount = steps.filter(s => s.done).length;
  return { periodKey: period.key, monthName, steps, doneCount, complete: doneCount === steps.length };
};
