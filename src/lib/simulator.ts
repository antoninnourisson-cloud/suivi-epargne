// ================================================
// FILE: src/lib/simulator.ts
// Simulateur « Et si… » : projette VOTRE épargne (part propre, jamais le capital des
// parents) mois par mois, avec le plan d'épargne actuel et les taux nets d'aujourd'hui,
// puis la compare à des scénarios combinables (achat, pause, autre montant mensuel, autre
// date de restitution). Une fourchette P10–P50–P90 est tirée de vos propres mois passés
// (bootstrap Monte Carlo à graine). Fonctions pures, testées.
//
// Même mécanique que buildSoloPlan / projectSavings : chaque mois, intérêts nets
// (netAnnualRate / 12) sur le solde réel, puis versement réparti par
// computePlacementStrategy (plafonds vérifiés sur le solde réel, part des parents
// comprise tant qu'elle est là). Les intérêts du capital parental vous reviennent
// (accord familial) : ils s'ajoutent à votre part, comme dans projectSavings.
// ================================================
import { AccountType, FiscalConfig, PayslipRecord, SavingsAccount, AccountMovement } from '../types';
import { computePlacementStrategy, SavingsSplit } from './finance';
import { netAnnualRate } from './projection';
import { recentPayWindows, savedBetween } from './motivation';
import { parseISODate, formatISODay } from './dates';

const MIN_HORIZON = 6;
const MAX_HORIZON = 60;
const DEFAULT_RUNS = 1000;
/** En dessous, pas de fourchette : trop peu de mois pour tirer quoi que ce soit. */
const MIN_HISTORY_MONTHS = 3;

// ---------------------------------------------------------------------------
// Générateur pseudo-aléatoire à graine
// ---------------------------------------------------------------------------

/** mulberry32 : petit générateur à graine, résultats reproductibles (tests, écran stable). */
export const mulberry32 = (seed: number): (() => number) => {
  let s = seed | 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

// ---------------------------------------------------------------------------
// Scénarios
// ---------------------------------------------------------------------------

/** Dépense ponctuelle de `amount` € au mois `month` (1 = le mois prochain). */
export interface PurchaseScenario { kind: 'purchase'; id: string; amount: number; month: number; label?: string }
/** Aucun versement pendant `months` mois à partir du mois `month`. */
export interface PauseScenario { kind: 'pause'; id: string; month: number; months: number }
/** Autre montant mis de côté chaque mois. */
export interface MonthlyScenario { kind: 'monthly'; id: string; amount: number }
/** Autre date de restitution du capital des parents (sans effet une fois la restitution faite). */
export interface RestitutionScenario { kind: 'restitution'; id: string; date: string }

export type Scenario = PurchaseScenario | PauseScenario | MonthlyScenario | RestitutionScenario;
export type ScenarioKind = Scenario['kind'];

// ---------------------------------------------------------------------------
// Mois passés (pour la fourchette)
// ---------------------------------------------------------------------------

export interface PastSavings {
  /** Montant mis de côté par mois, du plus ancien au plus récent. */
  amounts: number[];
  /** Mois de paie (jour de paie connu) ou mois civils. */
  source: 'payday' | 'calendar';
}

/**
 * Ce que vous avez mis de côté chacun des derniers mois TERMINÉS (12 au plus) : fenêtres de
 * paie si le jour de paie est connu, sinon mois civils. Les mois commencés avant le début
 * du suivi sont écartés (incomplets).
 */
export const pastMonthlySavings = (input: {
  accounts: { type: AccountType; movements?: AccountMovement[] }[];
  today: string;
  paydayDay?: number;
  payslips?: Pick<PayslipRecord, 'addedAt' | 'extracted'>[];
  trackingStartDate?: string;
  count?: number;
}): PastSavings => {
  const { accounts, today, paydayDay, payslips = [], trackingStartDate, count = 12 } = input;
  const windows = recentPayWindows(today, paydayDay, payslips, count + 1)
    .filter(w => w.end <= today)
    .filter(w => !trackingStartDate || w.start >= trackingStartDate)
    .slice(-count);
  return {
    amounts: windows.map(w => savedBetween(accounts, w.start, w.end, today, trackingStartDate)),
    source: paydayDay ? 'payday' : 'calendar',
  };
};

// ---------------------------------------------------------------------------
// Moteur
// ---------------------------------------------------------------------------

export interface SimulatorInput {
  accounts: SavingsAccount[];
  fiscal: FiscalConfig;
  /** Plan mensuel actuel (monthPlan de l'app). */
  monthlyPlan: number;
  /** Nombre de mois projetés (6 à 60). */
  horizon: number;
  /** Aujourd'hui, 'YYYY-MM-DD' : le mois 0. */
  today: string;
  restitution?: { plannedDate?: string; done?: boolean };
  split?: SavingsSplit;
  scenarios?: Scenario[];
  /** Objectif facultatif : mois où chaque courbe l'atteint. */
  target?: number;
  /** Montants mis de côté les mois passés (pastMonthlySavings). */
  history?: number[];
  /** Générateur pour la fourchette ; sans lui, mulberry32(1). */
  rng?: () => number;
  runs?: number;
  /** false : pas de fourchette (courbes seules, calcul instantané). */
  band?: boolean;
}

export interface SimPoint {
  /** 0 = aujourd'hui. */
  month: number;
  /** Premier jour du mois, 'YYYY-MM-01'. */
  date: string;
  baseline: number;
  scenario: number;
  p10?: number;
  p50?: number;
  p90?: number;
}

export interface PurchaseOutcome {
  id: string;
  month: number;
  amount: number;
  /** Comptes d'où l'argent sort (votre part seulement). */
  takenFrom: { accountId: string; name: string; type: AccountType; amount: number }[];
  /** Ce qui manquait : votre part ne suffisait pas. */
  shortfall: number;
}

export interface SimulatorResult {
  horizon: number;
  points: SimPoint[];
  /** Votre épargne aujourd'hui (part propre). */
  start: number;
  baselineEnd: number;
  scenarioEnd: number;
  /** scenarioEnd − baselineEnd. */
  gap: number;
  monthly: { baseline: number; scenario: number };
  restitution: { done: boolean; baselineMonth?: number; scenarioMonth?: number; scenarioIgnored: boolean };
  purchases: PurchaseOutcome[];
  goal?: { target: number; baselineMonth: number | null; scenarioMonth: number | null; p50Month: number | null };
  band: { runs: number; historyMonths: number } | null;
  /** Pourquoi il n'y a pas de fourchette. */
  bandUnavailable?: string;
}

type SimAccount = SavingsAccount & { own: number };

const LIQUID_ORDER: AccountType[] = [AccountType.COMPTE_COURANT, AccountType.LDDS, AccountType.LIVRET_A, AccountType.LEP];

/** Mois entre aujourd'hui et `iso` (même mois = 0). */
export const monthIndex = (todayISO: string, iso: string): number => {
  const a = parseISODate(todayISO), b = parseISODate(iso);
  return (b.getFullYear() - a.getFullYear()) * 12 + b.getMonth() - a.getMonth();
};

/** Premier jour du mois `m` mois après aujourd'hui. */
export const monthDate = (todayISO: string, m: number): string => {
  const t = parseISODate(todayISO);
  return formatISODay(new Date(t.getFullYear(), t.getMonth() + m, 1));
};

const clampHorizon = (h: number) => Math.min(MAX_HORIZON, Math.max(MIN_HORIZON, Math.round(Number.isFinite(h) ? h : 24)));

/**
 * Retire `amount` de VOTRE part : compte courant puis livrets (le moins rémunérateur
 * d'abord), puis les autres placements. La part des parents n'est jamais touchée.
 */
const withdraw = (sim: SimAccount[], rates: Map<string, number>, amount: number) => {
  const rank = (a: SimAccount) => {
    const i = LIQUID_ORDER.indexOf(a.type);
    return i >= 0 ? i : LIQUID_ORDER.length;
  };
  const order = [...sim].sort((x, y) => rank(x) - rank(y) || (rates.get(x.id) || 0) - (rates.get(y.id) || 0));
  let left = amount;
  const takenFrom: PurchaseOutcome['takenFrom'] = [];
  for (const a of order) {
    if (left <= 0.005) break;
    const take = Math.min(left, Math.max(0, a.own));
    if (take <= 0.005) continue;
    a.own -= take; a.totalAmount -= take; left -= take;
    takenFrom.push({ accountId: a.id, name: a.name, type: a.type, amount: take });
  }
  return { takenFrom, shortfall: Math.max(0, left) };
};

interface PathPlan {
  /** Versement du mois m (1…horizon). Négatif = retrait. */
  deposit: (m: number) => number;
  restitutionMonth?: number;
  purchases: PurchaseScenario[];
}

interface PathContext {
  base: SavingsAccount[];
  fiscal: FiscalConfig;
  split?: SavingsSplit;
  horizon: number;
  rates: Map<string, number>;
}

const runPath = (ctx: PathContext, plan: PathPlan, record?: PurchaseOutcome[]): number[] => {
  const sim: SimAccount[] = ctx.base.map(a => ({ ...a, own: a.ownedAmount }));
  const byId = new Map(sim.map(a => [a.id, a]));
  const total = () => sim.reduce((s, a) => s + a.own, 0);
  const out = [total()];
  // Restitution déjà passée mais pas encore enregistrée : appliquée tout de suite.
  const restitutionAt = plan.restitutionMonth === undefined ? undefined : Math.max(1, plan.restitutionMonth);
  for (let m = 1; m <= ctx.horizon; m++) {
    if (restitutionAt === m) for (const a of sim) a.totalAmount = a.own;
    for (const a of sim) {
      if (a.type === AccountType.COMPTE_COURANT) continue;
      const interest = a.totalAmount * (ctx.rates.get(a.id) || 0);
      a.totalAmount += interest; a.own += interest;
    }
    const dep = plan.deposit(m);
    if (dep > 0) {
      for (const st of computePlacementStrategy(dep, sim, ctx.fiscal, ctx.split)) {
        if (st.infoOnly || !st.accountId) continue;
        const a = byId.get(st.accountId);
        if (a) { a.totalAmount += st.fillAmount; a.own += st.fillAmount; }
      }
    } else if (dep < 0) {
      withdraw(sim, ctx.rates, -dep);
    }
    for (const p of plan.purchases) {
      if (p.month !== m || !(p.amount > 0)) continue;
      const r = withdraw(sim, ctx.rates, p.amount);
      record?.push({ id: p.id, month: m, amount: p.amount, ...r });
    }
    out.push(total());
  }
  return out;
};

const quantile = (sorted: number[], q: number) => {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
};

const firstReach = (series: number[], target: number): number | null => {
  const i = series.findIndex(v => v >= target - 0.005);
  return i >= 0 ? i : null;
};

export const simulate = (input: SimulatorInput): SimulatorResult => {
  const horizon = clampHorizon(input.horizon);
  const scenarios = input.scenarios || [];
  const base = input.accounts.filter(a => a.type !== AccountType.IMMOBILIER);
  const ctx: PathContext = {
    base, fiscal: input.fiscal, split: input.split, horizon,
    rates: new Map(base.map(a => [a.id, netAnnualRate(a, input.fiscal) / 100 / 12])),
  };

  // Restitution : rien à simuler si elle est faite ou s'il n'y a plus de part parentale.
  const hasParental = base.some(a => a.parentalCapital > 0);
  const done = !!input.restitution?.done || !hasParental;
  const plannedMonth = !done && input.restitution?.plannedDate ? monthIndex(input.today, input.restitution.plannedDate) : undefined;
  const restScenario = [...scenarios].reverse().find((s): s is RestitutionScenario => s.kind === 'restitution');
  const scenarioRestMonth = done ? undefined : restScenario ? monthIndex(input.today, restScenario.date) : plannedMonth;

  const planMonthly = Math.max(0, input.monthlyPlan || 0);
  const monthlyScenario = [...scenarios].reverse().find((s): s is MonthlyScenario => s.kind === 'monthly');
  const scenarioMonthly = monthlyScenario ? Math.max(0, monthlyScenario.amount || 0) : planMonthly;
  const pauses = scenarios.filter((s): s is PauseScenario => s.kind === 'pause');
  const paused = (m: number) => pauses.some(p => p.months > 0 && m >= p.month && m < p.month + p.months);
  const purchases = scenarios.filter((s): s is PurchaseScenario => s.kind === 'purchase');

  const baseline = runPath(ctx, { deposit: () => planMonthly, restitutionMonth: plannedMonth, purchases: [] });
  const outcomes: PurchaseOutcome[] = [];
  const scenarioPlan: PathPlan = {
    deposit: m => (paused(m) ? 0 : scenarioMonthly),
    restitutionMonth: scenarioRestMonth,
    purchases,
  };
  const scenario = runPath(ctx, scenarioPlan, outcomes);

  // Fourchette : vos mois passés tirés au sort (avec remise), décalés de l'écart entre le
  // montant du scénario et le plan actuel ; les mois en pause restent à 0.
  const history = (input.history || []).filter(Number.isFinite);
  let bands: { p10: number[]; p50: number[]; p90: number[] } | null = null;
  let bandUnavailable: string | undefined;
  const runs = Math.max(1, Math.round(input.runs ?? DEFAULT_RUNS));
  if (input.band === false) {
    // Courbes seules : la fourchette est calculée à part (écran : après une pause de saisie).
  } else if (history.length < MIN_HISTORY_MONTHS) {
    bandUnavailable = history.length === 0
      ? 'Pas encore de mois terminé dans votre suivi : la fourchette apparaîtra après 3 mois.'
      : `Seulement ${history.length} mois terminé${history.length > 1 ? 's' : ''} dans votre suivi : il en faut au moins ${MIN_HISTORY_MONTHS} pour tirer une fourchette.`;
  } else {
    const rng = input.rng ?? mulberry32(1);
    const shift = scenarioMonthly - planMonthly;
    const byMonth: number[][] = Array.from({ length: horizon + 1 }, () => []);
    for (let r = 0; r < runs; r++) {
      const draws = Array.from({ length: horizon + 1 }, () => history[Math.min(history.length - 1, Math.floor(rng() * history.length))]);
      const path = runPath(ctx, { ...scenarioPlan, deposit: m => (paused(m) ? 0 : draws[m] + shift) });
      path.forEach((v, m) => byMonth[m].push(v));
    }
    bands = { p10: [], p50: [], p90: [] };
    for (const vals of byMonth) {
      vals.sort((a, b) => a - b);
      bands.p10.push(quantile(vals, 0.1)); bands.p50.push(quantile(vals, 0.5)); bands.p90.push(quantile(vals, 0.9));
    }
  }

  const points: SimPoint[] = baseline.map((b, m) => ({
    month: m, date: monthDate(input.today, m), baseline: b, scenario: scenario[m],
    ...(bands ? { p10: bands.p10[m], p50: bands.p50[m], p90: bands.p90[m] } : {}),
  }));
  const target = input.target && input.target > 0 ? input.target : undefined;
  const inHorizon = (m?: number) => (m !== undefined && m <= horizon ? Math.max(1, m) : undefined);

  return {
    horizon,
    points,
    start: baseline[0],
    baselineEnd: baseline[horizon],
    scenarioEnd: scenario[horizon],
    gap: scenario[horizon] - baseline[horizon],
    monthly: { baseline: planMonthly, scenario: scenarioMonthly },
    restitution: { done, baselineMonth: inHorizon(plannedMonth), scenarioMonth: inHorizon(scenarioRestMonth), scenarioIgnored: done && !!restScenario },
    purchases: outcomes,
    goal: target ? {
      target,
      baselineMonth: firstReach(baseline, target),
      scenarioMonth: firstReach(scenario, target),
      p50Month: bands ? firstReach(bands.p50, target) : null,
    } : undefined,
    band: bands ? { runs, historyMonths: history.length } : null,
    bandUnavailable,
  };
};
