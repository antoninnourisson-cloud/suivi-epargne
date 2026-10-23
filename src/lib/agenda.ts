// ================================================
// FILE: src/lib/agenda.ts
// Agenda financier et bilan annuel : rassemble des dates et des chiffres déjà connus de
// l'app (paies, prélèvements, révisions de taux, restitution, échéances fiscales…).
// Fonctions pures, testées.
// ================================================
import { GlobalAppData, AccountType } from '../types';
import { formatISODay, parseISODate } from './dates';
import {
  nextSubscriptionDate, isMonthlyCharge, computeMaturityCountdown, describeMaturity, computePeeAvailability, tracksDeposits,
  computeMonthlySavingsCapacity, computeMonthSavedAmount, computeAccruedInterest,
  computeAccountBalanceAtDate, computeMonthlyPay, computeDonationSummary,
  computeAccruedParentalInterest, effectivePayday, subscriptionMonthlyCost, payPeriodOf,
} from './finance';
import { computeMonthTarget } from './payAdjustment';
import { DEFAULT_FISCAL_CONFIG } from '../constants';
import { signedAmount } from './money';
import { lepTimelineFromData } from './lep';
import { buildTaxReturnChecklist, taxReturnTopics } from './taxReturn';
import { closingApplies, isYearClosed } from './yearClosing';

export type AgendaKind = 'payday' | 'subscription' | 'recurring' | 'rates' | 'restitution' | 'fiscal' | 'statement' | 'donations' | 'review' | 'maturity' | 'lep';

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

  // Paies (les trois prochaines). Le jour de la paie, la ligne reprend l'objectif de la paie
  // en cours (réglages du Pilotage compris, comme la jauge de l'Accueil) ; les suivantes, le
  // montant habituel (rappel de paie ou capacité calculée).
  const payday = data.config?.paydayDay;
  if (payday) {
    const recurring = data.config.paydayAmount ?? computeMonthlySavingsCapacity(data);
    const currentPayDay = formatISODay(payPeriodOf(payday, asOfDate).payDate);
    for (let k = 0, found = 0; found < 3 && k < 4; k++) {
      const y = today.getFullYear(), m = today.getMonth() + k;
      const d = new Date(y, m, effectivePayday(payday, new Date(y, m, 1).getFullYear(), new Date(y, m, 1).getMonth()));
      if (d < today) continue;
      const amount = formatISODay(d) === currentPayDay ? computeMonthTarget(data, asOfDate).total : recurring;
      // Le montant est ce qu'il faut PLACER, pas la paie reçue : le détail le dit (un seul nom
      // par montant, comme « l'objectif » du Pilotage et de l'Accueil).
      push(d, { kind: 'payday', title: 'Jour de paie', detail: amount > 0 ? 'Montant à placer : virements à faire et à cocher dans le Pilotage' : undefined, amount: amount > 0 ? amount : undefined, view: 'pilot' });
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
      if (d >= today && d <= shortHorizon) push(d, { kind: 'recurring', title: r.label, detail: account?.name, amount: signedAmount(r), view: 'dashboard' });
    }
  }

  // Révisions des taux réglementés (1er février, 1er août).
  for (let y = today.getFullYear(); y <= horizon.getFullYear(); y++) {
    push(new Date(y, 1, 1), { kind: 'rates', title: 'Révision des taux réglementés', detail: 'Livret A, LDDS, LEP : reportez les nouveaux taux', view: 'accounts' });
    push(new Date(y, 7, 1), { kind: 'rates', title: 'Révision des taux réglementés', detail: 'Livret A, LDDS, LEP : reportez les nouveaux taux', view: 'accounts' });
  }

  // Fermeture probable du LEP (revenus au-dessus du plafond deux années de suite).
  const lep = lepTimelineFromData(data, asOfDate);
  if (lep?.closeBy && (lep.status === 'closing' || lep.status === 'one-over')) {
    push(parseISODate(lep.closeBy), {
      kind: 'lep', title: lep.status === 'closing' ? 'Fermeture probable de votre LEP' : 'Fermeture possible de votre LEP',
      detail: lep.status === 'closing' ? 'Revenus au-dessus du plafond deux années de suite' : `Si vos revenus ${lep.overYear! + 1} dépassent aussi le plafond`,
      view: 'accounts',
    });
  }

  // Restitution du capital parental.
  const restitution = data.parentalRestitution;
  if (restitution?.plannedDate && !restitution.done) {
    const total = accounts.reduce((s, a) => s + a.parentalCapital, 0);
    push(parseISODate(restitution.plannedDate), { kind: 'restitution', title: 'Restitution du capital de vos parents', amount: total > 0 ? total : undefined, view: 'parental' });
  }

  // Rendez-vous annuels.
  // Clôture de l'année écoulée (lib/yearClosing) : un seul rendez-vous au lieu du bilan, des
  // relevés annuels et des paramètres fiscaux séparés. Une fois l'année clôturée (ou sans année
  // à clôturer : tout premier usage), les paramètres fiscaux reviennent seuls le 20 janvier,
  // s'ils restent à vérifier.
  const hasTracked = accounts.some(a => tracksDeposits(a.type) && a.totalAmount > 0);
  for (let y = today.getFullYear(); y <= horizon.getFullYear(); y++) {
    if (!isYearClosed(data.config, y - 1) && closingApplies(data, y - 1)) push(new Date(y, 0, 2), {
      kind: 'review', title: `Clôture de l'année ${y - 1}`,
      detail: `Soldes au 31 décembre, intérêts${hasTracked ? `, relevés des placements${accounts.some(a => a.type === AccountType.ASSURANCE_VIE) ? ' et taux servi' : ''}` : ''}, paramètres fiscaux, bilan et archive, dans Historique`,
      view: 'history',
    });
    else if ((data.fiscalConfig?.paramsReviewedYear ?? 0) < y) push(new Date(y, 0, 20), { kind: 'fiscal', title: 'Paramètres fiscaux de l\'année', detail: 'Barème de l\'impôt, plafond LEP, abattement', view: 'settings' });
    // Déclaration de revenus, pour tout le monde : l'ouverture en ligne tombe en avril (le
    // 9 avril en 2026) ; le calendrier exact n'est publié qu'au printemps (voir lib/taxReturn).
    const topics = taxReturnTopics(buildTaxReturnChecklist(data, y - 1));
    push(new Date(y, 3, 10), {
      kind: 'fiscal', title: `Déclaration des revenus ${y - 1}`,
      detail: `${topics.length > 0 ? `${topics.length} point${topics.length > 1 ? 's' : ''} à vérifier · ` : ''}ouverture en ligne en avril, date limite fin mai ou début juin selon le département`,
      view: 'donations',
    });
  }

  // Maturités fiscales (PEA, Assurance Vie…).
  const later: AgendaEvent[] = [];
  for (const a of accounts) {
    const fiscal = data.fiscalConfig || DEFAULT_FISCAL_CONFIG;
    let e: AgendaEvent | undefined;
    if (a.type === AccountType.PEE) {
      // PEE : pas de maturité fiscale (toujours sans impôt sur le revenu), mais chaque
      // versement se débloque 5 ans après sa date.
      const r = computePeeAvailability(a, fiscal, asOfDate).nextRelease;
      if (r) e = { date: r.date, kind: 'maturity', title: `${a.name} : versements débloqués`, detail: r.last ? 'Tout votre plan devient disponible' : 'Une partie de votre plan devient disponible', amount: Math.round(r.amount), view: 'accounts' };
    } else {
      const m = computeMaturityCountdown(a, fiscal, asOfDate);
      if (m) e = { date: m.maturityDate, kind: 'maturity', title: `${a.name} : maturité fiscale`, detail: describeMaturity(a, m, fiscal).detail, view: 'yield' };
    }
    if (!e) continue;
    if (parseISODate(e.date) <= horizon) events.push(e); else later.push(e);
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
    .reduce((t, m) => t + (signedAmount(m)), 0), 0);
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
