// ================================================
// FILE: src/lib/motivation.ts
// Motivation (phase 2) : bons mois, séries, jalons, point de paie et contrôle des fiches
// de paie. Fonctions pures, partagées par l'app et le serveur de notifications.
//
// Garde-fous voulus par l'utilisateur : rien ne récompense un comportement risqué (crypto,
// nombre d'opérations), pas de pression du type « vous allez perdre votre série », pas de
// classement, et tout se désactive (config.gamification === false).
// ================================================
import { AccountMovement, AccountType, PayRecord, PayslipRecord, SavingsAccount } from '../types';
import { isSavingsFlow } from './finance/savings';
import { signedAmount } from './money';
import { payWindows, paySavingsMonths, savingsMonthOf, PayCalendarData, PayWindow } from './payCalendar';
import { computeEmergencyFund } from './planning';
import { plainEUR } from './format';
import { hasParentalCapital } from './parentalMode';

export const DEFAULT_GOOD_MONTH_THRESHOLD = 500;
/** Durée d'un « mois » de suivi, compté à partir de la paie (jusqu'à la paie suivante au plus). */
export { PAY_WINDOW_DAYS } from './payCalendar';

export interface MotivationConfig {
  gamification?: boolean;
  goodMonthThreshold?: number;
}

export const motivationSettings = (config: MotivationConfig | undefined) => ({
  enabled: config?.gamification !== false,
  threshold: config?.goodMonthThreshold && config.goodMonthThreshold > 0 ? config.goodMonthThreshold : DEFAULT_GOOD_MONTH_THRESHOLD,
});

// ---------------------------------------------------------------------------
// Fenêtres de paie : un mois d'épargne, de la paie à la paie suivante (lib/payCalendar)
// ---------------------------------------------------------------------------

export type { PayWindow } from './payCalendar';

/**
 * Les `count` derniers mois d'épargne (le plus ancien d'abord), celui en cours compris : voir
 * payWindows (lib/payCalendar), dont c'est la forme historique.
 */
export const recentPayWindows = (
  today: string,
  paydayDay: number | undefined,
  payslips: Pick<PayslipRecord, 'addedAt' | 'extracted'>[] = [],
  count = 12,
  pays: PayCalendarData['pays'] = [],
): PayWindow[] => payWindows({ paydayDay, payslips, pays }, today, count);

// ---------------------------------------------------------------------------
// Bons mois
// ---------------------------------------------------------------------------

const SAVINGS_EXCLUDED = new Set([AccountType.COMPTE_COURANT, AccountType.IMMOBILIER]);

/**
 * Rattachement des versements à un mois d'épargne : `key` est le mois de la fenêtre et
 * `payMonths` le mois d'épargne de chaque paie déclarée (paySavingsMonths).
 */
export interface PayAttribution {
  key: string;
  payMonths: ReadonlyMap<string, string>;
}

/**
 * Le mouvement compte-t-il dans la fenêtre `[start, end)` ? Un versement fait au titre d'une
 * paie connue (`payId`) compte dans le mois d'épargne de cette paie, quelle que soit sa date ;
 * les autres (et tous, sans `attribution`) sont rattachés par leur date.
 */
export const inPayWindow = (m: AccountMovement, start: string, end: string, attribution?: PayAttribution): boolean => {
  const payMonth = attribution && m.payId ? attribution.payMonths.get(m.payId) : undefined;
  if (payMonth !== undefined) return payMonth === attribution!.key;
  return m.date >= start && m.date < end;
};

/** Rattachement des versements de `pays` pour la fenêtre `key` (undefined sans paie déclarée). */
export const payAttribution = (key: string, pays: Pick<PayRecord, 'id' | 'receivedOn' | 'savingsMonth'>[] | undefined): PayAttribution | undefined =>
  pays && pays.length > 0 ? { key, payMonths: paySavingsMonths(pays) } : undefined;

/**
 * Argent mis de côté (part propre) entre `start` inclus et `end` exclu, sans dépasser `today`.
 * Avec `attribution`, les versements faits au titre d'une paie comptent dans son mois
 * d'épargne (voir inPayWindow).
 */
export const savedBetween = (
  accounts: { type: AccountType; movements: AccountMovement[] }[],
  start: string,
  end: string,
  today: string,
  trackingStartISO?: string,
  attribution?: PayAttribution,
): number => {
  let total = 0;
  for (const a of accounts) {
    if (SAVINGS_EXCLUDED.has(a.type)) continue;
    for (const m of a.movements) {
      if (!isSavingsFlow(m, trackingStartISO) || m.date > today || !inPayWindow(m, start, end, attribution)) continue;
      total += signedAmount(m);
    }
  }
  return Math.round(total * 100) / 100;
};

/**
 * Épargne de chaque mois d'épargne de `fromKey` à `toKey` ('YYYY-MM', inclus), déjà ouvert à
 * `today`, le plus ancien d'abord : « Votre année » (mois par mois, meilleur mois) et « Demander
 * à Pécule ». Une paie reçue le 27 décembre ouvre l'épargne de janvier de l'année suivante ; sans
 * jour de paie ni paie déclarée, ce sont les mois civils.
 */
export const savingsByMonth = (input: {
  accounts: { type: AccountType; movements: AccountMovement[] }[];
  today: string;
  paydayDay?: number;
  payslips?: Pick<PayslipRecord, 'addedAt' | 'extracted'>[];
  pays?: PayCalendarData['pays'];
  trackingStartISO?: string;
  fromKey: string;
  toKey: string;
}): { key: string; start: string; end: string; saved: number }[] => {
  const [fy, fm] = input.fromKey.split('-').map(Number);
  const [ty, tm] = input.today.split('-').map(Number);
  // Assez de fenêtres pour remonter jusqu'à `fromKey` (une de plus : le mois d'épargne en cours
  // peut avoir la clé du mois suivant).
  const count = Math.min(600, Math.max(1, (ty - fy) * 12 + (tm - fm) + 2));
  return payWindows({ paydayDay: input.paydayDay, payslips: input.payslips, pays: input.pays }, input.today, count)
    .filter(w => w.key >= input.fromKey && w.key <= input.toKey)
    .map(w => ({
      key: w.key, start: w.start, end: w.end,
      saved: savedBetween(input.accounts, w.start, w.end, input.today, input.trackingStartISO, payAttribution(w.key, input.pays)),
    }));
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
 * Début du suivi de l'épargne : premier versement d'épargne, ou « Repartir de zéro » s'il est
 * plus récent (undefined : rien encore). Avant cette date, rien n'était enregistré.
 */
export const savingsTrackingFrom = (
  accounts: { type: AccountType; movements: AccountMovement[] }[],
  trackingStartISO?: string,
): string | undefined => {
  const firstFlow = accounts
    .filter(a => !SAVINGS_EXCLUDED.has(a.type))
    .flatMap(a => a.movements.filter(m => isSavingsFlow(m, trackingStartISO)).map(m => m.date))
    .sort()[0];
  return [firstFlow, trackingStartISO].filter((d): d is string => !!d).sort().pop();
};

/**
 * Bons mois des 12 derniers mois d'épargne (« Novembre : bon mois »). Les fenêtres antérieures
 * au début du suivi (premier versement d'épargne ou « Repartir de zéro ») ne comptent pas : on
 * ne pénalise pas les mois d'avant l'app. Un mois raté par an est couvert par un joker : l'année
 * est celle du mois d'épargne (la paie du 27 décembre, épargne de janvier, compte l'année d'après).
 */
export const computeGoodMonths = (input: {
  accounts: { type: AccountType; movements: AccountMovement[] }[];
  today: string;
  paydayDay?: number;
  payslips?: Pick<PayslipRecord, 'addedAt' | 'extracted'>[];
  /** Paies déclarées : début des mois d'épargne et rattachement des versements (payId). */
  pays?: PayCalendarData['pays'];
  threshold?: number;
  trackingStartISO?: string;
  count?: number;
}): GoodMonthsSummary => {
  const threshold = input.threshold ?? DEFAULT_GOOD_MONTH_THRESHOLD;
  const trackingFrom = savingsTrackingFrom(input.accounts, input.trackingStartISO);
  const windows = payWindows({ paydayDay: input.paydayDay, payslips: input.payslips, pays: input.pays }, input.today, input.count ?? 12)
    .filter(w => trackingFrom !== undefined && w.end > trackingFrom);

  const months: MonthResult[] = windows.map(w => {
    const saved = savedBetween(input.accounts, w.start, w.end, input.today, input.trackingStartISO, payAttribution(w.key, input.pays));
    return { ...w, saved, good: saved >= threshold - 0.004, inProgress: input.today < w.end };
  });

  let streak = 0, bestStreak = 0;
  const jokersUsed: string[] = [];
  for (const m of months) {
    if (m.good) { streak++; bestStreak = Math.max(bestStreak, streak); continue; }
    if (m.inProgress) continue; // pas encore joué : ne casse rien
    const year = m.key.slice(0, 4);
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

const eur = plainEUR;

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
      // Mode solo (après la restitution) : plus de mention des parents.
      detail: hasParentalCapital(accounts) ? 'Votre part, hors capital de vos parents.' : 'Le total de vos comptes.',
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
    // Premier mois d'épargne « solo » : celui que la règle du 15 donne à la date de restitution.
    // Restitution le 1er janvier 2027 : l'épargne de janvier (paie du 27 décembre) compte déjà,
    // même si sa fenêtre s'est ouverte quelques jours avant.
    const soloFrom = savingsMonthOf(input.restitutionDoneOn);
    list.push({
      id: 'solo-month', title: 'Premier bon mois en solo',
      detail: 'Un bon mois après la restitution du capital de vos parents.',
      achieved: goodMonths.months.some(m => m.good && m.key >= soloFrom),
    });
  }
  return list;
};

/** Prochain jalon à viser : le plus avancé parmi ceux qui ne sont pas atteints. */
export const nextMilestone = (milestones: Milestone[]): Milestone | undefined =>
  milestones.filter(m => !m.achieved && m.progress !== undefined).sort((a, b) => (b.progress ?? 0) - (a.progress ?? 0))[0];

// ---------------------------------------------------------------------------
// Point de paie : bilan du mois d'épargne précédent (« Bilan d'octobre »)
// ---------------------------------------------------------------------------

export interface PayReview {
  /** Mois d'épargne ('YYYY-MM') : clé des points de paie validés (config.payReviewsDone). */
  key: string;
  /** Mois de versement de la paie (clés `recap:` des notifications du serveur). */
  payMonth: string;
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
  /** Paies déclarées : leurs versements (payId) comptent dans leur mois d'épargne. */
  pays?: Pick<PayRecord, 'id' | 'receivedOn' | 'savingsMonth'>[];
}): PayReview | undefined => {
  const done = input.goodMonths.months.filter(m => !m.inProgress);
  const last = done[done.length - 1];
  if (!last) return undefined;
  let deposits = 0, withdrawals = 0, valuation = 0;
  const byAccount: PayReview['byAccount'] = [];
  const attribution = payAttribution(last.key, input.pays);
  for (const a of input.accounts) {
    if (SAVINGS_EXCLUDED.has(a.type)) continue;
    let net = 0;
    for (const m of a.movements) {
      if (m.kind === 'valuation') {
        if (m.date >= last.start && m.date < last.end) valuation += signedAmount(m);
        continue;
      }
      if (!isSavingsFlow(m, input.trackingStartISO) || m.date > input.today || !inPayWindow(m, last.start, last.end, attribution)) continue;
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
    key: last.key, payMonth: last.payMonth, start: last.start, end: last.end, saved: last.saved, threshold, good: last.good, joker: !!last.joker, plan,
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
const ANOMALY_RATIO = 0.15;
const ANOMALY_MIN_EUR = 50;

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
