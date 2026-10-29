// « Aujourd'hui » partagé par les écrans : la date locale (AAAA-MM-JJ) qui change d'elle-même
// au passage de minuit. Sans elle, ce qui dépend du jour (échéances « dans N jours », mois en
// cours, alertes, clôture, déclaration) restait figé sur le jour du calcul tant que les données
// ne changeaient pas : une PWA laissée ouverte, ou reprise le lendemain depuis l'arrière-plan,
// affichait l'agenda de la veille.
// Un seul minuteur pour toute l'app (jusqu'au prochain minuit), plus une relecture au retour
// au premier plan : un téléphone en veille ne réveille pas les minuteurs à l'heure.
import { useMemo, useSyncExternalStore } from 'react';
import { localTodayISO, parseISODate } from '../lib/dates';

const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | undefined;

/** Millisecondes jusqu'au prochain minuit local (plus une petite marge), à partir de `now`. */
export const msUntilNextDay = (now: Date = new Date()): number =>
  new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() - now.getTime() + 500;

const notify = () => { for (const l of [...listeners]) l(); };

const schedule = () => {
  clearTimeout(timer);
  // Relancé à chaque réveil : un minuteur parti avant un changement d'heure ou une mise en
  // veille est recalé sur le vrai prochain minuit.
  timer = setTimeout(() => { notify(); schedule(); }, msUntilNextDay());
};

const onWake = () => {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
  notify();
  schedule();
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  if (listeners.size === 1) {
    schedule();
    document.addEventListener('visibilitychange', onWake);
    window.addEventListener('pageshow', onWake);
    window.addEventListener('focus', onWake);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) return;
    clearTimeout(timer);
    timer = undefined;
    document.removeEventListener('visibilitychange', onWake);
    window.removeEventListener('pageshow', onWake);
    window.removeEventListener('focus', onWake);
  };
};

/**
 * Date locale du jour (AAAA-MM-JJ), qui change au passage de minuit ou au retour sur l'app
 * un autre jour. Une chaîne : à mettre en dépendance des calculs qui lisent la date du jour.
 */
export const useToday = (): string => useSyncExternalStore(subscribe, localTodayISO, localTodayISO);

/** Le même jour en `Date` (minuit local), stable pour la journée. */
export const useTodayDate = (): Date => {
  const today = useToday();
  return useMemo(() => parseISODate(today), [today]);
};
