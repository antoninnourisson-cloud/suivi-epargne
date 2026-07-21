import React, { useMemo } from 'react';
import { SavingsAccount } from '../types';
import { Users, User } from 'lucide-react';

interface ParentalShareProps {
  accounts: SavingsAccount[];
}

const fmt = (n: number) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);

export const ParentalShare: React.FC<ParentalShareProps> = ({ accounts }) => {
  const { totalOwned, totalParental, rows } = useMemo(() => {
    const rows = accounts
      .filter(a => a.parentalCapital > 0 || a.ownedAmount > 0)
      .map(a => ({ id: a.id, name: a.name, type: a.type, owned: a.ownedAmount, parental: a.parentalCapital, total: a.totalAmount }))
      .sort((x, y) => y.parental - x.parental);
    return {
      totalOwned: accounts.reduce((s, a) => s + a.ownedAmount, 0),
      totalParental: accounts.reduce((s, a) => s + a.parentalCapital, 0),
      rows,
    };
  }, [accounts]);

  const grand = totalOwned + totalParental;
  const ownedPct = grand > 0 ? (totalOwned / grand) * 100 : 0;

  return (
    <div className="space-y-6 animate-fade-in pb-20">
      <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm">
        <h2 className="text-2xl font-black text-slate-800 dark:text-slate-100 flex items-center gap-2 mb-1"><Users className="w-6 h-6 text-indigo-600" /> Part parentale</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">Distingue ton capital réel de l'argent géré pour tes parents.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-6 rounded-2xl">
          <p className="text-slate-400 dark:text-slate-500 text-xs font-bold uppercase mb-1 flex items-center gap-2"><User className="w-4 h-4 text-indigo-600" /> Mon capital</p>
          <p className="text-4xl font-black text-indigo-600">{fmt(totalOwned)}</p>
        </div>
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-6 rounded-2xl">
          <p className="text-slate-400 dark:text-slate-500 text-xs font-bold uppercase mb-1 flex items-center gap-2"><Users className="w-4 h-4 text-amber-500" /> Capital parents</p>
          <p className="text-4xl font-black text-amber-500">{fmt(totalParental)}</p>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm">
        <div className="flex justify-between text-xs font-bold mb-2">
          <span className="text-indigo-600">Moi {ownedPct.toFixed(0)}%</span>
          <span className="text-amber-500">Parents {(100 - ownedPct).toFixed(0)}%</span>
        </div>
        <div className="w-full h-4 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden flex">
          <div className="h-full bg-indigo-600" style={{ width: `${ownedPct}%` }} />
          <div className="h-full bg-amber-400" style={{ width: `${100 - ownedPct}%` }} />
        </div>
        <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-2">Total géré : {fmt(grand)}</p>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700">
            <tr>
              <th className="px-6 py-3 text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase">Compte</th>
              <th className="px-6 py-3 text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase text-right">Moi</th>
              <th className="px-6 py-3 text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase text-right">Parents</th>
              <th className="px-6 py-3 text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase w-1/3">Répartition</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {rows.map(r => {
              const pct = r.total > 0 ? (r.owned / r.total) * 100 : 0;
              return (
                <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-800">
                  <td className="px-6 py-3"><div className="font-bold text-slate-800 dark:text-slate-100">{r.name}</div><div className="text-[10px] uppercase text-slate-400 dark:text-slate-500 font-bold">{r.type}</div></td>
                  <td className="px-6 py-3 text-right font-mono text-indigo-600">{fmt(r.owned)}</td>
                  <td className="px-6 py-3 text-right font-mono text-amber-500">{fmt(r.parental)}</td>
                  <td className="px-6 py-3">
                    <div className="w-full h-2.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden flex">
                      <div className="h-full bg-indigo-600" style={{ width: `${pct}%` }} />
                      <div className="h-full bg-amber-400" style={{ width: `${100 - pct}%` }} />
                    </div>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={4} className="px-6 py-8 text-center text-slate-400 dark:text-slate-500 italic">Aucun compte à afficher.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
};
