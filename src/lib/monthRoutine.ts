// ================================================
// FILE: src/lib/monthRoutine.ts
// « Routine de novembre » de l'Accueil : la suite d'étapes de chaque mois d'épargne (de la paie
// reçue à la suivante, lib/payCalendar). Chaque étape est déduite des données déjà là, sans
// case à cocher en plus :
//  1. la paie est reçue et répartie : déclarée dans le rituel « J'ai reçu ma paie », ses
//     virements tous faits, et le bilan du mois précédent validé (étape 0 du rituel, ou carte
//     de l'Accueil) ;
//  2. la fiche de paie du mois est importée (Fiches de paie, ou dans le rituel) ;
//  3. les soldes sont actualisés : comptes courants et livrets vérifiés depuis la paie, et
//     aucun compte en retard (Actualiser).
// Une étape qui ne concerne pas l'utilisateur est retirée (aucune fiche de paie jamais
// importée, Pilotage sans paie ni bilan). Fonction pure, testée.
// ================================================
import type { PayRecord, PayslipRecord, SavingsAccount } from '../types';
import { findStaleBalances, freshnessLimitDays, lastBalanceCheck } from './freshness';
import { formatISODay, parseISODate } from './dates';
import { elideDe, formatMonth, formatPeriod, frenchDay } from './format';
import { isPayReviewDone, liveDone, openPay, payslipPeriodOf } from './payRecords';

export type RoutineStepKey = 'pay' | 'payslip' | 'balances';

export interface RoutineStep {
  key: RoutineStepKey;
  label: string;
  /** Où en est l'étape, en quelques mots (« 3 sur 5 faits », « 2 comptes à actualiser »). */
  detail: string;
  done: boolean;
  /** Bouton qui mène à l'étape (absent une fois faite). */
  action: string;
}

export interface MonthRoutine {
  /** Mois d'épargne concerné ('YYYY-MM', lib/payCalendar). */
  periodKey: string;
  /** Mois d'épargne, en toutes lettres (« novembre »). */
  monthName: string;
  /** La paie de ce mois est déclarée (sinon l'étape « Paie » ouvre le rituel). */
  payDeclared: boolean;
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
  /** Paies déclarées : début du mois d'épargne, virements faits, bilan validé dans le rituel. */
  pays?: PayRecord[];
  /** Paie nette mensuelle du Pilotage : sans elle (ni paie déclarée, ni bilan), pas d'étape « Paie ». */
  monthlyPay?: number;
  paydayDay?: number;
  now: Date;
  /** Bilan du mois d'épargne précédent (lib/motivation) : absent si la motivation est coupée. */
  payReviewKey?: string;
  payReviewsDone?: string[];
}): MonthRoutine | null => {
  const { accounts, payslips = [], pays = [], now } = input;
  if (accounts.length === 0) return null;
  const { window, pay } = openPay({ pays, payslips, accounts, config: { paydayDay: input.paydayDay } }, now);
  const steps: RoutineStep[] = [];

  // 1. Paie reçue et répartie : déclarée, virements faits, bilan du mois précédent validé.
  const reviewPending = !!input.payReviewKey && !isPayReviewDone(input.payReviewKey, input.payReviewsDone, pays);
  if ((input.monthlyPay ?? 0) > 0 || pay || input.payReviewKey) {
    const done = pay ? liveDone(pay.done, accounts) : {};
    const total = pay?.lines.length ?? 0;
    const checked = pay ? pay.lines.filter(l => done[l.key]).length : 0;
    const review = reviewPending ? `Bilan ${elideDe(formatMonth(input.payReviewKey!))} à valider` : '';
    let detail: string, action: string;
    if (!pay) {
      detail = review ? `${review}, puis paie à déclarer` : 'Pas encore déclarée';
      action = "J'ai reçu ma paie";
    } else if (checked < total) {
      detail = `${checked} sur ${total} faits${review ? ` · ${review.charAt(0).toLowerCase()}${review.slice(1)}` : ''}`;
      action = 'Voir';
    } else if (review) {
      detail = review;
      action = 'Voir le bilan';
    } else {
      detail = `Reçue le ${frenchDay(parseISODate(pay.receivedOn))}`;
      action = 'Voir';
    }
    steps.push({ key: 'pay', label: 'Paie reçue et répartie', detail, done: !!pay && checked === total && !reviewPending, action });
  }

  // 2. Fiche de paie du mois (celui qui précède le mois d'épargne) : seulement pour qui en importe.
  if (payslips.length > 0) {
    const period = payslipPeriodOf(window.key);
    const done = payslips.some(p => p.extracted.period?.trim() === period) || (!!pay?.payslipId && payslips.some(p => p.id === pay.payslipId));
    steps.push({ key: 'payslip', label: `Fiche de paie ${elideDe(formatPeriod(period))}`, detail: done ? 'Importée' : 'À importer', done, action: 'Importer' });
  }

  // 3. Soldes : comptes revus chaque mois vérifiés depuis la paie, et aucun compte en retard.
  const todayISO = formatISODay(now);
  const toCheck = new Set(findStaleBalances(accounts, now).map(s => s.id));
  for (const a of accounts) {
    const limit = freshnessLimitDays(a.type);
    if (a.totalAmount <= 0.005 || limit === null || limit > MONTHLY_LIMIT_DAYS) continue;
    const checkedOn = lastBalanceCheck(a, todayISO);
    if (!checkedOn || checkedOn < window.start) toCheck.add(a.id);
  }
  steps.push({
    key: 'balances', label: 'Soldes actualisés',
    detail: toCheck.size === 0 ? 'À jour' : `${plural(toCheck.size, 'compte')} à actualiser`,
    done: toCheck.size === 0, action: 'Actualiser',
  });

  // Une seule étape : pas une routine, la liste « À faire » suffit.
  if (steps.length < 2) return null;
  const doneCount = steps.filter(s => s.done).length;
  return { periodKey: window.key, monthName: formatMonth(window.key), payDeclared: !!pay, steps, doneCount, complete: doneCount === steps.length };
};
