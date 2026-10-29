// ================================================
// FILE: src/components/History.tsx
// Historique : « Votre année » (le seul bilan annuel), puis deux onglets, l'évolution du
// patrimoine (un relevé par mois) et celle des charges fixes.
// ================================================
import React, { useMemo, useState } from 'react';
import { PortfolioSnapshot, ExpenseSnapshot } from '../types';
import { parseISODate } from '../lib/dates';
import { LineChart as LineChartIcon, Wallet, Receipt } from 'lucide-react';
import { elideDe, formatEUR } from '../lib/format';
import { YearInReviewCard } from './year/YearInReviewCard';
import type { GlobalAppData } from '../types';
import { useIsDark, chartTheme } from '../lib/chartTheme';
import { describeEvolution } from '../lib/chartData';
import { AreaSeriesChart, type AreaRow, type AreaSeries } from './charts/AreaSeriesChart';
import { ChartFrame } from './charts/ChartFrame';
import { ChartLegend } from './charts/ChartParts';
import { Card, DataTable, EmptyState, MoneyText, PageHeader, StatTile, Tabs, type Column } from './ui';

interface HistoryProps {
  history: PortfolioSnapshot[];
  expensesHistory: ExpenseSnapshot[];
  // Données complètes, pour le bilan annuel (facultatif).
  reviewData?: GlobalAppData;
  // Clôture de l'année écoulée (year/YearClosingCard), en tête de l'écran.
  closingSlot?: React.ReactNode;
}

type Tab = 'patrimoine' | 'charges';
const TABS: { value: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { value: 'patrimoine', label: 'Patrimoine', icon: Wallet },
  { value: 'charges', label: 'Charges fixes', icon: Receipt },
];

interface DeltaRow { date: string; total: number; owned: number; deltaTotal: number | null; deltaOwned: number | null; monthsGap: number }

const fmt = (n: number) => formatEUR(n, 0);
// Formateurs créés une fois (toLocaleDateString en recrée un à chaque appel, pour chaque point).
const MONTH_SHORT = new Intl.DateTimeFormat('fr-FR', { month: 'short', year: '2-digit' });
const MONTH_LONG = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' });
// parse LOCAL : new Date('YYYY-MM-DD') est minuit UTC et décale le mois affiché.
const monthLabel = (iso: string) => MONTH_SHORT.format(parseISODate(iso));
const monthLong = (iso: string) => MONTH_LONG.format(parseISODate(iso));

/** Variation d'un mois (« — » pour le premier point), précisée quand elle couvre plusieurs mois. */
const deltaCell = (value: number | null, monthsGap: number) => value === null
  ? <span className="text-on-surface-variant">—</span>
  : <>
    <MoneyText value={value} decimals={0} signed tone="auto" />
    {monthsGap > 1 && <span className="block text-xs text-on-surface-variant">sur {monthsGap} mois</span>}
  </>;

// Tableau « mois par mois » : le total est masqué sur téléphone (quatre colonnes ne tiennent
// pas dans 320 px). La variation suit la colonne visible : celle de votre part sur téléphone,
// celle du total (parents compris) sur ordinateur, à côté de la colonne Total. Sinon, le mois
// de la restitution, −9 500 € s'afficheraient à côté d'une « Votre part » stable.
const DELTA_COLUMNS: Column<DeltaRow>[] = [
  { key: 'date', header: 'Mois', cell: r => monthLabel(r.date) },
  { key: 'total', header: 'Total', numeric: true, className: 'max-sm:hidden', cell: r => fmt(r.total) },
  { key: 'owned', header: 'Votre part', numeric: true, cell: r => fmt(r.owned) },
  { key: 'deltaOwned', header: 'Variation de votre part', numeric: true, className: 'sm:hidden', cell: r => deltaCell(r.deltaOwned, r.monthsGap) },
  { key: 'delta', header: 'Variation du total', numeric: true, className: 'max-sm:hidden', cell: r => deltaCell(r.deltaTotal, r.monthsGap) },
];

export const History: React.FC<HistoryProps> = ({ history, expensesHistory, reviewData, closingSlot }) => {
  const t = chartTheme(useIsDark());
  const [tab, setTab] = useState<Tab>('patrimoine');
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
    const rows: DeltaRow[] = [];
    sorted.forEach((s, i) => {
      const prev = i > 0 ? sorted[i - 1] : null;
      // Écart réel en mois avec le point précédent : un trou dans la série (app non
      // ouverte pendant un trimestre) n'est pas la variation d'UN mois.
      const monthsGap = prev
        ? Math.max(1, Math.round((parseISODate(s.date).getTime() - parseISODate(prev.date).getTime()) / (1000 * 3600 * 24 * 30.4375)))
        : 1;
      rows.push({ date: s.date, total: s.totalAmount, owned: s.ownedAmount, deltaTotal: prev ? s.totalAmount - prev.totalAmount : null, deltaOwned: prev ? s.ownedAmount - prev.ownedAmount : null, monthsGap });
    });
    return rows.reverse();
  }, [sorted]);

  const latest = sorted[sorted.length - 1];
  const first = sorted[0];
  const totalGrowth = latest && first ? latest.totalAmount - first.totalAmount : 0;

  return (
    <div className="space-y-6 animate-fade-in pb-20">
      <PageHeader title="Historique" subtitle="L'évolution de votre patrimoine et de vos charges fixes. Un point est enregistré automatiquement chaque mois." />

      {/* Clôture de l'année écoulée : ouverte en janvier-février, repliée le reste de l'année. */}
      {closingSlot}

      {/* Un seul bilan annuel : « Votre année » (ses pages de motivation disparaissent quand
          « Bons mois et jalons » est désactivé). */}
      {reviewData && <YearInReviewCard data={reviewData} />}

      <Tabs label="Historique" tabs={TABS} value={tab} onChange={setTab}>
        {tab === 'patrimoine' && (
          <div className="space-y-6">
            {/* Un seul point : les chiffres de synthèse sont déjà justes ; seuls la courbe et
                le tableau exigent au moins deux points. */}
            {latest && (
              <Card>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <StatTile label="Total actuel" value={fmt(latest.totalAmount)} />
                  <StatTile label="Votre part actuelle" value={fmt(latest.ownedAmount)} />
                  <StatTile label={`Évolution depuis ${monthLabel(first.date)}`} value={<MoneyText value={totalGrowth} decimals={0} signed tone="auto" />} />
                </div>
              </Card>
            )}
            {sorted.length < 2 ? (
              <Card>
                <EmptyState icon={LineChartIcon} title="L'historique se construit au fil des mois">
                  Revenez après quelques actualisations pour voir la courbe évoluer.
                </EmptyState>
              </Card>
            ) : (
              <>
                <Card title="Évolution de votre patrimoine">
                  <ChartFrame
                    chartClassName="h-72 sm:h-80"
                    summary={<>
                      {describeEvolution('Votre part', first.ownedAmount, latest.ownedAmount, first.date, latest.date)}
                      {showParents && ` Avec le capital de vos parents, le total atteint ${fmt(latest.totalAmount)}.`}
                    </>}
                    legend={showParents ? <ChartLegend label={`Valeurs ${elideDe(monthLong(latest.date))}`} items={[
                      { key: 'owned', label: 'Votre part', color: t.brand, value: fmt(latest.ownedAmount) },
                      { key: 'parents', label: 'Capital de vos parents', color: t.gold, value: fmt(Math.max(0, latest.totalAmount - latest.ownedAmount)) },
                    ]} /> : undefined}
                    table={<DataTable caption="Votre patrimoine mois par mois" columns={wealthColumns} rows={sorted} rowKey={r => r.date} />}
                  >
                    <AreaSeriesChart data={chartData} series={showParents ? wealthSeries : wealthSeries.slice(0, 1)} stacked={showParents} totalLabel={showParents ? 'Total' : undefined} />
                  </ChartFrame>
                </Card>

                <Card title="Mois par mois">
                  <DataTable caption="Variation de votre patrimoine mois par mois" columns={DELTA_COLUMNS} rows={deltas} rowKey={r => r.date} />
                </Card>
              </>
            )}
          </div>
        )}

        {tab === 'charges' && (
          expensesSorted.length < 2 ? (
            <Card>
              <EmptyState icon={Receipt} title="L'historique des charges se construit au fil des mois">
                Il se remplit à mesure que vous ajustez vos dépenses fixes dans le Pilotage.
              </EmptyState>
            </Card>
          ) : (
            <Card title="Évolution de vos charges fixes">
              <ChartFrame
                chartClassName="h-72 sm:h-80"
                summary={describeEvolution('Vos charges fixes', expensesSorted[0].total, expensesSorted[expensesSorted.length - 1].total, expensesSorted[0].date, expensesSorted[expensesSorted.length - 1].date, 'fp')}
                table={<DataTable caption="Vos charges fixes mois par mois" columns={expensesColumns} rows={expensesSorted} rowKey={r => r.date} />}
              >
                <AreaSeriesChart data={expensesChartData} series={[{ key: 'total', label: 'Charges fixes', color: t.terracotta }]} />
              </ChartFrame>
            </Card>
          )
        )}
      </Tabs>
    </div>
  );
};
