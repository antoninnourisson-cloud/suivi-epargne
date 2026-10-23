// Bouton Material 3 : pilule de 40 px, cinq variantes fondées sur les rôles de couleur.
// - filled : action principale ;
// - tonal : action secondaire mise en avant ;
// - outlined, text : actions discrètes ;
// - danger : action destructrice (rôle « error »).
// Taille « sm » : 32 px de haut (bouton secondaire dans une ligne de liste ou sous un champ) ;
// sur écran tactile, la zone sensible reste de 48 px (index.css). Marges intérieures
// Material : 24 px, 12 px pour un bouton texte (un `-ml-3` aligne alors son texte au bord).
// Une classe passée en `className` ne remplace pas toujours celle du kit (h-8 contre h-10 :
// Tailwind les range dans son ordre à lui) : utiliser `size`, ou suffixer `!`.
//
// Désactivé : état Material 3 (fond on-surface à 12 %, contenu à 38 %), bien distinct d'un
// bouton tonal actif. Dire POURQUOI à côté du bouton (texte d'aide visible, relié par
// `aria-describedby`), par exemple « Ajoutez une clé Gemini dans les Paramètres ».
import React from 'react';

export type ButtonVariant = 'filled' | 'tonal' | 'outlined' | 'text' | 'danger';
export type ButtonSize = 'sm' | 'md';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  // React 19 : la ref est une prop ordinaire, transmise au <button> (focus initial d'une boîte).
  ref?: React.Ref<HTMLButtonElement>;
}

// Survol : calque d'état de 8 % de la couleur du contenu (Material 3), seulement s'il est actif.
const CONTAINED_DISABLED = 'disabled:bg-on-surface/12 disabled:text-on-surface/38 disabled:shadow-none';
const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  filled: `bg-primary text-on-primary enabled:hover:shadow-sm enabled:hover:bg-[color-mix(in_srgb,var(--color-primary)_92%,var(--color-on-primary))] ${CONTAINED_DISABLED}`,
  tonal: `bg-secondary-container text-on-secondary-container enabled:hover:shadow-sm enabled:hover:bg-[color-mix(in_srgb,var(--color-secondary-container)_92%,var(--color-on-secondary-container))] ${CONTAINED_DISABLED}`,
  outlined: 'border border-outline text-primary enabled:hover:bg-primary/8 disabled:border-on-surface/12 disabled:text-on-surface/38',
  text: 'text-primary enabled:hover:bg-primary/8 disabled:text-on-surface/38',
  danger: `bg-error text-on-error enabled:hover:shadow-sm enabled:hover:bg-[color-mix(in_srgb,var(--color-error)_92%,var(--color-on-error))] ${CONTAINED_DISABLED}`,
};

const sizeClass = (variant: ButtonVariant, size: ButtonSize) =>
  size === 'sm' ? 'h-8 px-3 gap-1.5' : `h-10 gap-2 ${variant === 'text' ? 'px-3' : 'px-6'}`;

/** Classes d'un bouton du kit, pour un lien (<a>) qui doit avoir l'air d'un bouton. */
export const buttonClass = (variant: ButtonVariant = 'filled', className = '', size: ButtonSize = 'md') =>
  `${sizeClass(variant, size)} rounded-full text-sm font-medium inline-flex items-center justify-center transition-all disabled:cursor-not-allowed ${BUTTON_VARIANTS[variant]} ${className}`;

export const Button: React.FC<ButtonProps> = ({ children, variant = 'filled', size = 'md', isLoading, className = '', disabled, ...props }) => (
  <button
    className={buttonClass(variant, className, size)}
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
