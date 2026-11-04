// src/components/AssistantPilot.tsx
import React, { useState, useMemo, useEffect, useId, useRef } from 'react';
import { SavingsAccount, Expense, AccountType, FiscalConfig, WorkBenefits, PayslipRecord, Subscription, PayChecklist as PayChecklistData, PayChecklistLine, AppDoc } from '../types';
import { PayChecklist } from './PayChecklist';
import { SavingsSplitEditor } from './SavingsSplitEditor';
import { computeIncome, computePlacementStrategy, payslipSuperNet, subscriptionsAsExpenses, computePayTransfers, computeRecentSavingsRate, activeSavingsSplit } from '../lib/finance';
import { openPay } from '../lib/payRecords';
import { allocatePay, leisureFloorOf, payBalanceBefore, recommendPayDistribution } from '../lib/payDistribution';
import type { PayRitualProps } from './pilot/PayReceivedSheet';
import { validPayday, type PayCalendarData } from '../lib/payCalendar';
import { parseFrenchNumber, safeNumber } from '../lib/numbers';
import { NumberInput } from './NumberInput';
import { isBackendEnabled } from '../services/backendService';
import { Calculator, Receipt, Info, Plus, Trash2, Coins, FileCheck2, Wand2, BellRing, PieChart, PiggyBank, SlidersHorizontal, Target } from 'lucide-react';
import { elideDe, formatEUR, formatPeriod, formatRate } from '../lib/format';
import { useUndoableRemove } from './Toast';
import { focusAfterRemoval } from './focusAfterRemoval';
import { fixedSavingsNote } from '../lib/pilotView';
import { Button, IconButton, MoneyText, PageHeader, SegmentedButton, TextField, fieldClass } from './ui';
import { Disclosure } from './pilot/Disclosure';
import { BookletFill } from './pilot/BookletFill';
import { OPEN_PAY_SETTINGS_EVENT, PAY_SETTINGS_INCOME_ID, takePaySettingsRequest } from './pilot/paySettingsRequest';

/**
 * Réglages du Pilotage, enregistrés dans le fichier de données (config). Un réglage de plus
 * = une clé ici : App passe la config et une seule fonction de mise à jour.
 */
export type PilotConfig = Pick<AppDoc['config'],
  'grossAnnual' | 'leisureBudget' | 'projectSavings' | 'taxRateManual' | 'extraMonthlyIncome'
  | 'paydayDay' | 'paydayAmount' | 'payAccountId' | 'savingsSplit' | 'savingsSplitFrom'>;

interface AssistantPilotProps {
  accounts: SavingsAccount[];
  expenses: Expense[];
  onUpdateExpenses: React.Dispatch<React.SetStateAction<Expense[]>>;
  config: PilotConfig;
  /** Modifie un ou plusieurs réglages (les autres restent tels quels). */
  onPatchConfig: (patch: Partial<PilotConfig>) => void;
  fiscalConfig: FiscalConfig;
  workBenefits: WorkBenefits;
  // Quand définie, le détail budgétaire (brut mensuel, net avant impôt, charges, navigo,
  // mutuelle, titres resto, impôt, super net) affiche les montants EXACTS de cette fiche
  // de paie, verbatim, à la place de la formule théorique (computeIncome).
  activePayslip?: PayslipRecord;
  onClearActivePayslip: () => void;
  subscriptions: Subscription[];
  /** « Gérer » : l'onglet Abonnements du Pilotage. */
  onOpenSubscriptions: () => void;
  /** Rappel de paie : Paramètres › Notifications (affiché seulement avec le serveur). */
  onOpenNotifications?: () => void;
  payChecklist?: PayChecklistData;
  /** Cocher, décocher une ligne, recalculer le plan (commandes de la paie, useAccountActions). */
  onPayLineCheck: (lines: PayChecklistLine[], line: PayChecklistLine, amount: number, alreadyRecorded: boolean) => boolean;
  onPayLineUncheck: (line: PayChecklistLine) => void;
  onPayPlanReset: () => void;
  /** Fiches et paies déclarées : la paie en cours suit la même fenêtre que l'Accueil. */
  payCalendar?: Omit<PayCalendarData, 'paydayDay'>;
  /**
   * Le rituel « J'ai reçu ma paie » (carte « Ma paie ») : données complètes et commandes.
   * Une paie déclarée remplace l'estimation dans la carte (répartition pour le montant reçu).
   */
  payRitual?: PayRitualProps;
}

export const AssistantPilot: React.FC<AssistantPilotProps> = ({
  accounts, expenses, onUpdateExpenses, config, onPatchConfig,
  fiscalConfig, workBenefits, activePayslip, onClearActivePayslip,
  subscriptions, onOpenSubscriptions, onOpenNotifications, payChecklist, onPayLineCheck, onPayLineUncheck, onPayPlanReset,
  payCalendar, payRitual,
}) => {
  const { grossAnnual, leisureBudget, projectSavings, taxRateManual, extraMonthlyIncome, paydayDay, paydayAmount, payAccountId, savingsSplit, savingsSplitFrom } = config;
  const setGrossAnnual = (grossAnnual: number) => onPatchConfig({ grossAnnual });
  const setLeisureBudget = (leisureBudget: number) => onPatchConfig({ leisureBudget });
  const setProjectSavings = (projectSavings: number) => onPatchConfig({ projectSavings });
  const setTaxRateManual = (taxRateManual: number) => onPatchConfig({ taxRateManual });
  const setExtraMonthlyIncome = (extraMonthlyIncome: number) => onPatchConfig({ extraMonthlyIncome });
  const setPaydayDay = (paydayDay: number | undefined) => onPatchConfig({ paydayDay });
  const setPaydayAmount = (paydayAmount: number | undefined) => onPatchConfig({ paydayAmount });
  const setPayAccountId = (payAccountId: string | undefined) => onPatchConfig({ payAccountId });
  const onSavingsSplitChange = (split: { accountId: string; pct: number }[] | undefined, from: string | undefined) =>
    onPatchConfig({ savingsSplit: split, savingsSplitFrom: from });
  const [showDetails, setShowDetails] = useState(false);
  const removeWithUndo = useUndoableRemove();
  // Après la suppression d'une charge, le focus va sur la charge voisine (sinon sur le titre).
  const expenseListRef = useRef<HTMLUListElement>(null);
  const expensesTitleId = useId();
  const removeExpense = (e: Expense, index: number) => {
    removeWithUndo(expenses, e, onUpdateExpenses, `Charge « ${e.name} » supprimée`);
    focusAfterRemoval(() => expenseListRef.current, index, () => document.getElementById(expensesTitleId));
  };
  
  // UX State pour ajout dépense
  const [isAddingExpense, setIsAddingExpense] = useState(false);
  const [newExpenseName, setNewExpenseName] = useState('');
  const [newExpenseAmount, setNewExpenseAmount] = useState('');
  // Brouillon du montant fixe d'épargne : on ne persiste qu'une saisie interprétable
  // (vide = épargne calculée), sans réécrire le champ pendant la frappe.
  const [paydayAmountDraft, setPaydayAmountDraft] = useState(paydayAmount !== undefined ? String(paydayAmount) : '');
  // Le Pilotage peut s'afficher avant la fin du chargement Drive : le champ resterait alors
  // vide alors qu'un montant est enregistré. On le resynchronise quand la valeur arrive.
  useEffect(() => {
    setPaydayAmountDraft(prev => (parseFrenchNumber(prev) ?? undefined) === paydayAmount ? prev : (paydayAmount !== undefined ? String(paydayAmount).replace('.', ',') : ''));
  }, [paydayAmount]);

  const autoValues = useMemo(
    () =>
      computeIncome(
        { grossAnnual, extraMonthlyIncome, taxRateManual },
        fiscalConfig,
        workBenefits
      ),
    [grossAnnual, extraMonthlyIncome, fiscalConfig, workBenefits, taxRateManual]
  );

  // Bascule d'affichage : quand une fiche de paie sert de référence, on montre ses
  // montants EXACTS, verbatim, plutôt que de les recalculer. Le "Net avant impôt"
  // théorique (formule) devient le "Net à payer avant impôt" réel de la fiche — déjà net
  // de charges, Navigo et mutuelle sur une vraie fiche, donc directement comparable au
  // "Net cash avant impôt" de la formule. `autoRate` est reconstruit à partir de l'impôt
  // et de l'assiette réellement prélevés, pour rester cohérent avec le libellé existant.
  const display = useMemo(() => {
    if (activePayslip) {
      const e = activePayslip.extracted;
      const effectiveSuperNetReal = payslipSuperNet(e);
      return {
        isReal: true,
        grossMonth: e.grossAmount,
        socialCharges: e.socialCharges,
        navigoGain: e.navigoRefund,
        mutuelleCost: e.mutuelleCost,
        swileCost: e.mealVouchers,
        netBeforeTax: e.netAmount,
        superNetRaw: e.netAmount,
        effectiveMonthlyTax: e.incomeTaxWithheld,
        effectiveSuperNet: effectiveSuperNetReal,
        // Assiette : le NET IMPOSABLE quand la fiche le fournit (c'est le dénominateur du
        // barème, donc comparable au "Taux du barème" théorique) — l'ancien calcul divisait
        // par le net à payer, ce qui décalait le taux affiché de plusieurs points au
        // simple basculement fiche/formule.
        autoRate: e.incomeTaxWithheld !== undefined && (e.netTaxable || e.netAmount)
          ? (e.incomeTaxWithheld / (e.netTaxable || e.netAmount)!) * 100
          : undefined,
      };
    }
    return {
      isReal: false,
      grossMonth: autoValues.grossMonth,
      socialCharges: autoValues.socialCharges,
      navigoGain: autoValues.navigoGain,
      mutuelleCost: autoValues.mutuelleCost,
      swileCost: autoValues.swileCost,
      netBeforeTax: autoValues.netBeforeTax,
      superNetRaw: autoValues.superNetRaw,
      effectiveMonthlyTax: autoValues.effectiveMonthlyTax,
      effectiveSuperNet: autoValues.superNet,
      autoRate: autoValues.autoRate,
    };
  }, [activePayslip, autoValues]);

  // Formatage tolérant à l'absence (extraction partielle) : jamais de "0 €" trompeur pour
  // une donnée que la fiche ne fournissait simplement pas.
  const showEUR = (v: number | undefined) => v === undefined ? '—' : formatEUR(v);

  // À AFFICHER : reste honnêtement indéfini ("—") en mode réel si la fiche n'a pas encore
  // été (ré)extraite avec les champs impôt/net payé — jamais de repli silencieux sur la
  // formule théorique qui se ferait passer pour un chiffre exact.
  const effectiveSuperNet = display.isReal ? display.effectiveSuperNet : autoValues.superNet;
  // À CALCULER (capacité d'épargne, etc.) : a besoin d'un nombre pour continuer à
  // fonctionner même si la fiche active est incomplète sur ce point précis.
  const effectiveSuperNetForCalc = effectiveSuperNet ?? autoValues.superNet;

  const updateFromGrossAnnual = (val: number) => setGrossAnnual(val);
  const updateFromGrossMonth = (val: number) => setGrossAnnual(val * 12);
  const updateFromNet = (val: number) => {
    // Un taux de charges >= 100 % (saisie erronée dans les Paramètres) donnerait une
    // division par zéro → grossAnnual = Infinity persisté sur Drive. On ignore la saisie.
    const denominator = 1 - fiscalConfig.salaryChargesRate;
    if (denominator <= 0) return;
    const targetGrossMonth = (val - autoValues.navigoGain - extraMonthlyIncome) / denominator;
    setGrossAnnual(targetGrossMonth * 12);
  };

  const handleAddExpense = () => {
      if(newExpenseName && newExpenseAmount) {
          onUpdateExpenses([...expenses, {id: crypto.randomUUID(), name: newExpenseName, amount: safeNumber(newExpenseAmount, 0)}]);
          setNewExpenseName('');
          setNewExpenseAmount('');
          setIsAddingExpense(false);
      }
  };


  // Abonnements actifs, en coût mensuel : comptés d'office dans les virements fixes, gérés depuis
  // l'onglet Abonnements (jamais supprimables d'ici, pour ne pas désynchroniser les rappels).
  const subscriptionCharges = useMemo(() => subscriptionsAsExpenses(subscriptions), [subscriptions]);
  // Charge saisie à la main qui porte le nom d'un abonnement : sans doute comptée deux fois.
  const duplicateNames = useMemo(() => {
    const names = new Set(subscriptionCharges.map(c => c.name.trim().toLowerCase()));
    return new Set(expenses.filter(e => names.has(e.name.trim().toLowerCase())).map(e => e.id));
  }, [expenses, subscriptionCharges]);

  const budgetData = useMemo(() => {
    const subscriptionsFixed = subscriptionCharges.reduce((sum, e) => sum + e.amount, 0);
    // Plan habituel (avant la paie) : la règle de la paie (lib/payDistribution) appliquée à la
    // paie habituelle, sans reste du mois dernier ; montant fixe d'épargne compris. Même règle
    // que la jauge de l'Accueil et la relance de paie (lib/payAdjustment) ; une fois la paie
    // déclarée, la carte « Ma paie » suit le montant reçu.
    const fixedTransfers = computePayTransfers({ expenses, subscriptions, leisureBudget: 0, projectSavings: 0 });
    const totalFixed = fixedTransfers.reduce((sum, t) => sum + t.amount, 0);
    const allocation = allocatePay({
      received: effectiveSuperNetForCalc, expectedPay: effectiveSuperNetForCalc,
      fixed: totalFixed, projects: projectSavings, startBalance: leisureBudget, fixedSavings: paydayAmount,
    });
    return { totalFixed, subscriptionsFixed, allocation };
  }, [effectiveSuperNetForCalc, expenses, subscriptions, subscriptionCharges, leisureBudget, projectSavings, paydayAmount]);
  const { allocation } = budgetData;

  const split = activeSavingsSplit({ savingsSplit, savingsSplitFrom });
  const customSplit = split !== undefined;
  const strategy = useMemo(
    () => computePlacementStrategy(allocation.savings, accounts, fiscalConfig, split),
    [allocation.savings, accounts, fiscalConfig, split]
  );

  const bookletStats = useMemo(() => {
    const defaults: Partial<Record<AccountType, number>> = {
      [AccountType.LEP]: fiscalConfig.ceilings.lep,
      [AccountType.LIVRET_A]: fiscalConfig.ceilings.livretA,
      [AccountType.LDDS]: fiscalConfig.ceilings.ldds,
    };
    // TOUS les comptes de chaque type réglementé, pas seulement le premier trouvé : un
    // second Livret A compte aussi dans l'espace restant. Le plafond saisi sur le compte
    // prime sur celui des paramètres fiscaux.
    return [AccountType.LEP, AccountType.LIVRET_A, AccountType.LDDS].flatMap(type =>
      accounts.filter(a => a.type === type).map(acc => {
        const ceiling = (acc.ceiling && acc.ceiling > 0) ? acc.ceiling : (defaults[type] || 10000);
        const parentPct = Math.min(100, (acc.parentalCapital / ceiling) * 100);
        const ownedPct = Math.min(100 - parentPct, (acc.ownedAmount / ceiling) * 100);
        return {
          id: acc.id, name: acc.name, type, ceiling,
          parentAmount: acc.parentalCapital, ownedAmount: acc.ownedAmount,
          // Rythme réel des 90 derniers jours sur CE livret : dans combien de mois il sera plein.
          monthsToFull: (() => {
            const remaining = ceiling - acc.totalAmount;
            const rate = computeRecentSavingsRate([acc], 90);
            return remaining > 0 && rate && rate > 0 ? Math.ceil(remaining / rate) : null;
          })(),
          parentPct, ownedPct, totalPct: parentPct + ownedPct,
          remainingSpace: Math.max(0, ceiling - acc.totalAmount),
        };
      })
    );
  }, [accounts, fiscalConfig]);

  // Libellé de la paie dans « Comment c'est calculé ».
  const payLabel = display.isReal
    ? (effectiveSuperNet === undefined ? 'Paie habituelle (estimation)' : 'Paie habituelle (fiche de paie)')
    : 'Paie habituelle';

  // Paie déclarée du mois d'épargne en cours : la carte « Ma paie » répartit le montant REÇU
  // (prime et reste du compte courant compris), plus l'estimation.
  const declaredPay = payRitual ? openPay(payRitual.doc).pay : undefined;
  const received = useMemo(
    () => (declaredPay && payRitual ? recommendPayDistribution(payRitual.doc, {
      amount: declaredPay.amount, bonus: declaredPay.bonus, toSave: declaredPay.toSave, kind: declaredPay.kind, before: payBalanceBefore(declaredPay), receivedOn: declaredPay.receivedOn,
    }) : undefined),
    [declaredPay, payRitual]);

  // « Modifier : Pilotage › Paie habituelle » (Paramètres › Notifications) : le groupe Paie habituelle
  // s'ouvre, que le Pilotage vienne d'être monté ou soit déjà affiché.
  const [incomeOpen, setIncomeOpen] = useState(() => takePaySettingsRequest());
  useEffect(() => {
    const open = () => { if (takePaySettingsRequest()) setIncomeOpen(true); };
    window.addEventListener(OPEN_PAY_SETTINGS_EVENT, open);
    return () => window.removeEventListener(OPEN_PAY_SETTINGS_EVENT, open);
  }, []);

  // Épargne visée par paie : calculée, ou montant fixe (ex-« Montant » du rappel de paie).
  const [fixedMode, setFixedMode] = useState(paydayAmount !== undefined);
  useEffect(() => { if (paydayAmount !== undefined) setFixedMode(true); }, [paydayAmount]);
  const computedTarget = Math.max(0, allocation.computedTarget);
  const chooseSavingsMode = (mode: 'computed' | 'fixed') => {
    if (mode === 'computed') {
      setFixedMode(false);
      setPaydayAmount(undefined);
      setPaydayAmountDraft('');
      return;
    }
    setFixedMode(true);
    if (paydayAmount === undefined) {
      const start = Math.round(computedTarget);
      setPaydayAmount(start);
      setPaydayAmountDraft(String(start));
    }
  };
  const fixedNote = fixedSavingsNote(allocation);

  const currentAccounts = accounts.filter(a => a.type === AccountType.COMPTE_COURANT);
  const payAccount = currentAccounts.find(a => a.id === payAccountId) ?? currentAccounts[0];
  const firstPlaced = strategy.find(st => !st.alert && st.fillAmount > 0)?.accountName;
  const floor = leisureFloorOf(leisureBudget);
  const paydaySelectId = useId();
  const payAccountSelectId = useId();
  const backend = isBackendEnabled();

  const readOnlyValue = (label: string, value: React.ReactNode) => (
    <div>
      <p className="text-sm font-medium text-on-surface-variant mb-1.5">{label}</p>
      <p className="h-14 px-4 flex items-center rounded-xs bg-surface-container text-base text-on-surface tabular-nums">{value}</p>
    </div>
  );
  const detailRow = (label: React.ReactNode, value: React.ReactNode, strong = false, ruled = strong) => (
    <div className={`flex justify-between gap-4 py-1.5 ${strong ? 'font-medium text-on-surface' : 'text-on-surface-variant'} ${ruled ? 'border-t border-outline-variant mt-1 pt-2' : ''}`}>
      <dt>{label}</dt>
      <dd className="tabular-nums text-right whitespace-nowrap text-on-surface">{value}</dd>
    </div>
  );
  const selectClass = `${fieldClass} dark:bg-surface-container-low`;

  const incomeSummary = [
    effectiveSuperNet === undefined ? '—' : `${formatEUR(effectiveSuperNet, 0)} nets`,
    validPayday(paydayDay) !== undefined ? `le ${paydayDay} du mois` : undefined,
  ].filter(Boolean).join(' · ');
  const savingsSummary = [
    `${formatEUR(allocation.target, 0)} par paie`,
    customSplit ? 'répartition personnalisée' : firstPlaced ? `${firstPlaced} d'abord` : undefined,
  ].filter(Boolean).join(' · ');

  const monthTab = (
    <div className="space-y-6">
      {/* Ma paie : ce que devient la paie, attendue ou reçue, et ce qu'il reste à faire. */}
      <PayChecklist
        plan={allocation}
        planSteps={strategy}
        payLabel={payLabel}
        pay={declaredPay}
        received={received}
        accounts={accounts}
        checklist={payChecklist}
        onCheck={onPayLineCheck}
        onUncheck={onPayLineUncheck}
        onReset={onPayPlanReset}
        paydayDay={paydayDay}
        payCalendar={payCalendar}
        ritual={payRitual}
      />

      {/* Réglages de la paie : un seul endroit, dans l'ordre de la barre. */}
      <section id="pay-settings" aria-labelledby="pay-settings-title">
        <h3 id="pay-settings-title" className="text-lg font-medium text-on-surface flex items-center gap-2"><SlidersHorizontal className="w-5 h-5 text-primary" aria-hidden="true" /> Réglages de la paie</h3>
        <p className="text-sm text-on-surface-variant mt-1 mb-4">Dans l'ordre de la barre : la répartition se recalcule dès que vous les modifiez.</p>
        <div className="rounded-2xl border border-outline-variant bg-surface-container-lowest dark:bg-surface-container-low divide-y divide-outline-variant overflow-hidden">

          <Disclosure id={PAY_SETTINGS_INCOME_ID} open={incomeOpen} onOpenChange={setIncomeOpen} appearance="plain" headingLevel={4} title="Paie habituelle" icon={Calculator} summary={incomeSummary}>
            {activePayslip && (
              <div className="mb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl bg-tertiary-container text-on-tertiary-container p-3">
                <p className="flex items-start gap-2 text-sm">
                  <FileCheck2 className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                  Chiffres exacts de votre fiche {elideDe(activePayslip.extracted.period ? formatPeriod(activePayslip.extracted.period) : 'paie')} ({activePayslip.extracted.employer || activePayslip.fileName}) — recopiés tels quels, sans calcul.
                </p>
                <Button variant="text" onClick={onClearActivePayslip} className="shrink-0"><Wand2 className="w-4 h-4" aria-hidden="true" /> Repasser en estimation</Button>
              </div>
            )}

            {activePayslip && display.effectiveMonthlyTax === undefined && (
              <p className="mb-4 text-sm text-error flex items-start gap-2">
                <Info className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                Cette fiche n'a pas encore l'impôt réellement prélevé / le net payé (extraite avant l'ajout de ces champs) : « Net réel perçu » affiche « — » plutôt qu'une estimation. Réimportez-la depuis Drive pour compléter.
              </p>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <TextField label="Brut annuel" render={p => <NumberInput id={p.id} describedBy={p.describedBy} invalid={p.invalid} value={Math.round(grossAnnual)} onChange={updateFromGrossAnnual} min={0} suffix="€" className={`${p.className} tabular-nums`} />} />
              {activePayslip
                ? readOnlyValue('Brut mensuel', showEUR(display.grossMonth))
                : <TextField label="Brut mensuel" render={p => <NumberInput id={p.id} describedBy={p.describedBy} invalid={p.invalid} value={Math.round(autoValues.grossMonth)} onChange={updateFromGrossMonth} min={0} suffix="€" className={`${p.className} tabular-nums`} />} />}
              {activePayslip
                ? readOnlyValue('Net avant impôt', showEUR(display.netBeforeTax))
                : <TextField label="Net avant impôt" render={p => <NumberInput id={p.id} describedBy={p.describedBy} invalid={p.invalid} value={Math.round(autoValues.netBeforeTax * 100) / 100} onChange={updateFromNet} min={0} suffix="€" className={`${p.className} tabular-nums`} />} />}
              {readOnlyValue(activePayslip ? 'Net réel perçu' : 'Paie nette après impôt', showEUR(effectiveSuperNet))}
            </div>

            <Button
              type="button"
              variant="text"
              onClick={() => setShowDetails(!showDetails)}
              aria-expanded={showDetails}
              aria-controls="pilot-salary-detail"
              className="mt-3 -ml-3"
            >
              <Info className="w-4 h-4" aria-hidden="true" /> {showDetails ? 'Masquer le détail du salaire' : 'Voir le détail du salaire'}
            </Button>

            {showDetails && (
              <div id="pilot-salary-detail" className="mt-2 rounded-xl bg-surface-container p-4 text-sm max-w-xl">
                <dl>
                  {detailRow('Salaire brut mensuel', showEUR(display.grossMonth), true, false)}
                  {detailRow(<>Charges salariales{!activePayslip && ` (${formatRate(Math.round(fiscalConfig.salaryChargesRate * 10000) / 100)})`}</>, <>− {showEUR(display.socialCharges)}</>)}
                  {detailRow('Remboursement Navigo', <>+ {showEUR(display.navigoGain)}</>)}
                  {!activePayslip && extraMonthlyIncome > 0 && detailRow('Autre salaire', <>+ {showEUR(extraMonthlyIncome)}</>)}
                  {(activePayslip ? display.mutuelleCost !== undefined : workBenefits.mutuelle.active) && detailRow('Mutuelle (part salarié)', <>− {showEUR(display.mutuelleCost)}</>)}
                  {(activePayslip ? display.swileCost !== undefined : workBenefits.mealVouchers.active) && detailRow('Titres-restaurant (part salarié)', <>− {showEUR(display.swileCost)}</>)}
                  {detailRow('= Net cash avant impôt', showEUR(display.superNetRaw), true)}
                  {detailRow(activePayslip ? 'Impôt réellement prélevé' : 'Impôt à la source', <>− {showEUR(display.effectiveMonthlyTax)}</>)}
                  {activePayslip && detailRow('= Net réel perçu', showEUR(effectiveSuperNet), true)}
                </dl>
                {activePayslip ? (
                  <p className="mt-3 text-xs text-on-surface-variant">Taux réel constaté : <strong className="font-medium text-on-surface">{display.autoRate !== undefined ? formatRate(Math.round(display.autoRate * 10) / 10) : '—'}</strong> (montant tel que retenu sur la fiche, pas une estimation)</p>
                ) : (
                  <div className="mt-3 pt-3 border-t border-outline-variant flex flex-wrap items-end justify-between gap-4">
                    {/* Taux du prélèvement à la source : celui du barème (calcul) ou celui que
                        l'utilisateur a saisi. Les deux s'appliquent au net imposable du mois
                        (avant l'abattement de 10 %), comme sur la fiche de paie : voir computeIncome. */}
                    <div className="text-xs text-on-surface-variant max-w-sm space-y-0.5">
                      <p>
                        Taux utilisé : <strong className="font-medium text-on-surface">{formatRate(taxRateManual > 0 ? taxRateManual : Math.round(autoValues.autoRate * 10) / 10)}</strong>
                        {taxRateManual > 0 ? ', saisi par vous.' : ', calculé automatiquement avec le barème de l\'impôt.'}
                      </p>
                      {taxRateManual > 0 && <p>Taux calculé avec le barème : {formatRate(Math.round(autoValues.autoRate * 10) / 10)}.</p>}
                      <p>Il s'applique à votre salaire imposable du mois, comme le prélèvement à la source sur votre fiche de paie.</p>
                    </div>
                    <TextField
                      label="Votre taux de prélèvement (%)"
                      supporting="Celui de votre fiche de paie. 0 = calcul automatique."
                      className="w-56"
                      render={p => <NumberInput id={p.id} describedBy={p.describedBy} invalid={p.invalid} value={taxRateManual} onChange={setTaxRateManual} min={0} suffix="%" placeholder="Auto" className={`${p.className} tabular-nums`} />}
                    />
                    {/* Second salaire (autre employeur), net par mois : il s'ajoute à la paie nette après impôt
                        et aux salaires imposables, avec l'abattement de 10 % propre aux salaires
                        (voir computeIncome). Revenus d'indépendant et loyers suivent d'autres règles
                        (pas cet abattement) : le texte d'aide les écarte de ce champ. Longtemps lu
                        sans pouvoir être modifié : une valeur reprise d'un ancien fichier se corrige ici. */}
                    <TextField
                      label="Autre salaire (net par mois)"
                      supporting="Salaire d'un autre employeur, avant impôt. Il compte dans l'impôt estimé. Revenus d'indépendant ou loyers : ne les mettez pas ici, ils ne sont pas imposés comme un salaire. 0 = aucun."
                      className="w-full sm:w-72"
                      render={p => <NumberInput id={p.id} describedBy={p.describedBy} invalid={p.invalid} value={extraMonthlyIncome} onChange={setExtraMonthlyIncome} min={0} suffix="€" className={`${p.className} tabular-nums`} />}
                    />
                  </div>
                )}
              </div>
            )}

            {/* Jour de paie : il ouvre chaque mois d'épargne (calendrier de la paie) et fixe le rappel. */}
            <div className="mt-5 pt-4 border-t border-outline-variant grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-xl">
              <div>
                <label htmlFor={paydaySelectId} className="block text-sm font-medium text-on-surface-variant mb-1.5">Jour de paie</label>
                <select
                  id={paydaySelectId}
                  value={paydayDay ?? ''}
                  onChange={(e) => setPaydayDay(e.target.value ? Number(e.target.value) : undefined)}
                  className={selectClass}
                >
                  <option value="">Pas de jour fixe</option>
                  {Array.from({ length: 31 }, (_, i) => i + 1).map(d => <option key={d} value={d}>Le {d} du mois</option>)}
                </select>
              </div>
              {/* Plusieurs comptes courants : celui où arrive la paie (son solde est prérempli dans le rituel). */}
              {currentAccounts.length > 1 && (
                <div>
                  <label htmlFor={payAccountSelectId} className="block text-sm font-medium text-on-surface-variant mb-1.5">Compte où arrive la paie</label>
                  <select
                    id={payAccountSelectId}
                    value={payAccount?.id ?? ''}
                    onChange={(e) => setPayAccountId(e.target.value || undefined)}
                    className={selectClass}
                  >
                    {currentAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </div>
              )}
            </div>
            <p className="mt-2 text-sm text-on-surface-variant max-w-xl">
              Le jour de paie ouvre chaque mois d'épargne.
              {backend && ' Ce jour-là, une notification rappelle la répartition, recalculée sur vos soldes du moment (notifications activées sur l\'appareil).'}
            </p>
            {backend && onOpenNotifications && (
              <Button variant="text" onClick={onOpenNotifications} className="mt-1 -ml-3 max-sm:h-12"><BellRing className="w-4 h-4" aria-hidden="true" /> Rappel par notification : Paramètres › Notifications</Button>
            )}
          </Disclosure>

          <Disclosure appearance="plain" headingLevel={4} title="Virements fixes" icon={Receipt} summary={`${formatEUR(budgetData.totalFixed, 0)} par mois`}>
            <p className="text-sm text-on-surface-variant mb-3">Ajoutez une charge fixe par virement sortant (ex. « Revolut commun »), sans détailler ce qu'elle paie. Les virements fixes ne sont jamais réduits.</p>
            <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
              <h5 id={expensesTitleId} tabIndex={-1} className="text-sm font-medium text-on-surface outline-none">Charges saisies</h5>
              {!isAddingExpense && (
                <Button variant="tonal" onClick={() => setIsAddingExpense(true)} className="h-9 px-4"><Plus className="w-4 h-4" aria-hidden="true" /> Ajouter une charge fixe</Button>
              )}
            </div>

            {isAddingExpense && (
              <div className="rounded-xl bg-surface-container p-4 mb-3 grid grid-cols-1 sm:grid-cols-[1fr_10rem] gap-3">
                <TextField label="Nom de la charge" placeholder="Loyer" value={newExpenseName} onChange={e => setNewExpenseName(e.target.value)} autoFocus />
                <TextField label="Montant mensuel" inputMode="decimal" placeholder="750" suffix="€" value={newExpenseAmount} onChange={e => setNewExpenseAmount(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') handleAddExpense(); }} />
                <div className="sm:col-span-2 flex justify-end gap-2">
                  <Button variant="text" onClick={() => setIsAddingExpense(false)}>Annuler</Button>
                  <Button onClick={handleAddExpense}>Ajouter la charge</Button>
                </div>
              </div>
            )}

            {expenses.length > 0 ? (
              <ul ref={expenseListRef} className="divide-y divide-outline-variant max-h-72 overflow-y-auto">
                {expenses.map((e, index) => (
                  <li key={e.id} className="flex items-center gap-3 py-1.5 text-sm">
                    <span className="flex-1 min-w-0 truncate text-on-surface">
                      {e.name}
                      {e.paymentMethod && <span className="ml-2 text-xs text-on-surface-variant">{e.paymentMethod}</span>}
                    </span>
                    <MoneyText value={e.amount} className="text-on-surface" />
                    <IconButton
                      label={`Supprimer la charge ${e.name}`}
                      icon={Trash2}
                      tone="danger"
                      onClick={() => removeExpense(e, index)}
                      data-focus-after-removal
                      className="-my-1"
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-on-surface-variant py-2">Aucune charge saisie.</p>
            )}
            {expenses.some(e => duplicateNames.has(e.id)) && (
              <p className="mt-2 text-sm text-on-tertiary-container bg-tertiary-container rounded-xl p-3 flex items-start gap-2"><Info className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" /> {expenses.filter(e => duplicateNames.has(e.id)).map(e => e.name).join(', ')} : aussi dans vos abonnements, donc compté deux fois. Supprimez la charge saisie.</p>
            )}

            {/* Abonnements : le total seulement, la liste vit dans l'onglet Abonnements. */}
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-on-surface">
                {subscriptionCharges.length > 0
                  ? <><MoneyText value={budgetData.subscriptionsFixed} /> d'abonnements mensuels</>
                  : 'Aucun abonnement actif.'}
              </p>
              <Button variant="text" size="sm" onClick={onOpenSubscriptions} aria-label="Gérer les abonnements">Gérer</Button>
            </div>
            <p className="text-xs text-on-surface-variant mt-1">Seuls les abonnements mensuels (et hebdomadaires) comptent ici. Les annuels, semestriels et trimestriels ne font que déclencher un rappel avant le prélèvement.</p>

            <div className="mt-4 pt-3 border-t border-outline-variant flex justify-between gap-3 text-sm font-medium text-on-surface">
              <span>Total des virements fixes</span>
              <MoneyText value={budgetData.totalFixed} className="pr-3" />
            </div>
          </Disclosure>

          <Disclosure appearance="plain" headingLevel={4} title="Épargne" icon={PiggyBank} summary={savingsSummary}>
            <p className="text-sm font-medium text-on-surface-variant mb-2">Épargne visée par paie</p>
            <SegmentedButton
              label="Épargne visée par paie"
              options={[
                { value: 'computed', label: `Calculée (${formatEUR(computedTarget, 0)})` },
                { value: 'fixed', label: 'Montant fixe' },
              ]}
              value={fixedMode ? 'fixed' : 'computed'}
              onChange={chooseSavingsMode}
            />
            <p className="mt-2 text-sm text-on-surface-variant max-w-xl">
              {fixedMode
                ? 'Le même montant à chaque paie, à la place du calcul. Une prime et ce qui reste du mois dernier s\'y ajoutent toujours.'
                : 'Paie habituelle, moins les virements fixes, l\'épargne projets et le solde de départ du mois. Une prime et ce qui reste du mois dernier s\'y ajoutent.'}
            </p>
            {fixedMode && (
              <TextField
                label="Montant fixe par paie"
                inputMode="decimal"
                suffix="€"
                className="tabular-nums mt-3 max-w-56"
                value={paydayAmountDraft}
                placeholder={formatEUR(computedTarget, 0)}
                onChange={(e) => {
                  setPaydayAmountDraft(e.target.value);
                  const v = e.target.value.trim() === '' ? undefined : parseFrenchNumber(e.target.value);
                  if (v === undefined) setPaydayAmount(undefined);
                  else if (v !== null && v >= 0) setPaydayAmount(v);
                }}
              />
            )}
            {fixedNote && (
              <p className="mt-3 text-sm text-on-tertiary-container bg-tertiary-container rounded-xl p-3 flex items-start gap-2 max-w-xl"><Info className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" /> {fixedNote}</p>
            )}

            <h5 className="mt-6 mb-2 text-sm font-medium text-on-surface flex items-center gap-2"><PieChart className="w-4 h-4 text-on-surface-variant" aria-hidden="true" /> Répartition entre les comptes</h5>
            <SavingsSplitEditor
              accounts={accounts}
              split={savingsSplit}
              from={savingsSplitFrom}
              sampleAmount={allocation.savings}
              fiscalConfig={fiscalConfig}
              onChange={onSavingsSplitChange}
            />
            <BookletFill booklets={bookletStats} className="mt-6 pt-4 border-t border-outline-variant" />
          </Disclosure>

          <Disclosure appearance="plain" headingLevel={4} title="Épargne projets" icon={Target} summary={`${formatEUR(projectSavings, 0)} par mois`}>
            <TextField className="max-w-md" label="Épargne projets" supporting="Argent qui part vers un compte hors de Pécule : il ne compte pas comme épargne. Pour suivre un projet, placez-le plutôt sur un compte de Pécule avec une étiquette (voyage, apport…) : « Mes comptes » en affiche le total." render={p => <NumberInput id={p.id} describedBy={p.describedBy} invalid={p.invalid} value={projectSavings} onChange={setProjectSavings} min={0} suffix="€" className={`${p.className} tabular-nums`} />} />
          </Disclosure>

          <Disclosure appearance="plain" headingLevel={4} title="Plaisir" icon={Coins} summary={`${formatEUR(leisureBudget, 0)} au départ · minimum ${formatEUR(floor, 0)}`}>
            <TextField
              className="max-w-md"
              label="Solde de départ du mois"
              supporting={`Ce que vous voulez sur le compte courant juste après la paie. Ce qui reste du mois dernier est compté : la paie complète jusqu'à ce montant, le surplus va à l'épargne. Un mois court, il baisse d'abord, jamais sous les 2/3 (${formatEUR(floor, 0)}).`}
              render={p => <NumberInput id={p.id} describedBy={p.describedBy} invalid={p.invalid} value={leisureBudget} onChange={setLeisureBudget} min={0} suffix="€" className={`${p.className} tabular-nums`} />}
            />
          </Disclosure>
        </div>
      </section>
    </div>
  );

  return (
    <div className="animate-fade-in pb-20">
      <PageHeader title="Pilotage" subtitle="Ce que devient votre paie, et où va votre épargne." />
      {monthTab}
    </div>
  );
};
