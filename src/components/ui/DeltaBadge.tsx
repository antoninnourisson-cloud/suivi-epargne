// Variation (montant ou pourcentage) dans une pastille : flèche + signe + couleur, et une
// phrase complète pour les lecteurs d'écran (« en hausse de 120 € sur 30 jours »).
import React from 'react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { formatEUR } from '../../lib/format';

interface DeltaBadgeProps {
  value: number;
  /** 'eur' (défaut) ou 'pct' (value en points de pourcentage). */
  unit?: 'eur' | 'pct';
  /** Période lue après la valeur : « sur 30 jours ». */
  period?: string;
  className?: string;
}

const pct = (n: number) => `${Math.abs(n).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`;

export const DeltaBadge: React.FC<DeltaBadgeProps> = ({ value, unit = 'eur', period, className = '' }) => {
  const up = value > 0.004, down = value < -0.004;
  const Icon = up ? TrendingUp : down ? TrendingDown : Minus;
  const text = unit === 'pct' ? pct(value) : formatEUR(Math.abs(value), 0);
  const tone = up
    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200'
    : down ? 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-200'
      : 'bg-surface-container-high text-on-surface-variant';
  const spoken = `${up ? 'en hausse de' : down ? 'en baisse de' : 'stable'}${up || down ? ` ${text}` : ''}${period ? ` ${period}` : ''}`;
  return (
    <span className={`inline-flex items-center gap-1 h-7 px-2.5 rounded-sm text-xs font-medium tabular-nums ${tone} ${className}`}>
      <Icon className="w-3.5 h-3.5" aria-hidden="true" />
      <span aria-hidden="true">{up ? '+' : down ? '−' : ''}{text}{period ? ` ${period}` : ''}</span>
      <span className="sr-only">{spoken}</span>
    </span>
  );
};
