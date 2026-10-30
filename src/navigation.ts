// Source unique de la navigation : écrans, onglets, anciennes adresses (alias), menu latéral
// (ordinateur), barre du bas et panneau « Plus » (mobile), liens profonds.
//
// Modèle : 7 écrans (Accueil, Actualiser, Comptes, Pilotage, Analyses, Impôts, Paramètres) ;
// Comptes, Pilotage, Analyses et Impôts ont des onglets. Un endroit de l'app est une `Place`
// (écran + onglet). Les anciennes clés d'écran (`?view=payslips`, liens de l'Accueil, de
// l'Agenda, des notifications, `lastView` d'un ancien fichier) restent valables : chacune est
// un alias qui ouvre TOUJOURS son onglet explicite. L'onglet mémorisé d'un écran ne sert
// qu'aux gestes de navigation (barre du bas, « Plus », menu latéral).
import {
  LayoutDashboard, RefreshCcw, Wallet, ScrollText, ShieldCheck, CalendarClock,
  FileText, HandHeart, Coins, LineChart, FlaskConical, CalendarDays, Users, Settings as SettingsIcon, Landmark,
} from 'lucide-react';
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
  pilot: [{ key: 'month', label: 'Ce mois' }, { key: 'subscriptions', label: 'Abonnements' }, { key: 'payslips', label: 'Fiches de paie' }],
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
export const defaultTab = (screen: Screen): ScreenTab | undefined => tabsOf(screen)[0]?.key;

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
  'donations', 'yield', 'history', 'simulator', 'agenda', 'parental', 'settings', 'analyses', 'taxes',
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

export type NavSection = 'Comptes' | 'Budget' | 'Analyses';

export interface NavItem {
  key: View;
  label: string;
  /** Libellé court (barre du bas). */
  short?: string;
  icon: ComponentType<{ className?: string }>;
  section?: NavSection;
  /** Onglet de la barre du bas (mobile). */
  tab?: boolean;
}

// Entrées des menus actuels (refaits au lot suivant). L'ancien écran Virements n'en a plus :
// le virement et les échéances récurrentes sont dans Comptes › Mouvements (entrée Journal).
export const NAV_ITEMS: NavItem[] = [
  { key: 'dashboard', label: 'Accueil', icon: LayoutDashboard, tab: true },
  { key: 'update', label: 'Actualiser les soldes', short: 'Actualiser', icon: RefreshCcw, tab: true },
  { key: 'accounts', label: 'Mes comptes', short: 'Comptes', icon: Wallet, section: 'Comptes', tab: true },
  { key: 'journal', label: 'Journal', icon: ScrollText, section: 'Comptes' },
  { key: 'pilot', label: 'Pilotage', icon: ShieldCheck, section: 'Budget', tab: true },
  { key: 'subscriptions', label: 'Abonnements', icon: CalendarClock, section: 'Budget' },
  { key: 'payslips', label: 'Fiches de paie', icon: FileText, section: 'Budget' },
  { key: 'donations', label: 'Dons et impôts', icon: HandHeart, section: 'Budget' },
  { key: 'yield', label: 'Rendement', icon: Coins, section: 'Analyses' },
  { key: 'history', label: 'Historique', icon: LineChart, section: 'Analyses' },
  { key: 'simulator', label: 'Et si…', icon: FlaskConical, section: 'Analyses' },
  { key: 'agenda', label: 'Agenda', icon: CalendarDays, section: 'Analyses' },
  { key: 'parental', label: 'Part parentale', icon: Users, section: 'Analyses' },
  { key: 'settings', label: 'Paramètres', icon: SettingsIcon },
];

export const NAV_SECTIONS: NavSection[] = ['Comptes', 'Budget', 'Analyses'];

/** Icônes des écrans (titres, menus). */
export const SCREEN_ICONS: Record<Screen, ComponentType<{ className?: string }>> = {
  dashboard: LayoutDashboard, update: RefreshCcw, accounts: Wallet, pilot: ShieldCheck,
  analyses: LineChart, taxes: Landmark, settings: SettingsIcon,
};

/**
 * Entrée de menu touchée : une entrée qui nomme un écran rouvre son dernier onglet
 * (`openScreen`), une ancienne clé qui nomme un onglet ouvre cet onglet (`navigate`).
 */
export const goToNavItem = (key: View, navigate: (v: View) => void, openScreen: (s: Screen) => void) => {
  if (isScreen(key)) openScreen(key); else navigate(key);
};

/**
 * Entrée de menu active parmi `keys` : celle dont l'endroit est exactement l'endroit affiché,
 * sinon la première qui mène au même écran (Pilotage, quand l'onglet affiché n'a pas
 * d'entrée à lui).
 */
export const activeNavKey = (place: Place, keys: readonly View[]): View | undefined =>
  keys.find(k => samePlace(placeOf(k), place)) ?? keys.find(k => placeOf(k).screen === place.screen);
