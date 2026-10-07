// Carte « Bons mois » de l'Accueil : la paie en cours face au seuil, la série, le joker de
// l'année, l'historique des dernières paies et le prochain jalon. Ton positif : on montre ce
// qui est acquis, jamais la menace de perdre la série.
import React, { useState } from 'react';
import { CalendarCheck, Check, Flag, Hourglass, Minus, ShieldCheck, Sparkles } from 'lucide-react';
import type { GoodMonthsSummary, Milestone, MonthResult } from '../../lib/motivation';
import { daysBetween, parseISODate } from '../../lib/dates';
import { formatEUR, formatPeriod, frenchDay } from '../../lib/format';
import { Button, Card } from '../ui';
import { MilestonesSheet } from './MilestonesSheet';
import { deMonth, payMonthName } from './text';

interface GoodMonthsCardProps {
  summary: GoodMonthsSummary;
  today: string;
  milestones: Milestone[];
  next?: Milestone;
  /** Jalons atteints pas encore montrés (célébrés une seule fois). */
  fresh: Milestone[];
  onAcknowledge?: () => void;
}

type Status = 'good' | 'joker' | 'missed' | 'pending';
const statusOf = (m: MonthResult): Status => (m.good ? 'good' : m.inProgress ? 'pending' : m.joker ? 'joker' : 'missed');
const STATUS: Record<Status, { label: string; icon: React.ComponentType<{ className?: string }>; dot: string }> = {
  good: { label: 'bon mois', icon: Check, dot: 'bg-primary text-on-primary' },
  joker: { label: 'joker utilisé', icon: ShieldCheck, dot: 'bg-tertiary-container text-on-tertiary-container' },
  missed: { label: 'raté', icon: Minus, dot: 'border border-outline text-on-surface-variant' },
  pending: { label: 'en cours', icon: Hourglass, dot: 'border-2 border-dashed border-primary text-primary' },
};

const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`;

export const GoodMonthsCard: React.FC<GoodMonthsCardProps> = ({ summary, today, milestones, next, fresh, onAcknowledge }) => {
  const [sheetOpen, setSheetOpen] = useState(false);
  const { current, threshold, streak, bestStreak, months, jokersUsed } = summary;
  const year = Number(today.slice(0, 4));
  const jokerMonth = months.find(m => m.joker && m.start.startsWith(String(year)));
  const pct = current ? Math.max(0, Math.min(100, (current.saved / threshold) * 100)) : 0;
  const reached = !!current?.good;
  const daysLeft = current ? Math.max(0, daysBetween(parseISODate(today), parseISODate(current.end))) : 0;
  const since = current ? `depuis la paie du ${frenchDay(parseISODate(current.start))}` : '';
  const gaugeLabel = `Mis de côté ${since}`;

  return (
    <Card title="Bons mois" icon={CalendarCheck}>
      {fresh.length > 0 && (
        <div role="status" className="mb-4 -mt-1 p-3 rounded-xl bg-tertiary-container text-on-tertiary-container flex flex-wrap items-center gap-x-3 gap-y-2">
          <Sparkles className="w-4 h-4 shrink-0" aria-hidden="true" />
          <p className="flex-1 min-w-40 text-sm">
            <span className="font-medium">Nouveau jalon : </span>
            {fresh.map(m => m.title).join(', ')}.
          </p>
          {onAcknowledge && <Button variant="text" className="-my-1 h-9 px-4 text-on-tertiary-container dark:text-on-tertiary-container" onClick={onAcknowledge}>Merci</Button>}
        </div>
      )}

      {current && (
        <>
          <p className="text-sm text-on-surface-variant">
            <span className="text-base font-medium text-on-surface tabular-nums">{formatEUR(current.saved, 0)}</span>
            <span className="tabular-nums"> / {formatEUR(threshold, 0)}</span> mis de côté {since}
            {' · '}{reached ? 'bon mois acquis' : daysLeft > 0 ? `encore ${plural(daysLeft, 'jour')}` : 'dernier jour'}
          </p>
          <div className="mt-2 h-2 rounded-full bg-surface-container-highest overflow-hidden" role="progressbar" aria-label={gaugeLabel} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
            <div className={`h-full rounded-full ${reached ? 'bg-emerald-600 dark:bg-emerald-400' : 'bg-primary'}`} style={{ width: `${pct}%` }} />
          </div>
        </>
      )}

      <div className="mt-4 flex flex-col gap-1 text-sm">
        <p className="text-on-surface">
          <span className="font-medium">{streak > 0 ? `Série : ${streak} ${streak > 1 ? 'bons mois' : 'bon mois'}` : 'Série : elle démarre au prochain bon mois'}</span>
          {bestStreak > 0 && <span className="text-on-surface-variant"> · record {bestStreak}</span>}
        </p>
        <p className="text-on-surface-variant flex items-center gap-1.5">
          <ShieldCheck className="w-4 h-4 shrink-0" aria-hidden="true" />
          {jokersUsed.includes(String(year))
            ? `Joker ${year} utilisé${jokerMonth ? ` pour la paie ${deMonth(payMonthName(jokerMonth.key, year))}` : ''} : votre série a continué.`
            : `Joker ${year} disponible : un mois plus difficile ne coupe pas la série.`}
        </p>
      </div>

      {months.length > 0 && (
        <div className="mt-4">
          <ol aria-label="Dernières paies" className="flex flex-wrap gap-x-1.5 gap-y-2">
            {months.map(m => {
              const s = statusOf(m);
              const { icon: Icon, dot, label } = STATUS[s];
              const text = `Paie ${deMonth(formatPeriod(m.key))} : ${label}, ${formatEUR(m.saved, 0)}`;
              return (
                <li key={m.key} className="flex flex-col items-center gap-1 w-9" title={text}>
                  <span className={`w-7 h-7 rounded-full flex items-center justify-center ${dot}`} aria-hidden="true">
                    <Icon className="w-3.5 h-3.5" />
                  </span>
                  <span className="text-[11px] text-on-surface-variant" aria-hidden="true">{parseISODate(`${m.key}-01`).toLocaleDateString('fr-FR', { month: 'short' })}</span>
                  <span className="sr-only">{text}</span>
                </li>
              );
            })}
          </ol>
          <p className="mt-2 text-xs text-on-surface-variant flex flex-wrap gap-x-3 gap-y-1" aria-hidden="true">
            {(['good', 'joker', 'missed', 'pending'] as Status[]).filter(s => months.some(m => statusOf(m) === s)).map(s => {
              const { icon: Icon, label } = STATUS[s];
              return <span key={s} className="inline-flex items-center gap-1"><Icon className="w-3 h-3" /> {label}</span>;
            })}
          </p>
        </div>
      )}

      <div className="mt-4 pt-4 border-t border-outline-variant flex flex-wrap items-center justify-between gap-3">
        {next ? (
          <p className="text-sm text-on-surface-variant min-w-0 flex items-center gap-1.5">
            <Flag className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>Prochain jalon : <span className="text-on-surface font-medium">{next.title}</span> <span className="tabular-nums">{Math.round((next.progress ?? 0) * 100)} %</span></span>
          </p>
        ) : <span />}
        <Button variant="tonal" onClick={() => setSheetOpen(true)} aria-haspopup="dialog" aria-expanded={sheetOpen}>Voir vos jalons</Button>
      </div>

      <MilestonesSheet open={sheetOpen} onClose={() => setSheetOpen(false)} milestones={milestones} />
    </Card>
  );
};
