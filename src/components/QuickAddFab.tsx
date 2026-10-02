// Bouton flottant d'ajout rapide. Son état de défilement vit ici (et non dans App) : faire
// défiler la page ne redessine donc plus tout l'écran courant.
import React, { useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';

export const QuickAddFab: React.FC<{ scrollRef: React.RefObject<HTMLElement>; resetKey: string; onClick: () => void }> = ({ scrollRef, resetKey, onClick }) => {
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
      className={`fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] md:bottom-6 right-4 z-40 h-14 pl-4 pr-5 rounded-full bg-indigo-600 hover:bg-indigo-700 text-white shadow-lg shadow-black/20 flex items-center gap-2 font-black transition-all duration-200 ${hidden ? 'translate-y-24 opacity-0 pointer-events-none' : 'hover:scale-105'}`}
      aria-label="Ajouter un mouvement"
    >
      <Plus className="w-6 h-6" aria-hidden="true" /> <span className="text-sm">Ajouter</span>
    </button>
  );
};
