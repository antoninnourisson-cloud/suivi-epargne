// Graphique du simulateur « Et si… » : plan actuel (trait pointillé neutre), scénario
// (trait plein vert sapin) et fourchette P10–P90 tirée de vos mois passés (aire douce de
// la même teinte que le scénario). Le tracé s'anime à la première apparition seulement (et
// jamais si l'utilisateur demande moins de mouvement) : animer chaque mise à jour redessinait
// le graphique à chaque image pendant 600 ms, ce qui figeait la saisie sur un téléphone moyen.
// Masqué aux lecteurs d'écran : ChartFrame fournit synthèse et tableau.
import React, { useEffect, useMemo, useState } from 'react';
import { ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip } from 'recharts';
import { formatEUR } from '../../lib/format';
import { useIsDark, chartTheme, usePrefersReducedMotion, axisTick } from '../../lib/chartTheme';
import { formatAxisEUR, maxAbs, niceTicks } from '../../lib/chartData';
import { ChartTooltipCard, type TooltipRow } from '../charts/ChartParts';

/** Durée de l'animation du premier tracé. */
const ANIMATION_MS = 600;

export interface SimChartRow {
  label: string;
  title: string;
  baseline: number;
  scenario: number;
  band?: [number, number];
  p50?: number;
}

/** Sans scénario, le plan actuel est la seule courbe : il prend la couleur principale. */
export const simulatorColors = (dark: boolean, showScenario: boolean) => {
  const t = chartTheme(dark);
  return { scenario: t.brand, baseline: showScenario ? t.cursor : t.brand, band: t.brand };
};

/** Opacité de l'aire de la fourchette, reprise par la pastille de la légende. */
export const simulatorBandOpacity = (dark: boolean) => (dark ? 0.22 : 0.16);

/** Mêmes valeurs ligne à ligne (un objectif saisi, par exemple, ne change pas les courbes). */
const sameRows = (a: SimChartRow[], b: SimChartRow[]) => a === b || (a.length === b.length && a.every((r, i) => {
  const s = b[i];
  return r.label === s.label && r.title === s.title && r.baseline === s.baseline && r.scenario === s.scenario
    && r.band?.[0] === s.band?.[0] && r.band?.[1] === s.band?.[1];
}));

// Mémoïsé sur les valeurs : avec useDeferredValue côté écran, le graphique (le plus long à
// dessiner) n'est redessiné que si une courbe change, après l'affichage de la saisie.
export const SimulatorChart = React.memo(function SimulatorChart({ data, showScenario }: { data: SimChartRow[]; showScenario: boolean }) {
  const dark = useIsDark();
  const t = chartTheme(dark);
  const c = simulatorColors(dark, showScenario);
  const reduced = usePrefersReducedMotion();
  const scaleMax = useMemo(() => maxAbs(data.flatMap(r => [r.baseline, r.scenario, r.band?.[1] ?? 0])), [data]);
  const hasNegative = data.some(r => r.scenario < 0 || (r.band && r.band[0] < 0));
  const ticks = useMemo(() => niceTicks(scaleMax), [scaleMax]);
  const yScale = hasNegative ? {} : { ticks, domain: [0, ticks[ticks.length - 1]] };
  const [drawn, setDrawn] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setDrawn(true), ANIMATION_MS);
    return () => window.clearTimeout(timer);
  }, []);
  const anim = { isAnimationActive: !reduced && !drawn, animationDuration: ANIMATION_MS, animationEasing: 'ease-out' as const };

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} accessibilityLayer={false}>
        <CartesianGrid vertical={false} stroke={t.grid} strokeWidth={1} />
        <XAxis dataKey="label" tick={axisTick(t)} tickLine={false} axisLine={{ stroke: t.grid }} minTickGap={24} tickMargin={6} />
        <YAxis {...yScale} tickFormatter={(v: number) => formatAxisEUR(v, scaleMax)} tick={axisTick(t)} tickLine={false} axisLine={false} width={scaleMax >= 10_000 ? 56 : 64} />
        <RechartsTooltip
          cursor={{ stroke: t.cursor, strokeWidth: 1 }}
          wrapperStyle={{ outline: 'none' }}
          isAnimationActive={!reduced}
          content={({ active, payload }) => {
            const row = payload?.[0]?.payload as SimChartRow | undefined;
            if (!active || !row) return null;
            const rows: TooltipRow[] = [];
            if (showScenario) rows.push({ key: 'scenario', label: 'Scénario', value: formatEUR(row.scenario, 0), color: c.scenario });
            rows.push({ key: 'baseline', label: 'Plan actuel', value: formatEUR(row.baseline, 0), color: c.baseline });
            if (row.band) rows.push({ key: 'band', label: 'Fourchette', value: `${formatEUR(row.band[0], 0)} à ${formatEUR(row.band[1], 0)}`, color: c.band });
            return <ChartTooltipCard title={row.title} rows={rows} />;
          }}
        />
        <Area type="monotone" dataKey="band" name="Fourchette" stroke="none" fill={c.band} fillOpacity={simulatorBandOpacity(dark)} activeDot={false} {...anim} />
        <Line type="monotone" dataKey="baseline" name="Plan actuel" stroke={c.baseline} strokeWidth={2} strokeDasharray={showScenario ? '6 4' : undefined} dot={false}
          activeDot={{ r: 5, fill: c.baseline, stroke: t.surface, strokeWidth: 2 }} {...anim} />
        {showScenario && (
          <Line type="monotone" dataKey="scenario" name="Scénario" stroke={c.scenario} strokeWidth={2.5} dot={false}
            activeDot={{ r: 6, fill: c.scenario, stroke: t.surface, strokeWidth: 2 }} {...anim} />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}, (prev, next) => prev.showScenario === next.showScenario && sameRows(prev.data, next.data));
