import React, { useMemo, useState } from 'react';
import { PortfolioSnapshot, ExpenseSnapshot } from '../types';
import { parseISODate } from '../lib/dates';
import { LineChart as LineChartIcon, ArrowUpRight, ArrowDownRight, Minus, Wallet, Receipt } from 'lucide-react';
import { formatEUR } from '../lib/format';
import { YearReviewCard } from './YearReviewCard';
import { YearInReviewCard } from './year/YearInReviewCard';
import type { GlobalAppData } from '../types';
import { useIsDark, chartTheme } from '../lib/chartTheme';
import { describeEvolution } from '../lib/chartData';
import { AreaSeriesChart, type AreaRow, type AreaSeries } from './charts/AreaSeriesChart';
import { ChartFrame } from './charts/ChartFrame';
import { ChartLegend } from './charts/ChartParts';
import { DataTable, type Column } from './ui/DataTable';
import { onTablistKeyDown } from '../lib/tablist';

interface HistoryProps {
  history: PortfolioSnapshot[];
  expensesHistory: ExpenseSnapshot[];
  // Données complètes, pour le bilan annuel (facultatif).
  reviewData?: GlobalAppData;
}

const fmt = (n: number) => formatEUR(n, 0);
const monthLabel = (iso: string) => {
  const d = parseISODate(iso); // parse LOCAL : new Date('YYYY-MM-DD') est minuit UTC et decale le mois affiche
  return d.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' });
};
const monthLong = (iso: string) => parseISODate(iso).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

export const History: React.FC<HistoryProps> = ({ history, expensesHistory, reviewData }) => {
  const t = chartTheme(useIsDark());
  const [tab, setTab] = useState<'patrimoine' | 'charges'>('patrimoine');
  const sorted = useMemo(() => [...history].sort((a, b) => a.date.localeCompare(b.date)), [history]);
  // Votre part (sapin) + capital de vos parents (or), empilés : leur somme est le total.
  const chartData = useMemo<AreaRow[]>(() => sorted.map(s => ({
    label: monthLabel(s.date), title: monthLong(s.date), date: s.date,
    owned: s.ownedAmount, parents: Math.max(0, s.totalAmount - s.ownedAmount),
  })), [sorted]);
  const wealthSeries: AreaSeries[] = [
    { key: 'owned', label: 'Votre part', color: t.brand },
    { key: 'parents', label: 'Capital de vos parents', color: t.gold },
  ];
  const showParents = sorted.some(s => s.totalAmount - s.ownedAmount > 0.5);
  const wealthColumns: Column<PortfolioSnapshot>[] = [
    { key: 'date', header: 'Mois', cell: r => monthLong(r.date) },
    { key: 'owned', header: 'Votre part', numeric: true, cell: r => fmt(r.ownedAmount) },
    ...(showParents ? [{ key: 'parents', header: 'Capital de vos parents', numeric: true, cell: (r: PortfolioSnapshot) => fmt(Math.max(0, r.totalAmount - r.ownedAmount)) }] : []),
    { key: 'total', header: 'Total', numeric: true, cell: r => fmt(r.totalAmount) },
  ];

  const expensesSorted = useMemo(() => [...expensesHistory].sort((a, b) => a.date.localeCompare(b.date)), [expensesHistory]);
  const expensesChartData = useMemo<AreaRow[]>(() => expensesSorted.map(s => ({ label: monthLabel(s.date), title: monthLong(s.date), total: s.total })), [expensesSorted]);
  const expensesColumns: Column<ExpenseSnapshot>[] = [
    { key: 'date', header: 'Mois', cell: r => monthLong(r.date) },
    { key: 'total', header: 'Charges fixes', numeric: true, cell: r => fmt(r.total) },
  ];

  const deltas = useMemo(() => {
    const rows: { date: string; total: number; owned: number; deltaTotal: number | null; monthsGap: number }[] = [];
    sorted.forEach((s, i) => {
      const prev = i > 0 ? sorted[i - 1] : null;
      // Écart réel en mois avec le point précédent : un trou dans la série (app non
      // ouverte pendant un trimestre) était présenté comme la variation d'UN mois.
      const monthsGap = prev
        ? Math.max(1, Math.round((parseISODate(s.date).getTime() - parseISODate(prev.date).getTime()) / (1000 * 3600 * 24 * 30.4375)))
        : 1;
      rows.push({ date: s.date, total: s.totalAmount, owned: s.ownedAmount, deltaTotal: prev ? s.totalAmount - prev.totalAmount : null, monthsGap });
    });
    return rows.reverse();
  }, [sorted]);

  const latest = sorted[sorted.length - 1];
  const first = sorted[0];
  const totalGrowth = latest && first ? latest.totalAmount - first.totalAmount : 0;

  return (
    <div className="space-y-6 animate-fade-in pb-20">
      <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-xs">
        <h2 className="text-2xl font-black text-slate-800 dark:text-slate-100 flex items-center gap-2 mb-1"><LineChartIcon className="w-6 h-6 text-indigo-600" aria-hidden="true" /> Historique du patrimoine</h2>
        <p className="text-sm text-slate-600 dark:text-slate-300">Un point est enregistré chaque mois automatiquement.</p>
      </div>
      {/* « Votre année » (récapitulatif raconté) ; motivation désactivée : on garde aussi
          le bilan en chiffres bruts, comme avant. */}
      {reviewData && <YearInReviewCard data={reviewData} />}
      {reviewData && reviewData.config?.gamification === false && <YearReviewCard data={reviewData} />}

      <div role="tablist" onKeyDown={onTablistKeyDown} aria-label="Historique" className="flex gap-4 border-b border-slate-200 dark:border-slate-700">
        <button role="tab" aria-selected={tab === 'patrimoine'} tabIndex={tab === 'patrimoine' ? 0 : -1} onClick={() => setTab('patrimoine')} className={`pb-2 px-4 font-bold text-sm flex items-center gap-2 ${tab === 'patrimoine' ? 'text-indigo-700 dark:text-indigo-300 border-b-2 border-indigo-600' : 'text-slate-600 dark:text-slate-300'}`}><Wallet className="w-4 h-4" /> Patrimoine</button>
        <button role="tab" aria-selected={tab === 'charges'} tabIndex={tab === 'charges' ? 0 : -1} onClick={() => setTab('charges')} className={`pb-2 px-4 font-bold text-sm flex items-center gap-2 ${tab === 'charges' ? 'text-indigo-700 dark:text-indigo-300 border-b-2 border-indigo-600' : 'text-slate-600 dark:text-slate-300'}`}><Receipt className="w-4 h-4" /> Charges fixes</button>
      </div>

      {tab === 'patrimoine' && (
      <>
      {/* Un seul point : les cartes de synthèse sont déjà pertinentes — les masquer avec
          tout le reste cachait "Total actuel"/"Ma part" parfaitement définis. Seuls la
          courbe et le tableau exigent >= 2 points. */}
      {sorted.length >= 1 && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200 dark:border-slate-700"><p className="text-[11px] font-black text-slate-500 dark:text-slate-400 uppercase">Total actuel</p><p className="text-2xl font-black text-slate-800 dark:text-slate-100">{fmt(latest.totalAmount)}</p></div>
            <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200 dark:border-slate-700"><p className="text-[11px] font-black text-slate-500 dark:text-slate-400 uppercase">Ma part actuelle</p><p className="text-2xl font-black text-indigo-600">{fmt(latest.ownedAmount)}</p></div>
            <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200 dark:border-slate-700"><p className="text-[11px] font-black text-slate-500 dark:text-slate-400 uppercase">Évolution depuis {monthLabel(first.date)}</p><p className={`text-2xl font-black ${totalGrowth >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{totalGrowth >= 0 ? '+' : ''}{fmt(totalGrowth)}</p></div>
          </div>
      )}
      {sorted.length < 2 ? (
        <div className="text-center py-16 text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700">
          L'historique se construit au fil des mois. Revenez après quelques actualisations pour voir la courbe évoluer.
        </div>
      ) : (
        <>

          <section aria-labelledby="history-chart-title" className="bg-surface-container-lowest dark:bg-surface-container-low p-5 sm:p-6 rounded-2xl border border-outline-variant">
            <h3 id="history-chart-title" className="text-base font-medium text-on-surface mb-2">Évolution de votre patrimoine</h3>
            <ChartFrame
              chartClassName="h-72 sm:h-80"
              summary={<>
                {describeEvolution('Votre part', first.ownedAmount, latest.ownedAmount, first.date, latest.date)}
                {showParents && ` Avec le capital de vos parents, le total atteint ${fmt(latest.totalAmount)}.`}
              </>}
              legend={showParents ? <ChartLegend label={`Valeurs de ${monthLong(latest.date)}`} items={[
                { key: 'owned', label: 'Votre part', color: t.brand, value: fmt(latest.ownedAmount) },
                { key: 'parents', label: 'Capital de vos parents', color: t.gold, value: fmt(Math.max(0, latest.totalAmount - latest.ownedAmount)) },
              ]} /> : undefined}
              table={<DataTable caption="Votre patrimoine mois par mois" columns={wealthColumns} rows={sorted} rowKey={r => r.date} />}
            >
              <AreaSeriesChart data={chartData} series={showParents ? wealthSeries : wealthSeries.slice(0, 1)} stacked={showParents} totalLabel={showParents ? 'Total' : undefined} />
            </ChartFrame>
          </section>

          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm sm:min-w-136">
                <thead className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700">
                  <tr>
                    <th className="px-3 sm:px-6 py-3 text-[11px] font-black text-slate-500 dark:text-slate-400 uppercase">Mois</th>
                    <th className="hidden sm:table-cell px-6 py-3 text-[11px] font-black text-slate-500 dark:text-slate-400 uppercase text-right">Total</th>
                    <th className="px-3 sm:px-6 py-3 text-[11px] font-black text-slate-500 dark:text-slate-400 uppercase text-right">Ma part</th>
                    <th className="px-3 sm:px-6 py-3 text-[11px] font-black text-slate-500 dark:text-slate-400 uppercase text-right">Variation</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {deltas.map(r => (
                    <tr key={r.date} className="hover:bg-slate-50 dark:hover:bg-slate-800">
                      <td className="px-3 sm:px-6 py-3 font-bold text-slate-700 dark:text-slate-200">{monthLabel(r.date)}</td>
                      <td className="hidden sm:table-cell px-6 py-3 text-right font-mono text-slate-600 dark:text-slate-300">{fmt(r.total)}</td>
                      <td className="px-3 sm:px-6 py-3 text-right font-mono text-indigo-600">{fmt(r.owned)}</td>
                      <td className="px-3 sm:px-6 py-3 text-right font-bold">
                        {r.deltaTotal === null ? <span className="text-slate-300">—</span> :
                          r.deltaTotal > 0 ? <span className="text-emerald-700 dark:text-emerald-400 inline-flex items-center gap-1 justify-end"><ArrowUpRight className="w-3.5 h-3.5" />{fmt(r.deltaTotal)}</span> :
                          r.deltaTotal < 0 ? <span className="text-rose-700 inline-flex items-center gap-1 justify-end"><ArrowDownRight className="w-3.5 h-3.5" />{fmt(r.deltaTotal)}</span> :
                          <span className="text-slate-500 dark:text-slate-400 inline-flex items-center gap-1 justify-end"><Minus className="w-3.5 h-3.5" />0</span>}
                        {r.deltaTotal !== null && r.monthsGap > 1 && (
                          <span className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 normal-case">sur {r.monthsGap} mois</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
      </>
      )}

      {tab === 'charges' && (
        expensesSorted.length < 2 ? (
          <div className="text-center py-16 text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700">
            L'historique des charges se construit au fil des mois, à mesure que vous ajustez vos dépenses fixes.
          </div>
        ) : (
          <section aria-labelledby="charges-chart-title" className="bg-surface-container-lowest dark:bg-surface-container-low p-5 sm:p-6 rounded-2xl border border-outline-variant">
            <h3 id="charges-chart-title" className="text-base font-medium text-on-surface mb-2">Évolution de vos charges fixes</h3>
            <ChartFrame
              chartClassName="h-72 sm:h-80"
              summary={describeEvolution('Vos charges fixes', expensesSorted[0].total, expensesSorted[expensesSorted.length - 1].total, expensesSorted[0].date, expensesSorted[expensesSorted.length - 1].date, 'fp')}
              table={<DataTable caption="Vos charges fixes mois par mois" columns={expensesColumns} rows={expensesSorted} rowKey={r => r.date} />}
            >
              <AreaSeriesChart data={expensesChartData} series={[{ key: 'total', label: 'Charges fixes', color: t.terracotta }]} />
            </ChartFrame>
          </section>
        )
      )}
    </div>
  );
};
