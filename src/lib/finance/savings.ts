// Rythme d'épargne, mouvements récurrents, placé ce mois-ci, taux d'épargne.
// Partie de src/lib/finance.ts (qui réexporte tout) : importez depuis '../finance'.
import { AccountType, AccountMovement, RecurringMovement } from '../../types';
import { MS_PER_DAY, formatISODay } from '../dates';
import { signedAmount } from '../money';

// --- RYTHME D'ÉPARGNE RÉEL OBSERVÉ ---
// Extrait du Dashboard (carte "Projection de trajectoire") pour être réutilisable ailleurs
// (Objectifs) sans dupliquer la reconstruction ni risquer que les deux écrans divergent.

/**
 * Reconstruit le total possédé (hors part parentale) à une date passée, en retirant les
 * mouvements postérieurs à cette date. Suppose que les mouvements enregistrés reflètent
 * bien tout le flux depuis l'ouverture du compte (même limite que `stackedData` du
 * Dashboard, dont c'est la méthode d'origine).
 */
/**
 * « Solde initial » : montant saisi à la création d'un compte dans l'app. C'est de
 * l'argent qui existait déjà, pas une épargne nouvelle : il ne doit compter ni dans le
 * « mis de côté », ni dans les rythmes et trajectoires (il gonflait le mois de création).
 */
export const isInitialBalance = (m: AccountMovement) => m.tag === 'initial' || (!m.tag && m.label === 'Solde initial');

/** Mouvement de la part des parents (ajout, correction, restitution) : pas votre argent. */
export const isParentalMovement = (m: AccountMovement) => m.kind === 'parental';

/**
 * Mouvement qui compte comme ÉPARGNE (argent réellement mis de côté ou retiré) : ni
 * valorisation, ni part des parents, ni correction, ni solde initial, et postérieur au
 * « point de départ » du suivi s'il y en a un.
 */
export const isSavingsFlow = (m: AccountMovement, trackingStartISO?: string) =>
  !m.kind && !isInitialBalance(m) && (!trackingStartISO || m.date >= trackingStartISO);

export const computeAccountBalanceAtDate = (
  accounts: { ownedAmount: number; movements?: AccountMovement[] }[],
  dateStr: string
): number =>
  accounts.reduce((total, acc) => {
    let balance = acc.ownedAmount;
    (acc.movements || []).filter(m => m.date > dateStr && !isInitialBalance(m) && !isParentalMovement(m)).forEach(m => {
      balance += m.type === 'IN' ? -m.amount : m.amount;
    });
    return total + balance;
  }, 0);

/**
 * Rythme d'épargne mensuel réellement observé sur `windowDays` jours se terminant à
 * `asOfDate` (paramétrable : passer une date passée donne le rythme de la fenêtre
 * PRÉCÉDENTE, ce que la détection de dérive du Dashboard exploite en rappelant cette
 * fonction avec `asOfDate` décalé d'un trimestre).
 *
 * `null` si la fenêtre ne contient pas assez de mouvements pour extrapoler quoi que ce
 * soit (compte neuf, période creuse) — jamais un chiffre fondé sur du vide.
 *
 * Division par `windowDays / 30` (mois de 30 jours) et non par `AVG_DAYS_PER_MONTH`
 * (30,4375) : ce calcul reprend tel quel celui déjà livré et vérifié en conditions
 * réelles sur le Dashboard — changer de convention aurait légèrement changé des chiffres
 * déjà montrés à l'utilisateur, pour un gain de précision négligeable.
 */
export const computeRecentSavingsRate = (
  accounts: { ownedAmount: number; movements?: AccountMovement[] }[],
  windowDays: number = 90,
  asOfDate: Date = new Date()
): number | null => {
  const past = new Date(asOfDate.getTime() - windowDays * MS_PER_DAY);
  // Cles de jour en heure LOCALE : les mouvements sont dates en local, une cle UTC
  // decalait la fenetre d'un jour entre minuit et ~2h du matin a Paris.
  const nowStr = formatISODay(asOfDate);
  const pastStr = formatISODay(past);

  const hasMovementsInWindow = accounts.some(a => (a.movements || []).some(m => m.date > pastStr && m.date <= nowStr && m.kind !== 'parental' && m.kind !== 'valuation'));
  if (!hasMovementsInWindow) return null;

  const totalNow = computeAccountBalanceAtDate(accounts, nowStr);
  const totalPast = computeAccountBalanceAtDate(accounts, pastStr);
  return (totalNow - totalPast) / (windowDays / 30);
};

// --- MOUVEMENTS RÉCURRENTS ---

export interface DueRecurring {
  recurring: RecurringMovement;
  dueDate: string; // 'YYYY-MM-DD' local, échéance de ce mois
}

/**
 * Échéances récurrentes arrivées à terme ce mois-ci et pas encore enregistrées.
 *
 * « Déjà enregistrée » = un mouvement existe ce mois-ci sur le même compte, de même sens
 * et de même montant. Le libellé n'est volontairement PAS exigé : un versement saisi à la
 * main via l'ajout rapide (libellé différent) ne doit pas être proposé une seconde fois.
 * `skipped` : identifiants déjà écartés par l'utilisateur pour ce mois.
 */
export const findDueRecurring = (
  recurrings: RecurringMovement[],
  accounts: { id: string; movements?: AccountMovement[] }[],
  asOfDate: Date = new Date(),
  skipped: Set<string> = new Set()
): DueRecurring[] => {
  const y = asOfDate.getFullYear();
  const m = asOfDate.getMonth();
  const monthKey = `${y}-${String(m + 1).padStart(2, '0')}`;
  const lastDay = new Date(y, m + 1, 0).getDate();

  return recurrings
    .filter(r => r.active && r.amount > 0 && !skipped.has(r.id))
    .flatMap(r => {
      const day = Math.min(Math.max(1, Math.round(r.dayOfMonth)), lastDay);
      if (asOfDate.getDate() < day) return [];
      const account = accounts.find(a => a.id === r.accountId);
      if (!account) return []; // compte supprimé depuis
      const alreadyDone = (account.movements || []).filter(mv => !isParentalMovement(mv)).some(mv =>
        mv.date.startsWith(monthKey) && mv.type === r.type && Math.abs(mv.amount - r.amount) < 0.005
      );
      if (alreadyDone) return [];
      return [{ recurring: r, dueDate: formatISODay(new Date(y, m, day)) }];
    });
};

// ---------------------------------------------------------------------------
// Placé ce mois-ci
// ---------------------------------------------------------------------------

/**
 * Argent réellement mis de côté ce mois-ci (part propre) : versements − retraits sur les
 * comptes d'épargne. Les virements entre deux comptes d'épargne s'annulent d'eux-mêmes ;
 * les variations de valeur des placements (`kind: 'valuation'`) ne comptent pas.
 */
export const computeMonthSavedAmount = (
  accounts: { type: AccountType; movements?: AccountMovement[] }[],
  asOfDate: Date = new Date(),
  trackingStartISO?: string
): number => {
  const monthKey = `${asOfDate.getFullYear()}-${String(asOfDate.getMonth() + 1).padStart(2, '0')}`;
  const todayKey = formatISODay(asOfDate);
  let total = 0;
  for (const a of accounts) {
    if (a.type === AccountType.COMPTE_COURANT || a.type === AccountType.IMMOBILIER) continue;
    for (const m of a.movements || []) {
      if (!isSavingsFlow(m, trackingStartISO) || !m.date.startsWith(monthKey) || m.date > todayKey) continue;
      total += signedAmount(m);
    }
  }
  return total;
};

// ---------------------------------------------------------------------------
// Taux d'épargne
// ---------------------------------------------------------------------------

export interface MonthSavingsRate {
  month: string;  // 'YYYY-MM'
  saved: number;  // versements − retraits du mois (voir computeMonthSavedAmount)
  rate: number;   // part de la paie, en % (0 si paie inconnue)
}

/**
 * Taux d'épargne des `months` derniers mois, mois en cours inclus (partiel). Rapporté à la
 * paie ACTUELLE : l'app ne connaît pas l'historique exact des salaires.
 */
export const computeSavingsRateHistory = (
  accounts: { type: AccountType; movements?: AccountMovement[] }[],
  monthlyPay: number,
  months: number = 12,
  asOfDate: Date = new Date(),
  trackingStartISO?: string
): MonthSavingsRate[] => {
  const out: MonthSavingsRate[] = [];
  for (let k = months - 1; k >= 0; k--) {
    const end = k === 0
      ? asOfDate
      : new Date(asOfDate.getFullYear(), asOfDate.getMonth() - k + 1, 0);
    const saved = computeMonthSavedAmount(accounts, end, trackingStartISO);
    out.push({
      month: `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}`,
      saved,
      rate: monthlyPay > 0 ? (saved / monthlyPay) * 100 : 0,
    });
  }
  return out;
};
