// Montant en euros, chiffres alignés (tabular-nums). `signed` affiche « + / − », et
// `tone="auto"` colore selon le sens (vert gain, rouge perte) : la couleur ne porte jamais
// seule l'information, le signe est toujours écrit.
import React from 'react';
import { formatEUR, formatSignedEUR } from '../../lib/format';

interface MoneyTextProps {
  value: number;
  decimals?: 'auto' | 0 | 2;
  signed?: boolean;
  tone?: 'auto' | 'neutral';
  className?: string;
}

const toneClass = (value: number) =>
  value > 0 ? 'text-emerald-700 dark:text-emerald-300' : value < 0 ? 'text-rose-700 dark:text-rose-300' : '';

export const MoneyText: React.FC<MoneyTextProps> = ({ value, decimals = 'auto', signed = false, tone = 'neutral', className = '' }) => (
  <span className={`tabular-nums whitespace-nowrap ${tone === 'auto' ? toneClass(value) : ''} ${className}`}>
    {signed ? formatSignedEUR(value, decimals) : formatEUR(value, decimals)}
  </span>
);
