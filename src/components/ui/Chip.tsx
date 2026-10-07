// Puce Material 3 : « filter » (sélection, avec coche) ou « suggestion » (raccourci).
import React from 'react';
import { Check } from 'lucide-react';

interface ChipProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean;
  kind?: 'filter' | 'suggestion';
  icon?: React.ComponentType<{ className?: string }>;
}

export const Chip: React.FC<ChipProps> = ({ selected = false, kind = 'filter', icon: Icon, className = '', children, ...rest }) => {
  const Leading = kind === 'filter' && selected ? Check : Icon;
  return (
    <button
      type="button"
      aria-pressed={kind === 'filter' ? selected : undefined}
      className={`h-8 px-3 inline-flex items-center gap-2 rounded-sm text-sm font-medium transition-colors ${selected ? 'bg-secondary-container text-on-secondary-container' : 'border border-outline text-on-surface-variant hover:bg-on-surface/8'} ${className}`}
      {...rest}
    >
      {Leading && <Leading className="w-4 h-4" aria-hidden="true" />}
      {children}
    </button>
  );
};
