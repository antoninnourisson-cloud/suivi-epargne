// ================================================
// FILE: src/lib/payCalendar.ts
// La règle unique « date de paie → mois d'épargne », partagée par l'app et le serveur de
// notifications. Une paie reçue à partir du 15 finance l'épargne du mois SUIVANT (paie du
// 27 octobre → épargne de novembre ; 31 décembre → janvier) ; avant le 15, celle du mois
// même (paie d'octobre versée le 3 novembre → novembre). Modifiable paie par paie
// (PayRecord.savingsMonth).
//
// Un mois d'épargne dure du jour de réception de sa paie (inclus) au jour de réception de
// la paie suivante (exclu). Paie pas encore déclarée : sa date attendue (jour de paie, ou
// enregistrement d'une fiche de paie à une semaine près), sinon le 1er du mois. Tout est
// recalculé à chaque fois (fonctions pures) : déclarer une paie après coup corrige les
// fenêtres passées.
// ================================================
import type { PayRecord, PayslipRecord } from '../types';
import { formatISODay, parseISODate, MS_PER_DAY } from './dates';

/** Durée de la fenêtre en cours tant que la paie suivante n'est pas tombée. */
export const PAY_WINDOW_DAYS = 30;
/** Écart toléré entre la date d'enregistrement d'une fiche et le jour de paie attendu. */
const PAYSLIP_TOLERANCE_DAYS = 7;
/** À partir de ce jour du mois, une paie finance l'épargne du mois suivant. */
const SAVINGS_MONTH_CUTOFF_DAY = 15;

const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Ce que la règle lit dans les données (tout est facultatif : sans rien, mois civils). */
export interface PayCalendarData {
  paydayDay?: number;
  payslips?: Pick<PayslipRecord, 'addedAt' | 'extracted'>[];
  pays?: Pick<PayRecord, 'id' | 'receivedOn' | 'savingsMonth' | 'kind'>[];
}

export type PayWindowSource = 'received' | 'payslip' | 'payday' | 'calendar';

export interface PayWindow {
  /** Mois d'épargne, 'YYYY-MM'. */
  key: string;
  /** Premier jour, 'YYYY-MM-DD'. */
  start: string;
  /** Lendemain du dernier jour (exclu), 'YYYY-MM-DD'. */
  end: string;
  /** D'où vient le début : paie déclarée, fiche de paie enregistrée, jour de paie, 1er du mois. */
  source: PayWindowSource;
  /** Paie déclarée qui ouvre la fenêtre (source 'received'). */
  payId?: string;
  /**
   * Mois de VERSEMENT de la paie, 'YYYY-MM' (ancienne clé des fenêtres, période des fiches
   * de paie). Sert aux libellés « Paie d'octobre » tant qu'ils ne parlent pas du mois d'épargne.
   */
  payMonth: string;
}

const monthKeyOf = (y: number, month0: number) => {
  const d = new Date(y, month0, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

/** Mois `key` décalé de `delta` mois ('2026-12', +1 → '2027-01'). */
export const shiftMonth = (key: string, delta: number) => {
  const [y, m] = key.split('-').map(Number);
  return monthKeyOf(y, m - 1 + delta);
};

const addDays = (iso: string, days: number) => formatISODay(new Date(parseISODate(iso).getTime() + days * MS_PER_DAY + MS_PER_DAY / 2));
const dayDiff = (a: string, b: string) => Math.round((parseISODate(a).getTime() - parseISODate(b).getTime()) / MS_PER_DAY);

/** Jour de paie effectif d'un mois (le 31 devient le 30 ou le 28). */
export const effectivePayday = (paydayDay: number, year: number, month: number) =>
  Math.min(paydayDay, new Date(year, month + 1, 0).getDate());

/** Jour de paie utilisable (1 à 31), sinon `undefined` : un réglage abîmé vaut « inconnu ». */
export const validPayday = (paydayDay: unknown): number | undefined =>
  typeof paydayDay === 'number' && Number.isInteger(paydayDay) && paydayDay >= 1 && paydayDay <= 31 ? paydayDay : undefined;

/** Mois d'épargne d'une paie reçue le `receivedOn` ('YYYY-MM-DD') : règle du 15. */
export const savingsMonthOf = (receivedOn: string): string => {
  const [y, m, d] = receivedOn.split('-').map(Number);
  return monthKeyOf(y, m - 1 + (d >= SAVINGS_MONTH_CUTOFF_DAY ? 1 : 0));
};

/** Date attendue de la paie versée en `payMonth` ('YYYY-MM') : jour de paie, sinon le 1er. */
export const expectedPayDate = (paydayDay: number | undefined, payMonth: string): string => {
  const [y, m] = payMonth.split('-').map(Number);
  const day = validPayday(paydayDay);
  return formatISODay(new Date(y, m - 1, day ? effectivePayday(day, y, m - 1) : 1));
};

/** Mois d'épargne d'une paie déclarée : celui choisi s'il est lisible, sinon la règle du 15. */
export const savingsMonthOfPay = (p: Pick<PayRecord, 'receivedOn' | 'savingsMonth'>): string =>
  typeof p.savingsMonth === 'string' && MONTH_KEY.test(p.savingsMonth) ? p.savingsMonth : savingsMonthOf(p.receivedOn);

/** Mois d'épargne de chaque paie déclarée, par identifiant (rattachement des versements `payId`). */
export const paySavingsMonths = (pays: Pick<PayRecord, 'id' | 'receivedOn' | 'savingsMonth'>[] = []): Map<string, string> =>
  new Map(pays.filter(p => p && typeof p.id === 'string' && typeof p.receivedOn === 'string' && ISO_DAY.test(p.receivedOn))
    .map(p => [p.id, savingsMonthOfPay(p)]));

/**
 * Début attendu de la paie versée en `payMonth`, sans paie déclarée : la date
 * d'enregistrement d'une fiche de paie de ce mois si elle tombe à une semaine près du jour de
 * paie attendu ; sinon le jour de paie ; sans jour de paie connu, le 1er du mois.
 */
export const expectedPayStart = (
  payMonth: string,
  paydayDay: number | undefined,
  payslips: Pick<PayslipRecord, 'addedAt' | 'extracted'>[] = [],
): { start: string; source: 'payslip' | 'payday' | 'calendar' } => {
  const expected = expectedPayDate(paydayDay, payMonth);
  const recorded = payslips
    .filter(p => p.extracted?.period === payMonth && p.addedAt)
    .map(p => p.addedAt.slice(0, 10))
    .filter(d => Math.abs(dayDiff(d, expected)) <= PAYSLIP_TOLERANCE_DAYS)
    .sort()[0];
  if (recorded) return { start: recorded, source: 'payslip' };
  return { start: expected, source: validPayday(paydayDay) ? 'payday' : 'calendar' };
};

/**
 * Les `count` derniers mois d'épargne (le plus ancien d'abord), celui en cours compris.
 * Chaque paie attendue ouvre le mois d'épargne de sa date attendue ; une paie déclarée
 * remplace la paie attendue du même mois d'épargne (la première déclarée si deux tombent
 * sur le même mois ; un versement en plus n'ouvre rien).
 */
export const payWindows = (data: PayCalendarData, today: string, count = 12): PayWindow[] => {
  const t = parseISODate(today);
  const anchors = new Map<string, Omit<PayWindow, 'end'>>();
  // Un mois de plus que demandé de chaque côté : la paie du mois peut ne pas être tombée, et
  // avec une paie après le 15, le mois d'épargne en cours vient de la paie du mois d'avant.
  for (let k = count + 1; k >= -1; k--) {
    const payMonth = monthKeyOf(t.getFullYear(), t.getMonth() - k);
    const expected = expectedPayStart(payMonth, data.paydayDay, data.payslips);
    const key = savingsMonthOf(expectedPayDate(data.paydayDay, payMonth));
    anchors.set(key, { key, payMonth, ...expected });
  }
  const declared = (data.pays ?? [])
    .filter(p => p && p.kind !== 'extra' && typeof p.receivedOn === 'string' && ISO_DAY.test(p.receivedOn))
    .sort((a, b) => a.receivedOn.localeCompare(b.receivedOn) || String(a.id).localeCompare(String(b.id)));
  for (const p of declared) {
    const key = savingsMonthOfPay(p);
    const replaced = anchors.get(key);
    if (replaced?.source === 'received') continue;
    anchors.set(key, { key, start: p.receivedOn, source: 'received', payId: p.id, payMonth: replaced?.payMonth ?? p.receivedOn.slice(0, 7) });
  }
  const sorted = [...anchors.values()].filter(a => a.start <= today).sort((a, b) => a.key.localeCompare(b.key));
  // Une fenêtre s'arrête à la paie suivante : pas de chevauchement (un versement compté deux
  // fois), pas de trou. Une paie déclarée avant la paie du mois précédent (mois choisi à la
  // main) laisse ce mois-là vide plutôt que de le faire déborder. Seule la fenêtre en cours,
  // sans paie suivante connue, dure 30 jours pile.
  return sorted.map((a, i) => {
    const next = sorted[i + 1];
    const end = next ? (next.start > a.start ? next.start : a.start) : addDays(a.start, PAY_WINDOW_DAYS);
    return { ...a, end };
  }).slice(-count);
};

/** Mois d'épargne en cours : la dernière fenêtre ouverte à `today`. */
export const currentSavingsMonth = (data: PayCalendarData, today: string): PayWindow => {
  const windows = payWindows(data, today, 1);
  if (windows.length > 0) return windows[0];
  // Filet : jamais atteint (la paie du mois précédent est toujours tombée).
  const key = today.slice(0, 7);
  return { key, start: `${key}-01`, end: addDays(`${key}-01`, PAY_WINDOW_DAYS), source: 'calendar', payMonth: key };
};
