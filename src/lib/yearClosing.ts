// ================================================
// FILE: src/lib/yearClosing.ts
// Clôture de l'année : une seule liste ordonnée au lieu d'une dizaine de rappels épars en
// janvier. Proposée du 1er janvier à fin février (Accueil, agenda, une notification), et à
// tout moment depuis l'Historique, pour l'année écoulée :
//   1. soldes vérifiés au 31 décembre (fraîcheur compte par compte, lib/freshness) ;
//   2. intérêts crédités au 31 décembre, enregistrés hors épargne (suggestCreditedInterest,
//      la même proposition qu'« Actualiser ») ;
//   3. relevés annuels des placements (valeur, versements, taux servi du fonds euros) ;
//   4. restitution du capital des parents, tant qu'il en reste (sinon l'étape disparaît) ;
//   5. « Votre année » ; 6. ce qu'il faut préparer pour la déclaration du printemps ;
//   7. paramètres fiscaux de la nouvelle année (barème, plafond LEP, abattement) ;
//   8. archive de l'année sur l'appareil (JSON + CSV) ; 9. clôture.
// Chaque étape est « faite » d'après les données quand l'app peut le constater, sinon cochée à
// la main ; coches et date de clôture vivent dans le fichier (`config.yearClosings`), donc sur
// tous les appareils. Fonctions pures, testées, partagées par l'app et le serveur de
// notifications.
// ================================================
import { AccountType, type AccountMovement, type GlobalAppData, type SavingsAccount, type YearClosingRecord } from '../types';
import {
  computeAccruedInterest, computeAccruedParentalInterest, computeDonationSummary, findFiscalReview, isInitialBalance, isRateReviewedSince,
  ownedAmountAt, suggestCreditedInterest, INTEREST_CREDITED_DEC31_TYPES,
} from './finance';
import { DEFAULT_FISCAL_CONFIG } from '../constants';
import { freshnessLimitDays, lastBalanceCheck } from './freshness';
import { buildTaxReturnChecklist, listFr, taxReturnTopics } from './taxReturn';
import { hasParentalCapital } from './parentalMode';
import { formatISODay, parseISODate } from './dates';
import { formatEUR, frenchDay } from './format';
import { csvAmount, type CsvCell } from './csv';
import { round2, signedAmount } from './money';

export type YearClosingStepId = 'balances' | 'interest' | 'statements' | 'restitution' | 'review' | 'tax-return' | 'fiscal-params' | 'archive' | 'close';
type Config = GlobalAppData['config'];
export type YearClosings = Record<string, YearClosingRecord>;

/**
 * Coches à la main (enregistrées dans `checked`). Le « Taux inchangé » d'une assurance vie
 * n'en est pas une : il est noté sur le compte (`rateReviewedAt`), comme depuis l'Accueil.
 */
export const CLOSING_CHECKS = {
  interest: 'interest',
  review: 'review',
  taxReturn: 'tax-return',
  archiveJson: 'archive-json',
  archiveCsv: 'archive-csv',
} as const;

/** Ce que fait un bouton de la clôture ; l'écran relie chaque action à son gestionnaire. */
export type YearClosingAction =
  | { type: 'navigate'; view: 'update' | 'accounts' | 'parental' | 'settings' }
  | { type: 'show-tax-return' }
  /** Taux servi de l'assurance vie inchangé : noté sur le compte (`rateReviewedAt`). */
  | { type: 'confirm-rate'; accountId: string }
  | { type: 'apply-tax-scale' }
  /** Paramètres fiscaux de la nouvelle année vérifiés (`paramsReviewedYear`). */
  | { type: 'confirm-fiscal-params'; year: number }
  | { type: 'open-review' }
  | { type: 'download-json' }
  | { type: 'download-csv' }
  | { type: 'close' }
  | { type: 'reopen' };

export interface YearClosingButton { label: string; action: YearClosingAction }

export interface YearClosingItem {
  key: string;
  label: string;
  detail: string;
  done: boolean;
  /** Bouton propre à la ligne (« Taux inchangé », « Appliquer », téléchargement). */
  button?: YearClosingButton;
}

export interface YearClosingStep {
  id: YearClosingStepId;
  title: string;
  detail: string;
  done: boolean;
  /** Coche à la main proposée (étape que l'app ne peut pas, ou pas toujours, constater). */
  check?: { key: string; label: string; checked: boolean };
  items: YearClosingItem[];
  buttons: YearClosingButton[];
}

export interface YearClosing {
  year: number;
  closedOn?: string;
  steps: YearClosingStep[];
  /** Étapes faites et à faire, hors la clôture elle-même. */
  done: number;
  total: number;
}

// ---------------------------------------------------------------------------
// Saison, enregistrement
// ---------------------------------------------------------------------------

/** Du 1er janvier à la fin de février : la clôture est proposée sur l'Accueil. */
export const isClosingSeason = (now: Date): boolean => now.getMonth() <= 1;

/** Année à clôturer : toujours l'année écoulée. */
export const closingYearOf = (now: Date): number => now.getFullYear() - 1;

const closingRecordOf = (config: Pick<Config, 'yearClosings'> | undefined, year: number): YearClosingRecord =>
  config?.yearClosings?.[String(year)] ?? {};

export const isYearClosed = (config: Pick<Config, 'yearClosings'> | undefined, year: number): boolean =>
  !!closingRecordOf(config, year).closedOn;

const withRecord = (closings: YearClosings | undefined, year: number, update: (r: YearClosingRecord) => YearClosingRecord): YearClosings => {
  const key = String(year);
  const next = update({ ...(closings?.[key] ?? {}) });
  if (next.checked && next.checked.length === 0) delete next.checked;
  if (!next.closedOn) delete next.closedOn;
  return { ...(closings ?? {}), [key]: next };
};

/** Coche (ou décoche) à la main ; les autres années et les champs inconnus sont gardés. */
export const setClosingCheck = (closings: YearClosings | undefined, year: number, check: string, checked = true): YearClosings =>
  withRecord(closings, year, r => {
    const rest = (r.checked ?? []).filter(c => c !== check);
    return { ...r, checked: checked ? [...rest, check] : rest };
  });

/** Plusieurs coches d'un coup (archive : JSON et CSV). */
export const addClosingChecks = (closings: YearClosings | undefined, year: number, checks: string[]): YearClosings =>
  withRecord(closings, year, r => ({ ...r, checked: [...new Set([...(r.checked ?? []), ...checks])] }));

/** Clôture (`closedOn` = 'AAAA-MM-JJ') ou réouverture (`null`) de l'année. */
export const setYearClosed = (closings: YearClosings | undefined, year: number, closedOn: string | null): YearClosings =>
  withRecord(closings, year, r => ({ ...r, closedOn: closedOn ?? undefined }));

// ---------------------------------------------------------------------------
// Étapes
// ---------------------------------------------------------------------------

const eur0 = (n: number) => formatEUR(n, 0);
const eur2 = (n: number) => formatEUR(n, 2);
const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;
/** « 5 janvier », avec l'année si ce n'est pas celle de `refYear`. */
const dayLabel = (iso: string, refYear: number) => {
  const d = parseISODate(iso);
  return d.getFullYear() === refYear ? frenchDay(d) : `${frenchDay(d)} ${d.getFullYear()}`;
};

// Placements à relevé annuel (valeur au 31/12 et versements) : étape 3. Les autres comptes
// (livrets, compte courant, PEL, crypto…) sont à l'étape 1.
const STATEMENT_TYPES = [AccountType.ASSURANCE_VIE, AccountType.PEA, AccountType.CTO, AccountType.PER, AccountType.PEE];

/**
 * Le compte était suivi par l'app au 31 décembre de l'année : un mouvement daté de l'année
 * ou d'avant (le « Solde initial » porte la date d'ajout dans l'app), ou, pour un ancien compte
 * sans aucun mouvement, un solde et une ouverture antérieure. Un compte ajouté en janvier, dont
 * le solde initial contient déjà les intérêts du 31 décembre, n'est donc pas concerné.
 */
const existedAtYearEnd = (a: SavingsAccount, yearEnd: string) => {
  if (a.openingDate && a.openingDate > yearEnd) return false;
  const moves = a.movements;
  return moves.length === 0 ? a.totalAmount > 0.005 : moves.some(m => m.date <= yearEnd);
};

/**
 * La clôture a un sens : un compte au moins existait au 31 décembre de l'année (ou un relevé
 * mensuel date de l'année). Un tout nouvel utilisateur n'a pas d'année à clôturer.
 */
export const closingApplies = (data: Pick<GlobalAppData, 'accounts' | 'history'>, year: number): boolean => {
  const yearEnd = `${year}-12-31`;
  return (data.accounts || []).some(a => existedAtYearEnd(a, yearEnd)) || (data.history || []).some(s => s.date <= yearEnd);
};

const checkedLabel = (checkedOn: string | undefined, yearEnd: string, refYear: number) =>
  checkedOn && checkedOn >= yearEnd ? `vérifié le ${dayLabel(checkedOn, refYear)}`
    : checkedOn ? `dernier solde constaté le ${dayLabel(checkedOn, refYear)}` : 'jamais vérifié';

/**
 * Liste de clôture de `year`, à la date `now` (l'année suivante en principe). Les étapes sans
 * objet sont absentes : pas de compte concerné, plus de capital des parents ni de restitution
 * dans l'année.
 */
export const buildYearClosing = (data: GlobalAppData, year: number, now: Date = new Date()): YearClosing => {
  const accounts = data.accounts || [];
  const record = closingRecordOf(data.config, year);
  const checked = new Set(record.checked ?? []);
  const todayISO = formatISODay(now);
  const yearEnd = `${year}-12-31`;
  const nextYearStart = `${year + 1}-01-01`;
  const refYear = year + 1;
  const steps: YearClosingStep[] = [];
  const inScope = accounts.filter(a => existedAtYearEnd(a, yearEnd));

  // 1. Soldes au 31 décembre : constatés depuis (Actualiser, fiche, « Confirmer le solde »).
  const balanceAccounts = inScope.filter(a => !STATEMENT_TYPES.includes(a.type) && freshnessLimitDays(a.type) !== null);
  if (balanceAccounts.length > 0) {
    const items = balanceAccounts.map(a => {
      const on = lastBalanceCheck(a, todayISO);
      return { key: a.id, label: a.name, detail: checkedLabel(on, yearEnd, refYear), done: !!on && on >= yearEnd };
    });
    const left = items.filter(i => !i.done).length;
    steps.push({
      id: 'balances', title: 'Vérifier les soldes au 31 décembre', done: left === 0, items,
      detail: left === 0
        ? 'Tous vos soldes ont été vérifiés depuis le 31 décembre.'
        : `${plural(left, 'compte à vérifier', 'comptes à vérifier')} : comparez avec votre banque, puis Actualiser (même sans changement, le solde est noté comme vérifié).`,
      buttons: [{ label: 'Actualiser', action: { type: 'navigate', view: 'update' } }],
    });
  }

  // 2. Intérêts crédités au 31 décembre : la proposition d'« Actualiser », arrêtée au 31 mars
  //    (après, une hausse d'un livret est un versement). Seulement les comptes crédités ce
  //    jour-là (livrets, épargne logement) : un compte à terme paie selon son contrat.
  const refISO = todayISO < `${year + 1}-03-31` ? todayISO : `${year + 1}-03-31`;
  const interestRows = inScope
    .filter(a => INTEREST_CREDITED_DEC31_TYPES.includes(a.type))
    .map(a => ({ a, expected: computeAccruedInterest(a, year, new Date(year + 1, 0, 1)) }))
    .filter(r => r.expected > 0.005);
  if (interestRows.length > 0) {
    const items = interestRows.map(({ a, expected }) => {
      const pending = refISO >= nextYearStart ? suggestCreditedInterest(a, refISO) : { year, amount: round2(expected) };
      return {
        key: a.id, label: a.name, done: !pending,
        detail: pending ? `${eur2(pending.amount)} attendus : à enregistrer` : `${eur2(expected)} : enregistrés`,
      };
    });
    const byHand = checked.has(CLOSING_CHECKS.interest);
    const offered = data.parentalRestitution?.done?.interestsOffered.find(i => i.year === year)?.amount
      ?? computeAccruedParentalInterest(accounts, year, new Date(year + 1, 0, 1)).totalAnnualParental;
    const parents = offered >= 1 ? ` Dont environ ${eur0(offered)} produits par le capital de vos parents : ils vous sont offerts.` : '';
    const done = byHand || items.every(i => i.done);
    steps.push({
      id: 'interest', title: `Enregistrer les intérêts ${year}`, done, items,
      detail: (done
        ? 'Intérêts enregistrés, hors épargne.'
        : 'Ces comptes ont reçu leurs intérêts le 31 décembre. Dans Actualiser, saisissez le solde affiché par la banque : Pécule propose ces intérêts et les compte hors épargne.') + parents,
      check: { key: CLOSING_CHECKS.interest, label: 'Déjà enregistrés', checked: byHand },
      buttons: [{ label: 'Actualiser', action: { type: 'navigate', view: 'update' } }],
    });
  }

  // 3. Relevés annuels des placements : valeur au 31/12 et versements ; taux servi du fonds
  //    euros de l'assurance vie (publié par l'assureur en janvier).
  const placements = inScope.filter(a => STATEMENT_TYPES.includes(a.type) && a.totalAmount > 0.005);
  if (placements.length > 0) {
    const items: YearClosingItem[] = placements.map(a => {
      const on = lastBalanceCheck(a, todayISO);
      const done = !!on && on >= yearEnd;
      return { key: a.id, label: a.name, done, detail: done ? `valeur reportée le ${dayLabel(on as string, refYear)}` : 'valeur au 31 décembre et versements de l\'année à reporter' };
    });
    const lifeInsurance = placements.filter(a => a.type === AccountType.ASSURANCE_VIE);
    for (const a of lifeInsurance) {
      // Même trace que la tâche « Taux servi » de l'Accueil (lib/finance : findAvRateUpdatesDue).
      const done = isRateReviewedSince(a, nextYearStart);
      items.push({
        key: `rate:${a.id}`, label: `${a.name} : taux servi ${year}`, done,
        detail: done ? 'taux vérifié' : 'à reporter dans Mes comptes, ou à confirmer s\'il n\'a pas changé',
        button: done ? undefined : { label: 'Taux inchangé', action: { type: 'confirm-rate', accountId: a.id } },
      });
    }
    steps.push({
      id: 'statements', title: 'Relevés annuels des placements', done: items.every(i => i.done), items,
      detail: `Reportez la valeur au 31 décembre et les versements de chaque relevé : les plus-values restent justes.${lifeInsurance.length > 0 ? ` Le taux servi ${year} du fonds euros est publié par l'assureur en janvier.` : ''}`,
      buttons: [
        { label: 'Actualiser', action: { type: 'navigate', view: 'update' } },
        ...(lifeInsurance.length > 0 ? [{ label: 'Mes comptes', action: { type: 'navigate', view: 'accounts' } } as YearClosingButton] : []),
      ],
    });
  }

  // 4. Restitution du capital des parents, quand elle appartient à cette clôture : faite dans
  //    l'année (un 1er janvier clôt l'année d'avant, dont il garde les intérêts), ou encore à
  //    faire, sans date ou prévue d'ici la fin de la saison de clôture. Une restitution prévue
  //    des années plus tard ne bloque pas les clôtures d'avant. Logique de restitution
  //    inchangée : Part parentale.
  const restitution = data.parentalRestitution;
  const restituted = restitution?.done;
  const ofThisYear = (iso: string) => (iso.startsWith(`${year}-`) && iso !== `${year}-01-01`) || iso === nextYearStart;
  if (restituted && ofThisYear(restituted.date)) {
    const total = restituted.accounts.reduce((s, r) => s + r.amount, 0);
    steps.push({
      id: 'restitution', title: 'Restitution du capital de vos parents', done: true, items: [],
      detail: `${eur0(total)} rendus le ${dayLabel(restituted.date, refYear)}. Vous continuez en solo.`,
      buttons: [{ label: 'Part parentale', action: { type: 'navigate', view: 'parental' } }],
    });
  } else if (!restituted && hasParentalCapital(accounts) && (!restitution?.plannedDate || restitution.plannedDate < `${year + 1}-03-01`)) {
    const total = accounts.reduce((s, a) => s + a.parentalCapital, 0);
    const planned = restitution?.plannedDate;
    steps.push({
      id: 'restitution', title: 'Restitution du capital de vos parents', done: false, items: [],
      detail: planned
        ? `Prévue le ${dayLabel(planned, refYear)} : ${eur0(total)} à rendre. Une fois les virements faits, enregistrez-la dans Part parentale.`
        : `${eur0(total)} de capital de vos parents sur vos comptes : préparez la restitution dans Part parentale.`,
      buttons: [{ label: 'Part parentale', action: { type: 'navigate', view: 'parental' } }],
    });
  }

  // 5. « Votre année » : cochée quand on l'ouvre depuis la clôture.
  steps.push({
    id: 'review', title: `Votre année ${year}`, done: checked.has(CLOSING_CHECKS.review), items: [],
    detail: 'Votre année en quelques chiffres : mis de côté, intérêts, ce qui a compté.',
    buttons: [{ label: `Voir votre année ${year}`, action: { type: 'open-review' } }],
  });

  // 6. Déclaration du printemps : les points de l'aide à la déclaration qui vous concernent,
  //    et les reçus fiscaux des dons encore manquants.
  const topics = taxReturnTopics(buildTaxReturnChecklist(data, year));
  const donations = computeDonationSummary(data.donations || [], year);
  const taxItems: YearClosingItem[] = donations.count > 0 ? [{
    key: 'receipts', label: 'Reçus fiscaux des dons', done: donations.missingReceipts.length === 0,
    detail: donations.missingReceipts.length === 0 ? 'tous les reçus sont là'
      : `${plural(donations.missingReceipts.length, 'reçu manquant', 'reçus manquants')} : ${listFr(donations.missingReceipts.map(d => d.organization))}`,
  }] : [];
  const taxByHand = checked.has(CLOSING_CHECKS.taxReturn);
  steps.push({
    id: 'tax-return', title: `Préparer la déclaration des revenus ${year}`, done: taxByHand, items: taxItems,
    detail: `${topics.length > 0 ? `À vérifier au printemps : ${listFr(topics)}.` : 'Rien de particulier repéré : comparez vos salaires avec vos fiches de paie.'} La déclaration en ligne ouvre en avril.`,
    check: { key: CLOSING_CHECKS.taxReturn, label: 'C\'est noté', checked: taxByHand },
    buttons: [{ label: 'Voir les cases', action: { type: 'show-tax-return' } }],
  });

  // 7. Paramètres fiscaux de la nouvelle année : le barème de l'impôt à appliquer s'il en existe
  //    un plus récent, puis plafond LEP, abattement et barème confirmés. Mêmes données que les
  //    rappels « Nouveau barème » et « Nouvelle année » de l'Accueil, effacés pendant la clôture.
  const fiscal = data.fiscalConfig ?? DEFAULT_FISCAL_CONFIG;
  const newScale = findFiscalReview(fiscal, now).newScale;
  const paramsReviewed = (fiscal.paramsReviewedYear ?? 0) >= year + 1;
  const fiscalItems: YearClosingItem[] = [];
  if (newScale) fiscalItems.push({
    key: 'tax-scale', label: 'Nouveau barème de l\'impôt', done: false,
    detail: `${newScale.label} : votre paie nette après impôt est encore calculée avec l'ancien`,
    button: { label: 'Appliquer', action: { type: 'apply-tax-scale' } },
  });
  fiscalItems.push({
    key: 'fiscal-params', label: 'Plafond LEP, abattement et barème', done: paramsReviewed,
    detail: paramsReviewed ? `vérifiés pour ${year + 1}`
      : `plafond LEP ${formatEUR(fiscal.lepIncomeCeiling ?? 0)}, abattement plafonné à ${formatEUR(fiscal.standardAllowanceCap ?? 0)}, barème ${fiscal.taxScaleYear ?? 'personnalisé'}`,
    button: paramsReviewed ? undefined : { label: 'C\'est à jour', action: { type: 'confirm-fiscal-params', year: year + 1 } },
  });
  steps.push({
    id: 'fiscal-params', title: `Paramètres fiscaux ${year + 1}`, done: paramsReviewed && !newScale, items: fiscalItems,
    detail: 'Ils changent chaque année et servent au calcul de votre impôt et de vos droits au LEP : comparez-les avec les chiffres officiels.',
    buttons: [{ label: 'Ouvrir les paramètres', action: { type: 'navigate', view: 'settings' } }],
  });

  // 8. Archive de l'année, sur l'appareil.
  const json = checked.has(CLOSING_CHECKS.archiveJson);
  const csv = checked.has(CLOSING_CHECKS.archiveCsv);
  steps.push({
    id: 'archive', title: 'Garder une archive sur cet appareil', done: json && csv,
    detail: 'Deux fichiers, chez vous : toutes vos données (réimportables dans Pécule) et les mouvements et soldes de l\'année (pour Excel).',
    items: [
      { key: CLOSING_CHECKS.archiveJson, label: 'Toutes vos données (JSON)', done: json, detail: json ? 'téléchargé' : 'à télécharger', button: { label: 'Télécharger', action: { type: 'download-json' } } },
      { key: CLOSING_CHECKS.archiveCsv, label: `Mouvements et soldes ${year} (CSV)`, done: csv, detail: csv ? 'téléchargé' : 'à télécharger', button: { label: 'Télécharger', action: { type: 'download-csv' } } },
    ],
    buttons: [],
  });

  // 9. Clôture : les rappels de clôture de l'année s'arrêtent.
  const closedOn = record.closedOn;
  steps.push({
    id: 'close', title: `Clôturer l'année ${year}`, done: !!closedOn, items: [],
    detail: closedOn
      ? `Année clôturée le ${dayLabel(closedOn, refYear)} : plus de rappel de clôture. Vous pouvez la rouvrir.`
      : 'Les rappels de clôture s\'arrêtent ; vous pourrez rouvrir l\'année.',
    buttons: [closedOn ? { label: 'Rouvrir', action: { type: 'reopen' } } : { label: `Clôturer ${year}`, action: { type: 'close' } }],
  });

  const counted = steps.filter(s => s.id !== 'close');
  return { year, closedOn, steps, done: counted.filter(s => s.done).length, total: counted.length };
};

/** Étapes encore à faire (titres), hors la clôture elle-même : confirmation avant de clôturer. */
export const remainingSteps = (closing: YearClosing): string[] =>
  closing.steps.filter(s => s.id !== 'close' && !s.done).map(s => s.title);

export interface YearClosingStatus {
  year: number;
  closed: boolean;
  /** Janvier-février : la clôture est proposée sur l'Accueil. */
  inSeason: boolean;
  /** Avancement (calculé en saison, année ouverte ; 0 sinon). */
  done: number;
  total: number;
}

/**
 * État de la clôture pour l'Accueil : l'année écoulée, close ou non, et son avancement en
 * saison. `null` quand il n'y a rien à clôturer (aucun compte suivi l'an dernier).
 */
export const yearClosingStatus = (data: GlobalAppData, now: Date = new Date()): YearClosingStatus | null => {
  const year = closingYearOf(now);
  if (!closingApplies(data, year)) return null;
  const closed = isYearClosed(data.config, year);
  const inSeason = isClosingSeason(now);
  if (!inSeason || closed) return { year, closed, inSeason, done: 0, total: 0 };
  const c = buildYearClosing(data, year, now);
  return { year, closed, inSeason, done: c.done, total: c.total };
};

// ---------------------------------------------------------------------------
// Archive CSV de l'année
// ---------------------------------------------------------------------------

const natureOf = (m: AccountMovement): string =>
  isInitialBalance(m) ? 'Solde initial'
    : m.kind === 'valuation' ? 'Variation de valeur'
    : m.kind === 'parental' ? 'Part des parents'
    : m.kind === 'adjustment' ? 'Intérêts ou correction (hors épargne)'
    : m.type === 'IN' ? 'Versement' : 'Retrait';

/** Part des parents à une date : leur capital d'aujourd'hui, moins leurs mouvements d'après. */
const parentalAt = (a: SavingsAccount, iso: string) =>
  a.movements.reduce((s, m) => (m.date > iso && m.kind === 'parental' ? s - signedAmount(m) : s), a.parentalCapital);

/**
 * Mouvements de l'année (tous les comptes, dans l'ordre des dates), puis les soldes au
 * 31 décembre compte par compte. La colonne des parents n'apparaît que s'ils avaient du capital
 * ce jour-là. Format d'Excel en français (lib/csv).
 */
export const yearArchiveCsv = (data: Pick<GlobalAppData, 'accounts'>, year: number): { fileName: string; rows: CsvCell[][] } => {
  const accounts = data.accounts || [];
  const from = `${year}-01-01`, to = `${year}-12-31`;
  const moves = accounts
    .flatMap(a => a.movements.filter(m => m.date >= from && m.date <= to).map(m => ({ a, m })))
    .sort((x, y) => x.m.date.localeCompare(y.m.date) || x.a.name.localeCompare(y.a.name));
  const balances = accounts
    .filter(a => !(a.openingDate && a.openingDate > to))
    .map(a => ({ a, owned: round2(ownedAmountAt(a, to)), parental: round2(Math.max(0, parentalAt(a, to))) }));
  const withParents = balances.some(b => b.parental > 0.005);
  return {
    fileName: `pecule-${year}-mouvements-et-soldes.csv`,
    rows: [
      [`Mouvements ${year}`],
      ['Date', 'Compte', 'Établissement', 'Libellé', 'Nature', 'Montant (€)'],
      ...moves.map(({ a, m }) => [m.date, a.name, a.institution, m.label, natureOf(m), csvAmount(signedAmount(m))]),
      [],
      [`Soldes au 31/12/${year}`],
      ['Compte', 'Type', 'Établissement', withParents ? 'Votre part (€)' : 'Solde (€)', ...(withParents ? ['Part des parents (€)', 'Total (€)'] : [])],
      ...balances.map(({ a, owned, parental }) => [
        a.name, a.type, a.institution, csvAmount(owned), ...(withParents ? [csvAmount(parental), csvAmount(round2(owned + parental))] : []),
      ]),
    ],
  };
};
