// Disponibilité de l'épargne : ce qui se retire tout de suite, avec impôt, ou bloqué.
// Partie de src/lib/finance.ts (qui réexporte tout) : importez depuis '../finance'.
import { AccountType, AccountMovement, FiscalConfig, SavingsAccount } from '../../types';
import { MS_PER_DAY, formatISODay, parseISODate } from '../dates';
import { signedAmount } from '../money';
import { accountAgeYears } from './capitalTax';
import { isInitialBalance } from './savings';

// ---------------------------------------------------------------------------
// PEE : chaque versement est bloqué 5 ans
// ---------------------------------------------------------------------------
// « Les actions ou parts acquises pour le compte des salariés […] leur sont délivrées à
// l'expiration d'un délai minimum de cinq ans courant à compter de la date d'acquisition
// des titres » (Code du travail, art. L3332-25, vérifié le 2026-10-14 :
// https://code.travail.gouv.fr/code-du-travail/l3332-25). Le délai court donc VERSEMENT
// PAR VERSEMENT, pas depuis l'ouverture du plan. Simplification : chaque versement est
// libre 5 ans jour pour jour après sa date (certains plans fixent une date commune par
// année, souvent un peu plus tard : le relevé de l'organisme fait foi). Les cas de
// déblocage anticipé (mariage, achat de la résidence principale…) ne sont pas devinés.

export interface PeeRelease {
  date: string;            // ISO
  monthsRemaining: number; // >= 1
  amount: number;          // part de votre solde qui se débloque ce jour-là
  last: boolean;           // plus rien de bloqué après
}

export interface PeeAvailability {
  available: number;
  blocked: number;
  nextRelease?: PeeRelease;
  /** Une partie du solde n'a pas de date de versement connue : comptée bloquée par prudence. */
  undated: boolean;
}

const monthsUntil = (from: Date, to: Date) =>
  Math.max(1, Math.ceil((to.getTime() - from.getTime()) / (MS_PER_DAY * 30.4375)));

/** Mouvements de VOTRE argent (ni la part des parents), à ce jour. */
const ownMovementsUntil = (movements: AccountMovement[], todayISO: string) =>
  movements.filter(m => m.kind !== 'parental' && m.date <= todayISO);

/**
 * Votre part d'un compte à une date : `ownedAmount` moins vos mouvements datés après elle
 * (même convention que la carte « Mon épargne nette » de l'Accueil).
 */
export const ownedAmountAt = (account: Pick<SavingsAccount, 'movements' | 'ownedAmount'>, iso: string): number =>
  account.movements.reduce((s, m) => (m.date > iso && m.kind !== 'parental' ? s - signedAmount(m) : s), account.ownedAmount);

/**
 * Part disponible d'un PEE à `asOfDate`. Versements (mouvements entrants hors variation de
 * valeur) rangés par date ; les retraits consomment les plus anciens d'abord. Les gains
 * suivent les versements au prorata. Le solde que les mouvements n'expliquent pas reste
 * bloqué (date inconnue). Une date de fin de contrat passée rend tout disponible.
 * « Solde initial » : il date du jour où le compte a été ajouté à l'app. Si le plan est
 * plus ancien (ou sa date d'ouverture inconnue), cet argent a été versé entre l'ouverture
 * et ce jour-là, à des dates qu'on ignore : il n'est libre à coup sûr que 5 ans après le
 * solde initial ; avant, il reste compté bloqué par prudence, sans date de déblocage
 * annoncée (`undated`).
 * `owned` : votre part à `asOfDate` (par défaut `ownedAmount` sans les mouvements à venir).
 */
export const computePeeAvailability = (
  account: Pick<SavingsAccount, 'movements' | 'contractEndDate' | 'ownedAmount' | 'openingDate'>,
  fiscalConfig: Pick<FiscalConfig, 'legalMaturity'>,
  asOfDate: Date = new Date(),
  owned: number = ownedAmountAt(account, formatISODay(asOfDate))
): PeeAvailability => {
  const value = Math.max(0, owned);
  const end = account.contractEndDate ? parseISODate(account.contractEndDate) : undefined;
  const endValid = end && !Number.isNaN(end.getTime()) ? end : undefined;
  if (endValid && endValid <= asOfDate) return { available: value, blocked: 0, undated: false };

  const years = fiscalConfig.legalMaturity.pee;
  const todayISO = formatISODay(asOfDate);
  const own = ownMovementsUntil(account.movements, todayISO).sort((a, b) => a.date.localeCompare(b.date));
  const releaseOf = (iso: string) => { const d = parseISODate(iso); return new Date(d.getFullYear() + years, d.getMonth(), d.getDate()); };
  // Solde initial d'un plan ouvert avant (ou à une date inconnue) : versé « au plus tard » ce jour-là.
  const isBackdated = (m: AccountMovement) => isInitialBalance(m) && (!account.openingDate || account.openingDate < m.date);
  const lots: { date: string; amount: number; uncertain: boolean }[] = [];
  for (const m of own) {
    if (m.kind === 'valuation') continue;
    if (m.type === 'IN') {
      lots.push({ date: m.date, amount: m.amount, uncertain: isBackdated(m) && releaseOf(m.date) > asOfDate });
      continue;
    }
    let left = m.amount;
    for (const lot of lots) {
      if (left <= 0) break;
      const take = Math.min(lot.amount, left);
      lot.amount -= take; left -= take;
    }
  }
  const live = lots.filter(l => l.amount > 0.005);
  const paid = live.reduce((s, l) => s + l.amount, 0);
  // Ce que les mouvements expliquent (gains compris) ; le reste n'a pas de date connue.
  const explained = own.reduce((s, m) => s + signedAmount(m), 0);
  const dated = paid > 0.005 ? Math.max(0, Math.min(value, explained)) : 0;
  const undated = value - dated > 0.5 || live.some(l => l.uncertain);

  const freePaid = live.filter(l => !l.uncertain && releaseOf(l.date) <= asOfDate).reduce((s, l) => s + l.amount, 0);
  const available = paid > 0.005 ? dated * (freePaid / paid) : 0;
  const blocked = Math.max(0, value - available);

  let nextRelease: PeeRelease | undefined;
  const upcoming = live.filter(l => !l.uncertain).map(l => ({ at: releaseOf(l.date), amount: l.amount })).filter(l => l.at > asOfDate)
    .sort((a, b) => a.at.getTime() - b.at.getTime());
  if (upcoming.length > 0 && !(endValid && endValid <= upcoming[0].at)) {
    const first = upcoming[0].at;
    const sameDay = upcoming.filter(l => l.at.getTime() === first.getTime()).reduce((s, l) => s + l.amount, 0);
    const last = upcoming.every(l => l.at.getTime() === first.getTime()) && !undated;
    nextRelease = { date: formatISODay(first), monthsRemaining: monthsUntil(asOfDate, first), amount: dated * (sameDay / paid), last };
  } else if (endValid && blocked > 0.005) {
    nextRelease = { date: formatISODay(endValid), monthsRemaining: monthsUntil(asOfDate, endValid), amount: blocked, last: true };
  }
  return { available, blocked, nextRelease, undated };
};

// ---------------------------------------------------------------------------
// Répartition de l'épargne par disponibilité (Accueil)
// ---------------------------------------------------------------------------

export type AvailabilityStatus = 'AVAILABLE' | 'TAX_LOCKED' | 'HARD_LOCKED';

/** PEL : avant le 4e anniversaire, un retrait clôture le plan (F16140, vérifié le 2026-10-21). */
const PEL_TERM_YEARS = 4;

/**
 * Disponibilité d'un compte (hors PEE, calculé versement par versement) : retraite et
 * immobilier bloqués ; PEL bloqué avant son 4e anniversaire (date inconnue : bloqué, par
 * prudence) ; compte à terme bloqué jusqu'à son échéance (`contractEndDate`) ; « Autre »
 * disponible sauf s'il est marqué bloqué ; PEA et assurance vie pas encore mûrs « avec
 * impôt » ; le reste disponible (livrets, CEL, compte-titres, crypto…). Seuils de
 * fiscalConfig.legalMaturity, ancienneté par date anniversaire.
 * Sources (vérifiées le 2026-10-21) : PEL https://www.service-public.gouv.fr/particuliers/vosdroits/F16140 ;
 * CEL (retraits libres) https://www.service-public.gouv.fr/particuliers/vosdroits/F16136
 */
export const accountAvailabilityStatus = (
  account: Pick<SavingsAccount, 'type' | 'openingDate'> & Partial<Pick<SavingsAccount, 'contractEndDate' | 'blocked'>>,
  fiscalConfig: Pick<FiscalConfig, 'legalMaturity'>,
  asOfDate: Date = new Date()
): AvailabilityStatus => {
  if ([AccountType.IMMOBILIER, AccountType.PER, AccountType.PEE].includes(account.type)) return 'HARD_LOCKED';
  if (account.type === AccountType.AUTRE) return account.blocked ? 'HARD_LOCKED' : 'AVAILABLE';
  if (account.type === AccountType.PEL) {
    return account.openingDate && accountAgeYears(account.openingDate, asOfDate) >= PEL_TERM_YEARS ? 'AVAILABLE' : 'HARD_LOCKED';
  }
  if (account.type === AccountType.COMPTE_A_TERME) {
    return account.contractEndDate && account.contractEndDate > formatISODay(asOfDate) ? 'HARD_LOCKED' : 'AVAILABLE';
  }
  if (!account.openingDate) return 'AVAILABLE';
  const age = accountAgeYears(account.openingDate, asOfDate);
  const { pea, assuranceVie } = fiscalConfig.legalMaturity;
  if (account.type === AccountType.PEA) return age < pea ? 'TAX_LOCKED' : 'AVAILABLE';
  if (account.type === AccountType.ASSURANCE_VIE) return age < assuranceVie ? 'TAX_LOCKED' : 'AVAILABLE';
  return 'AVAILABLE';
};

export interface AvailabilityBreakdown {
  available: number;
  taxLocked: number;
  hardLocked: number;
  /** Prochain déblocage d'un versement de PEE, tous plans confondus. */
  peeNextRelease?: PeeRelease & { name: string };
  /** Un PEE a une part sans date de versement connue, comptée bloquée par prudence. */
  peeUndated: boolean;
}

/** `ownedOf` : votre part de chaque compte (par défaut à `asOfDate`, mouvements à venir neutralisés). */
export const computeAvailabilityBreakdown = (
  accounts: SavingsAccount[],
  fiscalConfig: Pick<FiscalConfig, 'legalMaturity'>,
  ownedOf?: (a: SavingsAccount) => number,
  asOfDate: Date = new Date()
): AvailabilityBreakdown => {
  const asOfISO = formatISODay(asOfDate);
  const out: AvailabilityBreakdown = { available: 0, taxLocked: 0, hardLocked: 0, peeUndated: false };
  for (const a of accounts) {
    const owned = ownedOf ? ownedOf(a) : ownedAmountAt(a, asOfISO);
    if (a.type === AccountType.PEE) {
      const pee = computePeeAvailability(a, fiscalConfig, asOfDate, owned);
      out.available += pee.available;
      out.hardLocked += owned - pee.available;
      if (pee.undated && pee.blocked >= 0.5) out.peeUndated = true;
      if (pee.nextRelease && (!out.peeNextRelease || pee.nextRelease.date < out.peeNextRelease.date)) out.peeNextRelease = { ...pee.nextRelease, name: a.name };
      continue;
    }
    const status = accountAvailabilityStatus(a, fiscalConfig, asOfDate);
    if (status === 'AVAILABLE') out.available += owned;
    else if (status === 'TAX_LOCKED') out.taxLocked += owned;
    else out.hardLocked += owned;
  }
  return out;
};
