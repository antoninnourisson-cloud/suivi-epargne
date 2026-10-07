// src/components/AssistantPilot.tsx
import React, { useState, useMemo, useEffect, useId } from 'react';
import { SavingsAccount, Expense, AccountType, FiscalConfig, WorkBenefits, PayslipRecord, Subscription, PayChecklist as PayChecklistData } from '../types';
import { PayChecklist } from './PayChecklist';
import { SavingsSplitEditor } from './SavingsSplitEditor';
import { computeIncome, computeMaturityCountdown, computePlacementStrategy, payslipSuperNet, subscriptionsAsExpenses, computePayTransfers, computeRecentSavingsRate, activeSavingsSplit } from '../lib/finance';
import { parseISODate } from '../lib/dates';
import { parseFrenchNumber, safeNumber } from '../lib/numbers';
import { NumberInput } from './NumberInput';
import { isBackendEnabled } from '../services/backendService';
import { Calculator, Receipt, Info, Plus, Trash2, Coins, FileCheck2, Wand2, BellRing, PieChart, SlidersHorizontal, Sigma } from 'lucide-react';
import { formatEUR, formatPeriod, formatRate } from '../lib/format';
import { useUndoableRemove } from './Toast';
import { buildWaterfall, heroContext, AmountSource } from '../lib/pilotView';
import { Button, MoneyText, PageHeader, StatTile, Tabs, TextField, fieldClass } from './ui';
import { Disclosure } from './pilot/Disclosure';
import { BudgetWaterfall } from './pilot/BudgetWaterfall';
import { BookletFill } from './pilot/BookletFill';
import { SurvivalCard } from './pilot/SurvivalCard';
import { FiscalClock } from './pilot/FiscalClock';


interface AssistantPilotProps {
  accounts: SavingsAccount[];
  expenses: Expense[];
  onUpdateExpenses: React.Dispatch<React.SetStateAction<Expense[]>>;
  grossAnnual: number;
  setGrossAnnual: (val: number) => void;
  leisureBudget: number;
  setLeisureBudget: (val: number) => void;
  projectSavings: number;
  setProjectSavings: (val: number) => void;
  navigoBase: number;
  setNavigoBase: (val: number) => void;
  navigoRate: number;
  setNavigoRate: (val: number) => void;
  taxRateManual: number;
  setTaxRateManual: (val: number) => void;
  extraMonthlyIncome: number;
  setExtraMonthlyIncome: (val: number) => void;
  fiscalConfig: FiscalConfig;
  workBenefits: WorkBenefits;
  // Quand définie, le détail budgétaire (brut mensuel, net avant impôt, charges, navigo,
  // mutuelle, titres resto, impôt, super net) affiche les montants EXACTS de cette fiche
  // de paie, verbatim, à la place de la formule théorique (computeIncome).
  activePayslip?: PayslipRecord;
  onClearActivePayslip: () => void;
  subscriptions: Subscription[];
  onOpenSubscriptions: () => void;
  payChecklist?: PayChecklistData;
  savingsSplit?: { accountId: string; pct: number }[];
  savingsSplitFrom?: string;
  onSavingsSplitChange: (split: { accountId: string; pct: number }[] | undefined, from: string | undefined) => void;
  onPayChecklistChange: (next: PayChecklistData | undefined) => void;
  onRecordPayDeposit: (accountId: string, amount: number) => string | undefined;
  onCancelPayDeposit: (accountId: string, movementId: string) => void;
  paydayDay?: number;
  setPaydayDay: (day: number | undefined) => void;
  paydayAmount?: number;
  setPaydayAmount: (amount: number | undefined) => void;
}

export const AssistantPilot: React.FC<AssistantPilotProps> = ({
  accounts, expenses, onUpdateExpenses,
  grossAnnual, setGrossAnnual, leisureBudget, setLeisureBudget, projectSavings, setProjectSavings,
  navigoBase, navigoRate, taxRateManual, setTaxRateManual,
  extraMonthlyIncome, fiscalConfig, workBenefits, activePayslip, onClearActivePayslip,
  subscriptions, onOpenSubscriptions, savingsSplit, savingsSplitFrom, onSavingsSplitChange, payChecklist, onPayChecklistChange, onRecordPayDeposit, onCancelPayDeposit, paydayDay, setPaydayDay, paydayAmount, setPaydayAmount
}) => {
  const [showDetails, setShowDetails] = useState(false);
  const removeWithUndo = useUndoableRemove();
  const [externalSavings, setExternalSavings] = useState<number>(0);
  const [manualSavingsCapacity, setManualSavingsCapacity] = useState<string | null>(null); 
  const [activeTab, setActiveTab] = useState<'budget' | 'fiscal'>('budget');
  
  // UX State pour ajout dépense
  const [isAddingExpense, setIsAddingExpense] = useState(false);
  const [newExpenseName, setNewExpenseName] = useState('');
  const [newExpenseAmount, setNewExpenseAmount] = useState('');
  // Brouillon du montant du rappel de paie : on ne persiste qu'une saisie interprétable
  // (vide = capacité calculée), sans réécrire le champ pendant la frappe.
  const [paydayAmountDraft, setPaydayAmountDraft] = useState(paydayAmount !== undefined ? String(paydayAmount) : '');
  // Le Pilotage peut s'afficher avant la fin du chargement Drive : le champ restait alors
  // vide alors qu'un montant était enregistré. On le resynchronise quand la valeur arrive.
  useEffect(() => {
    setPaydayAmountDraft(prev => (parseFrenchNumber(prev) ?? undefined) === paydayAmount ? prev : (paydayAmount !== undefined ? String(paydayAmount).replace('.', ',') : ''));
  }, [paydayAmount]);

  const autoValues = useMemo(
    () =>
      computeIncome(
        { grossAnnual, extraMonthlyIncome, navigoBase, navigoRate, taxRateManual },
        fiscalConfig,
        workBenefits
      ),
    [grossAnnual, extraMonthlyIncome, fiscalConfig, workBenefits, navigoBase, navigoRate, taxRateManual]
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

  // Abonnements actifs, en coût mensuel : ajoutés d'office aux charges fixes, gérés depuis
  // l'écran Abonnements (jamais supprimables d'ici, pour ne pas désynchroniser les rappels).
  const subscriptionCharges = useMemo(() => subscriptionsAsExpenses(subscriptions), [subscriptions]);
  // Charge saisie à la main qui porte le nom d'un abonnement : sans doute comptée deux fois.
  const duplicateNames = useMemo(() => {
    const names = new Set(subscriptionCharges.map(c => c.name.trim().toLowerCase()));
    return new Set(expenses.filter(e => names.has(e.name.trim().toLowerCase())).map(e => e.id));
  }, [expenses, subscriptionCharges]);

  const budgetData = useMemo(() => {
    const manualFixed = expenses.reduce((sum, e) => sum + e.amount, 0);
    const subscriptionsFixed = subscriptionCharges.reduce((sum, e) => sum + e.amount, 0);
    const totalFixed = manualFixed + subscriptionsFixed;
    const theoreticalCapacity = effectiveSuperNetForCalc - totalFixed - leisureBudget - projectSavings;
    // parseFrenchNumber et non parseFloat : vider le champ (ou taper "-" seul) donnait
    // NaN → "Placement (NaN €)" et un plan de placement qui disparaissait sans message.
    // Saisie non interprétable = retour au calcul automatique.
    const manualParsed = manualSavingsCapacity !== null ? parseFrenchNumber(manualSavingsCapacity) : null;
    // Montant fixé dans le rappel de paie : c'est lui que le Pilotage répartit (même chiffre
    // que la notification, la relance, l'agenda et la jauge du mois).
    const finalCapacity = manualParsed ?? paydayAmount ?? theoreticalCapacity;
    const totalToInvest = Math.max(0, finalCapacity + externalSavings);
    // Pour l'affichage seulement : d'où vient le montant retenu.
    const source: AmountSource = manualParsed !== null ? 'manual' : paydayAmount !== undefined ? 'payday' : 'calc';
    return { manualFixed, totalFixed, subscriptionsFixed, theoreticalCapacity, finalCapacity, totalToInvest, source };
  }, [effectiveSuperNetForCalc, expenses, subscriptionCharges, leisureBudget, projectSavings, manualSavingsCapacity, externalSavings, paydayAmount]);

  const payTransfers = useMemo(
    () => computePayTransfers({ expenses, subscriptions, leisureBudget, projectSavings }),
    [expenses, subscriptions, leisureBudget, projectSavings]
  );

  const strategy = useMemo(
    () => computePlacementStrategy(budgetData.totalToInvest, accounts, fiscalConfig, activeSavingsSplit({ savingsSplit, savingsSplitFrom })),
    [budgetData.totalToInvest, accounts, fiscalConfig, savingsSplit, savingsSplitFrom]
  );

  const bookletStats = useMemo(() => {
    const defaults: Partial<Record<AccountType, number>> = {
      [AccountType.LEP]: fiscalConfig.ceilings.lep,
      [AccountType.LIVRET_A]: fiscalConfig.ceilings.livretA,
      [AccountType.LDDS]: fiscalConfig.ceilings.ldds,
    };
    // TOUS les comptes de chaque type réglementé, pas seulement le premier trouvé : un
    // second Livret A était invisible ici et exclu de l'espace restant. Le plafond saisi
    // sur le compte prime sur la config globale (il était stocké mais jamais lu).
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

  const survival = useMemo(() => {
    const liquidMoney = accounts.filter(a => !a.contractEndDate && ![AccountType.IMMOBILIER, AccountType.PER, AccountType.PEE].includes(a.type)).reduce((sum, a) => sum + a.ownedAmount, 0);
    const monthlyBurn = budgetData.totalFixed;

    // Le retour anticipé "Infini" doit porter TOUS les champs lus par le JSX : l'ancienne
    // version omettait years/months/days/monthlyBurn et l'écran affichait littéralement
    // "m j" et "Avec € de charges fixes".
    if (monthlyBurn === 0) {
      return { infinite: true, years: 0, months: 0, days: 0, monthlyBurn: 0, totalMonths: Infinity };
    }

    const totalMonths = liquidMoney / monthlyBurn;
    const years = Math.floor(totalMonths / 12);
    const months = Math.floor(totalMonths % 12);
    const days = Math.floor((totalMonths * 30) % 30);

    return { infinite: false, years, months, days, monthlyBurn, totalMonths };
  }, [accounts, budgetData.totalFixed]);

  const fiscalClock = useMemo(() => {
    return accounts.filter(a => [AccountType.PEE, AccountType.PEA, AccountType.ASSURANCE_VIE].includes(a.type)).map(acc => {
        // Cas particulier : un PEE avec date de fin de contrat explicite prime sur le
        // calcul d'ancienneté.
        if (acc.type === AccountType.PEE && acc.contractEndDate) {
          const endDate = parseISODate(acc.contractEndDate);
          const diffTime = endDate.getTime() - Date.now();
          const isAvailable = diffTime <= 0;
          const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
          const years = Math.floor(diffDays / 365); const months = Math.floor((diffDays % 365) / 30);
          return { id: acc.id, name: acc.name, type: acc.type, date: endDate.toLocaleDateString('fr-FR'), timeLeft: isAvailable ? "Disponible" : `${years > 0 ? years + 'a ' : ''}${months}m`, isAvailable };
        }
        // Sinon : MÊME calcul que le badge de "Mes comptes" (computeMaturityCountdown),
        // qui applique la bonne maturité par type — l'ancien code donnait au PEE la
        // maturité de l'Assurance Vie (8 ans au lieu de legalMaturity.pee), et ses
        // conventions d'arrondi divergeaient du badge d'un mois.
        if (!acc.openingDate) return null;
        const countdown = computeMaturityCountdown(acc, fiscalConfig);
        if (!countdown) {
          // computeMaturityCountdown renvoie null pour "déjà mature" : ici c'est une info
          // à afficher, pas à masquer.
          return { id: acc.id, name: acc.name, type: acc.type, date: '', timeLeft: 'Disponible', isAvailable: true };
        }
        const years = Math.floor(countdown.monthsRemaining / 12);
        const months = countdown.monthsRemaining % 12;
        return {
          id: acc.id, name: acc.name, type: acc.type,
          date: parseISODate(countdown.maturityDate).toLocaleDateString('fr-FR'),
          timeLeft: `${years > 0 ? years + 'a ' : ''}${months}m`,
          isAvailable: false,
        };
    }).filter(item => item !== null);
  }, [accounts, fiscalConfig]);


  // Montant à placer : expliqué en une phrase (hero) puis ligne par ligne (D'où vient ce chiffre).
  const payLabel = display.isReal
    ? (effectiveSuperNet === undefined ? 'Paie nette du mois (estimation)' : 'Net réel perçu (fiche de paie)')
    : 'Paie nette du mois, après impôt';
  const waterfall = useMemo(() => buildWaterfall({
    pay: effectiveSuperNetForCalc,
    payLabel,
    manualFixed: budgetData.manualFixed,
    subscriptionsFixed: budgetData.subscriptionsFixed,
    leisureBudget,
    projectSavings,
    theoreticalCapacity: budgetData.theoreticalCapacity,
    source: budgetData.source,
    retained: budgetData.finalCapacity,
    externalSavings,
    totalToInvest: budgetData.totalToInvest,
  }), [effectiveSuperNetForCalc, payLabel, budgetData, leisureBudget, projectSavings, externalSavings]);
  const heroSentence = heroContext({
    pay: effectiveSuperNetForCalc,
    source: budgetData.source,
    theoreticalCapacity: budgetData.theoreticalCapacity,
    externalSavings,
    totalToInvest: budgetData.totalToInvest,
    finalCapacity: budgetData.finalCapacity,
  });
  const shortfall = Math.max(0, -budgetData.finalCapacity, -budgetData.theoreticalCapacity, paydayAmount !== undefined && manualSavingsCapacity === null ? paydayAmount - Math.max(0, budgetData.theoreticalCapacity) : 0);
  const customSplit = activeSavingsSplit({ savingsSplit, savingsSplitFrom }) !== undefined;
  const plannedSpending = budgetData.totalFixed + leisureBudget + projectSavings;
  const paydaySelectId = useId();

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

  const budgetTab = (
    <div className="space-y-6">
      {/* a. La réponse : combien placer ce mois-ci. */}
      <section aria-label="À placer ce mois" className="rounded-3xl bg-secondary-container p-6 sm:p-8">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6">
          <StatTile size="hero" label="À placer ce mois" value={<MoneyText value={budgetData.totalToInvest} />} />
          <dl className="grid grid-cols-2 gap-x-8 gap-y-1 text-sm">
            <dt className="text-on-surface-variant">Paie du mois</dt>
            <dt className="text-on-surface-variant">Dépenses prévues</dt>
            <dd className="text-lg text-on-surface"><MoneyText value={effectiveSuperNetForCalc} decimals={0} /></dd>
            <dd className="text-lg text-on-surface"><MoneyText value={plannedSpending} decimals={0} /></dd>
          </dl>
        </div>
        <p className="mt-4 text-sm text-on-surface-variant max-w-2xl">{heroSentence}</p>
      </section>

      {/* b. Où le placer, virement par virement. */}
      <PayChecklist
        superNet={effectiveSuperNetForCalc}
        transfers={payTransfers}
        steps={strategy}
        totalToInvest={budgetData.totalToInvest}
        shortfall={shortfall}
        checklist={payChecklist}
        onChange={onPayChecklistChange}
        onRecordDeposit={onRecordPayDeposit}
        onCancelDeposit={onCancelPayDeposit}
        paydayDay={paydayDay}
        customSplit={customSplit}
      />

      {/* c. D'où vient ce chiffre. */}
      <Disclosure title="D'où vient ce chiffre" icon={Sigma} summary={<MoneyText value={budgetData.totalToInvest} />}>
        <BudgetWaterfall rows={waterfall} />
        <p className="mt-3 text-xs text-on-surface-variant">Le détail de votre salaire (brut, charges, impôt) et tous les montants se règlent dans « Mes paramètres », plus bas.</p>
      </Disclosure>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <BookletFill booklets={bookletStats} />
        <SurvivalCard survival={survival} />
      </div>

      {/* d. Les réglages, repliés par groupe. */}
      <section aria-labelledby="pilot-settings-title" className="pt-2">
        <h3 id="pilot-settings-title" className="text-lg font-medium text-on-surface flex items-center gap-2"><SlidersHorizontal className="w-5 h-5 text-indigo-600 dark:text-indigo-300" aria-hidden="true" /> Mes paramètres</h3>
        <p className="text-sm text-on-surface-variant mt-1 mb-4">Salaire, charges et budgets : le montant à placer se recalcule dès que vous les modifiez.</p>
        <div className="rounded-2xl border border-outline-variant bg-surface-container-lowest dark:bg-surface-container-low divide-y divide-outline-variant overflow-hidden">

          <Disclosure appearance="plain" headingLevel={4} title="Revenus et salaire" icon={Calculator} summary={effectiveSuperNet === undefined ? '—' : `${formatEUR(effectiveSuperNet, 0)} nets par mois`}>
            {activePayslip && (
              <div className="mb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl bg-tertiary-container text-on-tertiary-container p-3">
                <p className="flex items-start gap-2 text-sm">
                  <FileCheck2 className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                  Chiffres exacts de votre fiche de {activePayslip.extracted.period ? formatPeriod(activePayslip.extracted.period) : 'paie'} ({activePayslip.extracted.employer || activePayslip.fileName}) — recopiés tels quels, sans calcul.
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
              {readOnlyValue(activePayslip ? 'Net réel perçu' : 'Reste à vivre', showEUR(effectiveSuperNet))}
            </div>

            <button
              type="button"
              onClick={() => setShowDetails(!showDetails)}
              aria-expanded={showDetails}
              aria-controls="pilot-salary-detail"
              className="mt-3 h-10 px-3 -ml-3 rounded-full text-sm font-medium text-indigo-700 dark:text-indigo-200 hover:bg-indigo-600/8 inline-flex items-center gap-2"
            >
              <Info className="w-4 h-4" aria-hidden="true" /> {showDetails ? 'Masquer le détail du salaire' : 'Voir le détail du salaire'}
            </button>

            {showDetails && (
              <div id="pilot-salary-detail" className="mt-2 rounded-xl bg-surface-container p-4 text-sm max-w-xl">
                <dl>
                  {detailRow('Salaire brut mensuel', showEUR(display.grossMonth), true, false)}
                  {detailRow(<>Charges salariales{!activePayslip && ` (${formatRate(Math.round(fiscalConfig.salaryChargesRate * 10000) / 100)})`}</>, <>− {showEUR(display.socialCharges)}</>)}
                  {detailRow('Remboursement Navigo', <>+ {showEUR(display.navigoGain)}</>)}
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
                    <div className="text-xs text-on-surface-variant">
                      <p>Taux du barème (automatique) : <strong className="font-medium text-on-surface">{formatRate(Math.round(autoValues.autoRate * 10) / 10)}</strong></p>
                      {taxRateManual > 0 && <p className="mt-0.5">Taux forcé à : <strong className="font-medium text-on-surface">{formatRate(taxRateManual)}</strong></p>}
                    </div>
                    <TextField
                      label="Forcer le taux (%)"
                      supporting="0 = automatique"
                      className="w-44"
                      render={p => <NumberInput id={p.id} describedBy={p.describedBy} invalid={p.invalid} value={taxRateManual} onChange={setTaxRateManual} min={0} suffix="%" placeholder="Auto" className={`${p.className} tabular-nums`} />}
                    />
                  </div>
                )}
              </div>
            )}
          </Disclosure>

          <Disclosure appearance="plain" headingLevel={4} title="Charges fixes et abonnements" icon={Receipt} summary={`${formatEUR(budgetData.totalFixed, 0)} par mois`}>
            <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
              <h5 className="text-sm font-medium text-on-surface">Charges saisies</h5>
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
              <ul className="divide-y divide-outline-variant max-h-72 overflow-y-auto">
                {expenses.map(e => (
                  <li key={e.id} className="flex items-center gap-3 py-1.5 text-sm">
                    <span className="flex-1 min-w-0 truncate text-on-surface">
                      {e.name}
                      {e.paymentMethod && <span className="ml-2 text-xs text-on-surface-variant">{e.paymentMethod}</span>}
                    </span>
                    <MoneyText value={e.amount} className="text-on-surface" />
                    <button
                      type="button"
                      aria-label={`Supprimer la charge ${e.name}`}
                      onClick={() => removeWithUndo(expenses, e, onUpdateExpenses, `Charge « ${e.name} » supprimée`)}
                      className="w-10 h-10 shrink-0 rounded-full flex items-center justify-center text-on-surface-variant hover:bg-on-surface/8 hover:text-error"
                    >
                      <Trash2 className="w-4 h-4" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-on-surface-variant py-2">Aucune charge saisie.</p>
            )}
            {expenses.some(e => duplicateNames.has(e.id)) && (
              <p className="mt-2 text-sm text-on-tertiary-container bg-tertiary-container rounded-xl p-3 flex items-start gap-2"><Info className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" /> {expenses.filter(e => duplicateNames.has(e.id)).map(e => e.name).join(', ')} : aussi dans vos abonnements, donc compté deux fois. Supprimez la charge saisie.</p>
            )}

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 mb-1">
              <h5 className="text-sm font-medium text-on-surface">Abonnements (automatique)</h5>
              <Button variant="text" onClick={onOpenSubscriptions} className="h-9 px-3">Gérer les abonnements</Button>
            </div>
            {subscriptionCharges.length > 0 ? (
              <ul className="divide-y divide-outline-variant max-h-60 overflow-y-auto">
                {subscriptionCharges.map(c => (
                  <li key={c.id} className="flex items-center gap-3 py-2.5 text-sm">
                    <span className="flex-1 min-w-0 truncate text-on-surface">
                      {c.name}
                      {c.paymentMethod && <span className="ml-2 text-xs text-on-surface-variant">{c.paymentMethod}</span>}
                    </span>
                    <MoneyText value={c.amount} className="text-on-surface pr-3" />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-on-surface-variant py-2">Aucun abonnement actif.</p>
            )}
            <p className="text-xs text-on-surface-variant mt-1">Seuls les abonnements mensuels (et hebdomadaires) comptent ici. Les annuels, semestriels et trimestriels ne font que déclencher un rappel avant le prélèvement.</p>

            <div className="mt-4 pt-3 border-t border-outline-variant flex justify-between gap-3 text-sm font-medium text-on-surface">
              <span>Total des charges</span>
              <MoneyText value={budgetData.totalFixed} className="pr-3" />
            </div>
          </Disclosure>

          <Disclosure appearance="plain" headingLevel={4} title="Budgets et montant du mois" icon={Coins} summary={`${formatEUR(leisureBudget, 0)} plaisir · ${formatEUR(projectSavings, 0)} projets`}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <TextField label="Argent plaisir" supporting="Ce qui reste sur le compte courant pour le mois." render={p => <NumberInput id={p.id} describedBy={p.describedBy} invalid={p.invalid} value={leisureBudget} onChange={setLeisureBudget} min={0} suffix="€" className={`${p.className} tabular-nums`} />} />
              <TextField label="Épargne projets" supporting="Mise de côté pour un projet, avant le placement." render={p => <NumberInput id={p.id} describedBy={p.describedBy} invalid={p.invalid} value={projectSavings} onChange={setProjectSavings} min={0} suffix="€" className={`${p.className} tabular-nums`} />} />
              <div>
                <TextField
                  id="savings-capacity"
                  label="Capacité d'épargne du mois"
                  inputMode="decimal"
                  suffix="€"
                  className="tabular-nums"
                  value={manualSavingsCapacity !== null ? manualSavingsCapacity : String(Math.round(paydayAmount ?? budgetData.theoreticalCapacity))}
                  onChange={e => setManualSavingsCapacity(e.target.value)}
                  supporting={paydayAmount !== undefined && manualSavingsCapacity === null
                    ? `Montant fixé dans le rappel de paie (capacité calculée : ${formatEUR(budgetData.theoreticalCapacity, 0)}).`
                    : `Calculée : ${formatEUR(budgetData.theoreticalCapacity, 0)}. Modifiez-la si ce mois est différent.`}
                />
                {manualSavingsCapacity !== null && (
                  <Button variant="text" onClick={() => setManualSavingsCapacity(null)} className="mt-1 h-9 px-3">Revenir au calcul</Button>
                )}
              </div>
              <TextField
                label="Somme en plus à placer ce mois-ci"
                supporting="Prime, cadeau, remboursement… ajouté au plan de placement."
                render={p => <NumberInput id={p.id} describedBy={p.describedBy} invalid={p.invalid} value={externalSavings} onChange={setExternalSavings} suffix="€" className={`${p.className} tabular-nums`} />}
              />
            </div>
          </Disclosure>

          <Disclosure appearance="plain" headingLevel={4} title="Répartition de l'épargne" icon={PieChart} summary={customSplit ? 'Personnalisée' : 'Automatique'}>
            <SavingsSplitEditor
              accounts={accounts}
              split={savingsSplit}
              from={savingsSplitFrom}
              sampleAmount={budgetData.totalToInvest}
              fiscalConfig={fiscalConfig}
              onChange={onSavingsSplitChange}
            />
          </Disclosure>

          {isBackendEnabled() && (
            <Disclosure appearance="plain" headingLevel={4} title="Rappel le jour de paie" icon={BellRing} summary={paydayDay !== undefined ? `Le ${paydayDay} du mois` : 'Désactivé'}>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-xl">
                <div>
                  <label htmlFor={paydaySelectId} className="block text-sm font-medium text-on-surface-variant mb-1.5">Jour du rappel</label>
                  <select
                    id={paydaySelectId}
                    value={paydayDay ?? ''}
                    onChange={(e) => setPaydayDay(e.target.value ? Number(e.target.value) : undefined)}
                    className={`${fieldClass} dark:bg-surface-container-low`}
                  >
                    <option value="">Désactivé</option>
                    {Array.from({ length: 31 }, (_, i) => i + 1).map(d => <option key={d} value={d}>Le {d} du mois</option>)}
                  </select>
                </div>
                {paydayDay !== undefined && (
                  <TextField
                    label="Montant"
                    inputMode="decimal"
                    suffix="€"
                    className="tabular-nums"
                    value={paydayAmountDraft}
                    placeholder={`${formatEUR(Math.max(0, budgetData.theoreticalCapacity), 0)} (calculé)`}
                    onChange={(e) => {
                      setPaydayAmountDraft(e.target.value);
                      const v = e.target.value.trim() === '' ? undefined : parseFrenchNumber(e.target.value);
                      if (v === undefined) setPaydayAmount(undefined);
                      else if (v !== null && v >= 0) setPaydayAmount(v);
                    }}
                  />
                )}
              </div>
              <p className="mt-3 text-sm text-on-surface-variant">
                Une notification ce jour-là avec la répartition ci-dessus, recalculée sur vos soldes du moment. Sans montant saisi, c'est la capacité d'épargne calculée qui est utilisée. Les notifications doivent être activées sur l'appareil (Paramètres).
              </p>
            </Disclosure>
          )}
        </div>
      </section>
    </div>
  );

  return (
    <div className="animate-fade-in pb-20">
      <PageHeader title="Pilotage" subtitle="Combien placer ce mois-ci, sur quels comptes, et pourquoi." />
      <Tabs
        label="Pilotage"
        value={activeTab}
        onChange={setActiveTab}
        tabs={[{ value: 'budget', label: 'Pilotage budgétaire' }, { value: 'fiscal', label: 'Horloge fiscale' }]}
      >
        {activeTab === 'budget' ? budgetTab : <FiscalClock items={fiscalClock} />}
      </Tabs>
    </div>
  );
};
