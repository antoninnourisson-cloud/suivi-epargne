// Montant en euros, chiffres alignés (tabular-nums). `signed` affiche « + / − », et
// `tone="auto"` colore selon le sens (vert gain, rouge perte) : la couleur ne porte jamais
// seule l'information, le signe est toujours écrit.
import React from 'react';
import { formatEUR, formatSignedEUR, isDiscreetAmounts } from '../../lib/format';

interface MoneyTextProps {
  value: number;
  decimals?: 'auto' | 0 | 2;
  signed?: boolean;
  tone?: 'auto' | 'neutral';
  className?: string;
}

const toneClass = (value: number) =>
  value > 0 ? 'text-gain' : value < 0 ? 'text-loss' : '';

export const MoneyText: React.FC<MoneyTextProps> = ({ value, decimals = 'auto', signed = false, tone = 'neutral', className = '' }) => {
  const text = signed ? formatSignedEUR(value, decimals) : formatEUR(value, decimals);
  // Mode discret : les points ne disent rien à un lecteur d'écran (il les lirait « point point… »),
  // on lui annonce « montant masqué » à la place.
  const masked = isDiscreetAmounts() && Number.isFinite(value);
  return (
    <span className={`tabular-nums whitespace-nowrap ${tone === 'auto' ? toneClass(value) : ''} ${className}`}>
      {masked ? <><span aria-hidden="true">{text}</span><span className="sr-only">montant masqué</span></> : text}
    </span>
  );
};
