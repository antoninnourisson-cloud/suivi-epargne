// Barre de disponibilité de l'accueil : une barre empilée (disponible tout de suite /
// avec impôt / bloqué) et une légende qui écrit chaque montant et sa part. La barre est
// décorative (la légende dit tout) ; les parts moins disponibles sont en plus hachurées,
// comme sur le graphique d'évolution, pour ne jamais compter sur la seule couleur.
import React from 'react';
import { MoneyText } from '../ui';
import { availabilityShares } from '../../lib/homeSeries';

export interface AvailabilitySegment {
  key: string;
  label: string;
  hint: string;
  amount: number;
  /** Classe de fond de la part (rôle Material). */
  color: string;
  hatch?: 'light' | 'dense';
}

const HATCH: Record<'light' | 'dense', string> = {
  light: 'repeating-linear-gradient(45deg, transparent 0 4px, rgba(255,255,255,.4) 4px 6px)',
  dense: 'repeating-linear-gradient(-45deg, transparent 0 2px, rgba(255,255,255,.45) 2px 4px)',
};

const pct = (n: number) => `${Math.round(n)} %`;

export const AvailabilityBar: React.FC<{ segments: AvailabilitySegment[]; children?: React.ReactNode }> = ({ segments, children }) => {
  const shares = availabilityShares(segments.map(s => s.amount));
  return (
    <div>
      <p className="text-sm font-medium text-on-surface-variant mb-2">Disponibilité</p>
      <div className="flex h-3 w-full gap-0.5 rounded-full overflow-hidden bg-surface-container-highest" aria-hidden="true">
        {segments.map((s, i) => shares[i] > 0 && (
          <div key={s.key} className={`h-full ${s.color}`} style={{ width: `${shares[i]}%`, backgroundImage: s.hatch ? HATCH[s.hatch] : undefined }} />
        ))}
      </div>
      <dl className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-3">
        {segments.map((s, i) => (
          <div key={s.key} className="min-w-0 flex items-start gap-2.5">
            <span className={`mt-1 w-3 h-3 rounded-xs shrink-0 ${s.color}`} style={{ backgroundImage: s.hatch ? HATCH[s.hatch] : undefined }} aria-hidden="true" />
            <div className="min-w-0">
              <dt className="text-sm text-on-surface-variant">{s.label}</dt>
              <dd className="text-base font-medium text-on-surface">
                <MoneyText value={s.amount} decimals={0} />
                <span className="ml-1.5 text-xs font-normal text-on-surface-variant tabular-nums">{pct(shares[i])}</span>
              </dd>
              <dd className="text-xs text-on-surface-variant">{s.hint}</dd>
            </div>
          </div>
        ))}
      </dl>
      {children}
    </div>
  );
};
