// Accueil : votre épargne et sa disponibilité, la liste « À faire », le mois en cours et ce qui
// arrive, puis « Plus de détails » (repliable). Les règles sont dans lib/home (fonctions pures
// testées) ; cet écran garde l'état d'affichage et le rendu.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, ArrowRightLeft, CalendarCheck, ChevronDown, ClipboardCheck, Clock, Download, FileWarning, Gift, Landmark, LifeBuoy,
  Percent, PiggyBank, Repeat, ShieldAlert, Trash2, TrendingUp, Wallet,
} from 'lucide-react';
import type { LepTimeline } from '../lib/lep';
import { TodoList, type TodoSpec } from './TodoList';
import type { View } from '../navigation';
import type { EmergencyFund } from '../lib/planning';
import type { AgendaEvent } from '../lib/agenda';
import type { TaxReturnAlert } from '../lib/taxReturn';
import { revealElementById } from './revealElement';
import type { SavingsAccount, PortfolioSnapshot, FiscalConfig, RecurringMovement, Subscription, PayslipRecord, PayChecklist, PayRecord } from '../types';
import {
  computeUnlockCost, findFiscalReview, applyTaxScale, findAvRateUpdatesDue, confirmRatesUnchanged, findDueRecurring,
  findStaleRegulatedRates, computeAccountBalanceAtDate, suggestedRestitutionDate, computeAvailabilityBreakdown, ownedAmountAt,
} from '../lib/finance';
import { parseISODate } from '../lib/dates';
import { useToday } from '../hooks/useToday';
import { DeltaBadge, MoneyText, PageHeader, Sparkline, StatTile, Card } from './ui';
import { AvailabilityBar, type AvailabilitySegment } from './dashboard/AvailabilityBar';
import { SavingsCard } from './dashboard/SavingsCard';
import { HomeMore } from './dashboard/HomeMore';
import { AgendaCard, EmergencyCard, UpcomingDebitsCard, WelcomeCard } from './dashboard/HomeCards';
import { useHomeChoices } from './dashboard/useHomeChoices';
import { useBackupCodeCheckDue } from './dashboard/useBackupCodeCheckDue';
import type { SettingsSection } from './settings/sections';
import { homeSparkline, deltaOverDays } from '../lib/homeSeries';
import { formatEUR } from '../lib/format';
import { InstallPrompt } from './InstallPrompt';
import { RegulatedRatesEditor } from './RegulatedRatesEditor';
import { computeGoodMonths, computeMilestones, computePayReview, motivationSettings, nextMilestone } from '../lib/motivation';
import { computeAlerts } from '../lib/alerts';
import { lepStillEligible } from '../lib/idleCash';
import { findStaleBalances } from '../lib/freshness';
import {
  availabilitySlices, buildHomeTodos, daysSinceLastMovement, findCeilingAlerts, findInactiveEmptyAccounts, homeAgenda,
  monthDelta as computeMonthDelta, parentalYearEndInterest, payPeriodSavings, savingsGauge, savingsOn, savingsProjection, upcomingDebits as findUpcomingDebits,
  type HomeAction, type HomeTodoIcon,
} from '../lib/home';
import type { YearClosingStatus } from '../lib/yearClosing';
import { GoodMonthsCard } from './motivation/GoodMonthsCard';
import { PayReviewCard } from './motivation/PayReviewCard';
import { MonthRoutineCard } from './dashboard/MonthRoutineCard';
import { computeMonthRoutine, type RoutineStepKey } from '../lib/monthRoutine';

interface DashboardProps {
  accounts: SavingsAccount[];
  history: PortfolioSnapshot[];
  fiscalConfig: FiscalConfig;
  onDeleteAccount?: (account: SavingsAccount) => void;
  recurringMovements?: RecurringMovement[];
  // Enregistre l'échéance proposée (passe par le même chemin que l'ajout rapide : notif
  // parents, arrondis, toast).
  onRecordRecurring?: (r: RecurringMovement, date: string) => void;
  // Épargne prévue chaque mois : montant du rappel de paie, sinon capacité du Pilotage.
  monthPlan?: number;
  // Objectif de la paie en cours (jauge) : comme le Pilotage, avec la capacité et la somme en
  // plus saisies pour cette paie (lib/payAdjustment). Absent = monthPlan.
  monthGoal?: number;
  // Paie nette mensuelle, pour le taux d'épargne.
  monthlyPay?: number;
  paydayDay?: number;
  trackingStartDate?: string;
  subscriptions?: Subscription[];
  // Mise à jour des paramètres fiscaux (nouveau barème, vérification annuelle).
  onUpdateFiscalConfig?: (update: (prev: FiscalConfig) => FiscalConfig) => void;
  /** Ouvre les Paramètres (carte des réglages fiscaux, ou la carte demandée). */
  onOpenSettings?: (section?: SettingsSection) => void;
  onUpdateAccounts?: (update: (prev: SavingsAccount[]) => SavingsAccount[]) => void;
  payRaise?: { delta: number; period: string; hasFixedAmount: boolean } | null;
  onAcceptPayRaise?: () => void;
  onDismissPayRaise?: () => void;
  // Ouvre un autre écran (actions des alertes, premier lancement).
  onNavigate?: (view: View) => void;
  onAddAccount?: () => void;
  // Rappel trimestriel de télécharger une copie.
  lastExportAt?: string;
  onExport?: () => void;
  emergency?: EmergencyFund | null;
  onSetEmergencyMonths?: (m: number) => void;
  agendaNext?: AgendaEvent[];
  lepTimeline?: LepTimeline | null;
  // Saison de la déclaration de revenus (lib/taxReturn) : null hors saison.
  taxReturnAlert?: TaxReturnAlert | null;
  // Motivation (lib/motivation) : bons mois, jalons, point de paie, contrôle des fiches.
  payslips?: PayslipRecord[];
  gamification?: boolean;
  goodMonthThreshold?: number;
  milestonesSeen?: string[];
  payReviewsDone?: string[];
  rfrByYear?: Record<string, number>;
  restitutionDoneOn?: string;
  // Date prévue de la restitution (à passer depuis App) ; à défaut, tant que les parents ont
  // du capital et que rien n'est fait, le 1er janvier suivant (date conseillée).
  restitutionPlannedDate?: string;
  onMarkMilestonesSeen?: (ids: string[]) => void;
  onValidatePayReview?: (key: string) => void;
  // Clôture de l'année écoulée (lib/yearClosing) : une tâche en janvier-février.
  yearClosing?: YearClosingStatus | null;
  /** Virements de la paie cochés dans le Pilotage : une étape de la routine du mois. */
  payChecklist?: PayChecklist;
  /** Paies déclarées (lib/payCalendar) : début des mois d'épargne, versements rattachés. */
  pays?: PayRecord[];
  /** « Demander à Pécule » (entrée et fenêtre chargées à part), sous l'épargne nette. */
  askSlot?: React.ReactNode;
}

const TODO_ICONS: Record<HomeTodoIcon, TodoSpec['icon']> = {
  clock: Clock, repeat: Repeat, shield: ShieldAlert, percent: Percent, 'piggy-bank': PiggyBank, trash: Trash2, landmark: Landmark,
  clipboard: ClipboardCheck, 'trending-up': TrendingUp, alert: AlertTriangle, download: Download, 'life-buoy': LifeBuoy,
  wallet: Wallet, transfer: ArrowRightLeft, gift: Gift, 'file-warning': FileWarning, 'calendar-check': CalendarCheck,
};

// L'or (rôle « parents », même teinte que le tertiaire) est réservé à la part des parents dans
// toute l'app : la part « avec impôt » prend le vert secondaire, hachuré.
const SLICE_STYLE: Record<'available' | 'tax' | 'locked', Pick<AvailabilitySegment, 'color' | 'hatch'>> = {
  available: { color: 'bg-primary' },
  tax: { color: 'bg-secondary', hatch: 'light' },
  locked: { color: 'bg-outline', hatch: 'dense' },
};

export const Dashboard: React.FC<DashboardProps> = ({ accounts, history, fiscalConfig, onDeleteAccount, recurringMovements = [], onRecordRecurring, monthPlan, monthGoal, monthlyPay = 0, paydayDay, trackingStartDate, subscriptions = [], onUpdateFiscalConfig, onOpenSettings, onUpdateAccounts, payRaise, onAcceptPayRaise, onDismissPayRaise, onNavigate, onAddAccount, lastExportAt, onExport, emergency, onSetEmergencyMonths, agendaNext = [], lepTimeline, taxReturnAlert, payslips = [], gamification, goodMonthThreshold, milestonesSeen, payReviewsDone, rfrByYear, restitutionDoneOn, restitutionPlannedDate, onMarkMilestonesSeen, onValidatePayReview, yearClosing, payChecklist, pays, askSlot }) => {
  // Date du jour partagée (useToday) : l'Accueil resté ouvert passe au lendemain à minuit.
  const today = useToday();
  const choices = useHomeChoices(today);
  const backupCodeCheckDue = useBackupCodeCheckDue();
  const [ratesEditorOpen, setRatesEditorOpen] = useState(false);

  // --- Où j'en suis ---
  const mySavings = useMemo(() => savingsOn(accounts, today), [accounts, today]);
  const ownedToday = useCallback((a: SavingsAccount) => ownedAmountAt(a, today), [today]);
  const availability = useMemo(() => computeAvailabilityBreakdown(accounts, fiscalConfig, ownedToday), [accounts, fiscalConfig, ownedToday]);
  const unlockCost = useMemo(() => computeUnlockCost(accounts, fiscalConfig), [accounts, fiscalConfig]);
  const balanceAt = useCallback((iso: string) => computeAccountBalanceAtDate(accounts, iso), [accounts]);
  const spark = useMemo(() => homeSparkline({ history, current: mySavings, today, balanceAt }), [history, mySavings, today, balanceAt]);
  const delta30 = useMemo(() => deltaOverDays(mySavings, balanceAt, today), [mySavings, balanceAt, today]);
  const monthDelta = useMemo(() => computeMonthDelta(history, mySavings, today), [history, mySavings, today]);

  // --- Le mois en cours ---
  // UNE fenêtre pour tous les chiffres « ce mois-ci » : la paie en cours (du 27 au 26 suivant),
  // sinon le mois civil. Jauge, seuil « bon mois » et taux d'épargne la partagent.
  const period = useMemo(
    () => payPeriodSavings({ accounts, today, paydayDay, payslips, pays, monthlyPay, trackingStartISO: trackingStartDate }),
    [accounts, today, paydayDay, payslips, pays, monthlyPay, trackingStartDate]
  );
  // Midi du jour : une fenêtre de 90 jours comptée depuis minuit pouvait, au changement d'heure,
  // déborder d'un jour.
  const middayToday = useMemo(() => { const d = parseISODate(today); d.setHours(12); return d; }, [today]);
  const projection = useMemo(() => savingsProjection(accounts, middayToday), [accounts, middayToday]);
  const debits = useMemo(() => findUpcomingDebits(subscriptions, middayToday), [subscriptions, middayToday]);
  const agenda = useMemo(() => homeAgenda(agendaNext, debits), [agendaNext, debits]);

  // --- Motivation : bons mois, jalons, point de paie ---
  const motivation = useMemo(() => motivationSettings({ gamification, goodMonthThreshold }), [gamification, goodMonthThreshold]);
  const goodMonths = useMemo(
    () => (motivation.enabled ? computeGoodMonths({ accounts, today, paydayDay, payslips, pays, threshold: motivation.threshold, trackingStartISO: trackingStartDate }) : null),
    [motivation, accounts, today, paydayDay, payslips, pays, trackingStartDate]
  );
  const monthlySpending = emergency?.monthlySpending ?? 0;
  const milestones = useMemo(
    () => (goodMonths ? computeMilestones({ accounts, mySavings, monthlySpending, goodMonths, rfrByYear, restitutionDoneOn }) : []),
    [goodMonths, accounts, mySavings, monthlySpending, rfrByYear, restitutionDoneOn]
  );
  const upcomingMilestone = useMemo(() => nextMilestone(milestones), [milestones]);
  // Jalons atteints jamais montrés : célébrés une fois, jusqu'au « Merci ».
  const freshMilestones = useMemo(() => (milestonesSeen ? milestones.filter(m => m.achieved && !milestonesSeen.includes(m.id)) : []), [milestones, milestonesSeen]);
  // Tout premier passage : les jalons déjà atteints sont notés comme vus, sans célébration.
  useEffect(() => {
    if (!goodMonths || milestonesSeen !== undefined || !onMarkMilestonesSeen) return;
    onMarkMilestonesSeen(milestones.filter(m => m.achieved).map(m => m.id));
  }, [goodMonths, milestones, milestonesSeen, onMarkMilestonesSeen]);
  const payReview = useMemo(
    () => (goodMonths ? computePayReview({ accounts, goodMonths, today, plan: monthPlan, trackingStartISO: trackingStartDate, pays }) : undefined),
    [goodMonths, accounts, today, monthPlan, trackingStartDate, pays]
  );
  const showPayReview = !!payReview && !(payReviewsDone || []).includes(payReview.key);

  // --- Routine du mois : fiche, virements, soldes, point de paie, déduits des données ---
  const routine = useMemo(
    () => computeMonthRoutine({ accounts, payslips, pays, payChecklist, monthlyPay, paydayDay, now: middayToday, payReviewKey: payReview?.key, payReviewMonth: payReview?.payMonth, payReviewsDone }),
    [accounts, payslips, pays, payChecklist, monthlyPay, paydayDay, middayToday, payReview?.key, payReview?.payMonth, payReviewsDone]
  );
  const openRoutineStep = (step: RoutineStepKey) => {
    switch (step) {
      case 'payslip': onNavigate?.('payslips'); break;
      // « Où le placer » est sous l'en-tête du Pilotage : on l'amène à l'écran.
      case 'transfers': onNavigate?.('pilot'); revealElementById('pay-checklist'); break;
      case 'balances': onNavigate?.('update'); break;
      // Le point de paie est sur l'Accueil, juste sous la routine.
      case 'review': revealElementById('pay-review', { delayMs: 0 }); break;
    }
  };

  // --- À faire ---
  // Alertes chiffrées en euros (lib/alerts) : compte courant dormant, meilleur taux, livret
  // bientôt plein, place libérée par la restitution, contrôle des fiches de paie.
  const hasParentalCapital = accounts.some(a => a.parentalCapital > 0);
  const alerts = useMemo(() => computeAlerts({
    accounts, fiscalConfig, today: parseISODate(today), monthlySpending, monthlyPlan: monthPlan,
    lepEligible: lepStillEligible(lepTimeline),
    restitution: restitutionDoneOn ? { done: true }
      : restitutionPlannedDate ? { plannedDate: restitutionPlannedDate }
      : hasParentalCapital ? { plannedDate: suggestedRestitutionDate(parseISODate(today)) } : undefined,
    payslips,
  }), [accounts, fiscalConfig, today, monthlySpending, monthPlan, lepTimeline, restitutionDoneOn, restitutionPlannedDate, hasParentalCapital, payslips]);

  if (accounts.length === 0) return <WelcomeCard onAddAccount={onAddAccount} onNavigate={onNavigate} />;

  // Liste « À faire » (lib/home) : recalculée à chaque rendu, comme avant (l'écran n'est
  // redessiné que si ses données ou ses choix changent), donc toujours à la date du jour.
  const now = new Date();
  const homeTodos = buildHomeTodos({
    now, accounts, fiscalConfig,
    can: {
      navigate: !!onNavigate, recordRecurring: !!onRecordRecurring, deleteAccount: !!onDeleteAccount, updateFiscalConfig: !!onUpdateFiscalConfig,
      updateAccounts: !!onUpdateAccounts, openSettings: !!onOpenSettings, acceptPayRaise: !!onAcceptPayRaise, dismissPayRaise: !!onDismissPayRaise, exportData: !!onExport,
    },
    daysSinceUpdate: daysSinceLastMovement(accounts, now),
    staleBalances: findStaleBalances(accounts, now),
    dueRecurring: findDueRecurring(recurringMovements, accounts, now, choices.skippedRecurring),
    lepTimeline: lepTimeline ?? null,
    staleRates: findStaleRegulatedRates(accounts, now),
    dismissedRateRevision: choices.dismissedRateRevision,
    ratesEditorOpen,
    parentalYearEnd: parentalYearEndInterest(accounts, now),
    inactiveEmpty: findInactiveEmptyAccounts(accounts, now),
    fiscalReview: findFiscalReview(fiscalConfig, now),
    taxReturnAlert: taxReturnAlert ?? null,
    taxReturnFiled: choices.taxReturnFiled,
    payRaise: payRaise ?? null,
    avRatesDue: findAvRateUpdatesDue(accounts, now),
    ceilingAlerts: findCeilingAlerts(accounts, fiscalConfig),
    lastExportAt,
    alerts,
    emergency: emergency ?? null,
    yearClosing: yearClosing ?? null,
    backupCodeCheckDue,
  });

  const run = (a: HomeAction) => {
    switch (a.type) {
      case 'navigate': onNavigate?.(a.view); break;
      case 'record-recurring': onRecordRecurring?.(a.due.recurring, a.due.dueDate); break;
      case 'skip-recurring': choices.skipRecurring(a.recurringId); break;
      case 'toggle-rates-editor': setRatesEditorOpen(o => !o); break;
      case 'dismiss-rate-reminder': choices.dismissRateRevision(a.revisionKey); break;
      case 'delete-account': { const acc = accounts.find(x => x.id === a.accountId); if (acc) onDeleteAccount?.(acc); break; }
      case 'apply-tax-scale': onUpdateFiscalConfig?.(prev => { const scale = findFiscalReview(prev).newScale; return scale ? applyTaxScale(prev, scale) : prev; }); break;
      case 'confirm-fiscal-params': onUpdateFiscalConfig?.(prev => ({ ...prev, paramsReviewedYear: a.year })); break;
      case 'open-settings': onOpenSettings?.(); break;
      // Carte « Sauvegardes et données » : la sauvegarde de secours y propose de retaper le code.
      case 'check-backup-code': onOpenSettings?.('data'); break;
      // L'aide est en bas de l'écran « Dons et impôts » : on l'amène à l'écran.
      case 'show-tax-return': onNavigate?.('donations'); revealElementById('tax-return'); break;
      case 'mark-tax-return-filed': choices.markTaxReturnFiled(a.incomeYear); break;
      case 'accept-pay-raise': onAcceptPayRaise?.(); break;
      case 'dismiss-pay-raise': onDismissPayRaise?.(); break;
      // Noté sur les comptes (fichier, tous les appareils) : la clôture de l'année le voit aussi.
      case 'confirm-av-rates': onUpdateAccounts?.(prev => confirmRatesUnchanged(prev, a.accountIds, today)); break;
      case 'export': onExport?.(); break;
      // La clôture est en tête de l'Historique : on l'amène à l'écran.
      case 'open-year-closing': onNavigate?.('history'); revealElementById('year-closing'); break;
    }
  };
  const todos: TodoSpec[] = homeTodos.map(t => ({
    key: t.key, icon: TODO_ICONS[t.icon], tone: t.tone, text: t.text, detail: t.detail, gain: t.gain, snoozable: t.snoozable, pinned: t.pinned,
    primary: t.primary && { label: t.primary.label, onClick: () => run(t.primary!.action) },
    secondary: t.secondary && { label: t.secondary.label, onClick: () => run(t.secondary!.action) },
    extra: t.key === 'rates' && ratesEditorOpen && onUpdateAccounts ? <RegulatedRatesEditor accounts={accounts} onApply={onUpdateAccounts} /> : undefined,
  }));

  const segments: AvailabilitySegment[] = availabilitySlices(availability).map(s => ({ ...s, ...SLICE_STYLE[s.key] }));
  const showUnlockDetails = availability.taxLocked > 0 && (unlockCost.extraTax >= 1 || unlockCost.closesPea || !!unlockCost.nextFree || unlockCost.unknown.length > 0);
  const goal = monthGoal ?? monthPlan;
  const showSavingsCard = (goal !== undefined && goal > 0) || monthlyPay > 0 || motivation.enabled;
  const moreSummary = `${projection ? 'Projection, évolution' : 'Évolution'} et répartition par établissement`;

  return (
    <div className="space-y-6">
      <PageHeader visuallyHidden title="Accueil" />
      <InstallPrompt />

      {/* 1. Où j'en suis : le chiffre principal, sa tendance et sa disponibilité. */}
      <Card variant="elevated" aria-label="Mon épargne nette">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
          <StatTile
            size="hero"
            label="Mon épargne nette"
            value={formatEUR(mySavings, 0)}
            delta={<DeltaBadge value={delta30} period="sur 30 jours" />}
            hint={<>
              {/* Mode solo (après la restitution) : plus de mention des parents. */}
              {hasParentalCapital ? 'Votre part, hors capital de vos parents' : 'Le total de vos comptes'}
              {monthDelta !== null && <> · <MoneyText value={monthDelta} signed decimals={0} tone="auto" className="font-medium" /> depuis le début du mois</>}
            </>}
          />
          {spark.length >= 2 && (
            <div className="shrink-0 flex flex-col items-start sm:items-end gap-1">
              <Sparkline values={spark} width={200} height={56} className="max-w-full" />
              <p className="text-xs text-on-surface-variant">Tendance sur {spark.length} mois</p>
            </div>
          )}
        </div>
        <div className="mt-6 pt-5 border-t border-outline-variant">
          <AvailabilityBar segments={segments}>
            {showUnlockDetails && (
              <div className="mt-4 rounded-xl bg-surface-container p-3 text-sm text-on-surface-variant space-y-1">
                {unlockCost.extraTax >= 1 && <p>Tout retirer aujourd'hui : <span className="font-medium text-on-surface tabular-nums">≈ {formatEUR(unlockCost.extraTax, 0)}</span> d'impôt en plus qu'après la maturité.</p>}
                {unlockCost.closesPea && <p className="flex items-center gap-1.5 text-error font-medium"><AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" /> Un retrait clôturerait votre PEA.</p>}
                {unlockCost.nextFree && <p>Libre de surcoût le <span className="font-medium text-on-surface tabular-nums">{parseISODate(unlockCost.nextFree.date).toLocaleDateString('fr-FR')}</span> ({unlockCost.nextFree.name}).</p>}
                {unlockCost.unknown.length > 0 && <p>Versements à renseigner pour chiffrer : {unlockCost.unknown.join(', ')}.</p>}
              </div>
            )}
          </AvailabilityBar>
        </div>
      </Card>

      {askSlot}

      {/* Routine de la paie en cours, étape par étape ; repliée en une ligne une fois faite. */}
      {routine && <MonthRoutineCard routine={routine} onOpen={openRoutineStep} />}

      {/* Bilan de la paie précédente, une fois, jusqu'à validation. */}
      {showPayReview && payReview && (
        <PayReviewCard review={payReview} onAction={onNavigate} onValidate={() => onValidatePayReview?.(payReview.key)} />
      )}

      {/* 2. Ce qu'il y a à faire. */}
      <TodoList items={todos} />

      {/* 3. Le mois en cours et ce qui arrive. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        {showSavingsCard && (
          <SavingsCard
            gauge={savingsGauge({ saved: period.saved, goal, threshold: motivation.enabled ? motivation.threshold : 0, period, today })}
            period={period}
            monthlyPay={monthlyPay}
          />
        )}
        {goodMonths && goodMonths.months.length > 0 && (
          <GoodMonthsCard
            summary={goodMonths}
            today={today}
            milestones={milestones}
            next={upcomingMilestone}
            fresh={freshMilestones}
            onAcknowledge={onMarkMilestonesSeen ? () => onMarkMilestonesSeen(freshMilestones.map(m => m.id)) : undefined}
          />
        )}
        {emergency && <EmergencyCard emergency={emergency} onSetMonths={onSetEmergencyMonths} />}
        {agenda.length > 0 && <AgendaCard events={agenda} onNavigate={onNavigate} />}
        {debits.length > 0 && <UpcomingDebitsCard debits={debits} />}
      </div>

      {/* 4. Pour aller plus loin : repliable, mémorisé ; rien n'est calculé tant que c'est replié. */}
      <div>
        <button
          type="button"
          onClick={choices.toggleMore}
          aria-expanded={choices.moreOpen}
          aria-controls="home-more"
          className="w-full flex items-center justify-between gap-3 px-5 py-3 rounded-2xl border border-outline-variant text-left hover:bg-on-surface/4 transition-colors"
        >
          <span className="min-w-0">
            <span className="block text-base font-medium text-on-surface">Plus de détails</span>
            <span className="block text-sm text-on-surface-variant">{moreSummary}</span>
          </span>
          <ChevronDown className={`w-5 h-5 shrink-0 text-on-surface-variant transition-transform ${choices.moreOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
        </button>
        {choices.moreOpen && <HomeMore accounts={accounts} projection={projection} />}
      </div>
    </div>
  );
};
