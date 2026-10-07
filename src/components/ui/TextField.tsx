// Champ texte Material 3 (variante « outlined ») : libellé relié, texte d'aide ou
// d'erreur annoncé (aria-describedby), suffixe (« € »). Pour un montant, utiliser
// NumberInput dans `render` afin de garder la saisie à la française.
import React, { useId } from 'react';

interface TextFieldProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label: string;
  supporting?: React.ReactNode;
  error?: React.ReactNode;
  suffix?: string;
  /** Champ personnalisé (ex. NumberInput) : reçoit id, classes et aria-describedby. */
  render?: (p: { id: string; className: string; describedBy?: string; invalid: boolean }) => React.ReactNode;
}

export const fieldClass = 'w-full h-14 px-4 rounded-xs bg-transparent border border-outline text-base text-on-surface placeholder:text-on-surface-variant/70 hover:border-on-surface focus:border-indigo-600 dark:focus:border-indigo-300 focus:border-2 focus:px-[15px] outline-none aria-[invalid=true]:border-error aria-[invalid=true]:border-2';

export const TextField: React.FC<TextFieldProps> = ({ label, supporting, error, suffix, render, className = '', id: idProp, ...input }) => {
  const auto = useId();
  const id = idProp ?? auto;
  const helpId = `${id}-help`;
  const describedBy = error || supporting ? helpId : undefined;
  return (
    <div className={className}>
      <label htmlFor={id} className="block text-sm font-medium text-on-surface-variant mb-1.5">{label}</label>
      <div className="relative">
        {render
          ? render({ id, className: fieldClass, describedBy, invalid: !!error })
          : <input id={id} aria-describedby={describedBy} aria-invalid={error ? true : undefined} className={`${fieldClass} ${suffix ? 'pr-10' : ''}`} {...input} />}
        {suffix && !render && <span className="absolute right-4 top-1/2 -translate-y-1/2 text-on-surface-variant pointer-events-none" aria-hidden="true">{suffix}</span>}
      </div>
      {(error || supporting) && (
        <p id={helpId} role={error ? 'alert' : undefined} className={`mt-1 px-4 text-xs ${error ? 'text-error font-medium' : 'text-on-surface-variant'}`}>{error || supporting}</p>
      )}
    </div>
  );
};
