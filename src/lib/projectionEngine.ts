// ================================================
// FILE: src/lib/projectionEngine.ts
// Moteur unique des projections « selon votre plan », mois par mois. La projection du
// Rendement (projectSavings), le plan solo (buildSoloPlan) et le simulateur « Et si… »
// (simulate) font avancer leurs comptes avec ces mêmes fonctions : à données égales, ils
// donnent le même solde au même mois. La projection de l'Accueil répond à une autre
// question (ce qui a été placé ces 90 derniers jours, lib/home) et le dit à l'écran.
//
// Un mois (étape m, m = 1 pour le mois qui commence) :
// 1. intérêts nets du mois sur le solde réel (part des parents comprise : leurs intérêts
//    vous sont offerts), crédités tout de suite, sauf Livret A, LDDS et LEP : au 31 décembre,
//    intérêts déjà acquis depuis le 1er janvier compris (./yearlyInterest) ;
// 2. restitution du capital des parents si elle tombe ce mois-là : après les intérêts du
//    mois (leur capital les a produits), avant le versement (qui profite de la place libérée) ;
// 3. versement réparti par le plan de placement (computePlacementStrategy, plafonds vérifiés
//    sur le solde réel) ; ce qui n'a pas de destination reste sur le compte courant (virtuel
//    s'il n'y en a pas) : compté, jamais perdu.
// Fonctions pures sur un état local (aucun accès au stockage ni à l'horloge), testées.
// ================================================
import { AccountType, FiscalConfig, SavingsAccount } from '../types';
import { computePlacementStrategy, SavingsSplit } from './finance';
import { accruedSinceJanuary, applyMonthlyInterest, creditsInterestYearly } from './yearlyInterest';

/** Identifiant du compte courant « virtuel » qui garde l'argent sans destination. */
export const IDLE_ACCOUNT_ID = '__current';

/** Compte projeté : `own` = votre part ; `accrued` = intérêts de livret acquis, pas encore versés. */
export type ProjectedAccount = SavingsAccount & { own: number; accrued: number };

/** Ce qui ne change pas d'une projection à l'autre (calculé une fois, réutilisé par le simulateur). */
export interface ProjectionSetup {
  base: SavingsAccount[];
  accrued: Map<string, number>;
  /** Taux net mensuel (fraction) de chaque compte au mois m (0 = premier mois projeté). */
  rateAt: Map<string, (m: number) => number>;
  /** Mois civil (0-11) du premier mois projeté. */
  firstMonth: number;
}

export interface ProjectionState {
  accounts: ProjectedAccount[];
  setup: ProjectionSetup;
  /** Versé sans compte où le placer : resté sur le compte courant. */
  unplaced: number;
}

/**
 * Prépare une projection qui commence au mois de `start` : immobilier exclu (pas de
 * versement possible), intérêts de livrets déjà acquis cette année, taux net de chaque mois
 * (`rateOf`, en pratique netMonthlyRateSchedule de ./projection).
 */
export const prepareProjection = (
  accounts: SavingsAccount[],
  start: Date,
  rateOf: (a: SavingsAccount) => (m: number) => number,
): ProjectionSetup => {
  const base = accounts.filter(a => a.type !== AccountType.IMMOBILIER);
  return {
    base,
    accrued: accruedSinceJanuary(base, start),
    rateAt: new Map(base.map(a => [a.id, rateOf(a)])),
    firstMonth: start.getMonth(),
  };
};

/** Nouvel état de départ (copie : les comptes de l'app ne sont jamais modifiés). */
export const startProjection = (setup: ProjectionSetup): ProjectionState => ({
  setup,
  unplaced: 0,
  accounts: setup.base.map(a => ({ ...a, own: a.ownedAmount, accrued: setup.accrued.get(a.id) ?? 0 })),
});

/** Le compte courant qui garde l'argent sans destination (créé, vide, s'il n'y en a pas). */
export const idleAccount = (state: ProjectionState): ProjectedAccount => {
  let cc = state.accounts.find(a => a.type === AccountType.COMPTE_COURANT);
  if (!cc) {
    cc = { id: IDLE_ACCOUNT_ID, name: 'Compte courant', type: AccountType.COMPTE_COURANT, institution: '', totalAmount: 0, ownedAmount: 0, parentalCapital: 0, movements: [], own: 0, accrued: 0 };
    state.accounts.push(cc);
  }
  return cc;
};

/** Étape 1 du mois `m` (1 = premier mois projeté) : intérêts nets, versés au 31/12 pour les livrets. */
export const accrueMonth = (state: ProjectionState, m: number): void => {
  const december = (state.setup.firstMonth + m - 1) % 12 === 11;
  for (const a of state.accounts) {
    if (a.type === AccountType.COMPTE_COURANT) continue;
    const credited = applyMonthlyInterest(a, state.setup.rateAt.get(a.id)?.(m - 1) ?? 0, december);
    a.own += credited;
    // Intérêts déjà NETS de l'impôt de sortie (netAnnualRate) : comptés avec les versements
    // pour qu'un retrait simulé ne les impose pas une seconde fois.
    if (!creditsInterestYearly(a.type) && a.totalDeposits !== undefined) a.totalDeposits += credited;
  }
};

/** Restitution : le capital des parents quitte les comptes (place libérée sous les plafonds). */
export const restituteParentalCapital = (state: ProjectionState): void => {
  for (const a of state.accounts) a.totalAmount = a.own;
};

/** Étape 3 : versement de `amount` réparti par le plan de placement (ou votre répartition). */
export const placeDeposit = (state: ProjectionState, amount: number, fiscal: FiscalConfig, split?: SavingsSplit): void => {
  if (!(amount > 0)) return;
  for (const st of computePlacementStrategy(amount, state.accounts, fiscal, split)) {
    if (st.infoOnly) continue;
    const target = st.accountId ? state.accounts.find(x => x.id === st.accountId) : undefined;
    const a = target || idleAccount(state);
    if (!target) state.unplaced += st.fillAmount;
    a.totalAmount += st.fillAmount; a.own += st.fillAmount;
    if (a.totalDeposits !== undefined) a.totalDeposits += st.fillAmount;
  }
};

/** Votre épargne projetée (part propre, intérêts de livrets pas encore versés non compris). */
export const projectedTotal = (state: ProjectionState): number => state.accounts.reduce((s, a) => s + a.own, 0);

/**
 * Projection la plus courante : `months` mois de versement `deposit(m)`, restitution au
 * mois `restitutionMonth` (≤ 0 : tout de suite, avant tout intérêt). `onMonth` est appelé à
 * la fin de chaque mois (repères du plan solo). Renvoie l'état final.
 */
export const runProjection = (
  setup: ProjectionSetup,
  fiscal: FiscalConfig,
  opts: { months: number; deposit: (m: number) => number; split?: SavingsSplit; restitutionMonth?: number; onMonth?: (state: ProjectionState, m: number) => void },
): ProjectionState => {
  const state = startProjection(setup);
  if (opts.restitutionMonth !== undefined && opts.restitutionMonth <= 0) restituteParentalCapital(state);
  for (let m = 1; m <= opts.months; m++) {
    accrueMonth(state, m);
    if (opts.restitutionMonth === m) restituteParentalCapital(state);
    placeDeposit(state, opts.deposit(m), fiscal, opts.split);
    opts.onMonth?.(state, m);
  }
  return state;
};
