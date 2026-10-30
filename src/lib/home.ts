// Règles de l'Accueil (écran Dashboard), en fonctions pures testées : l'écran ne garde que
// l'état d'affichage et le rendu.
// - votre épargne « à ce jour » (mouvements datés dans le futur neutralisés) ;
// - livrets presque pleins, comptes vides inactifs, dernière actualisation, prélèvements à venir ;
// - courbe d'épargne compte par compte sur une période, projection et dérive du rythme ;
// - jauge « Placé depuis la paie » ;
// - liste « À faire » (buildHomeTodos), sans JSX : textes et actions nommées, que l'écran
//   relie à ses icônes et à ses gestionnaires.
// La disponibilité (« disponible / avec impôt / bloqué ») est celle de lib/finance/availability,
// fondée sur la date anniversaire comme Rendement et le compte à rebours : il n'y a plus de
// calcul de maturité propre à l'Accueil.
import { AccountType, type FiscalConfig, type PayslipRecord, type PortfolioSnapshot, type SavingsAccount, type Subscription } from '../types';
import { payAttribution, savedBetween, savingsTrackingFrom } from './motivation';
import { expectedPayDate, payWindows, shiftMonth, type PayCalendarData } from './payCalendar';
import type { View } from '../navigation';
import type { Alert, AlertGain, AlertKind } from './alerts';
import type { LepTimeline } from './lep';
import { describeLepTimeline } from './lep';
import type { TaxReturnAlert } from './taxReturn';
import type { EmergencyFund } from './planning';
import { describeStaleBalances, type StaleBalance } from './freshness';
import type { YearClosingStatus } from './yearClosing';
import type { AgendaEvent } from './agenda';
import {
  computeAccountBalanceAtDate, computeAccruedParentalInterest, computeRecentSavingsRate, nextSubscriptionDate,
  ownedAmountAt,
  type AvailabilityBreakdown, type DueRecurring, type FiscalReview, type MonthSavingsRate,
} from './finance';
import { MS_PER_DAY, daysBetween, formatISODay, parseISODate } from './dates';
import { round2, signedAmount } from './money';
import { csvAmount, type CsvCell } from './csv';
import { elideDe, formatEUR, formatMonth, formatPeriod, frenchDay } from './format';

// ---------------------------------------------------------------------------
// Votre épargne à ce jour
// ---------------------------------------------------------------------------

/**
 * Votre part, tous comptes confondus, à la date `today` : les mouvements datés après sont
 * neutralisés, comme sur la courbe (sinon la carte et le dernier point divergeaient).
 */
export const savingsOn = (accounts: SavingsAccount[], today: string): number =>
  accounts.reduce((s, a) => s + ownedAmountAt(a, today), 0);

/** Évolution de votre part depuis le point mensuel du mois précédent (null sans point). */
export const monthDelta = (history: PortfolioSnapshot[], current: number, today: string): number | null => {
  const monthStart = `${today.slice(0, 7)}-01`;
  const prev = history.filter(h => h.date < monthStart).sort((a, b) => a.date.localeCompare(b.date)).pop();
  return prev && prev.ownedAmount !== undefined ? current - prev.ownedAmount : null;
};

// ---------------------------------------------------------------------------
// Signaux de l'Accueil
// ---------------------------------------------------------------------------

export interface CeilingAlert { id: string; name: string; pct: number; remaining: number }

/**
 * Livrets réglementés presque pleins (90 à 100 % du plafond), le plus rempli d'abord. Le
 * plafond saisi sur le compte prime sur celui des paramètres. Un livret déjà plein n'appelle
 * aucune action (le plan de placement l'ignore déjà) : il n'est pas rappelé.
 */
export const findCeilingAlerts = (accounts: SavingsAccount[], fiscalConfig: Pick<FiscalConfig, 'ceilings'>): CeilingAlert[] => {
  const defaults: Partial<Record<AccountType, number>> = {
    [AccountType.LIVRET_A]: fiscalConfig.ceilings.livretA,
    [AccountType.LDDS]: fiscalConfig.ceilings.ldds,
    [AccountType.LEP]: fiscalConfig.ceilings.lep,
  };
  return accounts
    .map(a => ({ a, ceiling: a.ceiling && a.ceiling > 0 ? a.ceiling : (defaults[a.type] || 0) }))
    .filter(({ ceiling }) => ceiling > 0)
    .map(({ a, ceiling }) => ({ id: a.id, name: a.name, pct: (a.totalAmount / ceiling) * 100, remaining: ceiling - a.totalAmount }))
    .filter(x => x.pct >= 90 && x.pct < 100)
    .sort((x, y) => y.pct - x.pct);
};

/** Comptes à 0 € sans mouvement depuis 60 jours (ou jamais alimentés) : candidats à la suppression. */
export const findInactiveEmptyAccounts = (accounts: SavingsAccount[], now: Date): SavingsAccount[] =>
  accounts.filter(a => {
    if (a.totalAmount !== 0) return false;
    const last = a.movements.reduce<string | null>((max, m) => (!max || m.date > max ? m.date : max), null);
    const ref = last ?? a.openingDate;
    if (!ref) return true; // aucune date connue, jamais alimenté
    return (now.getTime() - parseISODate(ref).getTime()) / MS_PER_DAY >= 60;
  });

/**
 * Jours depuis le dernier mouvement enregistré (tous comptes), null s'il n'y en a aucun. Les
 * mouvements datés dans le futur sont ignorés : un seul rendait le compteur négatif.
 */
export const daysSinceLastMovement = (accounts: SavingsAccount[], now: Date): number | null => {
  const today = formatISODay(now);
  let latest: string | null = null;
  for (const a of accounts) for (const m of a.movements) {
    if (m.date <= today && (!latest || m.date > latest)) latest = m.date;
  }
  return latest ? Math.floor((now.getTime() - parseISODate(latest).getTime()) / MS_PER_DAY) : null;
};

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

/**
 * Intérêts produits cette année par le capital des parents, rappelés en décembre seulement
 * (ils vous reviennent, le capital reste à eux). Intérêts réellement acquis, pas extrapolés.
 */
export const parentalYearEndInterest = (accounts: SavingsAccount[], now: Date): number | null => {
  if (now.getMonth() !== 11) return null;
  const { totalAnnualParental } = computeAccruedParentalInterest(accounts, now.getFullYear(), now);
  return totalAnnualParental > 1 ? totalAnnualParental : null;
};

/** Placements dont l'argent n'est pas disponible tout de suite (zones hachurées de la courbe). */
export const isConstrainedAccount = (type: AccountType): boolean =>
  [AccountType.ASSURANCE_VIE, AccountType.PEA, AccountType.PEE, AccountType.PER].includes(type);

// ---------------------------------------------------------------------------
// Courbe d'épargne (section « Plus de détails »)
// ---------------------------------------------------------------------------

export type StackedPoint = { date: string; displayDate: string; total?: number; [accountId: string]: string | number | undefined };
export interface DateRange { start: string; end: string }

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
/** Période lue sur l'appareil : deux dates AAAA-MM-JJ (une valeur abîmée cassait le graphique). */
export const isDateRange = (v: unknown): v is DateRange =>
  !!v && typeof v === 'object' && typeof (v as DateRange).start === 'string' && typeof (v as DateRange).end === 'string'
  && ISO_DAY.test((v as DateRange).start) && ISO_DAY.test((v as DateRange).end);

/**
 * Ce qui empêche d'utiliser la période saisie : une date effacée (« missing ») ou une date de
 * début après la date de fin (« reversed ») ; null si elle est utilisable. Les deux cas ont
 * chacun leur message : dire « inversée » quand une date manque envoyait chercher ailleurs.
 */
export const dateRangeProblem = (range: DateRange): 'missing' | 'reversed' | null => {
  if (!isDateRange(range)) return 'missing';
  return range.start <= range.end ? null : 'reversed';
};

/**
 * Six derniers mois, en heure locale. Le jour est borné au dernier jour du mois visé
 * (`setMonth(-6)` un 31 débordait : 31 février → 3 mars).
 */
export const defaultDateRange = (now: Date): DateRange => {
  const lastDay = new Date(now.getFullYear(), now.getMonth() - 5, 0).getDate();
  const start = new Date(now.getFullYear(), now.getMonth() - 6, Math.min(now.getDate(), lastDay));
  return { start: formatISODay(start), end: formatISODay(now) };
};

/** Au-delà, la plage est raccourcie : la boucle est journalière (environ cinq ans). */
export const MAX_SERIES_DAYS = 1830;
// Créé une fois : toLocaleDateString en recréait un à chaque jour de la boucle (33 fois plus lent).
const DAY_LABEL = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short' });

/**
 * Votre part, compte par compte, jour par jour sur la période (un point par semaine au-delà
 * de 4 mois, toutes les deux semaines au-delà de 2 ans ; le dernier jour est toujours gardé ;
 * `thin: false` garde tous les jours, pour l'export).
 * On part des soldes actuels corrigés des mouvements postérieurs à la fin, puis on remonte le
 * temps en retirant les mouvements de chaque jour. Dates en minuit LOCAL (parseISODate) :
 * le mélange UTC/local sautait le jour du passage à l'heure d'hiver.
 */
export const buildStackedSeries = (accounts: SavingsAccount[], range: DateRange, opts: { thin?: boolean } = {}): StackedPoint[] => {
  const endDate = parseISODate(range.end);
  const startDate = parseISODate(range.start);
  if (Number.isNaN(endDate.getTime()) || Number.isNaN(startDate.getTime()) || endDate < startDate) return [];
  const effectiveStart = daysBetween(startDate, endDate) > MAX_SERIES_DAYS
    ? new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate() - MAX_SERIES_DAYS)
    : startDate;

  // Départ : soldes à la date de fin, et flux par compte et par jour (index, pas de re-filtrage).
  const balances = new Map<string, number>();
  const flows = new Map<string, Map<string, number>>();
  for (const acc of accounts) {
    let atEnd = acc.ownedAmount;
    const byDate = new Map<string, number>();
    for (const m of acc.movements) {
      if (m.kind === 'parental') continue; // part des parents : hors de « mon épargne »
      const flow = signedAmount(m);
      if (m.date > range.end) atEnd -= flow;
      else byDate.set(m.date, (byDate.get(m.date) || 0) + flow);
    }
    flows.set(acc.id, byDate);
    balances.set(acc.id, atEnd);
  }

  const data: StackedPoint[] = [];
  for (let d = new Date(endDate); d >= effectiveStart; d.setDate(d.getDate() - 1)) {
    const date = formatISODay(d);
    const point: StackedPoint = { date, displayDate: DAY_LABEL.format(d) };
    let total = 0;
    balances.forEach((amount, id) => { const v = round2(amount); point[id] = v; total += v; });
    point.total = round2(total);
    data.push(point);
    for (const acc of accounts) {
      const flow = flows.get(acc.id)?.get(date);
      if (flow) balances.set(acc.id, (balances.get(acc.id) || 0) - flow);
    }
  }
  data.reverse();
  if (opts.thin !== false && data.length > 120) {
    const step = data.length > 730 ? 14 : 7;
    return data.filter((_, i) => i % step === 0 || i === data.length - 1);
  }
  return data;
};

// ---------------------------------------------------------------------------
// Projection et rythme d'épargne
// ---------------------------------------------------------------------------

export interface SavingsProjection {
  monthlyRate: number;
  totalNow: number;
  in6: number;
  in12: number;
  /** Changement de rythme par rapport au trimestre précédent (au moins 25 %), sinon null. */
  drift: { previousMonthlyRate: number; changeRatio: number } | null;
}

/**
 * Extrapole ce qui a été placé ces 90 derniers jours (versements − retraits, comme « Placé » :
 * hors intérêts, corrections et variations de valeur ; indépendant de la période du graphique).
 * null sans historique suffisant ou à rythme quasi nul. La dérive compare au trimestre
 * précédent (jours −180 à −90), seulement si ce rythme-là n'était pas quasi nul.
 */
export const savingsProjection = (accounts: SavingsAccount[], now: Date): SavingsProjection | null => {
  const monthlyRate = computeRecentSavingsRate(accounts, 90, now);
  if (monthlyRate === null || Math.abs(monthlyRate) < 1) return null;
  const totalNow = computeAccountBalanceAtDate(accounts, formatISODay(now));
  const previousMonthlyRate = computeRecentSavingsRate(accounts, 90, new Date(now.getTime() - 90 * MS_PER_DAY));
  let drift: SavingsProjection['drift'] = null;
  if (previousMonthlyRate !== null && Math.abs(previousMonthlyRate) >= 20) {
    const changeRatio = (monthlyRate - previousMonthlyRate) / Math.abs(previousMonthlyRate);
    if (Math.abs(changeRatio) >= 0.25) drift = { previousMonthlyRate, changeRatio };
  }
  return { monthlyRate, totalNow, in6: totalNow + monthlyRate * 6, in12: totalNow + monthlyRate * 12, drift };
};

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

// ---------------------------------------------------------------------------
// Disponibilité (barre « disponible / avec impôt / bloqué »)
// ---------------------------------------------------------------------------

export interface AvailabilitySlice { key: 'available' | 'tax' | 'locked'; label: string; hint: string; amount: number }

const dayFr = (iso: string) => parseISODate(iso).toLocaleDateString('fr-FR');

export const availabilitySlices = (stats: AvailabilityBreakdown): AvailabilitySlice[] => {
  const out: AvailabilitySlice[] = [{ key: 'available', label: 'Disponible tout de suite', hint: 'Livrets et comptes courants', amount: stats.available }];
  if (stats.taxLocked > 0) out.push({ key: 'tax', label: 'Disponible avec impôt', hint: 'Assurance vie et PEA récents', amount: stats.taxLocked });
  if (stats.hardLocked > 0) {
    // PEE : chaque versement se libère 5 ans après sa date ; on annonce le prochain. Une part
    // sans date de versement connue est comptée bloquée par prudence, et on le dit.
    const next = stats.peeNextRelease;
    const hint = (next
      ? `Retraite, épargne salariale, PEL, placements à terme · ${formatEUR(next.amount, 0)} ${elideDe(next.name)} libres le ${dayFr(next.date)}`
      : 'Retraite, épargne salariale, PEL, placements à terme')
      + (stats.peeUndated ? ' · épargne salariale sans date de versement connue comptée bloquée par prudence' : '');
    out.push({ key: 'locked', label: 'Bloqué', hint, amount: stats.hardLocked });
  }
  return out;
};

// ---------------------------------------------------------------------------
// Export de la courbe (section « Plus de détails »)
// ---------------------------------------------------------------------------

export interface PeriodExport {
  /** Nom du fichier, avec les dates réellement exportées. */
  fileName: string;
  rows: CsvCell[][];
}

/**
 * Export CSV de la période choisie au-dessus de la courbe : exactement ce que montre le
 * graphique (votre part, compte par compte), un jour par ligne, sans les points espacés de
 * l'affichage. null si la période est vide ou inversée. Ce n'est pas une sauvegarde : celle-ci
 * est l'export JSON des Paramètres, le seul qui se réimporte.
 */
export const periodCsvExport = (accounts: SavingsAccount[], range: DateRange): PeriodExport | null => {
  const series = buildStackedSeries(accounts, range, { thin: false });
  if (series.length === 0) return null;
  const first = series[0].date, last = series[series.length - 1].date;
  const amount = (v: unknown) => (typeof v === 'number' ? csvAmount(v) : '');
  return {
    fileName: `pecule-evolution-${first}-au-${last}.csv`,
    rows: [
      ['Date', ...accounts.map(a => `${a.name} (€)`), 'Total, votre part (€)'],
      ...series.map(p => [p.date, ...accounts.map(a => amount(p[a.id])), amount(p.total)]),
    ],
  };
};

// ---------------------------------------------------------------------------
// Liste « À faire »
// ---------------------------------------------------------------------------

export type HomeTodoIcon =
  | 'clock' | 'repeat' | 'shield' | 'percent' | 'piggy-bank' | 'trash' | 'landmark' | 'clipboard' | 'trending-up'
  | 'alert' | 'download' | 'life-buoy' | 'wallet' | 'transfer' | 'gift' | 'file-warning' | 'calendar-check';

/** Ce que fait un bouton de la liste ; l'écran relie chaque action à son gestionnaire. */
export type HomeAction =
  | { type: 'navigate'; view: View }
  | { type: 'record-recurring'; due: DueRecurring }
  | { type: 'skip-recurring'; recurringId: string }
  | { type: 'toggle-rates-editor' }
  | { type: 'dismiss-rate-reminder'; revisionKey: string }
  | { type: 'delete-account'; accountId: string }
  | { type: 'apply-tax-scale' }
  | { type: 'confirm-fiscal-params'; year: number }
  | { type: 'open-settings' }
  | { type: 'show-tax-return' }
  | { type: 'mark-tax-return-filed'; incomeYear: number }
  | { type: 'accept-pay-raise' }
  | { type: 'dismiss-pay-raise' }
  /** « Taux inchangé » : noté sur chaque compte (`rateReviewedAt`), comme depuis la clôture. */
  | { type: 'confirm-av-rates'; accountIds: string[] }
  | { type: 'export' }
  | { type: 'open-year-closing' }
  /** Paramètres, carte « Données » : retaper le code de secours de la sauvegarde chiffrée. */
  | { type: 'check-backup-code' };

export interface HomeTodo {
  /** Stable (sert au « Plus tard ») : ne pas changer sans raison. */
  key: string;
  icon: HomeTodoIcon;
  tone: 'action' | 'info';
  text: string;
  detail?: string;
  gain?: AlertGain;
  snoozable?: boolean;
  /** En tête de la liste, avant le tri par montant (clôture de l'année en janvier-février). */
  pinned?: boolean;
  primary?: { label: string; action: HomeAction };
  secondary?: { label: string; action: HomeAction };
}

/** Ce que l'écran sait faire (un bouton n'est proposé que si son action existe). */
export interface HomeCapabilities {
  navigate: boolean;
  recordRecurring: boolean;
  deleteAccount: boolean;
  updateFiscalConfig: boolean;
  updateAccounts: boolean;
  openSettings: boolean;
  acceptPayRaise: boolean;
  dismissPayRaise: boolean;
  exportData: boolean;
}

export interface HomeTodoInput {
  now: Date;
  accounts: SavingsAccount[];
  fiscalConfig: FiscalConfig;
  can: HomeCapabilities;
  daysSinceUpdate: number | null;
  /** Comptes dont le solde est à revérifier (lib/freshness) : prime sur `daysSinceUpdate`. */
  staleBalances?: StaleBalance[];
  /** Échéances du mois pas encore enregistrées (celles écartées ce mois-ci déjà retirées). */
  dueRecurring: DueRecurring[];
  lepTimeline: LepTimeline | null;
  staleRates: { revision: { key: string; label: string }; accounts: { name: string }[] } | null;
  /** Révision des taux déjà écartée (« Taux inchangé »). */
  dismissedRateRevision: string | null;
  ratesEditorOpen: boolean;
  parentalYearEnd: number | null;
  inactiveEmpty: SavingsAccount[];
  fiscalReview: FiscalReview;
  taxReturnAlert: TaxReturnAlert | null;
  /** Année de revenus déjà déclarée (« C'est déclaré »). */
  taxReturnFiled: string | null;
  payRaise: { delta: number; period: string; hasFixedAmount: boolean } | null;
  /** Assurances vie dont le taux servi de l'an dernier reste à reporter (vide si déjà vérifié). */
  avRatesDue: SavingsAccount[];
  ceilingAlerts: CeilingAlert[];
  lastExportAt?: string;
  alerts: Alert[];
  emergency: EmergencyFund | null;
  /**
   * Clôture de l'année écoulée (lib/yearClosing) : une seule tâche en janvier-février, qui
   * remplace le taux servi de l'assurance vie, le barème et les paramètres fiscaux de l'année
   * et la copie trimestrielle (étapes de la clôture).
   */
  yearClosing?: YearClosingStatus | null;
  /**
   * Sauvegarde de secours chiffrée activée sur cet appareil et code de secours pas retapé
   * depuis un an (lib/recoveryCodeCheck, backupCodeCheckDue).
   */
  backupCodeCheckDue?: boolean;
}

const ALERT_ICONS: Record<AlertKind, HomeTodoIcon> = {
  'dormant-cash': 'wallet', 'better-rate': 'transfer', 'livret-full': 'alert', 'restitution-room': 'gift', 'payslip-anomaly': 'file-warning',
};

const eur0 = (n: number) => formatEUR(n, 0);
const dayMonth = (iso: string) => parseISODate(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });

/** Tâches et alertes de l'Accueil, dans l'ordre d'origine (TodoList les trie ensuite). */
export const buildHomeTodos = (i: HomeTodoInput): HomeTodo[] => {
  const out: HomeTodo[] = [];
  const year = i.now.getFullYear();
  const go = (label: string, view: View) => (i.can.navigate ? { label, action: { type: 'navigate', view } as HomeAction } : undefined);

  // Clôture de l'année écoulée (janvier-février, année pas encore clôturée) : une tâche pour
  // toute la liste ; ses étapes (taux servi, archive) ne sont pas rappelées en plus.
  const closing = i.yearClosing ?? null;
  const closingOpen = !!closing && closing.inSeason && !closing.closed;
  if (closing && closingOpen) out.push({
    key: `year-closing-${closing.year}`, icon: 'calendar-check', tone: 'action', snoozable: true, pinned: true,
    text: `Clôture de l'année ${closing.year} : ${closing.done} étape${closing.done > 1 ? 's' : ''} sur ${closing.total} faite${closing.done > 1 ? 's' : ''}.`,
    detail: 'Soldes au 31 décembre, intérêts, relevés, bilan et archive : tout au même endroit, dans l\'ordre.',
    primary: i.can.navigate ? { label: 'Ouvrir la clôture', action: { type: 'open-year-closing' } } : undefined,
  });

  // Fraîcheur compte par compte (lib/freshness) : le rappel nomme les comptes à revérifier.
  // Sans cette liste (anciens appelants), repli sur le dernier mouvement, tous comptes confondus.
  const staleText = i.staleBalances ? describeStaleBalances(i.staleBalances) : null;
  if (staleText) out.push({
    key: 'stale-update', icon: 'clock', tone: 'action', snoozable: true,
    text: staleText,
    primary: go('Actualiser', 'update'),
    secondary: go('Voir les comptes', 'accounts'),
  });
  else if (!i.staleBalances && i.daysSinceUpdate !== null && i.daysSinceUpdate >= 21) out.push({
    key: 'stale-update', icon: 'clock', tone: 'action', snoozable: true,
    text: `Aucune actualisation de solde depuis ${i.daysSinceUpdate} jours.`,
    primary: go('Actualiser', 'update'),
  });
  if (i.can.recordRecurring) for (const due of i.dueRecurring) {
    const r = due.recurring;
    const account = i.accounts.find(a => a.id === r.accountId)?.name ?? '';
    out.push({
      key: `rec-${r.id}-${due.dueDate}`, icon: 'repeat', tone: 'action',
      text: `Échéance du ${dayMonth(due.dueDate)} : ${r.label}, ${r.type === 'IN' ? '+' : '−'}${eur0(r.amount)} sur ${account}`,
      primary: { label: 'Enregistrer', action: { type: 'record-recurring', due } },
      secondary: { label: 'Pas ce mois-ci', action: { type: 'skip-recurring', recurringId: r.id } },
    });
  }
  const lep = i.lepTimeline;
  const lepText = describeLepTimeline(lep);
  if (lep && lepText) {
    const closing = lep.status === 'closing' || lep.status === 'closed-due';
    out.push({
      key: `lep-${lep.status}-${lep.closeBy ?? lep.overYear ?? ''}`, icon: 'shield', tone: closing ? 'action' : 'info',
      snoozable: lep.status !== 'closed-due',
      text: lepText.title, detail: lepText.detail,
      primary: lep.estimated ? go('Importer mon avis', 'settings') : go('Voir mes comptes', 'accounts'),
    });
  }
  if (i.staleRates && i.staleRates.revision.key !== i.dismissedRateRevision) out.push({
    key: 'rates', icon: 'percent', tone: 'action',
    text: `Taux réglementés révisés au ${i.staleRates.revision.label} : mettez à jour ${i.staleRates.accounts.map(a => a.name).join(', ')}.`,
    detail: 'Un taux périmé fausse le rendement, la projection et le plan de placement.',
    primary: i.can.updateAccounts ? { label: i.ratesEditorOpen ? 'Fermer' : 'Mettre à jour', action: { type: 'toggle-rates-editor' } } : undefined,
    secondary: { label: 'Taux inchangé', action: { type: 'dismiss-rate-reminder', revisionKey: i.staleRates.revision.key } },
  });
  if (i.parentalYearEnd !== null) out.push({
    key: `parental-ye-${year}`, icon: 'piggy-bank', tone: 'info', snoozable: true,
    text: `Fin d'année : le capital de vos parents a produit environ ${eur0(i.parentalYearEnd)} d'intérêts cette année. Ils vous reviennent ; le capital, lui, reste à eux.`,
    primary: go('Voir la part parentale', 'parental'),
  });
  if (i.can.deleteAccount) for (const a of i.inactiveEmpty) out.push({
    key: `empty-${a.id}`, icon: 'trash', tone: 'info', snoozable: true,
    text: `${a.name} est à 0 € et inactif.`,
    primary: { label: 'Supprimer', action: { type: 'delete-account', accountId: a.id } },
  });
  // Barème et paramètres fiscaux de la nouvelle année : une étape de la clôture tant qu'elle
  // est proposée (janvier-février, année ouverte) ; rappels à part sinon.
  if (i.can.updateFiscalConfig && i.fiscalReview.newScale && !closingOpen) out.push({
    key: `scale-${i.fiscalReview.newScale.year}`, icon: 'landmark', tone: 'action',
    text: `Nouveau barème de l'impôt : ${i.fiscalReview.newScale.label}.`,
    detail: 'Votre paie nette après impôt est encore calculée avec l\'ancien, qui restera dans l\'historique (Paramètres).',
    primary: { label: 'Appliquer', action: { type: 'apply-tax-scale' } },
  });
  if (i.can.updateFiscalConfig && i.fiscalReview.annualCheckDue && !closingOpen) out.push({
    key: `annual-${year}`, icon: 'landmark', tone: 'action',
    text: `Nouvelle année : vérifiez vos paramètres fiscaux (plafond LEP ${formatEUR(i.fiscalConfig.lepIncomeCeiling ?? 0)}, abattement plafonné à ${formatEUR(i.fiscalConfig.standardAllowanceCap ?? 0)}, barème ${i.fiscalConfig.taxScaleYear ?? 'personnalisé'}).`,
    primary: { label: 'C\'est à jour', action: { type: 'confirm-fiscal-params', year } },
    secondary: i.can.openSettings ? { label: 'Ouvrir les paramètres', action: { type: 'open-settings' } } : undefined,
  });
  const tr = i.taxReturnAlert;
  if (tr && i.taxReturnFiled !== String(tr.incomeYear)) out.push({
    key: tr.key, icon: 'clipboard', tone: 'action', snoozable: true,
    text: `${tr.title} : Pécule a préparé les cases à vérifier.`,
    detail: tr.detail,
    primary: i.can.navigate ? { label: 'Voir les cases', action: { type: 'show-tax-return' } } : undefined,
    secondary: { label: 'C\'est déclaré', action: { type: 'mark-tax-return-filed', incomeYear: tr.incomeYear } },
  });
  const raise = i.payRaise;
  if (raise) out.push({
    key: `raise-${raise.period}`, icon: 'trending-up', tone: 'action',
    text: `Votre net a augmenté de ${eur0(raise.delta)} par mois (fiche ${elideDe(formatPeriod(raise.period))}).`,
    detail: raise.hasFixedAmount
      ? `« Ajouter » augmente votre épargne mensuelle de ${eur0(raise.delta)}. Si c'est une prime ponctuelle, ignorez.`
      : '« Ajouter » base le Pilotage sur cette fiche. Si c\'est une prime ponctuelle, ignorez.',
    primary: i.can.acceptPayRaise ? { label: 'Ajouter', action: { type: 'accept-pay-raise' } } : undefined,
    secondary: i.can.dismissPayRaise ? { label: 'Ignorer', action: { type: 'dismiss-pay-raise' } } : undefined,
  });
  if (i.avRatesDue.length > 0 && !closingOpen && !closing?.closed) out.push({
    key: `av-rate-${year}`, icon: 'percent', tone: 'action',
    text: `Taux servi ${year - 1} : reportez le nouveau taux du fonds euros ${elideDe(i.avRatesDue.map(a => a.name).join(', '))}, publié par votre assureur en janvier.`,
    primary: go('Mes comptes', 'accounts'),
    secondary: i.can.updateAccounts ? { label: 'Taux inchangé', action: { type: 'confirm-av-rates', accountIds: i.avRatesDue.map(a => a.id) } } : undefined,
  });
  // Un livret dont la date de plafond est prévue (alerte « livret-full ») n'a pas besoin, en
  // plus, de son pourcentage.
  const forecastFull = new Set(i.alerts.filter(a => a.kind === 'livret-full').map(a => a.accountId));
  for (const c of i.ceilingAlerts) if (!forecastFull.has(c.id)) out.push({
    key: `ceiling-${c.id}-${Math.floor(c.pct / 5)}`, icon: 'alert', tone: 'info', snoozable: true,
    text: `${c.name} est rempli à ${Math.round(c.pct)} % : il reste ${eur0(c.remaining)} avant le plafond.`,
    primary: go('Voir le plan', 'pilot'),
  });
  if (i.can.exportData && !closingOpen && (!i.lastExportAt || daysBetween(parseISODate(i.lastExportAt), i.now) >= 90)) out.push({
    key: 'export', icon: 'download', tone: 'info', snoozable: true,
    text: 'Téléchargez une copie de vos données (tous les trois mois, par précaution).',
    detail: 'Pécule garde déjà une copie mensuelle sur votre Drive ; celle-ci reste chez vous.',
    primary: { label: 'Télécharger', action: { type: 'export' } },
  });
  // Une fois par an : le code de secours est-il toujours à portée de main ? Retapé juste
  // (Paramètres, Données), le rappel disparaît pour un an ; « Plus tard » le reporte.
  if (i.backupCodeCheckDue && i.can.openSettings) out.push({
    key: `backup-code-check-${year}`, icon: 'shield', tone: 'action', snoozable: true,
    text: 'Sauvegarde de secours : vérifiez que votre code de secours est toujours à portée de main.',
    detail: "Sans lui, les copies chiffrées sont illisibles, et on ne s'en aperçoit que le jour où on en a besoin. Retapez-le une fois par an ; perdu, créez-en un nouveau en désactivant puis en réactivant la sauvegarde.",
    primary: { label: 'Vérifier mon code', action: { type: 'check-backup-code' } },
  });
  for (const a of i.alerts) out.push({
    key: a.id, icon: ALERT_ICONS[a.kind], tone: a.tone, snoozable: true,
    text: a.title, detail: a.detail, gain: a.gain,
    primary: a.action ? go(a.action.label, a.action.view) : undefined,
  });
  if (i.emergency && !i.emergency.reached) out.push({
    key: 'emergency', icon: 'life-buoy', tone: 'info', snoozable: true,
    text: `Épargne de précaution : il manque ${eur0(i.emergency.missing)} pour couvrir ${i.emergency.months} mois de dépenses.`,
    detail: 'Gardez-la sur des livrets disponibles à tout moment avant de placer sur l\'assurance vie.',
  });
  return out;
};
