// Brouillons de l'écran « Actualiser les soldes » (types et calculs partagés entre l'écran
// et ses lignes ; fonctions pures, testées dans draft.test.ts).
//
// `deposits` : versements cumulés des placements (PEA, AV…), '' = inconnus.
// `cashFlow` : argent réellement versé/retiré via l'ajustement rapide, pour distinguer
// un versement d'une simple variation de valeur à l'enregistrement.
// `interest` / `cash` : ventilation de l'écart corrigée à la main (absente = proposition
// automatique) : intérêts crédités d'un livret, ou argent versé/retiré d'un placement.
// `touched` : champs saisis par l'utilisateur. Les champs NON modifiés suivent les comptes
// en direct (un ajout rapide fait pendant que l'écran est ouvert n'est pas écrasé par un
// ancien solde au moment d'enregistrer).
import type { SavingsAccount } from '../../types';
import type { BalanceUpdate } from '../../lib/commands';
import { suggestCreditedInterest, tracksDeposits } from '../../lib/finance';
import { parseFrenchNumber } from '../../lib/numbers';
import { round2 } from '../../lib/money';
import { storageKey } from '../../lib/storageKeys';

export type DraftField = 'owned' | 'parental' | 'date' | 'deposits' | 'cashFlow' | 'bankTotal' | 'interest' | 'cash';
export type Draft = {
  owned: string; parental: string; date: string; deposits: string; cashFlow: number;
  bankTotal?: string; interest?: string; cash?: string; touched?: DraftField[];
};

// `isCash` (placements suivis) : l'ajustement est un versement/retrait d'argent, pas un
// gain ou une perte de valeur — il met alors à jour les versements cumulés.
export type Adjust = { sign: 1 | -1; amount: string; target: 'owned' | 'parental'; isCash: boolean };
export const DEFAULT_ADJUST: Adjust = { sign: 1, amount: '', target: 'owned', isCash: true };

/** Façon de saisir le nouveau solde d'un compte. */
export type EntryMode = 'balance' | 'bank' | 'adjust';

/** Versements cumulés saisis : `undefined` = inconnus (champ vide), `null` = illisibles. */
export const parseDeposits = (val: string): number | undefined | null =>
  val.trim() === '' ? undefined : parseFrenchNumber(val);

/** Ce que la saisie d'une ligne donnera à l'enregistrement. */
export interface DraftBreakdown {
  owned: number | null;
  parental: number | null;
  deposits: number | undefined | null;
  /** Écart de votre part (0 si la saisie est illisible). */
  ownDiff: number;
  parentalDiff: number;
  /** Placement qui suit ses versements : l'écart se partage entre argent versé et valorisation. */
  tracked: boolean;
  /** Livrets et comptes : intérêts crédités proposés (année précédente), s'il y en a. */
  suggestion: { year: number; amount: number } | null;
  interest: number;
  interestLabel: string;
  /** Placements : argent versé (+) ou retiré (−). */
  cash: number;
  /** Reste de l'écart : versement/retrait (livret) ou valorisation (placement). */
  rest: number;
  errors: Partial<Record<'owned' | 'parental' | 'deposits' | 'interest' | 'cash', string>>;
  changed: boolean;
}

const UNREADABLE = 'Montant non reconnu.';

/**
 * Ventilation proposée par défaut :
 * - livret ou compte (versements non suivis) : en janvier-mars, les intérêts de l'année
 *   écoulée (suggestCreditedInterest) sont mis à part, hors épargne ; le reste est un versement ;
 * - placement suivi : argent versé = ajustement « + x € » s'il a servi, sinon l'écart des
 *   versements cumulés saisis ; le reste est une variation de valeur.
 */
export const breakdownDraft = (account: SavingsAccount, d: Draft): DraftBreakdown => {
  const errors: DraftBreakdown['errors'] = {};
  const owned = parseFrenchNumber(d.owned);
  const parental = parseFrenchNumber(d.parental);
  if (owned === null) errors.owned = UNREADABLE;
  else if (owned < 0) errors.owned = 'Votre part ne peut pas être négative.';
  if (parental === null) errors.parental = UNREADABLE;
  else if (parental < 0) errors.parental = 'La part des parents ne peut pas être négative.';
  const tracked = tracksDeposits(account.type);
  const deposits = parseDeposits(d.deposits);
  if (tracked && deposits === null) errors.deposits = UNREADABLE;
  else if (tracked && typeof deposits === 'number' && deposits < 0) errors.deposits = 'Les versements ne peuvent pas être négatifs.';
  const ownDiff = owned === null ? 0 : round2(owned - account.ownedAmount);
  const parentalDiff = parental === null ? 0 : round2(parental - account.parentalCapital);

  let suggestion: DraftBreakdown['suggestion'] = null;
  let interest = 0;
  let cash = 0;
  if (!tracked) {
    suggestion = ownDiff > 0 ? suggestCreditedInterest(account, d.date) : null;
    const auto = suggestion ? Math.min(suggestion.amount, ownDiff) : 0;
    if (d.interest === undefined) interest = auto;
    else {
      const typed = d.interest.trim() === '' ? 0 : parseFrenchNumber(d.interest);
      if (typed === null) errors.interest = UNREADABLE;
      else if (typed < 0) errors.interest = 'Les intérêts ne peuvent pas être négatifs.';
      else if (typed > Math.max(0, ownDiff) + 0.004) errors.interest = 'Plus que la hausse de votre part.';
      else interest = round2(typed);
    }
  } else {
    let auto = d.cashFlow;
    const before = account.totalDeposits;
    if (auto === 0 && typeof deposits === 'number' && before !== undefined && Math.abs(deposits - before) > 0.004) {
      // Versement : l'écart des versements cumulés. Retrait : un retrait de R emporte
      // R × versements / valeur des versements cumulés, d'où R = baisse × valeur / versements.
      auto = deposits > before ? deposits - before
        : before > 0 ? -Math.min(account.ownedAmount, (before - deposits) * account.totalAmount / before) : 0;
    }
    if (d.cash === undefined) cash = round2(auto);
    else {
      const typed = d.cash.trim() === '' ? 0 : parseFrenchNumber(d.cash);
      if (typed === null) errors.cash = UNREADABLE;
      else if (typed < 0 && -typed > account.ownedAmount + 0.004) errors.cash = 'Retrait supérieur à votre part.';
      else cash = round2(typed);
    }
  }
  const changed = owned === null || parental === null || (tracked && deposits === null)
    || Math.abs(ownDiff) > 0.004 || Math.abs(parentalDiff) > 0.004
    || (tracked && deposits !== account.totalDeposits);
  return {
    owned, parental, deposits, ownDiff, parentalDiff, tracked, suggestion, interest,
    interestLabel: suggestion ? `Intérêts ${suggestion.year}` : 'Intérêts',
    cash, rest: round2(ownDiff - interest - cash), errors, changed,
  };
};

/** Demande d'enregistrement (commande updateBalances) tirée d'une ligne. */
export const draftToUpdate = (account: SavingsAccount, d: Draft, b: DraftBreakdown = breakdownDraft(account, d)): BalanceUpdate => ({
  accountId: account.id,
  date: d.date,
  owned: b.owned,
  parental: b.parental,
  ...(b.tracked ? { deposits: b.deposits, cashFlow: b.cash } : { interest: b.interest, interestLabel: b.interestLabel }),
});

// ---------------------------------------------------------------------------
// Conservation de la saisie (changement d'écran, verrouillage de l'app)
// ---------------------------------------------------------------------------
// sessionStorage : propre à l'onglet, effacé à sa fermeture. Seuls les comptes réellement
// modifiés sont gardés ; effacé à l'enregistrement et à l'abandon. Accès protégés (navigation
// privée, stockage bloqué) : sans stockage, l'écran marche comme avant.

export const UPDATE_DRAFTS_KEY = storageKey('updateDrafts');
const DRAFTS_TTL_MS = 12 * 60 * 60 * 1000;

export const saveStoredDrafts = (drafts: Record<string, Draft>, now = Date.now()) => {
  try {
    const kept = Object.fromEntries(Object.entries(drafts).filter(([, d]) => (d.touched?.length ?? 0) > 0));
    if (Object.keys(kept).length === 0) sessionStorage.removeItem(UPDATE_DRAFTS_KEY);
    else sessionStorage.setItem(UPDATE_DRAFTS_KEY, JSON.stringify({ at: now, drafts: kept }));
  } catch { /* stockage indisponible : la saisie reste en mémoire seulement */ }
};

export const loadStoredDrafts = (now = Date.now()): Record<string, Draft> => {
  try {
    const raw = sessionStorage.getItem(UPDATE_DRAFTS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as { at?: unknown; drafts?: unknown };
    if (typeof parsed.at !== 'number' || now - parsed.at > DRAFTS_TTL_MS || !parsed.drafts || typeof parsed.drafts !== 'object') {
      sessionStorage.removeItem(UPDATE_DRAFTS_KEY);
      return {};
    }
    const out: Record<string, Draft> = {};
    for (const [id, d] of Object.entries(parsed.drafts as Record<string, Partial<Draft>>)) {
      if (!d || typeof d.owned !== 'string' || typeof d.parental !== 'string' || typeof d.date !== 'string' || !Array.isArray(d.touched)) continue;
      out[id] = {
        owned: d.owned, parental: d.parental, date: d.date,
        deposits: typeof d.deposits === 'string' ? d.deposits : '',
        cashFlow: typeof d.cashFlow === 'number' && Number.isFinite(d.cashFlow) ? d.cashFlow : 0,
        ...(typeof d.bankTotal === 'string' ? { bankTotal: d.bankTotal } : {}),
        ...(typeof d.interest === 'string' ? { interest: d.interest } : {}),
        ...(typeof d.cash === 'string' ? { cash: d.cash } : {}),
        touched: d.touched.filter((f): f is DraftField => typeof f === 'string'),
      };
    }
    return out;
  } catch { return {}; }
};

/** À appeler à la déconnexion : la saisie en cours ne doit pas survivre à la session. */
export const clearStoredDrafts = () => {
  try { sessionStorage.removeItem(UPDATE_DRAFTS_KEY); } catch { /* ignoré */ }
};
