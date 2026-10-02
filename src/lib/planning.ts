// Planification : épargne de précaution, plan « solo » après la restitution du capital des
// parents, aide à la déclaration de revenus, revue des abonnements. Fonctions pures, testées.
import { AccountType, FiscalConfig, GlobalAppData, PayslipRecord, SavingsAccount, Subscription, WorkBenefits } from '../types';
import { computeDonationSummary, computePlacementStrategy, subscriptionMonthlyCost, isMonthlyCharge, SavingsSplit, accountsAfterRestitution } from './finance';
import { netAnnualRate } from './projection';
import { parseISODate, formatISODay } from './dates';

// ---------------------------------------------------------------------------
// Épargne de précaution
// ---------------------------------------------------------------------------

/** Comptes disponibles sans délai ni impôt : ce qui compte pour la précaution. */
export const EMERGENCY_TYPES = [AccountType.LIVRET_A, AccountType.LDDS, AccountType.LEP, AccountType.COMPTE_COURANT];
export const DEFAULT_EMERGENCY_MONTHS = 3;

export interface EmergencyFund {
  months: number;
  monthlySpending: number; // charges fixes + argent plaisir
  target: number;
  current: number;         // votre part seulement (le capital des parents n'est pas à vous)
  missing: number;
  pct: number;
  reached: boolean;
}

export const computeEmergencyFund = (
  accounts: SavingsAccount[],
  monthlySpending: number,
  months: number = DEFAULT_EMERGENCY_MONTHS
): EmergencyFund | null => {
  if (!(monthlySpending > 0) || !(months > 0)) return null;
  const target = Math.round(monthlySpending * months);
  const current = accounts.filter(a => EMERGENCY_TYPES.includes(a.type)).reduce((s, a) => s + Math.max(0, a.ownedAmount), 0);
  const missing = Math.max(0, target - current);
  return { months, monthlySpending, target, current, missing, pct: Math.min(100, (current / target) * 100), reached: missing <= 0 };
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
export interface SoloPlan { years: SoloPlanYear[]; milestones: SoloMilestone[]; startTotal: number }

/**
 * Simule mois par mois à partir de la restitution (capital des parents retiré) : versement
 * mensuel réparti selon le plan de placement ou votre répartition, plafonds respectés,
 * intérêts nets. Repère les étapes : précaution atteinte, chaque livret plein.
 */
export const buildSoloPlan = (
  accounts: SavingsAccount[],
  fiscal: FiscalConfig,
  monthly: number,
  restitutionISO: string,
  opts: { years?: number; split?: SavingsSplit; emergencyTarget?: number } = {}
): SoloPlan => {
  const years = opts.years ?? 4;
  const start = parseISODate(restitutionISO);
  const sim = accountsAfterRestitution(accounts, restitutionISO)
    .filter(a => a.type !== AccountType.IMMOBILIER)
    .map(a => ({ ...a }));
  const rates = new Map(sim.map(a => [a.id, netAnnualRate(a, fiscal) / 100 / 12]));
  const milestones: SoloMilestone[] = [];
  const fullNoted = new Set<string>();
  let emergencyNoted = false;
  const startTotal = sim.reduce((s, a) => s + a.ownedAmount, 0);
  const out: SoloPlanYear[] = [];
  const ceilingOf = (a: SavingsAccount) => a.ceiling ?? (a.type === AccountType.LIVRET_A ? fiscal.ceilings.livretA : a.type === AccountType.LDDS ? fiscal.ceilings.ldds : a.type === AccountType.LEP ? fiscal.ceilings.lep : undefined);

  for (let m = 0; m < years * 12; m++) {
    const date = new Date(start.getFullYear(), start.getMonth() + m, 1);
    for (const a of sim) {
      if (a.type === AccountType.COMPTE_COURANT) continue;
      const interest = a.totalAmount * (rates.get(a.id) || 0);
      a.totalAmount += interest; a.ownedAmount += interest;
    }
    if (monthly > 0) {
      for (const st of computePlacementStrategy(monthly, sim, fiscal, opts.split)) {
        if (st.infoOnly || !st.accountId) continue;
        const a = sim.find(x => x.id === st.accountId);
        if (a) { a.totalAmount += st.fillAmount; a.ownedAmount += st.fillAmount; }
      }
    }
    for (const a of sim) {
      const c = ceilingOf(a);
      if (c && !fullNoted.has(a.id) && a.totalAmount >= c - 1) {
        fullNoted.add(a.id);
        milestones.push({ date: formatISODay(date), label: `${a.name} plein` });
      }
    }
    if (opts.emergencyTarget && !emergencyNoted) {
      const liquid = sim.filter(a => EMERGENCY_TYPES.includes(a.type)).reduce((s, a) => s + a.ownedAmount, 0);
      if (liquid >= opts.emergencyTarget) { emergencyNoted = true; milestones.push({ date: formatISODay(date), label: 'Épargne de précaution atteinte' }); }
    }
    if (date.getMonth() === 11 || m === years * 12 - 1) {
      out.push({
        year: date.getFullYear(),
        total: Math.round(sim.reduce((s, a) => s + a.ownedAmount, 0)),
        byAccount: sim.filter(a => a.ownedAmount > 0.5).map(a => ({ accountId: a.id, name: a.name, amount: Math.round(a.ownedAmount) })),
      });
    }
  }
  return { years: out.filter((y, i, arr) => arr.findIndex(z => z.year === y.year) === i), milestones, startTotal: Math.round(startTotal) };
};

// ---------------------------------------------------------------------------
// Aide à la déclaration de revenus
// ---------------------------------------------------------------------------

export interface TaxReturnLine {
  box: string;          // case du formulaire (ex. « 1AJ »)
  label: string;
  amount?: number;
  note: string;
  confidence: 'exact' | 'estimate' | 'info';
}

/**
 * Ce qu'il faut vérifier ou reporter sur la déclaration de l'année `incomeYear` (déposée
 * au printemps suivant). Les montants pré-remplis par l'administration restent la
 * référence : l'app aide à les contrôler.
 */
export const buildTaxReturnChecklist = (
  data: Pick<GlobalAppData, 'payslips' | 'donations' | 'accounts'>,
  incomeYear: number,
  opts: { estimatedNetTaxableBeforeAllowance?: number; allowanceRate?: number; allowanceCap?: number; ceiling75?: number } = {}
): TaxReturnLine[] => {
  const lines: TaxReturnLine[] = [];
  const slips = (data.payslips || []).filter(p => p.extracted?.period?.startsWith(`${incomeYear}-`));
  const months = new Set(slips.map(p => p.extracted.period));
  const taxable = slips.reduce((s, p) => s + (p.extracted.netTaxable || 0), 0);
  if (months.size > 0 && taxable > 0) {
    lines.push({
      box: '1AJ', label: 'Salaires', amount: Math.round(taxable), confidence: months.size >= 12 ? 'exact' : 'estimate',
      note: months.size >= 12 ? 'Somme des nets imposables de vos 12 fiches : comparez au montant pré-rempli.'
        : `Somme de ${months.size} fiche${months.size > 1 ? 's' : ''} sur 12 : le cumul « net imposable » de votre fiche de décembre fait foi.`,
    });
  } else if (opts.estimatedNetTaxableBeforeAllowance) {
    lines.push({ box: '1AJ', label: 'Salaires', amount: Math.round(opts.estimatedNetTaxableBeforeAllowance), confidence: 'estimate',
      note: 'Estimation depuis votre salaire brut. Le cumul « net imposable » de votre fiche de décembre fait foi.' });
  }
  const withheld = slips.reduce((s, p) => s + (p.extracted.incomeTaxWithheld || 0), 0);
  if (withheld > 0) {
    lines.push({ box: '8HV', label: 'Impôt déjà prélevé à la source', amount: Math.round(withheld), confidence: months.size >= 12 ? 'exact' : 'estimate',
      note: 'Pré-rempli par l\'administration ; sert à calculer le solde à payer ou à rembourser.' });
  }
  const base = lines.find(l => l.box === '1AJ')?.amount;
  if (base && opts.allowanceRate) {
    const allowance = Math.min(base * opts.allowanceRate, opts.allowanceCap ?? Infinity);
    lines.push({ box: '1AK', label: 'Frais réels (facultatif)', confidence: 'info',
      note: `L'abattement automatique de 10 % vaut environ ${Math.round(allowance).toLocaleString('fr-FR')} €. Déclarez vos frais réels (trajets, repas…) seulement s'ils dépassent ce montant.` });
  }
  const don = computeDonationSummary(data.donations || [], incomeYear, { ceiling75: opts.ceiling75 });
  if (don.total75 > 0) lines.push({ box: '7UD', label: 'Dons aux organismes d\'aide aux personnes en difficulté', amount: Math.round(don.total75), confidence: 'exact', note: 'Réduction de 75 %. Gardez les reçus fiscaux.' });
  if (don.total66 > 0) lines.push({ box: '7UF', label: 'Autres dons', amount: Math.round(don.total66), confidence: 'exact', note: 'Réduction de 66 %, dans la limite de 20 % du revenu imposable.' });
  if (don.missingReceipts.length > 0) lines.push({ box: '—', label: 'Reçus manquants', confidence: 'info', note: `${don.missingReceipts.length} don${don.missingReceipts.length > 1 ? 's' : ''} sans reçu fiscal noté : réclamez-le avant de déclarer.` });

  const yearStart = `${incomeYear}-01-01`, yearEnd = `${incomeYear}-12-31`;
  const avWithdrawals = (data.accounts || []).filter(a => a.type === AccountType.ASSURANCE_VIE)
    .flatMap(a => (a.movements || []).filter(m => m.type === 'OUT' && !m.kind && m.date >= yearStart && m.date <= yearEnd));
  if (avWithdrawals.length > 0) {
    lines.push({ box: '2CH / 2DH / 2ZZ', label: 'Rachat d\'assurance vie', confidence: 'info',
      note: 'Votre assureur vous envoie un relevé (IFU) au printemps : les montants sont pré-remplis, vérifiez-les avec lui.' });
  }
  if ((data.accounts || []).some(a => [AccountType.LIVRET_A, AccountType.LDDS, AccountType.LEP].includes(a.type))) {
    lines.push({ box: '—', label: 'Intérêts des livrets', confidence: 'info', note: 'Livret A, LDDS et LEP sont exonérés : rien à déclarer.' });
  }
  return lines;
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

export const REVIEW_EVERY_DAYS = 182;

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
