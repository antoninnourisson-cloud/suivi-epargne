// ================================================
// FILE: src/lib/payRecords.ts
// Paies reçues (GlobalAppData.pays, schéma v3) : la paie « ouverte » est celle du mois
// d'épargne en cours (lib/payCalendar). Tant que le rituel « Ma paie » n'existe pas, le
// Pilotage, la routine, la pastille et le serveur lisent la paie ouverte sous ses anciennes
// formes : liste à cocher (PayChecklist, modifiée par les commandes de lib/commands/pay) et
// réglages de la paie en cours (PayAdjustment). Fonctions pures, partagées par l'app et le
// serveur.
// ================================================
import type { AccountMovement, GlobalAppData, PayAdjustment, PayChecklist, PayRecord, SavingsAccount } from '../types';
import { currentSavingsMonth, PayCalendarData, PayWindow, savingsMonthOfPay } from './payCalendar';
import { formatISODay } from './dates';
import { round2 } from './money';

export type PayData = Pick<GlobalAppData, 'pays' | 'payslips'> & {
  config?: Pick<GlobalAppData['config'], 'paydayDay'>;
  /** Comptes : une ligne dont le versement a été supprimé à la main n'est plus « faite ». */
  accounts?: Pick<SavingsAccount, 'id' | 'movements'>[];
};

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

/** Identifiant libre pour une paie du mois d'épargne `savingsMonth` ('pay-2026-11', puis '-2'…). */
export const newPayId = (pays: Pick<PayRecord, 'id'>[], savingsMonth: string): string => {
  let id = `pay-${savingsMonth}`;
  for (let n = 2; pays.some(p => p.id === id); n++) id = `pay-${savingsMonth}-${n}`;
  return id;
};

/**
 * Une deuxième paie sur un mois d'épargne qui en a déjà une est proposée comme « versement en
 * plus » (prime à part, deuxième employeur) : elle n'ouvre pas de nouveau mois.
 */
export const suggestedPayKind = (pays: PayRecord[] = [], savingsMonth: string, exceptId?: string): 'extra' | undefined =>
  pays.some(p => p.id !== exceptId && p.kind !== 'extra' && savingsMonthOfPay(p) === savingsMonth) ? 'extra' : undefined;

// ---------------------------------------------------------------------------
// Versements rattachés à une paie
// ---------------------------------------------------------------------------

type MovementHolder = Pick<SavingsAccount, 'id' | 'movements'>;

/** Mouvement d'un des comptes, s'il existe encore (avec son compte). */
export const findMovement = (accounts: MovementHolder[], movementId: string): { accountId: string; movement: AccountMovement } | undefined => {
  for (const a of accounts) {
    const movement = (a.movements ?? []).find(m => m.id === movementId);
    if (movement) return { accountId: a.id, movement };
  }
  return undefined;
};

/**
 * Coches encore valables : une ligne dont le versement a été supprimé à la main (Journal,
 * fiche du compte) redevient à faire. Les coches sans versement (virements de la paie, « Déjà
 * enregistré ») restent.
 */
export const liveDone = (done: PayChecklist['done'], accounts: MovementHolder[]): PayChecklist['done'] =>
  Object.fromEntries(Object.entries(done).filter(([, d]) => !d.movementId || findMovement(accounts, d.movementId)));

/** Versements créés par cette paie et toujours présents (pour « Supprimer cette paie »). */
export const payMovements = (pay: Pick<PayRecord, 'done'>, accounts: MovementHolder[]) =>
  Object.values(pay.done).flatMap(d => {
    const found = d.movementId ? findMovement(accounts, d.movementId) : undefined;
    return found ? [found] : [];
  });

/** Paie à créer pour le mois d'épargne en cours, reçue au début de la fenêtre. */
const newPay = (pays: PayRecord[], window: PayWindow, amount: number): PayRecord => {
  const id = newPayId(pays, window.key);
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
 * celui de payPeriodOf). `undefined` tant que le plan n'est pas figé (rien de coché). Avec
 * les comptes, une ligne dont le versement a disparu n'est plus cochée.
 */
export const payChecklistOf = (data: PayData, asOf: Date = new Date()): PayChecklist | undefined => {
  const { window, pay } = openPay(data, asOf);
  if (!pay || pay.lines.length === 0) return undefined;
  return { month: window.payMonth, lines: pay.lines, done: data.accounts ? liveDone(pay.done, data.accounts) : pay.done };
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
