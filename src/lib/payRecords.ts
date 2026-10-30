// ================================================
// FILE: src/lib/payRecords.ts
// Paies reçues (GlobalAppData.pays, schéma v3) : la paie « ouverte » est celle du mois
// d'épargne en cours (lib/payCalendar). Tant que le rituel « Ma paie » n'existe pas, le
// Pilotage, la routine, la pastille et le serveur lisent et modifient la paie ouverte sous
// ses anciennes formes : liste à cocher (PayChecklist) et réglages de la paie en cours
// (PayAdjustment). Fonctions pures, partagées par l'app et le serveur.
// ================================================
import type { GlobalAppData, PayAdjustment, PayChecklist, PayRecord } from '../types';
import { currentSavingsMonth, PayCalendarData, PayWindow, savingsMonthOfPay } from './payCalendar';
import { formatISODay } from './dates';
import { round2 } from './money';

export type PayData = Pick<GlobalAppData, 'pays' | 'payslips'> & { config?: Pick<GlobalAppData['config'], 'paydayDay'> };

/** Ce que la règle du mois d'épargne lit dans les données. */
export const payCalendarOf = (data: PayData): PayCalendarData => ({
  paydayDay: data.config?.paydayDay, payslips: data.payslips, pays: data.pays,
});

/** Mois d'épargne en cours et sa paie déclarée (hors versement en plus), s'il y en a une. */
export const openPay = (data: PayData, asOf: Date = new Date()): { window: PayWindow; pay?: PayRecord } => {
  const window = currentSavingsMonth(payCalendarOf(data), formatISODay(asOf));
  const pays = data.pays ?? [];
  const pay = pays.find(p => p.id === window.payId)
    ?? pays.find(p => p.kind !== 'extra' && savingsMonthOfPay(p) === window.key);
  return { window, pay };
};

/** Paie à créer pour le mois d'épargne en cours, reçue au début de la fenêtre. */
const newPay = (pays: PayRecord[], window: PayWindow, amount: number): PayRecord => {
  let id = `pay-${window.key}`;
  for (let n = 2; pays.some(p => p.id === id); n++) id = `pay-${window.key}-${n}`;
  return {
    id, receivedOn: window.start, savingsMonth: window.key,
    amount: Number.isFinite(amount) ? round2(Math.max(0, amount)) : 0, lines: [], done: {},
  };
};

const replacePay = (pays: PayRecord[], next: PayRecord) => pays.map(p => (p.id === next.id ? next : p));

// ---------------------------------------------------------------------------
// Liste à cocher (Pilotage › Où le placer)
// ---------------------------------------------------------------------------

/**
 * Liste figée de la paie ouverte, sous sa forme historique (`month` = mois de versement,
 * celui de payPeriodOf). `undefined` tant que le plan n'est pas figé (rien de coché).
 */
export const payChecklistOf = (data: PayData, asOf: Date = new Date()): PayChecklist | undefined => {
  const { window, pay } = openPay(data, asOf);
  if (!pay || pay.lines.length === 0) return undefined;
  return { month: window.payMonth, lines: pay.lines, done: pay.done };
};

/**
 * Paies après une modification de la liste : lignes et coches enregistrées sur la paie
 * ouverte (créée au début du mois d'épargne, au montant `amount` de la paie théorique, si
 * elle n'existe pas). `undefined` défige le plan : la paie reste, sans lignes ni coches.
 */
export const withPayChecklist = (data: PayData, next: PayChecklist | undefined, asOf: Date, amount: number): PayRecord[] => {
  const pays = data.pays ?? [];
  const { window, pay } = openPay(data, asOf);
  if (!next) return pay ? replacePay(pays, { ...pay, lines: [], done: {} }) : pays;
  if (pay) return replacePay(pays, { ...pay, lines: next.lines, done: next.done });
  return [...pays, { ...newPay(pays, window, amount), lines: next.lines, done: next.done }];
};

// ---------------------------------------------------------------------------
// Réglages de la paie en cours (Pilotage › Mes paramètres)
// ---------------------------------------------------------------------------

/** « Capacité d'épargne du mois » et « Somme en plus à placer » de la paie ouverte. */
export const payAdjustmentOf = (data: PayData, asOf: Date = new Date()): PayAdjustment | undefined => {
  const { window, pay } = openPay(data, asOf);
  if (!pay || (pay.toSave === undefined && !pay.bonus)) return undefined;
  return {
    period: window.payMonth,
    ...(pay.toSave !== undefined ? { capacity: pay.toSave } : {}),
    ...(pay.bonus ? { extra: pay.bonus } : {}),
  };
};

/**
 * Paies après un réglage de la paie en cours (lib/payAdjustment, updatePayAdjustment) :
 * `toSave` et `bonus` de la paie ouverte, créée au besoin. Le montant reçu suit la somme en
 * plus (« prime comprise »).
 */
export const withPayAdjustment = (data: PayData, next: PayAdjustment | undefined, asOf: Date, amount: number): PayRecord[] => {
  const pays = data.pays ?? [];
  const { window, pay } = openPay(data, asOf);
  if (!pay && !next) return pays;
  const base = pay ?? newPay(pays, window, amount);
  const { toSave: _t, bonus: _b, ...rest } = base;
  const bonus = next?.extra ? round2(next.extra) : undefined;
  const updated: PayRecord = {
    ...rest,
    amount: round2(base.amount - (base.bonus ?? 0) + (bonus ?? 0)),
    ...(next?.capacity !== undefined ? { toSave: round2(next.capacity) } : {}),
    ...(bonus !== undefined ? { bonus } : {}),
  };
  return pay ? replacePay(pays, updated) : [...pays, updated];
};
