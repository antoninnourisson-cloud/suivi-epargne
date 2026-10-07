// Bouton Material 3 : pilule de 40 px, cinq variantes.
// - filled (anciennement primary) : action principale ;
// - tonal (anciennement secondary) : action secondaire mise en avant ;
// - outlined, text (anciennement ghost) : actions discrètes ;
// - danger : action destructrice.
import React from 'react';

type Variant = 'filled' | 'tonal' | 'outlined' | 'text' | 'danger' | 'primary' | 'secondary' | 'ghost';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  isLoading?: boolean;
}

const VARIANTS: Record<Variant, string> = {
  filled: 'bg-indigo-600 text-white hover:shadow-sm hover:bg-indigo-700',
  primary: 'bg-indigo-600 text-white hover:shadow-sm hover:bg-indigo-700',
  tonal: 'bg-secondary-container text-on-secondary-container hover:shadow-sm',
  secondary: 'bg-secondary-container text-on-secondary-container hover:shadow-sm',
  outlined: 'border border-outline text-indigo-700 dark:text-indigo-200 hover:bg-indigo-600/8',
  text: 'text-indigo-700 dark:text-indigo-200 hover:bg-indigo-600/8',
  ghost: 'text-indigo-700 dark:text-indigo-200 hover:bg-indigo-600/8',
  danger: 'bg-error text-on-error hover:shadow-sm',
};

export const Button: React.FC<ButtonProps> = ({ children, variant = 'filled', isLoading, className = '', disabled, ...props }) => (
  <button
    className={`h-10 px-6 rounded-full text-sm font-medium inline-flex items-center justify-center gap-2 transition-all disabled:opacity-40 disabled:cursor-not-allowed ${VARIANTS[variant]} ${className}`}
    disabled={disabled || isLoading}
    {...props}
  >
    {isLoading ? (
      <>
        <svg className="animate-spin -ml-1 h-4 w-4 text-current" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        Enregistrement…
      </>
    ) : children}
  </button>
);
