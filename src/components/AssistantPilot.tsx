import React, { useState, useMemo } from 'react';
import { SavingsAccount, AccountType, Expense, PaymentMethod } from '../types';
import { 
  ShieldCheck, 
  Zap, 
  PlusCircle,
  Trash2,
  Coffee,
  Plane,
  ChevronDown,
  ChevronUp,
  ReceiptEuro,
  Timer,
  Clock,
  Unlock,
  TrendingUp,
  History,
  Coins,
  ArrowRight,
  Calculator,
  Navigation,
  HeartPulse,
  AlertTriangle,
  TramFront,
  CheckCircle2,
  XCircle,
  UserCheck
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
  const [showDetails, setShowDetails] = useState(false);
  const [newExpenseName, setNewExpenseName] = useState('');
  const [newExpenseAmount, setNewExpenseAmount] = useState('');

  const financialDetails = useMemo(() => {
    const SOCIAL_CHARGES_RATE = 0.2233;
    const ABATTEMENT_10 = 0.10;
    
    // Sécurisation des entrées par Number()
    const currentGross = Number(grossAnnual) || 0;
    const grossMonthly = currentGross / 12;
    const netSocial = grossMonthly * (1 - SOCIAL_CHARGES_RATE);
    const navigoReimbursement = (Number(navigoBase) || 0) * ((Number(navigoRate) || 0) / 100);
    const netBeforeTax = netSocial + navigoReimbursement;

    const netAnnualImposable = netSocial * 12 * (1 - ABATTEMENT_10);
    let theoreticalTax = 0;
    const tranches = [
      { limit: 11294, rate: 0 },
      { limit: 28797, rate: 0.11 },
      { limit: 82341, rate: 0.30 },
      { limit: 177106, rate: 0.41 },
      { limit: Infinity, rate: 0.45 }
    ];

    let previousLimit = 0;
    for (const t of tranches) {
      if (netAnnualImposable > previousLimit) {
        const taxableInTranche = Math.min(netAnnualImposable, t.limit) - previousLimit;
        theoreticalTax += taxableInTranche * t.rate;
        previousLimit = t.limit;
      }
    }

    const calculatedTaxRate = (theoreticalTax / (netSocial * 12)) * 100;
    const effectiveRate = Number(taxRateManual) > 0 ? Number(taxRateManual) : calculatedTaxRate;
    const monthlyTaxAmount = netSocial * (effectiveRate / 100);
    const netAfterTax = netSocial - monthlyTaxAmount + navigoReimbursement;

    return { 
      grossMonthly, 
      netSocial,
      netBeforeTax,
      monthlyTaxAmount, 
      netAfterTax,
      calculatedTaxRate,
      isRateValid: Math.abs(calculatedTaxRate - Number(taxRateManual)) < 1.0,
      navigoReimbursement
    };
  }, [grossAnnual, navigoBase, navigoRate, taxRateManual]);


// 1. Somme des charges (avec repli sur vos 1350€ de base si la liste est vide)
  const totalFixedCharges = useMemo(() => {
    const sum = expenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
    return sum > 0 ? sum : 1350; 
  }, [expenses]);
  
  // 2. Calcul de la capacité d'investissement (Revenus - Sorties)
  const investmentCapacity = useMemo(() => {
    const net = Number(financialDetails.netAfterTax) || 0;
    const extra = Number(extraMonthlyIncome) || 0;
    const charges = Number(totalFixedCharges) || 0;
    const loisirs = Number(leisureBudget) || 0;
    const projets = Number(projectSavings) || 0;

    const totalRevenus = net + extra;
    const totalSorties = charges + loisirs + projets;

    // On s'assure de retourner un nombre positif
    return Math.max(0, totalRevenus - totalSorties);
  }, [financialDetails.netAfterTax, extraMonthlyIncome, totalFixedCharges, leisureBudget, projectSavings]);

  // 3. Logique de survie (Analyse de résilience)
  
  
  const getSurvivalData = (savings: number, charges: number) => {
    if (charges <= 0) return { years: 99, months: 0, days: 0, totalMonths: 999, status: 'GREEN' as const };
    const totalMonths = savings / charges;
    const years = Math.floor(totalMonths / 12);
    const months = Math.floor(totalMonths % 12);
    const days = Math.floor((totalMonths % 1) * 30.44);
    let status: 'RED' | 'ORANGE' | 'GREEN' = 'GREEN';
    if (totalMonths < 3) status = 'RED';
    else if (totalMonths <= 6) status = 'ORANGE';
    return { years, months, days, totalMonths, status };
  };

  const survivalStats = useMemo(() => {
    const liquidAccounts = [AccountType.LIVRET_A, AccountType.LDDS, AccountType.LEP, AccountType.COMPTE_COURANT];
    const liquidSavings = accounts
      .filter(a => liquidAccounts.includes(a.type))
      .reduce((sum, a) => sum + a.ownedAmount, 0);
    
    const liquidData = getSurvivalData(liquidSavings, totalFixedCharges);

    const classes = {
      RED: { text: 'text-rose-600', bg: 'bg-rose-50', border: 'border-rose-200', icon: AlertTriangle },
      ORANGE: { text: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-200', icon: Timer },
      GREEN: { text: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-200', icon: HeartPulse }
    };

    return { 
      liquid: { ...liquidData, style: classes[liquidData.status], amount: liquidSavings }
    };
  }, [accounts, totalFixedCharges]);

  // ALGORITHME DE CASCADE
  const investmentStrategy = useMemo(() => {
    const sortedAccounts = [...accounts]
      .filter(a => a.ceiling && a.totalAmount < a.ceiling)
      .sort((a, b) => {
        const prio = (type: AccountType) => {
          if (type === AccountType.LEP) return 3;
          if (type === AccountType.LIVRET_A) return 2;
          if (type === AccountType.LDDS) return 1;
          return 0;
        };
        const pA = prio(a.type);
        const pB = prio(b.type);
        if (pA !== pB) return pB - pA;
        return (b.interestRate || 0) - (a.interestRate || 0);
      });

    let remainingCapacity = investmentCapacity;
    const steps: { target: string; amount: number; reason: string }[] = [];

    for (const acc of sortedAccounts) {
      if (remainingCapacity <= 0) break;
      const space = (acc.ceiling || 0) - acc.totalAmount;
      const fillAmount = Math.min(remainingCapacity, space);
      if (fillAmount > 0) {
        steps.push({ target: acc.name, amount: Math.floor(fillAmount), reason: `Remplir le plafond (${acc.interestRate}% net).` });
        remainingCapacity -= fillAmount;
      }
    }

    if (remainingCapacity > 0) {
      const longTermAcc = accounts
        .filter(a => [AccountType.PEA, AccountType.ASSURANCE_VIE].includes(a.type))
        .sort((a, b) => (b.interestRate || 0) - (a.interestRate || 0))[0];
      if (longTermAcc) steps.push({ target: longTermAcc.name, amount: Math.floor(remainingCapacity), reason: "Optimisation enveloppes long-terme." });
    }
    return steps;
  }, [accounts, investmentCapacity]);

  // HORLOGES FISCALES (Optimisation PEE incluse)
  const fiscalClocks = useMemo(() => {
    const today = new Date();
    return accounts
      .filter(a => [AccountType.PEA, AccountType.ASSURANCE_VIE, AccountType.PEE, AccountType.PER].includes(a.type))
      .map(acc => {
        if (acc.type === AccountType.PER) {
          return { id: acc.id, name: acc.name, type: acc.type, isMature: false, progress: 30, label: 'BLOQUÉ (RETRAITE)' };
        }

        let maturityYears = acc.type === AccountType.ASSURANCE_VIE ? 8 : 5;
        let progress = 0;
        let isMature = false;
        let label = '';

        // Logique spécifique PEE
        if (acc.type === AccountType.PEE && acc.contractEndDate) {
            const endDate = new Date(acc.contractEndDate);
            if (endDate <= today) {
                isMature = true;
                progress = 100;
                label = 'LIBÉRÉ (FIN CONTRAT)';
            } else if (acc.openingDate) {
                const openDate = new Date(acc.openingDate);
                const totalDuration = endDate.getTime() - openDate.getTime();
                const currentDuration = today.getTime() - openDate.getTime();
                progress = Math.min(100, Math.max(0, (currentDuration / totalDuration) * 100));
                const diffDays = Math.ceil((endDate.getTime() - today.getTime()) / (1000 * 3600 * 24));
                label = diffDays > 30 ? `${Math.floor(diffDays/30.44)} mois restants` : `${diffDays} jours restants`;
            }
        } else if (acc.openingDate) {
          const openDate = new Date(acc.openingDate);
          const ageInYears = (today.getTime() - openDate.getTime()) / (1000 * 3600 * 24 * 365.25);
          progress = Math.min(100, (ageInYears / maturityYears) * 100);
          isMature = ageInYears >= maturityYears;
          
          if (isMature) {
            label = 'MATURE (FISCALITÉ OK)';
          } else {
            const remaining = maturityYears - ageInYears;
            label = remaining > 1 ? `${remaining.toFixed(1)} ans restants` : `${(remaining * 12).toFixed(0)} mois restants`;
          }
        } else {
            label = 'DATE INCONNUE';
            progress = 0;
        }

        return { id: acc.id, name: acc.name, type: acc.type, isMature, progress, label };
      });
  }, [accounts]);

  const handleAddExpense = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newExpenseName || !newExpenseAmount) return;
    onUpdateExpenses([...expenses, { id: crypto.randomUUID(), name: newExpenseName, amount: parseFloat(newExpenseAmount), paymentMethod: PaymentMethod.PRELEVEMENT }]);
    setNewExpenseName(''); setNewExpenseAmount('');
  };

  return (
    <div className="space-y-8 animate-fade-in pb-12">
      {/* SECTION REVENUS */}
      <section className="bg-white p-6 rounded-3xl shadow-sm border border-slate-200">
        <div className="flex justify-between items-start mb-6">
          <h3 className="text-xl font-black text-slate-800 flex items-center gap-2">
            <ReceiptEuro className="w-6 h-6 text-indigo-600" /> Revenus & Fiscalité
          </h3>
          <button onClick={() => setShowDetails(!showDetails)} className="text-xs font-bold text-indigo-600 flex items-center gap-1">
            {showDetails ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            {showDetails ? 'Masquer détails' : 'Détails calculs'}
          </button>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
          <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 lg:col-span-2 grid grid-cols-2 gap-4">
             <div>
               <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Brut Annuel</label>
               <input type="number" value={grossAnnual} onChange={e => setGrossAnnual(parseFloat(e.target.value) || 0)} className="w-full bg-transparent font-black text-slate-800 text-xl outline-none" />
             </div>
             <div>
               <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Brut Mensuel</label>
               <div className="text-xl font-black text-slate-600">{Math.floor(financialDetails.grossMonthly).toLocaleString()} €</div>
             </div>
          </div>

          <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 relative">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2 flex justify-between">
              Taux Impôts Actuel (%)
              {taxRateManual > 0 && (
                <span className={`flex items-center gap-1 ${financialDetails.isRateValid ? 'text-emerald-500' : 'text-rose-500'}`}>
                  {financialDetails.isRateValid ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                  {financialDetails.isRateValid ? 'Validé' : 'Divergent'}
                </span>
              )}
            </label>
            <input type="number" step="0.01" value={taxRateManual} onChange={e => setTaxRateManual(parseFloat(e.target.value) || 0)} className="w-full bg-transparent font-black text-slate-800 text-xl outline-none" />
            <div className="text-[9px] text-slate-400 mt-1 font-bold">Théorique : {financialDetails.calculatedTaxRate.toFixed(1)}%</div>
          </div>

          <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Net Avant Impôts</label>
            <div className="text-xl font-black text-slate-800">{financialDetails.netBeforeTax.toFixed(2)} €</div>
          </div>

          <div className="bg-indigo-600 p-4 rounded-2xl text-white shadow-lg shadow-indigo-100 flex flex-col justify-center">
            <label className="text-[10px] font-bold text-indigo-200 uppercase tracking-widest block mb-2">Net Après Impôts</label>
            <div className="text-2xl font-black">{financialDetails.netAfterTax.toFixed(2)} €</div>
          </div>
        </div>

        {showDetails && (
          <div className="mt-6 p-5 bg-slate-900 rounded-2xl text-slate-300 text-xs font-mono space-y-3 border-l-4 border-indigo-500 shadow-inner">
            <div className="flex justify-between items-center border-b border-slate-800 pb-2"><span>Cotisations Sociales (22,33%)</span><span className="text-rose-400 font-bold">-{Math.floor(financialDetails.grossMonthly * 0.2233).toLocaleString()} €</span></div>
            <div className="flex justify-between items-center"><span>Remboursement Navigo ({navigoRate}% de {navigoBase}€)</span><span className="text-emerald-400 font-bold">+{financialDetails.navigoReimbursement.toFixed(2)} €</span></div>
            <div className="flex justify-between items-center"><span className="text-indigo-400 font-black uppercase">Net Social</span><span className="text-white font-bold">{financialDetails.netSocial.toFixed(2)} €</span></div>
          </div>
        )}
      </section>

      {/* RÉSILIENCE */}
      <section className="space-y-4">
        <h3 className="text-sm font-black text-slate-400 uppercase tracking-widest flex items-center gap-2 px-2">
          <HeartPulse className="w-4 h-4" /> Analyse de Résilience
        </h3>
        <div className="max-w-2xl">
          <div className={`p-6 rounded-3xl shadow-sm border ${survivalStats.liquid.style.border} ${survivalStats.liquid.style.bg} transition-all`}>
            <div className="flex justify-between items-center gap-4">
              <div className="flex items-center gap-4">
                <div className={`p-3 rounded-2xl bg-white shadow-sm ${survivalStats.liquid.style.text}`}>
                  <Unlock className="w-6 h-6" />
                </div>
                <div>
                  <h4 className={`text-sm font-black ${survivalStats.liquid.style.text} uppercase`}>Liquidités Immédiates</h4>
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-tight">Livret A, LDDS, LEP, Compte Courant</p>
                </div>
              </div>
              <div className="text-right">
                <div className={`text-2xl font-black ${survivalStats.liquid.style.text}`}>
                  {survivalStats.liquid.years > 0 && `${survivalStats.liquid.years} an${survivalStats.liquid.years > 1 ? 's' : ''}, `}
                  {survivalStats.liquid.months} mois
                </div>
                <p className="text-[9px] font-bold text-slate-400 tracking-wider uppercase">Survie basée sur {survivalStats.liquid.amount.toLocaleString()} € dispos</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CHARGES & PROJETS */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="bg-white p-6 rounded-3xl shadow-sm border border-slate-200">
          <h4 className="font-black text-slate-800 mb-4 flex items-center gap-2"><ShieldCheck className="w-5 h-5 text-slate-400" /> Charges Fixes</h4>
          <div className="space-y-2 mb-4 max-h-60 overflow-y-auto pr-2 custom-scrollbar">
            {expenses.map(e => (
              <div key={e.id} className="flex justify-between items-center p-3 bg-slate-50 hover:bg-slate-100 rounded-xl transition-all">
                <span className="text-sm font-bold text-slate-700">{e.name}</span>
                <div className="flex items-center gap-3"><span className="font-black text-rose-600">-{e.amount.toLocaleString()}€</span><button onClick={() => onUpdateExpenses(expenses.filter(ex => ex.id !== e.id))} className="text-slate-300 hover:text-rose-600"><Trash2 className="w-4 h-4" /></button></div>
              </div>
            ))}
          </div>
          <form onSubmit={handleAddExpense} className="flex gap-2">
            <input type="text" placeholder="Loyer..." value={newExpenseName} onChange={e => setNewExpenseName(e.target.value)} className="flex-1 p-2 bg-slate-50 border border-slate-200 rounded-xl text-sm" />
            <input type="number" placeholder="€" value={newExpenseAmount} onChange={e => setNewExpenseAmount(e.target.value)} className="w-20 p-2 bg-slate-50 border border-slate-200 rounded-xl text-sm" />
            <button type="submit" className="bg-indigo-600 text-white p-2 rounded-xl"><PlusCircle className="w-5 h-5" /></button>
          </form>
        </section>

        <section className="bg-white p-6 rounded-3xl shadow-sm border border-slate-200">
          <h4 className="font-black text-slate-800 mb-6 flex items-center gap-2"><Zap className="w-5 h-5 text-amber-500" /> Arbitrage Plaisirs & Projets</h4>
          <div className="space-y-8">
            <div className="space-y-3">
              <div className="flex justify-between items-center"><label className="text-xs font-black text-slate-500 uppercase flex items-center gap-2"><Coffee className="w-4 h-4 text-amber-600" /> Budget Loisirs</label><div className="bg-amber-50 px-3 py-1 rounded-full text-amber-700 font-black">{leisureBudget.toLocaleString()} €</div></div>
              <input type="range" min="0" max="2000" step="50" value={leisureBudget} onChange={e => setLeisureBudget(parseFloat(e.target.value))} className="w-full h-2 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-amber-500" />
            </div>
            <div className="space-y-3">
              <div className="flex justify-between items-center"><label className="text-xs font-black text-slate-500 uppercase flex items-center gap-2"><Plane className="w-4 h-4 text-cyan-600" /> Épargne Projets</label><div className="bg-cyan-50 px-3 py-1 rounded-full text-cyan-700 font-black">{projectSavings.toLocaleString()} €</div></div>
              <input type="range" min="0" max="3000" step="50" value={projectSavings} onChange={e => setProjectSavings(parseFloat(e.target.value))} className="w-full h-2 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-cyan-500" />
            </div>
          </div>
        </section>
      </div>

      {/* STRATÉGIE ET CASCADE */}
      <section className="bg-white p-6 rounded-3xl shadow-sm border border-slate-200">
        <h4 className="font-black text-slate-800 mb-6 flex items-center gap-2"><History className="w-5 h-5 text-indigo-500" /> Stratégie d'Investissement</h4>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-1 space-y-4">
            <div className="bg-slate-50 p-5 rounded-2xl border border-slate-200">
              <label className="text-[10px] font-black text-slate-500 uppercase block mb-3">Revenu supplémentaire / mois</label>
              <div className="flex items-center gap-4"><div className="bg-emerald-100 p-3 rounded-xl"><Coins className="w-6 h-6 text-emerald-600" /></div><div className="flex-1"><input type="number" value={extraMonthlyIncome} onChange={e => setExtraMonthlyIncome(parseFloat(e.target.value) || 0)} className="bg-transparent text-3xl font-black text-slate-800 outline-none w-full" /></div></div>
            </div>
            <div className="bg-indigo-600 rounded-2xl p-6 text-white shadow-xl">
              <p className="text-[10px] font-bold text-indigo-100 uppercase mb-1">Capacité d'Investissement Nette</p>
              <div className="text-4xl font-black">{Math.floor(investmentCapacity).toLocaleString()} €</div>
            </div>
          </div>
          <div className="lg:col-span-2 space-y-4">
            <p className="text-xs font-black text-slate-400 uppercase flex items-center gap-2"><Calculator className="w-4 h-4" /> Plan de versement (Cascade)</p>
            {investmentStrategy.map((step, idx) => (
              <div key={idx} className="flex items-center gap-5 bg-slate-50 p-5 rounded-2xl border border-slate-200">
                <div className="bg-white p-3 rounded-2xl shadow-sm font-black text-indigo-600">#{idx + 1}</div>
                <div className="flex-1">
                  <div className="flex justify-between items-center mb-1"><span className="font-black text-slate-800 text-lg">{step.target}</span><span className="text-emerald-600 font-black text-xl">+{step.amount.toLocaleString()}€</span></div>
                  <p className="text-xs text-slate-500 font-bold">{step.reason}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* REMPLISSAGE LIVRETS */}
      <section className="bg-white p-6 rounded-3xl shadow-sm border border-slate-200">
        <h4 className="font-black text-slate-800 mb-6 flex items-center gap-2"><TrendingUp className="w-5 h-5 text-emerald-500" /> Remplissage des livrets</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {accounts.filter(a => a.ceiling).map(acc => {
            const ownedPct = acc.ceiling ? (acc.ownedAmount / acc.ceiling) * 100 : 0;
            const parentalPct = acc.ceiling ? (acc.parentalCapital / acc.ceiling) * 100 : 0;
            const remaining = Math.max(0, (acc.ceiling || 0) - acc.totalAmount);
            return (
              <div key={acc.id} className="bg-slate-50 border border-slate-200 p-5 rounded-3xl">
                <div className="flex justify-between items-center mb-4"><div><span className="text-sm font-black text-slate-800">{acc.name}</span></div><span className={`text-[10px] font-black px-3 py-1 rounded-full ${remaining <= 1 ? 'bg-rose-100 text-rose-600' : 'bg-emerald-100 text-emerald-600'}`}>{remaining <= 1 ? 'PLEIN' : `RESTE ${Math.floor(remaining).toLocaleString()} €`}</span></div>
                <div className="w-full bg-white h-5 rounded-full overflow-hidden flex border border-slate-200 p-1 shadow-inner"><div className="h-full bg-emerald-500 rounded-l-full" style={{ width: `${ownedPct}%` }} /><div className="h-full bg-slate-300" style={{ width: `${parentalPct}%` }} /></div>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div className="bg-white p-2 rounded-xl border text-center"><p className="text-[9px] font-black text-emerald-600 uppercase mb-1">Moi</p><p className="text-xs font-black text-slate-800">{Math.floor(acc.ownedAmount).toLocaleString()} €</p></div>
                  <div className="bg-white p-2 rounded-xl border text-center"><p className="text-[9px] font-black text-slate-400 uppercase mb-1">Parents</p><p className="text-xs font-black text-slate-800">{Math.floor(acc.parentalCapital).toLocaleString()} €</p></div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* HORLOGES FISCALES */}
      <section className="bg-white p-6 rounded-3xl shadow-sm border border-slate-200">
        <h4 className="font-black text-slate-800 mb-6 flex items-center gap-2"><Clock className="w-5 h-5 text-amber-500" /> Horloges & Verrous Temporels</h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {fiscalClocks.map(clock => (
            <div key={clock.id} className="bg-slate-50 p-5 rounded-3xl border border-slate-200 relative overflow-hidden group">
              <div className="flex justify-between items-start mb-3"><div><span className="text-sm font-black text-slate-800">{clock.name}</span><p className="text-[10px] text-slate-400 font-bold uppercase">{clock.type}</p></div><div className={`flex items-center gap-1.5 text-[10px] font-black px-3 py-1 rounded-full ${clock.isMature ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-600'}`}>{clock.isMature ? <Unlock className="w-3.5 h-3.5" /> : <Timer className="w-3.5 h-3.5 animate-pulse" />}{clock.label}</div></div>
              <div className="w-full bg-slate-200 h-2 rounded-full overflow-hidden"><div className={`h-full transition-all duration-1000 ${clock.isMature ? 'bg-emerald-500' : 'bg-amber-500'}`} style={{ width: `${clock.progress}%` }} /></div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};