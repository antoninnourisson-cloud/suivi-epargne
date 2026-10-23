// Élément de liste Material 3 (à placer dans un <ul>) : un titre, un texte d'appui, une
// valeur à droite (montant) et des actions. Le titre passe à la ligne au lieu d'être coupé ;
// sur téléphone, les actions descendent sur une deuxième rangée pour lui laisser la place.
import React from 'react';

interface ListItemProps {
  headline: React.ReactNode;
  supporting?: React.ReactNode;
  /** Élément à gauche (icône dans une pastille). */
  leading?: React.ReactNode;
  /** Valeur à droite du titre (montant). */
  trailing?: React.ReactNode;
  /** Boutons d'action : à droite sur ordinateur, en dessous sur téléphone. */
  actions?: React.ReactNode;
  className?: string;
}

export const ListItem: React.FC<ListItemProps> = ({ headline, supporting, leading, trailing, actions, className = '' }) => (
  <li className={`flex flex-wrap sm:flex-nowrap items-center gap-x-3 gap-y-1 py-3 ${className}`}>
    {leading && <span className="shrink-0">{leading}</span>}
    <div className="min-w-0 flex-1">
      <p className="text-sm font-medium text-on-surface break-words">{headline}</p>
      {supporting && <div className="mt-0.5 text-xs text-on-surface-variant break-words">{supporting}</div>}
    </div>
    {trailing !== undefined && trailing !== null && trailing !== false && (
      <div className="shrink-0 text-sm font-medium text-right">{trailing}</div>
    )}
    {actions && <div className="w-full sm:w-auto shrink-0 flex flex-wrap items-center justify-end gap-1 -my-1">{actions}</div>}
  </li>
);
