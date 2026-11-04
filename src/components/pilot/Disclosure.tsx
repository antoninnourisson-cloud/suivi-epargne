// Panneau repliable : un bouton-titre (aria-expanded) et une zone reliée. Le contenu reste
// monté une fois replié (attribut hidden) pour ne pas perdre une saisie en cours.
import React, { useId, useState } from 'react';
import { ChevronDown } from 'lucide-react';

interface DisclosureProps {
  title: React.ReactNode;
  /** Résumé affiché à droite du titre quand le panneau est fermé (ex. « 1 250 €/mois »). */
  summary?: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  headingLevel?: 3 | 4;
  /**
   * `card` : panneau bordé autonome ; `plain` : rangée dans une liste de panneaux ;
   * `inline` : dans une carte, sans marge de côté (« Comment c'est calculé »).
   */
  appearance?: 'card' | 'plain' | 'inline';
  /** Ancre stable (liens vers ce réglage). */
  id?: string;
  /** Ouverture pilotée par le parent (lien qui ouvre ce panneau) ; sinon, état interne. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
}

export const Disclosure: React.FC<DisclosureProps> = ({
  title, summary, icon: Icon, headingLevel = 3, appearance = 'card', id, open: openProp, onOpenChange, children,
}) => {
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const toggle = () => {
    setOpenState(!open);
    onOpenChange?.(!open);
  };
  const base = useId();
  const H = `h${headingLevel}` as 'h3' | 'h4';
  const shell = appearance === 'card'
    ? 'rounded-2xl border border-outline-variant bg-surface-container-lowest dark:bg-surface-container-low'
    : '';
  const inline = appearance === 'inline';
  return (
    <section id={id} className={`text-on-surface ${shell}`}>
      <H className="m-0">
        <button
          type="button"
          id={`${base}-btn`}
          aria-expanded={open}
          aria-controls={`${base}-panel`}
          onClick={toggle}
          className={`w-full py-3 flex items-center gap-3 text-left hover:bg-on-surface/5 transition-colors ${inline ? 'min-h-12 px-2 -mx-2 rounded-xl' : 'min-h-14 px-5 sm:px-6'} ${appearance === 'card' ? (open ? 'rounded-t-2xl' : 'rounded-2xl') : ''}`}
        >
          {Icon && <Icon className="w-5 h-5 shrink-0 text-primary" aria-hidden="true" />}
          <span className={`flex-1 min-w-0 font-medium text-on-surface ${inline ? 'text-sm' : 'text-base'}`}>{title}</span>
          {summary !== undefined && summary !== null && (
            <span className="hidden sm:inline text-sm text-on-surface-variant tabular-nums truncate max-w-[50%]">{summary}</span>
          )}
          <ChevronDown className={`w-5 h-5 shrink-0 text-on-surface-variant transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
        </button>
      </H>
      <div id={`${base}-panel`} role="region" aria-labelledby={`${base}-btn`} hidden={!open} className={inline ? 'pb-2 pt-1' : 'px-5 sm:px-6 pb-5 sm:pb-6 pt-1'}>
        {children}
      </div>
    </section>
  );
};
