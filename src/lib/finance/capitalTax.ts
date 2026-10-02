// Fiscalité du capital : PFU, maturités, retraits, coût de déblocage.
// Partie de src/lib/finance.ts (qui réexporte tout) : importez depuis '../finance'.
import { FiscalConfig, RateChange, AccountType, SavingsAccount } from '../../types';
import { MS_PER_DAY, formatISODay, parseISODate } from '../dates';
import { socialChargesRateFor } from './income';

// --- FISCALITÉ DU CAPITAL (PFU / prélèvements sociaux) ---
// `socialChargesCapital` (17,2 %) existait dans FiscalConfig depuis le début mais n'était
// utilisé par aucun calcul. Ce qui suit modélise le régime le plus courant par type de compte
// — volontairement simplifié, pas une simulation fiscale complète (voir les limites
// documentées sur chaque cas).
//
// ATTENTION au sens du résultat : PEA et Assurance Vie sont à fiscalité DIFFÉRÉE — l'impôt
// n'est dû qu'au retrait, pas chaque année. Ce calcul donne donc le net qu'on toucherait EN
// RETIRANT les gains, jamais un montant « à déclarer » pour l'année.
const PFU_INCOME_TAX_RATE = 0.128; // part « impôt » du PFU (12,8 % IR + 18,6 % de prélèvements sociaux en 2026, 17,2 % sur l'assurance vie)
// Taux réduit d'IR sur les gains d'Assurance Vie après 8 ans (art. 125-0 A du CGI), HORS
// abattement annuel de 4 600 €/9 200 € : celui-ci porte sur l'ensemble des contrats d'une
// personne (pas par compte) et dépend de versements antérieurs au 27/09/2017 — non modélisable
// ici sans ces informations. Le net réel après 8 ans est donc, dans la pratique, souvent
// LÉGÈREMENT MEILLEUR que ce que ce calcul affiche pour de petits montants de gains annuels.
const AV_REDUCED_INCOME_TAX_RATE = 0.075;

export type CapitalTaxRegime = 'PFU' | 'EXONERE_IR' | 'AV_REDUIT' | 'NON_MODELISE';

export interface CapitalTaxBreakdown {
  grossInterest: number;
  socialCharges: number;
  incomeTax: number;
  netInterest: number;
  regime: CapitalTaxRegime;
}

/**
 * Répartit des intérêts/gains bruts entre prélèvements sociaux, impôt sur le revenu et net
 * réel, selon le type de compte et son ancienneté par rapport aux seuils légaux configurés.
 *
 * `asOfDate` est injectable pour les tests (sinon non-déterministe).
 */
/**
 * Ancienneté d'un compte en années, alignée sur le calendrier : la partie entière est le
 * nombre d'anniversaires d'ouverture passés (5 ans pile le jour du 5e anniversaire, ni la
 * veille ni le lendemain), la partie décimale la progression vers le suivant.
 */
export const accountAgeYears = (openingISO: string, asOfDate: Date = new Date()): number => {
  const o = parseISODate(openingISO);
  const today = new Date(asOfDate.getFullYear(), asOfDate.getMonth(), asOfDate.getDate());
  if (today < o) return 0;
  let full = today.getFullYear() - o.getFullYear();
  const anniversary = (years: number) => new Date(o.getFullYear() + years, o.getMonth(), o.getDate());
  if (today < anniversary(full)) full -= 1;
  const last = anniversary(full), next = anniversary(full + 1);
  return full + (today.getTime() - last.getTime()) / (next.getTime() - last.getTime());
};

export const computeCapitalGainsTax = (
  account: { type: AccountType; openingDate?: string },
  grossInterest: number,
  fiscalConfig: FiscalConfig,
  asOfDate: Date = new Date()
): CapitalTaxBreakdown => {
  if (grossInterest <= 0) {
    return { grossInterest, socialCharges: 0, incomeTax: 0, netInterest: grossInterest, regime: 'PFU' };
  }

  // Date d'ouverture inconnue => on ne peut pas prouver l'ancienneté requise pour une
  // exonération : on suppose le cas le moins favorable (compte récent) plutôt que d'afficher
  // un net optimiste et faux.
  const ageYears = account.openingDate
    ? accountAgeYears(account.openingDate, asOfDate)
    : 0;

  const socialCharges = grossInterest * socialChargesRateFor(account.type, fiscalConfig);

  const withMaturity = (maturityYears: number, reducedRate: number, regimeIfMature: CapitalTaxRegime): CapitalTaxBreakdown => {
    const mature = ageYears >= maturityYears;
    const incomeTax = grossInterest * (mature ? reducedRate : PFU_INCOME_TAX_RATE);
    return {
      grossInterest, socialCharges, incomeTax,
      netInterest: grossInterest - socialCharges - incomeTax,
      regime: mature ? regimeIfMature : 'PFU',
    };
  };

  switch (account.type) {
    // Passé le seuil légal, les gains PEA/PEE sont exonérés d'IR (mais pas des 17,2 % sociaux,
    // dus dans tous les cas sur du capital).
    case AccountType.PEA:
      return withMaturity(fiscalConfig.legalMaturity.pea, 0, 'EXONERE_IR');
    // Les gains d'un PEE sont TOUJOURS exonérés d'impôt sur le revenu (même en déblocage
    // anticipé) : seuls les prélèvements sociaux sont dus.
    case AccountType.PEE:
      return { grossInterest, socialCharges, incomeTax: 0, netInterest: grossInterest - socialCharges, regime: 'EXONERE_IR' };
    case AccountType.ASSURANCE_VIE:
      return withMaturity(fiscalConfig.legalMaturity.assuranceVie, AV_REDUCED_INCOME_TAX_RATE, 'AV_REDUIT');
    // Crypto : flat tax 30 % quelle que soit la durée de détention, pas de notion de maturité.
    case AccountType.CRYPTO: {
      const incomeTax = grossInterest * PFU_INCOME_TAX_RATE;
      return { grossInterest, socialCharges, incomeTax, netInterest: grossInterest - socialCharges - incomeTax, regime: 'PFU' };
    }
    default:
      // Immobilier (paliers d'abattement par durée de détention, distinction résidence
      // principale...), PER (fiscalité dépend du mode de sortie et de la déductibilité à
      // l'entrée) : régimes trop spécifiques pour un calcul fiable ici plutôt qu'un faux net.
      return { grossInterest, socialCharges: 0, incomeTax: 0, netInterest: grossInterest, regime: 'NON_MODELISE' };
  }
};

// --- COMPTE À REBOURS DE MATURITÉ FISCALE (PEA / PEE / Assurance Vie) ---
// Le régime fiscal ne dépend QUE du type de compte et de son ancienneté — pas du montant
// des gains — donc indépendant de `computeCapitalGainsTax` (qui, lui, court-circuite à
// 'PFU' quand `grossInterest` est nul, ce qui serait faux ici pour un compte mature sans
// intérêt renseigné).
const regimeForAge = (type: AccountType, ageYears: number, fiscalConfig: FiscalConfig): CapitalTaxRegime => {
  switch (type) {
    case AccountType.PEA: return ageYears >= fiscalConfig.legalMaturity.pea ? 'EXONERE_IR' : 'PFU';
    case AccountType.PEE: return 'EXONERE_IR';
    case AccountType.ASSURANCE_VIE: return ageYears >= fiscalConfig.legalMaturity.assuranceVie ? 'AV_REDUIT' : 'PFU';
    default: return 'NON_MODELISE';
  }
};

const CAPITAL_INCOME_TAX_RATE: Partial<Record<CapitalTaxRegime, number>> = {
  PFU: PFU_INCOME_TAX_RATE,
  EXONERE_IR: 0,
  AV_REDUIT: AV_REDUCED_INCOME_TAX_RATE,
};

export interface MaturityCountdown {
  maturityDate: string;   // ISO
  monthsRemaining: number; // toujours >= 1 tant que le compte n'est pas mature
  regimeBefore: CapitalTaxRegime;
  regimeAfter: CapitalTaxRegime;
  // Impôt en moins, AU MOMENT D'UN RETRAIT, sur une année de gains (taux × solde du jour)
  // une fois le compte mature — ce n'est pas une économie versée chaque année, la fiscalité
  // étant différée. 0 si le compte ne produit pas encore d'intérêt connu.
  annualTaxSaving: number;
}

/**
 * `null` si : pas de date d'ouverture connue, type de compte sans notion de maturité
 * (Livret réglementé, Crypto, Immobilier, PER...), ou déjà mature — dans tous ces cas, rien
 * à annoncer.
 */
export const computeMaturityCountdown = (
  account: { type: AccountType; openingDate?: string; interestRate?: number; totalAmount: number },
  fiscalConfig: FiscalConfig,
  asOfDate: Date = new Date()
): MaturityCountdown | null => {
  if (!account.openingDate) return null;

  let maturityYears: number | undefined;
  if (account.type === AccountType.PEA) maturityYears = fiscalConfig.legalMaturity.pea;
  else if (account.type === AccountType.ASSURANCE_VIE) maturityYears = fiscalConfig.legalMaturity.assuranceVie;
  else if (account.type === AccountType.PEE) maturityYears = fiscalConfig.legalMaturity.pee;
  if (maturityYears === undefined) return null;

  const opening = parseISODate(account.openingDate);
  const ageYearsNow = accountAgeYears(account.openingDate, asOfDate);
  if (ageYearsNow >= maturityYears) return null; // déjà mature

  // Maturité = date anniversaire (le 5e anniversaire d'un PEA ouvert le 12/03/2021 est le
  // 12/03/2026), et non « ouverture + 5 × 365,25 jours » qui pouvait tomber la veille.
  const maturityDate = new Date(opening.getFullYear() + maturityYears, opening.getMonth(), opening.getDate());
  const monthsRemaining = Math.max(1, Math.ceil((maturityDate.getTime() - asOfDate.getTime()) / (MS_PER_DAY * 30.4375)));

  const regimeBefore = regimeForAge(account.type, ageYearsNow, fiscalConfig);
  // À l'exact instant de maturité, l'ancienneté vaut `maturityYears` par construction : le
  // régime obtenu est donc forcément le régime "mature" de ce type de compte.
  const regimeAfter = regimeForAge(account.type, maturityYears, fiscalConfig);

  const grossInterest = Math.max(0, account.totalAmount * ((account.interestRate || 0) / 100));
  const rateBefore = CAPITAL_INCOME_TAX_RATE[regimeBefore] ?? 0;
  const rateAfter = CAPITAL_INCOME_TAX_RATE[regimeAfter] ?? 0;
  const annualTaxSaving = Math.max(0, grossInterest * (rateBefore - rateAfter));

  return { maturityDate: formatISODay(maturityDate), monthsRemaining, regimeBefore, regimeAfter, annualTaxSaving };
};

/**
 * Taux moyen pondéré par le temps sur l'année civile donnée, à partir de l'historique
 * des changements de taux. Si aucun historique n'est renseigné, retourne simplement
 * le taux courant (comportement identique à avant l'ajout de l'historisation).
 */
export const computeWeightedAnnualRate = (
  currentRate: number,
  rateHistory: RateChange[] | undefined,
  year: number
): number => {
  if (!rateHistory || rateHistory.length === 0) return currentRate;

  const yearStart = Date.UTC(year, 0, 1);
  // Borne EXCLUSIVE au 1er janvier suivant : avec le 31/12 comme borne, une année pleine ne
  // pesait que 364 jours et un changement daté du 31/12 avait un poids nul.
  const yearEnd = Date.UTC(year + 1, 0, 1);
  const now = Date.now();
  const effectiveEnd = Math.min(now, yearEnd);
  // Année encore à venir : rien à pondérer, le taux courant est la seule information.
  if (effectiveEnd <= yearStart) return currentRate;

  // Deux changements à la même date sont contradictoires. On ne garde que la DERNIÈRE saisie
  // du tableau, pour que le résultat ne dépende plus de l'ordre d'un tri stable.
  const lastRateByDate = new Map<string, number>();
  for (const change of rateHistory) lastRateByDate.set(change.date, change.rate);

  const changes = [...lastRateByDate.entries()]
    .map(([date, rate]) => ({ date, rate }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Un changement daté du jour J marque la FIN de validité du taux historisé (l'app stocke
  // l'ANCIEN taux le jour où il est remplacé) : le taux historisé i court donc du changement
  // précédent jusqu'au sien, et le taux COURANT prend le relais depuis le dernier changement
  // jusqu'à la fin de la période — et non depuis aujourd'hui, ce qui lui donnait quelques
  // heures de poids sur l'année en cours et zéro jour sur une année passée.
  const segments = changes.map((change, i) => ({
    // null = "depuis toujours" : le tout premier taux couvre aussi le début de l'année.
    start: i === 0 ? null : Date.parse(changes[i - 1].date),
    end: Date.parse(change.date) as number | null,
    rate: change.rate,
  }));
  segments.push({
    start: Date.parse(changes[changes.length - 1].date),
    end: null,
    rate: currentRate,
  });

  let totalDays = 0;
  let weightedSum = 0;

  for (const segment of segments) {
    const start = Math.max(segment.start ?? -Infinity, yearStart);
    const end = Math.min(segment.end ?? Infinity, effectiveEnd);
    const days = (end - start) / (1000 * 3600 * 24);
    if (days > 0) {
      totalDays += days;
      weightedSum += days * segment.rate;
    }
  }

  return totalDays > 0 ? weightedSum / totalDays : currentRate;
};


// ---------------------------------------------------------------------------
// Versements cumulés et fiscalité d'un retrait
// ---------------------------------------------------------------------------

/** Comptes dont la valeur bouge avec les marchés : on y suit les versements cumulés. */
export const DEPOSIT_TRACKED_TYPES = [AccountType.PEA, AccountType.ASSURANCE_VIE, AccountType.PEE, AccountType.PER, AccountType.CRYPTO];
export const tracksDeposits = (type: AccountType) => DEPOSIT_TRACKED_TYPES.includes(type);

/** Plafond légal des VERSEMENTS sur un PEA (la valorisation peut le dépasser). */
export const PEA_DEPOSIT_CEILING = 150_000;
/** Abattement annuel sur les gains d'Assurance Vie de plus de 8 ans (personne seule). */
export const AV_ANNUAL_ALLOWANCE = 4_600;

/**
 * Versements cumulés après un retrait de `amount` : un retrait emporte versements et gains
 * au prorata de leur poids dans la valeur (règle fiscale des rachats partiels).
 */
export const depositsAfterWithdrawal = (totalDeposits: number, value: number, amount: number): number =>
  value <= 0 ? totalDeposits : Math.max(0, totalDeposits * (1 - Math.min(1, amount / value)));

// Cessions de crypto-actifs exonérées si leur total annuel ne dépasse pas 305 € (art. 150 VH bis).
export const CRYPTO_EXEMPT_DISPOSALS = 305;

export interface WithdrawalTax {
  known: boolean;        // false : versements cumulés inconnus, ou fiscalité non modélisée
  gainPart: number;      // part de gains contenue dans le montant retiré
  socialCharges: number;
  incomeTax: number;
  net: number;           // ce qui arrive réellement sur le compte courant
  closesPea: boolean;    // retrait d'un PEA de moins de 5 ans : le plan est clôturé
}

/**
 * Impôt dû sur un retrait de `amount`. Seule la part de gains est imposée :
 * gains retirés = montant × (valeur − versements) / valeur.
 * - PEA : prélèvements sociaux (18,6 % en 2026), IR exonéré après 5 ans ; PEE : toujours exonéré d'IR ;
 * - Assurance Vie : IR à 7,5 % après 8 ans, sur la part de gains au-delà de l'abattement
 *   annuel (4 600 €, supposé non entamé cette année) ; PFU avant 8 ans. Sur un fonds euros,
 *   les prélèvements sociaux sont en réalité déjà retenus chaque année : on les compte ici
 *   quand même (cas prudent, et exact pour les unités de compte) ;
 * - Crypto : PFU (31,4 % en 2026) sur la part de plus-value ;
 * - autres (PER, immobilier…) : non modélisé.
 */
export const computeWithdrawalTax = (
  account: { type: AccountType; openingDate?: string; totalAmount: number; totalDeposits?: number; euroFundPct?: number },
  amount: number,
  fiscalConfig: FiscalConfig,
  asOfDate: Date = new Date()
): WithdrawalTax => {
  const ageYears = account.openingDate
    ? accountAgeYears(account.openingDate, asOfDate)
    : 0;
  const closesPea = account.type === AccountType.PEA && ageYears < fiscalConfig.legalMaturity.pea;
  const unknown: WithdrawalTax = { known: false, gainPart: 0, socialCharges: 0, incomeTax: 0, net: amount, closesPea };
  const modeled = [AccountType.PEA, AccountType.PEE, AccountType.ASSURANCE_VIE, AccountType.CRYPTO].includes(account.type);
  if (!modeled || account.totalDeposits === undefined || account.totalAmount <= 0) return unknown;

  const gainRatio = Math.max(0, (account.totalAmount - account.totalDeposits) / account.totalAmount);
  const gainPart = Math.min(amount, account.totalAmount) * gainRatio;
  // Fonds euros d'une assurance vie : prélèvements sociaux déjà payés chaque année.
  const psShare = account.type === AccountType.ASSURANCE_VIE && account.euroFundPct !== undefined
    ? Math.max(0, Math.min(1, 1 - account.euroFundPct / 100)) : 1;
  // Crypto : cessions de l'année jusqu'à 305 € exonérées (on suppose que ce retrait est la seule).
  if (account.type === AccountType.CRYPTO && amount <= CRYPTO_EXEMPT_DISPOSALS) {
    return { known: true, gainPart, socialCharges: 0, incomeTax: 0, net: amount, closesPea };
  }
  const socialCharges = gainPart * psShare * socialChargesRateFor(account.type, fiscalConfig);
  let incomeTax: number;
  switch (account.type) {
    case AccountType.PEA:
      incomeTax = closesPea ? gainPart * PFU_INCOME_TAX_RATE : 0; break;
    case AccountType.PEE:
      incomeTax = 0; break;
    case AccountType.ASSURANCE_VIE:
      incomeTax = ageYears >= fiscalConfig.legalMaturity.assuranceVie
        ? Math.max(0, gainPart - AV_ANNUAL_ALLOWANCE) * AV_REDUCED_INCOME_TAX_RATE
        : gainPart * PFU_INCOME_TAX_RATE;
      break;
    default:
      incomeTax = gainPart * PFU_INCOME_TAX_RATE;
  }
  return { known: true, gainPart, socialCharges, incomeTax, net: amount - socialCharges - incomeTax, closesPea };
};

// ---------------------------------------------------------------------------
// Coût de déblocage de l'épargne « sous contrainte fiscale »
// ---------------------------------------------------------------------------

export interface UnlockCost {
  extraTax: number;          // impôt en plus d'un retrait aujourd'hui, par rapport à après la maturité
  unknown: string[];         // comptes dont on ignore les versements (coût non calculable)
  closesPea: boolean;        // un retrait clôturerait un PEA de moins de 5 ans
  nextFree?: { date: string; name: string }; // prochaine maturité atteinte
}

/**
 * Pour les PEA et Assurances Vie pas encore matures : ce que coûterait de TOUT retirer
 * aujourd'hui plutôt qu'après la maturité (seul l'impôt sur le revenu change, les
 * prélèvements sociaux sont dus dans les deux cas), et quand cet argent devient libre.
 */
export const computeUnlockCost = (
  accounts: SavingsAccount[],
  fiscalConfig: FiscalConfig,
  asOfDate: Date = new Date()
): UnlockCost => {
  const out: UnlockCost = { extraTax: 0, unknown: [], closesPea: false };
  for (const a of accounts) {
    if (a.type !== AccountType.PEA && a.type !== AccountType.ASSURANCE_VIE) continue;
    if (a.ownedAmount <= 0) continue;
    const maturity = computeMaturityCountdown(a, fiscalConfig, asOfDate);
    if (!maturity) continue; // déjà mature, ou date d'ouverture inconnue
    if (!out.nextFree || maturity.maturityDate < out.nextFree.date) out.nextFree = { date: maturity.maturityDate, name: a.name };
    const now = computeWithdrawalTax(a, a.ownedAmount, fiscalConfig, asOfDate);
    if (now.closesPea) out.closesPea = true;
    if (!now.known) { out.unknown.push(a.name); continue; }
    const later = computeWithdrawalTax(a, a.ownedAmount, fiscalConfig, parseISODate(maturity.maturityDate));
    out.extraTax += Math.max(0, now.incomeTax - later.incomeTax);
  }
  return out;
};
