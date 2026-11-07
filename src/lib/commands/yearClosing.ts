// « Clôture de l'année » enregistrée en une fois (lib/yearClosingSheet) : soldes et valeurs au
// 31 décembre, intérêts crédités (hors épargne) et versements de l'année passent par la même
// commande qu'« Actualiser » (updateBalances) ; le taux servi de l'assurance vie, changé
// (applyRateChange, daté du jour comme dans la fiche du compte) ou confirmé (« Taux inchangé »,
// `rateReviewedAt`). Un seul « Annuler » remet tout.
import { applyRateChange, confirmRatesUnchanged } from '../finance';
import { updateBalances, type BalanceUpdate } from './balances';
import { CommandResult, CommandState, fail } from './types';

export interface YearClosingInput {
  updates: BalanceUpdate[];
  /** Taux servi saisi ; identique au taux actuel : « Taux inchangé ». */
  rates: { accountId: string; rate: number }[];
  /** Jour de la saisie (AAAA-MM-JJ) : date d'effet d'un nouveau taux, ou de « Taux inchangé ». */
  date: string;
}

const sameRate = (a: number, b: number) => Math.abs(a - b) < 1e-9;

const comptes = (n: number) => `${n} compte${n > 1 ? 's' : ''}`;

/**
 * Ce qui part à l'enregistrement, en une phrase : « Soldes de 3 comptes et intérêts de 2 comptes
 * enregistrés ». Les intérêts sont ceux saisis (au moins 1 centime) ; `null` si rien à dire.
 * Partagé par le message de la commande et la feuille de clôture.
 */
export const yearClosingSummary = (input: Pick<YearClosingInput, 'updates' | 'rates'>): string | null => {
  const interests = input.updates.filter(u => (u.interest ?? 0) >= 0.005).length;
  const parts: { n: number; one: string; many: string }[] = [
    { n: input.updates.length, one: 'solde', many: 'soldes' },
    { n: interests, one: 'intérêt', many: 'intérêts' },
    { n: input.rates.length, one: 'taux servi', many: 'taux servis' },
  ].filter(p => p.n > 0);
  if (parts.length === 0) return null;
  const texts = parts.map(p => `${p.n > 1 ? p.many : p.one} de ${comptes(p.n)}`);
  const sentence = texts.length > 1 ? `${texts.slice(0, -1).join(', ')} et ${texts[texts.length - 1]}` : texts[0];
  const plural = parts.length > 1 || parts[0].n > 1;
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)} enregistré${plural ? 's' : ''}`;
};

export const recordYearClosing = (state: CommandState, input: YearClosingInput): CommandResult<{ accountIds: string[] }> => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return fail('invalid', 'Date illisible.');
  if (input.rates.some(r => !(Number.isFinite(r.rate) && r.rate >= 0 && r.rate <= 20))) return fail('invalid', 'Un taux doit être compris entre 0 et 20 %.');
  const balances = input.updates.length > 0 ? updateBalances(state, { updates: input.updates }) : null;
  if (balances && !balances.ok && balances.code !== 'nothing-to-do') return balances;
  const afterBalances = balances?.ok ? balances.next.accounts ?? state.accounts : state.accounts;

  // Taux : changés, ou confirmés tels quels.
  let accounts = afterBalances;
  const unchanged: string[] = [];
  for (const r of input.rates) {
    const a = accounts.find(x => x.id === r.accountId);
    if (!a) continue;
    if (sameRate(a.interestRate || 0, r.rate)) unchanged.push(a.id);
    else accounts = accounts.map(x => (x.id === a.id ? applyRateChange(x, r.rate, input.date) : x));
  }
  accounts = confirmRatesUnchanged(accounts, unchanged, input.date);
  const rateIds = new Set(input.rates.map(r => r.accountId));
  const rateBefore = state.accounts.filter(a => rateIds.has(a.id)).map(a => ({ id: a.id, interestRate: a.interestRate, rateHistory: a.rateHistory, rateReviewedAt: a.rateReviewedAt }));
  const rateChanged = accounts.some((a, i) => rateIds.has(a.id) && a !== afterBalances[i]);

  if (!balances?.ok && !rateChanged) return fail('nothing-to-do', 'Rien à enregistrer.');
  const ids = [...new Set([...(balances?.ok ? balances.changedIds : []), ...(rateChanged ? [...rateIds] : [])])];
  return {
    ok: true,
    next: { accounts },
    accountIds: ids,
    message: yearClosingSummary({
      updates: input.updates.filter(u => (balances?.ok ? balances.changedIds : []).includes(u.accountId)),
      rates: input.rates.filter(r => accounts.some(a => a.id === r.accountId)),
    }) ?? (ids.length > 1 ? `${ids.length} comptes enregistrés` : '1 compte enregistré'),
    undo: current => {
      // Taux d'abord (champs du compte), puis soldes et mouvements (annulation d'« Actualiser »).
      const restored = current.accounts.map(a => {
        const b = rateBefore.find(x => x.id === a.id);
        return b ? { ...a, interestRate: b.interestRate, rateHistory: b.rateHistory, rateReviewedAt: b.rateReviewedAt } : a;
      });
      return balances?.ok ? balances.undo({ ...current, accounts: restored }) : { accounts: restored };
    },
  };
};
