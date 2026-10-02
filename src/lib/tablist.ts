// Clavier des onglets (motif ARIA « tabs ») : flèches gauche/droite, Début et Fin déplacent
// le focus et activent l'onglet. À poser sur l'élément role="tablist" ; chaque onglet garde
// tabIndex 0 s'il est sélectionné, -1 sinon (une seule tabulation pour entrer dans la liste).
import type React from 'react';

export const onTablistKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
  const tabs = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]:not([disabled])'));
  const i = tabs.indexOf(document.activeElement as HTMLElement);
  if (i < 0) return;
  const next =
    e.key === 'ArrowRight' ? (i + 1) % tabs.length :
    e.key === 'ArrowLeft' ? (i - 1 + tabs.length) % tabs.length :
    e.key === 'Home' ? 0 :
    e.key === 'End' ? tabs.length - 1 : -1;
  if (next < 0) return;
  e.preventDefault();
  tabs[next].focus();
  tabs[next].click();
};
