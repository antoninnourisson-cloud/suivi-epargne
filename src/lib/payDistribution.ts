// ================================================
// FILE: src/lib/payDistribution.ts
// « J'ai reçu ma paie, je fais quoi ? » : UNE règle (allocatePay) pour tout l'argent reçu,
// partagée par le Pilotage (plan habituel, carte « Ma paie »), le rituel, la jauge de
// l'Accueil (lib/payAdjustment) et le serveur.
//  - Ordre d'importance : virements fixes (charges, commun, abonnements), jamais réduits ;
//    épargne ; épargne projets ; le plaisir (ce qui reste sur le compte courant) prend le reste.
//  - Le compte courant démarre le mois au « solde de départ du mois » (config.leisureBudget,
//    même clé que l'ancien budget plaisir) : ce qui reste du mois dernier est compté, tout ce
//    qui dépasse va à l'épargne.
//  - Argent qui manque : le plaisir baisse d'abord, jamais sous les 2/3 du solde de départ
//    (règle fixe, pas un réglage), puis l'épargne projets, puis l'épargne. La prime est
//    placée en entier : elle n'est entamée que si la paie de base ne couvre même pas les
//    virements fixes (l'argent n'existe pas autrement).
//  - Versement en plus (prime à part, deuxième employeur) : rien à virer, tout à l'épargne ;
//    le reste du compte courant n'est pas recompté (déjà réparti avec la paie du mois).
// Calcul en centimes entiers : la somme des parts vaut exactement l'argent à répartir.
// Fonction pure, partagée par l'app et le serveur.
// ================================================
import { AccountType, type GlobalAppData, type PayBalance, type PayBalanceSource, type PayChecklistLine, type PayRecord, type SavingsAccount } from '../types';
import { CURRENT_ACCOUNT_FRESH_DAYS, lastBalanceCheck } from './freshness';
import {
  activeSavingsSplit, buildPayLines, computeMonthlyPay, computePayTransfers, computePlacementStrategy,
  PayTransfer, PlacementStep,
} from './finance';
import { DEFAULT_FISCAL_CONFIG } from '../constants';
import { MS_PER_DAY, formatISODay, parseISODate } from './dates';
import { formatEUR } from './format';
import { round2 } from './money';

/** Écart (en euros) en dessous duquel un montant ne mérite pas d'être signalé. */
const TOLERANCE = 0.5;

const finite = (v: number | undefined): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const toCents = (v: number | undefined): number => Math.round(Number(((finite(v) ?? 0) * 100).toPrecision(15)));
const fromCents = (c: number): number => (c === 0 ? 0 : c / 100);

/**
 * Plancher du plaisir : les 2/3 du solde de départ du mois, arrondis à l'euro (400 € → 267 €),
 * jamais plus que le solde de départ lui-même. Règle fixe, dite dans « Comment c'est calculé ».
 */
export const leisureFloorOf = (startBalance: number): number => {
  const y = Math.max(0, finite(startBalance) ?? 0);
  return Math.min(y, Math.round((y * 2) / 3));
};

export interface AllocatePayInput {
  /** Paie reçue sur le compte courant, prime comprise. */
  received: number;
  /** Dont prime ou exceptionnel (ramenée entre 0 et la paie). */
  bonus?: number;
  /** Ce qui reste sur le compte courant avant la paie (négatif : découvert). Absent : 0. */
  before?: number;
  /** Paie habituelle (fiche de référence, sinon formule). */
  expectedPay: number;
  /** Virements fixes : charges saisies (commun compris) et abonnements mensuels. */
  fixed: number;
  /** Épargne projets prévue. */
  projects: number;
  /** Solde de départ du mois (config.leisureBudget). */
  startBalance: number;
  /** Épargne visée fixée (montant fixe du Pilotage, ou « À placer » d'une ancienne paie). */
  fixedSavings?: number;
  kind?: 'extra';
}

export interface PayAllocation {
  kind: 'pay' | 'extra';
  received: number;
  bonus: number;
  /** Reste du compte courant compté (0 pour un versement en plus). */
  before: number;
  /** Argent à répartir : paie reçue + reste du compte courant. */
  available: number;
  expectedPay: number;
  /** Paie reçue hors prime − paie habituelle (0 pour un versement en plus). */
  gap: number;
  startBalance: number;
  /** Plancher du plaisir (leisureFloorOf). */
  floor: number;
  /** Épargne que donne le calcul : paie habituelle − virements fixes − projets − solde de départ (peut être négative). */
  computedTarget: number;
  /** Épargne visée hors prime : le montant fixe s'il y en a un, sinon le calcul (jamais négative). */
  target: number;
  /** Montant fixe retenu, s'il remplace le calcul. */
  fixedSavings?: number;
  /** Plaisir prévu : le solde de départ, ou plus si un montant fixe laisse davantage sur la paie habituelle. */
  plannedLeisure: number;
  fixed: number;
  plannedProjects: number;
  /** Épargne projets versée. */
  projects: number;
  /** Épargne totale, prime comprise. */
  savings: number;
  /** Part de la prime placée (égale à la prime, sauf si la paie ne couvre pas les virements fixes). */
  bonusPlaced: number;
  /** Ce qui reste sur le compte courant pour le mois (négatif : il manque pour les virements fixes). */
  leisure: number;
  /** Ce qui s'ajoute à l'épargne visée et à la prime (reste du mois dernier, paie plus haute). */
  surplus: number;
  /** Ce qui a été retiré à chaque poste par rapport au prévu. */
  cuts: { leisure: number; projects: number; savings: number; bonus: number };
  /** > 0 : la paie et le reste du compte ne couvrent pas les virements fixes. */
  missingFixed: number;
  /** > 0 : même tout coupé, le plaisir reste sous son plancher d'autant. */
  belowFloor: number;
}

/**
 * La règle unique (fonction pure, en centimes). Invariant :
 * fixed + projects + savings + leisure = received + before, au centime près.
 */
export const allocatePay = (input: AllocatePayInput): PayAllocation => {
  const P = Math.max(0, toCents(input.received));
  if (input.kind === 'extra') {
    // Versement en plus : rien à virer, tout placé (ou le montant choisi, jamais plus que reçu).
    const forced = finite(input.fixedSavings);
    const S = forced === undefined ? P : Math.min(P, Math.max(0, toCents(forced)));
    const v = fromCents;
    return {
      kind: 'extra', received: v(P), bonus: 0, before: 0, available: v(P), expectedPay: 0, gap: 0,
      startBalance: 0, floor: 0, computedTarget: 0, target: v(S), ...(forced !== undefined ? { fixedSavings: v(S) } : {}),
      plannedLeisure: 0, fixed: 0, plannedProjects: 0, projects: 0, savings: v(S), bonusPlaced: 0, leisure: v(P - S),
      surplus: 0, cuts: { leisure: 0, projects: 0, savings: 0, bonus: 0 }, missingFixed: 0, belowFloor: 0,
    };
  }
  const B = Math.min(P, Math.max(0, toCents(input.bonus)));
  const x = toCents(input.before);
  const E = Math.max(0, toCents(input.expectedPay));
  const F = Math.max(0, toCents(input.fixed));
  const Pr = Math.max(0, toCents(input.projects));
  const y = Math.max(0, toCents(input.startBalance));
  const m = toCents(leisureFloorOf(y / 100));
  const computed = E - F - Pr - y;
  const forced = finite(input.fixedSavings);
  const S0 = forced === undefined ? Math.max(0, computed) : Math.max(0, toCents(forced));
  // Un montant fixe plus bas que le calcul laisse plus sur la paie habituelle : c'est le plaisir prévu.
  const T = Math.max(y, E - F - Pr - S0);
  const A = P + x;

  let projects = Pr;
  let base = S0;   // épargne hors prime
  let bonus = B;   // prime placée
  let L: number;
  let surplus = 0;
  let missingFixed = 0;
  if (A < F) {
    // Les virements fixes passent quand même : il manque la différence.
    projects = 0; base = 0; bonus = 0;
    L = A - F;
    missingFixed = F - A;
  } else {
    L = A - F - Pr - S0 - B;
    if (L >= T) {
      surplus = L - T;
      base += surplus;
      L = T;
    } else if (L < m) {
      // Le plaisir est descendu à son plancher : on coupe les projets, puis l'épargne hors prime.
      const cP = Math.min(projects, m - L); projects -= cP; L += cP;
      const cS = Math.min(base, m - L); base -= cS; L += cS;
      // La prime n'est entamée que pour ne pas laisser le compte à découvert.
      if (L < 0) { const cB = Math.min(bonus, -L); bonus -= cB; L += cB; }
    }
  }
  const S = base + bonus;
  const v = fromCents;
  return {
    kind: 'pay', received: v(P), bonus: v(B), before: v(x), available: v(A), expectedPay: v(E), gap: v(P - B - E),
    startBalance: v(y), floor: v(m), computedTarget: v(computed), target: v(S0),
    ...(forced !== undefined ? { fixedSavings: v(S0) } : {}),
    plannedLeisure: v(T), fixed: v(F), plannedProjects: v(Pr), projects: v(projects), savings: v(S), bonusPlaced: v(bonus),
    leisure: v(L), surplus: v(surplus),
    cuts: {
      leisure: v(Math.max(0, T - Math.max(0, L))),
      projects: v(Pr - projects),
      savings: v(Math.max(0, S0 - (base - surplus))),
      bonus: v(B - bonus),
    },
    missingFixed: v(missingFixed),
    belowFloor: v(missingFixed > 0 ? 0 : Math.max(0, m - L)),
  };
};

// ---------------------------------------------------------------------------
// Répartition d'une paie, avec ses virements et ses comptes
// ---------------------------------------------------------------------------

export interface PayDistributionInput {
  /** Net reçu, prime comprise. */
  amount: number;
  /** Dont prime ou exceptionnel (placé en entier). */
  bonus?: number;
  /** « À placer sur cette paie » d'une ancienne paie : épargne visée hors prime, remplace le calcul. */
  toSave?: number;
  kind?: 'extra';
  /** Ce qui reste sur le compte courant avant la paie (payBalanceBefore). Absent : 0. */
  before?: number;
  /** Date de réception ('YYYY-MM-DD') : date d'effet de la répartition personnalisée. */
  receivedOn?: string;
}

export interface PayDistribution {
  /** Paie habituelle (fiche de paie de référence, sinon formule) : la base du Pilotage. */
  expectedPay: number;
  /** Prévu avant l'épargne : virements fixes, épargne projets et solde de départ du mois. */
  plannedSpending: number;
  /** Reçu hors prime − paie habituelle (0 pour un versement en plus). */
  gap: number;
  /** Épargne hors prime. */
  capacity: number;
  /** Prime déclarée (ramenée à la paie). */
  bonus: number;
  /** Épargne de cette paie, prime comprise. */
  toSave: number;
  /** > 0 : la paie et le reste du compte ne couvrent pas les virements fixes. */
  shortfall: number;
  /** Virements fixes, épargne projets, puis ce qui reste sur le compte courant (plaisir). */
  transfers: PayTransfer[];
  steps: PlacementStep[];
  /** Lignes : virements fixes, épargne par compte, épargne projets, plaisir. */
  lines: PayChecklistLine[];
  /** Répartition personnalisée active (change le « pourquoi » de chaque compte, placementReason). */
  customSplit: boolean;
  /** Le détail de la règle (barre, phrases, « Comment c'est calculé »). */
  allocation: PayAllocation;
}

/** Ce qui restait sur le compte courant avant une paie déclarée (0 si inconnu ou ancienne paie). */
export const payBalanceBefore = (pay: Pick<PayRecord, 'balance' | 'kind'> | undefined): number => {
  const b = pay?.balance;
  if (!b || pay?.kind === 'extra' || b.source === 'unknown') return 0;
  return finite(b.before) ?? 0;
};

/**
 * Le montant reçu change (fiche de paie, « Modifier la paie ») : si le solde lu comprenait la
 * paie, ce qui restait avant la paie suit (solde lu − nouveau montant) ; sinon rien ne bouge.
 */
export const balanceForAmount = (b: PayBalance | undefined, oldAmount: number, newAmount: number): PayBalance | undefined => {
  if (!b || b.source === 'unknown' || b.seen === undefined) return b;
  const included = Math.abs(b.seen - b.before - oldAmount) < 0.005 && Math.abs(b.seen - b.before) >= 0.005;
  return included ? { ...b, before: round2(b.seen - newAmount) } : b;
};

/** Le solde lu comprend-il la paie (case « Ma paie apparaît déjà dans ce solde ») ? */
export const balanceIncludesPay = (b: Pick<PayBalance, 'seen' | 'before'>): boolean =>
  b.seen === undefined || Math.abs(b.seen - b.before) >= 0.005;

/** Compte courant où arrive la paie : celui choisi (config.payAccountId), sinon le premier compte courant. */
export const payAccountOf = (data: Pick<GlobalAppData, 'accounts' | 'config'>): SavingsAccount | undefined => {
  const current = (data.accounts || []).filter(a => a.type === AccountType.COMPTE_COURANT);
  return current.find(a => a.id === data.config?.payAccountId) ?? current[0];
};

export interface CurrentAccountPrefill {
  account?: SavingsAccount;
  /** Solde proposé, paie comprise ; absent : rien à proposer (trop ancien, inconnu, pas de compte). */
  seen?: number;
  source?: Exclude<PayBalanceSource, 'typed' | 'unknown'>;
  /** Dernier solde constaté ('YYYY-MM-DD') et son âge en jours. */
  checkedOn?: string;
  days?: number;
  /** Solde constaté (sans la paie). */
  known?: number;
}

/**
 * Ce que le rituel propose pour « Solde maintenant, paie comprise » :
 *  - solde constaté APRÈS le jour de la paie : tel quel (il comprend la paie) ;
 *  - constaté avant (ou le jour même : il peut dater d'avant son arrivée), il y a
 *    CURRENT_ACCOUNT_FRESH_DAYS jours au plus : estimation, solde connu + paie ;
 *  - plus ancien, jamais constaté, ou aucun compte courant : rien.
 */
export const currentAccountPrefill = (
  data: Pick<GlobalAppData, 'accounts' | 'config'>,
  input: { receivedOn: string; amount: number; today: string },
): CurrentAccountPrefill => {
  const account = payAccountOf(data);
  if (!account) return {};
  const checkedOn = lastBalanceCheck(account, input.today);
  if (!checkedOn) return { account };
  const days = Math.round((parseISODate(input.today).getTime() - parseISODate(checkedOn).getTime()) / MS_PER_DAY);
  const known = round2(account.totalAmount);
  const base = { account, checkedOn, days, known };
  if (checkedOn > input.receivedOn) return { ...base, seen: known, source: 'known' };
  if (days > CURRENT_ACCOUNT_FRESH_DAYS) return base;
  return { ...base, seen: round2(known + (finite(input.amount) ?? 0)), source: 'estimated' };
};

/** Virements fixes de la paie (charges saisies puis abonnements), dans l'ordre des virements. */
const fixedTransfersOf = (data: GlobalAppData): PayTransfer[] => computePayTransfers({
  expenses: data.expenses || [], subscriptions: data.subscriptions || [], leisureBudget: 0, projectSavings: 0,
});

export const recommendPayDistribution = (data: GlobalAppData, input: PayDistributionInput): PayDistribution => {
  const c = data.config || ({} as GlobalAppData['config']);
  const asOf = input.receivedOn ? parseISODate(input.receivedOn) : new Date();
  const split = activeSavingsSplit(c, asOf);
  // Paie habituelle jamais négative (salaire encore vide).
  const estimated = computeMonthlyPay(data);
  const expectedPay = Number.isFinite(estimated) ? round2(Math.max(0, estimated)) : 0;
  const extra = input.kind === 'extra';
  const fixedTransfers = extra ? [] : fixedTransfersOf(data);
  const fixed = round2(fixedTransfers.reduce((s, t) => s + t.amount, 0));
  const allocation = allocatePay({
    received: input.amount, bonus: input.bonus, before: input.before, expectedPay,
    fixed, projects: c.projectSavings ?? 0, startBalance: c.leisureBudget ?? 0,
    fixedSavings: finite(input.toSave) ?? (extra ? undefined : finite(c.paydayAmount)),
    kind: input.kind,
  });
  const transfers = extra ? [] : computePayTransfers({
    expenses: data.expenses || [], subscriptions: data.subscriptions || [],
    leisureBudget: Math.max(0, allocation.leisure), projectSavings: allocation.projects,
  });
  const steps = computePlacementStrategy(allocation.savings, data.accounts || [], data.fiscalConfig || DEFAULT_FISCAL_CONFIG, split);
  return {
    expectedPay,
    plannedSpending: extra ? 0 : round2(fixed + allocation.plannedProjects + allocation.startBalance),
    gap: allocation.gap,
    capacity: round2(allocation.savings - allocation.bonusPlaced),
    bonus: allocation.bonus,
    toSave: allocation.savings,
    shortfall: allocation.missingFixed,
    transfers, steps,
    lines: buildPayLines(transfers, steps),
    customSplit: !!split,
    allocation,
  };
};

/** Plan de la paie habituelle, sans reste du mois dernier : l'estimation avant la paie. */
export const usualPayDistribution = (data: GlobalAppData, asOf: Date = new Date()): PayDistribution =>
  recommendPayDistribution(data, {
    amount: Math.max(0, finite(computeMonthlyPay(data)) ?? 0),
    receivedOn: formatISODay(asOf),
  });

// ---------------------------------------------------------------------------
// Phrases
// ---------------------------------------------------------------------------

const eur = (n: number) => formatEUR(n);
const joinFr = (parts: string[]): string =>
  parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} et ${parts[parts.length - 1]}`;
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * La phrase qui dit ce qui change par rapport au plan habituel, calculée sur le RÉSULTAT
 * (jamais à partir du seul reste du mois dernier) : coupes dans l'ordre, ou ce qui s'ajoute
 * à l'épargne. Rien pour un mois sans écart ni pour un versement en plus.
 */
export const allocationSentence = (a: PayAllocation): string | undefined => {
  if (a.kind === 'extra') return undefined;
  if (a.missingFixed > 0) {
    return `La paie ne couvre pas les virements fixes (il manque ${eur(a.missingFixed)}) : épargne, épargne projets et plaisir sont à zéro ce mois-ci.`;
  }
  const lower = a.gap <= -TOLERANCE;
  const leftover = a.before >= TOLERANCE;
  const overdraft = a.before <= -TOLERANCE;
  const cut = a.cuts.leisure >= TOLERANCE || a.cuts.projects > 0 || a.cuts.savings > 0 || a.cuts.bonus > 0;
  if (cut) {
    const why: string[] = [];
    if (lower) why.push(`Paie inférieure de ${eur(-a.gap)} à l'habitude${leftover ? `, en partie compensée par les ${eur(a.before)} restants` : ''}`);
    if (overdraft) why.push(`${lower ? 'compte' : 'Compte'} à découvert de ${eur(-a.before)} avant la paie`);
    if (why.length === 0) why.push(a.fixedSavings !== undefined && a.fixedSavings >= a.computedTarget + TOLERANCE ? 'Votre montant fixe d\'épargne dépasse le calcul' : 'Vos dépenses prévues dépassent la paie');
    const effects: string[] = [];
    const L = Math.max(0, a.leisure);
    if (a.belowFloor > 0) effects.push(`le plaisir descend à ${eur(L)}, sous son minimum de ${eur(a.floor)}`);
    else if (Math.abs(L - a.floor) < TOLERANCE && a.floor < a.plannedLeisure) effects.push(`le plaisir descend à son minimum (${eur(a.floor)})`);
    else if (a.cuts.leisure >= TOLERANCE) effects.push(`le plaisir passe à ${eur(L)} au lieu de ${eur(a.plannedLeisure)} (minimum ${eur(a.floor)})`);
    if (a.cuts.projects > 0) effects.push(a.projects === 0 ? 'l\'épargne projets est suspendue ce mois-ci' : `l'épargne projets baisse de ${eur(a.cuts.projects)}`);
    if (a.cuts.savings > 0) effects.push(`l'épargne baisse de ${eur(a.cuts.savings)}`);
    if (a.cuts.bonus > 0) effects.push(`la prime n'est placée qu'en partie (${eur(a.bonusPlaced)} sur ${eur(a.bonus)})`);
    const kept = a.cuts.projects > 0 || a.cuts.savings > 0
      ? ' Les virements fixes sont tenus.'
      : a.plannedProjects > 0 ? ' Épargne et projets tenus.' : ' Épargne tenue.';
    return `${why.join(' et ')} : ${joinFr(effects)}.${kept}`;
  }
  if (a.surplus >= TOLERANCE) {
    const why: string[] = [];
    if (leftover) why.push(`il restait ${eur(a.before)} du mois dernier`);
    if (a.gap >= TOLERANCE) why.push(`paie supérieure de ${eur(a.gap)} à l'habitude`);
    if (lower) why.push(`paie inférieure de ${eur(-a.gap)}`);
    if (overdraft) why.push(`découvert de ${eur(-a.before)} avant la paie`);
    if (a.fixedSavings !== undefined && a.plannedLeisure > a.startBalance && why.length === 0) why.push('montant fixe plus bas que le calcul');
    return `Le compte courant démarre à ${eur(a.plannedLeisure)} : ${eur(a.surplus)} de plus vont à l'épargne${why.length ? ` (${why.join(', ')})` : ''}.`;
  }
  if (leftover || overdraft || Math.abs(a.gap) >= TOLERANCE) {
    // Écarts qui se compensent : rien ne bouge.
    return capitalize(`le compte courant démarre à ${eur(Math.max(0, a.leisure))} : épargne et projets tenus.`);
  }
  return undefined;
};
