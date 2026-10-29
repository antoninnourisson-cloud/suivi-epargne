// Cadre de l'app connectée : lien d'évitement, menu latéral (ordinateur), en-tête compact
// (mobile) et zone principale. Le contenu (bannières, écran) et ce qui flotte par-dessus
// (bouton d'ajout, barre du bas, fenêtres) sont passés par App. Sur mobile, la déconnexion
// (action rare) est dans Paramètres ; l'en-tête garde l'état de la synchronisation, touchable
// pour le détail (feuille rendue ici, hors de l'en-tête collant).
import React, { useState } from 'react';
import { Eye, EyeOff, LogOut, Moon, Settings as SettingsIcon, Sun } from 'lucide-react';
import { Logo } from '../components/Logo';
import { openSettingsSection } from '../components/settings/sections';
import { NAV_ITEMS, NAV_SECTIONS, type View } from '../navigation';
import { APP_VERSION } from '../appVersion';
import type { SyncPhase } from '../lib/sync/syncStatus';
import { SyncDetailSheet, SyncStatus } from './SyncStatus';
import { IconButton } from '../components/ui';

// Bouton rapide du thème : choix explicite du thème inverse. « Automatique » (comme le
// système) se règle dans Paramètres, carte « Affichage ».
const themeLabel = (isDark: boolean) => (isDark ? 'Passer en thème clair' : 'Passer en thème sombre');

// Mode discret : un bouton à bascule (aria-pressed), libellé fixe ; l'icône montre l'état
// (œil barré quand les montants sont masqués). Aussi dans Paramètres › Affichage.
const DiscreetButton = ({ discreet, onToggle }: { discreet: boolean; onToggle: () => void }) => (
  <IconButton onClick={onToggle} label="Masquer les montants" aria-pressed={discreet} icon={discreet ? EyeOff : Eye}
    title={discreet ? 'Montants masqués : cliquer pour les afficher' : 'Masquer les montants'} />
);

const NavButton = ({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: React.ComponentType<{ className?: string }>; label: string }) => (
  <button
    onClick={onClick}
    aria-current={active ? 'page' : undefined}
    className={`w-full h-12 [@media(max-height:899px)]:h-10 flex items-center gap-3 px-4 text-sm transition-colors rounded-full ${active ? 'bg-secondary-container text-on-secondary-container font-bold' : 'font-medium text-on-surface-variant hover:bg-on-surface/8 hover:text-on-surface'}`}
  >
    <Icon className="w-5 h-5 shrink-0" aria-hidden="true" />
    {label}
  </button>
);

/**
 * Liste des écrans du menu latéral. Mémoïsée (`setView` est stable) : elle ne se re-rend
 * qu'au changement d'écran, pas pour une fenêtre, un toast ou l'indicateur de sauvegarde.
 */
const SideNav = React.memo(function SideNav({ view, setView, showParentalScreen }: { view: View; setView: (v: View) => void; showParentalScreen: boolean }) {
  return (
    <nav aria-label="Navigation principale" className="flex-1 min-h-0 px-3 pb-3 overflow-y-auto space-y-0.5">
      {NAV_ITEMS.filter(i => !i.section && i.key !== 'settings').map(i => <NavButton key={i.key} active={view === i.key} onClick={() => setView(i.key)} icon={i.icon} label={i.label} />)}
      {NAV_SECTIONS.map(section => (
        <React.Fragment key={section}>
          <div className="pt-5 pb-2 px-4 text-sm font-medium text-on-surface-variant">{section}</div>
          {NAV_ITEMS.filter(i => i.section === section && (i.key !== 'parental' || showParentalScreen)).map(i => <NavButton key={i.key} active={view === i.key} onClick={() => setView(i.key)} icon={i.icon} label={i.label} />)}
        </React.Fragment>
      ))}
      <div className="my-3 border-t border-outline-variant mx-4"></div>
      <NavButton active={view === 'settings'} onClick={() => setView('settings')} icon={SettingsIcon} label="Paramètres" />
    </nav>
  );
});

interface AppShellProps {
  view: View;
  setView: (v: View) => void;
  /** Écran « Part parentale » proposé (masqué en mode solo, sans relevé de restitution). */
  showParentalScreen: boolean;
  syncPhase: SyncPhase;
  lastSavedAt: Date | null;
  /** Des modifications de cet appareil ne sont pas encore sur Drive. */
  hasPendingEdits: boolean;
  onRetrySync: () => void;
  onReconnect: () => void;
  isDark: boolean;
  onToggleTheme: () => void;
  /** Mode discret : montants affichés en « •••• € » (réglage de cet appareil). */
  discreet: boolean;
  onToggleDiscreet: () => void;
  /** Déconnexion du menu latéral (ordinateur) ; confirmée si des modifications attendent. */
  onRequestLogout: (alwaysConfirm: boolean) => void;
  mainRef: React.RefObject<HTMLElement | null>;
  children: React.ReactNode;
  /** Bouton d'ajout, barre du bas, fenêtres : après la zone principale. */
  overlays: React.ReactNode;
  /** Bouton d'action en tête du menu latéral (ordinateur) : l'ajout rapide d'un mouvement. */
  navAction?: React.ReactNode;
}

export const AppShell: React.FC<AppShellProps> = ({ view, setView, showParentalScreen, syncPhase, lastSavedAt, hasPendingEdits, onRetrySync, onReconnect, isDark, onToggleTheme, discreet, onToggleDiscreet, onRequestLogout, mainRef, children, overlays, navAction }) => {
  const [syncOpen, setSyncOpen] = useState(false);
  const openSync = () => setSyncOpen(true);
  return (
    <div className="min-h-screen bg-surface flex flex-col md:flex-row font-sans text-on-surface">
      <a href="#contenu" onClick={e => { e.preventDefault(); mainRef.current?.focus(); }}
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-100 focus:px-4 focus:py-2 focus:rounded-lg focus:bg-surface-container-lowest focus:text-on-surface focus:font-medium focus:shadow-lg">
        Aller au contenu
      </a>
      {/* Menu collé à l'écran, à hauteur de fenêtre : seul le contenu (main) défile, et la liste
          des écrans défile à part si la fenêtre est basse. Entrées resserrées sous 900 px de haut. */}
      <aside className="hidden md:flex md:sticky md:top-0 md:h-dvh bg-surface-container-low text-on-surface w-full md:w-72 shrink-0 flex-col">
        <div className="px-7 pt-6 pb-3">
          <h1 className="text-2xl font-bold text-primary dark:text-on-surface flex items-center gap-3"><Logo className="w-9 h-9" /> Pécule</h1>
          <div className="mt-3 text-xs text-on-surface-variant font-medium flex items-center justify-between gap-2">
            <SyncStatus phase={syncPhase} lastSavedAt={lastSavedAt} variant="full" onOpen={openSync} />
            <div className="flex items-center -my-3 -mr-3">
              <DiscreetButton discreet={discreet} onToggle={onToggleDiscreet} />
              <IconButton onClick={onToggleTheme} label={themeLabel(isDark)} icon={isDark ? Sun : Moon} />
            </div>
          </div>
        </div>
        {navAction && <div className="px-3 pt-1 pb-4">{navAction}</div>}
        <SideNav view={view} setView={setView} showParentalScreen={showParentalScreen} />
        <div className="px-3 py-3 border-t border-outline-variant">
          <button onClick={() => onRequestLogout(false)} className="w-full h-12 flex items-center gap-3 px-4 text-error hover:bg-error/8 rounded-full font-medium text-sm transition-colors"><LogOut className="w-5 h-5" aria-hidden="true" /> Déconnexion</button>
          <button onClick={() => { openSettingsSection('about'); setView('settings'); }} className="w-full mt-1 px-4 text-left text-[11px] font-medium text-on-surface-variant hover:text-on-surface" title="Historique des mises à jour dans Paramètres">Pécule · version {APP_VERSION}{typeof __BUILD_SHA__ !== "undefined" && __BUILD_SHA__ !== "dev" ? ` · ${__BUILD_SHA__}` : ""}</button>
        </div>
      </aside>

      {/* En-tête compact mobile (la barre latérale est masquée en dessous de md) */}
      <header className="md:hidden sticky top-0 z-30 bg-surface-container text-on-surface px-4 h-16 flex items-center justify-between">
        <h1 className="text-[22px] font-bold text-primary dark:text-on-surface flex items-center gap-2"><Logo className="w-8 h-8" /> Pécule</h1>
        <div className="flex items-center gap-1 -mr-3">
          <SyncStatus phase={syncPhase} lastSavedAt={lastSavedAt} variant="short" onOpen={openSync} />
          <DiscreetButton discreet={discreet} onToggle={onToggleDiscreet} />
          <IconButton onClick={onToggleTheme} label={themeLabel(isDark)} icon={isDark ? Sun : Moon} />
        </div>
      </header>

      <main ref={mainRef} id="contenu" tabIndex={-1} className="outline-none flex-1 bg-surface p-4 md:p-8 overflow-y-auto relative h-dvh pb-40 md:pb-24">
        <div className="max-w-7xl mx-auto pb-20">
          {children}
        </div>
      </main>
      {overlays}
      <SyncDetailSheet open={syncOpen} onClose={() => setSyncOpen(false)} phase={syncPhase} lastSavedAt={lastSavedAt}
        pending={hasPendingEdits} onRetry={onRetrySync} onReconnect={onReconnect} />
    </div>
  );
};
