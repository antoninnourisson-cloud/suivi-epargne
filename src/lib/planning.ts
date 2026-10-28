// Planification : épargne de précaution, plan « solo » après la restitution du capital des
// parents, aide à la déclaration de revenus, revue des abonnements. Fonctions pures, testées.
import { AccountType, FiscalConfig, PayslipRecord, SavingsAccount, Subscription, WorkBenefits } from '../types';
import { subscriptionMonthlyCost, isMonthlyCharge, SavingsSplit, accountsAfterRestitution } from './finance';
import { netMonthlyRateSchedule } from './projection';
import { parseISODate, formatISODay } from './dates';
import { prepareProjection, projectedTotal, runProjection } from './projectionEngine';
import { currentAccountBuffer } from './idleCash';
import { growthView } from './performance';

// ---------------------------------------------------------------------------
// Épargne de précaution
// ---------------------------------------------------------------------------

/**
 * Comptes disponibles sans délai ni impôt : ce qui compte pour la précaution. Livret
 * bancaire et CEL aussi : retraits libres (garder 300 € sur un CEL).
 */
const EMERGENCY_TYPES = [AccountType.LIVRET_A, AccountType.LDDS, AccountType.LEP, AccountType.LIVRET_BANCAIRE, AccountType.CEL, AccountType.COMPTE_COURANT];
export const DEFAULT_EMERGENCY_MONTHS = 3;

export interface EmergencyFund {
  months: number;
  monthlySpending: number; // charges fixes + argent plaisir
  target: number;
  current: number;         // votre part seulement (le capital des parents n'est pas à vous)
  /** Gardé sur le compte courant pour les dépenses du quotidien : pas compté dans `current` (toujours renseigné par computeEmergencyFund). */
  cashBuffer?: number;
  missing: number;
  pct: number;
  reached: boolean;
}

/**
 * Épargne de précaution disponible (votre part) : livrets et comptes sans délai, plus ce qui
 * dépasse sur les comptes courants le coussin des dépenses du quotidien (`cashBuffer`, un mois
 * et demi de dépenses, le même que l'alerte « argent qui dort ») : un même euro ne sert pas
 * deux fois, aux dépenses du mois et à l'imprévu.
 */
export const emergencySavingsOf = (accounts: Pick<SavingsAccount, 'type' | 'ownedAmount'>[], cashBuffer: number): number => {
  const current = accounts.filter(a => a.type === AccountType.COMPTE_COURANT).reduce((s, a) => s + Math.max(0, a.ownedAmount), 0);
  const others = accounts.filter(a => a.type !== AccountType.COMPTE_COURANT && EMERGENCY_TYPES.includes(a.type)).reduce((s, a) => s + Math.max(0, a.ownedAmount), 0);
  return others + Math.max(0, current - Math.max(0, cashBuffer));
};

export const computeEmergencyFund = (
  accounts: SavingsAccount[],
  monthlySpending: number,
  months: number = DEFAULT_EMERGENCY_MONTHS
): EmergencyFund | null => {
  if (!(monthlySpending > 0) || !(months > 0)) return null;
  const target = Math.round(monthlySpending * months);
  const cashBuffer = currentAccountBuffer(monthlySpending);
  const current = emergencySavingsOf(accounts, cashBuffer);
  const missing = Math.max(0, target - current);
  return { months, monthlySpending, target, current, cashBuffer, missing, pct: Math.min(100, (current / target) * 100), reached: missing <= 0 };
};

// ---------------------------------------------------------------------------
// Plan « solo » : année par année, après la restitution
// ---------------------------------------------------------------------------

export interface SoloPlanYear {
  year: number;
  total: number;                       // votre épargne au 31 décembre
  byAccount: { accountId: string; name: string; amount: number }[];
}
export interface SoloMilestone { date: string; label: string }
export interface SoloPlan {
  years: SoloPlanYear[]; milestones: SoloMilestone[]; startTotal: number;
  /** Versé sans compte où le placer (livrets pleins, ni AV ni PEA) : resté sur le compte courant. */
  unplaced: number;
}

/**
 * Simule mois par mois à partir de la restitution (capital des parents retiré) : versement
 * mensuel réparti selon le plan de placement ou votre répartition, plafonds respectés,
 * intérêts nets (taux mûr dès la maturité fiscale d'un PEA ou d'une assurance vie ; ceux du
 * Livret A, du LDDS et du LEP versés au 31 décembre). Ce que
 * le plan ne peut placer nulle part reste sur le compte courant, compté. Repère les étapes :
 * précaution atteinte, chaque livret plein.
 */
export const buildSoloPlan = (
  accounts: SavingsAccount[],
  fiscal: FiscalConfig,
  monthly: number,
  restitutionISO: string,
  opts: {
    years?: number; split?: SavingsSplit; emergencyTarget?: number; cashBuffer?: number;
    /** Rendement supposé des placements sans taux saisi (withAssumedRates), comme au Rendement. */
    assumedRates?: Readonly<Record<string, number>>;
  } = {}
): SoloPlan => {
  const years = opts.years ?? 4;
  const start = parseISODate(restitutionISO);
  const after = accountsAfterRestitution(accounts, restitutionISO);
  // Même moteur que projectSavings et le simulateur (./projectionEngine) : intérêts nets
  // du mois, puis versement réparti. Livret A, LDDS, LEP : intérêts versés au 31 décembre,
  // y compris ceux acquis depuis le 1er janvier, part des parents comprise jusqu'à la
  // restitution (offerts).
  const setup = prepareProjection(after, start, a => netMonthlyRateSchedule(growthView(a, opts.assumedRates), fiscal, start));
  const milestones: SoloMilestone[] = [];
  const fullNoted = new Set<string>();
  let emergencyNoted = false;
  const startTotal = setup.base.reduce((s, a) => s + a.ownedAmount, 0);
  const out: SoloPlanYear[] = [];
  const ceilingOf = (a: SavingsAccount) => a.ceiling ?? (a.type === AccountType.LIVRET_A ? fiscal.ceilings.livretA : a.type === AccountType.LDDS ? fiscal.ceilings.ldds : a.type === AccountType.LEP ? fiscal.ceilings.lep : undefined);

  const state = runProjection(setup, fiscal, {
    months: years * 12,
    deposit: () => monthly,
    split: opts.split,
    // Étape m : le mois qui commence `m − 1` mois après la restitution (repères datés du 1er).
    onMonth: (s, m) => {
      const date = new Date(start.getFullYear(), start.getMonth() + m - 1, 1);
      for (const a of s.accounts) {
        const c = ceilingOf(a);
        if (c && !fullNoted.has(a.id) && a.totalAmount >= c - 1) {
          fullNoted.add(a.id);
          milestones.push({ date: formatISODay(date), label: `${a.name} plein` });
        }
      }
      if (opts.emergencyTarget && !emergencyNoted) {
        // Même règle que computeEmergencyFund : le coussin du compte courant n'en fait pas partie.
        if (emergencySavingsOf(s.accounts.map(a => ({ ...a, ownedAmount: a.own })), opts.cashBuffer ?? 0) >= opts.emergencyTarget) {
          emergencyNoted = true; milestones.push({ date: formatISODay(date), label: 'Épargne de précaution atteinte' });
        }
      }
      if (date.getMonth() === 11 || m === years * 12) {
        out.push({
          year: date.getFullYear(),
          total: Math.round(projectedTotal(s)),
          byAccount: s.accounts.filter(a => a.own > 0.5).map(a => ({ accountId: a.id, name: a.name, amount: Math.round(a.own) })),
        });
      }
    },
  });
  return { years: out.filter((y, i, arr) => arr.findIndex(z => z.year === y.year) === i), milestones, startTotal: Math.round(startTotal), unplaced: Math.round(state.unplaced) };
};

// ---------------------------------------------------------------------------
// Revue des abonnements
// ---------------------------------------------------------------------------

export interface SubscriptionReviewRow {
  sub: Subscription;
  yearly: number;
  shareOfPay?: number;          // % de la paie mensuelle
  priceIncrease?: { from: number; to: number; date: string };
  reviewDue: boolean;           // pas confirmé « toujours utile » depuis 6 mois
  cancelBy?: string;            // abonnement annuel : date limite de résiliation
}

const REVIEW_EVERY_DAYS = 182;

export const reviewSubscriptions = (subs: Subscription[], monthlyPay: number, asOf: Date = new Date()): SubscriptionReviewRow[] => {
  const today = formatISODay(asOf);
  return subs.filter(s => s.active && s.amount > 0).map(s => {
    const yearly = subscriptionMonthlyCost(s) * 12;
    const hist = s.priceHistory || [];
    const last = hist[hist.length - 1];
    const priceIncrease = last && last.amount < s.amount ? { from: last.amount, to: s.amount, date: last.date } : undefined;
    const reviewedAt = s.reviewedAt ? parseISODate(s.reviewedAt) : undefined;
    const reviewDue = !reviewedAt || (asOf.getTime() - reviewedAt.getTime()) / 86_400_000 >= REVIEW_EVERY_DAYS;
    let cancelBy: string | undefined;
    if (!isMonthlyCharge(s) && s.noticeDays) {
      const anchor = parseISODate(s.anchorDate);
      let next = new Date(anchor);
      const step = s.frequency === 'yearly' ? 12 : s.frequency === 'semiannual' ? 6 : 3;
      while (formatISODay(next) < today) next = new Date(next.getFullYear(), next.getMonth() + step, next.getDate());
      cancelBy = formatISODay(new Date(next.getFullYear(), next.getMonth(), next.getDate() - s.noticeDays));
    }
    return { sub: s, yearly, shareOfPay: monthlyPay > 0 ? (subscriptionMonthlyCost(s) / monthlyPay) * 100 : undefined, priceIncrease, reviewDue, cancelBy };
  }).sort((a, b) => b.yearly - a.yearly);
};

// ---------------------------------------------------------------------------
// Avantages salariaux : chiffres réels des fiches de paie
// ---------------------------------------------------------------------------

export interface BenefitsFromPayslips {
  benefits: WorkBenefits;
  months: number;          // nombre de fiches utilisées (les 3 plus récentes au plus)
  navigoRefund?: number;   // moyennes mensuelles relevées
  mealVouchersEmployee?: number;
  mutuelleEmployee?: number;
}

/**
 * Remboursement transport, part salariale des titres-restaurant et de la mutuelle : moyennes
 * des 3 dernières fiches qui en parlent. Navigo remboursé à `navigoRate` %, titres-restaurant
 * payés à `mealEmployerRate` % par l'employeur. Une ligne absente des fiches = avantage
 * désactivé (rien retenu, rien remboursé).
 */
export const benefitsFromPayslips = (
  payslips: PayslipRecord[],
  current: WorkBenefits,
  opts: { navigoRate?: number; mealEmployerRate?: number } = {},
): BenefitsFromPayslips | null => {
  const recent = [...payslips].filter(p => p.extracted?.period).sort((a, b) => (b.extracted.period || '').localeCompare(a.extracted.period || '')).slice(0, 3);
  if (recent.length === 0) return null;
  const avg = (k: 'navigoRefund' | 'mealVouchers' | 'mutuelleCost') => {
    const v = recent.map(p => p.extracted[k]).filter((x): x is number => typeof x === 'number' && x > 0);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : undefined;
  };
  const navigoRate = opts.navigoRate ?? 50;
  const mealRate = opts.mealEmployerRate ?? 50;
  const nav = avg('navigoRefund'), meal = avg('mealVouchers'), mut = avg('mutuelleCost');
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const face = current.mealVouchers.faceValue > 0 ? current.mealVouchers.faceValue : 10;
  return {
    months: recent.length,
    navigoRefund: nav, mealVouchersEmployee: meal, mutuelleEmployee: mut,
    benefits: {
      navigo: nav ? { active: true, basePrice: r2(nav / (navigoRate / 100)), refundRate: navigoRate } : { ...current.navigo, active: false },
      // Part salariale constatée : coût = montant retenu (la part patronale n'apparaît pas).
      mutuelle: mut ? { active: true, totalCost: r2(mut), employerRate: 0 } : { ...current.mutuelle, active: false },
      mealVouchers: meal
        ? { active: true, faceValue: face, employerRate: mealRate, daysPerMonth: Math.max(1, Math.round(meal / (face * (1 - mealRate / 100)))) }
        : { ...current.mealVouchers, active: false },
    },
  };
};
