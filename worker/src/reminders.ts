// ================================================
// FILE: worker/src/reminders.ts
// Rappels envoyés en notification push. Calculés avec EXACTEMENT les mêmes fonctions que
// les bannières de l'app (src/lib/finance.ts, importé tel quel) : une notification ne
// peut donc jamais annoncer autre chose que ce que l'utilisateur verra en ouvrant l'app.
// ================================================
import type { GlobalAppData } from '../../src/types';
import {
  findDueRecurring,
  findStaleRegulatedRates,
  computeAccruedParentalInterest,
  computeMonthlySavingsCapacity,
  computePlacementStrategy,
  findDueSubscriptions,
  computePayTransfers,
  payPeriodOf,
  activeSavingsSplit,
  computeMonthSavedAmount,
  computeAccountBalanceAtDate,
  computeAccruedInterest,
  computeMonthlyPay,
  findAccountsAwaitingAnnualStatement,
  computeDonationSummary,
  computeRestitutionPlan,
} from '../../src/lib/finance';
import { LATEST_TAX_SCALE } from '../../src/constants';
import { computeYearReview } from '../../src/lib/agenda';
import { closingApplies, isYearClosed } from '../../src/lib/yearClosing';
import { formatISODay, parseISODate } from '../../src/lib/dates';
import { describeStaleBalances, findStaleBalances } from '../../src/lib/freshness';
import { elideDe, formatEUR, formatMonth, frenchDay } from '../../src/lib/format';
import { DEFAULT_FISCAL_CONFIG } from '../../src/constants';
import { lepTimelineFromData, describeLepTimeline } from '../../src/lib/lep';
import { computeGoodMonths, computePayReview, motivationSettings } from '../../src/lib/motivation';
import { isReminderEnabled } from '../../src/lib/notificationPrefs';
import { computeMonthTarget } from '../../src/lib/payAdjustment';
import { isPayReviewDone, liveDone } from '../../src/lib/payRecords';
import { savingsMonthOfPay, validPayday } from '../../src/lib/payCalendar';
import { recommendPayDistribution } from '../../src/lib/payDistribution';
import { buildTaxReturnReminder } from '../../src/lib/taxReturn';
import type { PushMessage } from './webpush';

export interface Reminder {
  // Clé de dédoublonnage : un même rappel n'est envoyé qu'une fois (le cron tourne
  // chaque jour, l'échéance reste « due » plusieurs jours de suite).
  key: string;
  /**
   * Anciennes formes de la clé (rappels de paie avant le mois d'épargne) : un rappel déjà
   * marqué envoyé sous l'une d'elles PAR L'ANCIENNE VERSION n'est pas renvoyé (index.ts).
   */
  legacyKeys?: string[];
  message: PushMessage;
}

const eur = (n: number) => formatEUR(n, 0);

/** Empreinte courte et stable d'un texte (clé de dédoublonnage), en base 36. */
const shortHash = (s: string): string => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36);
};
// Le rappel de paie reste valable quelques jours : un cron manqué (panne, déploiement)
// ne doit pas faire sauter le mois. La clé mensuelle garantit un seul envoi.
const PAYDAY_WINDOW_DAYS = 3;
const PAYDAY_FOLLOWUP_DELAY_DAYS = 3;

// Écran de l'app ouvert au clic (voir le traitement de `?view=` dans App.tsx).
const viewUrl = (appUrl: string, view: string) =>
  view === 'dashboard' ? appUrl : `${appUrl}${appUrl.includes('?') ? '&' : '?'}view=${view}`;

const MONTH_NAMES = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

/** Date civile (calendrier), mois de 1 à 12. */
export interface CivilDate { year: number; month: number; day: number }

const PARIS_PARTS = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' });

/**
 * Jour calendaire à Paris pour un instant donné. Les getters locaux d'un Date sont en UTC
 * dans un Worker : entre minuit et 1 h (2 h l'été) à Paris, ils donneraient la veille.
 */
export const parisCivilDate = (instant: Date): CivilDate => {
  const parts = PARIS_PARTS.formatToParts(instant);
  const get = (type: string) => Number(parts.find(p => p.type === type)!.value);
  return { year: get('year'), month: get('month'), day: get('day') };
};

const pad2 = (n: number) => String(n).padStart(2, '0');
// Numéro de jour absolu d'une date civile : différences en jours exactes, sans heure d'été.
const dayNumber = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d) / 86_400_000;
const dayNumberOfLocal = (d: Date) => dayNumber(d.getFullYear(), d.getMonth() + 1, d.getDate());

/**
 * Intérêts acquis entre le lendemain de `from` et `to` inclus, même à cheval sur deux années
 * (computeAccruedInterest compte depuis le 1er janvier ; une année passée compte en entier).
 */
const interestBetween = (accounts: GlobalAppData['accounts'], from: Date, to: Date): number => {
  let total = 0;
  for (const a of accounts) {
    for (let y = from.getFullYear(); y <= to.getFullYear(); y++) {
      total += computeAccruedInterest(a, y, to) - (y === from.getFullYear() ? computeAccruedInterest(a, y, from) : 0);
    }
  }
  return total;
};

/**
 * Rappels du jour. `today` est la date civile à Paris ; un `Date` est accepté comme instant
 * et converti (la tâche quotidienne passe `new Date()`, les tests une date choisie).
 */
export const computeReminders = (data: GlobalAppData, today: CivilDate | Date, appUrl: string): Reminder[] => {
  const civil = today instanceof Date ? parisCivilDate(today) : today;
  const Y = civil.year, M = civil.month - 1, D = civil.day; // M de 0 à 11, comme getMonth()
  // Les fonctions de src/lib lisent les getters LOCAUX : ce Date (midi local, à l'abri des
  // changements d'heure) les fait correspondre au jour civil parisien, en UTC comme ailleurs.
  const now = new Date(Y, M, D, 12);
  const todayN = dayNumber(Y, M + 1, D);
  const accounts = data.accounts || [];
  const link = (view: string) => viewUrl(appUrl, view);
  // Ouvre le rituel « J'ai reçu ma paie » (useDeepLinks, ?action=pay).
  const payLink = `${link('pilot')}&action=pay`;
  const out: Reminder[] = [];
  const monthKey = `${Y}-${pad2(M + 1)}`;

  // 1. Échéances récurrentes arrivées à terme et pas encore enregistrées.
  for (const { recurring: r } of findDueRecurring(data.recurringMovements || [], accounts, now)) {
    const account = accounts.find(a => a.id === r.accountId);
    out.push({
      key: `recurring:${r.id}:${monthKey}`,
      message: {
        title: `Échéance : ${r.label}`,
        body: `${r.type === 'IN' ? '+' : '-'}${eur(r.amount)} sur ${account?.name ?? 'votre compte'} — à enregistrer dans l'app.`,
        url: link('dashboard'),
        tag: `recurring-${r.id}`,
      },
    });
  }

  // 2. Taux réglementés révisés mais pas encore mis à jour.
  const stale = findStaleRegulatedRates(accounts, now);
  if (stale) {
    out.push({
      key: `rates:${stale.revision.key}`,
      message: {
        title: 'Taux réglementés révisés',
        body: `Révision du ${stale.revision.label} : pensez à mettre à jour ${stale.accounts.map(a => a.name).join(', ')}.`,
        url: link('accounts'),
        tag: 'rate-revision',
      },
    });
  }

  // 3. Décembre : intérêts de la part parentale (accord familial, voir l'app).
  if (M === 11) {
    const { totalAnnualParental } = computeAccruedParentalInterest(accounts, Y, now);
    if (totalAnnualParental > 1) {
      out.push({
        key: `parental:${Y}`,
        message: {
          title: 'Intérêts de fin d’année',
          body: `Les intérêts acquis cette année sur la part de vos parents représentent environ ${eur(totalAnnualParental)}.`,
          url: link('parental'),
          tag: 'parental-interest',
        },
      });
    }
  }

  // 4. Soldes à revérifier, compte par compte (même calcul que « À faire » de l'Accueil,
  //    lib/freshness) : un versement prévu ne compte pas comme un solde constaté.
  const todayKey = `${monthKey}-${pad2(D)}`;
  const staleBalances = findStaleBalances(accounts, parseISODate(todayKey));
  const staleText = describeStaleBalances(staleBalances);
  if (staleText) {
    out.push({
      // Une seule fois par liste de comptes (et date de leur dernier constat) : un nouveau
      // constat ou un nouveau compte en retard réarme le rappel.
      key: `stale:${shortHash(staleBalances.map(s => `${s.id}@${s.checkedOn ?? '-'}`).join(','))}`,
      message: {
        title: staleBalances.length > 1 ? 'Soldes à vérifier' : 'Solde à vérifier',
        body: `${staleText.replace(/^Soldes? à vérifier : /, '')} Comparez avec votre banque, puis Actualiser.`,
        url: link('update'),
        tag: 'stale-balances',
      },
    });
  }

  // 5. Jour de paie : « Paie reçue ? », avec le plan de placement du Pilotage, tant que la paie
  //    de ce mois d'épargne n'est pas déclarée dans l'app (rituel « J'ai reçu ma paie »). Le
  //    clic ouvre directement le rituel (?view=pilot&action=pay).
  //    Clés au MOIS D'ÉPARGNE (lib/payCalendar, règle du 15 : paie du 27 octobre → '2026-11',
  //    du 27 décembre → '2027-01'). Avant, elles portaient le mois de VERSEMENT ('2026-10') :
  //    `legacyKeys` garde l'ancienne forme, pour que le jour de la mise en service n'envoie
  //    pas une seconde fois un rappel déjà parti (voir `send` dans index.ts).
  //    Le serveur ne lit que la dernière version synchronisée du fichier : une paie déclarée
  //    hors ligne peut valoir, au pire, une relance de trop.
  const payday = validPayday(data.config?.paydayDay);
  if (payday) {
    // Date attendue d'après le seul jour de paie (fenêtre de 3 jours comptée depuis elle, même
    // à cheval sur deux mois : une paie le 30 gardait sinon un seul jour pour un cron manqué).
    const payPeriod = payPeriodOf(payday, now);
    const savingsMonth = payPeriod.savingsMonth;
    const legacy = (prefix: string): Pick<Reminder, 'legacyKeys'> =>
      payPeriod.key !== savingsMonth ? { legacyKeys: [`${prefix}:${payPeriod.key}`] } : {};
    const pay = (data.pays ?? []).find(p => p.kind !== 'extra' && savingsMonthOfPay(p) === savingsMonth);
    const daysSincePay = todayN - dayNumberOfLocal(payPeriod.payDate);
    const transfers = () => computePayTransfers({
      expenses: data.expenses || [],
      subscriptions: data.subscriptions,
      leisureBudget: data.config.leisureBudget ?? 0,
      projectSavings: data.config.projectSavings ?? 0,
    });
    // Estimation du Pilotage tant que la paie n'est pas déclarée (même objectif que l'Accueil).
    const estimate = () => {
      const amount = computeMonthTarget(data, now).total;
      const steps = amount > 0
        ? computePlacementStrategy(amount, accounts, data.fiscalConfig || DEFAULT_FISCAL_CONFIG, activeSavingsSplit(data.config, now))
        : [];
      return { amount, steps };
    };
    if (!pay && daysSincePay >= 0 && daysSincePay < PAYDAY_WINDOW_DAYS) {
      const { amount, steps } = estimate();
      if (steps.length > 0) {
        out.push({
          key: `payday:${savingsMonth}`,
          ...legacy('payday'),
          message: {
            title: `Paie reçue ? Environ ${eur(amount)} à placer`,
            body: [
              ...transfers().map(t => `${eur(t.amount)} ${t.label}`),
              `Épargne : ${steps.filter(s => !s.infoOnly).map(s => `${eur(s.fillAmount)} ${s.alert ? `→ ${s.accountName.toLowerCase()}` : `sur ${s.accountName}`}`).join(', ')}`,
            ].join(' · ') + '.',
            url: payLink,
            tag: 'payday',
          },
        });
      }
    }

    // 5 bis. Trois jours après la paie attendue, une seule relance par mois d'épargne (même
    //        clé dans les deux cas) : paie pas encore déclarée, ou lignes de la paie déclarée
    //        ni faites ni cochées. Rien si tout est fait.
    if (daysSincePay >= PAYDAY_FOLLOWUP_DELAY_DAYS && daysSincePay < PAYDAY_FOLLOWUP_DELAY_DAYS + PAYDAY_WINDOW_DAYS) {
      if (!pay) {
        const { steps } = estimate();
        if (transfers().length > 0 || steps.length > 0) {
          out.push({
            key: `payday-followup:${savingsMonth}`,
            ...legacy('payday-followup'),
            message: {
              title: 'Paie pas encore déclarée ?',
              body: `Attendue le ${frenchDay(payPeriod.payDate)}. Dès qu'elle est là, déclarez-la : Pécule vous dit quoi placer, et où.`,
              url: payLink,
              tag: 'payday-followup',
            },
          });
        }
      } else {
        // Plan figé de la paie, sinon celui que la carte « Ma paie » affiche pour le montant reçu.
        const lines = pay.lines.length > 0
          ? pay.lines
          : recommendPayDistribution(data, { amount: pay.amount, bonus: pay.bonus, toSave: pay.toSave, receivedOn: pay.receivedOn }).lines;
        const done = liveDone(pay.done, accounts);
        const pending = lines.filter(l => !done[l.key]);
        if (pending.length > 0) {
          out.push({
            key: `payday-followup:${savingsMonth}`,
            ...legacy('payday-followup'),
            message: {
              title: `${pending.length} virement${pending.length > 1 ? 's' : ''} à faire`,
              body: `${pending.map(l => l.label).join(', ')}. Cochez-les dans « Ma paie » une fois faits.`,
              url: link('pilot'),
              tag: 'payday-followup',
            },
          });
        }
      }
    }
  }

  // 6. Abonnements : la veille sous 100 €, une semaine avant au-delà. Une clé par
  //    prélèvement : le rappel « 7 jours avant » n'est pas répété les jours suivants.
  const eur2 = (n: number) => formatEUR(n, 2);
  for (const { subscription: sub, dueDate, daysUntil } of findDueSubscriptions(data.subscriptions || [], now)) {
    const [y, m, d] = dueDate.split('-').map(Number);
    const day = frenchDay(new Date(y, m - 1, d), true);
    out.push({
      key: `sub:${sub.id}:${dueDate}`,
      message: {
        title: `Prélèvement ${daysUntil === 1 ? 'demain' : `dans ${daysUntil} jours`} : ${sub.name}`,
        body: `${eur2(sub.amount)}${sub.debitAccount ? ` sur ${sub.debitAccount}` : ''}, ${day}.`,
        url: link('subscriptions'),
        tag: `sub-${sub.id}`,
      },
    });
  }


  // 7. Bilan du mois d'épargne qui vient de se terminer (src/lib/motivation, les mêmes
  //    chiffres que la carte « Bilan d'octobre » de l'app). Envoyé le premier jour du nouveau
  //    mois d'épargne, avec PAYDAY_WINDOW_DAYS jours de rattrapage si le cron a manqué ; la clé
  //    `recap:<mois d'épargne>` garantit un seul envoi (ancienne forme : mois de versement de
  //    la paie, gardée en `legacyKeys`). Rien si le bilan est déjà validé dans l'app (étape 0
  //    du rituel « J'ai reçu ma paie », ou carte de l'Accueil).
  //
  //    Fusion avec le rappel du jour de paie (une seule notification ce jour-là) : quand le
  //    rappel `payday:` est émis aujourd'hui, que les deux types sont actifs et que la fenêtre
  //    bilan se termine exactement à cette paie, le bilan est replié en une phrase à la fin du
  //    rappel de paie et AUCUN `recap:` n'est émis. Les deux ont la même fenêtre de 3 jours
  //    comptée depuis le même jour : chaque jour de rattrapage refait la même fusion, et le
  //    rappel de paie (déjà envoyé ou non) est dédoublonné par sa propre clé. Rien ne peut donc
  //    partir en double, ni le bilan arriver seul plus tard. Si la fenêtre s'est terminée un
  //    autre jour (fiche de paie enregistrée avant le jour de paie), le bilan part seul.
  //
  //    Sans jour de paie ni fiche de paie (fenêtres calendaires), ou sans fenêtre suivie :
  //    l'ancien bilan du mois calendaire, du 1er au 3 du mois.
  const prefs = data.config?.notificationPrefs;
  const motivation = motivationSettings(data.config);
  const plan = data.config?.paydayAmount ?? computeMonthlySavingsCapacity(data);
  const goodMonths = computeGoodMonths({
    accounts,
    today: todayKey,
    paydayDay: payday,
    payslips: data.payslips,
    pays: data.pays,
    threshold: motivation.threshold,
    trackingStartISO: data.config?.trackingStartDate,
  });
  const review = computePayReview({ accounts, goodMonths, today: todayKey, plan, trackingStartISO: data.config?.trackingStartDate, pays: data.pays });
  const reviewWindow = review && goodMonths.months.find(m => m.key === review.key && m.start === review.start);
  if (review && reviewWindow && reviewWindow.source !== 'calendar') {
    const [ey, em, ed] = review.end.split('-').map(Number);
    const sinceEnd = todayN - dayNumber(ey, em, ed);
    const reviewed = isPayReviewDone(review.key, data.config?.payReviewsDone, data.pays);
    if (sinceEnd >= 0 && sinceEnd < PAYDAY_WINDOW_DAYS && !reviewed) {
      const [sy, sm, sd] = review.start.split('-').map(Number);
      const lastDay = new Date(ey, em - 1, ed - 1);   // dernier jour de la fenêtre (fin exclue)
      const beforeStart = new Date(sy, sm - 1, sd - 1); // veille de la fenêtre
      const ownedEnd = computeAccountBalanceAtDate(accounts, formatISODay(lastDay));
      const ownedStart = computeAccountBalanceAtDate(accounts, formatISODay(beforeStart));
      const pct = ownedStart > 0 ? ((ownedEnd - ownedStart) / ownedStart) * 100 : 0;
      const interest = interestBetween(accounts, beforeStart, lastDay);
      const bilan = `Bilan ${elideDe(formatMonth(review.key))}`;
      const saved = `${review.saved >= 0 ? '+' : ''}${eur(review.saved)}`;
      // Gamification désactivée : ni « bon mois » ni « série ». Pas de mention d'un mois
      // raté non plus (pas de pression), seulement les chiffres.
      const good = motivation.enabled && review.good;
      const streak = motivation.enabled && goodMonths.streak >= 2 ? goodMonths.streak : 0;
      const paydayReminder = out.find(r => r.key.startsWith('payday:'));
      const sameDayAsPayday = paydayReminder && payday && review.end === formatISODay(payPeriodOf(payday, now).payDate);
      if (paydayReminder && sameDayAsPayday && isReminderEnabled(paydayReminder.key, prefs) && isReminderEnabled(`recap:${review.key}`, prefs)) {
        paydayReminder.message = {
          ...paydayReminder.message,
          body: `${paydayReminder.message.body} ${bilan} : ${saved} mis de côté${good ? ', bon mois ✓' : ''}${streak ? `, série de ${streak}` : ''}.`,
        };
      } else {
        const parts = [
          `${saved} mis de côté${good || review.plan ? ` (${[
            ...(review.plan ? [`objectif ${eur(review.plan)}`] : []),
            ...(good ? ['bon mois ✓'] : []),
          ].join(', ')})` : ''}`,
          ...(streak ? [`série de ${streak}`] : []),
          `épargne ${eur(ownedEnd)} (${pct >= 0 ? '+' : ''}${pct.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %)`,
          ...(interest >= 1 ? [`≈ ${eur(interest)} d'intérêts`] : []),
        ];
        out.push({
          key: `recap:${review.key}`,
          ...(review.payMonth !== review.key ? { legacyKeys: [`recap:${review.payMonth}`] } : {}),
          message: {
            title: bilan,
            body: parts.join(' · ') + '.',
            url: link('dashboard'),
            tag: 'monthly-recap',
          },
        });
      }
    }
  } else if (D <= 3 && accounts.length > 0) {
    const prevEnd = new Date(Y, M, 0);          // dernier jour du mois écoulé
    const prevStart = new Date(prevEnd.getFullYear(), prevEnd.getMonth(), 1);
    const beforeStart = new Date(prevEnd.getFullYear(), prevEnd.getMonth(), 0); // veille du mois écoulé
    const saved = computeMonthSavedAmount(accounts, prevEnd, data.config?.trackingStartDate);
    const ownedEnd = computeAccountBalanceAtDate(accounts, formatISODay(prevEnd));
    const ownedStart = computeAccountBalanceAtDate(accounts, formatISODay(beforeStart));
    const year = prevEnd.getFullYear();
    const interest = accounts.reduce((sum, a) =>
      sum + computeAccruedInterest(a, year, prevEnd)
          - (prevStart.getMonth() === 0 ? 0 : computeAccruedInterest(a, year, beforeStart)), 0);
    const pct = ownedStart > 0 ? ((ownedEnd - ownedStart) / ownedStart) * 100 : 0;
    const month = MONTH_NAMES[prevEnd.getMonth()];
    const pay = computeMonthlyPay(data);
    const parts = [
      `${saved >= 0 ? '+' : ''}${eur(saved)} placés${plan > 0 ? ` (objectif ${eur(plan)})` : ''}${pay > 0 ? `, soit ${Math.round((saved / pay) * 100)} % de votre paie` : ''}`,
      `épargne ${eur(ownedEnd)} (${pct >= 0 ? '+' : ''}${pct.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %)`,
      ...(interest >= 1 ? [`≈ ${eur(interest)} d'intérêts acquis`] : []),
    ];
    out.push({
      key: `recap:${year}-${String(prevEnd.getMonth() + 1).padStart(2, '0')}`,
      message: {
        title: `Bilan de ${month}`,
        body: parts.join(' · ') + '.',
        url: link('dashboard'),
        tag: 'monthly-recap',
      },
    });
  }


  // 8. (Relevés annuels des placements : étape de la clôture de l'année, voir le n° 12.)

  // 9. Avril, ouverture de la déclaration en ligne (le 9 avril en 2026) : rappel pour tout
  //    le monde, avec les points de l'aide à la déclaration qui concernent l'utilisateur
  //    (intérêts, PER, comptes à l'étranger, crypto, dons…). Voir src/lib/taxReturn.ts.
  if (M === 3 && D >= 10 && D <= 20) {
    const incomeYear = Y - 1;
    const reminder = buildTaxReturnReminder(data, incomeYear);
    const sum = computeDonationSummary(data.donations || [], incomeYear);
    const missing = sum.missingReceipts.length;
    const donations = sum.count > 0
      ? ` Dons : ${eur(sum.total)}, ≈ ${eur(sum.reduction)} de réduction d'impôt` +
        (missing > 0 ? `, ${missing} reçu${missing > 1 ? 's' : ''} fiscal${missing > 1 ? 'aux' : ''} manquant${missing > 1 ? 's' : ''}.` : ', tous les reçus sont là.')
      : '';
    out.push({
      key: `tax-return:${incomeYear}`,
      message: {
        title: reminder.title,
        body: reminder.detail + donations,
        url: link('donations'),
        tag: 'tax-return',
      },
    });
  }


  // 10. Fin janvier : vérifier les paramètres fiscaux de l'année (barème, plafond LEP,
  //     abattement), tant qu'ils n'ont pas été marqués comme vérifiés dans l'app. Tant que la
  //     clôture de l'année écoulée est ouverte, c'est une de ses étapes (notification 12) : pas
  //     de seconde notification.
  const year = Y;
  const closingOpen = closingApplies(data, Y - 1) && !isYearClosed(data.config, Y - 1);
  if (M === 0 && D >= 20 && D <= 25 && (data.fiscalConfig?.paramsReviewedYear ?? 0) < year && !closingOpen) {
    out.push({
      key: `fiscal-review:${year}`,
      message: {
        title: `Paramètres fiscaux ${year}`,
        body: `Vérifiez le barème de l'impôt, le plafond du LEP et l'abattement de 10 % : ils changent chaque année.${LATEST_TAX_SCALE.year < year ? '' : ` ${LATEST_TAX_SCALE.label} disponible dans l'app.`}`,
        url: `${link('settings')}&section=fiscal`,
        tag: 'fiscal-review',
      },
    });
  }


  // 10 bis. LEP : éligibilité perdue ou menacée (une notification par nouvel état).
  const lep = lepTimelineFromData(data, now);
  const lepText = describeLepTimeline(lep);
  if (lep && lepText && lep.status !== 'watch') {
    out.push({
      key: `lep:${lep.status}:${lep.closeBy ?? lep.overYear}`,
      message: { title: lepText.title, body: lepText.detail.split(' (estimation')[0], url: link('dashboard'), tag: 'lep' },
    });
  }

  // 11. Restitution du capital parental : préparation début décembre, puis le jour J.
  const restitution = data.parentalRestitution;
  if (restitution?.plannedDate && !restitution.done) {
    const plan = computeRestitutionPlan(accounts, restitution.plannedDate);
    if (plan.total > 0) {
      const [py, pm, pd] = restitution.plannedDate.split('-').map(Number);
      const planned = new Date(py, pm - 1, pd);
      const detail = plan.rows.map(r => `${r.name} ${eur(r.amount)}`).join(', ');
      const plannedLabel = frenchDay(planned) + (planned.getFullYear() !== Y ? ` ${planned.getFullYear()}` : '');
      const daysToPlanned = dayNumber(py, pm, pd) - todayN;
      if (M === 11 && D <= 3 && daysToPlanned > 3) {
        out.push({
          key: `restitution-prep:${restitution.plannedDate}`,
          message: {
            title: 'Restitution du capital de vos parents',
            body: `Prévue le ${plannedLabel} : ${eur(plan.total)} à rendre (${detail}).${plan.totalLost >= 1 ? ` Attention : à cette date, ${eur(plan.totalLost)} d'intérêts sont perdus par rapport au 1er janvier.` : ' Attendez cette date pour garder les intérêts de décembre.'}`,
            url: link('parental'),
            tag: 'restitution',
          },
        });
      }
      if (daysToPlanned <= 0 && daysToPlanned > -3) {
        out.push({
          key: `restitution-day:${restitution.plannedDate}`,
          message: {
            title: `Restitution : ${eur(plan.total)} à rendre`,
            body: `${detail}. Une fois les virements faits, enregistrez la restitution dans l'app (Part parentale).`,
            url: link('parental'),
            tag: 'restitution',
          },
        });
      }
    }
  }


  // 12. Début janvier : la clôture de l'année écoulée (src/lib/yearClosing), UNE notification
  //     au lieu du bilan, des relevés annuels, du taux servi et des paramètres fiscaux séparés :
  //     soldes au 31 décembre, intérêts, relevés, restitution, bilan, déclaration, paramètres
  //     fiscaux, archive. Fenêtre d'une semaine pour
  //     un cron manqué (la clé garantit un seul envoi) ; rien si l'année est déjà clôturée, ni pour
  //     un tout nouvel utilisateur (aucun compte suivi l'an dernier).
  if (M === 0 && D >= 2 && D <= 8 && closingOpen) {
    const y = Y - 1;
    const review = computeYearReview(data, y, now);
    const waiting = findAccountsAwaitingAnnualStatement(accounts, now);
    out.push({
      key: `year-closing:${y}`,
      message: {
        title: `Clôture de l'année ${y}`,
        body: `${review.saved >= 0 ? '+' : ''}${eur(review.saved)} mis de côté, ${eur(review.interest)} d'intérêts${review.parentalInterest >= 1 ? ` (dont ${eur(review.parentalInterest)} offerts par vos parents)` : ''}. `
          + `Soldes au 31 décembre, intérêts${waiting.length > 0 ? `, relevés de ${waiting.map(a => a.name).join(', ')}` : ''}, paramètres fiscaux, bilan et archive : tout est dans Historique, étape par étape.`,
        url: link('history'),
        tag: 'year-closing',
      },
    });
  }

  return out;
};

// ---------- Mode discret ----------

// Texte générique par type de rappel (préfixe de la clé). Utilisé quand le fichier de
// données demande des notifications discrètes : rien de chiffré sur l'écran verrouillé.
const DISCREET_BODIES: Record<string, string> = {
  recurring: 'Une échéance est à enregistrer dans l’app.',
  parental: 'Le point sur les intérêts de fin d’année est prêt.',
  payday: 'Votre rappel de paie est prêt.',
  'payday-followup': 'Votre paie attend dans l’app : à déclarer ou à répartir.',
  sub: 'Un prélèvement approche : le détail est dans l’app.',
  recap: 'Le bilan du mois est prêt.',
  'tax-return': 'Votre aide à la déclaration de revenus est prête dans l’app.',
  'restitution-prep': 'La restitution approche : le détail est dans l’app.',
  'restitution-day': 'C’est le jour de la restitution : le détail est dans l’app.',
  'year-closing': 'La clôture de l’année est prête dans Historique.',
  stale: 'Des soldes de comptes sont à vérifier dans l’app.',
};
// Titres qui portent eux-mêmes un montant : seule partie remplacée d'un titre.
const DISCREET_TITLES: Record<string, string> = {
  payday: 'Paie reçue ?',
  'restitution-day': 'Restitution du capital de vos parents',
};
const GENERIC_BODY = 'Ouvrez Pécule pour voir le détail.';
const HAS_AMOUNT = /\d[\d\s  .,]*\s?€|€\s?\d/;

export const isDiscreet = (data: GlobalAppData | null | undefined): boolean =>
  (data?.config as { discreetNotifications?: unknown } | undefined)?.discreetNotifications === true;

/**
 * Post-traitement des rappels en mode discret : corps génériques par type, titres et liens
 * conservés (sauf un titre qui contiendrait un montant). Les clés de dédoublonnage ne
 * changent pas.
 */
export const applyDiscreetMode = (reminders: Reminder[]): Reminder[] =>
  reminders.map(r => {
    const kind = r.key.split(':')[0];
    const body = DISCREET_BODIES[kind] ?? (HAS_AMOUNT.test(r.message.body) ? GENERIC_BODY : r.message.body);
    const title = HAS_AMOUNT.test(r.message.title) ? (DISCREET_TITLES[kind] ?? 'Pécule') : r.message.title;
    return { ...r, message: { ...r.message, title, body } };
  });
