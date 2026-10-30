// En-tête d'écran : le titre (h2, cible du focus à chaque changement d'écran, voir App),
// une phrase d'explication et des actions. Dans l'onglet d'un écran à onglets, le titre est
// un h3 masqué à l'écran (l'écran a son h2 et l'onglet choisi dit déjà où l'on est).
import React, { useContext } from 'react';
import { InTabPanelContext } from './inTabPanel';

interface PageHeaderProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  /** Titre lu par les lecteurs d'écran mais masqué à l'écran (l'écran a déjà son chiffre principal). */
  visuallyHidden?: boolean;
}

export const PageHeader: React.FC<PageHeaderProps> = ({ title, subtitle, actions, visuallyHidden }) => {
  const inTab = useContext(InTabPanelContext);
  if (visuallyHidden) return <h2 className="sr-only">{title}</h2>;
  if (inTab) {
    if (!subtitle && !actions) return <h3 className="sr-only">{title}</h3>;
    return (
      <header className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div className="min-w-0">
          <h3 className="sr-only">{title}</h3>
          {subtitle && <p className="text-sm text-on-surface-variant max-w-2xl">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </header>
    );
  }
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
