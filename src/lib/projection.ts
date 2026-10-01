// ================================================
// FILE: src/lib/projection.ts
// Rendement net comparé, projection de l'épargne selon la répartition, hausse de salaire
// détectée et pastille de l'icône. Fonctions pures, testées.
// ================================================
import { AccountType, FiscalConfig, GlobalAppData, SavingsAccount, PayslipRecord } from '../types';
import {
  computePlacementStrategy, activeSavingsSplit, SavingsSplit, payslipSuperNet, payPeriodOf,
  buildPayLines, computePayTransfers, computeMonthlySavingsCapacity, findDueRecurring,
  findStaleRegulatedRates, findFiscalReview, findAvRateUpdatesDue,
} from './finance';
import { DEFAULT_FISCAL_CONFIG } from '../constants';

// ---------------------------------------------------------------------------
// Rendement net
// ---------------------------------------------------------------------------

const TAX_FREE = [AccountType.LIVRET_A, AccountType.LDDS, AccountType.LEP];

/**
 * Taux net réellement gagné chaque année, en %.
 * - Livret A, LDDS, LEP : le taux affiché, sans impôt ni frais.
 * - Assurance Vie, PEA, PER… : taux − frais de gestion éventuels, puis − 17,2 % de
 *   prélèvements sociaux. Le taux servi d'un fonds euros est publié NET de frais de
 *   gestion : les frais ne concernent que les unités de compte (0 par défaut).
 *   L'impôt sur le revenu éventuel au retrait n'est pas compté (rien après 8 ans pour
 *   des gains annuels sous l'abattement).
 */
export const netAnnualRate = (account: { type: AccountType; interestRate?: number; managementFee?: number }, fiscalConfig: FiscalConfig): number => {
  const rate = account.interestRate || 0;
  if (TAX_FREE.includes(account.type)) return rate;
  const afterFees = Math.max(0, rate - (account.managementFee || 0));
  return afterFees * (1 - fiscalConfig.socialChargesCapital);
};

// ---------------------------------------------------------------------------
// Projection selon la répartition
// ---------------------------------------------------------------------------

export interface ProjectionResult {
  total: number;
  deposited: number;
  interest: number;
  byAccount: { accountId: string; name: string; amount: number }[];
}

/**
 * Projection mois par mois : versement mensuel réparti selon `split` (plafonds des livrets
 * respectés, excédent reporté), intérêts nets composés mensuellement. Part de vos soldes
 * propres actuels (la part des parents est ignorée).
 */
export const projectSavings = (
  accounts: SavingsAccount[],
  fiscalConfig: FiscalConfig,
  monthly: number,
  years: number,
  split?: SavingsSplit
): ProjectionResult => {
  // Les plafonds se vérifient sur le solde RÉEL (part des parents comprise) ; le résultat
  // ne compte que votre part. Les intérêts du capital parental vous reviennent (accord
  // familial) : ils s'ajoutent à votre part.
  const sim = accounts
    .filter(a => a.type !== AccountType.COMPTE_COURANT && a.type !== AccountType.IMMOBILIER)
    .map(a => ({ ...a, own: a.ownedAmount }));
  const start = sim.reduce((s, a) => s + a.own, 0);
  const rates = new Map(sim.map(a => [a.id, netAnnualRate(a, fiscalConfig) / 100 / 12]));
  for (let m = 0; m < years * 12; m++) {
    for (const a of sim) {
      const interest = a.totalAmount * (rates.get(a.id) || 0);
      a.totalAmount += interest;
      a.own += interest;
    }
    for (const st of computePlacementStrategy(monthly, sim, fiscalConfig, split)) {
      if (st.infoOnly || !st.accountId) continue;
      const a = sim.find(x => x.id === st.accountId);
      if (a) { a.totalAmount += st.fillAmount; a.own += st.fillAmount; }
    }
  }
  const total = sim.reduce((s, a) => s + a.own, 0);
  const deposited = monthly * years * 12;
  return {
    total, deposited, interest: total - start - deposited,
    byAccount: sim.filter(a => a.own >= 0.5).map(a => ({ accountId: a.id, name: a.name, amount: a.own })),
  };
};

// ---------------------------------------------------------------------------
// Hausse de salaire
// ---------------------------------------------------------------------------

/** Net de la dernière fiche (par période) comparé à la précédente : hausse d'au moins 20 €. */
export const detectPayRaise = (payslips: PayslipRecord[]): { latest: PayslipRecord; previousNet: number; latestNet: number; delta: number } | null => {
  const dated = payslips
    .map(p => ({ p, net: payslipSuperNet(p.extracted) }))
    .filter((x): x is { p: PayslipRecord; net: number } => !!x.p.extracted.period && x.net !== undefined)
    .sort((a, b) => a.p.extracted.period!.localeCompare(b.p.extracted.period!));
  if (dated.length < 2) return null;
  const last = dated[dated.length - 1], prev = dated[dated.length - 2];
  const delta = last.net - prev.net;
  return delta >= 20 ? { latest: last.p, previousNet: prev.net, latestNet: last.net, delta } : null;
};

// ---------------------------------------------------------------------------
// Pastille de l'icône
// ---------------------------------------------------------------------------

/**
 * Nombre de choses à faire, affiché sur l'icône de l'app installée : virements de la paie
 * en cours non cochés, échéances récurrentes à enregistrer, taux et paramètres fiscaux à
 * revoir.
 */
export const computeBadgeCount = (data: GlobalAppData, asOfDate: Date = new Date()): number => {
  const accounts = data.accounts || [];
  const cfg = data.fiscalConfig || DEFAULT_FISCAL_CONFIG;
  let count = 0;
  const payday = data.config?.paydayDay;
  if (payday) {
    const period = payPeriodOf(payday, asOfDate);
    const checklist = data.payChecklist && data.payChecklist.month === period.key ? data.payChecklist : undefined;
    const amount = data.config.paydayAmount ?? computeMonthlySavingsCapacity(data);
    const lines = checklist?.lines ?? buildPayLines(
      computePayTransfers({ expenses: data.expenses || [], subscriptions: data.subscriptions, leisureBudget: data.config.leisureBudget ?? 0, projectSavings: data.config.projectSavings ?? 0 }),
      amount > 0 ? computePlacementStrategy(amount, accounts, cfg, activeSavingsSplit(data.config, asOfDate)) : []
    );
    count += lines.filter(l => !checklist?.done[l.key]).length;
  }
  count += findDueRecurring(data.recurringMovements || [], accounts, asOfDate).length;
  if (findStaleRegulatedRates(accounts, asOfDate)) count += 1;
  const review = findFiscalReview(cfg, asOfDate);
  if (review.newScale) count += 1;
  if (review.annualCheckDue) count += 1;
  if (findAvRateUpdatesDue(accounts, asOfDate).length > 0) count += 1;
  return count;
};
