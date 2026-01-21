import React, { useMemo } from 'react';
import { SavingsAccount, Expense, AccountType } from '../types';
import { TAX_BRACKETS, STANDARD_ALLOWANCE, SALARY_CHARGES_RATE } from '../constants';
import { AlertTriangle, TrendingUp, PiggyBank, ShieldCheck, Target, Calculator } from 'lucide-react';
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
  
  // --- 1. CALCULS FISCAUX & REVENUS (UTILISATION CONSTANTES) ---
  const fiscalData = useMemo(() => {
    // A. Calcul du Net Imposable (avec abattement forfaitaire)
    // Revenu Brut - Abattement + Revenus annexes (déjà nets ou à intégrer selon cas)
    const netTaxable = grossAnnual * (1 - STANDARD_ALLOWANCE) + (extraMonthlyIncome * 12);
    const quotient = netTaxable; // 1 part fiscale

    // B. Identification du TMI (Taux Marginal d'Imposition)
    // On trouve la tranche dans laquelle tombe le dernier euro
    // find renvoie la première tranche dont la limite est >= quotient
    const currentBracket = TAX_BRACKETS.find(b => quotient <= b.limit) || TAX_BRACKETS[TAX_BRACKETS.length - 1];
    const tmi = currentBracket.rate * 100;

    // C. Calcul de l'impôt théorique (Progressif par tranches)
    let tax = 0;
    let previousLimit = 0;
    for (const bracket of TAX_BRACKETS) {
      if (quotient > previousLimit) {
        // La part de revenu taxable dans cette tranche
        const taxableAmount = Math.min(quotient, bracket.limit) - previousLimit;
        tax += taxableAmount * bracket.rate;
        previousLimit = bracket.limit;
      }
    }

    // D. Calcul du Super Net Mensuel
    // D. Calcul du Super Net Mensuel
    // On retire les charges sociales (22.3%) du Brut pour avoir le Net, puis on lisse sur 12 mois
    const netMensuelAvantImpot = (grossAnnual * (1 - SALARY_CHARGES_RATE) / 12) + extraMonthlyIncome;
    const superNet = netMensuelAvantImpot - (tax / 12);

    return { 
      tmi: Math.round(tmi), 
      annualTax: Math.round(tax), 
      superNetMonthly: Math.round(superNet),
      netBeforeTax: Math.round(netMensuelAvantImpot)
    };
  }, [grossAnnual, extraMonthlyIncome]);

  // --- 2. CALCUL DU RESTE À VIVRE ---
  const budgetStats = useMemo(() => {
    const totalFixedExpenses = expenses.reduce((acc, curr) => acc + curr.amount, 0);
    const navigoCost = navigoBase * (1 - navigoRate / 100);
    const totalCharges = totalFixedExpenses + navigoCost;
    
    // Capacité d'épargne théorique
    const savingsCapacity = fiscalData.superNetMonthly - totalCharges - leisureBudget;
    const realSavingsRate = (savingsCapacity / fiscalData.superNetMonthly) * 100;

    return { 
      totalCharges: Math.round(totalCharges), 
      savingsCapacity: Math.round(savingsCapacity),
      realSavingsRate: realSavingsRate.toFixed(1)
    };
  }, [expenses, navigoBase, navigoRate, leisureBudget, fiscalData.superNetMonthly]);

  // --- 3. ANALYSE DE RÉSILIENCE ---
  const resilience = useMemo(() => {
    const liquidSavings = accounts
      .filter(a => !a.contractEndDate && a.type !== AccountType.IMMOBILIER && a.type !== AccountType.PER) // On exclut le bloqué
      .reduce((sum, a) => sum + a.ownedAmount, 0);
    
    const monthlyBurnRate = budgetStats.totalCharges + leisureBudget; // Ce qu'il faut pour vivre a minima
    const survivalMonths = monthlyBurnRate > 0 ? (liquidSavings / monthlyBurnRate).toFixed(1) : 'Infini';

    return { liquidSavings, survivalMonths };
  }, [accounts, budgetStats.totalCharges, leisureBudget]);

  // --- 4. GESTION DES DÉPENSES ---
  const handleAddExpense = () => {
    const name = prompt("Nom de la dépense :");
    const amountStr = prompt("Montant mensuel (€) :");
    if (name && amountStr) {
      const amount = parseFloat(amountStr);
      if (!isNaN(amount)) {
        onUpdateExpenses([...expenses, { id: crypto.randomUUID(), name, amount }]);
      }
    }
  };

  const handleRemoveExpense = (id: string) => {
    if (confirm("Supprimer cette dépense ?")) {
      onUpdateExpenses(expenses.filter(e => e.id !== id));
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* SECTION 1 : CONFIGURATION REVENUS */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
        <h3 className="text-lg font-black text-slate-800 mb-6 flex items-center gap-2">
          <Calculator className="w-5 h-5 text-indigo-600" /> Paramètres Financiers
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <label className="text-[10px] font-black text-slate-400 uppercase mb-1">Brut Annuel (€)</label>
            <input type="number" value={grossAnnual} onChange={e => setGrossAnnual(parseFloat(e.target.value) || 0)} className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl font-bold" />
          </div>
          <div>
            <label className="text-[10px] font-black text-slate-400 uppercase mb-1">Revenus Annexes Mensuels (€)</label>
            <input type="number" value={extraMonthlyIncome} onChange={e => setExtraMonthlyIncome(parseFloat(e.target.value) || 0)} className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl font-bold" />
          </div>
          <div>
            <label className="text-[10px] font-black text-slate-400 uppercase mb-1">Budget Loisirs (€)</label>
            <input type="number" value={leisureBudget} onChange={e => setLeisureBudget(parseFloat(e.target.value) || 0)} className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl font-bold" />
          </div>
        </div>
      </div>

      {/* SECTION 2 : ANALYSE FISCALE & BUDGETAIRE */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* CARTE FISCALITÉ */}
        <div className="bg-indigo-900 text-white p-6 rounded-2xl shadow-lg relative overflow-hidden">
          <div className="absolute top-0 right-0 p-32 bg-white opacity-5 rounded-full blur-3xl -mr-16 -mt-16 pointer-events-none"></div>
          <h3 className="text-sm font-bold text-indigo-200 uppercase tracking-widest mb-6 flex items-center gap-2"><ShieldCheck className="w-4 h-4" /> Analyse Fiscale</h3>
          
          <div className="space-y-6">
            <div className="flex justify-between items-end border-b border-indigo-800 pb-4">
              <span className="text-indigo-200 text-sm">Net avant impôt (est.)</span>
              <span className="text-xl font-bold">{fiscalData.netBeforeTax} €/mois</span>
            </div>
            <div className="flex justify-between items-end border-b border-indigo-800 pb-4">
              <span className="text-indigo-200 text-sm">Impôt Annuel Estimé</span>
              <span className="text-xl font-bold text-amber-400">{fiscalData.annualTax} €</span>
            </div>
            <div className="flex justify-between items-end">
              <span className="text-indigo-200 text-sm font-black uppercase">Super Net (Poche)</span>
              <span className="text-3xl font-black text-emerald-400">{fiscalData.superNetMonthly} €</span>
            </div>
            
            <div className="mt-4 bg-indigo-800/50 p-3 rounded-lg flex justify-between items-center">
              <span className="text-xs font-bold text-indigo-300">Tranche Marginale (TMI)</span>
              <span className="bg-white text-indigo-900 px-3 py-1 rounded-full text-xs font-black">{fiscalData.tmi}%</span>
            </div>
          </div>
        </div>

        {/* CARTE BUDGET & RESTE À VIVRE */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between">
          <div>
            <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-6 flex items-center gap-2"><Target className="w-4 h-4" /> Capacité d'Épargne</h3>
            <div className="flex items-center gap-4 mb-8">
              <div className="flex-1">
                <p className="text-xs text-slate-500 font-bold mb-1">Charges Fixes</p>
                <p className="text-2xl font-black text-slate-800">{budgetStats.totalCharges} €</p>
              </div>
              <div className="flex-1">
                <p className="text-xs text-slate-500 font-bold mb-1">Loisirs</p>
                <p className="text-2xl font-black text-slate-800">{leisureBudget} €</p>
              </div>
            </div>
          </div>
          
          <div className="bg-emerald-50 border border-emerald-100 p-5 rounded-2xl">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-xs font-black text-emerald-600 uppercase mb-1">Épargne Mensuelle Possible</p>
                <p className="text-4xl font-black text-emerald-700">{budgetStats.savingsCapacity} €</p>
              </div>
              <div className="text-right">
                <p className="text-xs font-bold text-emerald-600">Taux d'effort</p>
                <p className="text-xl font-black text-emerald-700">{budgetStats.realSavingsRate}%</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* SECTION 3 : RÉSILIENCE & CHARGES */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
           <div className="flex justify-between items-center mb-6">
              <h3 className="text-lg font-black text-slate-800 flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-rose-500" /> Charges Fixes
              </h3>
              <Button variant="ghost" className="text-xs h-8" onClick={handleAddExpense}>+ Ajouter</Button>
           </div>
           
           <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
             {expenses.map(exp => (
               <div key={exp.id} className="flex justify-between items-center p-3 bg-slate-50 rounded-xl border border-slate-100 group">
                 <span className="font-bold text-slate-700">{exp.name}</span>
                 <div className="flex items-center gap-3">
                   <span className="font-mono font-bold text-slate-900">{exp.amount} €</span>
                   <button onClick={() => handleRemoveExpense(exp.id)} className="text-slate-300 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-all">×</button>
                 </div>
               </div>
             ))}
             {expenses.length === 0 && <p className="text-slate-400 text-sm italic">Aucune charge fixe enregistrée.</p>}
           </div>
        </div>

        <div className="bg-slate-900 text-white p-6 rounded-2xl shadow-lg flex flex-col justify-center items-center text-center relative overflow-hidden">
          <AlertTriangle className="w-12 h-12 text-amber-400 mb-4 relative z-10" />
          <h3 className="text-lg font-black relative z-10">Filet de Sécurité</h3>
          <p className="text-slate-400 text-xs mb-6 relative z-10">Durée de vie sans aucun revenu</p>
          <div className="text-5xl font-black text-white mb-2 relative z-10">{resilience.survivalMonths} <span className="text-lg">mois</span></div>
          <p className="text-xs text-slate-500 relative z-10">Basé sur {new Intl.NumberFormat('fr-FR').format(resilience.liquidSavings)}€ liquides</p>
          
          {/* Background decoration */}
          <div className="absolute inset-0 bg-gradient-to-t from-slate-900 via-slate-900 to-indigo-900/20"></div>
        </div>
      </div>
    </div>
  );
};