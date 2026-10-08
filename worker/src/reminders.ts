// ================================================
// FILE: worker/src/reminders.ts
// Rappels envoyés en notification push. Calculés avec EXACTEMENT les mêmes fonctions que
// les bannières de l'app (src/lib/finance.ts, importé tel quel) : une notification ne
// peut donc jamais annoncer autre chose que ce que l'utilisateur verra en ouvrant l'app.
// ================================================
import { AccountType } from '../../src/types';
import type { GlobalAppData } from '../../src/types';
import {
  findDueRecurring,
  findStaleRegulatedRates,
  computeAccruedParentalInterest,
  computeMonthlySavingsCapacity,
  computePlacementStrategy,
  findDueSubscriptions,
  computePayTransfers,
  buildPayLines,
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
import { formatISODay } from '../../src/lib/dates';
import { formatEUR, frenchDay } from '../../src/lib/format';
import { DEFAULT_FISCAL_CONFIG } from '../../src/constants';
import { lepTimelineFromData, describeLepTimeline } from '../../src/lib/lep';
import { computeGoodMonths, computePayReview, motivationSettings } from '../../src/lib/motivation';
import { isReminderEnabled } from '../../src/lib/notificationPrefs';
import type { PushMessage } from './webpush';

export interface Reminder {
  // Clé de dédoublonnage : un même rappel n'est envoyé qu'une fois (le cron tourne
  // chaque jour, l'échéance reste « due » plusieurs jours de suite).
  key: string;
  message: PushMessage;
}

const eur = (n: number) => formatEUR(n, 0);

const STALE_UPDATE_DAYS = 30;
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

  // 4. Aucune actualisation de solde depuis longtemps (même logique que le Dashboard,
  //    seuil plus haut : une notification doit rester rare pour rester lue).
  const todayKey = `${monthKey}-${pad2(D)}`;
  let latest: string | null = null;
  for (const a of accounts) {
    for (const m of a.movements || []) {
      if (m.date <= todayKey && (!latest || m.date > latest)) latest = m.date;
    }
  }
  if (latest) {
    const [y, mo, d] = latest.split('-').map(Number);
    const days = todayN - dayNumber(y, mo, d);
    if (days >= STALE_UPDATE_DAYS) {
      out.push({
        // Une seule fois par « dernière date connue » : une nouvelle saisie réarme le rappel.
        key: `stale:${latest}`,
        message: {
          title: 'Soldes à actualiser',
          body: `Aucune mise à jour de vos comptes depuis ${days} jours.`,
          url: link('update'),
          tag: 'stale-balances',
        },
      });
    }
  }

  // 5. Jour de paie : le plan de placement du Pilotage, pour savoir quoi virer où.
  const payday = data.config?.paydayDay;
  if (payday && payday >= 1 && payday <= 31) {
    // Fenêtre de 3 jours comptée depuis la date de paie, même à cheval sur deux mois (une
    // paie le 30 gardait sinon un seul jour pour un cron manqué).
    const payPeriod = payPeriodOf(payday, now);
    const daysSincePay = todayN - dayNumberOfLocal(payPeriod.payDate);
    if (daysSincePay >= 0 && daysSincePay < PAYDAY_WINDOW_DAYS) {
      const amount = data.config.paydayAmount ?? computeMonthlySavingsCapacity(data);
      const steps = amount > 0
        ? computePlacementStrategy(amount, accounts, data.fiscalConfig || DEFAULT_FISCAL_CONFIG, activeSavingsSplit(data.config, now))
        : [];
      if (steps.length > 0) {
        out.push({
          key: `payday:${payPeriod.key}`,
          message: {
            title: `Salaire versé : ${eur(amount)} à placer`,
            body: [
              ...computePayTransfers({
                expenses: data.expenses || [],
                subscriptions: data.subscriptions,
                leisureBudget: data.config.leisureBudget ?? 0,
                projectSavings: data.config.projectSavings ?? 0,
              }).map(t => `${eur(t.amount)} ${t.label}`),
              `Épargne : ${steps.filter(s => !s.infoOnly).map(s => `${eur(s.fillAmount)} ${s.alert ? `→ ${s.accountName.toLowerCase()}` : `sur ${s.accountName}`}`).join(', ')}`,
            ].join(' · ') + '.',
            url: link('pilot'),
            tag: 'payday',
          },
        });
      }
    }

    // 5 bis. Trois jours après la paie : virements encore ni faits ni cochés dans la liste
    //        du Pilotage. Une seule relance par paie, et rien si tout est coché. La liste
    //        suit la paie (du 27 au 26 suivant), pas le mois calendaire.
    const period = payPeriod;
    const sincePayday = daysSincePay;
    if (sincePayday >= PAYDAY_FOLLOWUP_DELAY_DAYS && sincePayday < PAYDAY_FOLLOWUP_DELAY_DAYS + PAYDAY_WINDOW_DAYS) {
      const checklist = data.payChecklist && data.payChecklist.month === period.key ? data.payChecklist : undefined;
      let lines = checklist?.lines;
      if (!lines) {
        const amount = data.config.paydayAmount ?? computeMonthlySavingsCapacity(data);
        const steps = amount > 0 ? computePlacementStrategy(amount, accounts, data.fiscalConfig || DEFAULT_FISCAL_CONFIG, activeSavingsSplit(data.config, now)) : [];
        lines = buildPayLines(computePayTransfers({
          expenses: data.expenses || [],
          subscriptions: data.subscriptions,
          leisureBudget: data.config.leisureBudget ?? 0,
          projectSavings: data.config.projectSavings ?? 0,
        }), steps);
      }
      const pending = lines.filter(l => !checklist?.done[l.key]);
      if (pending.length > 0) {
        out.push({
          key: `payday-followup:${period.key}`,
          message: {
            title: `${pending.length} virement${pending.length > 1 ? 's' : ''} de paie à faire ou à cocher`,
            body: `${pending.map(l => l.label).join(', ')}. Cochez-les dans le Pilotage une fois faits.`,
            url: link('pilot'),
            tag: 'payday-followup',
          },
        });
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


  // 7. Point de paie : bilan de la fenêtre de paie qui vient de se terminer (src/lib/motivation,
  //    les mêmes chiffres que l'app). Envoyé le premier jour de la nouvelle fenêtre, avec
  //    PAYDAY_WINDOW_DAYS jours de rattrapage si le cron a manqué ; la clé `recap:<paie>`
  //    garantit un seul envoi par paie.
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
    paydayDay: payday && payday >= 1 && payday <= 31 ? payday : undefined,
    payslips: data.payslips,
    threshold: motivation.threshold,
    trackingStartISO: data.config?.trackingStartDate,
  });
  const review = computePayReview({ accounts, goodMonths, today: todayKey, plan, trackingStartISO: data.config?.trackingStartDate });
  const reviewWindow = review && goodMonths.months.find(m => m.key === review.key && m.start === review.start);
  if (review && reviewWindow && reviewWindow.source !== 'calendar') {
    const [ey, em, ed] = review.end.split('-').map(Number);
    const sinceEnd = todayN - dayNumber(ey, em, ed);
    if (sinceEnd >= 0 && sinceEnd < PAYDAY_WINDOW_DAYS) {
      const [sy, sm, sd] = review.start.split('-').map(Number);
      const lastDay = new Date(ey, em - 1, ed - 1);   // dernier jour de la fenêtre (fin exclue)
      const beforeStart = new Date(sy, sm - 1, sd - 1); // veille de la fenêtre
      const ownedEnd = computeAccountBalanceAtDate(accounts, formatISODay(lastDay));
      const ownedStart = computeAccountBalanceAtDate(accounts, formatISODay(beforeStart));
      const pct = ownedStart > 0 ? ((ownedEnd - ownedStart) / ownedStart) * 100 : 0;
      const interest = interestBetween(accounts, beforeStart, lastDay);
      const month = MONTH_NAMES[Number(review.key.slice(5, 7)) - 1];
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
          body: `${paydayReminder.message.body} Paie précédente : ${saved} mis de côté${good ? ', bon mois ✓' : ''}${streak ? `, série de ${streak}` : ''}.`,
        };
      } else {
        const parts = [
          `${saved} mis de côté sur la paie de ${month}${good || review.plan ? ` (${[
            ...(review.plan ? [`objectif ${eur(review.plan)}`] : []),
            ...(good ? ['bon mois ✓'] : []),
          ].join(', ')})` : ''}`,
          ...(streak ? [`série de ${streak}`] : []),
          `épargne ${eur(ownedEnd)} (${pct >= 0 ? '+' : ''}${pct.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %)`,
          ...(interest >= 1 ? [`≈ ${eur(interest)} d'intérêts`] : []),
        ];
        out.push({
          key: `recap:${review.key}`,
          message: {
            title: `Point de paie de ${month}`,
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


  // 8. Mi-janvier : les relevés au 31/12 des placements arrivent. Un seul rappel par an,
  //    et seulement pour les placements dont la valeur n'a pas encore été actualisée.
  if (M === 0 && D >= 15 && D <= 20) {
    const waiting = findAccountsAwaitingAnnualStatement(accounts, now);
    if (waiting.length > 0) {
      out.push({
        key: `annual-statement:${Y}`,
        message: {
          title: 'Relevés annuels de vos placements',
          body: `Reportez la valeur au 31/12 et les versements de ${waiting.map(a => a.name).join(', ')} : les plus-values restent justes.${waiting.some(a => a.type === AccountType.ASSURANCE_VIE) ? ` Pensez aussi au taux servi ${Y - 1} du fonds euros, publié par l'assureur.` : ''}`,
          url: link('update'),
          tag: 'annual-statement',
        },
      });
    }
  }


  // 9. Avril, ouverture de la déclaration en ligne : les dons de l'année écoulée à déclarer.
  if (M === 3 && D >= 10 && D <= 20) {
    const sum = computeDonationSummary(data.donations || [], Y - 1);
    if (sum.count > 0) {
      const missing = sum.missingReceipts.length;
      out.push({
        key: `donations:${sum.year}`,
        message: {
          title: `Déclaration : ${eur(sum.total)} de dons en ${sum.year}`,
          body: `≈ ${eur(sum.reduction)} de réduction d'impôt.` +
            (missing > 0 ? ` ${missing} reçu${missing > 1 ? 's' : ''} fiscal${missing > 1 ? 'aux' : ''} manquant${missing > 1 ? 's' : ''}.` : ' Tous les reçus sont là.'),
          url: link('donations'),
          tag: 'donations',
        },
      });
    }
  }


  // 10. Fin janvier : vérifier les paramètres fiscaux de l'année (barème, plafond LEP,
  //     abattement), tant qu'ils n'ont pas été marqués comme vérifiés dans l'app.
  const year = Y;
  if (M === 0 && D >= 20 && D <= 25 && (data.fiscalConfig?.paramsReviewedYear ?? 0) < year) {
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


  // 12. Début janvier : le bilan de l'année écoulée est prêt (Historique).
  if (M === 0 && D >= 2 && D <= 6 && accounts.length > 0) {
    const y = Y - 1;
    const review = computeYearReview(data, y, now);
    out.push({
      key: `year-review:${y}`,
      message: {
        title: `Votre bilan ${y}`,
        body: `${review.saved >= 0 ? '+' : ''}${eur(review.saved)} mis de côté, ${eur(review.interest)} d'intérêts${review.parentalInterest >= 1 ? ` (dont ${eur(review.parentalInterest)} offerts par vos parents)` : ''}. Le détail dans Historique.`,
        // Ouvre directement « Votre année » de l'année écoulée (lu par Historique).
        url: `${link('history')}&year=${y}`,
        tag: 'year-review',
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
  'payday-followup': 'Des virements de paie restent à faire ou à cocher.',
  sub: 'Un prélèvement approche : le détail est dans l’app.',
  recap: 'Le point de paie est prêt.',
  donations: 'Le récapitulatif de vos dons est prêt.',
  'restitution-prep': 'La restitution approche : le détail est dans l’app.',
  'restitution-day': 'C’est le jour de la restitution : le détail est dans l’app.',
  'year-review': 'Le bilan de l’année est prêt dans Historique.',
};
// Titres qui portent eux-mêmes un montant : seule partie remplacée d'un titre.
const DISCREET_TITLES: Record<string, string> = {
  payday: 'Salaire versé',
  donations: 'Déclaration de vos dons',
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
