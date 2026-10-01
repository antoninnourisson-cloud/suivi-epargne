// ================================================
// FILE: src/components/Agenda.tsx
// Agenda financier : tout ce qui arrive dans les douze prochains mois (paies,
// prélèvements, révisions de taux, restitution, rendez-vous fiscaux…), groupé par mois.
// Chaque événement ouvre l'écran concerné.
// ================================================
import React, { useMemo } from 'react';
import { GlobalAppData } from '../types';
import { buildAgenda, AgendaEvent, AgendaKind } from '../lib/agenda';
import { formatEUR, formatSignedEUR, frenchDay } from '../lib/format';
import { parseISODate, daysBetween } from '../lib/dates';
import { CalendarDays, Wallet, CalendarClock, Repeat, Percent, HandCoins, Landmark, FileText, HandHeart, Sparkles, Hourglass, ChevronRight } from 'lucide-react';

interface AgendaProps {
  data: GlobalAppData;
  onOpen: (view: string) => void;
}

const ICONS: Record<AgendaKind, React.ComponentType<{ className?: string }>> = {
  payday: Wallet, subscription: CalendarClock, recurring: Repeat, rates: Percent, restitution: HandCoins,
  fiscal: Landmark, statement: FileText, donations: HandHeart, review: Sparkles, maturity: Hourglass,
};
const COLORS: Record<AgendaKind, string> = {
  payday: 'bg-emerald-600', subscription: 'bg-rose-500', recurring: 'bg-violet-600', rates: 'bg-amber-500', restitution: 'bg-amber-600',
  fiscal: 'bg-indigo-600', statement: 'bg-slate-500', donations: 'bg-pink-600', review: 'bg-indigo-500', maturity: 'bg-teal-600',
};

const monthTitle = (iso: string) => {
  const d = parseISODate(iso);
  const s = d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  return s.charAt(0).toUpperCase() + s.slice(1);
};

export const Agenda: React.FC<AgendaProps> = ({ data, onOpen }) => {
  const { events, later } = useMemo(() => buildAgenda(data), [data]);
  const today = new Date();

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

  const Row = ({ e }: { e: AgendaEvent }) => {
    const Icon = ICONS[e.kind];
    const d = parseISODate(e.date);
    return (
      <li>
        <button type="button" onClick={() => e.view && onOpen(e.view)} className="w-full flex items-center gap-3 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-slate-700/40 rounded-lg px-2 -mx-2">
          <span className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${COLORS[e.kind]}`}><Icon className="w-4 h-4 text-white" /></span>
          <span className="w-16 flex-shrink-0 text-xs font-black text-slate-500 dark:text-slate-400 leading-tight">
            {frenchDay(d).split(' ')[0]} {d.toLocaleDateString('fr-FR', { month: 'short' })}
            <span className="block font-bold text-[11px]">{when(e.date)}</span>
          </span>
          <span className="flex-1 min-w-0">
            <span className="block font-bold text-sm text-slate-800 dark:text-slate-100 truncate">{e.title}</span>
            {e.detail && <span className="block text-[11px] text-slate-500 dark:text-slate-400 truncate">{e.detail}</span>}
          </span>
          {e.amount !== undefined && (
            <span className={`font-mono font-bold text-sm flex-shrink-0 ${e.kind === 'subscription' ? 'text-rose-600' : e.kind === 'payday' ? 'text-emerald-600' : 'text-slate-700 dark:text-slate-200'}`}>
              {e.kind === 'recurring' ? formatSignedEUR(e.amount) : formatEUR(e.amount)}
            </span>
          )}
          {e.view && <ChevronRight className="w-4 h-4 text-slate-400 flex-shrink-0" />}
        </button>
      </li>
    );
  };

  return (
    <div className="space-y-6 animate-fade-in pb-20">
      <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm">
        <h2 className="text-2xl font-black text-slate-800 dark:text-slate-100 flex items-center gap-2 mb-1"><CalendarDays className="w-6 h-6 text-indigo-600" /> Agenda</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">Les douze prochains mois : paies, prélèvements, révisions de taux et rendez-vous fiscaux. Les abonnements mensuels sont affichés sur deux mois.</p>
      </div>

      {groups.length === 0 && <p className="text-sm text-slate-500 dark:text-slate-400 italic">Rien de prévu.</p>}

      {groups.map(([month, list]) => (
        <section key={month} className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm">
          <h3 className="text-sm font-black text-slate-800 dark:text-slate-100 mb-2">{monthTitle(`${month}-01`)}</h3>
          <ul className="divide-y divide-slate-100 dark:divide-slate-700">
            {list.map((e, i) => <Row key={`${e.kind}-${e.date}-${e.title}-${i}`} e={e} />)}
          </ul>
        </section>
      ))}

      {later.length > 0 && (
        <section className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm">
          <h3 className="text-sm font-black text-slate-800 dark:text-slate-100 mb-2">Plus tard</h3>
          <ul className="divide-y divide-slate-100 dark:divide-slate-700">
            {later.map((e, i) => (
              <li key={i}>
                <button type="button" onClick={() => e.view && onOpen(e.view)} className="w-full flex items-center justify-between gap-3 py-2.5 text-left text-sm">
                  <span className="font-bold text-slate-800 dark:text-slate-100">{e.title}<span className="block text-[11px] font-normal text-slate-500 dark:text-slate-400">{e.detail}</span></span>
                  <span className="text-xs font-black text-slate-500 dark:text-slate-400 flex-shrink-0">{parseISODate(e.date).toLocaleDateString('fr-FR')}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
};
