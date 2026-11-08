// Liste « À faire » de l'Accueil.
// (Extrait de home.ts, code déplacé tel quel ; home.ts le ré-exporte.)
import type { CeilingAlert } from './homeAlerts';
import { type FiscalConfig, type PlannedWithdrawal, type SavingsAccount } from '../types';
import type { View } from '../navigation';
import type { Alert, AlertGain, AlertKind } from './alerts';
import type { LepTimeline } from './lep';
import { describeLepTimeline } from './lep';
import type { TaxReturnAlert } from './taxReturn';
import type { EmergencyFund } from './planning';
import { describeStaleBalances, type StaleBalance } from './freshness';
import type { YearClosingStatus } from './yearClosing';
import { computeRestitutionPlan, type DueRecurring, type FiscalReview } from './finance';
import { daysBetween, formatISODay, parseISODate } from './dates';
import { describeFiscalAnniversary, findFiscalAnniversaries } from './fiscalClock';
import type { RateProposalInfo } from './rateChanges';
import type { BackupUploadProblem } from './recoveryCodeCheck';
import { isYearEndFinalReminder, isYearEndTaxSeason, type YearEndTaxFigures } from './yearEndTax';
import { elideDe, elideLe, formatEUR, formatPeriod, formatRate, frenchDay } from './format';

// ---------------------------------------------------------------------------
// Liste « À faire »
// ---------------------------------------------------------------------------

export type HomeTodoIcon =
  | 'clock' | 'repeat' | 'shield' | 'percent' | 'piggy-bank' | 'trash' | 'landmark' | 'clipboard' | 'trending-up'
  | 'alert' | 'download' | 'life-buoy' | 'wallet' | 'transfer' | 'gift' | 'file-warning' | 'calendar-check';

/** Ce que fait un bouton de la liste ; l'écran relie chaque action à son gestionnaire. */
export type HomeAction =
  | { type: 'navigate'; view: View }
  | { type: 'record-recurring'; due: DueRecurring }
  | { type: 'skip-recurring'; recurringId: string }
  | { type: 'toggle-rates-editor' }
  | { type: 'dismiss-rate-reminder'; revisionKey: string }
  | { type: 'delete-account'; accountId: string }
  | { type: 'apply-tax-scale' }
  | { type: 'confirm-fiscal-params'; year: number }
  | { type: 'open-settings' }
  | { type: 'show-tax-return' }
  | { type: 'mark-tax-return-filed'; incomeYear: number }
  | { type: 'accept-pay-raise' }
  | { type: 'dismiss-pay-raise' }
  /** « Taux inchangé » : noté sur chaque compte (`rateReviewedAt`), comme depuis la clôture. */
  | { type: 'confirm-av-rates'; accountIds: string[] }
  | { type: 'export' }
  | { type: 'open-year-closing' }
  /** Paramètres, carte « Données » : retaper le code de secours de la sauvegarde chiffrée. */
  | { type: 'check-backup-code' }
  /** Retrait prévu par « J'ai besoin d'argent » : enregistré (virements, un seul « Annuler »), ou supprimé. */
  | { type: 'record-planned-withdrawal'; id: string }
  | { type: 'delete-planned-withdrawal'; id: string }
  /** « Les taux ont changé » : la feuille du rituel (taux de la veille, autres comptes). */
  | { type: 'open-rate-changes' };

export interface HomeTodo {
  /** Stable (sert au « Plus tard ») : ne pas changer sans raison. */
  key: string;
  icon: HomeTodoIcon;
  tone: 'action' | 'info';
  text: string;
  detail?: string;
  gain?: AlertGain;
  snoozable?: boolean;
  /**
   * « Plus tard » jusqu'à ce jour (AAAA-MM-JJ) au lieu des 7 jours habituels. Passé ou absent :
   * 7 jours.
   */
  snoozeUntil?: string;
  /** En tête de la liste, avant le tri par montant (clôture de l'année en janvier-février). */
  pinned?: boolean;
  primary?: { label: string; action: HomeAction };
  secondary?: { label: string; action: HomeAction };
}

/** Ce que l'écran sait faire (un bouton n'est proposé que si son action existe). */
export interface HomeCapabilities {
  navigate: boolean;
  recordRecurring: boolean;
  deleteAccount: boolean;
  updateFiscalConfig: boolean;
  updateAccounts: boolean;
  openSettings: boolean;
  acceptPayRaise: boolean;
  dismissPayRaise: boolean;
  exportData: boolean;
  /** Retraits prévus : « Enregistrer » et « Supprimer » (absent : false). */
  plannedWithdrawals?: boolean;
  /** Feuille « Les taux ont changé » (absent : false). */
  rateChanges?: boolean;
}

export interface HomeTodoInput {
  now: Date;
  accounts: SavingsAccount[];
  fiscalConfig: FiscalConfig;
  can: HomeCapabilities;
  daysSinceUpdate: number | null;
  /** Comptes dont le solde est à revérifier (lib/freshness) : prime sur `daysSinceUpdate`. */
  staleBalances?: StaleBalance[];
  /** Échéances du mois pas encore enregistrées (celles écartées ce mois-ci déjà retirées). */
  dueRecurring: DueRecurring[];
  lepTimeline: LepTimeline | null;
  staleRates: { revision: { key: string; label: string }; accounts: { name: string }[] } | null;
  /** Révision des taux déjà écartée (« Taux inchangé »). */
  dismissedRateRevision: string | null;
  ratesEditorOpen: boolean;
  parentalYearEnd: number | null;
  /**
   * Restitution du capital des parents : date prévue (ou conseillée, le 1er janvier) tant qu'elle
   * n'est pas enregistrée, `done` une fois faite. Absent : aucun rappel de restitution, et le
   * rappel des intérêts de décembre garde son seul chiffre « à ce jour ».
   */
  restitution?: { plannedDate?: string; done?: boolean };
  inactiveEmpty: SavingsAccount[];
  fiscalReview: FiscalReview;
  taxReturnAlert: TaxReturnAlert | null;
  /** Année de revenus déjà déclarée (« C'est déclaré »). */
  taxReturnFiled: string | null;
  payRaise: { delta: number; period: string; hasFixedAmount: boolean } | null;
  /** Assurances vie dont le taux servi de l'an dernier reste à reporter (vide si déjà vérifié). */
  avRatesDue: SavingsAccount[];
  ceilingAlerts: CeilingAlert[];
  lastExportAt?: string;
  alerts: Alert[];
  emergency: EmergencyFund | null;
  /**
   * Clôture de l'année écoulée (lib/yearClosing) : une seule tâche en janvier-février, qui
   * remplace le taux servi de l'assurance vie, le barème et les paramètres fiscaux de l'année
   * et la copie trimestrielle (étapes de la clôture).
   */
  yearClosing?: YearClosingStatus | null;
  /**
   * Sauvegarde de secours chiffrée activée sur cet appareil et code de secours pas retapé
   * depuis un an (lib/recoveryCodeCheck, backupCodeCheckDue).
   */
  backupCodeCheckDue?: boolean;
  /** Sauvegarde de secours activée, mais dernier envoi vieux de plus de 30 jours ou erreur récente (lib/recoveryCodeCheck). */
  backupProblem?: (BackupUploadProblem & { reason?: string }) | null;
  /** Retraits prévus (« J'ai besoin d'argent ») dont le jour est venu (lib/needMoney). */
  plannedWithdrawals?: PlannedWithdrawal[];
  /** Taux réglementés relevés par la veille fiscale, en attente (lib/rateChanges). */
  rateChanges?: RateProposalInfo[];
  /**
   * Revenu fiscal de référence saisi, par année de revenus (config.rfrByYear). Absent : la tâche
   * « avis d'impôt » se fie à la frise du LEP (années lues sur un avis), si elle existe.
   */
  rfrByYear?: Record<string, number>;
  /** Envies à acheter notées sans prix (lib/wishes, wishesToComplete) : une tâche ponctuelle tant qu'il en reste. */
  wishesToComplete?: number;
  /**
   * Chiffres de « Avant le 31 décembre » (lib/yearEndTax, computeYearEndTax) : calculés par
   * l'écran de mi-novembre à fin décembre seulement. Absent : la tâche reste générale.
   */
  yearEndTax?: YearEndTaxFigures | null;
}

/** Durée habituelle d'un « Plus tard » : 7 jours. */
export const SNOOZE_DEFAULT_MS = 7 * 86_400_000;

/** Fin d'un « Plus tard » : la date propre à la tâche (début de ce jour) si elle est à venir, sinon 7 jours. */
export const snoozeEndMs = (until: string | undefined, nowMs: number): number => {
  const end = until ? parseISODate(until).getTime() : NaN;
  return Number.isFinite(end) && end > nowMs ? end : nowMs + SNOOZE_DEFAULT_MS;
};

/** Début d'août à fin septembre : les avis arrivent fin juillet à fin août, quelques-uns début octobre. */
const isTaxNoticeSeason = (now: Date): boolean => now.getMonth() === 7 || now.getMonth() === 8;

const ALERT_ICONS: Record<AlertKind, HomeTodoIcon> = {
  'dormant-cash': 'wallet', 'better-rate': 'transfer', 'livret-full': 'alert', 'restitution-room': 'gift', 'payslip-anomaly': 'file-warning',
};

const eur0 = (n: number) => formatEUR(n, 0);
/** « 1er février », avec l'année si elle n'est pas l'année en cours. */
const effectiveDay = (iso: string, year: number) => {
  const d = parseISODate(iso);
  return d.getFullYear() === year ? frenchDay(d) : `${frenchDay(d)} ${d.getFullYear()}`;
};
const dayMonth = (iso: string) => parseISODate(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });

/** Tâches et alertes de l'Accueil, dans l'ordre d'origine (TodoList les trie ensuite). */
export const buildHomeTodos = (i: HomeTodoInput): HomeTodo[] => {
  const out: HomeTodo[] = [];
  const year = i.now.getFullYear();
  const go = (label: string, view: View) => (i.can.navigate ? { label, action: { type: 'navigate', view } as HomeAction } : undefined);

  // Clôture de l'année écoulée (janvier-février, année pas encore clôturée) : une tâche pour
  // toute la liste ; ses étapes (taux servi, archive) ne sont pas rappelées en plus.
  const closing = i.yearClosing ?? null;
  const closingOpen = !!closing && closing.inSeason && !closing.closed;
  if (closing && closingOpen) out.push({
    key: `year-closing-${closing.year}`, icon: 'calendar-check', tone: 'action', snoozable: true, pinned: true,
    // Même compte que la feuille (closingProgress) : l'étape « Clôturer » compte aussi, d'où + 1.
    text: `Clôture de l'année ${closing.year} : ${closing.done} étape${closing.done > 1 ? 's' : ''} sur ${closing.total + 1} faite${closing.done > 1 ? 's' : ''}.`,
    detail: 'Soldes au 31 décembre, intérêts, relevés, bilan et archive : tout au même endroit, dans l\'ordre.',
    primary: i.can.navigate ? { label: 'Ouvrir la clôture', action: { type: 'open-year-closing' } } : undefined,
  });

  // Fraîcheur compte par compte (lib/freshness) : le rappel nomme les comptes à revérifier.
  // Sans cette liste (anciens appelants), repli sur le dernier mouvement, tous comptes confondus.
  const staleText = i.staleBalances ? describeStaleBalances(i.staleBalances) : null;
  if (staleText) out.push({
    key: 'stale-update', icon: 'clock', tone: 'action', snoozable: true,
    text: staleText,
    primary: go('Actualiser', 'update'),
    secondary: go('Voir les comptes', 'accounts'),
  });
  else if (!i.staleBalances && i.daysSinceUpdate !== null && i.daysSinceUpdate >= 21) out.push({
    key: 'stale-update', icon: 'clock', tone: 'action', snoozable: true,
    text: `Aucune actualisation de solde depuis ${i.daysSinceUpdate} jours.`,
    primary: go('Actualiser', 'update'),
  });
  if (i.can.recordRecurring) for (const due of i.dueRecurring) {
    const r = due.recurring;
    const account = i.accounts.find(a => a.id === r.accountId)?.name ?? '';
    out.push({
      key: `rec-${r.id}-${due.dueDate}`, icon: 'repeat', tone: 'action',
      text: `Échéance du ${dayMonth(due.dueDate)} : ${r.label}, ${r.type === 'IN' ? '+' : '−'}${eur0(r.amount)} sur ${account}`,
      primary: { label: 'Enregistrer', action: { type: 'record-recurring', due } },
      secondary: { label: 'Pas ce mois-ci', action: { type: 'skip-recurring', recurringId: r.id } },
    });
  }
  // Retrait prévu par « J'ai besoin d'argent » : le jour conseillé est venu.
  for (const p of i.plannedWithdrawals ?? []) {
    const takes = p.lines.map(l => {
      const name = i.accounts.find(a => a.id === l.accountId)?.name;
      return `${formatEUR(l.amount)} sur ${name ? elideLe(name) : 'un compte supprimé'}`;
    });
    // Un compte supprimé depuis : l'enregistrement est impossible, seule la suppression a un sens.
    const orphan = p.lines.some(l => !i.accounts.some(a => a.id === l.accountId));
    const list = takes.length > 1 ? `${takes.slice(0, -1).join(', ')} et ${takes[takes.length - 1]}` : takes[0];
    out.push({
      key: `withdrawal-${p.id}`, icon: 'wallet', tone: 'action', pinned: true,
      text: `Retrait prévu : prendre ${list}, pour le ${dayMonth(p.needDate)}.`,
      detail: p.date < p.needDate
        ? `Fait le ${dayMonth(p.date)} ou après, ce retrait garde les intérêts de la quinzaine qui vient de finir.`
        : undefined,
      primary: !i.can.plannedWithdrawals ? undefined
        : orphan ? { label: 'Supprimer', action: { type: 'delete-planned-withdrawal', id: p.id } }
        : { label: 'Enregistrer', action: { type: 'record-planned-withdrawal', id: p.id } },
      secondary: i.can.plannedWithdrawals && !orphan ? { label: 'Supprimer', action: { type: 'delete-planned-withdrawal', id: p.id } } : undefined,
    });
  }
  const lep = i.lepTimeline;
  const lepText = describeLepTimeline(lep);
  if (lep && lepText) {
    const closing = lep.status === 'closing' || lep.status === 'closed-due';
    out.push({
      key: `lep-${lep.status}-${lep.closeBy ?? lep.overYear ?? ''}`, icon: 'shield', tone: closing ? 'action' : 'info',
      snoozable: lep.status !== 'closed-due',
      text: lepText.title, detail: lepText.detail,
      primary: lep.estimated ? go('Importer mon avis', 'settings') : go('Voir mes comptes', 'accounts'),
    });
  }
  // Taux relevés par la veille fiscale : une tâche, qui remplace le rappel de révision.
  const rateChanges = i.rateChanges ?? [];
  if (rateChanges.length > 0) out.push({
    key: 'rate-changes', icon: 'percent', tone: 'action', pinned: true,
    text: `Les taux ont changé : ${rateChanges.map(r => `${r.groupLabel} ${formatRate(r.current)} → ${formatRate(r.value)} au ${effectiveDay(r.effectiveDate, year)}`).join(' ; ')}.`,
    detail: 'Vérifiez la source, corrigez si besoin, puis appliquez à tous les comptes concernés en un geste.',
    primary: i.can.rateChanges ? { label: 'Voir et appliquer', action: { type: 'open-rate-changes' } } : undefined,
  });
  else if (i.staleRates && i.staleRates.revision.key !== i.dismissedRateRevision) out.push({
    key: 'rates', icon: 'percent', tone: 'action',
    text: `Taux réglementés révisés au ${i.staleRates.revision.label} : mettez à jour ${i.staleRates.accounts.map(a => a.name).join(', ')}.`,
    detail: 'Un taux périmé fausse le rendement, la projection et le plan de placement.',
    primary: i.can.updateAccounts ? { label: i.ratesEditorOpen ? 'Fermer' : 'Mettre à jour', action: { type: 'toggle-rates-editor' } } : undefined,
    secondary: { label: 'Taux inchangé', action: { type: 'dismiss-rate-reminder', revisionKey: i.staleRates.revision.key } },
  });
  // Envies notées à la volée, sans prix : une tâche qui disparaît d'elle-même une fois complétées.
  const unpriced = i.wishesToComplete ?? 0;
  if (unpriced > 0) out.push({
    key: 'wishes-to-complete', icon: 'gift', tone: 'info',
    text: 'Envies à compléter',
    detail: unpriced > 1 ? `${unpriced} envies sans prix` : '1 envie sans prix',
    primary: go('Compléter', 'wishes'),
  });
  // Du 15 novembre au 31 décembre : un versement PER et un don d'ici là réduisent l'impôt de l'année.
  // Deux clés : un « Plus tard » de novembre ne masque pas le dernier rappel, à partir du 15 décembre.
  // Sans chiffre connu (pas de revenu), la tâche reste générale : aucun montant inventé.
  if (isYearEndTaxSeason(i.now)) {
    const f = i.yearEndTax;
    const sentences: string[] = [];
    if (f?.per && f.per.saving > 0) sentences.push(`Verser ${eur0(f.per.amount)} sur votre PER réduirait votre impôt ${year} d'environ ${eur0(f.per.saving)}.`);
    if (f?.donations) {
      const d = f.donations;
      if (d.acquired > 0 && d.extra > 0) sentences.push(`Vos dons de ${year} vous donnent déjà ${eur0(d.acquired)} de réduction ; ${eur0(d.example)} de plus en donneraient ${eur0(d.extra)}.`);
      else if (d.acquired > 0) sentences.push(`Vos dons de ${year} vous donnent déjà ${eur0(d.acquired)} de réduction.`);
      else if (d.extra > 0) sentences.push(`${eur0(d.example)} donnés avant le 31 décembre réduiraient votre impôt ${year} de ${eur0(d.extra)}.`);
    }
    const finalReminder = isYearEndFinalReminder(i.now);
    out.push({
      key: `year-end-tax-${year}-${finalReminder ? 'last' : 'early'}`, icon: 'calendar-check', tone: 'info', snoozable: true,
      // « Plus tard » avant le 15 décembre : masquée jusqu'au 15 décembre, où revient le dernier rappel.
      snoozeUntil: finalReminder ? undefined : `${year}-12-15`,
      text: 'Avant le 31 décembre',
      detail: sentences.length > 0
        ? `${sentences.join(' ')} Estimation d'après votre salaire.`
        : `Les versements sur un PER et les dons faits avant le 31 décembre réduisent l'impôt de ${year}.`,
      primary: go('Voir mes dons', 'donations'),
    });
  }
  // Restitution du capital des parents (même tableau que « À rendre », Comptes › Parents) :
  // en décembre, puis après la date prévue tant que rien n'est enregistré. Épinglée en tête.
  const restitution = i.restitution;
  const plannedDate = restitution && !restitution.done ? restitution.plannedDate : undefined;
  const plan = plannedDate ? computeRestitutionPlan(i.accounts, plannedDate) : null;
  if (plannedDate && plan && plan.total > 0) {
    const today = formatISODay(i.now);
    const detail = `${formatEUR(plan.total)} à rendre à vos parents, compte par compte. Leurs intérêts ${plan.interestYear} vous restent.`;
    if (today > plannedDate) out.push({
      key: `restitution-due-${plannedDate}`, icon: 'gift', tone: 'action', snoozable: true, pinned: true,
      text: `La restitution était prévue le ${effectiveDay(plannedDate, year)} : enregistrez-la.`,
      detail,
      primary: go('Enregistrer la restitution', 'parental'),
    });
    else if (i.now.getMonth() === 11 || daysBetween(i.now, parseISODate(plannedDate)) <= 31) out.push({
      key: `restitution-prep-${plannedDate}`, icon: 'gift', tone: 'action', snoozable: true, pinned: true,
      text: `Préparer la restitution du ${effectiveDay(plannedDate, year)}`,
      detail,
      primary: go('Voir la restitution', 'parental'),
    });
  }
  // Intérêts du capital des parents, en décembre : deux chiffres clairs, celui d'aujourd'hui et
  // la projection du tableau « À rendre » (même calcul : computeRestitutionPlan).
  if (i.parentalYearEnd !== null) {
    const toDate = eur0(i.parentalYearEnd);
    const projected = plan && plan.interestYear === year && plan.totalInterest > 1 ? plan.totalInterest : null;
    const when = projected === null || !plannedDate ? null
      : plannedDate > `${year}-12-31` ? 'au 31 décembre' : `à la restitution du ${effectiveDay(plannedDate, year)}`;
    const figures = projected !== null && eur0(projected) !== toDate
      ? `environ ${toDate} à ce jour, ${eur0(projected)} ${when}`
      : `environ ${toDate}`;
    out.push({
      key: `parental-ye-${year}`, icon: 'piggy-bank', tone: 'info', snoozable: true, pinned: true,
      text: `Fin d'année : le capital de vos parents a produit ${figures} d'intérêts cette année. Ils vous reviennent ; le capital, lui, reste à eux.`,
      primary: go('Voir la part parentale', 'parental'),
    });
  }
  if (i.can.deleteAccount) for (const a of i.inactiveEmpty) out.push({
    key: `empty-${a.id}`, icon: 'trash', tone: 'info', snoozable: true,
    text: `${a.name} est à 0 € et inactif.`,
    primary: { label: 'Supprimer', action: { type: 'delete-account', accountId: a.id } },
  });
  // Barème et paramètres fiscaux de la nouvelle année : une étape de la clôture tant qu'elle
  // est proposée (janvier-février, année ouverte) ; rappels à part sinon.
  if (i.can.updateFiscalConfig && i.fiscalReview.newScale && !closingOpen) out.push({
    key: `scale-${i.fiscalReview.newScale.year}`, icon: 'landmark', tone: 'action',
    text: `Nouveau barème de l'impôt : ${i.fiscalReview.newScale.label}.`,
    detail: 'Votre paie nette après impôt est encore calculée avec l\'ancien, qui restera dans l\'historique (Paramètres).',
    primary: { label: 'Appliquer', action: { type: 'apply-tax-scale' } },
  });
  if (i.can.updateFiscalConfig && i.fiscalReview.annualCheckDue && !closingOpen) out.push({
    key: `annual-${year}`, icon: 'landmark', tone: 'action',
    text: `Nouvelle année : vérifiez vos paramètres fiscaux (plafond LEP ${formatEUR(i.fiscalConfig.lepIncomeCeiling ?? 0)}, abattement plafonné à ${formatEUR(i.fiscalConfig.standardAllowanceCap ?? 0)}, barème ${i.fiscalConfig.taxScaleYear ?? 'personnalisé'}).`,
    primary: { label: 'C\'est à jour', action: { type: 'confirm-fiscal-params', year } },
    secondary: i.can.openSettings ? { label: 'Ouvrir les paramètres', action: { type: 'open-settings' } } : undefined,
  });
  const tr = i.taxReturnAlert;
  if (tr && i.taxReturnFiled !== String(tr.incomeYear)) out.push({
    key: tr.key, icon: 'clipboard', tone: 'action', snoozable: true,
    text: `${tr.title} : Pécule a préparé les cases à vérifier.`,
    detail: tr.detail,
    primary: i.can.navigate ? { label: 'Voir les cases', action: { type: 'show-tax-return' } } : undefined,
    secondary: { label: 'C\'est déclaré', action: { type: 'mark-tax-return-filed', incomeYear: tr.incomeYear } },
  });
  // Avis d'impôt (début août à fin septembre) : tant que le revenu fiscal de référence de l'année
  // n'est pas saisi. Même cible que « Importer mon avis » du LEP (Paramètres).
  // Source (vérifiée le 2026-11-05) : https://www.impots.gouv.fr/particulier/questions/quelle-date-mon-avis-dimpot-sur-le-revenu-sera-disponible
  // (en ligne du 24 au 31 juillet 2026, papier en août, certains cas début octobre ou mi-décembre).
  if (isTaxNoticeSeason(i.now)) {
    const entered = (i.rfrByYear?.[String(year - 1)] ?? 0) > 0
      || !!i.lepTimeline?.years.some(y => y.year === year - 1 && y.source === 'avis');
    if (!entered) out.push({
      key: `tax-notice-${year}`, icon: 'landmark', tone: 'action', snoozable: true,
      text: "Votre avis d'impôt est arrivé ?",
      detail: `Importez-le : Pécule y lit votre revenu fiscal de référence ${year - 1}, qui sert à vérifier votre droit au LEP.`,
      primary: go('Importer mon avis', 'settings'),
    });
  }
  // Anniversaire fiscal d'un PEA (5 ans) ou d'une assurance vie (8 ans) : 30 jours.
  for (const a of findFiscalAnniversaries(i.accounts, i.fiscalConfig, i.now)) {
    const text = describeFiscalAnniversary(a);
    out.push({
      key: `fiscal-anniversary-${a.accountId}-${a.date}`, icon: 'calendar-check', tone: 'info', snoozable: true,
      text: text.title, detail: text.detail,
      primary: go('Voir mes comptes', 'accounts'),
    });
  }
  const raise = i.payRaise;
  if (raise) out.push({
    key: `raise-${raise.period}`, icon: 'trending-up', tone: 'action',
    text: `Votre net a augmenté de ${eur0(raise.delta)} par mois (fiche ${elideDe(formatPeriod(raise.period))}).`,
    detail: raise.hasFixedAmount
      ? `« Ajouter » augmente votre épargne mensuelle de ${eur0(raise.delta)}. Si c'est une prime ponctuelle, ignorez.`
      : '« Ajouter » base le Pilotage sur cette fiche. Si c\'est une prime ponctuelle, ignorez.',
    primary: i.can.acceptPayRaise ? { label: 'Ajouter', action: { type: 'accept-pay-raise' } } : undefined,
    secondary: i.can.dismissPayRaise ? { label: 'Ignorer', action: { type: 'dismiss-pay-raise' } } : undefined,
  });
  if (i.avRatesDue.length > 0 && !closingOpen && !closing?.closed) out.push({
    key: `av-rate-${year}`, icon: 'percent', tone: 'action',
    text: `Taux servi ${year - 1} : reportez le nouveau taux du fonds euros ${elideDe(i.avRatesDue.map(a => a.name).join(', '))}, publié par votre assureur en janvier.`,
    primary: go('Mes comptes', 'accounts'),
    secondary: i.can.updateAccounts ? { label: 'Taux inchangé', action: { type: 'confirm-av-rates', accountIds: i.avRatesDue.map(a => a.id) } } : undefined,
  });
  // Un livret dont la date de plafond est prévue (alerte « livret-full ») n'a pas besoin, en
  // plus, de son pourcentage.
  const forecastFull = new Set(i.alerts.filter(a => a.kind === 'livret-full').map(a => a.accountId));
  for (const c of i.ceilingAlerts) if (!forecastFull.has(c.id)) out.push({
    key: `ceiling-${c.id}-${Math.floor(c.pct / 5)}`, icon: 'alert', tone: 'info', snoozable: true,
    text: `${c.name} est rempli à ${Math.round(c.pct)} % : il reste ${eur0(c.remaining)} avant le plafond.`,
    primary: go('Voir le plan', 'pilot'),
  });
  if (i.can.exportData && !closingOpen && (!i.lastExportAt || daysBetween(parseISODate(i.lastExportAt), i.now) >= 90)) out.push({
    key: 'export', icon: 'download', tone: 'info', snoozable: true,
    text: 'Téléchargez une copie de vos données (tous les trois mois, par précaution).',
    detail: 'Pécule garde déjà une copie mensuelle sur votre Drive ; celle-ci reste chez vous.',
    primary: { label: 'Télécharger', action: { type: 'export' } },
  });
  // La copie chiffrée n'est plus envoyée : à dire sans attendre le jour où on en aurait besoin.
  // Pas de carte permanente : un envoi réussi efface l'erreur et rajeunit la date.
  if (i.backupProblem && i.can.openSettings) {
    const p = i.backupProblem;
    out.push({
      key: 'backup-upload-problem', icon: 'alert', tone: 'action', snoozable: true,
      text: p.kind === 'error'
        ? 'Sauvegarde de secours : le dernier envoi a échoué.'
        : p.never ? `Sauvegarde de secours : aucun envoi depuis son activation, il y a ${p.days} jours.`
          : `Sauvegarde de secours : dernier envoi il y a ${p.days} jours.`,
      detail: p.kind === 'error' && p.reason ? `${p.reason} Pécule réessaiera à votre prochaine ouverture.` : 'Ouvrez Pécule connecté à Internet : la copie repart seule. Sinon, regardez l\'état dans les Paramètres.',
      primary: { label: 'Voir la sauvegarde', action: { type: 'check-backup-code' } },
    });
  }
  // Une fois par an : le code de secours est-il toujours à portée de main ? Retapé juste
  // (Paramètres, Données), le rappel disparaît pour un an ; « Plus tard » le reporte.
  if (i.backupCodeCheckDue && i.can.openSettings) out.push({
    key: `backup-code-check-${year}`, icon: 'shield', tone: 'action', snoozable: true,
    text: 'Sauvegarde de secours : vérifiez que votre code de secours est toujours à portée de main.',
    detail: "Sans lui, les copies chiffrées sont illisibles, et on ne s'en aperçoit que le jour où on en a besoin. Retapez-le une fois par an ; perdu, créez-en un nouveau en désactivant puis en réactivant la sauvegarde.",
    primary: { label: 'Vérifier mon code', action: { type: 'check-backup-code' } },
  });
  for (const a of i.alerts) out.push({
    key: a.id, icon: ALERT_ICONS[a.kind], tone: a.tone, snoozable: true,
    text: a.title, detail: a.detail, gain: a.gain,
    primary: a.action ? go(a.action.label, a.action.view) : undefined,
  });
  if (i.emergency && !i.emergency.reached) out.push({
    key: 'emergency', icon: 'life-buoy', tone: 'info', snoozable: true,
    text: `Épargne de précaution : il manque ${eur0(i.emergency.missing)} pour couvrir ${i.emergency.months} mois de dépenses.`,
    detail: 'Gardez-la sur des livrets disponibles à tout moment avant de placer sur l\'assurance vie.',
  });
  return out;
};
