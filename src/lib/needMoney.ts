// « J'ai besoin d'argent : où le prendre ? » (phase 8, rituel 2), en fonctions pures testées :
// - les comptes où puiser, le moins cher d'abord (needSources, planNeed) : livrets du plus
//   petit taux au plus grand, le LEP en dernier ; ensuite seulement l'assurance vie, puis le
//   PEA de plus de 5 ans. Jamais PER, PEE, PEL, compte à terme, immobilier (ni compte-titres,
//   crypto ou « Autre »), jamais un PEA qu'un retrait fermerait. Votre part seulement : la part
//   des parents n'est jamais touchée (ownedAmount, comme canWithdrawOwn) ;
// - ce que coûte chaque ligne (withdrawalCost) : intérêts perdus d'ici la fin de l'année (même
//   calcul que le reste de l'app, computeAccruedInterest, quinzaines comprises) et impôt d'un
//   retrait d'assurance vie ou de PEA (computeWithdrawalTax) ;
// - le meilleur jour pour un livret (bestWithdrawalDay, avec quinzaineWithdrawalTip), jamais
//   après le jour du besoin ;
// - la phrase de précaution (precautionAfter), avec le calcul de la jauge de l'Accueil.
// Les retraits prévus (config.plannedWithdrawals) sont dans lib/plannedWithdrawals.
import { AccountType, type AccountMovement, type FiscalConfig, type PlannedWithdrawalLine, type SavingsAccount } from '../types';
import { computeAccruedInterest, computeWithdrawalTax, quinzaineWithdrawalTip } from './finance';
import { emergencySavingsOf } from './planning';
import { formatISODay, parseISODate } from './dates';
import { EPS, round2 } from './money';

/** Livrets où l'on puise d'abord (retraits libres, sans impôt au retrait). */
const LIVRET_TYPES: readonly AccountType[] = [AccountType.LIVRET_BANCAIRE, AccountType.LIVRET_A, AccountType.LDDS, AccountType.CEL, AccountType.LEP];

/** Rang d'un compte : 0 livret, 1 LEP (dernier des livrets), 2 assurance vie, 3 PEA ; null : jamais proposé. */
export const needRank = (account: SavingsAccount, fiscal: FiscalConfig, asOf: Date): 0 | 1 | 2 | 3 | null => {
  if (!(account.ownedAmount > EPS)) return null;
  if (account.type === AccountType.LEP) return 1;
  if (LIVRET_TYPES.includes(account.type)) return 0;
  if (account.type === AccountType.ASSURANCE_VIE) return 2;
  // PEA de moins de 5 ans (ou sans date d'ouverture) : un retrait le fermerait.
  if (account.type === AccountType.PEA) return computeWithdrawalTax(account, 1, fiscal, asOf).closesPea ? null : 3;
  return null;
};

export interface WithdrawalCost {
  /** Intérêts que cet argent aurait encore rapportés d'ici le 31 décembre. */
  lostInterest: number;
  /** Impôt et prélèvements sociaux du retrait (assurance vie, PEA) ; 0 pour un livret. */
  tax: number;
  /** false : impôt inconnu (versements cumulés non renseignés). */
  taxKnown: boolean;
  total: number;
}

/** Ce que coûte un retrait de `amount` sur ce compte, fait le jour `dateISO`. */
export const withdrawalCost = (account: SavingsAccount, amount: number, fiscal: FiscalConfig, dateISO: string): WithdrawalCost => {
  const at = parseISODate(dateISO);
  const year = at.getFullYear();
  const yearEnd = new Date(year + 1, 0, 1);
  const out: AccountMovement = { id: 'besoin-prevu', date: dateISO, amount, label: 'Retrait', type: 'OUT' };
  const kept = computeAccruedInterest(account, year, yearEnd);
  const after = computeAccruedInterest({ ...account, totalAmount: account.totalAmount - amount, movements: [...account.movements, out] }, year, yearEnd);
  const lostInterest = Math.max(0, kept - after);
  let tax = 0;
  let taxKnown = true;
  if (account.type === AccountType.ASSURANCE_VIE || account.type === AccountType.PEA) {
    const w = computeWithdrawalTax(account, amount, fiscal, at);
    taxKnown = w.known;
    tax = w.known ? w.incomeTax + w.socialCharges : 0;
  }
  return { lostInterest, tax, taxKnown, total: lostInterest + tax };
};

/** Comptes où puiser, dans l'ordre proposé (le moins cher d'abord). */
export const needSources = (accounts: SavingsAccount[], fiscal: FiscalConfig, asOf: Date): SavingsAccount[] =>
  accounts.filter(a => needRank(a, fiscal, asOf) !== null);

export interface NeedPlan {
  lines: PlannedWithdrawalLine[];
  /** Ce que votre épargne disponible ne couvre pas (0 si tout est couvert). */
  missing: number;
}

/**
 * Lignes proposées pour un besoin de `amount` le jour `needISO` : à chaque pas, le compte le
 * moins cher (rang, puis taux pour un livret, coût par euro pour un placement) ; à coût égal,
 * celui qui couvre tout le reste, sinon le plus garni (un seul compte plutôt que plusieurs).
 */
export const planNeed = (accounts: SavingsAccount[], fiscal: FiscalConfig, amount: number, todayISO: string, needISO: string): NeedPlan => {
  const asOf = parseISODate(todayISO);
  const day = needISO > todayISO ? needISO : todayISO;
  let left = round2(Math.max(0, amount));
  const pool = needSources(accounts, fiscal, asOf);
  const lines: PlannedWithdrawalLine[] = [];
  while (left > EPS && pool.length > 0) {
    const scored = pool.map(a => {
      const rank = needRank(a, fiscal, asOf)!;
      const take = Math.min(left, a.ownedAmount);
      const key = rank <= 1 ? (a.interestRate ?? 0) : withdrawalCost(a, take, fiscal, day).total / take;
      return { a, rank, key, covers: a.ownedAmount + EPS >= left };
    });
    scored.sort((x, y) => x.rank - y.rank || x.key - y.key || Number(y.covers) - Number(x.covers) || y.a.ownedAmount - x.a.ownedAmount);
    // Même rang et même coût : un compte qui couvre tout passe devant.
    const first = scored[0];
    const tie = scored.filter(s => s.rank === first.rank && Math.abs(s.key - first.key) < 1e-9);
    const pick = tie.find(s => s.covers) ?? first;
    const take = round2(Math.min(left, pick.a.ownedAmount));
    lines.push({ accountId: pick.a.id, amount: take });
    left = round2(left - take);
    pool.splice(pool.indexOf(pick.a), 1);
  }
  return { lines, missing: Math.max(0, left) };
};

const isQuinzaineStart = (iso: string) => { const d = parseISODate(iso).getDate(); return d === 1 || d === 16; };
const nextDay = (iso: string) => { const d = parseISODate(iso); return formatISODay(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)); };

/**
 * Jour conseillé pour retirer : pour un livret réglementé, le dernier 1er ou 16 qui ne tombe
 * pas après le besoin (retiré ce jour-là, l'argent garde les intérêts de la quinzaine
 * précédente), trouvé de proche en proche avec quinzaineWithdrawalTip ; sinon, et pour les
 * autres comptes, le jour du besoin. Aujourd'hui (ou passé) : aujourd'hui.
 */
export const bestWithdrawalDay = (account: Pick<SavingsAccount, 'type' | 'interestRate'>, amount: number, todayISO: string, needISO: string): string => {
  if (needISO <= todayISO) return todayISO;
  let day: string | null = null;
  let probe = todayISO;
  for (;;) {
    const tip = quinzaineWithdrawalTip(account, amount, parseISODate(isQuinzaineStart(probe) ? nextDay(probe) : probe));
    if (!tip || tip.waitUntil > needISO) break;
    day = tip.waitUntil;
    probe = tip.waitUntil;
  }
  return day ?? needISO;
};

/** Jour d'un retrait prévu : le plus tôt des jours conseillés de ses lignes (jamais après le besoin). */
export const plannedDay = (lines: PlannedWithdrawalLine[], accounts: SavingsAccount[], todayISO: string, needISO: string): string =>
  lines.reduce((min, l) => {
    const a = accounts.find(x => x.id === l.accountId);
    const d = a ? bestWithdrawalDay(a, l.amount, todayISO, needISO) : needISO;
    return d < min ? d : min;
  }, needISO > todayISO ? needISO : todayISO);

/**
 * Épargne de précaution après le retrait (même calcul que la jauge de l'Accueil,
 * emergencySavingsOf) : renvoyée seulement si le retrait la fait baisser sous son objectif.
 * L'argent retiré sert au besoin : il n'est pas compté sur le compte courant.
 */
export const precautionAfter = (
  accounts: SavingsAccount[],
  lines: PlannedWithdrawalLine[],
  emergency: { target: number; cashBuffer?: number } | null | undefined,
): { after: number; target: number } | null => {
  if (!emergency || !(emergency.target > 0)) return null;
  const buffer = emergency.cashBuffer ?? 0;
  const before = emergencySavingsOf(accounts, buffer);
  const taken = (id: string) => lines.filter(l => l.accountId === id).reduce((s, l) => s + l.amount, 0);
  const after = emergencySavingsOf(accounts.map(a => ({ ...a, ownedAmount: a.ownedAmount - taken(a.id) })), buffer);
  return after < emergency.target - EPS && after < before - EPS ? { after, target: emergency.target } : null;
};


/**
 * Ce qu'on peut dépenser sans toucher à l'épargne de précaution : ce qui dépasse son objectif
 * (même jauge que l'Accueil et que precautionAfter : un retrait plus petit que cet excédent ne
 * fait jamais passer la précaution sous son objectif). 0 si l'objectif n'est pas atteint ;
 * `null` quand la jauge est absente (aucune dépense connue : pas d'objectif, donc rien à comparer).
 */
export const spendableBeyondPrecaution = (emergency: { target: number; current: number } | null | undefined): number | null =>
  (emergency && emergency.target > 0 ? Math.max(0, round2(emergency.current - emergency.target)) : null);
