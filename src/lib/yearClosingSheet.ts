// Rituel « Clôture de l'année » (phase 8, rituel 4) : la liste de lib/yearClosing dans une
// seule feuille où l'on saisit sur place, au lieu de renvoyer vers Actualiser ou Mes comptes :
//  - intérêts crédités par livret : calculés par Pécule (la proposition d'« Actualiser ») et
//    crédités par la banque, avec l'écart en euros ;
//  - relevés annuels des placements : valeur au 31 décembre, versements de l'année, taux servi
//    du fonds euros ;
//  - soldes au 31 décembre des autres comptes ;
//  - restitution : le capital des parents compte par compte et les intérêts qui vous restent ;
//  - objectif de l'année qui commence, prérempli avec le rythme prévu par le plan de l'app (même
//    source que « Cap sur » de « Votre année »), sinon avec ce qui a été mis de côté.
// Tout part en une seule commande (commands/yearClosing : updateBalances, applyRateChange,
// « Taux inchangé ») : un seul « Annuler ». Fonctions pures, testées ; chargé avec la feuille.
import { AccountType, type GlobalAppData, type SavingsAccount } from '../types';
import { buildYearClosing, closingInterestRows, closingScope, parentalAt, parentalInterestOffered, type YearClosing } from './yearClosing';
import { computeYearReview } from './agenda';
import { plannedMonthlySaving } from './yearGoal';
import { isSavingsFlow, ownedAmountAt, tracksDeposits } from './finance';
import { formatEUR } from './format';
import { parseFrenchNumber } from './numbers';
import { round2 } from './money';
import type { BalanceUpdate, YearClosingInput } from './commands';

/** Au-delà de cet écart (en euros), la ligne dit d'où il peut venir. Choix d'affichage. */
export const INTEREST_GAP_LIMIT = 5;
export const INTEREST_GAP_CAUSES = 'Causes possibles : un retrait en milieu de quinzaine, ou un taux changé en cours d\'année.';

/** Écart entre les intérêts crédités par la banque et ceux calculés par Pécule. */
export const interestGap = (computed: number, credited: number): { amount: number; text: string | null; causes: string | null } => {
  const amount = round2(credited - computed);
  if (Math.abs(amount) < 0.005) return { amount: 0, text: null, causes: null };
  return {
    amount,
    text: `${formatEUR(Math.abs(amount), 2)} de ${amount < 0 ? 'moins' : 'plus'} que prévu`,
    causes: Math.abs(amount) > INTEREST_GAP_LIMIT ? INTEREST_GAP_CAUSES : null,
  };
};

export interface ClosingInterestLine {
  accountId: string;
  name: string;
  /** Calculé par Pécule : ce qui reste à enregistrer (ou l'attendu, déjà enregistré). */
  computed: number;
  /** Déjà enregistrés : plus de champ. */
  done: boolean;
  /** Intérêts enregistrés (le montant saisi, quel qu'il soit) quand `done`, sinon 0. */
  recorded: number;
}

export interface ClosingValueLine {
  accountId: string;
  name: string;
  /** Solde (part des parents comprise) au 31 décembre d'après Pécule. */
  atYearEnd: number;
  /** Vérifié depuis le 31 décembre (ligne de la liste « faite »). */
  done: boolean;
  /** Placements qui suivent leurs versements : versements de l'année d'après Pécule. */
  depositsOfYear?: number;
  /** Assurance vie : taux servi actuel, et s'il a déjà été vérifié cette année. */
  rate?: { current: number; done: boolean };
}

export interface ClosingRestitutionSummary {
  accounts: { name: string; amount: number }[];
  total: number;
  /** Intérêts de l'année produits par le capital des parents (offerts). */
  parentalInterest: number;
}

export interface ClosingSheetModel {
  year: number;
  closing: YearClosing;
  interest: ClosingInterestLine[];
  balances: ClosingValueLine[];
  statements: ClosingValueLine[];
  /** Restitution encore à faire (même condition que l'étape) ; `null` sinon. */
  restitution: ClosingRestitutionSummary | null;
  /**
   * Objectif de l'année qui commence : enregistré (`current`), sinon proposé (`suggested`) : le
   * rythme prévu par le plan × 12 quand il existe (`monthly`), sinon le mis de côté de l'année
   * clôturée. `saved` : ce qui a été mis de côté l'année clôturée, en repère sous le champ.
   */
  goal: { year: number; current?: number; suggested: number; saved: number; monthly?: number };
}

const totalAtYearEnd = (a: SavingsAccount, yearEnd: string) => round2(ownedAmountAt(a, yearEnd) + Math.max(0, parentalAt(a, yearEnd)));

/** Versements de l'année (mouvements d'épargne, hors intérêts, valorisations et part des parents). */
const depositsOf = (a: SavingsAccount, year: number) => round2(a.movements
  .filter(m => m.date >= `${year}-01-01` && m.date <= `${year}-12-31` && isSavingsFlow(m))
  .reduce((s, m) => s + (m.type === 'IN' ? m.amount : -m.amount), 0));

export const buildClosingSheet = (data: GlobalAppData, year: number, now: Date = new Date()): ClosingSheetModel => {
  const closing = buildYearClosing(data, year, now);
  const yearEnd = `${year}-12-31`;
  const itemDone = (stepId: string, key: string) =>
    closing.steps.find(s => s.id === stepId)?.items.find(i => i.key === key)?.done ?? false;
  const { balanceAccounts, placements } = closingScope(data, year);

  const interest = closingInterestRows(data, year, now).map(({ account, expected, pending, recorded }) => ({
    accountId: account.id, name: account.name, computed: round2(pending ? pending.amount : expected), done: !pending, recorded,
  }));
  const balances = balanceAccounts.map(a => ({ accountId: a.id, name: a.name, atYearEnd: totalAtYearEnd(a, yearEnd), done: itemDone('balances', a.id) }));
  const statements = placements.map(a => ({
    accountId: a.id, name: a.name, atYearEnd: totalAtYearEnd(a, yearEnd), done: itemDone('statements', a.id),
    ...(tracksDeposits(a.type) ? { depositsOfYear: depositsOf(a, year) } : {}),
    ...(a.type === AccountType.ASSURANCE_VIE ? { rate: { current: a.interestRate || 0, done: itemDone('statements', `rate:${a.id}`) } } : {}),
  }));

  const step = closing.steps.find(s => s.id === 'restitution');
  const withParents = (data.accounts || []).filter(a => a.parentalCapital > 0.005);
  const restitution = step && !step.done && withParents.length > 0 ? {
    accounts: withParents.map(a => ({ name: a.name, amount: a.parentalCapital })),
    total: round2(withParents.reduce((s, a) => s + a.parentalCapital, 0)),
    parentalInterest: parentalInterestOffered(data, year),
  } : null;

  const saved = Math.max(0, Math.round(computeYearReview(data, year, now).saved));
  const current = data.config?.yearGoals?.[String(year + 1)];
  const monthly = plannedMonthlySaving(data);
  return {
    year, closing, interest, balances, statements, restitution,
    goal: {
      year: year + 1, ...(current !== undefined ? { current } : {}),
      suggested: monthly > 0 ? Math.round(monthly * 12) : saved, saved, ...(monthly > 0 ? { monthly } : {}),
    },
  };
};

/** Saisies de la feuille (textes tels que tapés). Seuls les champs touchés sont présents. */
export interface ClosingDrafts {
  /** Crédité par la banque, par compte (prérempli avec le calcul). */
  credited: Record<string, string>;
  /** Solde ou valeur au 31 décembre, part des parents comprise. */
  values: Record<string, string>;
  /** Versements de l'année (placements). */
  deposits: Record<string, string>;
  /** Soldes confirmés tels quels (« Inchangé »). */
  unchanged: string[];
  /** Taux servi de l'assurance vie (vide : rien ne change). */
  rates: Record<string, string>;
}

const read = (text: string | undefined): number | null | undefined => {
  if (text === undefined || text.trim() === '') return undefined;
  const v = parseFrenchNumber(text.replace('€', '').replace('%', ''));
  return v !== null && Number.isFinite(v) && v >= 0 ? v : null;
};

/**
 * Saisies → demande de la commande groupée. Tout est daté du 31 décembre (le relevé de la
 * banque), les intérêts aussi (hors épargne, comme dans « Actualiser »). Un compte présent à
 * plusieurs étapes (livret : solde et intérêts) donne une seule mise à jour : le solde au
 * 31 décembre comprend les intérêts crédités ce jour-là. Refus lisible au premier champ illisible.
 */
export const closingSheetInput = (
  model: ClosingSheetModel, accounts: SavingsAccount[], drafts: ClosingDrafts, todayISO: string,
): { input: YearClosingInput } | { error: string } => {
  const yearEnd = `${model.year}-12-31`;
  const updates: BalanceUpdate[] = [];
  const valueLines = new Map([...model.balances, ...model.statements].map(l => [l.accountId, l]));
  const interestLines = new Map(model.interest.filter(l => !l.done).map(l => [l.accountId, l]));
  for (const a of accounts) {
    const line = valueLines.get(a.id);
    const interestLine = interestLines.get(a.id);
    if (!line && !interestLine) continue;
    const credited = interestLine ? read(drafts.credited[a.id] ?? creditedText(interestLine.computed)) : 0;
    if (credited === null) return { error: `${a.name} : intérêts non reconnus (exemple : 168,40).` };
    const interest = round2(credited ?? 0);
    const typed = read(drafts.values[a.id]);
    if (typed === null) return { error: `${a.name} : montant non reconnu (exemple : 4 460,25).` };
    const dep = line?.depositsOfYear !== undefined ? read(drafts.deposits[a.id]) : undefined;
    if (dep === null) return { error: `${a.name} : versements non reconnus (exemple : 1 200).` };
    const flow = dep === undefined || line?.depositsOfYear === undefined ? 0 : round2(dep - line.depositsOfYear);
    // Solde saisi : l'écart avec Pécule au 31 décembre ; sinon les intérêts et le versement oublié.
    const delta = typed !== undefined ? round2(typed - totalAtYearEnd(a, yearEnd)) : round2(interest + flow);
    const confirm = typed !== undefined || drafts.unchanged.includes(a.id);
    if (!confirm && interest < 0.005 && Math.abs(delta) < 0.005 && Math.abs(flow) < 0.005) continue;
    updates.push({
      accountId: a.id, date: yearEnd, owned: round2(a.ownedAmount + delta), parental: a.parentalCapital,
      ...(tracksDeposits(a.type) ? { deposits: a.totalDeposits, cashFlow: flow } : {}),
      ...(interest >= 0.005 ? { interest, interestLabel: `Intérêts ${model.year}`, interestDate: yearEnd } : {}),
      ...(confirm ? { confirm: true } : {}),
    });
  }

  // Taux servi : changé (daté d'aujourd'hui, comme la fiche du compte) ou confirmé tel quel.
  const rates: YearClosingInput['rates'] = [];
  for (const line of model.statements) {
    if (!line.rate) continue;
    const r = read(drafts.rates[line.accountId]);
    if (r === null || (r !== undefined && r > 20)) return { error: `${line.name} : taux non reconnu (exemple : 2,5).` };
    if (r !== undefined) rates.push({ accountId: line.accountId, rate: r });
  }
  return { input: { updates, rates, date: todayISO } };
};

/** Montant prérempli dans un champ (« 168,4 » → « 168,40 »). */
export const creditedText = (n: number): string => n.toFixed(2).replace('.', ',');

/** Objectif saisi : montant arrondi à l'euro, `null` (effacé) si vide ou nul, `undefined` si illisible. */
export const readGoal = (text: string): number | null | undefined => {
  const v = read(text);
  if (v === undefined) return null;
  if (v === null) return undefined;
  return v >= 1 ? Math.round(v) : null;
};

/**
 * Étape saisie dans la feuille et complète à l'écran, avant même « Enregistrer » : chaque ligne
 * est déjà faite (enregistrée) ou a reçu une saisie lisible (un montant tapé, « Inchangé », le
 * montant des intérêts crédités, le taux servi). Sert au compteur d'étapes de la feuille ;
 * l'étape n'est « faite » pour de bon (repliée, dans la liste de l'Accueil) qu'une fois enregistrée.
 */
export const stepFilledOnScreen = (model: ClosingSheetModel, stepId: string, drafts: ClosingDrafts): boolean => {
  const valueOk = (l: ClosingValueLine) => l.done || drafts.unchanged.includes(l.accountId) || typeof read(drafts.values[l.accountId]) === 'number';
  switch (stepId) {
    case 'balances': return model.balances.every(valueOk);
    case 'interest': return model.interest.every(l => l.done || typeof read(drafts.credited[l.accountId]) === 'number');
    case 'statements': return model.statements.every(l => valueOk(l) && (!l.rate || l.rate.done || typeof read(drafts.rates[l.accountId]) === 'number'));
    default: return false;
  }
};
