// En-tête d'écran : le titre (h2, cible du focus à chaque changement d'écran, voir App),
// une phrase d'explication et des actions.
import React from 'react';

interface PageHeaderProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  /** Titre lu par les lecteurs d'écran mais masqué à l'écran (l'écran a déjà son chiffre principal). */
  visuallyHidden?: boolean;
}

export const PageHeader: React.FC<PageHeaderProps> = ({ title, subtitle, actions, visuallyHidden }) => {
  if (visuallyHidden) return <h2 className="sr-only">{title}</h2>;
  return (
    <header className="flex flex-wrap items-end justify-between gap-3 mb-6">
      <div className="min-w-0">
        <h2 className="text-[28px] leading-9 font-normal text-on-surface">{title}</h2>
        {subtitle && <p className="mt-1 text-sm text-on-surface-variant max-w-2xl">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
};
