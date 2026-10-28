// ================================================
// FILE: src/lib/idleCash.ts
// L'argent qui dort sur le compte courant, chiffré une seule fois pour toute l'app : l'alerte
// de l'Accueil (lib/alerts), l'encart de l'écran Rendement et l'épargne de précaution
// (lib/planning, qui ne compte pas le coussin) partagent ces règles, donc les mêmes chiffres.
// - Coussin gardé sur le compte courant : un mois et demi de dépenses (charges fixes et argent
//   plaisir), pour les dépenses du quotidien.
// - Seul un solde de compte courant constaté depuis moins de 15 jours est chiffré : plus
//   ancien, il a pu fondre (le rappel « Solde à vérifier » s'en charge).
// - L'excédent va aux livrets, dans l'ordre du plan de placement (meilleur taux, puis LEP >
//   Livret A > LDDS), plafond de chaque compte respecté ; le LEP est écarté s'il va fermer.
//   L'argent du quotidien doit rester disponible à tout moment : jamais vers un placement.
// Fonction pure (aucun accès au stockage ni à l'horloge), testée.
// ================================================
import { AccountType, FiscalConfig, SavingsAccount } from '../types';
import { computePlacementStrategy, PlacementStep } from './finance';
import { CURRENT_ACCOUNT_FRESH_DAYS, isRecentlyChecked } from './freshness';

/** Coussin gardé sur le compte courant : 1,5 mois de dépenses. */
const CASH_BUFFER_MONTHS = 1.5;
/** En dessous, l'argent qui dort ne vaut pas la peine d'être signalé. */
const MIN_DORMANT_EUR = 300;
const MIN_IDLE_GAIN_PER_YEAR = 5;

/** Montant gardé sur le compte courant pour les dépenses du quotidien. */
export const currentAccountBuffer = (monthlySpending: number): number =>
  monthlySpending > 0 ? monthlySpending * CASH_BUFFER_MONTHS : 0;

export interface IdleCash {
  /** Solde (votre part) des comptes courants. */
  cash: number;
  /** Gardé pour les dépenses du quotidien. */
  buffer: number;
  /** Au-delà du coussin, à l'euro inférieur. */
  excess: number;
  /** Où le placer (livrets, plan de placement). */
  steps: PlacementStep[];
  placed: number;
  /** Intérêts par an une fois placé (taux des livrets, sans impôt). */
  gain: number;
  /** Meilleur taux parmi les livrets proposés. */
  bestRate: number;
}

export interface IdleCashInput {
  accounts: SavingsAccount[];
  fiscalConfig: FiscalConfig;
  today: Date;
  /** Dépenses du mois (charges fixes + argent plaisir). Inconnues : rien n'est chiffré. */
  monthlySpending?: number;
  /** false : le LEP va fermer (revenus trop élevés), il n'est plus proposé. */
  lepEligible?: boolean;
}

/**
 * Le LEP reste une destination tant qu'il ne va pas fermer (revenus trop élevés deux ans de
 * suite, lib/lep). Même règle pour l'Accueil et l'écran Rendement.
 */
export const lepStillEligible = (timeline: { status: string } | null | undefined): boolean =>
  !(timeline && (timeline.status === 'closing' || timeline.status === 'closed-due'));

/** Comptes candidats comme destination : LEP retiré s'il va fermer. */
export const idleDestinations = (accounts: SavingsAccount[], lepEligible?: boolean): SavingsAccount[] =>
  lepEligible === false ? accounts.filter(a => a.type !== AccountType.LEP) : accounts;

/** Où placer l'argent qui dort, en mots (« le Livret A et un LDDS à ouvrir ») : Accueil et Rendement. */
export const describeIdleDestinations = (idle: Pick<IdleCash, 'steps'>): string => {
  const names = idle.steps.map(st => (st.accountId ? `le ${st.accountName}` : 'un LDDS à ouvrir'));
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} et ${names[names.length - 1]}`;
};

/**
 * Argent qui dort sur le compte courant et ce qu'il rapporterait sur les livrets. `null` :
 * dépenses inconnues, pas de compte courant, solde trop ancien, excédent sous 300 € ou gain
 * sous 5 € par an, ou aucun livret avec de la place.
 */
export const computeIdleCash = (input: IdleCashInput): IdleCash | null => {
  const spending = input.monthlySpending ?? 0;
  if (!(spending > 0)) return null;
  const current = input.accounts.filter(a => a.type === AccountType.COMPTE_COURANT);
  if (current.length === 0) return null;
  if (current.some(a => !isRecentlyChecked(a, CURRENT_ACCOUNT_FRESH_DAYS, input.today))) return null;
  const cash = current.reduce((s, a) => s + Math.max(0, a.ownedAmount), 0);
  const buffer = currentAccountBuffer(spending);
  const excess = Math.floor(cash - buffer);
  if (excess < MIN_DORMANT_EUR) return null;

  // Livrets sans impôt seulement (le gain affiché est le taux brut) : CEL et livret bancaire écartés.
  const taxFree = idleDestinations(input.accounts, input.lepEligible).filter(a => a.type !== AccountType.CEL && a.type !== AccountType.LIVRET_BANCAIRE);
  const steps = computePlacementStrategy(excess, taxFree, input.fiscalConfig)
    .filter(s => s.isLiquid && !s.infoOnly && s.fillAmount > 0);
  if (steps.length === 0) return null;
  const placed = steps.reduce((s, st) => s + st.fillAmount, 0);
  const gain = steps.reduce((s, st) => s + st.fillAmount * (st.rate || 0) / 100, 0);
  if (gain < MIN_IDLE_GAIN_PER_YEAR) return null;
  return { cash, buffer, excess, steps, placed, gain, bestRate: Math.max(...steps.map(st => st.rate || 0)) };
};
