// Capacité d'épargne et plan de placement (Pilotage, rappel de paie).
// Partie de src/lib/finance.ts (qui réexporte tout) : importez depuis '../finance'.
import { FiscalConfig, AccountType, SavingsAccount, GlobalAppData, PayslipExtractedData } from '../../types';
import { DEFAULT_FISCAL_CONFIG, DEFAULT_WORK_BENEFITS } from '../../constants';
import { formatISODay } from '../dates';
import { computeIncome, computeSavingsCapacity } from './income';
import { totalFixedCharges } from './subscriptions';

// ---------------------------------------------------------------------------
// Capacité d'épargne et plan de placement (Pilotage)
// ---------------------------------------------------------------------------
// Sortis du composant pour que le serveur (rappel du jour de paie) calcule EXACTEMENT le
// même plan que l'écran Pilotage.

/** « Super net » réel d'une fiche de paie : net payé, sinon net avant impôt − impôt prélevé. */
export const payslipSuperNet = (e: PayslipExtractedData): number | undefined =>
  e.netPaid ?? (e.netAmount !== undefined && e.incomeTaxWithheld !== undefined
    ? e.netAmount - e.incomeTaxWithheld
    : undefined);

/**
 * Capacité d'épargne mensuelle théorique : super net − charges fixes − loisirs − projets.
 * Le super net vient de la fiche de paie de référence si elle en donne un, sinon de la
 * formule (même règle que le Pilotage).
 */
/** Paie mensuelle nette (« super net ») : fiche de paie de référence, sinon la formule. */
export const computeMonthlyPay = (data: GlobalAppData): number => {
  const c = data.config || ({} as GlobalAppData['config']);
  const formula = computeIncome(
    {
      grossAnnual: c.grossAnnual ?? 0,
      extraMonthlyIncome: c.extraMonthlyIncome ?? 0,
      navigoBase: c.navigoBase ?? 90.80,
      navigoRate: c.navigoRate ?? 67.24,
      taxRateManual: c.taxRateManual ?? 0,
    },
    data.fiscalConfig || DEFAULT_FISCAL_CONFIG,
    data.workBenefits || DEFAULT_WORK_BENEFITS
  ).superNet;
  const payslip = (data.payslips || []).find(p => p.id === data.activePayslipId);
  return (payslip && payslipSuperNet(payslip.extracted)) ?? formula;
};

export const computeMonthlySavingsCapacity = (data: GlobalAppData): number => {
  const c = data.config || ({} as GlobalAppData['config']);
  const superNet = computeMonthlyPay(data);
  const totalFixed = totalFixedCharges(data.expenses || [], data.subscriptions || []);
  return computeSavingsCapacity(superNet, totalFixed, c.leisureBudget ?? 0, c.projectSavings ?? 0);
};

const formatEUR2 = (n: number) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);

export interface PlacementStep {
  accountId?: string;     // absent pour la suggestion « Ouvrir un PEA/AV »
  accountName: string;
  type: AccountType;
  rate?: number;
  fillAmount: number;
  isFullAfter: boolean;
  isLiquid: boolean;
  alert?: boolean; // suggestion d'ouvrir un compte (pas de compte réel derrière)
  // Suggestion seulement : le montant n'est PAS retiré du plan (ex. LDDS conseillé alors
  // que le surplus part déjà sur l'Assurance Vie existante).
  infoOnly?: boolean;
  hint?: string;
}

/**
 * Répartit `totalToInvest` : livrets réglementés d'abord (meilleur taux, puis LEP > Livret A
 * > LDDS) jusqu'à leur plafond, le reste sur le premier autre placement (ou suggestion
 * d'ouvrir un PEA/AV).
 */
export type SavingsSplit = { accountId: string; pct: number }[];

/** Répartition personnalisée en vigueur à cette date, sinon `undefined` (plan automatique). */
export const activeSavingsSplit = (
  config: { savingsSplit?: SavingsSplit; savingsSplitFrom?: string } | undefined,
  asOfDate: Date = new Date()
): SavingsSplit | undefined => {
  const split = (config?.savingsSplit || []).filter(s => s.pct > 0);
  if (split.length === 0) return undefined;
  if (config?.savingsSplitFrom && config.savingsSplitFrom > formatISODay(asOfDate)) return undefined;
  return split;
};

/**
 * Répartition personnalisée : chaque compte reçoit sa part (pourcentages ramenés à 100 si
 * besoin). Un livret plein ne prend que la place qui lui reste ; l'excédent va sur un
 * compte de la répartition sans plafond, sinon il suit le plan automatique.
 */
const splitPlacement = (totalToInvest: number, accounts: SavingsAccount[], fiscalConfig: FiscalConfig, split: SavingsSplit): PlacementStep[] | null => {
  // Un même compte présent sur deux lignes : parts additionnées (sinon la seconde écrasait
  // la première et le plafond était vérifié deux fois sur le même solde).
  const merged = new Map<string, number>();
  for (const row of split) if (row.pct > 0 && accounts.some(a => a.id === row.accountId)) merged.set(row.accountId, (merged.get(row.accountId) || 0) + row.pct);
  const valid = [...merged.entries()].map(([accountId, pct]) => ({ accountId, pct }));
  const sum = valid.reduce((t, s) => t + s.pct, 0);
  if (sum <= 0) return null;
  const ceilings: Partial<Record<AccountType, number>> = {
    [AccountType.LEP]: fiscalConfig.ceilings.lep, [AccountType.LIVRET_A]: fiscalConfig.ceilings.livretA, [AccountType.LDDS]: fiscalConfig.ceilings.ldds,
  };
  const ceilingOf = (a: SavingsAccount) => (a.ceiling && a.ceiling > 0 ? a.ceiling : ceilings[a.type] || 0);
  const byId = new Map<string, PlacementStep>();
  let overflow = 0;
  const overflowFrom: string[] = [];
  for (const s of valid) {
    const a = accounts.find(x => x.id === s.accountId)!;
    const share = totalToInvest * s.pct / sum;
    const ceiling = ceilingOf(a);
    const room = ceiling > 0 ? Math.max(0, ceiling - a.totalAmount) : Infinity;
    const take = Math.min(share, room);
    if (share - take > 0.005) { overflow += share - take; overflowFrom.push(a.name); }
    if (take > 0.005) byId.set(a.id, { accountId: a.id, accountName: a.name, type: a.type, rate: a.interestRate, fillAmount: take, isFullAfter: take >= room, isLiquid: ceiling > 0 });
  }
  const steps = () => [...byId.values()];
  if (overflow > 0.005) {
    const target = valid.map(s => accounts.find(x => x.id === s.accountId)!).find(a => ceilingOf(a) === 0);
    if (target) {
      const cur = byId.get(target.id);
      byId.set(target.id, cur ? { ...cur, fillAmount: cur.fillAmount + overflow } : { accountId: target.id, accountName: target.name, type: target.type, rate: target.interestRate, fillAmount: overflow, isFullAfter: false, isLiquid: false });
    } else {
      const after = accounts.map(a => { const st = byId.get(a.id); return st ? { ...a, totalAmount: a.totalAmount + st.fillAmount } : a; });
      for (const st of computePlacementStrategy(overflow, after, fiscalConfig)) {
        const cur = st.accountId ? byId.get(st.accountId) : undefined;
        if (cur) byId.set(cur.accountId!, { ...cur, fillAmount: cur.fillAmount + st.fillAmount });
        else byId.set(st.accountId || st.accountName, st);
      }
    }
    const info: PlacementStep = {
      accountName: 'Répartition', type: AccountType.AUTRE, fillAmount: overflow, isFullAfter: false, isLiquid: false, alert: true, infoOnly: true,
      hint: `${overflowFrom.join(', ')} ${overflowFrom.length > 1 ? 'sont pleins' : 'est plein'} : ${formatEUR2(overflow)} de votre répartition vont ${target ? `sur ${target.name}` : 'sur les autres comptes'}.`,
    };
    return [...steps(), info];
  }
  return steps();
};

export const computePlacementStrategy = (
  totalToInvest: number,
  accounts: SavingsAccount[],
  fiscalConfig: FiscalConfig,
  split?: SavingsSplit
): PlacementStep[] => {
  if (split && split.length > 0) {
    const custom = splitPlacement(totalToInvest, accounts, fiscalConfig, split);
    if (custom) return custom;
  }
  let remainingMoney = totalToInvest;
  const steps: PlacementStep[] = [];
  const liquidTypes = [AccountType.LEP, AccountType.LIVRET_A, AccountType.LDDS];
  const userLiquidAccounts = accounts.filter(a => liquidTypes.includes(a.type));
  const userOtherAccounts = accounts.filter(a => !liquidTypes.includes(a.type) && ![AccountType.COMPTE_COURANT, AccountType.IMMOBILIER].includes(a.type));

  const priority: Partial<Record<AccountType, number>> = { [AccountType.LEP]: 3, [AccountType.LIVRET_A]: 2, [AccountType.LDDS]: 1 };
  const sortAccounts = (a: SavingsAccount, b: SavingsAccount) => {
    const rateA = a.interestRate || 0;
    const rateB = b.interestRate || 0;
    if (rateA !== rateB) return rateB - rateA;
    return (priority[b.type] || 0) - (priority[a.type] || 0);
  };
  userLiquidAccounts.sort(sortAccounts);
  userOtherAccounts.sort(sortAccounts);

  // Plafond du compte s'il est renseigné, sinon celui de la config (même règle que
  // le remplissage des livrets et les alertes du Dashboard).
  const defaults: Partial<Record<AccountType, number>> = {
    [AccountType.LEP]: fiscalConfig.ceilings.lep,
    [AccountType.LIVRET_A]: fiscalConfig.ceilings.livretA,
    [AccountType.LDDS]: fiscalConfig.ceilings.ldds,
  };
  for (const acc of userLiquidAccounts) {
    if (remainingMoney <= 0) break;
    const ceiling = (acc.ceiling && acc.ceiling > 0) ? acc.ceiling : (defaults[acc.type] || 0);
    const availableSpace = Math.max(0, ceiling - acc.totalAmount);
    if (availableSpace > 0) {
      const amountAllocated = Math.min(remainingMoney, availableSpace);
      steps.push({ accountId: acc.id, accountName: acc.name, type: acc.type, rate: acc.interestRate, fillAmount: amountAllocated, isFullAfter: amountAllocated >= availableSpace, isLiquid: true });
      remainingMoney -= amountAllocated;
    }
  }

  // Livrets existants pleins et pas de LDDS : en ouvrir un garderait le surplus disponible
  // à tout moment, sans impôt (12 000 €, même taux que le Livret A).
  if (remainingMoney > 0 && !accounts.some(a => a.type === AccountType.LDDS)) {
    const livretA = accounts.find(a => a.type === AccountType.LIVRET_A);
    const fill = Math.min(remainingMoney, fiscalConfig.ceilings.ldds);
    steps.push({
      accountName: 'Ouvrir un LDDS', type: AccountType.LDDS, rate: livretA?.interestRate, fillAmount: fill,
      isFullAfter: false, isLiquid: true, alert: true, infoOnly: userOtherAccounts.length > 0,
      hint: userOtherAccounts.length > 0
        ? `Vos livrets sont pleins : un LDDS (même taux que le Livret A, disponible à tout moment, sans impôt) accueillerait ${formatEUR2(fill)} sans les bloquer. En attendant, ce surplus va sur ${userOtherAccounts[0].name}.`
        : `Vos livrets sont pleins : ouvrez un LDDS (même taux que le Livret A, disponible à tout moment, sans impôt) pour y placer ${formatEUR2(fill)}.`,
    });
    if (userOtherAccounts.length === 0) remainingMoney -= fill;
  }

  if (remainingMoney > 0) {
    if (userOtherAccounts.length > 0) {
      const o = userOtherAccounts[0];
      steps.push({ accountId: o.id, accountName: o.name, type: o.type, rate: o.interestRate, fillAmount: remainingMoney, isFullAfter: false, isLiquid: false });
    } else {
      steps.push({ accountName: 'Ouvrir un PEA/AV', type: AccountType.AUTRE, rate: 0, fillAmount: remainingMoney, isFullAfter: false, isLiquid: false, alert: true,
        hint: `${formatEUR2(remainingMoney)} de plus que vos livrets ne peuvent accueillir : ouvrez un PEA ou une Assurance Vie.` });
    }
  }
  return steps;
};
