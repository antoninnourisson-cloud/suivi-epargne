// Navigation mobile : quatre écrans dans la barre (Accueil, Actualiser, Comptes, Pilotage) et
// « Plus », une feuille avec « Demander à Pécule », Analyses, Impôts et Paramètres. Chaque
// entrée rouvre le dernier onglet de son écran (voir navigation.ts).
import React from 'react';
import { MoreHorizontal, X } from 'lucide-react';
import { BAR_SCREENS, MORE_SCREENS, SCREEN_ICONS, SCREEN_LABELS, SCREEN_SHORT_LABELS, type Place, type Screen } from '../navigation';
import { Modal } from './Modal';
import { IconButton } from './ui';
import { AskNavButton } from './AskNavButton';

interface BottomNavProps {
  place: Place;
  /** Entrée d'un écran : son onglet mémorisé. */
  onOpenScreen: (s: Screen) => void;
  moreOpen: boolean;
  setMoreOpen: (open: boolean) => void;
  /** Ouvre « Demander à Pécule » (bouton en tête du panneau). */
  onAsk?: () => void;
}

// `expanded` : bouton qui ouvre une feuille (« Plus ») ; le lecteur d'écran annonce qu'il
// ouvre une boîte de dialogue, et si elle est ouverte.
const TabButton: React.FC<{ active: boolean; onClick: () => void; icon: React.ComponentType<{ className?: string }>; label: string; current?: boolean; expanded?: boolean }> = ({ active, onClick, icon: Icon, label, current, expanded }) => (
  // Barre de navigation Material 3 : l'onglet actif porte un indicateur en pilule. Texte agrandi
  // (html { font-size: 200% }) : le bouton peut rétrécir (min-w-0), la pilule (w-16, en rem)
  // rétrécit avec lui (max-w-full) et le libellé se tronque au lieu de pousser la barre hors écran.
  <button onClick={onClick} aria-current={current ? 'page' : undefined} aria-haspopup={expanded === undefined ? undefined : 'dialog'} aria-expanded={expanded} className="group flex-1 min-w-0 flex flex-col items-center justify-center gap-1 pt-3 pb-4 min-h-20">
    <span className={`h-8 w-16 max-w-full rounded-full flex items-center justify-center transition-colors ${active ? 'bg-secondary-container text-on-secondary-container' : 'text-on-surface-variant group-hover:bg-on-surface/8'}`}>
      <Icon className="w-5 h-5" aria-hidden="true" />
    </span>
    <span className={`max-w-full truncate text-xs ${active ? 'font-bold text-on-surface' : 'font-medium text-on-surface-variant'}`}>{label}</span>
  </button>
);

export const BottomNav: React.FC<BottomNavProps> = ({ place, onOpenScreen, moreOpen, setMoreOpen, onAsk }) => {
  const current = place.screen;
  // « Plus » porte la pilule quand Analyses, Impôts ou Paramètres est affiché.
  const moreActive = MORE_SCREENS.includes(current);
  const go = (s: Screen) => { onOpenScreen(s); setMoreOpen(false); };
  return (
    <>
      <nav aria-label="Navigation principale" className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-surface-container flex pb-[env(safe-area-inset-bottom)]">
        {BAR_SCREENS.map(s => (
          <TabButton key={s} active={current === s} current={current === s} onClick={() => onOpenScreen(s)} icon={SCREEN_ICONS[s]} label={SCREEN_SHORT_LABELS[s] ?? SCREEN_LABELS[s]} />
        ))}
        <TabButton active={moreOpen || moreActive} onClick={() => setMoreOpen(true)} icon={MoreHorizontal} label="Plus" expanded={moreOpen} />
      </nav>

      <Modal open={moreOpen} onClose={() => setMoreOpen(false)} label="Plus d'écrans" variant="sheet" className="md:hidden p-4">
        <div className="flex items-center justify-between mb-2 px-2">
          <h2 className="text-base font-medium text-on-surface">Plus d'écrans</h2>
          <IconButton label="Fermer le menu" icon={X} onClick={() => setMoreOpen(false)} className="-my-1 -mr-2" />
        </div>
        {onAsk && <AskNavButton onClick={() => { setMoreOpen(false); onAsk(); }} className="mt-2" />}
        <div className="mt-3 grid grid-cols-3 gap-2">
          {MORE_SCREENS.map(s => {
            const Icon = SCREEN_ICONS[s];
            const active = current === s;
            return (
              <button
                key={s}
                onClick={() => go(s)}
                aria-current={active ? 'page' : undefined}
                className={`flex flex-col items-center gap-2 p-3 rounded-2xl min-h-[72px] ${active ? 'bg-secondary-container text-on-secondary-container' : 'bg-surface-container text-on-surface-variant'}`}
              >
                <Icon className="w-5 h-5" aria-hidden="true" />
                <span className="text-xs font-medium text-center leading-tight">{SCREEN_LABELS[s]}</span>
              </button>
            );
          })}
        </div>
      </Modal>
    </>
  );
};
