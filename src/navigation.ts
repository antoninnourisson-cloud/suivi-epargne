// Source unique de la navigation : menu latéral (ordinateur), barre du bas et panneau
// « Plus » (mobile), liens profonds. Ajouter un écran = une ligne ici.
import {
  LayoutDashboard, RefreshCcw, Wallet, ArrowRightLeft, ScrollText, ShieldCheck, CalendarClock,
  FileText, HandHeart, Coins, LineChart, FlaskConical, CalendarDays, Users, Settings as SettingsIcon,
} from 'lucide-react';
import type { ComponentType } from 'react';

export const VIEWS = [
  'dashboard', 'update', 'accounts', 'transfers', 'journal', 'pilot', 'subscriptions', 'payslips',
  'donations', 'yield', 'history', 'simulator', 'agenda', 'parental', 'settings',
] as const;
export type View = typeof VIEWS[number];
export const isView = (v: unknown): v is View => typeof v === 'string' && (VIEWS as readonly string[]).includes(v);

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

export const NAV_ITEMS: NavItem[] = [
  { key: 'dashboard', label: 'Accueil', icon: LayoutDashboard, tab: true },
  { key: 'update', label: 'Actualiser les soldes', short: 'Actualiser', icon: RefreshCcw, tab: true },
  { key: 'accounts', label: 'Mes comptes', short: 'Comptes', icon: Wallet, section: 'Comptes', tab: true },
  { key: 'transfers', label: 'Virements', icon: ArrowRightLeft, section: 'Comptes' },
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

export const navLabel = (v: View): string => NAV_ITEMS.find(i => i.key === v)?.label ?? 'Pécule';
