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
  computeMonthSavedAmount,
  computeAccountBalanceAtDate,
  computeAccruedInterest,
  computeMonthlyPay,
  findAccountsAwaitingAnnualStatement,
  computeDonationSummary,
} from '../../src/lib/finance';
import { formatISODay } from '../../src/lib/dates';
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
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const effectiveDay = Math.min(payday, daysInMonth); // le 31 devient le 30 ou le 28
    const today = now.getDate();
    if (today >= effectiveDay && today < effectiveDay + PAYDAY_WINDOW_DAYS) {
      const amount = data.config.paydayAmount ?? computeMonthlySavingsCapacity(data);
      const steps = amount > 0
        ? computePlacementStrategy(amount, accounts, data.fiscalConfig || DEFAULT_FISCAL_CONFIG)
        : [];
      if (steps.length > 0) {
        out.push({
          key: `payday:${monthKey}`,
          message: {
            title: `Salaire versé : ${eur(amount)} à placer`,
            body: [
              ...computePayTransfers({
                expenses: data.expenses || [],
                subscriptions: data.subscriptions,
                leisureBudget: data.config.leisureBudget ?? 0,
                projectSavings: data.config.projectSavings ?? 0,
              }).map(t => `${eur(t.amount)} ${t.label}`),
              `Épargne : ${steps.map(s => `${eur(s.fillAmount)} ${s.alert ? '→ ouvrir un PEA/AV' : `sur ${s.accountName}`}`).join(', ')}`,
            ].join(' · ') + '.',
            url: link('pilot'),
            tag: 'payday',
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
    const day = new Date(y, m - 1, d).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
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
          body: `Reportez la valeur au 31/12 et les versements de ${waiting.map(a => a.name).join(', ')} : les plus-values restent justes.`,
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

  return out;
};
