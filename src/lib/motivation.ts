// ================================================
// FILE: src/lib/motivation.ts
// Motivation (phase 2) : bons mois, séries, jalons, point de paie et contrôle des fiches
// de paie. Fonctions pures, partagées par l'app et le serveur de notifications.
//
// Garde-fous voulus par l'utilisateur : rien ne récompense un comportement risqué (crypto,
// nombre d'opérations), pas de pression du type « vous allez perdre votre série », pas de
// classement, et tout se désactive (config.gamification === false).
// ================================================
import { AccountMovement, AccountType, PayslipRecord, SavingsAccount } from '../types';
import { isSavingsFlow } from './finance/savings';
import { effectivePayday } from './finance/payPlan';
import { signedAmount } from './money';
import { formatISODay, parseISODate, MS_PER_DAY } from './dates';
import { computeEmergencyFund } from './planning';

export const DEFAULT_GOOD_MONTH_THRESHOLD = 500;
/** Durée d'un « mois » de suivi, compté à partir de la paie (jusqu'à la paie suivante au plus). */
export const PAY_WINDOW_DAYS = 30;
/** Écart toléré entre la date d'enregistrement d'une fiche et le jour de paie attendu. */
export const PAYSLIP_TOLERANCE_DAYS = 7;

export interface MotivationConfig {
  gamification?: boolean;
  goodMonthThreshold?: number;
}

export const motivationSettings = (config: MotivationConfig | undefined) => ({
  enabled: config?.gamification !== false,
  threshold: config?.goodMonthThreshold && config.goodMonthThreshold > 0 ? config.goodMonthThreshold : DEFAULT_GOOD_MONTH_THRESHOLD,
});

// ---------------------------------------------------------------------------
// Fenêtres de paie : 30 jours à partir de la paie
// ---------------------------------------------------------------------------

export interface PayWindow {
  /** Mois de la paie, 'YYYY-MM'. */
  key: string;
  /** Premier jour, 'YYYY-MM-DD'. */
  start: string;
  /** Lendemain du dernier jour (exclu), 'YYYY-MM-DD'. */
  end: string;
  /** D'où vient la date de départ : fiche de paie enregistrée, jour de paie, ou 1er du mois. */
  source: 'payslip' | 'payday' | 'calendar';
}

const addDays = (iso: string, days: number) => formatISODay(new Date(parseISODate(iso).getTime() + days * MS_PER_DAY + MS_PER_DAY / 2));
const monthKeyOf = (y: number, m: number) => `${y}-${String(m + 1).padStart(2, '0')}`;
const dayDiff = (a: string, b: string) => Math.round((parseISODate(a).getTime() - parseISODate(b).getTime()) / MS_PER_DAY);

/**
 * Début du « mois » de la paie `key` : la date d'enregistrement d'une fiche de paie de ce
 * mois si elle tombe à une semaine près du jour de paie attendu ; sinon le jour de paie ;
 * sans jour de paie connu, le 1er du mois.
 */
export const payWindowStart = (key: string, paydayDay: number | undefined, payslips: Pick<PayslipRecord, 'addedAt' | 'extracted'>[] = []) => {
  const [y, m] = key.split('-').map(Number);
  const expected = formatISODay(new Date(y, m - 1, paydayDay ? effectivePayday(paydayDay, y, m - 1) : 1));
  const recorded = payslips
    .filter(p => p.extracted?.period === key && p.addedAt)
    .map(p => p.addedAt.slice(0, 10))
    .filter(d => Math.abs(dayDiff(d, expected)) <= PAYSLIP_TOLERANCE_DAYS)
    .sort()[0];
  if (recorded) return { start: recorded, source: 'payslip' as const };
  return { start: expected, source: paydayDay ? 'payday' as const : 'calendar' as const };
};

/** Les `count` dernières fenêtres de paie (la plus ancienne d'abord), celle en cours comprise. */
export const recentPayWindows = (
  today: string,
  paydayDay: number | undefined,
  payslips: Pick<PayslipRecord, 'addedAt' | 'extracted'>[] = [],
  count = 12,
): PayWindow[] => {
  const t = parseISODate(today);
  const out: PayWindow[] = [];
  // Un mois de plus que demandé : la paie du mois courant peut ne pas être encore tombée.
  for (let k = count; k >= -1; k--) {
    const d = new Date(t.getFullYear(), t.getMonth() - k, 1);
    const key = monthKeyOf(d.getFullYear(), d.getMonth());
    const { start, source } = payWindowStart(key, paydayDay, payslips);
    if (start > today) continue;
    out.push({ key, start, end: addDays(start, PAY_WINDOW_DAYS), source });
  }
  // Une fenêtre s'arrête à la paie suivante (environ 30 jours) : pas de chevauchement les
  // mois de 31 jours (un versement compté deux fois), pas de trou après février. Seule la
  // fenêtre en cours, sans paie suivante connue, dure 30 jours pile.
  for (let i = 0; i < out.length - 1; i++) out[i].end = out[i + 1].start;
  return out.slice(-count);
};

// ---------------------------------------------------------------------------
// Bons mois
// ---------------------------------------------------------------------------

const SAVINGS_EXCLUDED = new Set([AccountType.COMPTE_COURANT, AccountType.IMMOBILIER]);

/** Argent mis de côté (part propre) entre `start` inclus et `end` exclu, sans dépasser `today`. */
export const savedBetween = (
  accounts: { type: AccountType; movements?: AccountMovement[] }[],
  start: string,
  end: string,
  today: string,
  trackingStartISO?: string,
): number => {
  let total = 0;
  for (const a of accounts) {
    if (SAVINGS_EXCLUDED.has(a.type)) continue;
    for (const m of a.movements || []) {
      if (!isSavingsFlow(m, trackingStartISO) || m.date < start || m.date >= end || m.date > today) continue;
      total += signedAmount(m);
    }
  }
  return Math.round(total * 100) / 100;
};

export interface MonthResult extends PayWindow {
  saved: number;
  good: boolean;
  /** Fenêtre en cours (pas encore terminée). */
  inProgress: boolean;
  /** Fenêtre ratée couverte par le joker de l'année : elle ne casse pas la série. */
  joker?: boolean;
}

export interface GoodMonthsSummary {
  threshold: number;
  months: MonthResult[];
  current?: MonthResult;
  /** Série en cours : fenêtres terminées réussies d'affilée (le mois en cours compte dès qu'il est acquis). */
  streak: number;
  bestStreak: number;
  goodCount: number;
  /** Années dont le joker a déjà servi. */
  jokersUsed: string[];
}

/**
 * Bons mois des 12 dernières paies. Les fenêtres antérieures au début du suivi (premier
 * versement d'épargne ou « Repartir de zéro ») ne comptent pas : on ne pénalise pas les mois
 * d'avant l'app. Un mois raté par an est couvert par un joker.
 */
export const computeGoodMonths = (input: {
  accounts: { type: AccountType; movements?: AccountMovement[] }[];
  today: string;
  paydayDay?: number;
  payslips?: Pick<PayslipRecord, 'addedAt' | 'extracted'>[];
  threshold?: number;
  trackingStartISO?: string;
  count?: number;
}): GoodMonthsSummary => {
  const threshold = input.threshold ?? DEFAULT_GOOD_MONTH_THRESHOLD;
  const firstFlow = input.accounts
    .filter(a => !SAVINGS_EXCLUDED.has(a.type))
    .flatMap(a => (a.movements || []).filter(m => isSavingsFlow(m, input.trackingStartISO)).map(m => m.date))
    .sort()[0];
  const trackingFrom = [firstFlow, input.trackingStartISO].filter((d): d is string => !!d).sort().pop();
  const windows = recentPayWindows(input.today, input.paydayDay, input.payslips, input.count ?? 12)
    .filter(w => trackingFrom !== undefined && w.end > trackingFrom);

  const months: MonthResult[] = windows.map(w => {
    const saved = savedBetween(input.accounts, w.start, w.end, input.today, input.trackingStartISO);
    return { ...w, saved, good: saved >= threshold - 0.004, inProgress: input.today < w.end };
  });

  let streak = 0, bestStreak = 0;
  const jokersUsed: string[] = [];
  for (const m of months) {
    if (m.good) { streak++; bestStreak = Math.max(bestStreak, streak); continue; }
    if (m.inProgress) continue; // pas encore joué : ne casse rien
    const year = m.start.slice(0, 4);
    if (!jokersUsed.includes(year) && streak > 0) { jokersUsed.push(year); m.joker = true; continue; }
    streak = 0;
  }
  return {
    threshold,
    months,
    current: months.find(m => m.inProgress),
    streak,
    bestStreak,
    goodCount: months.filter(m => m.good).length,
    jokersUsed,
  };
};

// ---------------------------------------------------------------------------
// Jalons
// ---------------------------------------------------------------------------

export interface Milestone {
  id: string;
  title: string;
  detail: string;
  achieved: boolean;
  /** Avancement vers le jalon, de 0 à 1 (absent si sans objet). */
  progress?: number;
}

const SAVINGS_TIERS = [10_000, 25_000, 50_000, 100_000];
const STREAK_TIERS = [3, 6, 12];
const LIVRETS = [AccountType.LIVRET_A, AccountType.LDDS, AccountType.LEP];

const eur = (n: number) => `${Math.round(n).toLocaleString('fr-FR')} €`;

export const computeMilestones = (input: {
  accounts: SavingsAccount[];
  /** Épargne nette affichée sur l'Accueil (part propre). */
  mySavings: number;
  monthlySpending: number;
  goodMonths: GoodMonthsSummary;
  rfrByYear?: Record<string, number>;
  restitutionDoneOn?: string;
}): Milestone[] => {
  const { accounts, mySavings, goodMonths } = input;
  const list: Milestone[] = [];

  list.push({
    id: 'good-month-1', title: 'Premier bon mois',
    detail: `Au moins ${eur(goodMonths.threshold)} mis de côté sur une paie.`,
    achieved: goodMonths.goodCount > 0,
    progress: Math.min(1, Math.max(0, (goodMonths.current?.saved ?? 0) / goodMonths.threshold)),
  });
  for (const n of STREAK_TIERS) {
    list.push({
      id: `streak-${n}`, title: `${n} bons mois d'affilée`,
      detail: 'Un joker par an couvre un mois plus difficile.',
      achieved: goodMonths.bestStreak >= n,
      progress: Math.min(1, goodMonths.streak / n),
    });
  }
  for (const months of [3, 6]) {
    const fund = computeEmergencyFund(accounts, input.monthlySpending, months);
    if (!fund) continue;
    list.push({
      id: `emergency-${months}`, title: `Épargne de précaution : ${months} mois`,
      detail: `${eur(fund.target)} disponibles tout de suite pour faire face à l'imprévu.`,
      achieved: fund.reached,
      progress: Math.min(1, fund.pct / 100),
    });
  }
  const livrets = accounts.filter(a => LIVRETS.includes(a.type) && (a.ceiling ?? 0) > 0);
  if (livrets.length > 0) {
    const best = livrets.reduce((b, a) => (a.totalAmount / (a.ceiling as number) > b.totalAmount / (b.ceiling as number) ? a : b));
    list.push({
      id: 'livret-full', title: 'Un livret au plafond',
      detail: `${best.name} : ${eur(best.totalAmount)} sur ${eur(best.ceiling as number)}.`,
      achieved: livrets.some(a => a.totalAmount >= (a.ceiling as number) - 0.5),
      progress: Math.min(1, best.totalAmount / (best.ceiling as number)),
    });
  }
  for (const tier of SAVINGS_TIERS) {
    list.push({
      id: `savings-${tier}`, title: `${eur(tier)} d'épargne`,
      detail: 'Votre part, hors capital de vos parents.',
      achieved: mySavings >= tier,
      progress: Math.min(1, Math.max(0, mySavings / tier)),
    });
  }
  list.push({
    id: 'tax-notice', title: "Avis d'imposition importé",
    detail: "Pécule vérifie votre droit au LEP d'après votre revenu fiscal de référence.",
    achieved: Object.values(input.rfrByYear || {}).some(v => v > 0),
  });
  if (input.restitutionDoneOn) {
    list.push({
      id: 'solo-month', title: 'Premier bon mois en solo',
      detail: 'Un bon mois après la restitution du capital de vos parents.',
      achieved: goodMonths.months.some(m => m.good && m.start >= (input.restitutionDoneOn as string)),
    });
  }
  return list;
};

/** Prochain jalon à viser : le plus avancé parmi ceux qui ne sont pas atteints. */
export const nextMilestone = (milestones: Milestone[]): Milestone | undefined =>
  milestones.filter(m => !m.achieved && m.progress !== undefined).sort((a, b) => (b.progress ?? 0) - (a.progress ?? 0))[0];

// ---------------------------------------------------------------------------
// Point de paie : bilan de la paie précédente
// ---------------------------------------------------------------------------

export interface PayReview {
  key: string;
  start: string;
  end: string;
  saved: number;
  threshold: number;
  good: boolean;
  joker: boolean;
  plan?: number;
  deposits: number;
  withdrawals: number;
  /** Variations de valeur des placements (hors épargne versée). */
  valuation: number;
  byAccount: { accountId: string; name: string; net: number }[];
  insight: string;
  action?: { label: string; view: 'pilot' | 'accounts' | 'update' };
}

/**
 * Bilan de la dernière fenêtre de paie terminée, à proposer une fois (jusqu'à ce que
 * l'utilisateur le valide). `undefined` s'il n'y a pas encore de paie terminée.
 */
export const computePayReview = (input: {
  accounts: SavingsAccount[];
  goodMonths: GoodMonthsSummary;
  today: string;
  plan?: number;
  trackingStartISO?: string;
}): PayReview | undefined => {
  const done = input.goodMonths.months.filter(m => !m.inProgress);
  const last = done[done.length - 1];
  if (!last) return undefined;
  let deposits = 0, withdrawals = 0, valuation = 0;
  const byAccount: PayReview['byAccount'] = [];
  for (const a of input.accounts) {
    if (SAVINGS_EXCLUDED.has(a.type)) continue;
    let net = 0;
    for (const m of a.movements || []) {
      if (m.date < last.start || m.date >= last.end) continue;
      if (m.kind === 'valuation') { valuation += signedAmount(m); continue; }
      if (!isSavingsFlow(m, input.trackingStartISO)) continue;
      const v = signedAmount(m);
      net += v;
      if (v >= 0) deposits += v; else withdrawals -= v;
    }
    if (Math.abs(net) >= 0.01) byAccount.push({ accountId: a.id, name: a.name, net: Math.round(net * 100) / 100 });
  }
  byAccount.sort((x, y) => y.net - x.net);
  const threshold = input.goodMonths.threshold;
  const plan = input.plan && input.plan > 0 ? input.plan : undefined;
  let insight: string;
  let action: PayReview['action'];
  if (last.good && plan && last.saved >= plan) insight = `Objectif tenu : ${eur(last.saved - plan)} de plus que prévu.`;
  else if (last.good) insight = `Bon mois : ${eur(last.saved)} mis de côté.`;
  else if (withdrawals > 0 && deposits >= threshold) insight = `Les retraits (${eur(withdrawals)}) ont fait passer ce mois sous ${eur(threshold)}.`;
  else insight = `Il a manqué ${eur(Math.max(0, threshold - last.saved))} pour un bon mois.`;
  if (!last.good) action = { label: 'Voir quoi placer', view: 'pilot' };
  return {
    key: last.key, start: last.start, end: last.end, saved: last.saved, threshold, good: last.good, joker: !!last.joker, plan,
    deposits: Math.round(deposits * 100) / 100, withdrawals: Math.round(withdrawals * 100) / 100,
    valuation: Math.round(valuation * 100) / 100, byAccount, insight, action,
  };
};

// ---------------------------------------------------------------------------
// Contrôle des fiches de paie
// ---------------------------------------------------------------------------

export interface PayslipAnomaly {
  payslipId: string;
  period: string;
  field: 'netPaid' | 'netAmount' | 'grossAmount';
  label: string;
  value: number;
  median: number;
  /** Écart relatif, signé (0,18 = +18 %). */
  delta: number;
}

const FIELDS: { field: PayslipAnomaly['field']; label: string }[] = [
  { field: 'netPaid', label: 'Net payé' },
  { field: 'netAmount', label: 'Net à payer avant impôt' },
  { field: 'grossAmount', label: 'Salaire brut' },
];
/** Seuils d'alerte : plus de 15 % ET plus de 50 € d'écart avec la médiane. */
export const ANOMALY_RATIO = 0.15;
export const ANOMALY_MIN_EUR = 50;

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

/**
 * Fiches qui s'écartent nettement des six précédentes (médiane), champ par champ : un seul
 * signalement par fiche, sur le premier champ en écart (net payé d'abord). Il faut au moins
 * trois fiches précédentes pour juger. Prime, heures supplémentaires ou absence expliquent
 * souvent l'écart : c'est une invitation à vérifier, pas une erreur.
 */
export const detectPayslipAnomalies = (payslips: PayslipRecord[]): PayslipAnomaly[] => {
  const sorted = payslips
    .filter(p => p.reviewed && p.extracted?.period)
    .sort((a, b) => (a.extracted.period as string).localeCompare(b.extracted.period as string));
  const out: PayslipAnomaly[] = [];
  sorted.forEach((p, i) => {
    const previous = sorted.slice(Math.max(0, i - 6), i);
    for (const { field, label } of FIELDS) {
      const value = p.extracted[field];
      const history = previous.map(q => q.extracted[field]).filter((v): v is number => typeof v === 'number' && v > 0);
      if (typeof value !== 'number' || value <= 0 || history.length < 3) continue;
      const med = median(history);
      const gap = value - med;
      if (Math.abs(gap) >= ANOMALY_MIN_EUR && Math.abs(gap) / med > ANOMALY_RATIO) {
        out.push({ payslipId: p.id, period: p.extracted.period as string, field, label, value, median: Math.round(med * 100) / 100, delta: gap / med });
        break;
      }
    }
  });
  return out;
};
