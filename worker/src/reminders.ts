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
import { frenchDay } from '../../src/lib/format';
import { DEFAULT_FISCAL_CONFIG } from '../../src/constants';
import type { PushMessage } from './webpush';

export interface Reminder {
  // Clé de dédoublonnage : un même rappel n'est envoyé qu'une fois (le cron tourne
  // chaque jour, l'échéance reste « due » plusieurs jours de suite).
  key: string;
  message: PushMessage;
}

const eur = (n: number) =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);

const STALE_UPDATE_DAYS = 30;
// Le rappel de paie reste valable quelques jours : un cron manqué (panne, déploiement)
// ne doit pas faire sauter le mois. La clé mensuelle garantit un seul envoi.
const PAYDAY_WINDOW_DAYS = 3;
const PAYDAY_FOLLOWUP_DELAY_DAYS = 3;

// Écran de l'app ouvert au clic (voir le traitement de `?view=` dans App.tsx).
export const viewUrl = (appUrl: string, view: string) =>
  view === 'dashboard' ? appUrl : `${appUrl}${appUrl.includes('?') ? '&' : '?'}view=${view}`;

const MONTH_NAMES = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

export const computeReminders = (data: GlobalAppData, now: Date, appUrl: string): Reminder[] => {
  const accounts = data.accounts || [];
  const link = (view: string) => viewUrl(appUrl, view);
  const out: Reminder[] = [];
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

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
  if (now.getMonth() === 11) {
    const { totalAnnualParental } = computeAccruedParentalInterest(accounts, now.getFullYear(), now);
    if (totalAnnualParental > 1) {
      out.push({
        key: `parental:${now.getFullYear()}`,
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
  const todayKey = `${monthKey}-${String(now.getDate()).padStart(2, '0')}`;
  let latest: string | null = null;
  for (const a of accounts) {
    for (const m of a.movements || []) {
      if (m.date <= todayKey && (!latest || m.date > latest)) latest = m.date;
    }
  }
  if (latest) {
    const [y, mo, d] = latest.split('-').map(Number);
    const days = Math.floor((now.getTime() - new Date(y, mo - 1, d).getTime()) / 86_400_000);
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
    const daysSincePay = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() - payPeriod.payDate.getTime()) / 86_400_000);
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
  const eur2 = (n: number) =>
    new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n);
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


  // 7. Bilan du mois écoulé (1er au 3 du mois, une fois) : épargne placée face au plan,
  //    évolution de l'épargne nette, intérêts acquis.
  if (now.getDate() <= 3 && accounts.length > 0) {
    const prevEnd = new Date(now.getFullYear(), now.getMonth(), 0);          // dernier jour du mois écoulé
    const prevStart = new Date(prevEnd.getFullYear(), prevEnd.getMonth(), 1);
    const beforeStart = new Date(prevEnd.getFullYear(), prevEnd.getMonth(), 0); // veille du mois écoulé
    const saved = computeMonthSavedAmount(accounts, prevEnd);
    const plan = data.config?.paydayAmount ?? computeMonthlySavingsCapacity(data);
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
  if (now.getMonth() === 0 && now.getDate() >= 15 && now.getDate() <= 20) {
    const waiting = findAccountsAwaitingAnnualStatement(accounts, now);
    if (waiting.length > 0) {
      out.push({
        key: `annual-statement:${now.getFullYear()}`,
        message: {
          title: 'Relevés annuels de vos placements',
          body: `Reportez la valeur au 31/12 et les versements de ${waiting.map(a => a.name).join(', ')} : les plus-values restent justes.${waiting.some(a => a.type === AccountType.ASSURANCE_VIE) ? ` Pensez aussi au taux servi ${now.getFullYear() - 1} du fonds euros, publié par l'assureur.` : ''}`,
          url: link('update'),
          tag: 'annual-statement',
        },
      });
    }
  }


  // 9. Avril, ouverture de la déclaration en ligne : les dons de l'année écoulée à déclarer.
  if (now.getMonth() === 3 && now.getDate() >= 10 && now.getDate() <= 20) {
    const sum = computeDonationSummary(data.donations || [], now.getFullYear() - 1);
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
  const year = now.getFullYear();
  if (now.getMonth() === 0 && now.getDate() >= 20 && now.getDate() <= 25 && (data.fiscalConfig?.paramsReviewedYear ?? 0) < year) {
    out.push({
      key: `fiscal-review:${year}`,
      message: {
        title: `Paramètres fiscaux ${year}`,
        body: `Vérifiez le barème de l'impôt, le plafond du LEP et l'abattement de 10 % : ils changent chaque année.${LATEST_TAX_SCALE.year < year ? '' : ` ${LATEST_TAX_SCALE.label} disponible dans l'app.`}`,
        url: link('settings'),
        tag: 'fiscal-review',
      },
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
      const plannedLabel = frenchDay(planned) + (planned.getFullYear() !== now.getFullYear() ? ` ${planned.getFullYear()}` : '');
      const today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const daysToPlanned = Math.round((planned.getTime() - today0.getTime()) / 86_400_000);
      if (now.getMonth() === 11 && now.getDate() <= 3 && daysToPlanned > 3) {
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
  if (now.getMonth() === 0 && now.getDate() >= 2 && now.getDate() <= 6 && accounts.length > 0) {
    const y = now.getFullYear() - 1;
    const review = computeYearReview(data, y, now);
    out.push({
      key: `year-review:${y}`,
      message: {
        title: `Votre bilan ${y}`,
        body: `${review.saved >= 0 ? '+' : ''}${eur(review.saved)} mis de côté, ${eur(review.interest)} d'intérêts${review.parentalInterest >= 1 ? ` (dont ${eur(review.parentalInterest)} offerts par vos parents)` : ''}. Le détail dans Historique.`,
        url: link('history'),
        tag: 'year-review',
      },
    });
  }

  return out;
};
