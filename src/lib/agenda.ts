// ================================================
// FILE: src/lib/agenda.ts
// Agenda financier et bilan annuel : rassemble des dates et des chiffres déjà connus de
// l'app (paies, prélèvements, révisions de taux, restitution, échéances fiscales…).
// Fonctions pures, testées.
// ================================================
import { GlobalAppData, AccountType } from '../types';
import { formatISODay, parseISODate } from './dates';
import {
  nextSubscriptionDate, isMonthlyCharge, computeMaturityCountdown, tracksDeposits,
  computeMonthlySavingsCapacity, computeMonthSavedAmount, computeAccruedInterest,
  computeAccountBalanceAtDate, computeMonthlyPay, computeDonationSummary,
  computeAccruedParentalInterest, effectivePayday, subscriptionMonthlyCost,
} from './finance';
import { DEFAULT_FISCAL_CONFIG } from '../constants';

export type AgendaKind = 'payday' | 'subscription' | 'recurring' | 'rates' | 'restitution' | 'fiscal' | 'statement' | 'donations' | 'review' | 'maturity';

export interface AgendaEvent {
  date: string;      // 'YYYY-MM-DD'
  kind: AgendaKind;
  title: string;
  detail?: string;
  amount?: number;
  view?: string;     // écran à ouvrir
}

const addMonths = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth() + n, d.getDate());

/**
 * Événements des `months` prochains mois, du plus proche au plus lointain. Les
 * prélèvements mensuels et échéances récurrentes ne sont listés que sur deux mois pour ne
 * pas noyer le reste ; les annuels, sur tout l'horizon. Les maturités fiscales lointaines
 * sont renvoyées à part (`later`).
 */
export const buildAgenda = (data: GlobalAppData, asOfDate: Date = new Date(), months = 12): { events: AgendaEvent[]; later: AgendaEvent[] } => {
  const today = new Date(asOfDate.getFullYear(), asOfDate.getMonth(), asOfDate.getDate());
  const horizon = addMonths(today, months);
  const shortHorizon = addMonths(today, 2);
  const accounts = data.accounts || [];
  const events: AgendaEvent[] = [];
  const push = (d: Date, e: Omit<AgendaEvent, 'date'>) => { if (d >= today && d <= horizon) events.push({ ...e, date: formatISODay(d) }); };

  // Paies (les trois prochaines).
  const payday = data.config?.paydayDay;
  if (payday) {
    const amount = data.config.paydayAmount ?? computeMonthlySavingsCapacity(data);
    for (let k = 0, found = 0; found < 3 && k < 4; k++) {
      const y = today.getFullYear(), m = today.getMonth() + k;
      const d = new Date(y, m, effectivePayday(payday, new Date(y, m, 1).getFullYear(), new Date(y, m, 1).getMonth()));
      if (d < today) continue;
      push(d, { kind: 'payday', title: 'Paie', detail: amount > 0 ? 'Virements à faire et à cocher dans le Pilotage' : undefined, amount: amount > 0 ? amount : undefined, view: 'pilot' });
      found++;
    }
  }

  // Abonnements.
  for (const s of data.subscriptions || []) {
    if (!s.active || s.amount <= 0 || !s.anchorDate) continue;
    const limit = isMonthlyCharge(s) ? shortHorizon : horizon;
    let d = nextSubscriptionDate(s, today);
    for (let guard = 0; d <= limit && guard < 60; guard++) {
      push(d, { kind: 'subscription', title: s.name, detail: s.debitAccount || undefined, amount: s.amount, view: 'subscriptions' });
      d = nextSubscriptionDate(s, new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1));
    }
  }

  // Échéances récurrentes (versements/retraits mensuels).
  for (const r of data.recurringMovements || []) {
    if (!r.active) continue;
    const account = accounts.find(a => a.id === r.accountId);
    if (!account) continue; // compte supprimé depuis
    for (let k = 0; k < 3; k++) {
      const y = today.getFullYear(), m = today.getMonth() + k;
      const d = new Date(y, m, Math.min(Math.max(1, Math.round(r.dayOfMonth)), new Date(y, m + 1, 0).getDate()));
      if (d >= today && d <= shortHorizon) push(d, { kind: 'recurring', title: r.label, detail: account?.name, amount: r.type === 'IN' ? r.amount : -r.amount, view: 'dashboard' });
    }
  }

  // Révisions des taux réglementés (1er février, 1er août).
  for (let y = today.getFullYear(); y <= horizon.getFullYear(); y++) {
    push(new Date(y, 1, 1), { kind: 'rates', title: 'Révision des taux réglementés', detail: 'Livret A, LDDS, LEP : reportez les nouveaux taux', view: 'accounts' });
    push(new Date(y, 7, 1), { kind: 'rates', title: 'Révision des taux réglementés', detail: 'Livret A, LDDS, LEP : reportez les nouveaux taux', view: 'accounts' });
  }

  // Restitution du capital parental.
  const restitution = data.parentalRestitution;
  if (restitution?.plannedDate && !restitution.done) {
    const total = accounts.reduce((s, a) => s + a.parentalCapital, 0);
    push(parseISODate(restitution.plannedDate), { kind: 'restitution', title: 'Restitution du capital de vos parents', amount: total > 0 ? total : undefined, view: 'parental' });
  }

  // Rendez-vous annuels.
  const hasTracked = accounts.some(a => tracksDeposits(a.type) && a.totalAmount > 0);
  for (let y = today.getFullYear(); y <= horizon.getFullYear(); y++) {
    push(new Date(y, 0, 2), { kind: 'review', title: `Bilan de l'année ${y - 1}`, detail: 'Dans Historique', view: 'history' });
    if (hasTracked) push(new Date(y, 0, 15), { kind: 'statement', title: 'Relevés annuels des placements', detail: accounts.some(a => a.type === AccountType.ASSURANCE_VIE) ? 'Valeur au 31/12, versements et taux servi du fonds euros' : 'Valeur au 31/12 et versements', view: 'update' });
    push(new Date(y, 0, 20), { kind: 'fiscal', title: 'Paramètres fiscaux de l\'année', detail: 'Barème de l\'impôt, plafond LEP, abattement', view: 'settings' });
    if ((data.donations || []).length > 0) {
      const d = computeDonationSummary(data.donations || [], y - 1);
      push(new Date(y, 3, 10), { kind: 'donations', title: 'Déclaration de revenus', detail: d.count > 0 ? `Dons ${y - 1} à déclarer` : 'Ouverture de la déclaration en ligne', amount: d.count > 0 ? d.total : undefined, view: 'donations' });
    }
  }

  // Maturités fiscales (PEA, Assurance Vie…).
  const later: AgendaEvent[] = [];
  for (const a of accounts) {
    const m = computeMaturityCountdown(a, data.fiscalConfig || DEFAULT_FISCAL_CONFIG, asOfDate);
    if (!m) continue;
    const e: AgendaEvent = {
      date: m.maturityDate, kind: 'maturity', title: `${a.name} : maturité fiscale`,
      detail: m.regimeAfter === 'EXONERE_IR' ? 'Gains exonérés d\'impôt sur le revenu' : 'Taux réduit et abattement annuel', view: 'yield',
    };
    if (parseISODate(m.maturityDate) <= horizon) events.push(e); else later.push(e);
  }

  events.sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind));
  later.sort((a, b) => a.date.localeCompare(b.date));
  return { events, later };
};

// ---------------------------------------------------------------------------
// Bilan annuel
// ---------------------------------------------------------------------------

export interface YearReview {
  year: number;
  complete: boolean;               // false : année en cours, chiffres partiels
  saved: number;                   // versements − retraits sur l'épargne (hors valorisation)
  monthly: { month: number; saved: number }[];
  best?: { month: number; saved: number };
  worst?: { month: number; saved: number };
  savingsRate: number | null;      // part de la paie actuelle × 12 (approximation)
  interest: number;                // intérêts de l'année (attendus si année en cours)
  parentalInterest: number;        // dont produits par le capital parental
  netStart: number;                // épargne nette (part propre) en début d'année
  netStartDate?: string;           // date du relevé mensuel utilisé comme point de départ
  netEnd: number;                  // … au 31/12 (ou aujourd'hui)
  // Écart entre l'évolution réelle de l'épargne (relevés mensuels) et la somme des
  // mouvements : des soldes ont été modifiés sans mouvement (ancienne version, part des
  // parents corrigée…). Valeur absolue ≥ 100 € seulement.
  unexplainedGap?: number;
  donations: number;
  subscriptionsYearly: number;     // coût annuel des abonnements actifs (aujourd'hui)
  restitution?: { date: string; amount: number };
}

export const computeYearReview = (data: GlobalAppData, year: number, asOfDate: Date = new Date()): YearReview => {
  const accounts = data.accounts || [];
  const complete = asOfDate >= new Date(year + 1, 0, 1);
  const monthly: { month: number; saved: number }[] = [];
  for (let m = 0; m < 12; m++) {
    const end = new Date(year, m + 1, 0);
    if (new Date(year, m, 1) > asOfDate) break;
    monthly.push({ month: m, saved: computeMonthSavedAmount(accounts, end > asOfDate ? asOfDate : end, data.config?.trackingStartDate) });
  }
  const saved = monthly.reduce((s, x) => s + x.saved, 0);
  const sorted = [...monthly].sort((a, b) => b.saved - a.saved);
  const pay = computeMonthlyPay(data);
  const interest = accounts.reduce((s, a) => s + computeAccruedInterest(a, year, new Date(year + 1, 0, 1)), 0);
  const done = data.parentalRestitution?.done;
  const offered = done?.interestsOffered.find(i => i.year === year)?.amount;
  const parentalInterest = offered ?? computeAccruedParentalInterest(accounts, year, new Date(year + 1, 0, 1)).totalAnnualParental;
  const endISO = complete ? `${year}-12-31` : formatISODay(asOfDate);
  // Point de départ : le relevé mensuel le plus proche du 1er janvier (dernier de l'année
  // précédente, sinon premier de l'année). Plus fiable que la reconstitution par les
  // mouvements, qui peut être incomplète.
  const snaps = [...(data.history || [])].sort((a, b) => a.date.localeCompare(b.date));
  const startSnap = snaps.filter(x => x.date < `${year}-01-01`).pop() ?? snaps.find(x => x.date.startsWith(`${year}-`));
  const netStart = startSnap ? startSnap.ownedAmount : computeAccountBalanceAtDate(accounts, `${year - 1}-12-31`);
  const netEnd = computeAccountBalanceAtDate(accounts, endISO);
  // Un relevé mensuel garde la date de son premier enregistrement mais les soldes de FIN de
  // mois : les mouvements comptent donc à partir du dernier jour de ce mois-là.
  const flowsFrom = startSnap
    ? formatISODay(new Date(Number(startSnap.date.slice(0, 4)), Number(startSnap.date.slice(5, 7)), 0))
    : `${year - 1}-12-31`;
  const flowsSinceStart = accounts.reduce((sum, a) => sum + (a.movements || [])
    .filter(m => m.kind !== 'valuation' && m.kind !== 'parental' && m.kind !== 'adjustment' && m.label !== 'Solde initial' && m.date > flowsFrom && m.date <= endISO)
    .reduce((t, m) => t + (m.type === 'IN' ? m.amount : -m.amount), 0), 0);
  const gap = (netEnd - netStart) - flowsSinceStart;
  const restitutionThisYear = done && (done.date.startsWith(`${year}-`) || done.date === `${year + 1}-01-01`)
    ? { date: done.date, amount: done.accounts.reduce((s, a) => s + a.amount, 0) } : undefined;
  return {
    year, complete, saved, monthly,
    best: sorted[0], worst: sorted[sorted.length - 1],
    savingsRate: pay > 0 && monthly.length > 0 ? (saved / (pay * monthly.length)) * 100 : null,
    interest, parentalInterest,
    netStart, netStartDate: startSnap?.date, netEnd,
    unexplainedGap: Math.abs(gap) >= 100 ? gap : undefined,
    donations: computeDonationSummary(data.donations || [], year).total,
    subscriptionsYearly: (data.subscriptions || []).filter(s => s.active).reduce((s, x) => s + subscriptionMonthlyCost(x) * 12, 0),
    restitution: restitutionThisYear,
  };
};
