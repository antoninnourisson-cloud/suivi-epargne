// ================================================
// FILE: src/components/Agenda.tsx
// Agenda financier : tout ce qui arrive dans les douze prochains mois (paies,
// prélèvements, révisions de taux, restitution, rendez-vous fiscaux…), groupé par mois.
// Chaque événement ouvre l'écran concerné.
// ================================================
import React, { useMemo } from 'react';
import { GlobalAppData } from '../types';
import { buildAgenda, AgendaEvent, AgendaKind } from '../lib/agenda';
import { frenchDay } from '../lib/format';
import { parseISODate, daysBetween } from '../lib/dates';
import { useTodayDate } from '../hooks/useToday';
import { CalendarDays, Wallet, CalendarClock, Repeat, Percent, HandCoins, Landmark, FileText, HandHeart, Sparkles, Hourglass, ChevronRight, ShieldAlert } from 'lucide-react';
import { Card, EmptyState, MoneyText, PageHeader } from './ui';

interface AgendaProps {
  data: GlobalAppData;
  onOpen: (view: string) => void;
}

const ICONS: Record<AgendaKind, React.ComponentType<{ className?: string }>> = {
  lep: ShieldAlert, payday: Wallet, subscription: CalendarClock, recurring: Repeat, rates: Percent, restitution: HandCoins,
  fiscal: Landmark, statement: FileText, donations: HandHeart, review: Sparkles, maturity: Hourglass,
};

// Quatre familles de couleur (rôles Material 3) au lieu d'une teinte par sorte d'événement :
// argent à placer ou qui arrive, prélèvements et démarches, parents, alerte.
const TONE = {
  money: 'bg-primary-container text-on-primary-container',
  admin: 'bg-secondary-container text-on-secondary-container',
  parents: 'bg-tertiary-container text-on-tertiary-container',
  alert: 'bg-error-container text-on-error-container',
};
const TONES: Record<AgendaKind, string> = {
  payday: TONE.money, recurring: TONE.money, maturity: TONE.money, review: TONE.money,
  subscription: TONE.admin, rates: TONE.admin, fiscal: TONE.admin, statement: TONE.admin, donations: TONE.admin,
  restitution: TONE.parents,
  lep: TONE.alert,
};

const MONTH = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' });
const SHORT_MONTH = new Intl.DateTimeFormat('fr-FR', { month: 'short' });
const DAY = new Intl.DateTimeFormat('fr-FR');

const monthTitle = (iso: string) => {
  const s = MONTH.format(parseISODate(iso));
  return s.charAt(0).toUpperCase() + s.slice(1);
};

/** Montant d'un événement : prélèvement en négatif, échéance récurrente avec son signe. */
const amountOf = (e: AgendaEvent) => {
  if (e.amount === undefined) return null;
  if (e.kind === 'subscription') return <MoneyText value={-e.amount} signed tone="auto" />;
  if (e.kind === 'recurring') return <MoneyText value={e.amount} signed tone="auto" />;
  return <MoneyText value={e.amount} className="text-on-surface" />;
};

export const Agenda: React.FC<AgendaProps> = ({ data, onOpen }) => {
  // Date du jour partagée : l'écran resté ouvert passe au lendemain à minuit (« dans N jours »).
  const today = useTodayDate();
  const { events, later } = useMemo(() => buildAgenda(data, today), [data, today]);

  const groups = useMemo(() => {
    const map = new Map<string, AgendaEvent[]>();
    for (const e of events) {
      const key = e.date.slice(0, 7);
      map.set(key, [...(map.get(key) || []), e]);
    }
    return [...map.entries()];
  }, [events]);

  const when = (iso: string) => {
    const n = daysBetween(today, parseISODate(iso));
    return n === 0 ? "aujourd'hui" : n === 1 ? 'demain' : `dans ${n} jours`;
  };

  const rowClass = 'w-full min-h-14 flex items-center gap-3 py-2 px-4 sm:px-6 text-left';

  /** Ligne d'événement : un bouton s'il ouvre un écran, sinon une simple ligne (pas un bouton désactivé). */
  const rowShell = (key: string, e: { view?: string }, content: React.ReactNode) => (
    <li key={key}>
      {e.view ? (
        <button type="button" onClick={() => onOpen(e.view!)} className={`${rowClass} transition-colors hover:bg-on-surface/8`}>
          {content}
          <ChevronRight className="w-5 h-5 shrink-0 text-on-surface-variant" aria-hidden="true" />
        </button>
      ) : <div className={rowClass}>{content}</div>}
    </li>
  );

  const row = (e: AgendaEvent, key: string) => {
    const Icon = ICONS[e.kind];
    const d = parseISODate(e.date);
    const amount = amountOf(e);
    return rowShell(key, e, <>
      <span className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${TONES[e.kind]}`}><Icon className="w-5 h-5" aria-hidden="true" /></span>
      <span className="flex-1 min-w-0">
        {/* Montant sur la ligne du titre : la date et le détail ont toute la largeur en dessous
            (à 320 px, une colonne de montant les cassait en trois lignes). */}
        <span className="flex items-baseline justify-between gap-x-3">
          <span className="min-w-0 text-sm font-medium text-on-surface break-words">{e.title}</span>
          {amount && <span className="shrink-0 text-sm font-medium">{amount}</span>}
        </span>
        {/* « 14 oct. · dans 5 jours » sous le titre, sans couper la date. */}
        <span className="block text-xs text-on-surface-variant">
          <time dateTime={e.date} className="whitespace-nowrap">{frenchDay(d).split(' ')[0]} {SHORT_MONTH.format(d)}</time>
          {' · '}<span className="whitespace-nowrap">{when(e.date)}</span>
          {e.detail && <> · {e.detail}</>}
        </span>
      </span>
    </>);
  };

  return (
    <div className="space-y-6 animate-fade-in pb-20">
      <PageHeader
        title="Agenda"
        subtitle="Les douze prochains mois : paies, prélèvements, révisions de taux et rendez-vous fiscaux. Les abonnements mensuels sont affichés sur deux mois."
      />

      {groups.length === 0 && later.length === 0 && (
        <Card><EmptyState icon={CalendarDays} title="Rien de prévu">Ajoutez vos abonnements ou votre jour de paie pour voir arriver vos échéances.</EmptyState></Card>
      )}

      {groups.map(([month, list]) => (
        <Card key={month} padding="none" title={monthTitle(`${month}-01`)} className="pb-2">
          <ul className="divide-y divide-outline-variant">
            {list.map((e, i) => row(e, `${e.kind}-${e.date}-${e.title}-${i}`))}
          </ul>
        </Card>
      ))}

      {later.length > 0 && (
        <Card padding="none" title="Plus tard" className="pb-2">
          <ul className="divide-y divide-outline-variant">
            {later.map((e, i) => rowShell(`later-${i}`, e, <>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-medium text-on-surface break-words">{e.title}</span>
                {e.detail && <span className="block text-xs text-on-surface-variant">{e.detail}</span>}
              </span>
              <time dateTime={e.date} className="text-xs font-medium text-on-surface-variant shrink-0">{DAY.format(parseISODate(e.date))}</time>
            </>))}
          </ul>
        </Card>
      )}
    </div>
  );
};
