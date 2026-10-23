// Valeurs calculées à partir du document pour les écrans (sélecteurs). Toutes mémoïsées sur
// le document : elles ne changent pas quand seul l'état de la synchronisation change, et les
// écrans mémoïsés ne sont donc pas re-rendus pour rien. Les calculs eux-mêmes sont des
// fonctions pures de src/lib.
import { useMemo } from 'react';
import type { AppDoc } from '../types';
import { computeMonthlyPay, computeMonthlySavingsCapacity, monthsUntilRestitution, salaryTaxEstimate, subscriptionsAsExpenses, totalFixedCharges, type SalaryTaxEstimate } from '../lib/finance';
import { computeMonthTarget } from '../lib/payAdjustment';
import { buildAgenda } from '../lib/agenda';
import { lepTimelineFromData } from '../lib/lep';
import { buildTaxReturnAlert } from '../lib/taxReturn';
import { computeEmergencyFund, DEFAULT_EMERGENCY_MONTHS } from '../lib/planning';
import { yearClosingStatus } from '../lib/yearClosing';
import { withAssumedRates } from '../lib/performance';

/**
 * `doc` : le document affiché ; `fullData` : le même tel qu'il part sur Drive (avec l'écran
 * courant), recalculé seulement quand le document change.
 */
export const useDerivedData = (doc: AppDoc, fullData: AppDoc) => {
  const c = doc.config;
  // Charges fixes vues par les écrans en lecture seule (survie, simulateur) : charges saisies
  // + abonnements actifs. Le Pilotage, lui, les affiche séparément.
  const allCharges = useMemo(() => [...doc.expenses, ...subscriptionsAsExpenses(doc.subscriptions)], [doc.expenses, doc.subscriptions]);
  // Épargne prévue chaque mois (projections, alertes) : même montant que le rappel de paie.
  const monthPlan = useMemo(() => c.paydayAmount ?? computeMonthlySavingsCapacity(fullData), [c.paydayAmount, fullData]);
  // Objectif de la paie en cours pour la jauge de l'Accueil : comme le Pilotage, il compte la
  // capacité et la somme en plus saisies pour cette paie (lib/payAdjustment).
  const monthGoal = useMemo(() => computeMonthTarget(fullData).total, [fullData]);
  const monthlyPay = useMemo(() => computeMonthlyPay(fullData), [fullData]);
  const agendaNext = useMemo(() => buildAgenda(fullData).events.slice(0, 3), [fullData]);
  const lepTimeline = useMemo(() => lepTimelineFromData(fullData), [fullData]);
  // Saison de la déclaration de revenus (avril à début juin) : rappel dans « À faire ».
  const taxReturnAlert = useMemo(() => buildTaxReturnAlert(fullData), [fullData]);
  // Épargne de précaution : charges fixes + argent plaisir, multipliés par le nombre de mois choisi.
  const emergency = useMemo(
    () => computeEmergencyFund(doc.accounts, totalFixedCharges(doc.expenses, doc.subscriptions) + (c.leisureBudget || 0), c.emergencyMonths ?? DEFAULT_EMERGENCY_MONTHS),
    [doc.accounts, doc.expenses, doc.subscriptions, c.leisureBudget, c.emergencyMonths],
  );
  // Impôt annuel estimé (après décote) et revenu imposable des salaires (le principal et
  // l'autre salaire du Pilotage) : plafonnent la réduction des dons et préremplissent la case
  // 1AJ de l'aide à la déclaration. Même calcul que le Pilotage, pour afficher le même impôt.
  // Une estimation par année de revenus (cette année et l'an passé, qu'on déclare au
  // printemps) : la part exonérée du remboursement transport dépend de l'année.
  const extraMonthlyIncome = c.extraMonthlyIncome ?? 0;
  const taxEstimates = useMemo((): Readonly<Record<number, SalaryTaxEstimate>> | undefined => {
    if (!(c.grossAnnual > 0)) return undefined;
    const thisYear = new Date().getFullYear();
    const input = { grossAnnual: c.grossAnnual, taxRateManual: c.taxRateManual, extraMonthlyIncome };
    return {
      [thisYear]: salaryTaxEstimate(input, doc.fiscalConfig, doc.workBenefits, thisYear),
      [thisYear - 1]: salaryTaxEstimate(input, doc.fiscalConfig, doc.workBenefits, thisYear - 1),
    };
  }, [c.grossAnnual, c.taxRateManual, extraMonthlyIncome, doc.fiscalConfig, doc.workBenefits]);
  // Année en cours : la plus récente des deux.
  const taxEstimate = useMemo(
    () => (taxEstimates ? taxEstimates[Math.max(...Object.keys(taxEstimates).map(Number))] : undefined),
    [taxEstimates],
  );
  // Mois avant la restitution prévue du capital parental (projection du Rendement).
  const restitutionInMonths = useMemo(() => monthsUntilRestitution(doc.parentalRestitution), [doc.parentalRestitution]);
  const activePayslip = useMemo(() => doc.payslips.find(p => p.id === doc.activePayslipId), [doc.payslips, doc.activePayslipId]);
  // Mode solo : plus aucun compte n'a de part parentale (après la restitution). L'écran
  // Part parentale reste accessible tant qu'un relevé de restitution existe.
  const hasParental = useMemo(() => doc.accounts.some(a => a.parentalCapital > 0), [doc.accounts]);
  const showParentalScreen = hasParental || !!doc.parentalRestitution?.done;
  // Clôture de l'année écoulée (lib/yearClosing) : la tâche de janvier-février de l'Accueil.
  const yearClosing = useMemo(() => yearClosingStatus(fullData), [fullData]);
  // Rendement supposé des placements sans taux saisi (performance observée, prudente) : le
  // même pour le Rendement, le simulateur « Et si… » et le plan solo (lib/performance).
  const projectionHypotheses = useMemo(() => withAssumedRates(doc.accounts), [doc.accounts]);

  return useMemo(() => ({
    fullData, allCharges, monthPlan, monthGoal, monthlyPay, agendaNext, lepTimeline, taxReturnAlert,
    emergency, taxEstimate, taxEstimates, restitutionInMonths, activePayslip, hasParental, showParentalScreen, yearClosing, projectionHypotheses,
  }), [fullData, allCharges, monthPlan, monthGoal, monthlyPay, agendaNext, lepTimeline, taxReturnAlert,
    emergency, taxEstimate, taxEstimates, restitutionInMonths, activePayslip, hasParental, showParentalScreen, yearClosing, projectionHypotheses]);
};

export type DerivedData = ReturnType<typeof useDerivedData>;
