import React, { useState, useMemo } from 'react';
import { SavingsAccount, Expense, AccountType } from '../types';
import { TAX_BRACKETS, STANDARD_ALLOWANCE, SALARY_CHARGES_RATE, ACCOUNT_CEILINGS, LEGAL_MATURITY } from '../constants';
import { 
  Calculator, 
  TrendingUp, 
  ShieldCheck, 
  Target, 
  Clock, 
  Lock, 
  Unlock, 
  Info,
  Plus,
  Trash2,
  AlertTriangle,
  Hourglass,
  Coins
} from 'lucide-react';
import { Button } from './Button';

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
  navigoBase: number; // 90.80
  setNavigoBase: (val: number) => void;
  navigoRate: number; // 67.24 (correspond à ~61.05€)
  setNavigoRate: (val: number) => void;
  taxRateManual: number;
  setTaxRateManual: (val: number) => void;
  extraMonthlyIncome: number;
  setExtraMonthlyIncome: (val: number) => void;
}

export const AssistantPilot: React.FC<AssistantPilotProps> = ({
  accounts,
  expenses,
  onUpdateExpenses,
  grossAnnual,
  setGrossAnnual,
  leisureBudget,
  setLeisureBudget,
  projectSavings,
  setProjectSavings,
  navigoBase,
  setNavigoBase,
  navigoRate,
  setNavigoRate,
  taxRateManual,
  setTaxRateManual,
  extraMonthlyIncome,
  setExtraMonthlyIncome
}) => {
  
  // --- ÉTATS LOCAUX ---
  const [showDetails, setShowDetails] = useState(false);
  const [externalSavings, setExternalSavings] = useState<number>(0);
  const [manualSavingsCapacity, setManualSavingsCapacity] = useState<string | null>(null); 
  const [activeTab, setActiveTab] = useState<'budget' | 'fiscal'>('budget');

  // Remboursement Navigo (Gain) = 90.80 * 67.24% = ~61.05 €
  const navigoRefund = (navigoBase * (navigoRate / 100)); 

  // --- 1. MOTEUR DE CALCUL REVENUS ---
  const autoValues = useMemo(() => {
    // A. Salaire
    const grossMonth = grossAnnual / 12; // 3360
    const socialCharges = grossMonth * SALARY_CHARGES_RATE; // ~750
    const netSalaryOnly = grossMonth - socialCharges; // ~2610
    
    // B. Revenu Net Avant Impôt (C'est ce qui arrive sur le compte)
    // = Salaire Net + Remboursement Navigo + Revenus Annexes
    const netBeforeTax = netSalaryOnly + navigoRefund + extraMonthlyIncome; // ~2671
    
    // C. Fiscalité (Basée sur le Net Imposable Annuel)
    // Note : Le remboursement Navigo est souvent non-imposable, mais simplifions ici.
    // Assiette impôt = Brut - Abattement 10% + Extras
    const netTaxableYear = (grossAnnual * (1 - STANDARD_ALLOWANCE)) + (extraMonthlyIncome * 12);
    const quotient = netTaxableYear;
    
    // Calcul Impôt Progressif
    let taxAmount = 0;
    let previousLimit = 0;
    for (const bracket of TAX_BRACKETS) {
      if (quotient > previousLimit) {
        const taxable = Math.min(quotient, bracket.limit) - previousLimit;
        taxAmount += taxable * bracket.rate;
        previousLimit = bracket.limit;
      }
    }
    const monthlyTax = taxAmount / 12;
    const autoRate = (taxAmount / netTaxableYear) * 100;

    return { 
      grossMonth, 
      socialCharges,
      netSalaryOnly,
      netBeforeTax, 
      taxAmount, 
      monthlyTax, 
      autoRate, 
      netTaxableYear 
    };
  }, [grossAnnual, extraMonthlyIncome, navigoRefund]);

  // D. Application du Taux Manuel (si défini) ou Auto
  // Si tu indiques 6.1% manuel, on applique 6.1% sur le Net Imposable théorique mensuel
  const effectiveTaxRate = taxRateManual > 0 ? taxRateManual : autoValues.autoRate;
  
  // L'impôt mensuel réel prélevé
  const effectiveMonthlyTax = taxRateManual > 0 
    ? (autoValues.netBeforeTax * (taxRateManual/100)) // Simplification : Taux appliqué au Net perçu souvent
    : autoValues.monthlyTax;

  // E. Super Net (Ce qu'il reste vraiment dans la poche)
  const effectiveSuperNet = autoValues.netBeforeTax - effectiveMonthlyTax;

  // Handlers
  const updateFromGrossAnnual = (val: number) => setGrossAnnual(val);
  const updateFromGrossMonth = (val: number) => setGrossAnnual(val * 12);
  const updateFromNet = (val: number) => {
    // Inverse : NetAvantImpot -> Brut
    // Val = (BrutMois * (1 - Charges)) + Refund + Extra
    // BrutMois = (Val - Refund - Extra) / (1 - Charges)
    const targetGrossMonth = (val - navigoRefund - extraMonthlyIncome) / (1 - SALARY_CHARGES_RATE);
    setGrossAnnual(targetGrossMonth * 12);
  };
  const updateFromSuperNet = (val: number) => {
    const estimatedNet = val + effectiveMonthlyTax;
    updateFromNet(estimatedNet);
  };


  // --- 2. CAPACITÉ D'ÉPARGNE ---
  const budgetData = useMemo(() => {
    const totalFixed = expenses.reduce((sum, e) => sum + e.amount, 0);
    
    // NOTE : On ne compte PAS le coût du Navigo ici automatiquement, comme demandé.
    // L'utilisateur doit l'ajouter manuellement dans ses charges fixes s'il le souhaite.
    
    const theoreticalCapacity = effectiveSuperNet - totalFixed - leisureBudget - projectSavings;
    
    const finalCapacity = manualSavingsCapacity !== null ? parseFloat(manualSavingsCapacity) : theoreticalCapacity;
    const totalToInvest = Math.max(0, finalCapacity + externalSavings);

    return { totalFixed, theoreticalCapacity, finalCapacity, totalToInvest };
  }, [effectiveSuperNet, expenses, leisureBudget, projectSavings, manualSavingsCapacity, externalSavings]);


  // --- 3. ALGORITHME DE CASCADE ---
  const strategy = useMemo(() => {
    const steps: any[] = [];
    let remaining = budgetData.totalToInvest;
    const getOwned = (t: AccountType) => accounts.find(a => a.type === t)?.ownedAmount || 0;

    // A. LEP (Si revenu fiscal < seuil)
    if (autoValues.netTaxableYear < 22000) {
      const current = getOwned(AccountType.LEP);
      const max = ACCOUNT_CEILINGS.LEP;
      const space = Math.max(0, max - current);
      const fill = Math.min(remaining, space);
      steps.push({ name: "LEP (Prioritaire)", current, max, space, fill, type: AccountType.LEP });
      if (space > 0) remaining -= fill;
    }

    // B. Livret A
    const laCurrent = getOwned(AccountType.LIVRET_A);
    const laMax = ACCOUNT_CEILINGS.LIVRET_A;
    const laSpace = Math.max(0, laMax - laCurrent);
    const laFill = Math.min(remaining, laSpace);
    steps.push({ name: "Livret A (Sécurité)", current: laCurrent, max: laMax, space: laSpace, fill: laFill, type: AccountType.LIVRET_A });
    if (laSpace > 0) remaining -= laFill;

    // C. LDDS
    const lddsCurrent = getOwned(AccountType.LDDS);
    const lddsMax = ACCOUNT_CEILINGS.LDDS;
    const lddsSpace = Math.max(0, lddsMax - lddsCurrent);
    const lddsFill = Math.min(remaining, lddsSpace);
    steps.push({ name: "LDDS (Complément)", current: lddsCurrent, max: lddsMax, space: lddsSpace, fill: lddsFill, type: AccountType.LDDS });
    if (lddsSpace > 0) remaining -= lddsFill;

    // D. Surplus
    if (remaining > 0) {
      steps.push({ name: "PEA / Assurance Vie", current: getOwned(AccountType.PEA) + getOwned(AccountType.ASSURANCE_VIE), max: Infinity, space: Infinity, fill: remaining, type: AccountType.PEA, isBonus: true });
    }

    return steps;
  }, [budgetData.totalToInvest, accounts, autoValues.netTaxableYear]);


  // --- 4. RÉSILIENCE ---
  const survival = useMemo(() => {
    const liquidMoney = accounts
      .filter(a => !a.contractEndDate && ![AccountType.IMMOBILIER, AccountType.PER, AccountType.PEE].includes(a.type))
      .reduce((sum, a) => sum + a.ownedAmount, 0);
    
    // Pour la survie, on suppose qu'il faut payer les charges fixes déclarées
    // Si l'utilisateur n'a pas mis le Navigo dans les charges, on ne le compte pas ici non plus (cohérence)
    const monthlyBurn = budgetData.totalFixed + leisureBudget; 
    
    if (monthlyBurn === 0) return { days: 0, color: 'text-slate-500', label: "Infini", totalMonths: 999 };

    const totalDays = (liquidMoney / monthlyBurn) * 30;
    const years = Math.floor(totalDays / 365);
    const months = Math.floor((totalDays % 365) / 30);
    const days = Math.floor(totalDays % 30);
    const totalMonths = liquidMoney / monthlyBurn;

    let color = 'text-emerald-500';
    let borderColor = 'border-emerald-500';
    let bg = 'bg-emerald-50';

    if (totalMonths < 3) { color = 'text-rose-500'; borderColor = 'border-rose-500'; bg = 'bg-rose-50'; }
    else if (totalMonths < 6) { color = 'text-orange-500'; borderColor = 'border-orange-500'; bg = 'bg-orange-50'; }
    else if (totalMonths >= 12) { color = 'text-amber-500'; borderColor = 'border-amber-500'; bg = 'bg-amber-50'; } // Doré

    return { years, months, days, color, borderColor, bg, totalMonths, monthlyBurn };
  }, [accounts, budgetData.totalFixed, leisureBudget]);


  // --- 5. HORLOGE FISCALE ---
  const fiscalClock = useMemo(() => {
    return accounts
      .filter(a => [AccountType.PEE, AccountType.PEA, AccountType.ASSURANCE_VIE].includes(a.type))
      .map(acc => {
        let endDate: Date | null = null;
        let label = "";

        if (acc.type === AccountType.PEE && acc.contractEndDate) {
          endDate = new Date(acc.contractEndDate);
          label = "Fin Contrat";
        } else if (acc.openingDate) {
          const duration = acc.type === AccountType.PEA ? LEGAL_MATURITY.PEA : LEGAL_MATURITY.ASSURANCE_VIE;
          endDate = new Date(acc.openingDate);
          endDate.setFullYear(endDate.getFullYear() + duration);
          label = `Maturité fiscale (${duration} ans)`;
        }

        if (!endDate) return null;

        const now = new Date();
        const diffTime = endDate.getTime() - now.getTime();
        const isAvailable = diffTime <= 0;
        
        let timeLeft = "Disponible";
        if (!isAvailable) {
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            const years = Math.floor(diffDays / 365);
            const months = Math.floor((diffDays % 365) / 30);
            timeLeft = `${years > 0 ? years + ' ans ' : ''}${months} mois`;
        }

        return { id: acc.id, name: acc.name, type: acc.type, date: endDate.toLocaleDateString(), timeLeft, isAvailable, label };
      })
      .filter(item => item !== null);
  }, [accounts]);


  // --- RENDU UI ---
  return (
    <div className="space-y-8 animate-fade-in pb-20">
      
      {/* ONGLETS NAVIGATION */}
      <div className="flex gap-4 border-b border-slate-200">
        <button onClick={() => setActiveTab('budget')} className={`pb-2 px-4 font-bold text-sm ${activeTab === 'budget' ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-slate-400'}`}>
          Pilotage Budgétaire
        </button>
        <button onClick={() => setActiveTab('fiscal')} className={`pb-2 px-4 font-bold text-sm ${activeTab === 'fiscal' ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-slate-400'}`}>
          Horloge Fiscale
        </button>
      </div>

      {activeTab === 'budget' && (
        <>
          {/* SECTION 1 : CALCULATEUR DE REVENUS 4-SENS */}
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
            <h3 className="text-lg font-black text-slate-800 mb-6 flex items-center gap-2">
              <Calculator className="w-5 h-5 text-indigo-600" /> Revenus & Salaires
            </h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                <label className="text-[10px] font-black text-slate-400 uppercase">Brut Annuel</label>
                <input type="number" value={Math.round(grossAnnual)} onChange={e => updateFromGrossAnnual(parseFloat(e.target.value)||0)} className="w-full bg-transparent font-black text-slate-800 text-lg outline-none" />
              </div>
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                <label className="text-[10px] font-black text-slate-400 uppercase">Brut Mensuel</label>
                <input type="number" value={Math.round(autoValues.grossMonth)} onChange={e => updateFromGrossMonth(parseFloat(e.target.value)||0)} className="w-full bg-transparent font-black text-slate-800 text-lg outline-none" />
              </div>
              <div className="bg-indigo-50 p-3 rounded-xl border border-indigo-100">
                <label className="text-[10px] font-black text-indigo-400 uppercase">Net Avant Impôt</label>
                <input type="number" value={Math.round(autoValues.netBeforeTax * 100)/100} onChange={e => updateFromNet(parseFloat(e.target.value)||0)} className="w-full bg-transparent font-black text-indigo-700 text-lg outline-none" />
              </div>
              <div className="bg-emerald-50 p-3 rounded-xl border border-emerald-100 relative">
                <label className="text-[10px] font-black text-emerald-600 uppercase flex items-center gap-1">Super Net (Poche) <Info className="w-3 h-3 cursor-pointer" onClick={() => setShowDetails(!showDetails)}/></label>
                <input type="number" value={Math.round(effectiveSuperNet * 100)/100} onChange={e => updateFromSuperNet(parseFloat(e.target.value)||0)} className="w-full bg-transparent font-black text-emerald-700 text-2xl outline-none" />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-4 text-sm text-slate-500 mb-4 bg-slate-50 p-3 rounded-lg">
              <div className="flex items-center gap-2">
                <span>Taux Impôt :</span>
                {taxRateManual > 0 ? (
                  <span className="font-bold text-amber-600">{taxRateManual}% (Manuel)</span>
                ) : (
                  <span className="font-bold text-slate-700">{autoValues.autoRate.toFixed(1)}% (Auto)</span>
                )}
              </div>
              <input 
                type="range" min="0" max="20" step="0.1" 
                value={taxRateManual > 0 ? taxRateManual : autoValues.autoRate} 
                onChange={e => setTaxRateManual(parseFloat(e.target.value))}
                className="w-32 h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer"
              />
              <button onClick={() => setTaxRateManual(0)} className="text-xs text-indigo-600 underline">Reset Auto</button>
            </div>

            {showDetails && (
              <div className="bg-white p-4 rounded-xl text-xs space-y-2 border border-slate-200 animate-in slide-in-from-top-2 shadow-inner">
                <p className="font-bold text-slate-700 border-b pb-1">Détail du calcul (Mensuel) :</p>
                <div className="flex justify-between"><span>Salaire Brut</span> <span>{Math.round(autoValues.grossMonth)} €</span></div>
                <div className="flex justify-between text-rose-500">
                  <span>Charges Sociales (~{(SALARY_CHARGES_RATE*100).toFixed(1)}%)</span> 
                  <span>- {Math.round(autoValues.socialCharges)} €</span>
                </div>
                <div className="flex justify-between font-bold text-slate-600 border-t border-slate-100 pt-1">
                  <span>= Salaire Net</span> 
                  <span>{Math.round(autoValues.netSalaryOnly)} €</span>
                </div>
                <div className="flex justify-between text-emerald-600">
                  <span>Remboursement Navigo (~67% de {navigoBase}€)</span> 
                  <span>+ {navigoRefund.toFixed(2)} €</span>
                </div>
                <div className="flex justify-between text-emerald-600">
                  <span>Revenus Annexes</span> 
                  <span>+ {extraMonthlyIncome} €</span>
                </div>
                <div className="flex justify-between font-bold border-t border-slate-200 pt-1 text-indigo-700">
                  <span>= Net Avant Impôt (Perçu)</span> 
                  <span>{autoValues.netBeforeTax.toFixed(2)} €</span>
                </div>
                <div className="flex justify-between text-amber-600">
                  <span>Impôt Source ({effectiveTaxRate.toFixed(1)}%)</span> 
                  <span>- {effectiveMonthlyTax.toFixed(2)} €</span>
                </div>
                <div className="flex justify-between font-black text-emerald-700 bg-emerald-50 p-1 rounded mt-1">
                  <span>= Super Net</span> 
                  <span>{effectiveSuperNet.toFixed(2)} €</span>
                </div>
              </div>
            )}
          </div>

          {/* SECTION 2 : CHARGES & CAPACITÉ D'ÉPARGNE */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            
            <div className="lg:col-span-1 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
              <div className="flex justify-between items-center mb-4">
                <h4 className="font-bold text-slate-700 flex items-center gap-2"><TrendingUp className="w-4 h-4 text-rose-500"/> Charges Fixes</h4>
                <button onClick={() => {
                  const n = prompt("Nom ?"); const a = prompt("Montant ?");
                  if(n && a) onUpdateExpenses([...expenses, {id: crypto.randomUUID(), name: n, amount: parseFloat(a)}]);
                }} className="p-1 bg-slate-100 rounded hover:bg-slate-200"><Plus className="w-4 h-4"/></button>
              </div>
              <div className="space-y-2 max-h-60 overflow-y-auto pr-2">
                {expenses.map(e => (
                  <div key={e.id} className="flex justify-between text-sm p-2 bg-slate-50 rounded group">
                    <span>{e.name}</span>
                    <div className="flex gap-2">
                      <span className="font-mono font-bold">{e.amount}€</span>
                      <Trash2 className="w-4 h-4 text-slate-300 hover:text-rose-500 cursor-pointer opacity-0 group-hover:opacity-100" onClick={() => onUpdateExpenses(expenses.filter(x => x.id !== e.id))} />
                    </div>
                  </div>
                ))}
                {expenses.length === 0 && <p className="text-slate-400 text-xs italic">Ajoutez vos charges fixes manuellement (Loyer, Elec, etc.)</p>}
              </div>
              <div className="mt-4 pt-4 border-t flex justify-between font-black text-rose-600">
                <span>TOTAL CHARGES</span>
                <span>{Math.round(budgetData.totalFixed)} €</span>
              </div>
            </div>

            <div className="lg:col-span-2 space-y-6">
              <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm grid grid-cols-2 gap-4">
                 <div>
                   <label className="text-[10px] font-black text-slate-400 uppercase">Argent Plaisir / Poche</label>
                   <input type="number" value={leisureBudget} onChange={e => setLeisureBudget(parseFloat(e.target.value)||0)} className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg font-bold" />
                 </div>
                 <div>
                   <label className="text-[10px] font-black text-slate-400 uppercase">Épargne Projets / Loisirs</label>
                   <input type="number" value={projectSavings} onChange={e => setProjectSavings(parseFloat(e.target.value)||0)} className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg font-bold" />
                 </div>
              </div>

              <div className="bg-slate-900 p-6 rounded-2xl shadow-lg text-white grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
                 <div>
                   <p className="text-slate-400 text-xs font-bold uppercase mb-2">Capacité d'Épargne Réelle</p>
                   <div className="flex items-baseline gap-2">
                     <input 
                        type="number" 
                        value={manualSavingsCapacity !== null ? manualSavingsCapacity : Math.round(budgetData.theoreticalCapacity)} 
                        onChange={(e) => setManualSavingsCapacity(e.target.value)}
                        className="bg-transparent text-5xl font-black text-emerald-400 w-40 outline-none border-b border-slate-700 focus:border-emerald-400"
                      />
                      <span className="text-xl">€</span>
                   </div>
                   {manualSavingsCapacity !== null && (
                     <button onClick={() => setManualSavingsCapacity(null)} className="text-[10px] text-indigo-400 underline mt-1">
                       Rétablir calcul auto ({Math.round(budgetData.theoreticalCapacity)}€)
                     </button>
                   )}
                 </div>
                 
                 <div className="bg-slate-800 p-4 rounded-xl border border-slate-700">
                   <label className="text-[10px] font-black text-indigo-300 uppercase flex items-center gap-2"><Coins className="w-3 h-3"/> Ajout Somme Externe</label>
                   <input 
                      type="number" 
                      value={externalSavings} 
                      onChange={e => setExternalSavings(parseFloat(e.target.value)||0)}
                      className="w-full bg-slate-900 border border-slate-600 rounded-lg p-2 mt-2 text-white font-bold focus:ring-2 focus:ring-indigo-500 outline-none"
                      placeholder="Ex: Prime, Cadeau..."
                   />
                 </div>
              </div>
            </div>
          </div>

          {/* SECTION 3 : CASCADE D'INVESTISSEMENT */}
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
             <h3 className="text-lg font-black text-slate-800 mb-6 flex items-center gap-2">
               <Target className="w-5 h-5 text-indigo-600" /> Stratégie de Placement ({Math.round(budgetData.totalToInvest)} € à placer)
             </h3>
             <div className="space-y-3">
               {strategy.map((step, idx) => (
                 <div key={idx} className={`flex items-center justify-between p-4 rounded-xl border-l-4 ${step.fill > 0 ? 'bg-indigo-50 border-indigo-600' : 'bg-slate-50 border-slate-200 opacity-60'}`}>
                    <div className="flex items-center gap-4">
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center font-bold text-xs ${step.fill > 0 ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-500'}`}>
                        {idx + 1}
                      </div>
                      <div>
                        <p className="font-bold text-slate-800">{step.name}</p>
                        <p className="text-xs text-slate-500">
                          {step.isBonus ? 'Illimité' : `${Math.round(step.current)} / ${step.max} €`}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className={`text-xl font-black ${step.fill > 0 ? 'text-indigo-600' : 'text-slate-400'}`}>
                        + {Math.round(step.fill)} €
                      </p>
                    </div>
                 </div>
               ))}
             </div>
          </div>

          {/* SECTION 4 : JAUGE DE SURVIE */}
          <div className={`p-8 rounded-3xl border-2 shadow-sm text-center transition-colors ${survival.bg} ${survival.borderColor}`}>
             <h3 className="text-sm font-black uppercase tracking-widest opacity-60 mb-4 flex items-center justify-center gap-2">
               <Hourglass className="w-4 h-4" /> Durée de Survie (Liquidités)
             </h3>
             <div className={`text-6xl font-black ${survival.color} mb-2`}>
               {survival.years > 0 && <span>{survival.years}a </span>}
               {survival.months}m {survival.days}j
             </div>
             <p className={`font-bold ${survival.color} opacity-80`}>
               Avec {survival.monthlyBurn}€ de dépenses / mois (Charges + Plaisir)
             </p>
          </div>
        </>
      )}

      {activeTab === 'fiscal' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
           {fiscalClock.map((item: any) => (
             <div key={item.id} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm relative overflow-hidden group hover:shadow-md transition-all">
                <div className={`absolute top-0 right-0 p-16 opacity-5 rounded-full -mr-8 -mt-8 ${item.isAvailable ? 'bg-emerald-500' : 'bg-indigo-500'}`}></div>
                
                <div className="flex justify-between items-start mb-4">
                  <div className={`p-3 rounded-xl ${item.isAvailable ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-500'}`}>
                    {item.isAvailable ? <Unlock className="w-6 h-6" /> : <Lock className="w-6 h-6" />}
                  </div>
                  <span className="text-[10px] font-black uppercase bg-slate-100 px-2 py-1 rounded text-slate-500">{item.type}</span>
                </div>

                <h4 className="font-bold text-slate-800 text-lg mb-1">{item.name}</h4>
                <p className="text-xs text-slate-400 font-bold uppercase mb-6">{item.label}</p>

                <div className="border-t border-slate-100 pt-4">
                   <div className="flex justify-between items-end">
                     <div>
                       <p className="text-[10px] text-slate-400 uppercase font-bold">Échéance</p>
                       <p className="font-bold text-slate-700">{item.date}</p>
                     </div>
                     <div className={`text-right font-black text-xl ${item.isAvailable ? 'text-emerald-500' : 'text-indigo-600'}`}>
                       {item.timeLeft}
                     </div>
                   </div>
                </div>
             </div>
           ))}
           {fiscalClock.length === 0 && (
             <div className="col-span-full text-center py-20 text-slate-400 italic bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200">
               Aucun compte bloqué ou à maturité détecté (PEE, PEA, AV).
             </div>
           )}
        </div>
      )}

    </div>
  );
};