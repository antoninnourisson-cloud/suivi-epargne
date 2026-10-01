// src/components/AssistantPilot.tsx
import React, { useState, useMemo, useEffect } from 'react';
import { SavingsAccount, Expense, AccountType, FiscalConfig, WorkBenefits, PayslipRecord, Subscription, PayChecklist as PayChecklistData } from '../types';
import { PayChecklist } from './PayChecklist';
import { SavingsSplitEditor } from './SavingsSplitEditor';
import { computeIncome, computeMaturityCountdown, computePlacementStrategy, payslipSuperNet, subscriptionsAsExpenses, computePayTransfers, computeRecentSavingsRate, activeSavingsSplit } from '../lib/finance';
import { parseISODate } from '../lib/dates';
import { parseFrenchNumber, safeNumber } from '../lib/numbers';
import { NumberInput } from './NumberInput';
import { isBackendEnabled } from '../services/backendService';
import { Calculator, TrendingUp, Target, Lock, Unlock, Info, Plus, Trash2, Hourglass, Coins, BarChart3, X, Check, FileCheck2, Wand2, BellRing, Wallet } from 'lucide-react';
import { formatEUR, formatPeriod } from '../lib/format';
import { useUndoableRemove } from './Toast';


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
  navigoBase, setNavigoBase, navigoRate, setNavigoRate, taxRateManual, setTaxRateManual,
  extraMonthlyIncome, setExtraMonthlyIncome, fiscalConfig, workBenefits, activePayslip, onClearActivePayslip,
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
    return { totalFixed, subscriptionsFixed, theoreticalCapacity, finalCapacity, totalToInvest };
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
      return {
        infinite: true, years: 0, months: 0, days: 0, monthlyBurn: 0, totalMonths: Infinity,
        color: "text-slate-500 dark:text-slate-400", bg: "bg-slate-50 dark:bg-slate-900", border: "border-slate-200 dark:border-slate-700",
      };
    }

    const totalMonths = liquidMoney / monthlyBurn;
    const years = Math.floor(totalMonths / 12);
    const months = Math.floor(totalMonths % 12);
    const days = Math.floor((totalMonths * 30) % 30);

    let color = 'text-emerald-600'; let border = 'border-emerald-200'; let bg = 'bg-emerald-50';
    if (totalMonths < 3) { color = 'text-rose-600'; border = 'border-rose-200'; bg = 'bg-rose-50'; }
    else if (totalMonths < 6) { color = 'text-orange-600'; border = 'border-orange-200'; bg = 'bg-orange-50'; }

    return { infinite: false, years, months, days, color, border, bg, monthlyBurn, totalMonths };
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

  return (
    <div className="space-y-8 animate-fade-in pb-20">
      <div className="flex gap-4 border-b border-slate-200 dark:border-slate-700">
        <button onClick={() => setActiveTab('budget')} className={`pb-2 px-4 font-bold text-sm ${activeTab === 'budget' ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-slate-500 dark:text-slate-400'}`}>Pilotage budgétaire</button>
        <button onClick={() => setActiveTab('fiscal')} className={`pb-2 px-4 font-bold text-sm ${activeTab === 'fiscal' ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-slate-500 dark:text-slate-400'}`}>Horloge fiscale</button>
      </div>

      {activeTab === 'budget' && (
        <>
          <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm">
            <h3 className="text-lg font-black text-slate-800 dark:text-slate-100 mb-6 flex items-center gap-2"><Calculator className="w-5 h-5 text-indigo-600" /> Revenus et salaire</h3>

            {activePayslip && (
              <div className="mb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-xl p-3">
                <div className="flex items-center gap-2 text-amber-800 dark:text-amber-300 text-xs font-bold">
                  <FileCheck2 className="w-4 h-4 flex-shrink-0" />
                  Chiffres exacts de votre fiche de {activePayslip.extracted.period ? formatPeriod(activePayslip.extracted.period) : 'paie'} ({activePayslip.extracted.employer || activePayslip.fileName}) — recopiés tels quels, sans calcul.
                </div>
                <button onClick={onClearActivePayslip} className="flex items-center gap-1 text-xs font-bold text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900 px-3 py-1.5 rounded-lg flex-shrink-0"><Wand2 className="w-3.5 h-3.5" /> Repasser en estimation</button>
              </div>
            )}

            {activePayslip && display.effectiveMonthlyTax === undefined && (
              <div className="mb-4 text-xs text-rose-600 dark:text-rose-400 font-bold flex items-center gap-2">
                <Info className="w-3.5 h-3.5 flex-shrink-0" />
                Cette fiche n'a pas encore l'impôt réellement prélevé / le net payé (extraite avant l'ajout de ces champs) : "Net réel perçu" affiche "—" plutôt qu'une estimation. Réimportez-la depuis Drive pour compléter.
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
              <div className="bg-slate-50 dark:bg-slate-900 p-3 rounded-xl border border-slate-200 dark:border-slate-700"><label className="text-[11px] font-black text-slate-500 dark:text-slate-400 uppercase">Brut annuel</label><NumberInput value={Math.round(grossAnnual)} onChange={updateFromGrossAnnual} min={0} suffix="€" className="w-full bg-transparent font-black text-slate-800 dark:text-slate-100 text-lg outline-none" /></div>
              <div className="bg-slate-50 dark:bg-slate-900 p-3 rounded-xl border border-slate-200 dark:border-slate-700">
                <label className="text-[11px] font-black text-slate-500 dark:text-slate-400 uppercase">Brut mensuel</label>
                {activePayslip
                  ? <p className="font-black text-slate-800 dark:text-slate-100 text-lg">{showEUR(display.grossMonth)}</p>
                  : <NumberInput value={Math.round(autoValues.grossMonth)} onChange={updateFromGrossMonth} min={0} className="w-full bg-transparent font-black text-slate-800 dark:text-slate-100 text-lg outline-none" />}
              </div>
              <div className="bg-indigo-50 dark:bg-indigo-950/40 p-3 rounded-xl border border-indigo-100 dark:border-indigo-900">
                <label className="text-[11px] font-black text-indigo-400 dark:text-indigo-400 uppercase">Net avant impôt</label>
                {activePayslip
                  ? <p className="font-black text-indigo-700 dark:text-indigo-300 text-lg">{showEUR(display.netBeforeTax)}</p>
                  : <NumberInput value={Math.round(autoValues.netBeforeTax * 100)/100} onChange={updateFromNet} min={0} className="w-full bg-transparent font-black text-indigo-700 dark:text-indigo-300 text-lg outline-none" />}
              </div>
              <div className="bg-emerald-50 dark:bg-emerald-950/40 p-3 rounded-xl border border-emerald-100 dark:border-emerald-900 relative">
                <label className="text-[11px] font-black text-emerald-600 dark:text-emerald-400 uppercase flex items-center gap-1">{activePayslip ? 'Net réel perçu' : 'Super net (Poche)'} <Info className="w-3 h-3 cursor-pointer" onClick={() => setShowDetails(!showDetails)}/></label>
                <p className="font-black text-emerald-700 dark:text-emerald-300 text-2xl">{showEUR(effectiveSuperNet)}</p>
              </div>
            </div>

            {showDetails && (
              <div className="bg-white dark:bg-slate-800 p-4 rounded-xl text-xs space-y-3 border border-slate-200 dark:border-slate-700 animate-in slide-in-from-top-2 shadow-inner mb-4">
                 <div className="flex justify-between font-bold border-b pb-1"><span>Salaire brut mensuel</span> <span>{showEUR(display.grossMonth)}</span></div>
                 <div className="flex justify-between text-rose-500"><span>Charges salariales{!activePayslip && ` (${(fiscalConfig.salaryChargesRate*100).toFixed(2)}%)`}</span> <span>- {showEUR(display.socialCharges)}</span></div>
                 <div className="flex justify-between text-emerald-600"><span>Remboursement Navigo</span> <span>+ {showEUR(display.navigoGain)}</span></div>
                 {(activePayslip ? display.mutuelleCost !== undefined : workBenefits.mutuelle.active) && <div className="flex justify-between text-rose-500"><span>Mutuelle (part salarié)</span><span>- {showEUR(display.mutuelleCost)}</span></div>}
                 {(activePayslip ? display.swileCost !== undefined : workBenefits.mealVouchers.active) && <div className="flex justify-between text-rose-500"><span>Titres-restaurant (part salarié)</span><span>- {showEUR(display.swileCost)}</span></div>}
                 <div className="flex justify-between font-bold text-indigo-700 pt-1 border-t border-slate-100 dark:border-slate-800"><span>= Net cash avant impôt</span> <span>{showEUR(display.superNetRaw)}</span></div>
                 <div className="bg-amber-50 p-2 rounded-lg border border-amber-100">
                    <div className="flex justify-between items-center mb-2"><span className="text-amber-800 font-bold">{activePayslip ? 'Impôt réellement prélevé' : 'Impôt à la source'}</span><span className="text-amber-600 font-mono font-black">- {showEUR(display.effectiveMonthlyTax)}</span></div>
                    {activePayslip ? (
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">Taux réel constaté : <strong>{display.autoRate !== undefined ? `${display.autoRate.toFixed(1)}%` : '—'}</strong> (montant tel que retenu sur la fiche, pas une estimation)</p>
                    ) : (
                    <div className="flex items-center justify-between text-[11px] gap-2">
                        <div className="flex flex-col"><span className="text-slate-500 dark:text-slate-400">Taux du barème (Auto) : <strong>{autoValues.autoRate.toFixed(1)}%</strong></span>{taxRateManual > 0 && <span className="text-amber-600">Force à : <strong>{taxRateManual}%</strong></span>}</div>
                        <div className="flex items-center gap-1"><label className="text-slate-500 dark:text-slate-400">Forcer taux :</label><NumberInput value={taxRateManual} onChange={setTaxRateManual} min={0} className="w-12 p-1 text-right bg-white dark:bg-slate-800 border border-amber-200 rounded font-bold outline-none" placeholder="Auto"/><span className="text-slate-500 dark:text-slate-400">%</span></div>
                    </div>
                    )}
                 </div>
                 {activePayslip && <div className="flex justify-between font-bold text-emerald-700 pt-1 border-t border-slate-100 dark:border-slate-800"><span>= Net réel perçu</span> <span>{showEUR(effectiveSuperNet)}</span></div>}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-1 bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm">
              <div className="flex justify-between items-center mb-4">
                  <h4 className="font-bold text-slate-700 dark:text-slate-200 flex items-center gap-2"><TrendingUp className="w-4 h-4 text-rose-500"/> Charges fixes</h4>
                  <button onClick={() => setIsAddingExpense(true)} aria-label="Ajouter une charge fixe" className="p-2 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 rounded hover:bg-slate-200 dark:hover:bg-slate-600"><Plus className="w-4 h-4"/></button>
              </div>
              
              {/* Formulaire Ajout Rapide */}
              {isAddingExpense && (
                  <div className="bg-indigo-50 p-2 rounded-lg mb-2 flex flex-col gap-2">
                      <input type="text" placeholder="Nom..." className="p-1 rounded text-xs border border-indigo-100" value={newExpenseName} onChange={e => setNewExpenseName(e.target.value)} autoFocus />
                      <div className="flex gap-1">
                          <input type="text" inputMode="decimal" placeholder="€..." className="p-1 rounded text-xs border border-indigo-100 w-20" value={newExpenseAmount} onChange={e => setNewExpenseAmount(e.target.value)} />
                          <button onClick={handleAddExpense} className="flex-1 bg-indigo-600 text-white rounded flex items-center justify-center"><Check className="w-3 h-3"/></button>
                          <button onClick={() => setIsAddingExpense(false)} className="bg-slate-300 text-white rounded p-1"><X className="w-3 h-3"/></button>
                      </div>
                  </div>
              )}

              <div className="space-y-2 max-h-60 overflow-y-auto pr-2">
                  {expenses.map(e => (
                      <div key={e.id} className="flex justify-between items-center text-sm p-2 bg-slate-50 dark:bg-slate-900 rounded group gap-2">
                          <span className="min-w-0 truncate">
                            {e.name}
                            {e.paymentMethod && <span className="ml-2 text-[11px] font-bold uppercase text-slate-500 dark:text-slate-400">{e.paymentMethod}</span>}
                          </span>
                          <div className="flex items-center gap-1 flex-shrink-0">
                              <span className="font-mono font-bold">{formatEUR(e.amount)}</span>
                              {/* Visible en permanence sur tactile (pas de hover sur mobile : sans le
                                  préfixe `md:`, l'icône restait invisible et la dépense indélétable). */}
                              <button
                                type="button"
                                aria-label={`Supprimer la charge ${e.name}`}
                                onClick={() => removeWithUndo(expenses, e, onUpdateExpenses, `Charge « ${e.name} » supprimée`)}
                                className="p-2 -m-1 text-slate-400 hover:text-rose-500 opacity-100 md:opacity-0 md:group-hover:opacity-100 focus:opacity-100 transition-opacity"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                          </div>
                      </div>
                  ))}
                  {expenses.length === 0 && <p className="text-xs text-slate-500 dark:text-slate-400 italic p-2">Aucune charge saisie.</p>}
              </div>
              {expenses.some(e => duplicateNames.has(e.id)) && (
                <p className="mt-2 text-[11px] font-bold text-amber-600 flex items-start gap-1"><Info className="w-3 h-3 flex-shrink-0 mt-0.5" /> {expenses.filter(e => duplicateNames.has(e.id)).map(e => e.name).join(', ')} : aussi dans vos abonnements, donc compté deux fois. Supprimez la charge saisie.</p>
              )}
              <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-700">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[11px] font-black text-slate-500 dark:text-slate-400 uppercase">Abonnements (automatique)</p>
                  <button type="button" onClick={onOpenSubscriptions} className="text-[11px] font-bold text-indigo-600 hover:underline">Gérer</button>
                </div>
                {subscriptionCharges.length > 0 ? (
                  <div className="space-y-2 max-h-48 overflow-y-auto pr-2">
                    {subscriptionCharges.map(c => (
                      <div key={c.id} className="flex justify-between items-center text-sm p-2 bg-indigo-50/60 dark:bg-indigo-950/30 rounded gap-2">
                        <span className="min-w-0 truncate">
                          {c.name}
                          {c.paymentMethod && <span className="ml-2 text-[11px] font-bold uppercase text-slate-500 dark:text-slate-400">{c.paymentMethod}</span>}
                        </span>
                        <span className="font-mono font-bold flex-shrink-0">{formatEUR(c.amount)}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-500 dark:text-slate-400 italic">Aucun abonnement actif.</p>
                )}
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">Seuls les abonnements mensuels (et hebdomadaires) comptent ici. Les annuels, semestriels et trimestriels ne font que déclencher un rappel avant le prélèvement.</p>
              </div>
              <div className="mt-4 pt-4 border-t flex justify-between font-black text-rose-600"><span>Total des charges</span><span>{formatEUR(budgetData.totalFixed)}</span></div>
            </div>

            <div className="lg:col-span-2 space-y-6">
              <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm grid grid-cols-2 gap-4">
                  <div><label className="text-[11px] font-black text-slate-500 dark:text-slate-400 uppercase">Argent plaisir</label><NumberInput value={leisureBudget} onChange={setLeisureBudget} min={0} className="w-full p-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg font-bold" /></div>
                  <div><label className="text-[11px] font-black text-slate-500 dark:text-slate-400 uppercase">Épargne projets</label><NumberInput value={projectSavings} onChange={setProjectSavings} min={0} className="w-full p-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg font-bold" /></div>
              </div>

              <div className="bg-slate-900 p-6 rounded-2xl shadow-lg text-white grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
                  <div>
                      <p className="text-slate-500 dark:text-slate-400 text-xs font-bold uppercase mb-2">Capacité d'Épargne Réelle</p>
                      <div className="flex items-baseline gap-2">
                          <input type="text" inputMode="decimal" value={manualSavingsCapacity !== null ? manualSavingsCapacity : String(Math.round(paydayAmount ?? budgetData.theoreticalCapacity))} onChange={(e) => setManualSavingsCapacity(e.target.value)} className="bg-transparent text-5xl font-black text-emerald-400 w-40 outline-none border-b border-slate-700 focus:border-emerald-400" />
                          <span className="text-xl">€</span>
                      </div>
                      {paydayAmount !== undefined && manualSavingsCapacity === null && (
                        <p className="text-[11px] text-slate-400 mt-1">Montant fixé dans le rappel de paie (capacité calculée : {formatEUR(budgetData.theoreticalCapacity, 0)}).</p>
                      )}
                  </div>
                  <div className="bg-slate-800 p-4 rounded-xl border border-slate-700">
                      <label className="text-[11px] font-black text-indigo-300 uppercase flex items-center gap-2"><Coins className="w-3 h-3"/> Ajout d'une somme externe</label>
                      <NumberInput value={externalSavings} onChange={setExternalSavings} className="w-full bg-slate-900 border border-slate-600 rounded-lg p-2 mt-2 text-white font-bold focus:ring-2 focus:ring-indigo-500 outline-none" />
                  </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <PayChecklist
              superNet={effectiveSuperNetForCalc}
              transfers={payTransfers}
              steps={strategy}
              totalToInvest={budgetData.totalToInvest}
              shortfall={budgetData.finalCapacity < 0 ? -budgetData.finalCapacity : 0}
              checklist={payChecklist}
              onChange={onPayChecklistChange}
              onRecordDeposit={onRecordPayDeposit}
              onCancelDeposit={onCancelPayDeposit}
              paydayDay={paydayDay}
            >
              <SavingsSplitEditor
                accounts={accounts}
                split={savingsSplit}
                from={savingsSplitFrom}
                sampleAmount={budgetData.totalToInvest}
                fiscalConfig={fiscalConfig}
                onChange={onSavingsSplitChange}
              />
               {isBackendEnabled() && (
                 <div className="mt-6 pt-4 border-t border-slate-100 dark:border-slate-700 space-y-3">
                   <p className="text-sm font-bold text-slate-700 dark:text-slate-200 flex items-center gap-2"><BellRing className="w-4 h-4 text-indigo-600" /> Rappel le jour de paie</p>
                   <div className="flex flex-wrap items-center gap-3">
                     <select
                       value={paydayDay ?? ''}
                       onChange={(e) => setPaydayDay(e.target.value ? Number(e.target.value) : undefined)}
                       className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-600 rounded-lg p-2 text-sm font-bold text-slate-700 dark:text-slate-200"
                     >
                       <option value="">Désactivé</option>
                       {Array.from({ length: 31 }, (_, i) => i + 1).map(d => <option key={d} value={d}>Le {d} du mois</option>)}
                     </select>
                     {paydayDay !== undefined && (
                       <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                         Montant
                         <input
                           type="text"
                           inputMode="decimal"
                           value={paydayAmountDraft}
                           placeholder={`${formatEUR(Math.max(0, budgetData.theoreticalCapacity), 0)} (calculé)`}
                           onChange={(e) => {
                             setPaydayAmountDraft(e.target.value);
                             const v = e.target.value.trim() === '' ? undefined : parseFrenchNumber(e.target.value);
                             if (v === undefined) setPaydayAmount(undefined);
                             else if (v !== null && v >= 0) setPaydayAmount(v);
                           }}
                           className="w-32 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-600 rounded-lg p-2 font-bold text-slate-700 dark:text-slate-200"
                         />
                         €
                       </label>
                     )}
                   </div>
                   <p className="text-xs text-slate-500 dark:text-slate-400">
                     Une notification ce jour-là avec la répartition ci-dessus, recalculée sur vos soldes du moment. Sans montant saisi, c'est la capacité d'épargne calculée qui est utilisée. Les notifications doivent être activées sur l'appareil (Paramètres).
                   </p>
                 </div>
               )}
            </PayChecklist>

            <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm space-y-6">
               <h3 className="text-lg font-black text-slate-800 dark:text-slate-100 mb-2 flex items-center gap-2"><BarChart3 className="w-5 h-5 text-indigo-600" /> Remplissage des livrets</h3>
               {bookletStats.map(b => (<div key={b.id} className="space-y-2"><div className="flex justify-between text-sm font-bold text-slate-700 dark:text-slate-200"><span>{b?.name}</span><span>{Math.round(b?.totalPct || 0)}%</span></div><div className="w-full h-3 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden flex"><div className="h-full bg-amber-400" style={{ width: `${b?.parentPct}%` }} title={`Parents : ${formatEUR(b?.parentAmount || 0)}`}></div><div className="h-full bg-indigo-600" style={{ width: `${b?.ownedPct}%` }} title={`Moi : ${formatEUR(b?.ownedAmount || 0)}`}></div></div><div className="flex justify-between text-[11px] text-slate-500 dark:text-slate-400 font-bold">{b.parentAmount > 0 && <span className="text-amber-500">Parents {formatEUR(b.parentAmount)}</span>}<span className="text-indigo-600">Moi {formatEUR(b?.ownedAmount || 0)}</span>{b.parentAmount > 0 && b.ownedAmount > 0 && <span className="text-slate-600 dark:text-slate-300">Total {formatEUR(b.parentAmount + b.ownedAmount)}</span>}<span>Max {formatEUR(b?.ceiling || 0)}</span></div>{b.monthsToFull !== null && <p className="text-[11px] text-slate-500 dark:text-slate-400">Plein dans ~{b.monthsToFull} mois au rythme actuel</p>}{b.totalPct >= 100 && <p className="text-[11px] font-bold text-emerald-600">Plein</p>}</div>))}
            </div>
          </div>

          <div className={`p-8 rounded-3xl border-2 shadow-sm text-center transition-colors ${survival.bg} ${survival.border}`}>
            <h3 className="text-sm font-black uppercase tracking-widest opacity-60 mb-4 flex justify-center items-center gap-2"><Hourglass className="w-4 h-4" /> Durée de Survie</h3>
            <div className={`text-6xl font-black ${survival.color} mb-2`}>{survival.infinite ? '∞' : <>{survival.years > 0 && <span>{survival.years}a </span>}{survival.months}m {survival.days}j</>}</div>
            <p className={`font-bold ${survival.color} opacity-80`}>{survival.infinite ? 'Aucune charge fixe renseignée' : `Avec ${formatEUR(survival.monthlyBurn)} de charges fixes / mois`}</p>
          </div>
        </>
      )}

      {activeTab === 'fiscal' && (
        <>
          {fiscalClock.length > 0 ? (
            <>
              <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm flex flex-wrap items-center gap-x-8 gap-y-2">
                <div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 uppercase font-bold">Comptes suivis</p>
                  <p className="font-black text-2xl text-slate-800 dark:text-slate-100">{fiscalClock.length}</p>
                </div>
                <div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 uppercase font-bold">Disponibles</p>
                  <p className="font-black text-2xl text-emerald-500">{fiscalClock.filter((i: any) => i.isAvailable).length}</p>
                </div>
                <div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 uppercase font-bold">Encore bloqués</p>
                  <p className="font-black text-2xl text-indigo-600">{fiscalClock.filter((i: any) => !i.isAvailable).length}</p>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {fiscalClock.map((item: any) => (<div key={item.id} className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm relative overflow-hidden"><div className={`absolute top-0 right-0 p-16 opacity-5 rounded-full -mr-8 -mt-8 ${item.isAvailable ? 'bg-emerald-500' : 'bg-indigo-500'}`}></div><div className="flex justify-between items-start mb-4"><div className={`p-3 rounded-xl ${item.isAvailable ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'}`}>{item.isAvailable ? <Unlock className="w-6 h-6" /> : <Lock className="w-6 h-6" />}</div><span className="text-[11px] font-black uppercase bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded text-slate-500 dark:text-slate-400">{item.type}</span></div><h4 className="font-bold text-slate-800 dark:text-slate-100 text-lg mb-1">{item.name}</h4><div className="border-t border-slate-100 dark:border-slate-800 pt-4 mt-4"><div className="flex justify-between items-end"><div><p className="text-[11px] text-slate-500 dark:text-slate-400 uppercase font-bold">Échéance</p><p className="font-bold text-slate-700 dark:text-slate-200">{item.date}</p></div><div className={`text-right font-black text-xl ${item.isAvailable ? 'text-emerald-500' : 'text-indigo-600'}`}>{item.timeLeft}</div></div></div></div>))}
              </div>
            </>
          ) : (
            <div className="bg-white dark:bg-slate-800 border border-dashed border-slate-200 dark:border-slate-700 rounded-2xl p-12 flex flex-col items-center justify-center text-center gap-2">
              <Hourglass className="w-8 h-8 text-slate-300 dark:text-slate-600" />
              <p className="text-slate-500 dark:text-slate-400 font-bold">Aucun compte fiscal à échéance pour l'instant.</p>
              <p className="text-slate-500 dark:text-slate-400 text-sm">Les PEA, PEE et assurances-vie avec une date d'ouverture apparaîtront ici.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
};