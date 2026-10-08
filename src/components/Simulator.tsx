// Écran « Et si… » : simulateur de VOTRE épargne (part propre, jamais le capital des
// parents). On combine des scénarios (achat, pause, autre montant mensuel, autre date de
// restitution), on choisit l'horizon, et l'écran compare au plan actuel, avec une
// fourchette tirée de vos propres mois passés. Le calcul vit dans src/lib/simulator.ts.
import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { FlaskConical, Plus, Info, Wallet } from 'lucide-react';
import type { FiscalConfig, ParentalRestitution, PayslipRecord, SavingsAccount } from '../types';
import type { SavingsSplit } from '../lib/finance';
import { simulate, pastMonthlySavings, mulberry32, monthDate, Scenario, ScenarioKind, SimulatorResult } from '../lib/simulator';
import { localTodayISO, parseISODate } from '../lib/dates';
import { formatEUR, formatSignedEUR } from '../lib/format';
import { Card, Chip, DataTable, type Column, DeltaBadge, EmptyState, MoneyText, PageHeader, SegmentedButton, StatTile, TextField } from './ui';
import { NumberInput } from './NumberInput';
import { ChartFrame } from './charts/ChartFrame';
import { ChartLegend, type LegendItem } from './charts/ChartParts';
import { useIsDark } from '../lib/chartTheme';
import { SimulatorChart, simulatorColors, type SimChartRow } from './simulator/SimulatorChart';
import { ScenarioEditor, SCENARIO_META } from './simulator/ScenarioEditor';

interface SimulatorProps {
  accounts: SavingsAccount[];
  fiscalConfig: FiscalConfig;
  monthPlan: number;
  savingsSplit?: SavingsSplit;
  paydayDay?: number;
  payslips?: PayslipRecord[];
  trackingStartDate?: string;
  parentalRestitution?: ParentalRestitution;
}

const HORIZONS = ['12', '24', '36', '60'] as const;
const BAND_DELAY_MS = 300;
/** Annonce du résultat aux lecteurs d'écran : une phrase, une fois la saisie posée. */
const ANNOUNCE_DELAY_MS = 800;

/** La valeur, une fois qu'elle n'a plus changé pendant `ms` millisecondes. */
const useDebounced = <T,>(value: T, ms: number): T => {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setSettled(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return settled;
};
type Horizon = typeof HORIZONS[number];

/** Région annoncée (invisible) : une seule phrase de synthèse, après une pause de saisie,
 *  plutôt que tout le bloc de résultat relu à chaque frappe. */
const LiveSummary: React.FC<{ text: string }> = ({ text }) => {
  const settled = useDebounced(text, ANNOUNCE_DELAY_MS);
  return <p className="sr-only" aria-live="polite" aria-atomic="true">{settled}</p>;
};

const monthShort = (iso: string) => parseISODate(iso).toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' });
const monthLong = (iso: string) => parseISODate(iso).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
const inMonths = (m: number) => (m === 0 ? 'dès aujourd\'hui' : `dans ${m} mois`);
const eur = (n: number) => formatEUR(n, 0);

/** Une ligne par mois jusqu'à 24 mois, sinon un trimestre sur trois (et le dernier mois). */
const tableRows = (r: SimulatorResult) => r.points.filter(p => r.horizon <= 24 || p.month % 3 === 0 || p.month === r.horizon);

export const Simulator: React.FC<SimulatorProps> = ({
  accounts, fiscalConfig, monthPlan, savingsSplit, paydayDay, payslips = [], trackingStartDate, parentalRestitution,
}) => {
  const today = useMemo(() => localTodayISO(), []);
  const [horizon, setHorizon] = useState<Horizon>('24');
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [target, setTarget] = useState(0);
  const nextId = useRef(1);
  const resultId = useId();
  const dark = useIsDark();

  const plan = Math.max(0, Math.round(monthPlan || 0));
  const hasParental = accounts.some(a => a.parentalCapital > 0);
  const restitutionOpen = hasParental && !parentalRestitution?.done;
  const h = Number(horizon);

  const history = useMemo(
    () => pastMonthlySavings({ accounts, today, paydayDay, payslips, trackingStartDate }),
    [accounts, today, paydayDay, payslips, trackingStartDate],
  );

  // Courbes : recalculées à chaque frappe (deux trajectoires, instantané). Fourchette
  // (1 000 tirages) : après une courte pause de saisie, pour ne pas figer l'écran.
  const inputs = useMemo(() => ({ scenarios, h, target }), [scenarios, h, target]);
  const bandInputs = useDebounced(inputs, BAND_DELAY_MS);
  const common = useMemo(() => ({
    accounts, fiscal: fiscalConfig, monthlyPlan: plan, today, split: savingsSplit, history: history.amounts,
    restitution: parentalRestitution ? { plannedDate: parentalRestitution.plannedDate, done: !!parentalRestitution.done } : undefined,
  }), [accounts, fiscalConfig, plan, today, savingsSplit, history.amounts, parentalRestitution]);
  const lines = useMemo(
    () => simulate({ ...common, horizon: inputs.h, scenarios: inputs.scenarios, target: inputs.target, band: false }),
    [common, inputs],
  );
  const banded = useMemo(
    () => simulate({ ...common, horizon: bandInputs.h, scenarios: bandInputs.scenarios, target: bandInputs.target, rng: mulberry32(2026) }),
    [common, bandInputs],
  );
  const result = useMemo((): SimulatorResult => {
    const fresh = bandInputs === inputs;
    // Fourchette d'un instant plus tôt gardée pendant la saisie (même horizon seulement).
    if (!banded.band || banded.horizon !== lines.horizon) return { ...lines, band: null, bandUnavailable: banded.bandUnavailable };
    return {
      ...lines,
      points: lines.points.map((p, i) => ({ ...p, p10: banded.points[i].p10, p50: banded.points[i].p50, p90: banded.points[i].p90 })),
      band: banded.band,
      goal: lines.goal && { ...lines.goal, p50Month: fresh ? banded.goal?.p50Month ?? null : null },
    };
  }, [lines, banded, bandInputs, inputs]);

  const add = (kind: ScenarioKind) => {
    const id = `s${nextId.current++}`;
    const s: Scenario = kind === 'purchase' ? { kind, id, amount: 0, month: Math.min(6, h) }
      : kind === 'pause' ? { kind, id, month: 1, months: 3 }
        : kind === 'monthly' ? { kind, id, amount: plan }
          : { kind, id, date: monthDate(parentalRestitution?.plannedDate ?? today, 6) };
    setScenarios(list => [...list, s]);
  };
  const update = (s: Scenario) => setScenarios(list => list.map(x => (x.id === s.id ? s : x)));
  const remove = (id: string) => setScenarios(list => list.filter(x => x.id !== id));
  const has = (kind: ScenarioKind) => scenarios.some(s => s.kind === kind);

  if (accounts.length === 0) {
    return (
      <div>
        <PageHeader title="Et si…" />
        <EmptyState icon={Wallet} title="Aucun compte pour l'instant">Ajoutez vos comptes pour simuler votre épargne.</EmptyState>
      </div>
    );
  }

  const withScenario = scenarios.length > 0;
  const colors = simulatorColors(dark, withScenario);
  const last = result.points[result.horizon];
  const fromToday = result.scenarioEnd - result.start;

  const chartRows: SimChartRow[] = result.points.map(p => ({
    label: monthShort(p.date), title: p.month === 0 ? 'Aujourd\'hui' : monthLong(p.date),
    baseline: Math.round(p.baseline), scenario: Math.round(p.scenario),
    band: p.p10 !== undefined && p.p90 !== undefined ? [Math.round(p.p10), Math.round(p.p90)] : undefined,
  }));

  const legend: LegendItem[] = [
    ...(withScenario ? [{ key: 'scenario', label: 'Scénario', color: colors.scenario, value: eur(result.scenarioEnd) }] : []),
    { key: 'baseline', label: 'Plan actuel', color: colors.baseline, value: eur(result.baselineEnd) },
    ...(last.p10 !== undefined && last.p90 !== undefined
      ? [{ key: 'band', label: 'Fourchette (8 cas sur 10)', color: colors.band, value: `${eur(last.p10)} à ${eur(last.p90)}` }]
      : []),
  ];

  const columns: Column<SimulatorResult['points'][number]>[] = [
    { key: 'm', header: 'Mois', cell: p => (p.month === 0 ? 'Aujourd\'hui' : monthLong(p.date)) },
    { key: 'b', header: 'Plan actuel', numeric: true, cell: p => eur(p.baseline) },
    ...(withScenario ? [
      { key: 's', header: 'Scénario', numeric: true, cell: (p: SimulatorResult['points'][number]) => eur(p.scenario) },
      { key: 'g', header: 'Écart', numeric: true, cell: (p: SimulatorResult['points'][number]) => formatSignedEUR(Math.round(p.scenario) - Math.round(p.baseline), 0) },
    ] : []),
    ...(result.band ? [
      { key: 'lo', header: 'Fourchette basse', numeric: true, cell: (p: SimulatorResult['points'][number]) => (p.p10 !== undefined ? eur(p.p10) : '—') },
      { key: 'hi', header: 'Fourchette haute', numeric: true, cell: (p: SimulatorResult['points'][number]) => (p.p90 !== undefined ? eur(p.p90) : '—') },
    ] : []),
  ];

  const summary = withScenario
    ? `Dans ${result.horizon} mois, votre épargne passerait de ${eur(result.start)} aujourd'hui à ${eur(result.scenarioEnd)} avec ce scénario, contre ${eur(result.baselineEnd)} avec votre plan actuel (écart ${formatSignedEUR(Math.round(result.gap), 0)}).`
    : `Avec votre plan actuel (${eur(plan)} par mois), votre épargne passerait de ${eur(result.start)} aujourd'hui à ${eur(result.baselineEnd)} dans ${result.horizon} mois.`;
  const bandSentence = last.p10 !== undefined && last.p90 !== undefined
    ? ` Si vos prochains mois ressemblent à vos ${result.band?.historyMonths} derniers, vous seriez plutôt entre ${eur(last.p10)} et ${eur(last.p90)}.`
    : '';

  const goal = result.goal;
  const unavailable = [
    ...(has('monthly') ? [SCENARIO_META.monthly.label] : []),
    ...(restitutionOpen && has('restitution') ? [SCENARIO_META.restitution.label] : []),
  ];
  const goalMonth = goal ? (withScenario ? goal.scenarioMonth : goal.baselineMonth) : null;
  const goalSentence = !goal ? ''
    : ` Objectif de ${eur(goal.target)} : ${goalMonth !== null ? `atteint ${inMonths(goalMonth)}` : `pas atteint en ${result.horizon} mois`}.`;
  const shortfall = result.purchases.some(p => p.shortfall > 0.5) ? ' Attention : votre part ne suffit pas pour un achat.' : '';

  const rank = (s: Scenario) => scenarios.filter(x => x.kind === s.kind).findIndex(x => x.id === s.id) + 1;

  return (
    <div>
      <PageHeader title="Et si…" subtitle="Comparez votre épargne avec et sans un achat, une pause ou un autre rythme. Seule votre part compte : le capital de vos parents n'est jamais utilisé." />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] items-start">
        <Card title="Scénarios" icon={FlaskConical}>
          <div className="space-y-5">
            <div>
              <p id={`${resultId}-add`} className="text-sm text-on-surface-variant mb-2">Ajouter :</p>
              <div role="group" aria-labelledby={`${resultId}-add`} className="flex flex-wrap gap-2">
                <Chip kind="suggestion" icon={Plus} onClick={() => add('purchase')}>{SCENARIO_META.purchase.label}</Chip>
                <Chip kind="suggestion" icon={Plus} onClick={() => add('pause')}>{SCENARIO_META.pause.label}</Chip>
                <Chip kind="suggestion" icon={Plus} onClick={() => add('monthly')} disabled={has('monthly')} aria-describedby={has('monthly') ? `${resultId}-why` : undefined} className="disabled:opacity-40 disabled:pointer-events-none">{SCENARIO_META.monthly.label}</Chip>
                {restitutionOpen && (
                  <Chip kind="suggestion" icon={Plus} onClick={() => add('restitution')} disabled={has('restitution')} aria-describedby={has('restitution') ? `${resultId}-why` : undefined} className="disabled:opacity-40 disabled:pointer-events-none">{SCENARIO_META.restitution.label}</Chip>
                )}
              </div>
              {unavailable.length > 0 && (
                <p id={`${resultId}-why`} className="mt-2 text-xs text-on-surface-variant">
                  {unavailable.join(' et ')} : déjà dans vos scénarios (un seul possible, modifiez-le ci-dessous).
                </p>
              )}
            </div>

            {scenarios.length > 0 ? (
              <ul aria-label="Scénarios choisis" className="space-y-3">
                {scenarios.map(s => (
                  <ScenarioEditor key={s.id} scenario={s} horizon={h} rank={rank(s)} minRestitutionDate={today}
                    onChange={update} onRemove={() => remove(s.id)} />
                ))}
              </ul>
            ) : (
              <p className="text-sm text-on-surface-variant">Aucun scénario : la courbe montre votre plan actuel, {eur(plan)} mis de côté chaque mois.</p>
            )}

            <div className="space-y-2">
              <p className="text-sm font-medium text-on-surface-variant">Horizon</p>
              <SegmentedButton<Horizon> label="Horizon" value={horizon} onChange={setHorizon} className="w-full [&>button]:flex-1 [&>button]:px-1.5 [&>button]:gap-1 [&>button]:whitespace-nowrap"
                options={HORIZONS.map(v => ({ value: v, label: `${v} mois` }))} />
            </div>

            <TextField label="Objectif (facultatif)" supporting="Le mois où vous l'atteindriez s'affiche avec le résultat."
              render={p => <NumberInput id={p.id} className={p.className} describedBy={p.describedBy} invalid={p.invalid} value={target} onChange={setTarget} min={0} suffix="€" />} />
          </div>
        </Card>

        <div className="space-y-6 min-w-0">
          <Card>
            <LiveSummary text={summary + goalSentence + shortfall} />
            <div className="space-y-4">
              <StatTile size="hero" label={`Dans ${result.horizon} mois`} value={eur(result.scenarioEnd)}
                delta={<DeltaBadge value={fromToday} period="par rapport à aujourd'hui" />}
                hint={withScenario ? `Plan actuel : ${eur(result.baselineEnd)}` : `Plan actuel : ${eur(plan)} par mois`} />
              {withScenario && (
                <p className="text-sm text-on-surface">
                  Écart avec votre plan actuel : <MoneyText value={Math.round(result.gap)} decimals={0} signed tone="auto" className="font-medium" />
                </p>
              )}
              {result.purchases.map(p => (
                <p key={p.id} className="text-sm text-on-surface-variant">
                  Achat de {eur(p.amount)} {inMonths(p.month)} : pris sur {p.takenFrom.map(t => `${t.name} (${eur(t.amount)})`).join(', ') || 'rien'}.
                  {p.shortfall > 0.5 && <span className="block text-error font-medium">Il manquerait {eur(p.shortfall)} : votre part ne suffit pas (celle des parents n'est pas utilisable).</span>}
                </p>
              ))}
              {result.restitution.scenarioIgnored && (
                <p className="text-sm text-on-surface-variant">La restitution est déjà faite : changer sa date ne change rien.</p>
              )}
              {goal && (
                <p className="text-sm text-on-surface">
                  Objectif de {eur(goal.target)} :{' '}
                  {withScenario
                    ? <>scénario {goal.scenarioMonth !== null ? inMonths(goal.scenarioMonth) : `pas atteint en ${result.horizon} mois`}, plan actuel {goal.baselineMonth !== null ? inMonths(goal.baselineMonth) : `pas atteint en ${result.horizon} mois`}.</>
                    : <>{goal.baselineMonth !== null ? `atteint ${inMonths(goal.baselineMonth)}` : `pas atteint en ${result.horizon} mois`}.</>}
                  {goal.p50Month !== null && goal.p50Month !== (withScenario ? goal.scenarioMonth : goal.baselineMonth) && <> D'après vos mois passés : plutôt {inMonths(goal.p50Month)}.</>}
                </p>
              )}
            </div>
          </Card>

          <Card title="Votre épargne mois par mois">
            <ChartFrame
              summary={summary + bandSentence}
              legend={<ChartLegend items={legend} />}
              table={<DataTable caption={`Votre épargne sur ${result.horizon} mois${withScenario ? ', plan actuel et scénario' : ''}`} columns={columns} rows={tableRows(result)} rowKey={p => String(p.month)} />}
            >
              <SimulatorChart data={chartRows} showScenario={withScenario} />
            </ChartFrame>
            <p className="mt-4 flex items-start gap-2 text-xs text-on-surface-variant">
              <Info className="w-4 h-4 shrink-0 mt-px" aria-hidden="true" />
              <span>
                {result.band
                  ? <>Fourchette tirée de vos propres mois passés ; ce n'est pas une prévision garantie. ({result.band.historyMonths} {history.source === 'payday' ? 'mois de paie' : 'mois'}, {result.band.runs.toLocaleString('fr-FR')} tirages.)</>
                  : result.bandUnavailable
                    ? <>Pas de fourchette : {result.bandUnavailable.replace(/^./, c => c.toLowerCase())}</>
                    : <>Fourchette en cours de calcul…</>}
                {' '}Taux nets d'aujourd'hui, versements répartis comme dans le Pilotage.
              </span>
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
};
