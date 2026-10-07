// ================================================
// FILE: src/components/DashboardCharts.tsx
// Graphiques du Tableau de bord, chargés à part : la bibliothèque de graphiques (recharts,
// ~370 Ko) n'est plus nécessaire pour afficher les cartes, qui apparaissent tout de suite.
// Chaque graphique remplit la hauteur que lui donne l'Accueil et porte sa propre phrase de
// synthèse et son bouton « Voir les données » (le tableau prend alors la place du tracé).
// ================================================
import React, { useId, useMemo } from 'react';
import {
  ResponsiveContainer, Tooltip as RechartsTooltip,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, AreaChart, Area, LabelList,
} from 'recharts';
import { SavingsAccount } from '../types';
import { formatEUR } from '../lib/format';
import { parseISODate } from '../lib/dates';
import { useIsDark, chartTheme, usePrefersReducedMotion, themedSeriesColor, axisTick } from '../lib/chartTheme';
import { formatAxisEUR, maxAbs, niceTicks, describeEvolution, lastPointPerMonth } from '../lib/chartData';
import { DataTable, type Column } from './ui/DataTable';
import { ChartFrame } from './charts/ChartFrame';
import { ChartLegend, ChartTooltipCard } from './charts/ChartParts';

// Un point du graphique empilé : la date, puis le solde de chaque compte (clé = id du compte).
export type StackedPoint = { date: string; displayDate: string; total?: number; [accountId: string]: string | number | undefined };

interface StackedProps {
  stackedData: StackedPoint[];
  accounts: SavingsAccount[];
  getAccountColor: (id: string) => string;
  isConstrainedAccount: (type: SavingsAccount['type']) => boolean;
}

const num = (v: string | number | undefined): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const fmt0 = (n: number) => formatEUR(n, 0);
const longDate = (iso: string) => parseISODate(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
/** Identifiant utilisable dans `url(#…)` (useId peut contenir des caractères spéciaux). */
const svgId = (raw: string) => raw.replace(/[^a-zA-Z0-9_-]/g, '');

export const StackedSavingsChart: React.FC<StackedProps> = ({ stackedData, accounts, getAccountColor, isConstrainedAccount }) => {
  const dark = useIsDark();
  const t = chartTheme(dark);
  const reduced = usePrefersReducedMotion();
  const uid = svgId(useId());
  const colorOf = (id: string) => themedSeriesColor(getAccountColor(id), dark);

  const first = stackedData[0];
  const last = stackedData[stackedData.length - 1];
  const totalOf = (p: StackedPoint) => (p.total !== undefined ? p.total : accounts.reduce((s, a) => s + num(p[a.id]), 0));
  const scaleMax = useMemo(() => maxAbs(stackedData.map(p => (p.total !== undefined ? p.total : accounts.reduce((s, a) => s + num(p[a.id]), 0)))), [stackedData, accounts]);
  // Graduations rondes depuis 0, sauf solde négatif (découvert) : échelle automatique.
  const hasNegative = stackedData.some(p => accounts.some(a => num(p[a.id]) < 0));
  const ticks = useMemo(() => niceTicks(scaleMax), [scaleMax]);
  const yScale = hasNegative ? {} : { ticks, domain: [0, ticks[ticks.length - 1]] };

  const summary = first && last
    ? describeEvolution('Votre épargne nette', totalOf(first), totalOf(last), first.date, last.date)
    : 'Aucune donnée sur cette période.';

  const legendItems = accounts.map(a => ({
    key: a.id, label: a.name, color: colorOf(a.id), striped: isConstrainedAccount(a.type),
    value: last ? fmt0(num(last[a.id])) : undefined,
  }));

  const tableRows = useMemo(() => lastPointPerMonth(stackedData), [stackedData]);
  const columns: Column<StackedPoint>[] = [
    { key: 'date', header: 'Date', cell: p => longDate(p.date) },
    ...accounts.map(a => ({ key: a.id, header: a.name, numeric: true, cell: (p: StackedPoint) => fmt0(num(p[a.id])) })),
    { key: 'total', header: 'Total', numeric: true, cell: (p: StackedPoint) => <b className="font-medium">{fmt0(totalOf(p))}</b> },
  ];

  return (
    <ChartFrame
      fill
      summary={summary}
      legend={<ChartLegend items={legendItems} label="Comptes, solde à la fin de la période" />}
      table={<DataTable caption="Votre épargne nette par compte, un relevé par mois (le dernier disponible)" columns={columns} rows={tableRows} rowKey={p => p.date} />}
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={stackedData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} accessibilityLayer={false}>
          <defs>
            {accounts.map(acc => {
              const color = colorOf(acc.id);
              return (
                <React.Fragment key={acc.id}>
                  <linearGradient id={`${uid}-g-${acc.id}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={color} stopOpacity={0.42} />
                    <stop offset="100%" stopColor={color} stopOpacity={0.14} />
                  </linearGradient>
                  {/* Hachures à 45° ton sur ton : épargne bloquée ou disponible avec impôt. */}
                  <pattern id={`${uid}-s-${acc.id}`} patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
                    <rect width="6" height="6" fill={color} fillOpacity={0.14} />
                    <path d="M 0 0 L 0 6" stroke={color} strokeWidth="2.5" strokeOpacity={0.55} />
                  </pattern>
                </React.Fragment>
              );
            })}
          </defs>
          <CartesianGrid vertical={false} stroke={t.grid} strokeWidth={1} />
          <XAxis dataKey="displayDate" tick={axisTick(t)} tickLine={false} axisLine={{ stroke: t.grid }} minTickGap={32} tickMargin={6} />
          <YAxis {...yScale} tickFormatter={(v: number) => formatAxisEUR(v, scaleMax)} tick={axisTick(t)} tickLine={false} axisLine={false} width={60} />
          <RechartsTooltip
            cursor={{ stroke: t.cursor, strokeWidth: 1 }}
            wrapperStyle={{ outline: 'none' }}
            isAnimationActive={!reduced}
            content={({ active, payload }) => {
              const p = payload?.[0]?.payload as StackedPoint | undefined;
              if (!active || !p) return null;
              return (
                <ChartTooltipCard
                  title={longDate(p.date)}
                  rows={[...accounts]
                    .sort((a, b) => num(p[b.id]) - num(p[a.id]))
                    .map(a => ({ key: a.id, label: a.name, value: fmt0(num(p[a.id])), color: colorOf(a.id), striped: isConstrainedAccount(a.type) }))}
                  total={accounts.length > 1 ? { label: 'Total', value: fmt0(totalOf(p)) } : undefined}
                />
              );
            }}
          />
          {accounts.map(acc => (
            <Area
              key={acc.id}
              type="monotone"
              dataKey={acc.id}
              name={acc.name}
              stackId="1"
              stroke={colorOf(acc.id)}
              strokeWidth={2}
              fill={isConstrainedAccount(acc.type) ? `url(#${uid}-s-${acc.id})` : `url(#${uid}-g-${acc.id})`}
              fillOpacity={1}
              activeDot={{ r: 4, stroke: t.surface, strokeWidth: 2 }}
              isAnimationActive={!reduced}
              animationDuration={700}
              animationEasing="ease-out"
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
};

/**
 * Répartition par établissement. Les montants reçus sont VOTRE PART (hors capital de vos
 * parents), comme la carte « Mon épargne nette » : le graphique le dit explicitement, il
 * n'est donc plus comparé aux soldes complets des comptes.
 */
export const InstitutionChart: React.FC<{ data: { name: string; value: number }[] }> = ({ data: dataByInstitution }) => {
  const dark = useIsDark();
  const t = chartTheme(dark);
  const reduced = usePrefersReducedMotion();
  const data = useMemo(() => [...dataByInstitution].sort((a, b) => b.value - a.value), [dataByInstitution]);
  const total = data.reduce((s, d) => s + d.value, 0);
  const share = (v: number) => (total > 0 ? `${Math.round((v / total) * 100)} %` : '—');
  // Largeur de l'axe des noms : selon le plus long, bornée (les noms longs sont tronqués par recharts).
  const nameWidth = Math.min(140, Math.max(64, Math.max(0, ...data.map(d => d.name.length)) * 8 + 8));

  const summary = data.length === 0
    ? 'Aucun compte pour l’instant.'
    : <>Votre part, hors capital de vos parents : <b className="font-medium text-on-surface tabular-nums">{fmt0(total)}</b>.</>;

  const columns: Column<{ name: string; value: number }>[] = [
    { key: 'name', header: 'Établissement', cell: d => d.name },
    { key: 'value', header: 'Votre part', numeric: true, cell: d => fmt0(d.value) },
    { key: 'share', header: 'Part du total', numeric: true, cell: d => share(d.value) },
  ];

  return (
    <ChartFrame
      fill
      compact
      summary={summary}
      table={<DataTable caption="Votre part par établissement, hors capital de vos parents" columns={columns} rows={data} rowKey={d => d.name} />}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 76, left: 0, bottom: 0 }} barCategoryGap="22%" accessibilityLayer={false}>
          <XAxis type="number" hide domain={[0, 'dataMax']} />
          <YAxis dataKey="name" type="category" width={nameWidth} tick={{ ...axisTick(t), fill: t.text }} tickLine={false} axisLine={false} />
          <RechartsTooltip
            cursor={{ fill: t.grid, fillOpacity: 0.45 }}
            wrapperStyle={{ outline: 'none' }}
            isAnimationActive={!reduced}
            content={({ active, payload }) => {
              const d = payload?.[0]?.payload as { name: string; value: number } | undefined;
              if (!active || !d) return null;
              return <ChartTooltipCard title={d.name} rows={[
                { key: 'v', label: 'Votre part', value: fmt0(d.value), color: t.brand },
                { key: 's', label: 'Part du total', value: share(d.value) },
              ]} />;
            }}
          />
          <Bar dataKey="value" name="Votre part" fill={t.brand} radius={[0, 4, 4, 0]} maxBarSize={20} isAnimationActive={!reduced} animationDuration={600} animationEasing="ease-out">
            {/* Montant à droite de la barre : lisible même pour une petite barre. */}
            <LabelList dataKey="value" position="right" offset={8} formatter={(v) => fmt0(Number(v))} style={{ fill: t.text, fontSize: 12, fontWeight: 500, fontVariantNumeric: 'tabular-nums' }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
};
