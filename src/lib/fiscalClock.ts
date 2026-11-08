// Calendrier fiscal (Impôts › Calendrier fiscal, ex-« Horloge fiscale » du Pilotage) : quand
// chaque PEA, PEE ou assurance-vie devient disponible sans surcoût d'impôt.
import { AccountType, type FiscalConfig, type SavingsAccount } from '../types';
import { computeMaturityCountdown, computePeeAvailability, describeMaturity } from './finance';
import { parseISODate } from './dates';
import { formatEUR } from './format';

export interface FiscalClockItem {
  id: string;
  name: string;
  type: string;
  date: string;
  timeLeft: string;
  isAvailable: boolean;
  /** Précision en une phrase (ex. PEE : ce qui se débloque à l'échéance). */
  note?: string;
}

export const computeFiscalClock = (accounts: SavingsAccount[], fiscalConfig: FiscalConfig): FiscalClockItem[] =>
  accounts.filter(a => [AccountType.PEE, AccountType.PEA, AccountType.ASSURANCE_VIE].includes(a.type)).map((acc): FiscalClockItem | null => {
    // PEE : chaque versement est bloqué 5 ans (date de fin de contrat passée : tout est
    // libre). On annonce le prochain déblocage, calculé versement par versement.
    if (acc.type === AccountType.PEE) {
      const pee = computePeeAvailability(acc, fiscalConfig);
      const release = pee.nextRelease;
      if (pee.blocked < 0.5) return { id: acc.id, name: acc.name, type: acc.type, date: '', timeLeft: 'Disponible', isAvailable: true };
      const free = pee.available >= 1 ? `${formatEUR(pee.available, 0)} déjà disponibles. ` : '';
      // Solde initial d'un plan plus ancien, ou solde sans mouvements : dates de versement
      // inconnues, compté bloqué par prudence (jamais une date de déblocage inventée).
      const unknown = pee.undated
        ? 'Une partie de votre solde n\'a pas de date de versement connue (par exemple ce qui était déjà sur le plan quand vous l\'avez ajouté) : elle est comptée bloquée par prudence. Votre relevé d\'épargne salariale donne les dates exactes.'
        : '';
      if (!release) {
        return { id: acc.id, name: acc.name, type: acc.type, date: '', timeLeft: 'Date inconnue', isAvailable: false,
          note: `${free}${unknown}` };
      }
      return {
        id: acc.id, name: acc.name, type: acc.type,
        date: parseISODate(release.date).toLocaleDateString('fr-FR'),
        timeLeft: `${Math.floor(release.monthsRemaining / 12) > 0 ? Math.floor(release.monthsRemaining / 12) + 'a ' : ''}${release.monthsRemaining % 12}m`,
        isAvailable: false,
        note: `${free}${release.last ? 'Tout le reste se débloque' : `${formatEUR(release.amount, 0)} se débloquent`} à cette date : chaque versement reste bloqué ${fiscalConfig.legalMaturity.pee} ans.${unknown ? ` ${unknown}` : ''}`,
      };
    }
    // PEA / assurance vie : MÊME calcul que le badge de "Mes comptes"
    // (computeMaturityCountdown) et le même texte (describeMaturity).
    if (!acc.openingDate) return null;
    const countdown = computeMaturityCountdown(acc, fiscalConfig);
    if (!countdown) {
      // computeMaturityCountdown renvoie null pour "déjà mature" : ici c'est une info
      // à afficher, pas à masquer.
      return { id: acc.id, name: acc.name, type: acc.type, date: '', timeLeft: 'Disponible', isAvailable: true };
    }
    const years = Math.floor(countdown.monthsRemaining / 12);
    const months = countdown.monthsRemaining % 12;
    return {
      id: acc.id, name: acc.name, type: acc.type,
      date: parseISODate(countdown.maturityDate).toLocaleDateString('fr-FR'),
      timeLeft: `${years > 0 ? years + 'a ' : ''}${months}m`,
      isAvailable: false,
      // « Bloqué » jusqu'à l'échéance au sens de l'impôt seulement : on le précise.
      note: `Retirable avant, avec plus d'impôt${acc.type === AccountType.PEA ? ' (et le plan est clôturé)' : ''}. À l'échéance : ${describeMaturity(acc, countdown, fiscalConfig).detail}.`,
    };
  }).filter((item): item is FiscalClockItem => item !== null);

// ---------------------------------------------------------------------------
// Anniversaire fiscal : le jour où un PEA atteint son 5e anniversaire ou une assurance vie son 8e
// ---------------------------------------------------------------------------

export interface FiscalAnniversary {
  accountId: string;
  name: string;
  type: AccountType.PEA | AccountType.ASSURANCE_VIE;
  /** Âge atteint (la durée légale du type de compte dans les paramètres fiscaux). */
  years: number;
  /** Jour de l'anniversaire (ISO). */
  date: string;
  /** Jours écoulés depuis l'anniversaire (0 = aujourd'hui). */
  daysSince: number;
  /** Ce que ça change, en une phrase : le MÊME texte que le badge de maturité (describeMaturity). */
  detail: string;
}

/** Fenêtre pendant laquelle la tâche de l'Accueil reste affichée après l'anniversaire. */
const FISCAL_ANNIVERSARY_DAYS = 30;

/**
 * Comptes PEA / assurance vie (avec un solde et une date d'ouverture) dont l'anniversaire fiscal
 * est tombé aujourd'hui ou dans les `windowDays - 1` jours qui précèdent. Même date que
 * computeMaturityCountdown (ouverture + durée légale, jour pour jour).
 */
export const findFiscalAnniversaries = (
  accounts: SavingsAccount[],
  fiscalConfig: FiscalConfig,
  now: Date,
  windowDays: number = FISCAL_ANNIVERSARY_DAYS,
): FiscalAnniversary[] => {
  const out: FiscalAnniversary[] = [];
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  for (const acc of accounts) {
    if (acc.type !== AccountType.PEA && acc.type !== AccountType.ASSURANCE_VIE) continue;
    if (!acc.openingDate || !(acc.totalAmount > 0)) continue;
    const years = acc.type === AccountType.PEA ? fiscalConfig.legalMaturity.pea : fiscalConfig.legalMaturity.assuranceVie;
    const opening = parseISODate(acc.openingDate);
    const anniversary = new Date(opening.getFullYear() + years, opening.getMonth(), opening.getDate());
    const daysSince = Math.round((today.getTime() - anniversary.getTime()) / 86_400_000);
    if (daysSince < 0 || daysSince >= windowDays) continue;
    // La veille, le compte n'est pas encore mature : le calcul du badge donne ce qui change.
    const eve = new Date(anniversary.getFullYear(), anniversary.getMonth(), anniversary.getDate() - 1);
    const countdown = computeMaturityCountdown(acc, fiscalConfig, eve);
    if (!countdown) continue;
    out.push({
      accountId: acc.id, name: acc.name, type: acc.type, years, daysSince,
      date: `${anniversary.getFullYear()}-${String(anniversary.getMonth() + 1).padStart(2, '0')}-${String(anniversary.getDate()).padStart(2, '0')}`,
      detail: `${describeMaturity(acc, countdown, fiscalConfig).detail}.`,
    });
  }
  return out;
};

/** Annonce commune à la tâche de l'Accueil et au rappel : « Anniversaire fiscal : PEA Bourse a 5 ans aujourd'hui. » */
export const describeFiscalAnniversary = (a: FiscalAnniversary): { title: string; detail: string } => ({
  title: `Anniversaire fiscal : ${a.name} a ${a.years} ans${a.daysSince === 0 ? " aujourd'hui" : ''}.`,
  detail: `Ce que ça change : ${a.detail}`,
});
