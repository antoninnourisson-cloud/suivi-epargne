// Bouton-icône Material 3 : 48 px de côté (cible tactile confortable), libellé obligatoire,
// lu par les lecteurs d'écran et montré au survol. `tone="danger"` pour une suppression.
import React from 'react';

interface IconButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  tone?: 'default' | 'danger';
  /** React 19 : la ref est une prop, transmise au bouton (focus rendu par un menu). */
  ref?: React.Ref<HTMLButtonElement>;
}

export const IconButton: React.FC<IconButtonProps> = ({ label, icon: Icon, tone = 'default', className = '', title, ...rest }) => (
  <button
    type="button"
    aria-label={label}
    title={title ?? label}
    className={`w-12 h-12 shrink-0 rounded-full inline-flex items-center justify-center text-on-surface-variant transition-colors disabled:opacity-40 ${tone === 'danger' ? 'hover:text-error hover:bg-error/8' : 'hover:text-on-surface hover:bg-on-surface/8'} ${className}`}
    {...rest}
  >
    <Icon className="w-5 h-5" aria-hidden="true" />
  </button>
);
