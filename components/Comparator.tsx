import React, { useState, useMemo } from 'react';
import { SavingsAccount, AccountType } from '../types';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer, ReferenceLine } from 'recharts';
import { TrendingUp, Award, DollarSign, AlertCircle, Info, ArrowUpRight, ArrowDownRight, Scale } from 'lucide-react';

interface ComparatorProps {
  accounts: SavingsAccount[];
}

export const Comparator: React.FC<ComparatorProps> = ({ accounts }) => {
  const [years, setYears] = useState<number>(5);
  const SOCIAL_TAX = 0.172; // 17.2% de prélèvements sociaux

  const stats = useMemo(() => {
    const data = accounts.map(account => {
      const totalInitial = account.totalAmount;
      const isTaxable = account.isTaxable;
      const ratioOwned = totalInitial > 0 ? account.ownedAmount / totalInitial : 1;

      // --- 1. Calcul Taux Actuel ---
      const rate = account.interestRate || 0;
      const finalAmountRaw = totalInitial * Math.pow(1 + rate / 100, years);
      const totalInterestBrut = finalAmountRaw - totalInitial;
      const totalInterestNet = isTaxable ? totalInterestBrut * (1 - SOCIAL_TAX) : totalInterestBrut;

      // --- 2. Calcul Fourchette (Bornes) ---
      let lowInterestNet = null;
      let highInterestNet = null;

      if (account.recentLowRate !== undefined && account.recentHighRate !== undefined) {
        // Borne Basse
        const lowFinalRaw = totalInitial * Math.pow(1 + account.recentLowRate / 100, years);
        const lowIntBrut = lowFinalRaw - totalInitial;
        lowInterestNet = isTaxable ? lowIntBrut * (1 - SOCIAL_TAX) : lowIntBrut;

        // Borne Haute
        const highFinalRaw = totalInitial * Math.pow(1 + account.recentHighRate / 100, years);
        const highIntBrut = highFinalRaw - totalInitial;
        highInterestNet = isTaxable ? highIntBrut * (1 - SOCIAL_TAX) : highIntBrut;
      }

      return {
        ...account,
        rate,
        totalInterest: totalInterestNet,
        interestOwned: Math.round(totalInterestNet * ratioOwned),
        interestParental: Math.round(totalInterestNet * (1 - ratioOwned)),
        // Fourchette
        lowInterestNet: lowInterestNet !== null ? Math.round(lowInterestNet) : null,
        highInterestNet: highInterestNet !== null ? Math.round(highInterestNet) : null,
        lowOwned: lowInterestNet !== null ? Math.round(lowInterestNet * ratioOwned) : null,
        highOwned: highInterestNet !== null ? Math.round(highInterestNet * ratioOwned) : null,
      };
    }).sort((a, b) => b.totalInterest - a.totalInterest);

    const globalGain = data.reduce((acc, curr) => acc + curr.totalInterest, 0);
    const globalHighGain = data.reduce((acc, curr) => acc + (curr.highInterestNet ?? curr.totalInterest), 0);
    const globalLowGain = data.reduce((acc, curr) => acc + (curr.lowInterestNet ?? curr.totalInterest), 0);

    return { data, globalGain, globalHighGain, globalLowGain };
  }, [accounts, years]);

  if (accounts.length === 0) return null;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Contrôles et Titre */}
      <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-200">
        <div className="flex flex-col md:flex-row justify-between items-center gap-6">
          <div>
            <h3 className="text-xl font-black text-slate-800">Projection & Fourchettes</h3>
            <p className="text-sm text-slate-500">Intérêts cumulés sur {years} ans, <strong>nets de fiscalité (17,2%)</strong>.</p>
          </div>
          <div className="flex items-center gap-4 bg-slate-50 px-6 py-4 rounded-2xl border w-full md:w-auto">
            <span className="text-sm font-black text-indigo-600 whitespace-nowrap">{years} ANS</span>
            <input 
              type="range" 
              min="1" 
              max="30" 
              value={years} 
              onChange={e => setYears(parseInt(e.target.value))} 
              className="w-full md:w-64 h-2 rounded-lg appearance-none cursor-pointer accent-indigo-600" 
            />
          </div>
        </div>
      </div>

      {/* KPIs Global Scénarios */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-slate-100 p-6 rounded-3xl border border-slate-200 flex flex-col justify-between">
          <div className="flex items-center gap-2 text-[10px] font-black text-slate-400 uppercase mb-2">
            <ArrowDownRight className="w-4 h-4 text-rose-500" /> Scénario Pessimiste
          </div>
          <h3 className="text-2xl font-black text-slate-800">+{Math.floor(stats.globalLowGain).toLocaleString()} €</h3>
          <p className="text-[10px] text-slate-500 font-bold mt-1">Basé sur les taux minimums nets</p>
        </div>

        <div className="bg-indigo-600 p-6 rounded-3xl text-white shadow-xl shadow-indigo-100 flex flex-col justify-between relative overflow-hidden">
          <div className="flex items-center gap-2 text-[10px] font-bold text-indigo-200 uppercase mb-2">
            <TrendingUp className="w-4 h-4" /> Projection Actuelle
          </div>
          <h3 className="text-3xl font-black">+{Math.floor(stats.globalGain).toLocaleString()} €</h3>
          <p className="text-[10px] text-indigo-100 font-bold mt-1">Basé sur le taux fixe actuel</p>
          <Award className="absolute -right-2 -bottom-2 w-16 h-16 text-white/10" />
        </div>

        <div className="bg-emerald-600 p-6 rounded-3xl text-white shadow-xl shadow-emerald-100 flex flex-col justify-between">
          <div className="flex items-center gap-2 text-[10px] font-bold text-emerald-100 uppercase mb-2">
            <ArrowUpRight className="w-4 h-4" /> Scénario Optimiste
          </div>
          <h3 className="text-2xl font-black">+{Math.floor(stats.globalHighGain).toLocaleString()} €</h3>
          <p className="text-[10px] text-emerald-100 font-bold mt-1">Potentiel max des enveloppes</p>
        </div>
      </div>

      {/* Analyse détaillée des fourchettes */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-200 h-[500px]">
          <h4 className="font-black text-slate-800 mb-6 flex items-center gap-2"><Scale className="w-5 h-5 text-indigo-500" /> Répartition Perso vs Parents</h4>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={stats.data} layout="vertical" margin={{ left: 20, right: 60 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
              <XAxis type="number" hide />
              <YAxis dataKey="name" type="category" width={140} tick={{fontSize: 11, fontWeight: 'bold'}} />
              <RechartsTooltip 
                formatter={(val: number) => val.toLocaleString() + " €"} 
                cursor={{fill: '#f8fafc'}}
                contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)' }}
              />
              <Legend verticalAlign="top" align="right" height={36}/>
              <Bar dataKey="interestOwned" name="Mes Intérêts" stackId="a" fill="#6366f1" radius={[0, 0, 0, 0]} barSize={24} />
              <Bar dataKey="interestParental" name="Intérêts Parents" stackId="a" fill="#94a3b8" radius={[0, 4, 4, 0]} barSize={24} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-200 overflow-y-auto max-h-[500px] custom-scrollbar">
          <h4 className="font-black text-slate-800 mb-6 flex items-center gap-2"><Info className="w-5 h-5 text-indigo-500" /> Détails des Bornes (Net Fiscal)</h4>
          <div className="space-y-4">
            {stats.data.map(acc => (
              <div key={acc.id} className="p-4 bg-slate-50 rounded-2xl border border-slate-200 hover:border-indigo-300 transition-colors">
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <span className="text-sm font-black text-slate-800">{acc.name}</span>
                    <p className="text-[10px] text-slate-400 font-bold uppercase">{acc.institution}</p>
                  </div>
                  {acc.isTaxable && (
                    <span className="bg-slate-900 text-white text-[8px] px-2 py-0.5 rounded-full font-black">TAXE 17.2% DÉDUITE</span>
                  )}
                </div>

                {acc.highInterestNet !== null ? (
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-white p-3 rounded-xl border border-rose-100">
                      <p className="text-[9px] font-black text-rose-400 uppercase mb-1">Borne Basse ({acc.recentLowRate}%)</p>
                      <div className="text-sm font-black text-slate-700">+{acc.lowInterestNet?.toLocaleString()} €</div>
                      <p className="text-[9px] text-slate-400">Dont moi : {acc.lowOwned}€</p>
                    </div>
                    <div className="bg-white p-3 rounded-xl border border-emerald-100">
                      <p className="text-[9px] font-black text-emerald-400 uppercase mb-1">Borne Haute ({acc.recentHighRate}%)</p>
                      <div className="text-sm font-black text-emerald-600">+{acc.highInterestNet?.toLocaleString()} €</div>
                      <p className="text-[9px] text-slate-400">Dont moi : {acc.highOwned}€</p>
                    </div>
                  </div>
                ) : (
                  <div className="bg-white p-3 rounded-xl border border-slate-200 text-center">
                    <p className="text-[9px] font-black text-slate-400 uppercase mb-1">Taux Fixe Unifié</p>
                    <div className="text-sm font-black text-slate-700">+{acc.totalInterest.toLocaleString()} €</div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="bg-slate-900 p-8 rounded-3xl text-white">
        <h5 className="font-black text-indigo-400 mb-4 flex items-center gap-2"><DollarSign className="w-5 h-5" /> Note sur la fiscalité appliquée</h5>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 text-xs text-slate-400 font-medium leading-relaxed">
          <p>
            Pour les enveloppes <strong>AV, PEA, PEE et PER</strong>, les prélèvements sociaux de 17,2% sont automatiquement calculés et déduits sur chaque euro d'intérêt généré, que ce soit pour le taux actuel ou les bornes de la fourchette.
          </p>
          <p>
            Les livrets réglementés (Livret A, LDDS, LEP) ne subissent aucune déduction fiscale. Pour ces comptes, les bornes de fourchette (si renseignées) sont affichées en brut qui équivaut au net.
          </p>
        </div>
      </div>
    </div>
  );
};
