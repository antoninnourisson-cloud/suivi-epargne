import React, { useMemo, useState } from 'react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend } from 'recharts';
import { PortfolioSnapshot, ExpenseSnapshot } from '../types';
import { LineChart as LineChartIcon, ArrowUpRight, ArrowDownRight, Minus, Wallet, Receipt } from 'lucide-react';

interface HistoryProps {
  history: PortfolioSnapshot[];
  expensesHistory: ExpenseSnapshot[];
}

const fmt = (n: number) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);
const monthLabel = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' });
};

export const History: React.FC<HistoryProps> = ({ history, expensesHistory }) => {
  const [tab, setTab] = useState<'patrimoine' | 'charges'>('patrimoine');
  const sorted = useMemo(() => [...history].sort((a, b) => a.date.localeCompare(b.date)), [history]);
  const chartData = sorted.map(s => ({ ...s, label: monthLabel(s.date) }));

  const expensesSorted = useMemo(() => [...expensesHistory].sort((a, b) => a.date.localeCompare(b.date)), [expensesHistory]);
  const expensesChartData = expensesSorted.map(s => ({ ...s, label: monthLabel(s.date) }));

  const deltas = useMemo(() => {
    const rows: { date: string; total: number; owned: number; deltaTotal: number | null }[] = [];
    sorted.forEach((s, i) => {
      const prev = i > 0 ? sorted[i - 1] : null;
      rows.push({ date: s.date, total: s.totalAmount, owned: s.ownedAmount, deltaTotal: prev ? s.totalAmount - prev.totalAmount : null });
    });
    return rows.reverse();
  }, [sorted]);

  const latest = sorted[sorted.length - 1];
  const first = sorted[0];
  const totalGrowth = latest && first ? latest.totalAmount - first.totalAmount : 0;

  return (
    <div className="space-y-6 animate-fade-in pb-20">
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
        <h2 className="text-2xl font-black text-slate-800 flex items-center gap-2 mb-1"><LineChartIcon className="w-6 h-6 text-indigo-600" /> Historique du patrimoine</h2>
        <p className="text-sm text-slate-500">Un point est enregistré chaque mois automatiquement.</p>
      </div>

      <div className="flex gap-4 border-b border-slate-200">
        <button onClick={() => setTab('patrimoine')} className={`pb-2 px-4 font-bold text-sm flex items-center gap-2 ${tab === 'patrimoine' ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-slate-400'}`}><Wallet className="w-4 h-4" /> Patrimoine</button>
        <button onClick={() => setTab('charges')} className={`pb-2 px-4 font-bold text-sm flex items-center gap-2 ${tab === 'charges' ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-slate-400'}`}><Receipt className="w-4 h-4" /> Charges fixes</button>
      </div>

      {tab === 'patrimoine' && (
      <>
      {sorted.length < 2 ? (
        <div className="text-center py-16 text-slate-400 bg-white rounded-2xl border border-slate-200">
          L'historique se construit au fil des mois. Reviens après quelques actualisations pour voir la courbe évoluer.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white p-5 rounded-2xl border border-slate-200"><p className="text-[10px] font-black text-slate-400 uppercase">Total actuel</p><p className="text-2xl font-black text-slate-800">{fmt(latest.totalAmount)}</p></div>
            <div className="bg-white p-5 rounded-2xl border border-slate-200"><p className="text-[10px] font-black text-slate-400 uppercase">Ma part actuelle</p><p className="text-2xl font-black text-indigo-600">{fmt(latest.ownedAmount)}</p></div>
            <div className="bg-white p-5 rounded-2xl border border-slate-200"><p className="text-[10px] font-black text-slate-400 uppercase">Évolution depuis {monthLabel(first.date)}</p><p className={`text-2xl font-black ${totalGrowth >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{totalGrowth >= 0 ? '+' : ''}{fmt(totalGrowth)}</p></div>
          </div>

          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm h-96">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="gTotal" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#6366f1" stopOpacity={0.6} /><stop offset="95%" stopColor="#6366f1" stopOpacity={0.05} /></linearGradient>
                  <linearGradient id="gOwned" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#10b981" stopOpacity={0.6} /><stop offset="95%" stopColor="#10b981" stopOpacity={0.05} /></linearGradient>
                </defs>
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 11 }} />
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <RechartsTooltip formatter={(v: number, name: string) => [fmt(v), name === 'totalAmount' ? 'Total' : 'Ma part']} contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                <Legend formatter={(v) => (v === 'totalAmount' ? 'Total' : 'Ma part')} wrapperStyle={{ fontSize: 12 }} />
                <Area type="monotone" dataKey="totalAmount" stroke="#6366f1" fill="url(#gTotal)" strokeWidth={2} />
                <Area type="monotone" dataKey="ownedAmount" stroke="#10b981" fill="url(#gOwned)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-6 py-3 text-[10px] font-black text-slate-400 uppercase">Mois</th>
                  <th className="px-6 py-3 text-[10px] font-black text-slate-400 uppercase text-right">Total</th>
                  <th className="px-6 py-3 text-[10px] font-black text-slate-400 uppercase text-right">Ma part</th>
                  <th className="px-6 py-3 text-[10px] font-black text-slate-400 uppercase text-right">Variation</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {deltas.map(r => (
                  <tr key={r.date} className="hover:bg-slate-50">
                    <td className="px-6 py-3 font-bold text-slate-700">{monthLabel(r.date)}</td>
                    <td className="px-6 py-3 text-right font-mono text-slate-600">{fmt(r.total)}</td>
                    <td className="px-6 py-3 text-right font-mono text-indigo-600">{fmt(r.owned)}</td>
                    <td className="px-6 py-3 text-right font-bold">
                      {r.deltaTotal === null ? <span className="text-slate-300">—</span> :
                        r.deltaTotal > 0 ? <span className="text-emerald-600 inline-flex items-center gap-1 justify-end"><ArrowUpRight className="w-3.5 h-3.5" />{fmt(r.deltaTotal)}</span> :
                        r.deltaTotal < 0 ? <span className="text-rose-600 inline-flex items-center gap-1 justify-end"><ArrowDownRight className="w-3.5 h-3.5" />{fmt(r.deltaTotal)}</span> :
                        <span className="text-slate-400 inline-flex items-center gap-1 justify-end"><Minus className="w-3.5 h-3.5" />0</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      </>
      )}

      {tab === 'charges' && (
        expensesSorted.length < 2 ? (
          <div className="text-center py-16 text-slate-400 bg-white rounded-2xl border border-slate-200">
            L'historique des charges se construit au fil des mois, à mesure que tu ajustes tes dépenses fixes.
          </div>
        ) : (
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm h-96">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={expensesChartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="gCharges" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#ef4444" stopOpacity={0.5} /><stop offset="95%" stopColor="#ef4444" stopOpacity={0.05} /></linearGradient>
                </defs>
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={(v) => `${v}€`} tick={{ fontSize: 11 }} />
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <RechartsTooltip formatter={(v: number) => [fmt(v), 'Charges fixes']} contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                <Area type="monotone" dataKey="total" stroke="#ef4444" fill="url(#gCharges)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )
      )}
    </div>
  );
};
