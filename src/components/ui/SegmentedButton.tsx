// Bouton segmenté Material 3 : choix exclusif parmi 2 à 5 options, coche sur l'option
// choisie. Chaque segment est un bouton aria-pressed dans un groupe nommé.
import React from 'react';
import { Check } from 'lucide-react';

interface Option<T extends string> { value: T; label: React.ReactNode; icon?: React.ComponentType<{ className?: string }> }

interface SegmentedButtonProps<T extends string> {
  label: string;
  options: Option<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}

export const SegmentedButton = <T extends string>({ label, options, value, onChange, className = '' }: SegmentedButtonProps<T>) => (
  <div role="group" aria-label={label} className={`inline-flex rounded-full border border-outline overflow-hidden ${className}`}>
    {options.map((o, i) => {
      const selected = o.value === value;
      const Icon = selected ? Check : o.icon;
      return (
        <button
          key={o.value}
          type="button"
          aria-pressed={selected}
          onClick={() => onChange(o.value)}
          className={`h-10 px-4 flex items-center justify-center gap-2 text-sm font-medium transition-colors ${i > 0 ? 'border-l border-outline' : ''} ${selected ? 'bg-secondary-container text-on-secondary-container' : 'text-on-surface hover:bg-on-surface/8'}`}
        >
          {Icon && <Icon className="w-4 h-4" aria-hidden="true" />}
          {o.label}
        </button>
      );
    })}
  </div>
);
