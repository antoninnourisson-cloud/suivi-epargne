// Valeurs calculées à partir du document pour les écrans (sélecteurs). Toutes mémoïsées sur
// le document : elles ne changent pas quand seul l'état de la synchronisation change, et les
// écrans mémoïsés ne sont donc pas re-rendus pour rien. Les calculs eux-mêmes sont des
// fonctions pures de src/lib.
// Ce qui dépend de la date du jour la reçoit de useToday : tout est recalculé au passage de
// minuit ou au retour sur l'app un autre jour, même sans changement des données.
import { useEffect, useMemo, useState } from 'react';
import type { AppDoc } from '../types';
import { computeMonthlyPay, computeMonthlySavingsCapacity, monthsUntilRestitution, salaryTaxEstimate, subscriptionsAsExpenses, totalFixedCharges, type SalaryTaxEstimate } from '../lib/finance';
import { computeMonthTarget } from '../lib/payAdjustment';
import type { AgendaEvent } from '../lib/agenda';
import { lepTimelineFromData } from '../lib/lep';
import { computeEmergencyFund, DEFAULT_EMERGENCY_MONTHS } from '../lib/planning';
import { withAssumedRates } from '../lib/performance';
import { useTodayDate } from '../hooks/useToday';
import { recordError } from '../lib/errorJournal';

type Seasonal = typeof import('./seasonal');
let seasonal: Promise<Seasonal> | null = null;
/**
 * Agenda, déclaration et clôture (app/seasonal), chargés une fois et à part du fichier de
 * démarrage. Un échec (réseau, fichier d'une ancienne version) est retenté au prochain appel.
 */
export const loadSeasonal = (): Promise<Seasonal> =>
  (seasonal ??= import('./seasonal').catch((e: unknown) => { seasonal = null; throw e; }));

// Demandé dès le chargement de l'app, en parallèle du démarrage : le plus souvent prêt avant
// que les données arrivent, l'Accueil s'affiche alors d'un bloc.
if (typeof window !== 'undefined') loadSeasonal().catch(() => { /* retenté par useSeasonal */ });

const NO_EVENTS: AgendaEvent[] = [];

/** Le module saisonnier une fois chargé (null avant : ses cartes attendent, sans erreur). */
const useSeasonal = (): Seasonal | null => {
  const [mod, setMod] = useState<Seasonal | null>(null);
  useEffect(() => {
    let alive = true;
    loadSeasonal().then(m => { if (alive) setMod(m); }).catch((e: unknown) => {
      console.warn('Agenda et échéances indisponibles', e);
      recordError('chargement', e);
    });
    return () => { alive = false; };
  }, []);
  return mod;
};

/**
 * `doc` : le document affiché ; `fullData` : le même tel qu'il part sur Drive (avec l'écran
 * courant), recalculé seulement quand le document change.
 */
export const useDerivedData = (doc: AppDoc, fullData: AppDoc) => {
  const c = doc.config;
  const today = useTodayDate();
  const seasonalMod = useSeasonal();
  // Charges fixes vues par les écrans en lecture seule (survie, simulateur) : charges saisies
  // + abonnements actifs. Le Pilotage, lui, les affiche séparément.
  const allCharges = useMemo(() => [...doc.expenses, ...subscriptionsAsExpenses(doc.subscriptions)], [doc.expenses, doc.subscriptions]);
  // Épargne prévue chaque mois (projections, alertes) : même montant que le rappel de paie.
  const monthPlan = useMemo(() => c.paydayAmount ?? computeMonthlySavingsCapacity(fullData), [c.paydayAmount, fullData]);
  // Objectif de la paie en cours pour la jauge de l'Accueil : comme le Pilotage, il compte la
  // capacité et la somme en plus saisies pour cette paie (lib/payAdjustment).
  const monthGoal = useMemo(() => computeMonthTarget(fullData, today).total, [fullData, today]);
  const monthlyPay = useMemo(() => computeMonthlyPay(fullData), [fullData]);
  // Événements à venir ; l'Accueil n'en montre que les premiers (homeAgenda, lib/home).
  const agendaNext = useMemo(() => (seasonalMod ? seasonalMod.buildAgenda(fullData, today).events : NO_EVENTS), [seasonalMod, fullData, today]);
  const lepTimeline = useMemo(() => lepTimelineFromData(fullData, today), [fullData, today]);
  // Saison de la déclaration de revenus (avril à début juin) : rappel dans « À faire ».
  const taxReturnAlert = useMemo(() => (seasonalMod ? seasonalMod.buildTaxReturnAlert(fullData, today) : null), [seasonalMod, fullData, today]);
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
    const thisYear = today.getFullYear();
    const input = { grossAnnual: c.grossAnnual, taxRateManual: c.taxRateManual, extraMonthlyIncome };
    return {
      [thisYear]: salaryTaxEstimate(input, doc.fiscalConfig, doc.workBenefits, thisYear),
      [thisYear - 1]: salaryTaxEstimate(input, doc.fiscalConfig, doc.workBenefits, thisYear - 1),
    };
  }, [c.grossAnnual, c.taxRateManual, extraMonthlyIncome, doc.fiscalConfig, doc.workBenefits, today]);
  // Année en cours : la plus récente des deux.
  const taxEstimate = useMemo(
    () => (taxEstimates ? taxEstimates[Math.max(...Object.keys(taxEstimates).map(Number))] : undefined),
    [taxEstimates],
  );
  // Mois avant la restitution prévue du capital parental (projection du Rendement).
  const restitutionInMonths = useMemo(() => monthsUntilRestitution(doc.parentalRestitution, today), [doc.parentalRestitution, today]);
  const activePayslip = useMemo(() => doc.payslips.find(p => p.id === doc.activePayslipId), [doc.payslips, doc.activePayslipId]);
  // Mode solo : plus aucun compte n'a de part parentale (après la restitution). L'écran
  // Part parentale reste accessible tant qu'un relevé de restitution existe.
  const hasParental = useMemo(() => doc.accounts.some(a => a.parentalCapital > 0), [doc.accounts]);
  const showParentalScreen = hasParental || !!doc.parentalRestitution?.done;
  // Clôture de l'année écoulée (lib/yearClosing) : la tâche de janvier-février de l'Accueil.
  const yearClosing = useMemo(() => (seasonalMod ? seasonalMod.yearClosingStatus(fullData, today) : null), [seasonalMod, fullData, today]);
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
