// Épargne du mois d'épargne en cours (payPeriodSavings) et jauge « Placé depuis la paie ».
// (Extrait de home.ts, code déplacé tel quel ; home.ts le ré-exporte.)
import { AccountType, type PayslipRecord, type SavingsAccount } from '../types';
import { payAttribution, savedBetween, savingsTrackingFrom } from './motivation';
import { expectedPayDate, payWindows, shiftMonth, type PayCalendarData } from './payCalendar';
import { type MonthSavingsRate } from './finance';
import { daysBetween, parseISODate } from './dates';
import { elideDe, formatMonth, frenchDay } from './format';

/** Moyenne du taux d'épargne des mois COMPLETS où quelque chose a bougé (le mois en cours n'est pas fini). */
export const averageFullMonthRate = (history: MonthSavingsRate[]): number | null => {
  const full = history.slice(0, -1).filter(m => m.saved !== 0);
  return full.length > 0 ? full.reduce((s, m) => s + m.rate, 0) / full.length : null;
};

/**
 * Le chiffre « ce mois-ci » de l'Accueil, sur UNE seule fenêtre : le mois d'épargne en cours
 * (lib/payCalendar : de la paie reçue, ou attendue, à la paie suivante), sinon le mois civil.
 * La jauge, le taux d'épargne et la carte « Bons mois » lisent tous cette même fenêtre : pas de
 * « 0 % ce mois-ci » le 2 novembre quand 320 € ont été placés depuis la paie du 27 octobre
 * (épargne de novembre).
 */
export interface PayPeriodSavings {
  /** Mois d'épargne en cours, 'YYYY-MM' (« Épargne de novembre »). */
  key: string;
  /** La paie de ce mois est déclarée (rituel « J'ai reçu ma paie ») ; sinon elle est attendue. */
  declared: boolean;
  /** Premier jour de la fenêtre en cours (AAAA-MM-JJ). */
  start: string;
  /** Début de la fenêtre suivante (exclu) : prochaine paie, ou 1er du mois suivant. */
  end: string;
  /** La fenêtre suit la paie (sinon : le mois civil). */
  byPay: boolean;
  /** « depuis la paie du 27 septembre » ou « depuis le 1er octobre ». */
  since: string;
  /** Mis de côté depuis le début de la fenêtre (versements − retraits, votre part). */
  saved: number;
  /** Part de la paie mise de côté dans la fenêtre en cours, en % (null sans paie connue). */
  rate: number | null;
  /** Les derniers mois d'épargne (`month` = leur clé), le plus ancien d'abord, celui en cours compris. */
  history: MonthSavingsRate[];
  /** Moyenne des fenêtres terminées où quelque chose a bougé (null sans paie connue). */
  avgRate: number | null;
  /** Nombre de fenêtres de cette moyenne (« moyenne sur 8 paies »). */
  avgCount: number;
}

export const payPeriodSavings = (opts: {
  accounts: { type: AccountType; movements: SavingsAccount['movements'] }[];
  today: string;
  paydayDay?: number;
  payslips?: Pick<PayslipRecord, 'addedAt' | 'extracted'>[];
  /** Paies déclarées : début des mois d'épargne et versements rattachés (payId). */
  pays?: PayCalendarData['pays'];
  /** Paie nette mensuelle, pour le taux (0 = inconnue). */
  monthlyPay: number;
  trackingStartISO?: string;
  count?: number;
}): PayPeriodSavings => {
  const { accounts, today, paydayDay, monthlyPay, trackingStartISO } = opts;
  const windows = payWindows({ paydayDay, payslips: opts.payslips, pays: opts.pays }, today, opts.count ?? 12);
  // Paies d'avant le suivi (premier versement, ou « Repartir de zéro ») : rien n'était
  // enregistré, une barre à 0 % y ferait croire à des mois sans épargne. La paie en cours reste.
  const trackingFrom = savingsTrackingFrom(accounts, trackingStartISO);
  const shown = windows.filter((w, i) => i === windows.length - 1 || (trackingFrom !== undefined && w.end > trackingFrom));
  const history: MonthSavingsRate[] = shown.map(w => {
    const saved = savedBetween(accounts, w.start, w.end, today, trackingStartISO, payAttribution(w.key, opts.pays));
    // Libellé « Épargne de novembre » : le mois d'épargne de la fenêtre.
    return { month: w.key, saved, rate: monthlyPay > 0 ? (saved / monthlyPay) * 100 : 0 };
  });
  const current = windows[windows.length - 1];
  const byPay = current.source !== 'calendar';
  // Fin de la fenêtre en cours : la prochaine paie attendue (bornée au dernier jour du mois),
  // sinon le 1er du mois suivant ; d'après une fiche seule, 30 jours.
  const end = paydayDay || current.source === 'calendar' ? expectedPayDate(paydayDay, shiftMonth(current.payMonth, 1)) : current.end;
  const startDay = frenchDay(parseISODate(current.start));
  return {
    key: current.key,
    declared: current.source === 'received',
    start: current.start,
    end,
    byPay,
    since: byPay ? `depuis la paie du ${startDay}` : `depuis le ${startDay}`,
    saved: history[history.length - 1].saved,
    rate: monthlyPay > 0 ? history[history.length - 1].rate : null,
    history,
    avgRate: monthlyPay > 0 ? averageFullMonthRate(history) : null,
    avgCount: history.slice(0, -1).filter(m => m.saved !== 0).length,
  };
};

/** Repère tracé sur la jauge quand l'objectif et le seuil « bon mois » diffèrent. */
export interface GaugeTick { kind: 'goal' | 'threshold'; amount: number; pct: number }

export interface SavingsGauge {
  /** « Épargne de novembre » (mois d'épargne) ou « Placé depuis le 1er octobre » (mois civil). */
  title: string;
  /** « Depuis la paie du 27 octobre », sous le titre d'un mois d'épargne (null en mois civil). */
  since: string | null;
  hasPlan: boolean;
  plan: number;
  /** Seuil « bon mois » (0 : motivation coupée). */
  threshold: number;
  /** Bout de la jauge : le plus grand des deux repères. */
  max: number;
  /** Remplissage de la jauge, 0 à 100. */
  pct: number;
  /** Le plus petit des deux repères, tracé sur la jauge (null s'il n'y en a qu'un). */
  tick: GaugeTick | null;
  /** Objectif atteint. */
  done: boolean;
  /** Seuil « bon mois » atteint. */
  good: boolean;
  daysLeft: number;
  /** « la prochaine paie » ou « la fin du mois ». */
  until: string;
}

/**
 * Jauge unique de la fenêtre en cours (payPeriodSavings) : objectif de la paie (Pilotage) et
 * seuil « bon mois » sur la même barre, au lieu de deux jauges du même montant face à deux
 * cibles différentes.
 */
export const savingsGauge = (opts: {
  saved: number;
  goal?: number;
  /** Seuil « bon mois » ; absent ou 0 quand la motivation est coupée. */
  threshold?: number;
  period: Pick<PayPeriodSavings, 'end' | 'byPay' | 'since'> & Partial<Pick<PayPeriodSavings, 'key'>>;
  today: string;
}): SavingsGauge => {
  const { saved, goal, period, today } = opts;
  const hasPlan = goal !== undefined && goal > 0;
  const plan = hasPlan ? goal : 0;
  const threshold = opts.threshold && opts.threshold > 0 ? opts.threshold : 0;
  const max = Math.max(plan, threshold);
  const pctOf = (n: number) => (max > 0 ? Math.max(0, Math.min(100, (n / max) * 100)) : 0);
  const smaller = plan > 0 && threshold > 0 && Math.abs(plan - threshold) >= 0.5
    ? (plan < threshold ? { kind: 'goal' as const, amount: plan } : { kind: 'threshold' as const, amount: threshold })
    : null;
  return {
    title: period.byPay && period.key ? `Épargne ${elideDe(formatMonth(period.key))}` : `Placé ${period.since}`,
    since: period.byPay && period.key ? period.since.charAt(0).toUpperCase() + period.since.slice(1) : null,
    hasPlan,
    plan,
    threshold,
    max,
    pct: pctOf(saved),
    tick: smaller ? { ...smaller, pct: pctOf(smaller.amount) } : null,
    done: hasPlan && saved >= plan - 0.004,
    good: threshold > 0 && saved >= threshold - 0.004,
    daysLeft: Math.max(0, daysBetween(parseISODate(today), parseISODate(period.end))),
    until: period.byPay ? 'la prochaine paie' : 'la fin du mois',
  };
};

