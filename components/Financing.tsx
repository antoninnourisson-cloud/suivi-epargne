import React, { useState, useMemo, useEffect } from 'react';
import { Expense } from '../types';
import { Home, Calculator, AlertCircle, Info, TrendingUp } from 'lucide-react';

interface FinancingProps {
  expenses: Expense[];
  grossAnnual: number;
}

export const Financing: React.FC<FinancingProps> = ({ expenses, grossAnnual }) => {
  const [interestRate, setInterestRate] = useState<number>(() => {
    const s = localStorage.getItem('financing_interest');
    return s ? parseFloat(s) : 3.5;
  });

  const [insuranceRate, setInsuranceRate] = useState<number>(() => {
    const s = localStorage.getItem('financing_insurance');
    return s ? parseFloat(s) : 0.3;
  });

  useEffect(() => {
    localStorage.setItem('financing_interest', interestRate.toString());
  }, [interestRate]);

  useEffect(() => {
    localStorage.setItem('financing_insurance', insuranceRate.toString());
  }, [insuranceRate]);

  const CHARGES_RATE = 0.22;
  const netMonthly = (grossAnnual * (1 - CHARGES_RATE)) / 12;
  const totalFixedCharges = expenses.reduce((sum, e) => sum + e.amount, 0);

  // Formule HCSF : (35% * Revenus) - Charges existantes
  const maxMonthlyPayment = useMemo(() => {
    return Math.max(0, (netMonthly * 0.35) - totalFixedCharges);
  }, [netMonthly, totalFixedCharges]);

  const resteAVivre = netMonthly - totalFixedCharges - maxMonthlyPayment;
  const isSecurityAlert = resteAVivre < 800;

  const calculateCapacity = (years: number) => {
    const months = years * 12;
    const monthlyRate = (interestRate + insuranceRate) / 100 / 12;
    if (monthlyRate === 0) return maxMonthlyPayment * months;
    // Formule Capital : C = M * (1 - (1+i)^-n) / i
    const capital = maxMonthlyPayment * (1 - Math.pow(1 + monthlyRate, -months)) / monthlyRate;
    return Math.floor(capital);
  };

  const capacities = [
    { label: '15 ans', value: calculateCapacity(15) },
    { label: '20 ans', value: calculateCapacity(20) },
    { label: '25 ans', value: calculateCapacity(25) }
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
        <h3 className="text-xl font-black text-slate-800 mb-6 flex items-center gap-2">
          <Home className="w-6 h-6 text-indigo-600" /> Capacité d'Emprunt Immobilière
        </h3>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1 space-y-4">
            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
              <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Paramètres du prêt</label>
              <div className="space-y-3">
                <div>
                  <span className="text-xs text-slate-500">Taux d'intérêt : {interestRate}%</span>
                  <input type="range" min="1" max="6" step="0.1" value={interestRate} onChange={e => setInterestRate(parseFloat(e.target.value))} className="w-full accent-indigo-600" />
                </div>
                <div>
                  <span className="text-xs text-slate-500">Assurance : {insuranceRate}%</span>
                  <input type="range" min="0.1" max="1" step="0.05" value={insuranceRate} onChange={e => setInsuranceRate(parseFloat(e.target.value))} className="w-full accent-indigo-600" />
                </div>
              </div>
            </div>

            <div className={`p-4 rounded-xl border ${isSecurityAlert ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-emerald-50 border-emerald-200 text-emerald-800'}`}>
              <p className="text-[10px] font-bold uppercase mb-1">Reste à vivre (Post-crédit)</p>
              <div className="text-xl font-black">{Math.floor(resteAVivre)} € / mois</div>
              {isSecurityAlert && (
                <p className="text-[10px] mt-2 flex items-center gap-1 font-bold">
                  <AlertCircle className="w-3 h-3" /> Attention : Seuil de sécurité de 800€ atteint.
                </p>
              )}
            </div>
          </div>

          <div className="lg:col-span-2 grid grid-cols-1 md:grid-cols-3 gap-4">
            {capacities.map(cap => (
              <div key={cap.label} className="bg-indigo-600 text-white p-6 rounded-2xl shadow-lg relative overflow-hidden group">
                <div className="absolute -right-4 -top-4 opacity-10 group-hover:scale-110 transition-transform">
                  <Calculator className="w-24 h-24" />
                </div>
                <p className="text-xs font-bold text-indigo-100 uppercase">{cap.label}</p>
                <div className="text-2xl font-black mt-2">
                  {new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(cap.value)}
                </div>
                <div className="mt-4 pt-4 border-t border-indigo-500 text-[10px] uppercase font-bold text-indigo-200">
                  Mensualité : {Math.floor(maxMonthlyPayment)} €
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="bg-slate-900 text-white p-6 rounded-2xl border border-slate-800 flex flex-col md:flex-row items-center gap-6">
        <div className="p-4 bg-indigo-500 rounded-2xl"><Info className="w-8 h-8" /></div>
        <div>
          <h4 className="font-bold text-lg mb-1">Comprendre mon financement</h4>
          <p className="text-slate-400 text-sm">
            Ce calcul respecte les normes <strong>HCSF</strong> (35% d'endettement maximum). 
            Vos charges fixes de {Math.floor(totalFixedCharges)}€ sont déjà déduites de votre capacité de remboursement.
          </p>
        </div>
      </div>
    </div>
  );
};