// Ajout rapide d'un mouvement, à deux endroits selon l'écran :
// - téléphone : bouton flottant au-dessus de la barre du bas (QuickAddFab), qui s'efface
//   quand on fait défiler vers le bas. Son état de défilement vit ici (et non dans App) :
//   faire défiler la page ne redessine donc pas tout l'écran courant ;
// - ordinateur : bouton en tête du menu latéral (QuickAddNavButton), comme le bouton
//   d'action d'un tiroir de navigation Material 3. Il ne recouvre ainsi aucun champ.
import React, { useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import type { Place } from '../navigation';

/**
 * Endroits sans bouton flottant (téléphone) : leur action principale est déjà un ajout ou un
 * enregistrement (Actualiser, Abonnements, Dons, Fiches de paie), ou un mouvement n'a rien à
 * y faire (Comptes › Parents, Paramètres). Deux boutons « Ajouter » côte à côte laisseraient
 * deviner lequel ajoute quoi. Comptes › Mouvements le garde : c'est là qu'on voit les
 * mouvements, et « Faire un virement » y ouvre la même feuille.
 */
const HIDDEN_ON: ReadonlySet<string> = new Set(['update', 'settings', 'parents', 'subscriptions', 'payslips', 'wishes', 'donations']);

export const showQuickAddFab = (place: Place): boolean => !HIDDEN_ON.has(place.tab ?? place.screen);

const LABEL = 'Ajouter un mouvement';

export const QuickAddFab: React.FC<{ scrollRef: React.RefObject<HTMLElement | null>; resetKey: string; onClick: () => void }> = ({ scrollRef, resetKey, onClick }) => {
  const [hidden, setHidden] = useState(false);
  // Page défilée : le bouton se réduit à son icône (56 px au lieu d'environ 150), pour ne plus
  // recouvrir les boutons des cartes quand le défilement s'arrête.
  const [compact, setCompact] = useState(false);
  const last = useRef(0);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // Sur téléphone, c'est la page (document) qui défile ; sur ordinateur, <main>. On suit les deux.
    const read = () => Math.max(el.scrollTop, document.scrollingElement?.scrollTop ?? 0);
    setHidden(false);
    setCompact(read() > 80);
    last.current = read();
    const onScroll = () => {
      const y = read();
      const delta = y - last.current;
      setCompact(y > 80);
      if (Math.abs(delta) > 8) setHidden(delta > 0 && y > 80);
      last.current = y;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => { el.removeEventListener('scroll', onScroll); window.removeEventListener('scroll', onScroll); };
  }, [scrollRef, resetKey]);
  return (
    <button
      type="button"
      onClick={onClick}
      // Replié : le bouton est invisible, il ne doit donc plus être atteignable (Tab, TalkBack).
      inert={hidden}
      aria-hidden={hidden || undefined}
      tabIndex={hidden ? -1 : undefined}
      // Nom accessible complet ; le libellé visible « Mouvement » en fait partie (WCAG 2.5.3).
      aria-label={LABEL}
      className={`md:hidden fixed bottom-[calc(6rem+env(safe-area-inset-bottom))] right-4 z-40 h-14 ${compact ? 'w-14 justify-center' : 'pl-4 pr-5'} rounded-2xl bg-primary-container text-on-primary-container shadow-lg hover:shadow-xl flex items-center gap-3 font-medium transition-all duration-300 ${hidden ? 'translate-y-28 opacity-0 pointer-events-none' : ''}`}
    >
      <Plus className="w-6 h-6" aria-hidden="true" /> <span className={compact ? 'sr-only' : 'text-sm'}>Mouvement</span>
    </button>
  );
};

/** Bouton d'action du menu latéral (ordinateur) : toujours au même endroit, jamais sur un champ. */
export const QuickAddNavButton: React.FC<{ onClick: () => void }> = ({ onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className="h-14 pl-4 pr-5 rounded-2xl bg-primary-container text-on-primary-container shadow-sm hover:shadow-md inline-flex items-center gap-3 text-sm font-medium transition-shadow"
  >
    <Plus className="w-6 h-6" aria-hidden="true" /> {LABEL}
  </button>
);
