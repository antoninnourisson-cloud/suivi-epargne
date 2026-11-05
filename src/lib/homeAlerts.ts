// Signaux de l'Accueil : épargne à ce jour, livrets presque pleins, comptes vides, dernier mouvement.
// (Extrait de home.ts, code déplacé tel quel ; home.ts le ré-exporte.)
import { AccountType, type FiscalConfig, type PortfolioSnapshot, type SavingsAccount } from '../types';
import { computeAccruedParentalInterest, ownedAmountAt } from './finance';
import { MS_PER_DAY, formatISODay, parseISODate } from './dates';

// ---------------------------------------------------------------------------
// Votre épargne à ce jour
// ---------------------------------------------------------------------------

/**
 * Votre part, tous comptes confondus, à la date `today` : les mouvements datés après sont
 * neutralisés, comme sur la courbe (sinon la carte et le dernier point divergeaient).
 */
export const savingsOn = (accounts: SavingsAccount[], today: string): number =>
  accounts.reduce((s, a) => s + ownedAmountAt(a, today), 0);

/** Évolution de votre part depuis le point mensuel du mois précédent (null sans point). */
export const monthDelta = (history: PortfolioSnapshot[], current: number, today: string): number | null => {
  const monthStart = `${today.slice(0, 7)}-01`;
  const prev = history.filter(h => h.date < monthStart).sort((a, b) => a.date.localeCompare(b.date)).pop();
  return prev && prev.ownedAmount !== undefined ? current - prev.ownedAmount : null;
};

// ---------------------------------------------------------------------------
// Signaux de l'Accueil
// ---------------------------------------------------------------------------

export interface CeilingAlert { id: string; name: string; pct: number; remaining: number }

/**
 * Livrets réglementés presque pleins (90 à 100 % du plafond), le plus rempli d'abord. Le
 * plafond saisi sur le compte prime sur celui des paramètres. Un livret déjà plein n'appelle
 * aucune action (le plan de placement l'ignore déjà) : il n'est pas rappelé.
 */
export const findCeilingAlerts = (accounts: SavingsAccount[], fiscalConfig: Pick<FiscalConfig, 'ceilings'>): CeilingAlert[] => {
  const defaults: Partial<Record<AccountType, number>> = {
    [AccountType.LIVRET_A]: fiscalConfig.ceilings.livretA,
    [AccountType.LDDS]: fiscalConfig.ceilings.ldds,
    [AccountType.LEP]: fiscalConfig.ceilings.lep,
  };
  return accounts
    .map(a => ({ a, ceiling: a.ceiling && a.ceiling > 0 ? a.ceiling : (defaults[a.type] || 0) }))
    .filter(({ ceiling }) => ceiling > 0)
    .map(({ a, ceiling }) => ({ id: a.id, name: a.name, pct: (a.totalAmount / ceiling) * 100, remaining: ceiling - a.totalAmount }))
    .filter(x => x.pct >= 90 && x.pct < 100)
    .sort((x, y) => y.pct - x.pct);
};

/** Comptes à 0 € sans mouvement depuis 60 jours (ou jamais alimentés) : candidats à la suppression. */
export const findInactiveEmptyAccounts = (accounts: SavingsAccount[], now: Date): SavingsAccount[] =>
  accounts.filter(a => {
    if (a.totalAmount !== 0) return false;
    const last = a.movements.reduce<string | null>((max, m) => (!max || m.date > max ? m.date : max), null);
    const ref = last ?? a.openingDate;
    if (!ref) return true; // aucune date connue, jamais alimenté
    return (now.getTime() - parseISODate(ref).getTime()) / MS_PER_DAY >= 60;
  });

/**
 * Jours depuis le dernier mouvement enregistré (tous comptes), null s'il n'y en a aucun. Les
 * mouvements datés dans le futur sont ignorés : un seul rendait le compteur négatif.
 */
export const daysSinceLastMovement = (accounts: SavingsAccount[], now: Date): number | null => {
  const today = formatISODay(now);
  let latest: string | null = null;
  for (const a of accounts) for (const m of a.movements) {
    if (m.date <= today && (!latest || m.date > latest)) latest = m.date;
  }
  return latest ? Math.floor((now.getTime() - parseISODate(latest).getTime()) / MS_PER_DAY) : null;
};

/**
 * Intérêts produits cette année par le capital des parents, rappelés en décembre seulement
 * (ils vous reviennent, le capital reste à eux). Intérêts réellement acquis, pas extrapolés.
 */
export const parentalYearEndInterest = (accounts: SavingsAccount[], now: Date): number | null => {
  if (now.getMonth() !== 11) return null;
  const { totalAnnualParental } = computeAccruedParentalInterest(accounts, now.getFullYear(), now);
  return totalAnnualParental > 1 ? totalAnnualParental : null;
};

/** Placements dont l'argent n'est pas disponible tout de suite (zones hachurées de la courbe). */
export const isConstrainedAccount = (type: AccountType): boolean =>
  [AccountType.ASSURANCE_VIE, AccountType.PEA, AccountType.PEE, AccountType.PER].includes(type);

