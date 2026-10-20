// ================================================
// FILE: src/lib/projection.ts
// Rendement net comparé, projection de l'épargne selon la répartition, hausse de salaire
// détectée et pastille de l'icône. Fonctions pures, testées.
// ================================================
import { AccountType, FiscalConfig, GlobalAppData, SavingsAccount, PayslipRecord } from '../types';
import {
  computePlacementStrategy, activeSavingsSplit, SavingsSplit, payslipSuperNet, payPeriodOf,
  buildPayLines, computePayTransfers, computeMonthlySavingsCapacity, findDueRecurring,
  findStaleRegulatedRates, findFiscalReview, findAvRateUpdatesDue, socialChargesRateFor,
  accountAgeYears, computeMaturityCountdown, PFU_INCOME_TAX_RATE,
} from './finance';
import { parseISODate } from './dates';
import { accruedSinceJanuary, applyMonthlyInterest } from './yearlyInterest';
import { DEFAULT_FISCAL_CONFIG } from '../constants';

// ---------------------------------------------------------------------------
// Rendement net
// ---------------------------------------------------------------------------

const TAX_FREE = [AccountType.LIVRET_A, AccountType.LDDS, AccountType.LEP];

/** Part « impôt sur le revenu » retenue dans le taux net, selon le régime à `asOfDate`. */
const incomeTaxShare = (account: { type: AccountType; openingDate?: string }, fiscalConfig: FiscalConfig, asOfDate: Date): number => {
  // Ancienneté inconnue : jamais d'exonération non prouvée (comme computeCapitalGainsTax).
  const age = account.openingDate ? accountAgeYears(account.openingDate, asOfDate) : 0;
  switch (account.type) {
    case AccountType.PEA: return age >= fiscalConfig.legalMaturity.pea ? 0 : PFU_INCOME_TAX_RATE;
    // Après 8 ans : gains annuels supposés sous l'abattement de 4 600 €.
    case AccountType.ASSURANCE_VIE: return age >= fiscalConfig.legalMaturity.assuranceVie ? 0 : PFU_INCOME_TAX_RATE;
    // Plus-values de crypto : PFU quelle que soit la durée de détention (art. 150 VH bis du
    // CGI). Livret bancaire, compte à terme, compte rémunéré (« Autre », compte courant) :
    // intérêts imposés chaque année au PFU.
    case AccountType.CRYPTO:
    case AccountType.AUTRE:
    case AccountType.COMPTE_COURANT:
      return PFU_INCOME_TAX_RATE;
    // PEE : toujours exonéré d'impôt sur le revenu. PER et immobilier : régime de sortie trop
    // particulier, seuls les prélèvements sociaux sont retenus.
    default: return 0;
  }
};

/**
 * Taux net réellement gagné chaque année, en %, si l'on retirait les gains à `asOfDate`.
 * - Livret A, LDDS, LEP : le taux affiché, sans impôt ni frais.
 * - Autres : taux − frais de gestion éventuels (le taux servi d'un fonds euros est publié
 *   NET de frais : les frais ne concernent que les unités de compte), puis − prélèvements
 *   sociaux (17,2 % sur l'assurance vie, 18,6 % ailleurs en 2026) − impôt sur le revenu
 *   de 12,8 % (PFU) quand il est dû : crypto, « Autre » et compte courant toujours, PEA de
 *   moins de 5 ans, assurance vie de moins de 8 ans. Une assurance vie plus ancienne est
 *   supposée sous l'abattement annuel ; PEE exonéré ; PER et immobilier non modélisés.
 *   Sources (vérifiées le 2026-10-14) : https://www.service-public.gouv.fr/particuliers/vosdroits/F2329
 *   et https://www.impots.gouv.fr/particulier/questions/jai-realise-une-plus-value-mobiliere-comment-est-elle-imposee
 */
export const netAnnualRate = (
  account: { type: AccountType; interestRate?: number; managementFee?: number; openingDate?: string },
  fiscalConfig: FiscalConfig,
  asOfDate: Date = new Date()
): number => {
  const rate = account.interestRate || 0;
  if (TAX_FREE.includes(account.type)) return rate;
  const afterFees = Math.max(0, rate - (account.managementFee || 0));
  return afterFees * (1 - socialChargesRateFor(account.type, fiscalConfig) - incomeTaxShare(account, fiscalConfig, asOfDate));
};

/**
 * Taux net MENSUEL (fraction) de chaque mois d'une projection qui commence à `start`
 * (m = 0 : premier mois) : un PEA ou une assurance vie passe au taux sans impôt sur le
 * revenu le mois de son anniversaire fiscal. Les gains d'avant restent comptés au taux
 * d'avant (prudent : en vrai, l'ancienneté au retrait vaut pour tous les gains).
 */
export const netMonthlyRateSchedule = (
  account: { type: AccountType; interestRate?: number; managementFee?: number; openingDate?: string },
  fiscalConfig: FiscalConfig,
  start: Date
): ((m: number) => number) => {
  const before = netAnnualRate(account, fiscalConfig, start) / 100 / 12;
  const maturity = computeMaturityCountdown({ ...account, totalAmount: 0 }, fiscalConfig, start);
  if (!maturity) return () => before;
  const after = netAnnualRate(account, fiscalConfig, parseISODate(maturity.maturityDate)) / 100 / 12;
  return m => (m >= maturity.monthsRemaining ? after : before);
};

// ---------------------------------------------------------------------------
// Projection selon la répartition
// ---------------------------------------------------------------------------

export interface ProjectionResult {
  total: number;
  deposited: number;
  interest: number;
  byAccount: { accountId: string; name: string; amount: number }[];
  /** Versé sans compte où le placer (livrets pleins, ni AV ni PEA) : resté sur le compte courant. */
  unplaced: number;
}

/** Identifiant du compte courant « virtuel » qui garde l'argent sans destination. */
export const IDLE_ACCOUNT_ID = '__current';

/**
 * Projection mois par mois : versement mensuel réparti selon `split` (plafonds des livrets
 * respectés, excédent reporté), intérêts nets composés mensuellement (taux mûr à partir de
 * la maturité fiscale d'un PEA ou d'une assurance vie), sauf Livret A, LDDS et LEP : versés
 * au 31 décembre (ceux de l'année en cours, déjà acquis, compris ; ceux de la dernière
 * année pas encore versés ne sont pas comptés). Part de vos soldes propres actuels
 * (la part des parents est ignorée), compte courant compris. Ce que le plan ne peut placer
 * nulle part reste sur le compte courant (sans intérêt) : compté, jamais perdu.
 */
export const projectSavings = (
  accounts: SavingsAccount[],
  fiscalConfig: FiscalConfig,
  monthly: number,
  years: number,
  split?: SavingsSplit,
  // Mois (à partir de maintenant) où les parents reprennent leur capital : les livrets
  // retrouvent de la place sous leurs plafonds et ce capital cesse de produire des intérêts.
  restitutionInMonths?: number,
  asOfDate: Date = new Date()
): ProjectionResult => {
  // Les plafonds se vérifient sur le solde RÉEL (part des parents comprise) ; le résultat
  // ne compte que votre part. Les intérêts du capital parental vous reviennent (accord
  // familial) : ils s'ajoutent à votre part.
  // Livret A, LDDS, LEP : intérêts versés au 31 décembre, y compris ceux déjà acquis depuis
  // le 1er janvier (voir ./yearlyInterest, même règle que le simulateur et le plan solo).
  const accrued = accruedSinceJanuary(accounts, asOfDate);
  const sim = accounts
    .filter(a => a.type !== AccountType.IMMOBILIER)
    .map(a => ({ ...a, own: a.ownedAmount, accrued: accrued.get(a.id) ?? 0 }));
  const start = sim.reduce((s, a) => s + a.own, 0);
  const rates = new Map(sim.map(a => [a.id, netMonthlyRateSchedule(a, fiscalConfig, asOfDate)]));
  let unplaced = 0;
  const idle = () => {
    let cc = sim.find(a => a.type === AccountType.COMPTE_COURANT);
    if (!cc) {
      cc = { id: IDLE_ACCOUNT_ID, name: 'Compte courant', type: AccountType.COMPTE_COURANT, institution: '', totalAmount: 0, ownedAmount: 0, parentalCapital: 0, own: 0, accrued: 0 };
      sim.push(cc);
    }
    return cc;
  };
  for (let m = 0; m < years * 12; m++) {
    if (restitutionInMonths !== undefined && m === Math.max(0, restitutionInMonths)) {
      for (const a of sim) a.totalAmount = a.own;
    }
    const december = (asOfDate.getMonth() + m) % 12 === 11;
    for (const a of sim) {
      if (a.type === AccountType.COMPTE_COURANT) continue;
      a.own += applyMonthlyInterest(a, rates.get(a.id)?.(m) || 0, december);
    }
    for (const st of computePlacementStrategy(monthly, sim, fiscalConfig, split)) {
      if (st.infoOnly) continue;
      const target = st.accountId ? sim.find(x => x.id === st.accountId) : undefined;
      const a = target || idle();
      if (!target) unplaced += st.fillAmount;
      a.totalAmount += st.fillAmount; a.own += st.fillAmount;
    }
  }
  const total = sim.reduce((s, a) => s + a.own, 0);
  const deposited = monthly * years * 12;
  return {
    total, deposited, interest: total - start - deposited, unplaced,
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
