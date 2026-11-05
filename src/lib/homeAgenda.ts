// Prélèvements à venir et « Prochaines échéances » de l'Accueil.
// (Extrait de home.ts, code déplacé tel quel ; home.ts le ré-exporte.)
import { type Subscription } from '../types';
import type { AgendaEvent } from './agenda';
import { nextSubscriptionDate } from './finance';
import { daysBetween, formatISODay } from './dates';

export interface UpcomingDebit { s: Subscription; date: Date; inDays: number }

/** Prélèvements actifs des `days` prochains jours (aujourd'hui compris), du plus proche au plus lointain. */
export const upcomingDebits = (subscriptions: Subscription[], now: Date, days = 7): UpcomingDebit[] => {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return subscriptions
    .filter(s => s.active && s.amount > 0)
    .map(s => { const date = nextSubscriptionDate(s, today); return { s, date, inDays: daysBetween(today, date) }; })
    .filter(x => x.inDays <= days)
    .sort((a, b) => a.date.getTime() - b.date.getTime());
};

/**
 * « Prochaines échéances » de l'Accueil : les `count` premiers événements de l'agenda, sans
 * les prélèvements déjà listés dans « Prélèvements des 7 prochains jours » (même abonnement,
 * même jour). Une échéance n'apparaît qu'une fois sur l'écran.
 */
export const homeAgenda = (events: AgendaEvent[], debits: UpcomingDebit[], count = 3): AgendaEvent[] => {
  const listed = new Set(debits.map(d => `${d.s.name}|${formatISODay(d.date)}`));
  return events.filter(e => !(e.kind === 'subscription' && listed.has(`${e.title}|${e.date}`))).slice(0, count);
};
