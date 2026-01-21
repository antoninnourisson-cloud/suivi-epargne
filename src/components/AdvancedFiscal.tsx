import React, { useMemo } from 'react';
import { SavingsAccount, AccountType } from '../types';
import { Scale, TrendingUp, ShieldCheck, Clock, Percent, Info, ArrowUpRight } from 'lucide-react';

interface AdvancedFiscalProps {
  accounts: SavingsAccount[];
  grossAnnual: number;
}

export const AdvancedFiscal: React.FC<AdvancedFiscalProps> = ({ accounts, grossAnnual }) => {
  
  // --- CALCUL TMI (Marginal Tax Rate) ---
  const tmiResults = useMemo(() => {
    const netImposable = grossAnnual * 0.9; // Abattement forfaitaire 10%
    const tranches = [
      { limit: 11294, rate: 0 },
      { limit: 28797, rate: 0.11 },
      { limit: 82341, rate: 0.30 },
      { limit: 177106, rate: 0.41 },
      { limit: Infinity, rate: 0.45 }
    ];

    let tmi = 0;
    for (const t of tranches) {
      if (netImposable > t.limit) {
        continue;
      } else {
        tmi = t.rate * 100;
        break;
      }
    }
    return { tmi, netImposable };
  }, [grossAnnual]);

  // --- ANALYSE ASSURANCE VIE ---
  const avOptimization = useMemo(() => {
    const today = new Date();
    return accounts
      .filter(a => a.type === AccountType.ASSURANCE_VIE)
      .map(acc => {
        if (!acc.openingDate) return null;
        const open = new Date(acc.openingDate);
        const diffYears = (today.getTime() - open.getTime()) / (1000 * 3600 * 24 * 365.25);
        const isMature = diffYears >= 8;
        const yearsTo8 = Math.max(0, 8 - diffYears);
        
        return {
          ...acc,
          age: diffYears.toFixed(1),
          isMature,
          yearsTo8: yearsTo8.toFixed(1),
          fiscalRegime: isMature ? "Abattement 4600€ + PFU 24.7%" : "PFU Flat Tax 30%",
          gainLevier: isMature ? "Exonération partielle" : "Plein impôt"
        };
      }).filter(Boolean);
  }, [accounts]);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* SECTION TMI */}
        <div className="lg:col-span-2 bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
          <h3 className="text-xl font-black text-slate-800 mb-6 flex items-center gap-2">
            <Scale className="w-6 h-6 text-indigo-600" /> Taux Marginal d'Imposition (TMI)
          </h3>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-slate-900 rounded-2xl p-6 text-white">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Votre Tranche 2024</p>
              <div className="text-5xl font-black text-indigo-400">{tmiResults.tmi}%</div>
              <p className="text-xs text-slate-500 mt-4 leading-relaxed">
                Le TMI est le taux auquel est imposé votre dernier euro gagné. 
                C'est votre levier principal pour la défiscalisation.
              </p>
            </div>

            <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-6">
              <h4 className="font-bold text-indigo-900 flex items-center gap-2 mb-4">
                <ArrowUpRight className="w-5 h-5" /> Gain Fiscal PER / Tranche
              </h4>
              <p className="text-[10px] text-indigo-700 font-black uppercase mb-3">Pour chaque 1 000 € versés :</p>
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-indigo-800">Économie d'impôt réelle</span>
                  <span className="text-xl font-black text-emerald-600">+{Math.round(1000 * (tmiResults.tmi / 100))} €</span>
                </div>
                <div className="flex justify-between items-center border-t border-indigo-200 pt-2">
                  <span className="text-sm text-indigo-800">Coût net de l'effort</span>
                  <span className="text-xl font-black text-slate-800">{1000 - Math.round(1000 * (tmiResults.tmi / 100))} €</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* SECTION AV ALERTE */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
          <h3 className="text-lg font-black text-slate-800 mb-4 flex items-center gap-2">
            <Clock className="w-5 h-5 text-indigo-600" /> Maturité Assurance Vie
          </h3>
          <div className="space-y-4">
            {avOptimization.length > 0 ? avOptimization.map((av: any) => (
              <div key={av.id} className={`p-4 rounded-xl border ${av.isMature ? 'bg-emerald-50 border-emerald-100' : 'bg-slate-50 border-slate-200'}`}>
                <div className="flex justify-between items-start mb-2">
                  <span className="font-bold text-slate-900">{av.name}</span>
                  {av.isMature ? (
                    <span className="bg-emerald-500 text-white text-[8px] px-2 py-0.5 rounded-full font-black">MATURE</span>
                  ) : (
                    <span className="bg-amber-500 text-white text-[8px] px-2 py-0.5 rounded-full font-black">J-{av.yearsTo8} ANS</span>
                  )}
                </div>
                <div className="text-[10px] font-bold text-slate-500 mb-2 uppercase">{av.age} ans d'ancienneté</div>
                <div className="flex items-center gap-2 text-[10px] text-indigo-600 font-bold">
                  <ShieldCheck className="w-3 h-3" /> {av.fiscalRegime}
                </div>
              </div>
            )) : (
              <p className="text-xs text-slate-400 italic">Aucun contrat d'Assurance Vie détecté pour le calcul d'antériorité.</p>
            )}
          </div>
        </div>
      </div>

      <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
        <h3 className="text-lg font-black text-slate-800 mb-4 flex items-center gap-2">
          <Percent className="w-5 h-5 text-indigo-600" /> Détails des Prélèvements Sociaux
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
          <p className="text-sm text-slate-500 leading-relaxed">
            Indépendamment de l'impôt sur le revenu (le TMI), vos gains sont soumis aux <strong>prélèvements sociaux de 17,2%</strong>. 
            Dans une Assurance Vie de plus de 8 ans, après abattement de 4 600€, votre taux global descend à <strong>24,7%</strong> (17,2% sociaux + 7,5% impôts).
          </p>
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-slate-50 p-4 rounded-xl text-center">
              <p className="text-[10px] text-slate-400 font-bold uppercase mb-1">Flat Tax (PFU)</p>
              <p className="text-2xl font-black text-slate-800">30%</p>
            </div>
            <div className="bg-emerald-50 p-4 rounded-xl text-center">
              <p className="text-[10px] text-emerald-600 font-bold uppercase mb-1">Taux Réduit {'>'} 8 ans</p>
              <p className="text-2xl font-black text-emerald-700">24,7%</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
