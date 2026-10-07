// Carte Material 3. Trois variantes :
// - outlined (défaut) : surface claire bordée, pour les blocs d'information ;
// - filled : surface teintée, pour regrouper sans bordure ;
// - elevated : légère ombre, pour ce qui doit ressortir.
// `title` crée un en-tête titré (h3 par défaut) relié à la section pour les lecteurs d'écran.
import React, { useId } from 'react';

type Variant = 'outlined' | 'filled' | 'elevated';

const VARIANTS: Record<Variant, string> = {
  outlined: 'bg-surface-container-lowest dark:bg-surface-container-low border border-outline-variant',
  filled: 'bg-surface-container-highest dark:bg-surface-container-high',
  elevated: 'bg-surface-container-low shadow-sm',
};

interface CardProps extends Omit<React.HTMLAttributes<HTMLElement>, 'title'> {
  variant?: Variant;
  title?: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  /** Contenu à droite du titre (bouton, total…). */
  action?: React.ReactNode;
  headingLevel?: 2 | 3 | 4;
  /** Marges internes : `none` pour un tableau ou une liste pleine largeur. */
  padding?: 'none' | 'sm' | 'md';
}

export const Card: React.FC<CardProps> = ({
  variant = 'outlined', title, icon: Icon, action, headingLevel = 3, padding = 'md', className = '', children, ...rest
}) => {
  const titleId = useId();
  const H = `h${headingLevel}` as 'h2' | 'h3' | 'h4';
  const pad = padding === 'none' ? '' : padding === 'sm' ? 'p-4' : 'p-5 sm:p-6';
  return (
    <section aria-labelledby={title ? titleId : undefined} className={`rounded-2xl text-on-surface ${VARIANTS[variant]} ${pad} ${className}`} {...rest}>
      {title && (
        <div className={`flex items-start justify-between gap-3 ${padding === 'none' ? 'px-5 pt-5 sm:px-6 sm:pt-6' : ''} mb-4`}>
          <H id={titleId} className="text-base font-medium text-on-surface flex items-center gap-2 min-w-0">
            {Icon && <Icon className="w-5 h-5 shrink-0 text-indigo-600 dark:text-indigo-300" aria-hidden="true" />}
            <span className="min-w-0">{title}</span>
          </H>
          {action && <div className="shrink-0 flex items-center gap-2">{action}</div>}
        </div>
      )}
      {children}
    </section>
  );
};
