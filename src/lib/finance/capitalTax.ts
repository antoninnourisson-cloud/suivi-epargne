// Fiscalité du capital : PFU, maturités, retraits, coût de déblocage.
// Partie de src/lib/finance.ts (qui réexporte tout) : importez depuis '../finance'.
import { FiscalConfig, RateChange, AccountType, SavingsAccount, AccountMovement } from '../../types';
import { MS_PER_DAY, formatISODay, parseISODate } from '../dates';
import { socialChargesRateFor } from './income';
import { isSavingsFlow } from './savings';

// --- FISCALITÉ DU CAPITAL (PFU / prélèvements sociaux) ---
// Le régime le plus courant par type de compte — volontairement simplifié, pas une simulation
// fiscale complète (voir les limites documentées sur chaque cas).
//
// ATTENTION au sens du résultat : PEA et Assurance Vie sont à fiscalité DIFFÉRÉE — l'impôt
// n'est dû qu'au retrait, pas chaque année. Ce calcul donne donc le net qu'on toucherait EN
// RETIRANT les gains, jamais un montant « à déclarer » pour l'année.
// Part « impôt sur le revenu » du PFU : 12,8 %, plus les prélèvements sociaux (18,6 % en 2026,
// 17,2 % sur l'assurance vie), soit 31,4 % (30 % sur l'assurance vie). Vérifié le 2026-10-14 :
// https://www.impots.gouv.fr/particulier/questions/jai-realise-une-plus-value-mobiliere-comment-est-elle-imposee
// https://www.service-public.gouv.fr/particuliers/vosdroits/F2329 (prélèvements sociaux 2026)
export const PFU_INCOME_TAX_RATE = 0.128;
// Taux réduit d'IR sur les gains d'Assurance Vie après 8 ans (art. 125-0 A du CGI), HORS
// abattement annuel de 4 600 €/9 200 € : celui-ci porte sur l'ensemble des contrats d'une
// personne (pas par compte) et dépend de versements antérieurs au 27/09/2017 — non modélisable
// ici sans ces informations. Le net réel après 8 ans est donc, dans la pratique, souvent
// LÉGÈREMENT MEILLEUR que ce que ce calcul affiche pour de petits montants de gains annuels.
// Source (vérifiée le 2026-10-14) : https://www.service-public.gouv.fr/particuliers/vosdroits/F22414
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

/** Épargne logement ouverte avant cette date : ancien régime (exonération d'impôt sur le revenu). */
const HOUSING_SAVINGS_REFORM = '2018-01-01';
/** PEL ouvert avant 2018 : intérêts des 12 premières années sans impôt sur le revenu. */
const OLD_PEL_EXEMPT_YEARS = 12;

/**
 * Intérêts d'un PEL ou d'un CEL exonérés d'impôt sur le revenu à `asOfDate` (prélèvements
 * sociaux toujours dus). Vérifié le 2026-10-21 :
 * - PEL ouvert depuis le 1er janvier 2018 : imposé chaque année (PFU) ; ouvert avant : intérêts
 *   des 12 premières années exonérés, https://www.service-public.gouv.fr/particuliers/vosdroits/F16140
 * - CEL ouvert depuis 2018 : imposé (PFU) ; ouvert avant : exonéré,
 *   https://www.service-public.gouv.fr/particuliers/vosdroits/F16136
 * Date d'ouverture inconnue : jamais d'exonération non prouvée (imposé, par prudence).
 */
export const isHousingSavingsIncomeTaxExempt = (account: { type: AccountType; openingDate?: string }, asOfDate: Date = new Date()): boolean => {
  if (!account.openingDate || account.openingDate >= HOUSING_SAVINGS_REFORM) return false;
  if (account.type === AccountType.CEL) return true;
  if (account.type === AccountType.PEL) return accountAgeYears(account.openingDate, asOfDate) < OLD_PEL_EXEMPT_YEARS;
  return false;
};

/**
 * Comptes dont les intérêts sont imposés CHAQUE ANNÉE (et non au retrait) : livret bancaire,
 * compte à terme, épargne logement, compte courant rémunéré, « Autre ». La banque retient
 * l'acompte de 12,8 % au versement des intérêts.
 */
const YEARLY_TAXED_INTEREST_TYPES: readonly AccountType[] = [
  AccountType.LIVRET_BANCAIRE, AccountType.COMPTE_A_TERME, AccountType.PEL, AccountType.CEL, AccountType.COMPTE_COURANT, AccountType.AUTRE,
];

/** Intérêts de l'année soumis à l'impôt sur le revenu (PFU) : type imposé chaque année, hors exonération d'épargne logement. */
export const hasTaxableYearlyInterest = (account: { type: AccountType; openingDate?: string }, asOfDate: Date = new Date()): boolean =>
  YEARLY_TAXED_INTEREST_TYPES.includes(account.type) && !isHousingSavingsIncomeTaxExempt(account, asOfDate);

/**
 * Part des gains d'une assurance vie encore soumise aux prélèvements sociaux au retrait :
 * ceux du fonds euros sont prélevés chaque année par l'assureur, à l'inscription des
 * intérêts au contrat ; ceux des unités de compte, au retrait. Vérifié le 2026-10-21 :
 * https://www.service-public.gouv.fr/particuliers/vosdroits/F15274
 * Répartition inconnue : tout est compté (prudent). Autres comptes : 1.
 */
export const socialChargesShareAtWithdrawal = (account: { type: AccountType; euroFundPct?: number }): number =>
  account.type === AccountType.ASSURANCE_VIE && account.euroFundPct !== undefined && Number.isFinite(account.euroFundPct)
    ? Math.max(0, Math.min(1, 1 - account.euroFundPct / 100)) : 1;

export const computeCapitalGainsTax = (
  account: { type: AccountType; openingDate?: string; euroFundPct?: number },
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

  // Assurance vie : les prélèvements sociaux du fonds euros sont déjà payés chaque année.
  const socialCharges = grossInterest * socialChargesShareAtWithdrawal(account) * socialChargesRateFor(account.type, fiscalConfig);

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
    // Crypto et compte-titres : PFU quelle que soit la durée de détention, pas de maturité.
    // Livret bancaire, compte à terme, compte courant, « Autre » : intérêts au PFU chaque année.
    case AccountType.CRYPTO:
    case AccountType.CTO:
    case AccountType.LIVRET_BANCAIRE:
    case AccountType.COMPTE_A_TERME:
    case AccountType.COMPTE_COURANT:
    case AccountType.AUTRE: {
      const incomeTax = grossInterest * PFU_INCOME_TAX_RATE;
      return { grossInterest, socialCharges, incomeTax, netInterest: grossInterest - socialCharges - incomeTax, regime: 'PFU' };
    }
    // PEL, CEL : PFU, sauf ancien régime (ouverts avant 2018) exonéré d'impôt sur le revenu.
    case AccountType.PEL:
    case AccountType.CEL: {
      const exempt = isHousingSavingsIncomeTaxExempt(account, asOfDate);
      const incomeTax = exempt ? 0 : grossInterest * PFU_INCOME_TAX_RATE;
      return { grossInterest, socialCharges, incomeTax, netInterest: grossInterest - socialCharges - incomeTax, regime: exempt ? 'EXONERE_IR' : 'PFU' };
    }
    default:
      // Immobilier (paliers d'abattement par durée de détention, distinction résidence
      // principale...), PER (fiscalité dépend du mode de sortie et de la déductibilité à
      // l'entrée) : régimes trop spécifiques pour un calcul fiable ici plutôt qu'un faux net.
      return { grossInterest, socialCharges: 0, incomeTax: 0, netInterest: grossInterest, regime: 'NON_MODELISE' };
  }
};

// --- COMPTE À REBOURS DE MATURITÉ FISCALE (PEA / Assurance Vie) ---
// Le régime fiscal ne dépend QUE du type de compte et de son ancienneté — pas du montant
// des gains — donc indépendant de `computeCapitalGainsTax` (qui, lui, court-circuite à
// 'PFU' quand `grossInterest` est nul, ce qui serait faux ici pour un compte mature sans
// intérêt renseigné).
// Le PEE n'a PAS de maturité fiscale : ses gains sont toujours exonérés d'impôt sur le
// revenu. Ce qui compte pour lui, c'est le blocage de 5 ans de CHAQUE versement : voir
// computePeeAvailability (./availability).
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
 * fiscale (Livret réglementé, PEE toujours exonéré d'IR, Crypto, Immobilier, PER...), ou
 * déjà mature — dans tous ces cas, rien à annoncer.
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

const percentFr = (fraction: number) => `${(Math.round(fraction * 1000) / 10).toLocaleString('fr-FR')} %`;

/**
 * Ce que change la maturité, en mots simples (badge de « Mes comptes », agenda). Les
 * prélèvements sociaux restent dus après la maturité : on le dit, pour ne pas laisser
 * croire qu'un retrait ne coûtera plus rien.
 */
export const describeMaturity = (
  account: { type: AccountType },
  maturity: Pick<MaturityCountdown, 'monthsRemaining' | 'regimeAfter'>,
  fiscalConfig: FiscalConfig
): { short: string; detail: string } => {
  const months = `${maturity.monthsRemaining} mois`;
  const social = percentFr(socialChargesRateFor(account.type, fiscalConfig));
  if (maturity.regimeAfter === 'EXONERE_IR') {
    return {
      short: `Sans impôt sur le revenu dans ${months}`,
      detail: `Gains sans impôt sur le revenu ; les prélèvements sociaux (${social}) restent dus au retrait`,
    };
  }
  return {
    short: `Impôt réduit dans ${months}`,
    detail: `Impôt sur le revenu réduit à ${percentFr(AV_REDUCED_INCOME_TAX_RATE)} au-delà de ${AV_ANNUAL_ALLOWANCE.toLocaleString('fr-FR')} € de gains retirés par an ; prélèvements sociaux (${social}) toujours dus`,
  };
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
  // jusqu'à la fin de la période — et non depuis aujourd'hui, ce qui lui donnerait quelques
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
const DEPOSIT_TRACKED_TYPES = [AccountType.PEA, AccountType.CTO, AccountType.ASSURANCE_VIE, AccountType.PEE, AccountType.PER, AccountType.CRYPTO];
export const tracksDeposits = (type: AccountType) => DEPOSIT_TRACKED_TYPES.includes(type);

/** Plafond légal des VERSEMENTS sur un PEA (la valorisation peut le dépasser). */
export const PEA_DEPOSIT_CEILING = 150_000;
/** Abattement annuel sur les gains d'Assurance Vie de plus de 8 ans (personne seule ;
 *  9 200 € pour un couple). https://www.service-public.gouv.fr/particuliers/vosdroits/F22414 */
const AV_ANNUAL_ALLOWANCE = 4_600;
/** Primes (versements) au-delà desquelles les gains d'une AV de plus de 8 ans passent de
 *  7,5 % à 12,8 %. Même source (vérifiée le 2026-10-14). */
const AV_REDUCED_RATE_PREMIUM_CAP = 150_000;

/**
 * Versements cumulés après un retrait de `amount` : un retrait emporte versements et gains
 * au prorata de leur poids dans la valeur (règle fiscale des rachats partiels :
 * gains = retrait − versements × retrait / valeur du contrat, BOFiP BOI-RPPM-RCM-20-10-20-50
 * https://bofip.impots.gouv.fr/bofip/3951-PGP.html/identifiant%3DBOI-RPPM-RCM-20-10-20-50-20191220).
 */
export const depositsAfterWithdrawal = (totalDeposits: number, value: number, amount: number): number =>
  value <= 0 ? totalDeposits : Math.max(0, totalDeposits * (1 - Math.min(1, amount / value)));

/**
 * Cessions de crypto-actifs exonérées si le TOTAL des prix de cession de l'année du foyer ne
 * dépasse pas 305 € (art. 150 VH bis du CGI). Au-delà, toute la plus-value de l'année est
 * imposable. Vérifié le 2026-10-21 : brochure pratique IR 2026, plus-values, p. 137-156
 * (« la somme des prix n'excède pas 305 € au cours d'une année d'imposition »),
 * https://www.impots.gouv.fr/www2/fichiers/documentation/brochure/ir_2026/pdf_som/09-plus_values_137a156.pdf
 * et (2026-10-22) https://www.impots.gouv.fr/particulier/questions/comment-declarer-les-plus-ou-moins-values-sur-cessions-dactifs-numeriques
 * (somme des prix de cession de l'année, pas des gains, appréciée pour tout le foyer).
 */
export const CRYPTO_EXEMPT_DISPOSALS = 305;

/**
 * Retraits de crypto de l'année civile `year` (votre part : ni capital des parents, ni
 * correction, ni valorisation, ni solde initial), avant `beforeISO` si donné. Un retrait
 * vers votre compte en banque suppose une vente : c'est l'indice de cession dont dispose l'app.
 */
export const cryptoDisposalsOfYear = (
  accounts: { type: AccountType; movements: AccountMovement[] }[],
  year: number,
  beforeISO?: string,
): number => accounts
  .filter(a => a.type === AccountType.CRYPTO)
  .reduce((s, a) => s + a.movements
    .filter(m => m.type === 'OUT' && isSavingsFlow(m) && m.date.startsWith(`${year}-`) && (!beforeISO || m.date < beforeISO))
    .reduce((t, m) => t + m.amount, 0), 0);

/** Seuil des 305 € de ventes de crypto de l'année : déjà dépassé, ou dépassé avec ce retrait. */
export type CryptoThreshold = 'already-past' | 'with-this-sale';

export interface WithdrawalTax {
  known: boolean;        // false : versements cumulés inconnus, ou fiscalité non modélisée
  gainPart: number;      // part de gains contenue dans le montant retiré
  /**
   * Part des gains soumise à l'impôt sur le revenu (après l'abattement de l'assurance vie de
   * plus de 8 ans ; 0 si exonérée) : la base qu'imposerait le barème en cas d'option.
   */
  taxableGain: number;
  socialCharges: number;
  incomeTax: number;
  net: number;           // ce qui vous reste du retrait, impôt de l'année réglé
  closesPea: boolean;    // retrait d'un PEA de moins de 5 ans : le plan est clôturé
  /**
   * Crypto, quand des ventes ont déjà eu lieu cette année : 'already-past', elles dépassent
   * déjà 305 € à elles seules ; 'with-this-sale', c'est ce retrait qui ferait passer le total
   * au-delà. Dans les deux cas l'exonération est perdue pour toute l'année (la plus-value des
   * ventes précédentes devient imposable aussi, ce que ce calcul ne chiffre pas). Absent sans
   * vente antérieure : le retrait seul est alors exonéré ou imposé, sans surprise.
   */
  cryptoThreshold?: CryptoThreshold;
}

/**
 * Impôt dû sur un retrait de `amount`. Seule la part de gains est imposée :
 * gains retirés = montant × (valeur − versements) / valeur (BOFiP, voir plus haut).
 * - PEA : prélèvements sociaux (18,6 % en 2026), IR exonéré après 5 ans ; PEE : toujours exonéré d'IR ;
 * - Assurance Vie (versements faits depuis le 27/09/2017, cas supposé) : avant 8 ans, PFU de
 *   12,8 % ; après 8 ans, abattement annuel de 4 600 € (supposé non entamé cette année), puis
 *   7,5 % sur les gains liés aux 150 000 premiers euros de versements et 12,8 % au-delà,
 *   l'abattement s'imputant d'abord sur la part à 7,5 % (BOFiP BOI-RPPM-RCM-20-10-20-50).
 *   Le seuil de 150 000 € porte sur tous les contrats de la personne : on ne connaît ici que
 *   ceux de ce contrat. L'assureur retient 7,5 % le jour du retrait et l'abattement est rendu
 *   avec la déclaration : `incomeTax` est l'impôt final de l'année. Prélèvements sociaux :
 *   17,2 %. Sur un fonds euros, ils sont déjà retenus chaque année (`euroFundPct`) ;
 * - Crypto, compte-titres : PFU (31,4 % en 2026) sur la part de plus-value ; crypto
 *   exonérée tant que les ventes de l'année, celle-ci comprise, ne dépassent pas 305 € au
 *   total (`opts.cryptoDisposalsThisYear` : ventes déjà faites dans l'année civile) ;
 * - autres (PER, immobilier…) : non modélisé.
 */
export const computeWithdrawalTax = (
  account: { type: AccountType; openingDate?: string; totalAmount: number; totalDeposits?: number; euroFundPct?: number },
  amount: number,
  fiscalConfig: FiscalConfig,
  asOfDate: Date = new Date(),
  opts: { cryptoDisposalsThisYear?: number } = {},
): WithdrawalTax => {
  const ageYears = account.openingDate
    ? accountAgeYears(account.openingDate, asOfDate)
    : 0;
  const closesPea = account.type === AccountType.PEA && ageYears < fiscalConfig.legalMaturity.pea;
  const unknown: WithdrawalTax = { known: false, gainPart: 0, taxableGain: 0, socialCharges: 0, incomeTax: 0, net: amount, closesPea };
  const modeled = [AccountType.PEA, AccountType.PEE, AccountType.ASSURANCE_VIE, AccountType.CRYPTO, AccountType.CTO].includes(account.type);
  if (!modeled || account.totalDeposits === undefined || account.totalAmount <= 0) return unknown;

  const gainRatio = Math.max(0, (account.totalAmount - account.totalDeposits) / account.totalAmount);
  const gainPart = Math.min(amount, account.totalAmount) * gainRatio;
  // Fonds euros d'une assurance vie : prélèvements sociaux déjà payés chaque année.
  const psShare = socialChargesShareAtWithdrawal(account);
  // Crypto : exonération si le total des ventes de l'année, celle-ci comprise, reste sous 305 €.
  const earlierCrypto = account.type === AccountType.CRYPTO ? Math.max(0, opts.cryptoDisposalsThisYear ?? 0) : 0;
  if (account.type === AccountType.CRYPTO && earlierCrypto + amount <= CRYPTO_EXEMPT_DISPOSALS) {
    return { known: true, gainPart, taxableGain: 0, socialCharges: 0, incomeTax: 0, net: amount, closesPea };
  }
  const threshold: { cryptoThreshold?: CryptoThreshold } = earlierCrypto > CRYPTO_EXEMPT_DISPOSALS
    ? { cryptoThreshold: 'already-past' }
    : earlierCrypto > 0 ? { cryptoThreshold: 'with-this-sale' } : {};
  const socialCharges = gainPart * psShare * socialChargesRateFor(account.type, fiscalConfig);
  let incomeTax: number;
  let taxableGain = gainPart;
  switch (account.type) {
    case AccountType.PEA:
      taxableGain = closesPea ? gainPart : 0;
      incomeTax = taxableGain * PFU_INCOME_TAX_RATE; break;
    case AccountType.PEE:
      taxableGain = 0;
      incomeTax = 0; break;
    case AccountType.ASSURANCE_VIE: {
      if (ageYears < fiscalConfig.legalMaturity.assuranceVie) { incomeTax = gainPart * PFU_INCOME_TAX_RATE; break; }
      // Gains liés aux 150 000 premiers euros de versements : 7,5 % ; le reste : 12,8 %.
      const reducedShare = account.totalDeposits > AV_REDUCED_RATE_PREMIUM_CAP ? AV_REDUCED_RATE_PREMIUM_CAP / account.totalDeposits : 1;
      const reducedPart = gainPart * reducedShare;
      const fullPart = gainPart - reducedPart;
      // L'abattement s'impute d'abord sur la part à 7,5 %, le reliquat sur la part à 12,8 %.
      const onReduced = Math.min(reducedPart, AV_ANNUAL_ALLOWANCE);
      const onFull = Math.min(fullPart, AV_ANNUAL_ALLOWANCE - onReduced);
      taxableGain = gainPart - onReduced - onFull;
      incomeTax = (reducedPart - onReduced) * AV_REDUCED_INCOME_TAX_RATE + (fullPart - onFull) * PFU_INCOME_TAX_RATE;
      break;
    }
    default:
      incomeTax = gainPart * PFU_INCOME_TAX_RATE;
  }
  return { known: true, gainPart, taxableGain, socialCharges, incomeTax, net: amount - socialCharges - incomeTax, closesPea, ...threshold };
};

/** Ce que l'écran Rendement affiche pour « retirer les gains de l'année ». */
export interface GainsWithdrawal extends CapitalTaxBreakdown {
  /** Part soumise à l'impôt sur le revenu (base du barème en cas d'option). */
  taxableGain: number;
  /** true : vrai retrait au prorata (versements cumulés connus) ; false : estimation simplifiée. */
  proRata: boolean;
  cryptoThreshold?: CryptoThreshold;
}

/**
 * Net d'un retrait égal aux gains `grossInterest` de l'année. Quand les versements cumulés
 * d'un placement (PEA, assurance vie, PEE, compte-titres, crypto) sont connus, c'est un vrai
 * retrait de ce montant : seule sa part de gains est imposée, au prorata de la valeur du
 * contrat (BOFiP BOI-RPPM-RCM-20-10-20-50, voir depositsAfterWithdrawal), avec l'abattement
 * de l'assurance vie de plus de 8 ans et les prélèvements sociaux du fonds euros déjà payés.
 * Sinon (livrets fiscalisés, versements inconnus) : tout le montant est compté comme un gain
 * (computeCapitalGainsTax).
 */
export const computeGainsWithdrawal = (
  account: { type: AccountType; openingDate?: string; totalAmount: number; totalDeposits?: number; euroFundPct?: number },
  grossInterest: number,
  fiscalConfig: FiscalConfig,
  asOfDate: Date = new Date(),
  opts: { cryptoDisposalsThisYear?: number } = {},
): GainsWithdrawal => {
  const simple = computeCapitalGainsTax(account, grossInterest, fiscalConfig, asOfDate);
  const simpleTaxable = simple.incomeTax > 0 ? grossInterest : 0;
  if (grossInterest <= 0 || simple.regime === 'NON_MODELISE') return { ...simple, taxableGain: simpleTaxable, proRata: false };
  const w = computeWithdrawalTax(account, grossInterest, fiscalConfig, asOfDate, opts);
  if (!w.known) return { ...simple, taxableGain: simpleTaxable, proRata: false };
  return {
    grossInterest, socialCharges: w.socialCharges, incomeTax: w.incomeTax, netInterest: w.net,
    regime: simple.regime, taxableGain: w.taxableGain, proRata: true,
    ...(w.cryptoThreshold ? { cryptoThreshold: w.cryptoThreshold } : {}),
  };
};

// ---------------------------------------------------------------------------
// Option pour le barème (au lieu du taux forfaitaire de 12,8 %)
// ---------------------------------------------------------------------------

/**
 * Impôt sur le revenu au barème, si le foyer choisit l'option : chaque euro imposable l'est
 * à la tranche du foyer au lieu du taux forfaitaire (12,8 %, 7,5 % pour une assurance vie de
 * plus de 8 ans). Approximation : un gros gain peut faire passer une partie du revenu dans la
 * tranche suivante, et l'option rend 6,8 points de CSG déductibles l'année suivante.
 * Vérifié le 2026-10-21 et le 2026-10-22 :
 * - l'option est expresse, irrévocable et GLOBALE : elle vaut pour tous les revenus et
 *   plus-values de placement de l'année (case 2OP), BOFiP BOI-RPPM-RCM-20-15-20191220,
 *   https://bofip.impots.gouv.fr/bofip/11224-PGP.html/identifiant=BOI-RPPM-RCM-20-15-20191220 ;
 *   aide officielle de la déclaration 2026 (« l'option est globale : elle porte sur l'ensemble
 *   des revenus de capitaux mobiliers, des plus-values… »),
 *   https://simulateur-ir-ifi.impots.gouv.fr/calcul_impot/2026/aides/capitaux_mobiliers.htm ;
 * - CSG déductible seulement en cas d'option pour le barème :
 *   https://www.service-public.gouv.fr/particuliers/vosdroits/F2329 ;
 * - plus-values de crypto : option distincte, globale pour toutes ces plus-values (case 3CN),
 *   brochure IR 2026, p. 137-156 (lien de CRYPTO_EXEMPT_DISPOSALS).
 * `null` si l'option ne peut pas coûter moins : tranche au-dessus du taux forfaitaire.
 */
export const compareProgressiveOption = (
  items: { incomeTax: number; taxableGain: number }[],
  marginalRate: number,
): { flat: number; progressive: number; saving: number } | null => {
  if (!(marginalRate >= 0) || marginalRate >= PFU_INCOME_TAX_RATE) return null;
  const flat = items.reduce((s, i) => s + Math.max(0, i.incomeTax), 0);
  const progressive = items.reduce((s, i) => s + Math.max(0, i.taxableGain) * marginalRate, 0);
  const saving = flat - progressive;
  return saving >= 0.5 ? { flat, progressive, saving } : null;
};

export interface ProgressiveOptionAdvice {
  /** Tranche du foyer (fraction : 0 ou 0,11), sous le taux forfaitaire de 12,8 %. */
  marginalRate: number;
  /** Placements (intérêts, assurance vie, PEA, compte-titres) : option de la case 2OP. */
  securities: { flat: number; progressive: number; saving: number } | null;
  /** Plus-values de crypto : leur propre option (case 3CN), indépendante de la 2OP. */
  crypto: { flat: number; progressive: number; saving: number } | null;
}

/**
 * L'option pour le barème coûterait-elle moins que le taux forfaitaire pour ces retraits ?
 * `marginalRate` : tranche estimée du foyer (lib/retirement, marginalTaxRate). Crypto à part :
 * son option (case 3CN) est indépendante de la case 2OP (aide officielle de la déclaration,
 * lien plus haut). `null` : tranche inconnue, trop haute, ou aucun gain à y gagner.
 */
export const adviseProgressiveOption = (
  items: { type: AccountType; incomeTax: number; taxableGain: number }[],
  marginalRate: number | undefined,
): ProgressiveOptionAdvice | null => {
  if (marginalRate === undefined) return null;
  const securities = compareProgressiveOption(items.filter(i => i.type !== AccountType.CRYPTO), marginalRate);
  const crypto = compareProgressiveOption(items.filter(i => i.type === AccountType.CRYPTO), marginalRate);
  return securities || crypto ? { marginalRate, securities, crypto } : null;
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
