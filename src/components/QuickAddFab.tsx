// Bouton flottant d'ajout rapide. Son état de défilement vit ici (et non dans App) : faire
// défiler la page ne redessine donc plus tout l'écran courant.
import React, { useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';

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
      onClick={onClick}
      className={`fixed bottom-[calc(6rem+env(safe-area-inset-bottom))] md:bottom-6 right-4 z-40 h-14 pl-4 pr-5 rounded-xl bg-primary-container text-on-primary-container shadow-lg hover:shadow-xl flex items-center gap-3 font-medium transition-all duration-300 ${hidden ? 'translate-y-28 opacity-0 pointer-events-none' : ''}`}
      aria-label="Ajouter un mouvement"
    >
      <Plus className="w-6 h-6" aria-hidden="true" /> <span className="text-sm">Ajouter</span>
    </button>
  );
};
