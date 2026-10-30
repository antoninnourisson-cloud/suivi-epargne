// ================================================
// FILE: src/lib/askSnapshot.ts
// « Demander à Pécule » : résumé compact des données, envoyé à Gemini avec chaque question.
// Construit à partir de ce que l'app calcule déjà (soldes, épargne du mois, intérêts, agenda,
// impôt estimé), par liste blanche : seuls les champs nommés ici partent. Jamais d'e-mail,
// d'identifiant de fichier Drive, de clé API, d'information d'appareil ou de session, de code
// de secours, ni de texte libre (notes, libellés des mouvements et des virements programmés, journal).
//
// Déterministe (même document et même date → même texte), montants arrondis au centime, et
// taille plafonnée : au-delà, les listes les plus longues sont raccourcies.
// ================================================
import { AccountType, type FiscalConfig, type GlobalAppData, type SavingsAccount } from '../types';
import { DEFAULT_FISCAL_CONFIG } from '../constants';
import { round2 } from './money';
import { formatISODay } from './dates';
import {
  computeAccruedInterest, computeAccruedParentalInterest, computeMaturityCountdown,
  computeMonthlyPay, subscriptionMonthlyCost, type SalaryTaxEstimate,
} from './finance';
import { buildAgenda } from './agenda';
import { savingsByMonth } from './motivation';
import { shiftMonth } from './payCalendar';

/** Taille maximale du résumé (caractères JSON) : environ 10 000 jetons au plus. */
export const ASK_SNAPSHOT_MAX_CHARS = 40_000;

export interface AskSnapshotExtras {
  /** Impôt sur le revenu estimé de l'année (useDerivedData). */
  taxEstimate?: SalaryTaxEstimate;
  /** Épargne prévue chaque mois (rappel de paie, sinon capacité du Pilotage). */
  monthPlan?: number;
}

export interface AskSnapshotResult {
  json: string;
  /** Date de la photographie, 'AAAA-MM-JJ'. */
  asOf: string;
  /** Des listes ont été raccourcies pour tenir dans la taille maximale. */
  truncated: boolean;
}

const eur = (n: number | undefined): number | undefined => (typeof n === 'number' && Number.isFinite(n) ? round2(n) : undefined);
const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const sum = (xs: number[]) => round2(xs.reduce((s, x) => s + x, 0));

/** Plafond d'un compte : celui saisi sur le compte, sinon le plafond légal des livrets réglementés. */
const ceilingOf = (a: SavingsAccount, ceilings: FiscalConfig['ceilings']): number | undefined => {
  if (a.ceiling && a.ceiling > 0) return a.ceiling;
  if (a.type === AccountType.LIVRET_A) return ceilings.livretA;
  if (a.type === AccountType.LDDS) return ceilings.ldds;
  if (a.type === AccountType.LEP) return ceilings.lep;
  return undefined;
};

// Listes raccourcies, dans cet ordre, tant que le résumé dépasse la taille maximale.
type Snapshot = Record<string, unknown> & {
  comptes: unknown[]; epargneParMois: unknown[]; soldesParMois: unknown[]; aVenir60Jours: unknown[];
  virementsRecurrents: unknown[]; abonnements: unknown[]; paieNetteParMois: unknown[];
};
const SHRINK_STEPS: ((s: Snapshot) => void)[] = [
  s => { s.soldesParMois = s.soldesParMois.slice(-12); },
  s => { s.epargneParMois = s.epargneParMois.slice(-12); },
  s => { s.aVenir60Jours = s.aVenir60Jours.slice(0, 20); },
  s => { s.abonnements = s.abonnements.slice(0, 20); s.virementsRecurrents = s.virementsRecurrents.slice(0, 20); },
  s => { s.paieNetteParMois = s.paieNetteParMois.slice(-6); s.soldesParMois = s.soldesParMois.slice(-6); },
  s => { s.comptes = s.comptes.slice(0, 25); },
  s => { s.aVenir60Jours = []; s.abonnements = []; s.virementsRecurrents = []; s.soldesParMois = []; },
  s => { s.comptes = s.comptes.slice(0, 10); s.epargneParMois = s.epargneParMois.slice(-6); },
];

/**
 * Résumé des données pour « Demander à Pécule », au jour `today`. `maxChars` : taille
 * maximale du JSON (par défaut ASK_SNAPSHOT_MAX_CHARS).
 */
export const buildAskSnapshot = (
  data: GlobalAppData,
  today: Date,
  extras: AskSnapshotExtras = {},
  maxChars = ASK_SNAPSHOT_MAX_CHARS,
): AskSnapshotResult => {
  const fiscal = data.fiscalConfig ?? DEFAULT_FISCAL_CONFIG;
  const accounts = data.accounts ?? [];
  const asOf = formatISODay(today);
  const year = today.getFullYear();
  const trackingStart = data.config?.trackingStartDate;

  // Comptes : le plus gros solde d'abord (ordre stable : puis le nom).
  const sorted = [...accounts].sort((a, b) => b.totalAmount - a.totalAmount || a.name.localeCompare(b.name, 'fr'));
  const comptes = sorted.map(a => {
    const ceiling = ceilingOf(a, fiscal.ceilings);
    const maturity = computeMaturityCountdown(a, fiscal, today);
    return {
      nom: a.name,
      type: a.type,
      etablissement: a.institution || undefined,
      solde: eur(a.totalAmount),
      partPropre: eur(a.ownedAmount),
      capitalParental: a.parentalCapital > 0 ? eur(a.parentalCapital) : undefined,
      tauxPct: typeof a.interestRate === 'number' ? a.interestRate : undefined,
      plafond: eur(ceiling),
      resteSousPlafond: ceiling ? eur(Math.max(0, ceiling - a.totalAmount)) : undefined,
      ouverture: a.openingDate || undefined,
      finDeContrat: a.contractEndDate || undefined,
      maturiteFiscale: maturity ? { date: maturity.maturityDate, moisRestants: maturity.monthsRemaining } : undefined,
      bloque: a.blocked || undefined,
      soldeVerifieLe: a.balanceCheckedAt || undefined,
      interetsAcquisCetteAnnee: eur(Math.max(0, computeAccruedInterest(a, year, today))),
    };
  });

  // Épargne mise de côté (versements − retraits hors valorisation), par MOIS D'ÉPARGNE sur 24
  // mois (lib/payCalendar : la paie du 27 octobre ouvre l'épargne de novembre ; mois civils sans
  // jour de paie ni paie déclarée).
  const months = savingsByMonth({
    accounts, today: asOf, paydayDay: data.config?.paydayDay, payslips: data.payslips, pays: data.pays,
    trackingStartISO: trackingStart, fromKey: shiftMonth(monthKey(today), -24), toKey: '9999-12',
  }).slice(-24);
  const epargneParMois = months.map(m => ({ moisEpargne: m.key, depuisLe: m.start, epargne: round2(m.saved) }));
  // Mois d'épargne en cours : le dernier ouvert (il peut porter la clé du mois civil suivant).
  const savingsMonth = months.length > 0 ? months[months.length - 1].key : monthKey(today);
  const [smYear, smMonth] = savingsMonth.split('-').map(Number);
  const quarterStart = monthKey(new Date(smYear, Math.floor((smMonth - 1) / 3) * 3, 1));
  const savedFrom = (from: string) => sum(epargneParMois.filter(m => m.moisEpargne >= from).map(m => m.epargne));
  const thisMonth = monthKey(today);

  // Soldes de fin de mois (relevés mensuels de l'historique), le dernier relevé de chaque mois.
  const byMonth = new Map<string, { mois: string; total: number; partPropre: number }>();
  for (const s of [...(data.history ?? [])].sort((a, b) => a.date.localeCompare(b.date))) {
    byMonth.set(s.date.slice(0, 7), { mois: s.date.slice(0, 7), total: round2(s.totalAmount), partPropre: round2(s.ownedAmount) });
  }
  const soldesParMois = [...byMonth.values()].slice(-24);

  // Prochains 60 jours : paies, prélèvements, échéances, révisions de taux (agenda de l'app).
  const horizon = formatISODay(new Date(year, today.getMonth(), today.getDate() + 60));
  const aVenir60Jours = buildAgenda(data, today).events
    .filter(e => e.date >= asOf && e.date <= horizon)
    // Le libellé d'un virement programmé est un texte libre : remplacé par son compte.
    .map(e => ({ date: e.date, type: e.kind, titre: e.kind === 'recurring' ? `Virement programmé${e.detail ? ` (${e.detail})` : ''}` : e.title, montant: eur(e.amount) }));

  const accountName = new Map(accounts.map(a => [a.id, a.name]));
  const virementsRecurrents = (data.recurringMovements ?? []).filter(r => r.active)
    .map(r => ({ compte: accountName.get(r.accountId) ?? 'compte supprimé', sens: r.type === 'IN' ? 'versement' : 'retrait', montant: eur(r.amount), jourDuMois: r.dayOfMonth }))
    .sort((a, b) => a.jourDuMois - b.jourDuMois || a.compte.localeCompare(b.compte, 'fr'));

  const activeSubs = (data.subscriptions ?? []).filter(s => s.active);
  const abonnements = activeSubs
    .map(s => ({ nom: s.name, montant: eur(s.amount), frequence: s.frequency, coutMensuel: eur(subscriptionMonthlyCost(s)), compteDebite: s.debitAccount || undefined }))
    .sort((a, b) => (b.coutMensuel ?? 0) - (a.coutMensuel ?? 0) || a.nom.localeCompare(b.nom, 'fr'));

  // Paie nette des 12 derniers mois, d'après les fiches de paie (une par mois, la plus récente).
  const firstPayMonth = monthKey(new Date(year, today.getMonth() - 11, 1));
  const pay = new Map<string, { mois: string; netVerse?: number; netAvantImpot?: number; brut?: number; impotPreleve?: number }>();
  for (const p of [...(data.payslips ?? [])].sort((a, b) => a.addedAt.localeCompare(b.addedAt))) {
    const period = p.extracted?.period;
    if (!period || period < firstPayMonth || period > thisMonth) continue;
    pay.set(period, { mois: period, netVerse: eur(p.extracted.netPaid), netAvantImpot: eur(p.extracted.netAmount), brut: eur(p.extracted.grossAmount), impotPreleve: eur(p.extracted.incomeTaxWithheld) });
  }
  const paieNetteParMois = [...pay.values()].sort((a, b) => a.mois.localeCompare(b.mois));

  const parental = computeAccruedParentalInterest(accounts, year, today);
  const parentalYear = computeAccruedParentalInterest(accounts, year, new Date(year + 1, 0, 1));
  const restitution = data.parentalRestitution;
  const parentalCapital = accounts.reduce((s, a) => s + (a.parentalCapital > 0 ? a.parentalCapital : 0), 0);
  const tax = extras.taxEstimate;
  const rfr = data.config?.rfrByYear ?? {};

  const snapshot: Snapshot = {
    date: asOf,
    totaux: {
      solde: sum(accounts.map(a => a.totalAmount)),
      partPropre: sum(accounts.map(a => a.ownedAmount)),
      capitalParental: round2(parentalCapital),
      nombreDeComptes: accounts.length,
    },
    epargne: {
      note: "Comptée par mois d'épargne : une paie reçue à partir du 15 finance le mois suivant (paie du 27 octobre = épargne de novembre).",
      moisEpargneEnCours: savingsMonth,
      ceMois: savedFrom(savingsMonth),
      ceTrimestre: savedFrom(quarterStart),
      depuisLe1erJanvier: savedFrom(`${smYear}-01`),
      sur12DerniersMois: sum(epargneParMois.slice(-12).map(m => m.epargne)),
      prevueChaqueMois: eur(extras.monthPlan),
      suiviDepuis: trackingStart || undefined,
    },
    interets: {
      annee: year,
      acquisADate: sum(comptes.map(c => c.interetsAcquisCetteAnnee ?? 0)),
      estimationAnneeComplete: sum(accounts.map(a => Math.max(0, computeAccruedInterest(a, year, new Date(year + 1, 0, 1))))),
      dontCapitalParentalADate: eur(parental.totalAnnualParental),
      dontCapitalParentalAnneeComplete: eur(parentalYear.totalAnnualParental),
      note: 'Livrets réglementés : intérêts versés au 31 décembre (règle des quinzaines).',
    },
    paieMensuelleEstimee: eur(computeMonthlyPay(data)) || undefined,
    impot: tax ? { annee: year, impotEstime: eur(tax.taxDue), revenuImposableSalaires: eur(tax.taxableIncome) } : undefined,
    revenuFiscalDeReference: Object.keys(rfr).length > 0
      ? Object.keys(rfr).sort().map(y => ({ anneeDesRevenus: Number(y), rfr: eur(rfr[y]) }))
      : undefined,
    restitutionParentale: restitution?.done
      ? { faite: true, date: restitution.done.date, montantRendu: sum(restitution.done.accounts.map(a => a.amount)) }
      : restitution?.plannedDate
        ? { faite: false, datePrevue: restitution.plannedDate, capitalParentalARendre: round2(parentalCapital) }
        : parentalCapital > 0 ? { faite: false, capitalParentalARendre: round2(parentalCapital) } : undefined,
    comptes,
    epargneParMois,
    soldesParMois,
    aVenir60Jours,
    virementsRecurrents,
    abonnements,
    totalAbonnementsMensuel: activeSubs.length ? sum(activeSubs.map(subscriptionMonthlyCost)) : undefined,
    paieNetteParMois,
  };

  let json = JSON.stringify(snapshot);
  let truncated = false;
  for (const step of SHRINK_STEPS) {
    if (json.length <= maxChars) break;
    step(snapshot);
    snapshot.tronque = true;
    truncated = true;
    json = JSON.stringify(snapshot);
  }
  return { json, asOf, truncated };
};
