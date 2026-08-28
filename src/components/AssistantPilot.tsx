// src/components/AssistantPilot.tsx
import React, { useState, useMemo } from 'react';
import { SavingsAccount, Expense, AccountType, FiscalConfig, WorkBenefits, PayslipRecord } from '../types';
import { computeIncome } from '../lib/finance';
import { Calculator, TrendingUp, Target, Lock, Unlock, Info, Plus, Trash2, Hourglass, Coins, BarChart3, X, Check, FileCheck2, Wand2 } from 'lucide-react';

interface AssistantPilotProps {
  accounts: SavingsAccount[];
  expenses: Expense[];
  onUpdateExpenses: (expenses: Expense[]) => void;
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
}

export const AssistantPilot: React.FC<AssistantPilotProps> = ({
  accounts, expenses, onUpdateExpenses,
  grossAnnual, setGrossAnnual, leisureBudget, setLeisureBudget, projectSavings, setProjectSavings,
  navigoBase, setNavigoBase, navigoRate, setNavigoRate, taxRateManual, setTaxRateManual,
  extraMonthlyIncome, setExtraMonthlyIncome, fiscalConfig, workBenefits, activePayslip, onClearActivePayslip
}) => {
  const [showDetails, setShowDetails] = useState(false);
  const [externalSavings, setExternalSavings] = useState<number>(0);
  const [manualSavingsCapacity, setManualSavingsCapacity] = useState<string | null>(null); 
  const [activeTab, setActiveTab] = useState<'budget' | 'fiscal'>('budget');
  
  // UX State pour ajout dépense
  const [isAddingExpense, setIsAddingExpense] = useState(false);
  const [newExpenseName, setNewExpenseName] = useState('');
  const [newExpenseAmount, setNewExpenseAmount] = useState('');

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
  // montants EXACTS, verbatim, plutôt que de les recalculer. Le "Net Avant Impôt"
  // théorique (formule) devient le "Net à payer avant impôt" réel de la fiche — déjà net
  // de charges, Navigo et mutuelle sur une vraie fiche, donc directement comparable au
  // "Net Cash Avant Impôt" de la formule. `autoRate` est reconstruit à partir de l'impôt
  // et de l'assiette réellement prélevés, pour rester cohérent avec le libellé existant.
  const display = useMemo(() => {
    if (activePayslip) {
      const e = activePayslip.extracted;
      const effectiveSuperNetReal = e.netPaid ?? (e.netAmount !== undefined && e.incomeTaxWithheld !== undefined
        ? e.netAmount - e.incomeTaxWithheld
        : undefined);
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
        autoRate: e.netAmount && e.incomeTaxWithheld !== undefined ? (e.incomeTaxWithheld / e.netAmount) * 100 : undefined,
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
  const showEUR = (v: number | undefined) => v === undefined ? '—' : `${v.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} €`;

  // À AFFICHER : reste honnêtement indéfini ("—") en mode réel si la fiche n'a pas encore
  // été (ré)extraite avec les champs impôt/net payé — jamais de repli silencieux sur la
  // formule théorique qui se ferait passer pour un chiffre exact.
  const effectiveMonthlyTax = display.isReal ? display.effectiveMonthlyTax : autoValues.effectiveMonthlyTax;
  const effectiveSuperNet = display.isReal ? display.effectiveSuperNet : autoValues.superNet;
  // À CALCULER (capacité d'épargne, etc.) : a besoin d'un nombre pour continuer à
  // fonctionner même si la fiche active est incomplète sur ce point précis.
  const effectiveSuperNetForCalc = effectiveSuperNet ?? autoValues.superNet;

  const updateFromGrossAnnual = (val: number) => setGrossAnnual(val);
  const updateFromGrossMonth = (val: number) => setGrossAnnual(val * 12);
  const updateFromNet = (val: number) => {
    const targetGrossMonth = (val - autoValues.navigoGain - extraMonthlyIncome) / (1 - fiscalConfig.salaryChargesRate);
    setGrossAnnual(targetGrossMonth * 12);
  };

  const handleAddExpense = () => {
      if(newExpenseName && newExpenseAmount) {
          onUpdateExpenses([...expenses, {id: crypto.randomUUID(), name: newExpenseName, amount: parseFloat(newExpenseAmount)}]);
          setNewExpenseName('');
          setNewExpenseAmount('');
          setIsAddingExpense(false);
      }
  };

  const budgetData = useMemo(() => {
    const totalFixed = expenses.reduce((sum, e) => sum + e.amount, 0);
    const theoreticalCapacity = effectiveSuperNetForCalc - totalFixed - leisureBudget - projectSavings;
    const finalCapacity = manualSavingsCapacity !== null ? parseFloat(manualSavingsCapacity) : theoreticalCapacity;
    const totalToInvest = Math.max(0, finalCapacity + externalSavings);
    return { totalFixed, theoreticalCapacity, finalCapacity, totalToInvest };
  }, [effectiveSuperNetForCalc, expenses, leisureBudget, projectSavings, manualSavingsCapacity, externalSavings]);

  const strategy = useMemo(() => {
    let remainingMoney = budgetData.totalToInvest;
    const steps: any[] = [];
    const liquidTypes = [AccountType.LEP, AccountType.LIVRET_A, AccountType.LDDS];
    const userLiquidAccounts = accounts.filter(a => liquidTypes.includes(a.type));
    const userOtherAccounts = accounts.filter(a => !liquidTypes.includes(a.type) && ![AccountType.COMPTE_COURANT, AccountType.IMMOBILIER].includes(a.type));

    const sortAccounts = (a: SavingsAccount, b: SavingsAccount) => {
      const rateA = a.interestRate || 0;
      const rateB = b.interestRate || 0;
      if (rateA !== rateB) return rateB - rateA;
      const priority = { [AccountType.LEP]: 3, [AccountType.LIVRET_A]: 2, [AccountType.LDDS]: 1 };
      return (priority[b.type] || 0) - (priority[a.type] || 0);
    };

    userLiquidAccounts.sort(sortAccounts);
    userOtherAccounts.sort(sortAccounts);

    userLiquidAccounts.forEach(acc => {
      if (remainingMoney <= 0) return;
      let ceiling = acc.ceiling || 0;
      if (acc.type === AccountType.LEP) ceiling = fiscalConfig.ceilings.lep;
      if (acc.type === AccountType.LIVRET_A) ceiling = fiscalConfig.ceilings.livretA;
      if (acc.type === AccountType.LDDS) ceiling = fiscalConfig.ceilings.ldds;
      
      const availableSpace = Math.max(0, ceiling - acc.totalAmount);
      if (availableSpace > 0) {
        const amountAllocated = Math.min(remainingMoney, availableSpace);
        steps.push({ accountName: acc.name, type: acc.type, rate: acc.interestRate, fillAmount: amountAllocated, isFullAfter: amountAllocated >= availableSpace, isLiquid: true });
        remainingMoney -= amountAllocated;
      }
    });

    if (remainingMoney > 0) {
      if (userOtherAccounts.length > 0) {
        steps.push({ accountName: userOtherAccounts[0].name, type: userOtherAccounts[0].type, rate: userOtherAccounts[0].interestRate, fillAmount: remainingMoney, isFullAfter: false, isLiquid: false });
      } else {
        steps.push({ accountName: "Ouvrir un PEA/AV", type: AccountType.AUTRE, rate: 0, fillAmount: remainingMoney, isFullAfter: false, isLiquid: false, alert: true });
      }
    }
    return steps;
  }, [budgetData.totalToInvest, accounts, fiscalConfig]);

  const bookletStats = useMemo(() => {
    return [AccountType.LEP, AccountType.LIVRET_A, AccountType.LDDS].map(type => {
      const acc = accounts.find(a => a.type === type);
      if (!acc) return null;
      let ceiling = acc.ceiling;
      if (type === AccountType.LEP) ceiling = fiscalConfig.ceilings.lep;
      if (type === AccountType.LIVRET_A) ceiling = fiscalConfig.ceilings.livretA;
      if (type === AccountType.LDDS) ceiling = fiscalConfig.ceilings.ldds;
      if (!ceiling) ceiling = 10000; 
      
      const parentPct = (acc.parentalCapital / ceiling) * 100;
      const ownedPct = (acc.ownedAmount / ceiling) * 100;
      return { name: acc.name, type, ceiling, parentAmount: acc.parentalCapital, ownedAmount: acc.ownedAmount, parentPct, ownedPct, totalPct: parentPct + ownedPct, remainingSpace: ceiling - acc.totalAmount };
    }).filter(x => x !== null);
  }, [accounts, fiscalConfig]);

  const survival = useMemo(() => {
    const liquidMoney = accounts.filter(a => !a.contractEndDate && ![AccountType.IMMOBILIER, AccountType.PER, AccountType.PEE].includes(a.type)).reduce((sum, a) => sum + a.ownedAmount, 0);
    const monthlyBurn = budgetData.totalFixed; 
    
    if (monthlyBurn === 0) return { label: "Infini", color: "text-slate-500 dark:text-slate-400", bg: "bg-slate-50 dark:bg-slate-900", border: "border-slate-200 dark:border-slate-700" };
    
    const totalMonths = liquidMoney / monthlyBurn;
    const years = Math.floor(totalMonths / 12);
    const months = Math.floor(totalMonths % 12);
    const days = Math.floor((totalMonths * 30) % 30);
    
    let color = 'text-emerald-600'; let border = 'border-emerald-200'; let bg = 'bg-emerald-50';
    if (totalMonths < 3) { color = 'text-rose-600'; border = 'border-rose-200'; bg = 'bg-rose-50'; }
    else if (totalMonths < 6) { color = 'text-orange-600'; border = 'border-orange-200'; bg = 'bg-orange-50'; }
    
    return { years, months, days, color, border, bg, monthlyBurn, totalMonths };
  }, [accounts, budgetData.totalFixed]);

  const fiscalClock = useMemo(() => {
    return accounts.filter(a => [AccountType.PEE, AccountType.PEA, AccountType.ASSURANCE_VIE].includes(a.type)).map(acc => {
        let endDate: Date | null = null;
        if (acc.type === AccountType.PEE && acc.contractEndDate) endDate = new Date(acc.contractEndDate);
        else if (acc.openingDate) {
          const duration = acc.type === AccountType.PEA ? fiscalConfig.legalMaturity.pea : fiscalConfig.legalMaturity.assuranceVie;
          endDate = new Date(acc.openingDate); endDate.setFullYear(endDate.getFullYear() + duration);
        }
        if (!endDate) return null;
        
        const now = new Date(); const diffTime = endDate.getTime() - now.getTime(); const isAvailable = diffTime <= 0;
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        const years = Math.floor(diffDays / 365); const months = Math.floor((diffDays % 365) / 30);
        return { id: acc.id, name: acc.name, type: acc.type, date: endDate.toLocaleDateString(), timeLeft: isAvailable ? "Disponible" : `${years>0?years+'a ':''}${months}m`, isAvailable };
    }).filter(item => item !== null);
  }, [accounts, fiscalConfig]);

  return (
    <div className="space-y-8 animate-fade-in pb-20">
      <div className="flex gap-4 border-b border-slate-200 dark:border-slate-700">
        <button onClick={() => setActiveTab('budget')} className={`pb-2 px-4 font-bold text-sm ${activeTab === 'budget' ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-slate-400 dark:text-slate-500'}`}>Pilotage Budgétaire</button>
        <button onClick={() => setActiveTab('fiscal')} className={`pb-2 px-4 font-bold text-sm ${activeTab === 'fiscal' ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-slate-400 dark:text-slate-500'}`}>Horloge Fiscale</button>
      </div>

      {activeTab === 'budget' && (
        <>
          <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm">
            <h3 className="text-lg font-black text-slate-800 dark:text-slate-100 mb-6 flex items-center gap-2"><Calculator className="w-5 h-5 text-indigo-600" /> Revenus & Salaires</h3>

            {activePayslip && (
              <div className="mb-4 flex items-center justify-between gap-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-xl p-3">
                <div className="flex items-center gap-2 text-amber-800 dark:text-amber-300 text-xs font-bold">
                  <FileCheck2 className="w-4 h-4 flex-shrink-0" />
                  Chiffres exacts de ta fiche de {activePayslip.extracted.period || 'paie'} ({activePayslip.extracted.employer || activePayslip.fileName}) — pas de calcul, valeurs verbatim.
                </div>
                <button onClick={onClearActivePayslip} className="flex items-center gap-1 text-xs font-bold text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900 px-3 py-1.5 rounded-lg flex-shrink-0"><Wand2 className="w-3.5 h-3.5" /> Repasser en estimation</button>
              </div>
            )}

            {activePayslip && display.effectiveMonthlyTax === undefined && (
              <div className="mb-4 text-xs text-rose-600 dark:text-rose-400 font-bold flex items-center gap-2">
                <Info className="w-3.5 h-3.5 flex-shrink-0" />
                Cette fiche n'a pas encore l'impôt réellement prélevé / le net payé (extraite avant l'ajout de ces champs) : "Net Réel Perçu" affiche "—" plutôt qu'une estimation. Réimporte-la depuis Drive pour compléter.
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
              <div className="bg-slate-50 dark:bg-slate-900 p-3 rounded-xl border border-slate-200 dark:border-slate-700"><label className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase">Brut Annuel</label><input type="number" value={Math.round(grossAnnual)} onChange={e => updateFromGrossAnnual(parseFloat(e.target.value)||0)} className="w-full bg-transparent font-black text-slate-800 dark:text-slate-100 text-lg outline-none" /></div>
              <div className="bg-slate-50 dark:bg-slate-900 p-3 rounded-xl border border-slate-200 dark:border-slate-700">
                <label className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase">Brut Mensuel</label>
                {activePayslip
                  ? <p className="font-black text-slate-800 dark:text-slate-100 text-lg">{showEUR(display.grossMonth)}</p>
                  : <input type="number" value={Math.round(autoValues.grossMonth)} onChange={e => updateFromGrossMonth(parseFloat(e.target.value)||0)} className="w-full bg-transparent font-black text-slate-800 dark:text-slate-100 text-lg outline-none" />}
              </div>
              <div className="bg-indigo-50 dark:bg-indigo-950/40 p-3 rounded-xl border border-indigo-100 dark:border-indigo-900">
                <label className="text-[10px] font-black text-indigo-400 dark:text-indigo-400 uppercase">Net Avant Impôt</label>
                {activePayslip
                  ? <p className="font-black text-indigo-700 dark:text-indigo-300 text-lg">{showEUR(display.netBeforeTax)}</p>
                  : <input type="number" value={Math.round(autoValues.netBeforeTax * 100)/100} onChange={e => updateFromNet(parseFloat(e.target.value)||0)} className="w-full bg-transparent font-black text-indigo-700 dark:text-indigo-300 text-lg outline-none" />}
              </div>
              <div className="bg-emerald-50 dark:bg-emerald-950/40 p-3 rounded-xl border border-emerald-100 dark:border-emerald-900 relative">
                <label className="text-[10px] font-black text-emerald-600 dark:text-emerald-400 uppercase flex items-center gap-1">{activePayslip ? 'Net Réel Perçu' : 'Super Net (Poche)'} <Info className="w-3 h-3 cursor-pointer" onClick={() => setShowDetails(!showDetails)}/></label>
                <p className="font-black text-emerald-700 dark:text-emerald-300 text-2xl">{showEUR(effectiveSuperNet)}</p>
              </div>
            </div>

            {showDetails && (
              <div className="bg-white dark:bg-slate-800 p-4 rounded-xl text-xs space-y-3 border border-slate-200 dark:border-slate-700 animate-in slide-in-from-top-2 shadow-inner mb-4">
                 <div className="flex justify-between font-bold border-b pb-1"><span>Salaire Brut Mensuel</span> <span>{showEUR(display.grossMonth)}</span></div>
                 <div className="flex justify-between text-rose-500"><span>Charges Salariales{!activePayslip && ` (${(fiscalConfig.salaryChargesRate*100).toFixed(2)}%)`}</span> <span>- {showEUR(display.socialCharges)}</span></div>
                 <div className="flex justify-between text-emerald-600"><span>Remboursement Navigo</span> <span>+ {showEUR(display.navigoGain)}</span></div>
                 {(activePayslip ? display.mutuelleCost !== undefined : workBenefits.mutuelle.active) && <div className="flex justify-between text-rose-500"><span>Mutuelle (Part Salarié)</span><span>- {showEUR(display.mutuelleCost)}</span></div>}
                 {(activePayslip ? display.swileCost !== undefined : workBenefits.mealVouchers.active) && <div className="flex justify-between text-rose-500"><span>Titres Resto (Part Salarié)</span><span>- {showEUR(display.swileCost)}</span></div>}
                 <div className="flex justify-between font-bold text-indigo-700 pt-1 border-t border-slate-100 dark:border-slate-800"><span>= Net Cash Avant Impôt</span> <span>{showEUR(display.superNetRaw)}</span></div>
                 <div className="bg-amber-50 p-2 rounded-lg border border-amber-100">
                    <div className="flex justify-between items-center mb-2"><span className="text-amber-800 font-bold">{activePayslip ? 'Impôt réellement prélevé' : 'Impôt à la source'}</span><span className="text-amber-600 font-mono font-black">- {showEUR(display.effectiveMonthlyTax)}</span></div>
                    {activePayslip ? (
                      <p className="text-[10px] text-slate-500 dark:text-slate-400">Taux réel constaté : <strong>{display.autoRate !== undefined ? `${display.autoRate.toFixed(1)}%` : '—'}</strong> (montant tel que retenu sur la fiche, pas une estimation)</p>
                    ) : (
                    <div className="flex items-center justify-between text-[10px] gap-2">
                        <div className="flex flex-col"><span className="text-slate-500 dark:text-slate-400">Taux Barème (Auto) : <strong>{autoValues.autoRate.toFixed(1)}%</strong></span>{taxRateManual > 0 && <span className="text-amber-600">Force à : <strong>{taxRateManual}%</strong></span>}</div>
                        <div className="flex items-center gap-1"><label className="text-slate-400 dark:text-slate-500">Forcer taux :</label><input type="number" step="0.1" value={taxRateManual} onChange={(e) => setTaxRateManual(parseFloat(e.target.value) || 0)} className="w-12 p-1 text-right bg-white dark:bg-slate-800 border border-amber-200 rounded font-bold outline-none" placeholder="Auto"/><span className="text-slate-400 dark:text-slate-500">%</span></div>
                    </div>
                    )}
                 </div>
                 {activePayslip && <div className="flex justify-between font-bold text-emerald-700 pt-1 border-t border-slate-100 dark:border-slate-800"><span>= Net Réel Perçu</span> <span>{showEUR(effectiveSuperNet)}</span></div>}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-1 bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm">
              <div className="flex justify-between items-center mb-4">
                  <h4 className="font-bold text-slate-700 dark:text-slate-200 flex items-center gap-2"><TrendingUp className="w-4 h-4 text-rose-500"/> Charges Fixes</h4>
                  <button onClick={() => setIsAddingExpense(true)} aria-label="Ajouter une charge fixe" className="p-2 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 rounded hover:bg-slate-200 dark:hover:bg-slate-600"><Plus className="w-4 h-4"/></button>
              </div>
              
              {/* Formulaire Ajout Rapide */}
              {isAddingExpense && (
                  <div className="bg-indigo-50 p-2 rounded-lg mb-2 flex flex-col gap-2">
                      <input type="text" placeholder="Nom..." className="p-1 rounded text-xs border border-indigo-100" value={newExpenseName} onChange={e => setNewExpenseName(e.target.value)} autoFocus />
                      <div className="flex gap-1">
                          <input type="number" placeholder="€..." className="p-1 rounded text-xs border border-indigo-100 w-20" value={newExpenseAmount} onChange={e => setNewExpenseAmount(e.target.value)} />
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
                            {e.paymentMethod && <span className="ml-2 text-[10px] font-bold uppercase text-slate-400 dark:text-slate-500">{e.paymentMethod}</span>}
                          </span>
                          <div className="flex items-center gap-1 flex-shrink-0">
                              <span className="font-mono font-bold">{e.amount}€</span>
                              {/* Visible en permanence sur tactile (pas de hover sur mobile : sans le
                                  préfixe `md:`, l'icône restait invisible et la dépense indélétable). */}
                              <button
                                type="button"
                                aria-label={`Supprimer la charge ${e.name}`}
                                onClick={() => onUpdateExpenses(expenses.filter(x => x.id !== e.id))}
                                className="p-2 -m-1 text-slate-400 hover:text-rose-500 opacity-100 md:opacity-0 md:group-hover:opacity-100 focus:opacity-100 transition-opacity"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                          </div>
                      </div>
                  ))}
              </div>
              <div className="mt-4 pt-4 border-t flex justify-between font-black text-rose-600"><span>TOTAL CHARGES</span><span>{Math.round(budgetData.totalFixed)} €</span></div>
            </div>

            <div className="lg:col-span-2 space-y-6">
              <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm grid grid-cols-2 gap-4">
                  <div><label className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase">Argent Plaisir</label><input type="number" value={leisureBudget} onChange={e => setLeisureBudget(parseFloat(e.target.value)||0)} className="w-full p-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg font-bold" /></div>
                  <div><label className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase">Épargne Projets</label><input type="number" value={projectSavings} onChange={e => setProjectSavings(parseFloat(e.target.value)||0)} className="w-full p-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg font-bold" /></div>
              </div>

              <div className="bg-slate-900 p-6 rounded-2xl shadow-lg text-white grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
                  <div>
                      <p className="text-slate-400 dark:text-slate-500 text-xs font-bold uppercase mb-2">Capacité d'Épargne Réelle</p>
                      <div className="flex items-baseline gap-2">
                          <input type="number" value={manualSavingsCapacity !== null ? manualSavingsCapacity : Math.round(budgetData.theoreticalCapacity)} onChange={(e) => setManualSavingsCapacity(e.target.value)} className="bg-transparent text-5xl font-black text-emerald-400 w-40 outline-none border-b border-slate-700 focus:border-emerald-400" />
                          <span className="text-xl">€</span>
                      </div>
                  </div>
                  <div className="bg-slate-800 p-4 rounded-xl border border-slate-700">
                      <label className="text-[10px] font-black text-indigo-300 uppercase flex items-center gap-2"><Coins className="w-3 h-3"/> Ajout Somme Externe</label>
                      <input type="number" value={externalSavings} onChange={e => setExternalSavings(parseFloat(e.target.value)||0)} className="w-full bg-slate-900 border border-slate-600 rounded-lg p-2 mt-2 text-white font-bold focus:ring-2 focus:ring-indigo-500 outline-none" />
                  </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm">
               <h3 className="text-lg font-black text-slate-800 dark:text-slate-100 mb-6 flex items-center gap-2"><Target className="w-5 h-5 text-indigo-600" /> Placement ({Math.round(budgetData.totalToInvest)} €)</h3>
               <div className="space-y-3">{strategy.length > 0 ? strategy.map((step, idx) => (<div key={idx} className="flex items-center justify-between p-4 rounded-xl border-l-4 bg-indigo-50 border-indigo-600"><div className="flex items-center gap-4"><div className="w-6 h-6 rounded-full flex center items-center justify-center bg-indigo-600 text-white font-bold text-xs">{idx + 1}</div><div><p className="font-bold text-slate-800 dark:text-slate-100">{step.accountName}</p><p className="text-xs text-slate-500 dark:text-slate-400">{step.type} • Taux {step.rate}%</p></div></div><p className="text-xl font-black text-indigo-600">+ {Math.round(step.fillAmount)} €</p></div>)) : <p className="text-sm text-slate-400 dark:text-slate-500 italic">Rien à placer.</p>}</div>
            </div>

            <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm space-y-6">
               <h3 className="text-lg font-black text-slate-800 dark:text-slate-100 mb-2 flex items-center gap-2"><BarChart3 className="w-5 h-5 text-indigo-600" /> Remplissage Livrets</h3>
               {bookletStats.map((b, i) => (<div key={i} className="space-y-2"><div className="flex justify-between text-sm font-bold text-slate-700 dark:text-slate-200"><span>{b?.name}</span><span>{Math.round(b?.totalPct || 0)}%</span></div><div className="w-full h-3 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden flex"><div className="h-full bg-amber-400" style={{ width: `${b?.parentPct}%` }} title={`Parents: ${b?.parentAmount}€`}></div><div className="h-full bg-indigo-600" style={{ width: `${b?.ownedPct}%` }} title={`Moi: ${b?.ownedAmount}€`}></div></div><div className="flex justify-between text-[10px] text-slate-400 dark:text-slate-500 font-bold"><span className="text-amber-500">Parents {b?.parentAmount}€</span><span className="text-indigo-600">Moi {b?.ownedAmount}€</span><span>Max {b?.ceiling}€</span></div></div>))}
            </div>
          </div>

          <div className={`p-8 rounded-3xl border-2 shadow-sm text-center transition-colors ${survival.bg} ${survival.border}`}>
            <h3 className="text-sm font-black uppercase tracking-widest opacity-60 mb-4 flex justify-center items-center gap-2"><Hourglass className="w-4 h-4" /> Durée de Survie</h3>
            <div className={`text-6xl font-black ${survival.color} mb-2`}>{survival.years > 0 && <span>{survival.years}a </span>}{survival.months}m {survival.days}j</div>
            <p className={`font-bold ${survival.color} opacity-80`}>Avec {survival.monthlyBurn}€ de charges fixes / mois</p>
          </div>
        </>
      )}

      {activeTab === 'fiscal' && (
        <>
          {fiscalClock.length > 0 ? (
            <>
              <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm flex flex-wrap items-center gap-x-8 gap-y-2">
                <div>
                  <p className="text-[10px] text-slate-400 dark:text-slate-500 uppercase font-bold">Comptes suivis</p>
                  <p className="font-black text-2xl text-slate-800 dark:text-slate-100">{fiscalClock.length}</p>
                </div>
                <div>
                  <p className="text-[10px] text-slate-400 dark:text-slate-500 uppercase font-bold">Disponibles</p>
                  <p className="font-black text-2xl text-emerald-500">{fiscalClock.filter((i: any) => i.isAvailable).length}</p>
                </div>
                <div>
                  <p className="text-[10px] text-slate-400 dark:text-slate-500 uppercase font-bold">Encore bloqués</p>
                  <p className="font-black text-2xl text-indigo-600">{fiscalClock.filter((i: any) => !i.isAvailable).length}</p>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {fiscalClock.map((item: any) => (<div key={item.id} className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm relative overflow-hidden"><div className={`absolute top-0 right-0 p-16 opacity-5 rounded-full -mr-8 -mt-8 ${item.isAvailable ? 'bg-emerald-500' : 'bg-indigo-500'}`}></div><div className="flex justify-between items-start mb-4"><div className={`p-3 rounded-xl ${item.isAvailable ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'}`}>{item.isAvailable ? <Unlock className="w-6 h-6" /> : <Lock className="w-6 h-6" />}</div><span className="text-[10px] font-black uppercase bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded text-slate-500 dark:text-slate-400">{item.type}</span></div><h4 className="font-bold text-slate-800 dark:text-slate-100 text-lg mb-1">{item.name}</h4><div className="border-t border-slate-100 dark:border-slate-800 pt-4 mt-4"><div className="flex justify-between items-end"><div><p className="text-[10px] text-slate-400 dark:text-slate-500 uppercase font-bold">Échéance</p><p className="font-bold text-slate-700 dark:text-slate-200">{item.date}</p></div><div className={`text-right font-black text-xl ${item.isAvailable ? 'text-emerald-500' : 'text-indigo-600'}`}>{item.timeLeft}</div></div></div></div>))}
              </div>
            </>
          ) : (
            <div className="bg-white dark:bg-slate-800 border border-dashed border-slate-200 dark:border-slate-700 rounded-2xl p-12 flex flex-col items-center justify-center text-center gap-2">
              <Hourglass className="w-8 h-8 text-slate-300 dark:text-slate-600" />
              <p className="text-slate-400 dark:text-slate-500 font-bold">Aucun compte fiscal à échéance pour l'instant.</p>
              <p className="text-slate-400 dark:text-slate-500 text-sm">Les PEA, PEE et assurances-vie avec une date d'ouverture apparaîtront ici.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
};