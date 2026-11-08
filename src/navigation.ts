// Source unique de la navigation : écrans, onglets, anciennes adresses (alias), menu latéral
// (ordinateur), barre du bas et panneau « Plus » (mobile), liens profonds.
//
// Modèle : 7 écrans (Accueil, Actualiser, Comptes, Pilotage, Analyses, Impôts, Paramètres) ;
// Comptes, Pilotage, Analyses et Impôts ont des onglets. Un endroit de l'app est une `Place`
// (écran + onglet). Les anciennes clés d'écran (`?view=payslips`, liens de l'Accueil, de
// l'Agenda, des notifications, `lastView` d'un ancien fichier) restent valables : chacune est
// un alias qui ouvre TOUJOURS son onglet explicite. L'onglet mémorisé d'un écran ne sert
// qu'aux gestes de navigation (barre du bas, « Plus », menu latéral).
import { LayoutDashboard, RefreshCcw, Wallet, ShieldCheck, LineChart, Settings as SettingsIcon, Landmark } from 'lucide-react';
import type { ComponentType } from 'react';

// ---------------------------------------------------------------------------
// Écrans et onglets
// ---------------------------------------------------------------------------

const SCREENS = ['dashboard', 'update', 'accounts', 'pilot', 'analyses', 'taxes', 'settings'] as const;
export type Screen = typeof SCREENS[number];
export const isScreen = (v: unknown): v is Screen => typeof v === 'string' && (SCREENS as readonly string[]).includes(v);

/** Onglets de chaque écran à onglets, dans l'ordre d'affichage (le premier est celui par défaut). */
export const SCREEN_TABS = {
  accounts: [{ key: 'balances', label: 'Soldes' }, { key: 'movements', label: 'Mouvements' }, { key: 'parents', label: 'Parents' }],
  pilot: [{ key: 'month', label: 'Ce mois' }, { key: 'subscriptions', label: 'Abonnements' }, { key: 'payslips', label: 'Fiches de paie' }, { key: 'wishes', label: 'Envies' }],
  analyses: [{ key: 'evolution', label: 'Évolution' }, { key: 'yield', label: 'Rendement' }, { key: 'agenda', label: 'Agenda' }, { key: 'simulator', label: 'Et si…' }],
  taxes: [{ key: 'donations', label: 'Dons et déclaration' }, { key: 'calendar', label: 'Calendrier fiscal' }],
} as const;
type TabbedScreen = keyof typeof SCREEN_TABS;
export type ScreenTab = { [S in TabbedScreen]: typeof SCREEN_TABS[S][number]['key'] }[TabbedScreen];

const isTabbed = (s: Screen): s is TabbedScreen => s in SCREEN_TABS;

/** Onglets d'un écran (vide pour un écran sans onglets). */
export const tabsOf = (screen: Screen): readonly { key: ScreenTab; label: string }[] => (isTabbed(screen) ? SCREEN_TABS[screen] : []);
export const isTabOf = (screen: Screen, tab: unknown): tab is ScreenTab => tabsOf(screen).some(t => t.key === tab);

/** Un endroit de l'app : un écran, et son onglet s'il en a. */
export interface Place { screen: Screen; tab?: ScreenTab }

export const SCREEN_LABELS: Record<Screen, string> = {
  dashboard: 'Accueil', update: 'Actualiser les soldes', accounts: 'Comptes', pilot: 'Pilotage',
  analyses: 'Analyses', taxes: 'Impôts', settings: 'Paramètres',
};

/** Onglet par défaut d'un écran (premier onglet), `undefined` pour un écran sans onglets. */
const defaultTab = (screen: Screen): ScreenTab | undefined => tabsOf(screen)[0]?.key;

/** Endroit complet d'un écran : l'onglet demandé s'il lui appartient, sinon celui par défaut. */
export const placeIn = (screen: Screen, tab?: unknown): Place => {
  const t = isTabOf(screen, tab) ? tab : defaultTab(screen);
  return t ? { screen, tab: t } : { screen };
};

export const samePlace = (a: Place, b: Place): boolean => a.screen === b.screen && a.tab === b.tab;

/** Titre de l'onglet du navigateur : « Comptes · Mouvements », « Accueil ». */
export const placeLabel = (p: Place): string => {
  const tab = p.tab && tabsOf(p.screen).find(t => t.key === p.tab);
  return tab ? `${SCREEN_LABELS[p.screen]} · ${tab.label}` : SCREEN_LABELS[p.screen];
};

/**
 * Onglets masqués (mode solo : « Parents ») : un endroit sur un onglet masqué retombe sur
 * l'onglet par défaut de l'écran (Comptes › Parents → Comptes › Soldes).
 */
export const visiblePlace = (p: Place, hiddenTabs: readonly ScreenTab[]): Place =>
  (p.tab && hiddenTabs.includes(p.tab) ? placeIn(p.screen) : p);

// ---------------------------------------------------------------------------
// Clés d'écran (anciennes et nouvelles) : alias vers un endroit
// ---------------------------------------------------------------------------

const VIEWS = [
  'dashboard', 'update', 'accounts', 'transfers', 'journal', 'pilot', 'subscriptions', 'payslips',
  'wishes', 'donations', 'yield', 'history', 'simulator', 'agenda', 'parental', 'settings', 'analyses', 'taxes',
] as const;
/** Clé d'écran des liens (`?view=`, liens internes, notifications) : un alias vers un endroit. */
export type View = typeof VIEWS[number];
export const isView = (v: unknown): v is View => typeof v === 'string' && (VIEWS as readonly string[]).includes(v);

/** Table d'alias : chaque clé ouvre cet écran ET cet onglet, jamais l'onglet mémorisé. */
export const VIEW_ALIASES: Record<View, Place> = {
  dashboard: { screen: 'dashboard' },
  update: { screen: 'update' },
  accounts: { screen: 'accounts', tab: 'balances' },
  transfers: { screen: 'accounts', tab: 'movements' },
  journal: { screen: 'accounts', tab: 'movements' },
  parental: { screen: 'accounts', tab: 'parents' },
  pilot: { screen: 'pilot', tab: 'month' },
  subscriptions: { screen: 'pilot', tab: 'subscriptions' },
  payslips: { screen: 'pilot', tab: 'payslips' },
  wishes: { screen: 'pilot', tab: 'wishes' },
  history: { screen: 'analyses', tab: 'evolution' },
  yield: { screen: 'analyses', tab: 'yield' },
  agenda: { screen: 'analyses', tab: 'agenda' },
  simulator: { screen: 'analyses', tab: 'simulator' },
  analyses: { screen: 'analyses', tab: 'evolution' },
  donations: { screen: 'taxes', tab: 'donations' },
  taxes: { screen: 'taxes', tab: 'donations' },
  settings: { screen: 'settings' },
};

/**
 * Endroit d'une clé d'écran. `tab` (paramètre `&tab=` d'un lien) choisit un autre onglet du
 * même écran ; inconnu, il est ignoré et l'onglet de l'alias reste.
 */
export const placeOf = (v: View, tab?: unknown): Place => {
  const alias = VIEW_ALIASES[v];
  return isTabOf(alias.screen, tab) ? { screen: alias.screen, tab } : alias;
};

/** Forme enregistrée de l'endroit (`lastView`) : « pilot/subscriptions », « dashboard ». */
export const encodePlace = (p: Place): string => (p.tab ? `${p.screen}/${p.tab}` : p.screen);

/**
 * Relit un `lastView` : la forme « écran/onglet », ou une ancienne clé d'écran (fichier d'une
 * version précédente, enregistré sur Drive). Inconnu : `null`.
 */
export const parsePlace = (v: unknown): Place | null => {
  if (typeof v !== 'string') return null;
  const [screen, tab, ...rest] = v.split('/');
  if (rest.length === 0 && tab !== undefined) return isScreen(screen) && isTabOf(screen, tab) ? { screen, tab } : null;
  return isView(v) ? placeOf(v) : null;
};

// ---------------------------------------------------------------------------
// Menus (barre du bas, « Plus », menu latéral)
// ---------------------------------------------------------------------------
// Les menus ne nomment que des écrans : un geste de menu rouvre l'onglet mémorisé de l'écran
// (openScreen). Les liens vers une ancienne clé (navigate) ouvrent l'onglet de leur alias.

/** Icônes des écrans (menus). */
export const SCREEN_ICONS: Record<Screen, ComponentType<{ className?: string }>> = {
  dashboard: LayoutDashboard, update: RefreshCcw, accounts: Wallet, pilot: ShieldCheck,
  analyses: LineChart, taxes: Landmark, settings: SettingsIcon,
};

/** Libellé court de la barre du bas (sinon le nom de l'écran). */
export const SCREEN_SHORT_LABELS: Partial<Record<Screen, string>> = { update: 'Actualiser' };

/** Barre du bas (mobile) : quatre écrans, puis « Plus ». */
export const BAR_SCREENS: readonly Screen[] = ['dashboard', 'update', 'accounts', 'pilot'];
/** Feuille « Plus » (mobile), après « Demander à Pécule ». */
export const MORE_SCREENS: readonly Screen[] = ['analyses', 'taxes', 'settings'];
/** Menu latéral (ordinateur), avant le séparateur et Paramètres. */
export const SIDE_SCREENS: readonly Screen[] = ['dashboard', 'update', 'accounts', 'pilot', 'analyses', 'taxes'];
