// Section « Plus de détails » de l'Accueil : projection, répartition par établissement et
// courbe d'épargne sur une période choisie. Montée seulement quand la section est ouverte :
// la courbe (une boucle par jour, jusqu'à cinq ans) n'est plus recalculée à chaque saisie
// tant qu'elle est repliée.
import React, { Suspense, useEffect, useMemo, useState } from 'react';
import { ChartLine, Download, Landmark, TrendingDown, TrendingUp } from 'lucide-react';
import type { SavingsAccount } from '../../types';
import { Button, Card, StatTile } from '../ui';
import { lazyWithRetry } from '../ErrorBoundary';
import { accountColor } from '../../lib/chartTheme';
import { groupByInstitution } from '../../lib/chartData';
import { formatEUR } from '../../lib/format';
import { localTodayISO } from '../../lib/dates';
import { lsGetJSON, lsSetJSON } from '../../lib/storage';
import { storageKey } from '../../lib/storageKeys';
import { ownedAmountAt } from '../../lib/finance';
import { hasParentalCapital } from '../../lib/parentalMode';
import {
  buildStackedSeries, dateRangeProblem, defaultDateRange, isConstrainedAccount, isDateRange, periodCsvExport, type DateRange, type SavingsProjection,
} from '../../lib/home';
import { downloadCsv } from '../../services/fileDownload';

// Graphiques chargés à part (recharts) : les cartes s'affichent sans les attendre.
const StackedSavingsChart = lazyWithRetry(() => import('../DashboardCharts').then(m => ({ default: m.StackedSavingsChart })));
const InstitutionChart = lazyWithRetry(() => import('../DashboardCharts').then(m => ({ default: m.InstitutionChart })));

const RANGE_KEY = storageKey('dashboardDateRange');
const fmtEUR = (v: number) => formatEUR(v, 0);
const dateFieldClass = 'h-12 sm:h-10 px-3 rounded-xs border border-outline bg-transparent text-sm text-on-surface tabular-nums hover:border-on-surface focus:border-primary outline-none dark:[color-scheme:dark]';
const chartFallback = <div className="h-full w-full rounded-xl bg-surface-container animate-pulse" aria-hidden />;

interface HomeMoreProps {
  accounts: SavingsAccount[];
  projection: SavingsProjection | null;
}

export const HomeMore: React.FC<HomeMoreProps> = ({ accounts, projection }) => {
  // Période du graphique, mémorisée sur l'appareil (une valeur abîmée est ignorée).
  const [range, setRange] = useState<DateRange>(() => lsGetJSON(RANGE_KEY, defaultDateRange(new Date()), isDateRange));
  useEffect(() => { lsSetJSON(RANGE_KEY, range); }, [range]);

  const series = useMemo(() => buildStackedSeries(accounts, range), [accounts, range]);
  // Par établissement, avec la même convention « à ce jour » que les cartes.
  const byInstitution = useMemo(() => {
    const today = localTodayISO();
    return groupByInstitution(accounts, a => ownedAmountAt(a, today));
  }, [accounts]);
  // Couleur par compte : rang de son identifiant (trié), stable quand l'ordre d'affichage change.
  const sortedIds = useMemo(() => accounts.map(a => a.id).sort(), [accounts]);
  const getAccountColor = (id: string) => accountColor(sortedIds, id);

  // Export de la période choisie, un jour par ligne (votre part, comme la courbe).
  const rangeProblem = dateRangeProblem(range);
  const rangeValid = rangeProblem === null;
  const exportCsv = () => {
    const out = periodCsvExport(accounts, range);
    if (out) downloadCsv(out.fileName, out.rows);
  };

  return (
    <div id="home-more" className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
      {projection && (
        <Card title="Projection de trajectoire" icon={TrendingUp}>
          <p className="text-sm text-on-surface-variant -mt-2 mb-4">
            Extrapolation du rythme réel des 90 derniers jours ({projection.monthlyRate >= 0 ? '+' : ''}{fmtEUR(projection.monthlyRate)} par mois) : une estimation, pas une garantie.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <StatTile className="p-4 rounded-xl bg-surface-container" label="Dans 6 mois" value={fmtEUR(projection.in6)} />
            <StatTile className="p-4 rounded-xl bg-surface-container" label="Dans 12 mois" value={fmtEUR(projection.in12)} />
          </div>
          {projection.drift && (
            <div className={`mt-4 flex items-start gap-2 p-3 rounded-xl text-sm ${projection.drift.changeRatio < 0 ? 'bg-tertiary-container text-on-tertiary-container' : 'bg-gain-container text-on-gain-container'}`}>
              {projection.drift.changeRatio < 0
                ? <TrendingDown className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                : <TrendingUp className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />}
              <span>
                Votre rythme d'épargne a {projection.drift.changeRatio < 0 ? 'ralenti' : 'accéléré'} de {Math.abs(Math.round(projection.drift.changeRatio * 100))} %
                par rapport au trimestre précédent ({fmtEUR(projection.drift.previousMonthlyRate)} par mois → {fmtEUR(projection.monthlyRate)} par mois).
              </span>
            </div>
          )}
        </Card>
      )}

      <Card title="Par établissement" icon={Landmark}>
        <div style={{ height: Math.max(190, byInstitution.length * 44 + 70) }}>
          <Suspense fallback={chartFallback}>
            <InstitutionChart data={byInstitution} withParents={hasParentalCapital(accounts)} />
          </Suspense>
        </div>
      </Card>

      <Card className="lg:col-span-2" title="Évolution de mon épargne nette" icon={ChartLine}>
        <div className="flex flex-col gap-3 -mt-2 mb-4">
          <p className="text-sm text-on-surface-variant">
            {accounts.some(a => isConstrainedAccount(a.type)) ? 'Zones hachurées : épargne disponible seulement avec impôt ou bloquée.' : 'Votre part, compte par compte.'}
          </p>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-3">
            <span className="flex flex-wrap items-center gap-2">
              <input type="date" value={range.start} onChange={e => setRange(prev => ({ ...prev, start: e.target.value }))} aria-label="Début de la période" className={dateFieldClass} />
              <span className="text-on-surface-variant text-sm">au</span>
              <input type="date" value={range.end} onChange={e => setRange(prev => ({ ...prev, end: e.target.value }))} aria-label="Fin de la période" className={dateFieldClass} />
            </span>
            {/* Exporte la période choisie (ce que montre la courbe), pas une sauvegarde. */}
            <Button variant="outlined" onClick={exportCsv} disabled={!rangeValid} aria-describedby={rangeValid ? undefined : 'home-range-error'}>
              <Download className="w-4 h-4" aria-hidden="true" /> Exporter la période (CSV)
            </Button>
          </div>
          {!rangeValid && (
            <p id="home-range-error" role="alert" className="text-sm text-error">
              {rangeProblem === 'missing' ? 'Choisissez une date de début et une date de fin.' : 'La date de début doit précéder la date de fin.'}
            </p>
          )}
        </div>
        <div className="h-80">
          <Suspense fallback={chartFallback}>
            <StackedSavingsChart stackedData={series} accounts={accounts} getAccountColor={getAccountColor} isConstrainedAccount={isConstrainedAccount} />
          </Suspense>
        </div>
      </Card>
    </div>
  );
};
