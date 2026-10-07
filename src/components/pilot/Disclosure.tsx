// Panneau repliable : un bouton-titre (aria-expanded) et une zone reliée. Le contenu reste
// monté une fois replié (attribut hidden) pour ne pas perdre une saisie en cours.
import React, { useId, useState } from 'react';
import { ChevronDown } from 'lucide-react';

interface DisclosureProps {
  title: React.ReactNode;
  /** Résumé affiché à droite du titre quand le panneau est fermé (ex. « 1 250 €/mois »). */
  summary?: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  defaultOpen?: boolean;
  headingLevel?: 3 | 4;
  /** `card` : panneau bordé autonome ; `plain` : rangée dans une liste de panneaux. */
  appearance?: 'card' | 'plain';
  children: React.ReactNode;
}

export const Disclosure: React.FC<DisclosureProps> = ({
  title, summary, icon: Icon, defaultOpen = false, headingLevel = 3, appearance = 'card', children,
}) => {
  const [open, setOpen] = useState(defaultOpen);
  const base = useId();
  const H = `h${headingLevel}` as 'h3' | 'h4';
  const shell = appearance === 'card'
    ? 'rounded-2xl border border-outline-variant bg-surface-container-lowest dark:bg-surface-container-low'
    : '';
  return (
    <section className={`text-on-surface ${shell}`}>
      <H className="m-0">
        <button
          type="button"
          id={`${base}-btn`}
          aria-expanded={open}
          aria-controls={`${base}-panel`}
          onClick={() => setOpen(o => !o)}
          className={`w-full min-h-14 px-5 sm:px-6 py-3 flex items-center gap-3 text-left hover:bg-on-surface/5 transition-colors ${appearance === 'card' ? (open ? 'rounded-t-2xl' : 'rounded-2xl') : ''}`}
        >
          {Icon && <Icon className="w-5 h-5 shrink-0 text-indigo-600 dark:text-indigo-300" aria-hidden="true" />}
          <span className="flex-1 min-w-0 text-base font-medium text-on-surface">{title}</span>
          {summary !== undefined && summary !== null && (
            <span className="hidden sm:inline text-sm text-on-surface-variant tabular-nums truncate max-w-[50%]">{summary}</span>
          )}
          <ChevronDown className={`w-5 h-5 shrink-0 text-on-surface-variant transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
        </button>
      </H>
      <div id={`${base}-panel`} role="region" aria-labelledby={`${base}-btn`} hidden={!open} className="px-5 sm:px-6 pb-5 sm:pb-6 pt-1">
        {children}
      </div>
    </section>
  );
};
