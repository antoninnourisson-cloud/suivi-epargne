// ================================================
// FILE: src/lib/payRecords.ts
// Paies reçues (GlobalAppData.pays, schéma v3) : la paie « ouverte » est celle du mois
// d'épargne en cours (lib/payCalendar), déclarée par le rituel « J'ai reçu ma paie ». Le
// Pilotage et le serveur lisent encore ses lignes sous leur forme historique de liste à cocher
// (PayChecklist, modifiée par les commandes de lib/commands/pay). Ici aussi : les versements
// rattachés, le lien paie ↔ fiche de paie et le bilan du mois validé. Fonctions pures,
// partagées par l'app et le serveur.
// ================================================
import type { AccountMovement, GlobalAppData, PayChecklist, PayRecord, PayslipRecord, SavingsAccount } from '../types';
import { currentSavingsMonth, PayCalendarData, PayWindow, savingsMonthOfPay, shiftMonth } from './payCalendar';
import { formatISODay } from './dates';

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
// Fiche de paie de la paie
// ---------------------------------------------------------------------------

/**
 * Mois de la fiche de paie qui correspond à une paie ('YYYY-MM') : le mois qui précède son
 * mois d'épargne (paie du 27 octobre ou du 3 novembre, épargne de novembre : fiche
 * d'octobre). Même lien dans les deux sens, quelle que soit la date de réception.
 */
export const payslipPeriodOf = (savingsMonth: string): string => shiftMonth(savingsMonth, -1);

/** Paie déclarée (hors versement en plus) qu'une fiche de la période `period` concerne. */
export const payForPayslipPeriod = (pays: PayRecord[] = [], period: string | undefined): PayRecord | undefined => {
  if (!period || !/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) return undefined;
  const month = shiftMonth(period, 1);
  return pays.find(p => p.kind !== 'extra' && savingsMonthOfPay(p) === month);
};

/**
 * Fiche de paie d'une paie : celle qui lui est liée, sinon la plus récente du mois
 * correspondant (une fiche « qui s'ajoute », deuxième employeur, ne la remplace pas).
 */
export const payslipForMonth = (payslips: PayslipRecord[] = [], savingsMonth: string, payslipId?: string): PayslipRecord | undefined => {
  const linked = payslipId ? payslips.find(p => p.id === payslipId) : undefined;
  if (linked) return linked;
  const period = payslipPeriodOf(savingsMonth);
  return payslips
    .filter(p => p.extracted?.period === period && !p.addsToPeriod)
    .sort((a, b) => String(b.addedAt).localeCompare(String(a.addedAt)))[0];
};

// ---------------------------------------------------------------------------
// Bilan du mois d'épargne (point de paie)
// ---------------------------------------------------------------------------

/** Bilan du mois d'épargne `key` déjà validé : dans le rituel (reviewedAt) ou sur l'Accueil. */
export const isPayReviewDone = (key: string, payReviewsDone: string[] = [], pays: PayRecord[] = []): boolean =>
  payReviewsDone.includes(key) || pays.some(p => p.kind !== 'extra' && savingsMonthOfPay(p) === key && !!p.reviewedAt);

/** Paies après la validation du bilan `key` : la paie de ce mois, si elle existe, le note. */
export const withPayReviewed = (pays: PayRecord[] = [], key: string, today: string): PayRecord[] => {
  const pay = pays.find(p => p.kind !== 'extra' && savingsMonthOfPay(p) === key);
  return pay && !pay.reviewedAt ? pays.map(p => (p === pay ? { ...p, reviewedAt: today } : p)) : pays;
};
