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
} from '../../src/lib/finance';
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

export const computeReminders = (data: GlobalAppData, now: Date, appUrl: string): Reminder[] => {
  const accounts = data.accounts || [];
  const out: Reminder[] = [];
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  // 1. Échéances récurrentes arrivées à terme et pas encore enregistrées.
  for (const { recurring: r } of findDueRecurring(data.recurringMovements || [], accounts, now)) {
    const account = accounts.find(a => a.id === r.accountId);
    out.push({
      key: `recurring:${r.id}:${monthKey}`,
      message: {
        title: `Échéance : ${r.label}`,
        body: `${r.type === 'IN' ? '+' : '-'}${eur(r.amount)} sur ${account?.name ?? 'ton compte'} — à enregistrer dans l'app.`,
        url: appUrl,
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
        body: `Révision du ${stale.revision.label} : pense à mettre à jour ${stale.accounts.map(a => a.name).join(', ')}.`,
        url: appUrl,
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
          body: `Les intérêts acquis cette année sur la part de tes parents représentent environ ${eur(totalAnnualParental)}.`,
          url: appUrl,
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
          body: `Aucune mise à jour de tes comptes depuis ${days} jours.`,
          url: appUrl,
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
            body: steps.map(s => `${eur(s.fillAmount)} ${s.alert ? '→ ouvrir un PEA/AV' : `sur ${s.accountName}`}`).join(', ') + '.',
            url: appUrl,
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
        url: appUrl,
        tag: `sub-${sub.id}`,
      },
    });
  }

  return out;
};
