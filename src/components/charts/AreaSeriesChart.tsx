// Courbe en aires Material 3 pour les séries mensuelles (Historique, Fiches de paie) :
// dégradé doux, trait de 2 px, quadrillage horizontal discret, graduations en euros
// (k€ sur les grandes échelles), infobulle en carte qui écrit chaque série.
// Animation coupée si l'utilisateur a demandé moins de mouvement.
import React, { useId, useMemo } from 'react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip } from 'recharts';
import { formatEUR } from '../../lib/format';
import { useIsDark, chartTheme, usePrefersReducedMotion, axisTick } from '../../lib/chartTheme';
import { formatAxisEUR, maxAbs, niceTicks } from '../../lib/chartData';
import { ChartTooltipCard } from './ChartParts';

export interface AreaSeries {
  key: string;
  label: string;
  color: string;
}

export interface AreaRow {
  /** Graduation courte de l'axe horizontal (« oct. 26 »). */
  label: string;
  /** Titre de l'infobulle (« octobre 2026 »). */
  title: string;
  [key: string]: string | number;
}

interface AreaSeriesChartProps {
  data: AreaRow[];
  series: AreaSeries[];
  /** Aires empilées (les séries s'additionnent). */
  stacked?: boolean;
  /** Ligne de total dans l'infobulle (somme des séries). */
  totalLabel?: string;
}

const value = (row: AreaRow, key: string): number => {
  const v = row[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
};

export const AreaSeriesChart: React.FC<AreaSeriesChartProps> = ({ data, series, stacked = false, totalLabel }) => {
  const t = chartTheme(useIsDark());
  const reduced = usePrefersReducedMotion();
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const scaleMax = useMemo(
    () => maxAbs(data.map(r => (stacked ? series.reduce((s, x) => s + value(r, x.key), 0) : Math.max(...series.map(x => value(r, x.key)))))),
    [data, series, stacked],
  );
  // Graduations rondes depuis 0, sauf valeur négative (l'échelle automatique la montre alors).
  const hasNegative = data.some(r => series.some(x => value(r, x.key) < 0));
  const ticks = useMemo(() => niceTicks(scaleMax), [scaleMax]);
  const yScale = hasNegative ? {} : { ticks, domain: [0, ticks[ticks.length - 1]] };
  // Un seul trait : un léger voile ; empilé : un peu plus dense pour distinguer les couches.
  const [top, bottom] = stacked ? [0.4, 0.14] : [0.28, 0.02];

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} accessibilityLayer={false}>
        <defs>
          {series.map(s => (
            <linearGradient key={s.key} id={`${uid}-${s.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity={top} />
              <stop offset="100%" stopColor={s.color} stopOpacity={bottom} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid vertical={false} stroke={t.grid} strokeWidth={1} />
        <XAxis dataKey="label" tick={axisTick(t)} tickLine={false} axisLine={{ stroke: t.grid }} minTickGap={24} tickMargin={6} />
        <YAxis {...yScale} tickFormatter={(v: number) => formatAxisEUR(v, scaleMax)} tick={axisTick(t)} tickLine={false} axisLine={false} width={scaleMax >= 10_000 ? 56 : 64} />
        <RechartsTooltip
          cursor={{ stroke: t.cursor, strokeWidth: 1 }}
          wrapperStyle={{ outline: 'none' }}
          isAnimationActive={!reduced}
          content={({ active, payload }) => {
            const row = payload?.[0]?.payload as AreaRow | undefined;
            if (!active || !row) return null;
            return (
              <ChartTooltipCard
                title={row.title}
                rows={series.map(s => ({ key: s.key, label: s.label, value: formatEUR(value(row, s.key), 0), color: s.color }))}
                total={totalLabel ? { label: totalLabel, value: formatEUR(series.reduce((sum, s) => sum + value(row, s.key), 0), 0) } : undefined}
              />
            );
          }}
        />
        {series.map(s => (
          <Area
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.label}
            stackId={stacked ? 'stack' : undefined}
            stroke={s.color}
            strokeWidth={2}
            fill={`url(#${uid}-${s.key})`}
            fillOpacity={1}
            dot={data.length <= 12 ? { r: 4, fill: s.color, stroke: t.surface, strokeWidth: 2 } : false}
            activeDot={{ r: 6, fill: s.color, stroke: t.surface, strokeWidth: 2 }}
            isAnimationActive={!reduced}
            animationDuration={700}
            animationEasing="ease-out"
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
};
