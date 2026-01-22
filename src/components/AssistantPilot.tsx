import React, { useState, useMemo } from 'react';
import { SavingsAccount, Expense, AccountType, FiscalConfig } from '../types';
import { 
  Calculator, 
  TrendingUp, 
  Target, 
  Lock, 
  Unlock, 
  Info,
  Plus,
  Trash2,
  Hourglass,
  Coins,
  BarChart3
} from 'lucide-react';

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
  fiscalConfig: FiscalConfig; // Ajout prop
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
  setExtraMonthlyIncome,
  fiscalConfig
}) => {
  
  // --- ÉTATS LOCAUX ---
  const [showDetails, setShowDetails] = useState(false);
  const [externalSavings, setExternalSavings] = useState<number>(0);
  const [manualSavingsCapacity, setManualSavingsCapacity] = useState<string | null>(null); 
  const [activeTab, setActiveTab] = useState<'budget' | 'fiscal'>('budget');
  const navigoRefund = (navigoBase * (navigoRate / 100)); 

  // --- 1. MOTEUR DE CALCUL REVENUS (UTILISANT FISCAL CONFIG) ---
  const autoValues = useMemo(() => {
    const grossMonth = grossAnnual / 12;
    // Utilisation dynamique du taux
    const socialCharges = grossMonth * fiscalConfig.salaryChargesRate;
    const netSalaryOnly = grossMonth - socialCharges;
    const netBeforeTax = netSalaryOnly + navigoRefund + extraMonthlyIncome;
    // Calcul Impôt Dynamique
    const netTaxableYear = ((netSalaryOnly + extraMonthlyIncome) * 12) * (1 - fiscalConfig.standardAllowance);

    let taxAmount = 0;
    let previousLimit = 0;
    
    // Boucle sur les tranches dynamiques
    for (const bracket of fiscalConfig.taxBrackets) {
        const limit = bracket.limit === null || bracket.limit === undefined ? Infinity : bracket.limit;
        if (netTaxableYear > previousLimit) {
            const taxable = Math.min(netTaxableYear, limit) - previousLimit;
            taxAmount += taxable * bracket.rate;
            previousLimit = limit;
        }
    }

    const monthlyTax = taxAmount / 12;
    const autoRate = (taxAmount / netTaxableYear) * 100;

    return { grossMonth, socialCharges, netSalaryOnly, netBeforeTax, taxAmount, monthlyTax, autoRate, netTaxableYear };
  }, [grossAnnual, extraMonthlyIncome, navigoRefund, fiscalConfig]);

  const effectiveTaxRate = taxRateManual > 0 ? taxRateManual : autoValues.autoRate;
  const effectiveMonthlyTax = taxRateManual > 0 ? (autoValues.netBeforeTax * (taxRateManual/100)) : autoValues.monthlyTax;
  const effectiveSuperNet = autoValues.netBeforeTax - effectiveMonthlyTax;

  const updateFromGrossAnnual = (val: number) => setGrossAnnual(val);
  const updateFromGrossMonth = (val: number) => setGrossAnnual(val * 12);
  const updateFromNet = (val: number) => {
    const targetGrossMonth = (val - navigoRefund - extraMonthlyIncome) / (1 - fiscalConfig.salaryChargesRate);
    setGrossAnnual(targetGrossMonth * 12);
  };
  const updateFromSuperNet = (val: number) => {
    const estimatedNet = val + effectiveMonthlyTax;
    updateFromNet(estimatedNet);
  };

  // --- 2. CAPACITÉ D'ÉPARGNE ---
  const budgetData = useMemo(() => {
    const totalFixed = expenses.reduce((sum, e) => sum + e.amount, 0);
    const theoreticalCapacity = effectiveSuperNet - totalFixed - leisureBudget - projectSavings;
    const finalCapacity = manualSavingsCapacity !== null ? parseFloat(manualSavingsCapacity) : theoreticalCapacity;
    const totalToInvest = Math.max(0, finalCapacity + externalSavings);

    return { totalFixed, theoreticalCapacity, finalCapacity, totalToInvest };
  }, [effectiveSuperNet, expenses, leisureBudget, projectSavings, manualSavingsCapacity, externalSavings]);

  // --- 3. ALGORITHME DE CASCADE (Utilisant Plafonds Dynamiques) ---
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

      // Utilisation dynamique des plafonds
      let ceiling = acc.ceiling || 0;
      if (acc.type === AccountType.LEP) ceiling = fiscalConfig.ceilings.lep;
      if (acc.type === AccountType.LIVRET_A) ceiling = fiscalConfig.ceilings.livretA;
      if (acc.type === AccountType.LDDS) ceiling = fiscalConfig.ceilings.ldds;

      const availableSpace = Math.max(0, ceiling - acc.totalAmount);

      if (availableSpace > 0) {
        const amountAllocated = Math.min(remainingMoney, availableSpace);
        steps.push({
          accountName: acc.name,
          type: acc.type,
          rate: acc.interestRate,
          fillAmount: amountAllocated,
          isFullAfter: amountAllocated >= availableSpace,
          isLiquid: true
        });
        remainingMoney -= amountAllocated;
      }
    });

    if (remainingMoney > 0) {
      if (userOtherAccounts.length > 0) {
        const bestAccount = userOtherAccounts[0];
        steps.push({
          accountName: bestAccount.name,
          type: bestAccount.type,
          rate: bestAccount.interestRate,
          fillAmount: remainingMoney,
          isFullAfter: false,
          isLiquid: false
        });
        remainingMoney = 0;
      } else {
        steps.push({
          accountName: "Ouvrir un PEA/AV",
          type: AccountType.AUTRE,
          rate: 0,
          fillAmount: remainingMoney,
          isFullAfter: false,
          isLiquid: false,
          alert: true
        });
      }
    }

    return steps;
  }, [budgetData.totalToInvest, accounts, fiscalConfig]);

  // --- 4. DATA VISUALISATION LIVRETS (Remplissage Dynamique) ---
  const bookletStats = useMemo(() => {
    return [AccountType.LEP, AccountType.LIVRET_A, AccountType.LDDS].map(type => {
      const acc = accounts.find(a => a.type === type);
      if (!acc) return null;
      
      let ceiling = acc.ceiling;
      // Utilisation dynamique
      if (type === AccountType.LEP) ceiling = fiscalConfig.ceilings.lep;
      if (type === AccountType.LIVRET_A) ceiling = fiscalConfig.ceilings.livretA;
      if (type === AccountType.LDDS) ceiling = fiscalConfig.ceilings.ldds;
      
      if (!ceiling) ceiling = 10000; 

      const parentPct = (acc.parentalCapital / ceiling) * 100;
      const ownedPct = (acc.ownedAmount / ceiling) * 100;
      const totalPct = parentPct + ownedPct;
      const remainingSpace = ceiling - acc.totalAmount;

      return { 
        name: acc.name, 
        type, 
        ceiling, 
        parentAmount: acc.parentalCapital,
        ownedAmount: acc.ownedAmount,
        parentPct,
        ownedPct,
        totalPct,
        remainingSpace
      };
    }).filter(x => x !== null);
  }, [accounts, fiscalConfig]);

  // --- 5. RÉSILIENCE ---
  const survival = useMemo(() => {
    const liquidMoney = accounts
      .filter(a => !a.contractEndDate && ![AccountType.IMMOBILIER, AccountType.PER, AccountType.PEE].includes(a.type))
      .reduce((sum, a) => sum + a.ownedAmount, 0);
    
    const monthlyBurn = budgetData.totalFixed; 
    
    if (monthlyBurn === 0) return { label: "Infini", color: "text-slate-500", bg: "bg-slate-50", border: "border-slate-200" };

    const totalDays = (liquidMoney / monthlyBurn) * 30;
    const years = Math.floor(totalDays / 365);
    const months = Math.floor((totalDays % 365) / 30);
    const days = Math.floor(totalDays % 30);
    const totalMonths = liquidMoney / monthlyBurn;

    let color = 'text-emerald-600';
    let border = 'border-emerald-200';
    let bg = 'bg-emerald-50';

    if (totalMonths < 3) { color = 'text-rose-600'; border = 'border-rose-200'; bg = 'bg-rose-50'; }
    else if (totalMonths < 6) { color = 'text-orange-600'; border = 'border-orange-200'; bg = 'bg-orange-50'; }
    else if (totalMonths < 12) { color = 'text-emerald-600'; border = 'border-emerald-200'; bg = 'bg-emerald-50'; } 
    else { color = 'text-amber-600'; border = 'border-amber-200'; bg = 'bg-amber-50'; } 

    return { years, months, days, color, border, bg, monthlyBurn, totalMonths };
  }, [accounts, budgetData.totalFixed]);


  // --- 6. HORLOGE FISCALE (Dynamique) ---
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
          // Utilisation dynamique
          const duration = acc.type === AccountType.PEA ? fiscalConfig.legalMaturity.pea : fiscalConfig.legalMaturity.assuranceVie;
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
  }, [accounts, fiscalConfig]);

  return (
    <div className="space-y-8 animate-fade-in pb-20">
      
      {/* ONGLETS */}
      <div className="flex gap-4 border-b border-slate-200">
        <button onClick={() => setActiveTab('budget')} className={`pb-2 px-4 font-bold text-sm ${activeTab === 'budget' ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-slate-400'}`}>Pilotage Budgétaire</button>
        <button onClick={() => setActiveTab('fiscal')} className={`pb-2 px-4 font-bold text-sm ${activeTab === 'fiscal' ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-slate-400'}`}>Horloge Fiscale</button>
      </div>

      {activeTab === 'budget' && (
        <>
          {/* 1. CALCULATEUR REVENUS */}
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
            <h3 className="text-lg font-black text-slate-800 mb-6 flex items-center gap-2"><Calculator className="w-5 h-5 text-indigo-600" /> Revenus & Salaires</h3>
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
            
            {showDetails && (
              <div className="bg-white p-4 rounded-xl text-xs space-y-3 border border-slate-200 animate-in slide-in-from-top-2 shadow-inner mb-4">
                 <div className="flex justify-between font-bold border-b pb-1">
                   <span>Salaire Brut Mensuel</span> 
                   <span>{Math.round(autoValues.grossMonth).toLocaleString()} €</span>
                 </div>
                 
                 <div className="flex justify-between text-rose-500">
                   <span>Charges Salariales ({(fiscalConfig.salaryChargesRate*100).toFixed(2)}%)</span> 
                   <span>- {Math.round(autoValues.socialCharges).toLocaleString()} €</span>
                 </div>
                 
                 <div className="flex justify-between text-emerald-600">
                   <span>Remboursement Navigo</span> 
                   <span>+ {navigoRefund.toFixed(2)} €</span>
                 </div>
                 
                 <div className="flex justify-between font-bold text-indigo-700 pt-1 border-t border-slate-100">
                   <span>= Net Avant Impôt</span> 
                   <span>{autoValues.netBeforeTax.toFixed(2)} €</span>
                 </div>

                 {/* ZONE DE GESTION DE L'IMPÔT */}
                 <div className="bg-amber-50 p-2 rounded-lg border border-amber-100">
                    <div className="flex justify-between items-center mb-2">
                        <span className="text-amber-800 font-bold">Impôt à la source</span>
                        <span className="text-amber-600 font-mono font-black">- {effectiveMonthlyTax.toFixed(2)} €</span>
                    </div>
                    
                    <div className="flex items-center justify-between text-[10px] gap-2">
                        <div className="flex flex-col">
                            <span className="text-slate-500">Taux Barème (Auto) : <strong>{autoValues.autoRate.toFixed(1)}%</strong></span>
                            {taxRateManual > 0 && <span className="text-amber-600">Force à : <strong>{taxRateManual}%</strong></span>}
                        </div>
                        <div className="flex items-center gap-1">
                            <label className="text-slate-400">Forcer taux :</label>
                            <input 
                                type="number" 
                                step="0.1" 
                                value={taxRateManual} 
                                onChange={(e) => setTaxRateManual(parseFloat(e.target.value) || 0)} 
                                className="w-12 p-1 text-right bg-white border border-amber-200 rounded font-bold outline-none focus:ring-1 focus:ring-amber-500"
                                placeholder="Auto"
                            />
                            <span className="text-slate-400">%</span>
                        </div>
                    </div>
                    {taxRateManual === 0 && (
                        <p className="text-[9px] text-slate-400 mt-1 italic">
                            *Calculé sur un net imposable annuel de {Math.round(autoValues.netTaxableYear).toLocaleString()}€ (Barème progressif).
                        </p>
                    )}
                 </div>
              </div>
            )}
          </div>

          {/* 2. CHARGES & CAPACITÉ */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-1 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
              <div className="flex justify-between items-center mb-4">
                <h4 className="font-bold text-slate-700 flex items-center gap-2"><TrendingUp className="w-4 h-4 text-rose-500"/> Charges Fixes</h4>
                <button onClick={() => { const n = prompt("Nom ?");
                  const a = prompt("Montant ?"); if(n && a) onUpdateExpenses([...expenses, {id: crypto.randomUUID(), name: n, amount: parseFloat(a)}]);
                }} className="p-1 bg-slate-100 rounded hover:bg-slate-200"><Plus className="w-4 h-4"/></button>
              </div>
              <div className="space-y-2 max-h-60 overflow-y-auto pr-2">
                {expenses.map(e => (
                  <div key={e.id} className="flex justify-between text-sm p-2 bg-slate-50 rounded group">
                    <span>{e.name}</span>
                    <div className="flex gap-2"><span className="font-mono font-bold">{e.amount}€</span><Trash2 className="w-4 h-4 text-slate-300 hover:text-rose-500 cursor-pointer opacity-0 group-hover:opacity-100" onClick={() => onUpdateExpenses(expenses.filter(x => x.id !== e.id))} /></div>
                  </div>
                ))}
              </div>
              <div className="mt-4 pt-4 border-t flex justify-between font-black text-rose-600"><span>TOTAL CHARGES</span><span>{Math.round(budgetData.totalFixed)} €</span></div>
            </div>

            <div className="lg:col-span-2 space-y-6">
              <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm grid grid-cols-2 gap-4">
                 <div><label className="text-[10px] font-black text-slate-400 uppercase">Argent Plaisir</label><input type="number" value={leisureBudget} onChange={e => setLeisureBudget(parseFloat(e.target.value)||0)} className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg font-bold" /></div>
                 <div><label className="text-[10px] font-black text-slate-400 uppercase">Épargne Projets</label><input type="number" value={projectSavings} onChange={e => setProjectSavings(parseFloat(e.target.value)||0)} className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg font-bold" /></div>
              </div>
              <div className="bg-slate-900 p-6 rounded-2xl shadow-lg text-white grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
                 <div>
                   <p className="text-slate-400 text-xs font-bold uppercase mb-2">Capacité d'Épargne Réelle</p>
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

          {/* 3. STRATÉGIE & JAUGES */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            
            {/* Stratégie Cascade */}
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
               <h3 className="text-lg font-black text-slate-800 mb-6 flex items-center gap-2"><Target className="w-5 h-5 text-indigo-600" /> Placement ({Math.round(budgetData.totalToInvest)} €)</h3>
               <div className="space-y-3">
                 {strategy.length > 0 ? strategy.map((step, idx) => (
                   <div key={idx} className="flex items-center justify-between p-4 rounded-xl border-l-4 bg-indigo-50 border-indigo-600">
                      <div className="flex items-center gap-4">
                        <div className="w-6 h-6 rounded-full flex items-center justify-center font-bold text-xs bg-indigo-600 text-white">{idx + 1}</div>
                        <div>
                          <p className="font-bold text-slate-800">{step.accountName}</p>
                          <p className="text-xs text-slate-500">{step.type} • Taux {step.rate}%</p>
                        </div>
                      </div>
                      <p className="text-xl font-black text-indigo-600">+ {Math.round(step.fillAmount)} €</p>
                   </div>
                 )) : <p className="text-sm text-slate-400 italic">Rien à placer pour le moment.</p>}
               </div>
            </div>

            {/* Jauges Remplissage */}
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-6">
               <h3 className="text-lg font-black text-slate-800 mb-2 flex items-center gap-2"><BarChart3 className="w-5 h-5 text-indigo-600" /> Remplissage Livrets</h3>
               {bookletStats.map((b, i) => (
                 <div key={i} className="space-y-2">
                   <div className="flex justify-between text-sm font-bold text-slate-700">
                     <span>{b?.name}</span>
                     <span>{Math.round(b?.totalPct || 0)}%</span>
                   </div>
                   <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden flex">
                     {/* Part Parents */}
                     <div className="h-full bg-amber-400" style={{ width: `${b?.parentPct}%` }} title={`Parents: ${b?.parentAmount}€`}></div>
                     {/* Ma Part */}
                     <div className="h-full bg-indigo-600" style={{ width: `${b?.ownedPct}%` }} title={`Moi: ${b?.ownedAmount}€`}></div>
                   </div>
                   <div className="flex justify-between text-[10px] text-slate-400 font-bold">
                      <span className="text-amber-500">Parents {b?.parentAmount.toLocaleString()}€</span>
                     <span className="text-indigo-600">Moi {b?.ownedAmount.toLocaleString()}€</span>
                     <span>Max {b?.ceiling.toLocaleString()}€</span>
                   </div>
                 </div>
               ))}
            </div>
          </div>

          {/* 4. SURVIE */}
          <div className={`p-8 rounded-3xl border-2 shadow-sm text-center transition-colors ${survival.bg} ${survival.border}`}>
             <h3 className="text-sm font-black uppercase tracking-widest opacity-60 mb-4 flex items-center justify-center gap-2"><Hourglass className="w-4 h-4" /> Durée de Survie (Liquidités)</h3>
             <div className={`text-6xl font-black ${survival.color} mb-2`}>
               {survival.years > 0 && <span>{survival.years}a </span>}{survival.months}m {survival.days}j
             </div>
             <p className={`font-bold ${survival.color} opacity-80`}>Avec {survival.monthlyBurn}€ de charges fixes / mois</p>
          </div>
        </>
      )}

      {activeTab === 'fiscal' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
           {fiscalClock.map((item: any) => (
             <div key={item.id} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm relative overflow-hidden group hover:shadow-md transition-all">
                <div className={`absolute top-0 right-0 p-16 opacity-5 rounded-full -mr-8 -mt-8 ${item.isAvailable ? 'bg-emerald-500' : 'bg-indigo-500'}`}></div>
                <div className="flex justify-between items-start mb-4">
                  <div className={`p-3 rounded-xl ${item.isAvailable ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-500'}`}>{item.isAvailable ? <Unlock className="w-6 h-6" /> : <Lock className="w-6 h-6" />}</div>
                  <span className="text-[10px] font-black uppercase bg-slate-100 px-2 py-1 rounded text-slate-500">{item.type}</span>
                </div>
                <h4 className="font-bold text-slate-800 text-lg mb-1">{item.name}</h4>
                <div className="border-t border-slate-100 pt-4 mt-4">
                   <div className="flex justify-between items-end">
                     <div><p className="text-[10px] text-slate-400 uppercase font-bold">Échéance</p><p className="font-bold text-slate-700">{item.date}</p></div>
                     <div className={`text-right font-black text-xl ${item.isAvailable ? 'text-emerald-500' : 'text-indigo-600'}`}>{item.timeLeft}</div>
                   </div>
                </div>
             </div>
           ))}
        </div>
      )}
    </div>
  );
};