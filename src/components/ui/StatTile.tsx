// Chiffre clé : libellé, valeur, variation et précision. `size="hero"` pour LE chiffre
// principal d'un écran (un seul par écran).
import React from 'react';

interface StatTileProps {
  label: React.ReactNode;
  value: React.ReactNode;
  delta?: React.ReactNode;
  hint?: React.ReactNode;
  size?: 'hero' | 'md';
  className?: string;
  children?: React.ReactNode;
}

export const StatTile: React.FC<StatTileProps> = ({ label, value, delta, hint, size = 'md', className = '', children }) => (
  <div className={`min-w-0 ${className}`}>
    <p className="text-sm font-medium text-on-surface-variant">{label}</p>
    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
      <p className={`${size === 'hero' ? 'text-[44px] leading-[52px] font-normal tracking-tight' : 'text-[28px] leading-9 font-normal'} text-on-surface tabular-nums`}>{value}</p>
      {delta}
    </div>
    {hint && <p className="mt-1 text-xs text-on-surface-variant">{hint}</p>}
    {children}
  </div>
);
