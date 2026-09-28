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
} from '../../src/lib/finance';
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

  return out;
};
