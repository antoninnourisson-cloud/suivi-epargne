// ================================================
// FILE: src/lib/yearReview.ts
// « Votre année Pécule » : le bilan annuel raconté comme une courte histoire, page par
// page (un grand chiffre, une phrase). Fonction pure, testée.
//
// Les chiffres viennent des calculs existants : `computeYearReview` (mis de côté, taux,
// épargne nette, intérêts, meilleur mois, dons, restitution) et `motivation.ts` (bons
// mois, séries, joker, jalons). Garde-fous : pas de classement, pas de pression, rien qui
// récompense un comportement risqué ; avec `config.gamification === false`, seules les
// pages de chiffres restent (ni bons mois ni jalons).
// ================================================
import type { GlobalAppData } from '../types';
import { computeYearReview, type YearReview } from './agenda';
import { computeGoodMonths, computeMilestones, motivationSettings, type GoodMonthsSummary, type MonthResult } from './motivation';
import { computeAccountBalanceAtDate, computeMonthlySavingsCapacity, isSavingsFlow } from './finance';
import { formatEUR, formatSignedEUR } from './format';
import { formatISODay, parseISODate } from './dates';

export type YearPageId =
  | 'saved' | 'rate' | 'net' | 'interest' | 'good-months' | 'best-month'
  | 'milestones' | 'restitution' | 'donations' | 'next-year';

export interface YearPage {
  id: YearPageId;
  /** Intitulé court de la page. */
  label: string;
  /** Le grand chiffre. */
  value: string;
  /** Une phrase. */
  text: string;
  /** Page liée à la motivation (bons mois, jalons) : absente si elle est désactivée. */
  game?: boolean;
  /** Détail en liste (titres des jalons). */
  items?: string[];
}

export interface YearInReview {
  year: number;
  /** false : année en cours, chiffres arrêtés à aujourd'hui. */
  complete: boolean;
  gamification: boolean;
  /** Rien à raconter (aucun mouvement d'épargne, aucun intérêt, pas de restitution). */
  empty: boolean;
  /** Page d'ouverture (toujours la première de `pages` quand l'année n'est pas vide). */
  headline: YearPage;
  pages: YearPage[];
  /** Mise en garde éventuelle (mouvements qui n'expliquent pas l'évolution de l'épargne). */
  note?: string;
  review: YearReview;
}

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const eur = (n: number) => formatEUR(n, 0);
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const dayLong = (iso: string) => {
  const d = parseISODate(iso);
  return `${d.getDate() === 1 ? '1er' : d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
};
const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`;

/** Années pour lesquelles un récapitulatif a du sens (mouvements ou relevés), la plus récente d'abord. */
export const yearsWithData = (data: GlobalAppData, today: Date = new Date()): number[] => {
  const current = today.getFullYear();
  const set = new Set<number>([current]);
  for (const a of data.accounts || []) for (const m of a.movements || []) set.add(Number(m.date.slice(0, 4)));
  for (const s of data.history || []) set.add(Number(s.date.slice(0, 4)));
  return [...set]
    .filter(y => y > 2000 && y <= current)
    .filter(y => y === current || !isEmptyYear(data, y, computeYearReview(data, y, today)))
    .sort((a, b) => b - a);
};

/** Année proposée par défaut : l'année écoulée jusqu'à fin mars, sinon l'année en cours. */
export const defaultReviewYear = (years: number[], today: Date = new Date()): number => {
  const y = today.getFullYear();
  return today.getMonth() <= 2 && years.includes(y - 1) ? y - 1 : y;
};

/**
 * Rien à raconter : aucun mouvement d'épargne ni relevé mensuel dans l'année, pas de
 * restitution. (Les intérêts d'une année sans aucune donnée seraient une reconstitution
 * à partir des soldes d'aujourd'hui : ils ne suffisent pas à la raconter.)
 */
const isEmptyYear = (data: GlobalAppData, year: number, review: YearReview) => {
  const trackingStart = data.config?.trackingStartDate;
  const hasFlows = (data.accounts || []).some(a => (a.movements || []).some(m => m.date.startsWith(`${year}-`) && isSavingsFlow(m, trackingStart)));
  const hasSnapshots = (data.history || []).some(s => s.date.startsWith(`${year}-`));
  return !hasFlows && !hasSnapshots && !review.restitution;
};

interface StreakStats { good: number; best: number }

/**
 * Bons mois et meilleure série atteinte jusqu'à une date (fenêtres commencées avant
 * `beforeISO`), en relisant les résultats de `computeGoodMonths` (joker compris).
 */
const streakStats = (months: MonthResult[], beforeISO: string): StreakStats => {
  let run = 0, best = 0, good = 0;
  for (const m of months) {
    if (m.start >= beforeISO) break;
    if (m.good) { good++; run++; best = Math.max(best, run); continue; }
    if (m.inProgress || m.joker) continue;
    run = 0;
  }
  return { good, best };
};

const monthsBetween = (fromISO: string, to: Date) => {
  const f = parseISODate(fromISO);
  return (to.getFullYear() - f.getFullYear()) * 12 + (to.getMonth() - f.getMonth());
};

export const buildYearInReview = (data: GlobalAppData, year: number, today: Date = new Date()): YearInReview => {
  const review = computeYearReview(data, year, today);
  const accounts = data.accounts || [];
  const config = data.config || ({} as GlobalAppData['config']);
  const motivation = motivationSettings(config);
  const complete = review.complete;
  const Y = String(year);
  const trackingStart = config.trackingStartDate;

  const empty = isEmptyYear(data, year, review);

  // 1. Mis de côté (le chiffre d'ouverture).
  const headline: YearPage = {
    id: 'saved',
    label: `Mis de côté en ${year}`,
    value: review.saved >= 0 ? eur(review.saved) : formatSignedEUR(review.saved, 0),
    text: review.saved > 0
      ? (complete
        ? 'Versements moins retraits sur vos comptes d\'épargne, de janvier à décembre.'
        : 'Versements moins retraits sur vos comptes d\'épargne depuis le 1er janvier. L\'année n\'est pas finie.')
      : 'Cette année, vous avez surtout puisé dans votre épargne : c\'est aussi à ça qu\'elle sert.',
  };
  if (empty) return { year, complete, gamification: motivation.enabled, empty, headline, pages: [], review };

  const pages: YearPage[] = [headline];

  // 2. Taux d'épargne.
  if (review.savingsRate !== null && review.saved > 0) {
    const rate = Math.round(review.savingsRate);
    pages.push({
      id: 'rate', label: 'Taux d\'épargne', value: `${rate} %`,
      text: `En moyenne, ${rate} % de votre paie a rejoint votre épargne${complete ? '' : ' depuis janvier'} (rapporté à votre paie actuelle).`,
    });
  }

  // 3. Épargne nette : début et fin d'année.
  // Point de départ : le relevé mensuel retenu par computeYearReview, sauf s'il date du
  // milieu de l'année (suivi commencé en cours d'année) : on reconstitue alors le solde du
  // 31 décembre précédent à partir des mouvements, comme computeYearReview sans relevé.
  const lateSnapshot = !!review.netStartDate && review.netStartDate >= `${Y}-02-01`;
  const netStart = lateSnapshot ? computeAccountBalanceAtDate(accounts, `${year - 1}-12-31`) : review.netStart;
  const delta = review.netEnd - netStart;
  const pct = netStart > 0 ? Math.round((delta / netStart) * 100) : null;
  pages.push({
    id: 'net', label: 'Épargne nette', value: eur(review.netEnd),
    text: `${eur(netStart)} en début d'année, ${eur(review.netEnd)} ${complete ? 'au 31 décembre' : 'aujourd\'hui'} : ${formatSignedEUR(delta, 0)}${pct !== null ? ` (${pct >= 0 ? '+' : '−'}${Math.abs(pct)} %)` : ''}.`,
  });

  // 4. Intérêts.
  if (review.interest >= 1) {
    pages.push({
      id: 'interest', label: complete ? 'Intérêts gagnés' : 'Intérêts attendus sur l\'année', value: eur(review.interest),
      text: `${complete ? 'Ce que vos livrets et placements vous ont rapporté' : 'Ce que vos livrets et placements devraient rapporter d\'ici le 31 décembre'}${review.parentalInterest >= 1 ? `, dont ${eur(review.parentalInterest)} offerts par vos parents` : ''}.`,
    });
  }

  // 5. Bons mois, série et joker (paies commencées dans l'année).
  let goodMonths: GoodMonthsSummary | undefined;
  if (motivation.enabled) {
    const firstFlow = accounts
      .flatMap(a => (a.movements || []).filter(m => isSavingsFlow(m, trackingStart)).map(m => m.date))
      .sort()[0];
    const from = firstFlow && firstFlow < `${Y}-01-01` ? firstFlow : `${Y}-01-01`;
    const count = Math.min(360, Math.max(1, monthsBetween(from, today) + 2));
    goodMonths = computeGoodMonths({
      accounts, today: formatISODay(today), paydayDay: config.paydayDay, payslips: data.payslips,
      threshold: motivation.threshold, trackingStartISO: trackingStart, count,
    });
    const inYear = goodMonths.months.filter(m => m.start.startsWith(`${Y}-`));
    const counted = inYear.filter(m => !m.inProgress || m.good);
    if (counted.length > 0) {
      const good = counted.filter(m => m.good).length;
      const { best } = streakStats(goodMonths.months, `${year + 1}-01-01`);
      const joker = goodMonths.jokersUsed.includes(Y);
      const parts = [`Paies après lesquelles vous avez mis au moins ${eur(goodMonths.threshold)} de côté.`];
      if (best >= 2) parts.push(`Plus belle série : ${best} bons mois d'affilée.`);
      if (joker) parts.push('Le joker de l\'année a couvert un mois plus serré.');
      pages.push({ id: 'good-months', label: 'Bons mois', value: `${good} sur ${counted.length}`, text: parts.join(' '), game: true });
    }
  }

  // 6. Meilleur mois (calendaire).
  if (review.best && review.best.saved > 0 && review.monthly.length > 1) {
    pages.push({
      id: 'best-month', label: 'Meilleur mois', value: capitalize(MONTHS[review.best.month]),
      text: `${eur(review.best.saved)} mis de côté : votre plus beau mois de l'année.`,
    });
  }

  // 7. Jalons franchis dans l'année : ceux dont on sait reconstituer l'état au 1er janvier
  // (montant d'épargne, bons mois, séries) ; les autres dépendent de l'état actuel.
  if (goodMonths) {
    const startISO = `${Y}-01-01`, endISO = `${year + 1}-01-01`;
    const at = (beforeISO: string, mySavings: number) => {
      const s = streakStats(goodMonths!.months, beforeISO);
      const summary: GoodMonthsSummary = {
        ...goodMonths!, months: goodMonths!.months.filter(m => m.start < beforeISO),
        goodCount: s.good, bestStreak: s.best, streak: 0, current: undefined,
      };
      return computeMilestones({ accounts, mySavings, monthlySpending: 0, goodMonths: summary })
        .filter(m => m.achieved && /^(savings-|streak-|good-month-)/.test(m.id));
    };
    const before = new Set(at(startISO, netStart).map(m => m.id));
    const reached = at(endISO, review.netEnd).filter(m => !before.has(m.id));
    if (reached.length > 0) {
      pages.push({
        id: 'milestones', label: 'Jalons atteints', value: String(reached.length),
        text: `${plural(reached.length, 'jalon')} franchi${reached.length > 1 ? 's' : ''} ${complete ? 'en' : 'depuis le début de'} ${year}.`,
        items: reached.map(m => m.title), game: true,
      });
    }
  }

  // 8. Restitution du capital des parents.
  if (review.restitution) {
    pages.push({
      id: 'restitution', label: 'Restitution', value: eur(review.restitution.amount),
      text: `Vous avez rendu ${eur(review.restitution.amount)} à vos parents le ${dayLong(review.restitution.date)}. La suite s'écrit en solo.`,
    });
  }

  // 9. Dons.
  if (review.donations > 0) {
    pages.push({ id: 'donations', label: 'Dons', value: eur(review.donations), text: 'Donnés à des associations dans l\'année.' });
  }

  // 10. Un mot pour l'année suivante (seulement si elle n'est pas déjà passée).
  if (year + 1 >= today.getFullYear()) {
    const plan = config.paydayAmount ?? computeMonthlySavingsCapacity(data);
    const next = year + 1;
    const planned = data.parentalRestitution?.plannedDate;
    const soloNext = !data.parentalRestitution?.done && planned?.startsWith(`${next}-`);
    if (plan > 0) {
      pages.push({
        id: 'next-year', label: `Cap sur ${next}`, value: `${eur(plan)} par mois`,
        text: `Au rythme prévu dans votre pilotage, ${next} pourrait ajouter environ ${eur(plan * 12)} à votre épargne.${soloNext ? ` Le ${dayLong(planned as string)}, le capital de vos parents leur revient : vous continuerez en solo.` : ''}`,
      });
    }
  }

  const note = review.unexplainedGap !== undefined
    ? `Vos mouvements de l'année n'expliquent pas toute l'évolution de votre épargne (écart de ${formatSignedEUR(-review.unexplainedGap, 0)}) : « mis de côté » et le meilleur mois peuvent être faussés.`
    : undefined;

  return { year, complete, gamification: motivation.enabled, empty, headline, pages, note, review };
};
