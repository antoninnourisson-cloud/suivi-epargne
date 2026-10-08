// Champs des Paramètres : interrupteur Material 3 avec son libellé, et champ numérique
// « outlined » (saisie à la française via NumberInput).
import React, { useId } from 'react';
import { Check } from 'lucide-react';
import { NumberInput } from '../NumberInput';
import { TextField } from '../ui';

interface SwitchRowProps {
  label: React.ReactNode;
  hint?: React.ReactNode;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  /** Message sous le réglage (erreur d'activation…). */
  error?: React.ReactNode;
  children?: React.ReactNode;
}

/** Libellé, aide, et interrupteur (role="switch") aligné à droite. */
export const SwitchRow: React.FC<SwitchRowProps> = ({ label, hint, checked, onChange, disabled, error, children }) => {
  const id = useId();
  const hintId = useId();
  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <label htmlFor={id} className="text-sm font-medium text-on-surface cursor-pointer">{label}</label>
          {hint && <p id={hintId} className="text-xs text-on-surface-variant mt-0.5 max-w-xl leading-relaxed">{hint}</p>}
        </div>
        <Switch id={id} checked={checked} onChange={onChange} disabled={disabled} describedBy={hint ? hintId : undefined} />
      </div>
      {error && <p role="alert" className="text-xs font-medium text-error mt-2">{error}</p>}
      {children}
    </div>
  );
};

export const Switch: React.FC<{ id?: string; checked: boolean; onChange: (next: boolean) => void; disabled?: boolean; describedBy?: string; label?: string }> = ({ id, checked, onChange, disabled, describedBy, label }) => (
  <button
    id={id}
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    aria-describedby={describedBy}
    disabled={disabled}
    onClick={() => onChange(!checked)}
    className={`relative shrink-0 w-[52px] h-8 rounded-full transition-colors disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 dark:focus-visible:outline-indigo-300 ${checked ? 'bg-primary' : 'bg-surface-container-highest border-2 border-outline'}`}
  >
    <span className={`absolute top-1/2 -translate-y-1/2 rounded-full flex items-center justify-center transition-all motion-reduce:transition-none ${checked ? 'left-[24px] w-6 h-6 bg-on-primary text-primary' : 'left-[6px] w-4 h-4 bg-outline'}`}>
      {checked && <Check className="w-4 h-4" aria-hidden="true" />}
    </span>
  </button>
);

interface NumberFieldProps {
  label: string;
  value: number;
  onChange: (v: number) => void;
  supporting?: React.ReactNode;
  suffix?: string;
  min?: number;
  className?: string;
}

/** Champ numérique Material 3 : libellé relié, aide annoncée, saisie « 0,2232 » ou « 1 250 ». */
export const NumberField: React.FC<NumberFieldProps> = ({ label, value, onChange, supporting, suffix, min, className }) => (
  <TextField label={label} supporting={supporting} className={className}
    render={p => <NumberInput id={p.id} value={value} onChange={onChange} suffix={suffix} min={min} describedBy={p.describedBy} invalid={p.invalid}
      className={`${p.className} tabular-nums`} />} />
);
