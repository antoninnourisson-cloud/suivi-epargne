// Ajout rapide d'un mouvement, à deux endroits selon l'écran :
// - téléphone : bouton flottant au-dessus de la barre du bas (QuickAddFab), qui s'efface
//   quand on fait défiler vers le bas. Son état de défilement vit ici (et non dans App) :
//   faire défiler la page ne redessine donc pas tout l'écran courant ;
// - ordinateur : bouton en tête du menu latéral (QuickAddNavButton), comme le bouton
//   d'action d'un tiroir de navigation Material 3. Il ne recouvre ainsi aucun champ.
import React, { useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import type { View } from '../navigation';

/**
 * Écrans sans bouton flottant (téléphone) : leur action principale est déjà un ajout ou un
 * enregistrement (Actualiser, Virements, Abonnements, Dons, Fiches de paie), ou un mouvement
 * n'a rien à y faire (Part parentale, Paramètres). Deux boutons « Ajouter » côte à côte
 * laisseraient deviner lequel ajoute quoi.
 */
const HIDDEN_ON: ReadonlySet<View> = new Set<View>(['update', 'transfers', 'subscriptions', 'donations', 'payslips', 'parental', 'settings']);

export const showQuickAddFab = (view: View): boolean => !HIDDEN_ON.has(view);

const LABEL = 'Ajouter un mouvement';

export const QuickAddFab: React.FC<{ scrollRef: React.RefObject<HTMLElement | null>; resetKey: string; onClick: () => void }> = ({ scrollRef, resetKey, onClick }) => {
  const [hidden, setHidden] = useState(false);
  const last = useRef(0);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    setHidden(false);
    last.current = el.scrollTop;
    const onScroll = () => {
      const y = el.scrollTop;
      const delta = y - last.current;
      if (Math.abs(delta) > 8) setHidden(delta > 0 && y > 80);
      last.current = y;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [scrollRef, resetKey]);
  return (
    <button
      type="button"
      onClick={onClick}
      // Nom accessible complet ; le libellé visible « Mouvement » en fait partie (WCAG 2.5.3).
      aria-label={LABEL}
      className={`md:hidden fixed bottom-[calc(6rem+env(safe-area-inset-bottom))] right-4 z-40 h-14 pl-4 pr-5 rounded-2xl bg-primary-container text-on-primary-container shadow-lg hover:shadow-xl flex items-center gap-3 font-medium transition-all duration-300 ${hidden ? 'translate-y-28 opacity-0 pointer-events-none' : ''}`}
    >
      <Plus className="w-6 h-6" aria-hidden="true" /> <span className="text-sm">Mouvement</span>
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
