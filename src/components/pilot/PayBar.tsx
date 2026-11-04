// ================================================
// FILE: src/components/pilot/PayBar.tsx
// La barre de la paie : ce que devient l'argent reçu, en quatre parts dans l'ordre des
// priorités (virements fixes, épargne, épargne projets, plaisir). Parts proportionnelles ;
// une part coupée montre ce qui lui manque en pointillé. Pour les lecteurs d'écran, la barre
// est une image (role="img") dont le libellé dit tous les montants, et la légende (<dl>) les
// écrit en toutes lettres. Les montants passent par les formateurs partagés (mode discret).
// ================================================
import React from 'react';
import type { PayBar as PayBarData, PayBarKey } from '../../lib/pilotView';
import { formatEUR } from '../../lib/format';
import { MoneyText } from '../ui';

const SWATCH: Record<PayBarKey, string> = {
  fixed: 'bg-secondary',
  savings: 'bg-primary',
  projects: 'bg-tertiary',
  leisure: 'bg-surface-container-highest border border-outline',
};

/** Pastille de couleur d'une part (légende, titres des groupes du rituel). */
export const PartSwatch: React.FC<{ part: PayBarKey }> = ({ part }) => (
  <span aria-hidden="true" className={`inline-block h-3 w-3 shrink-0 rounded-full ${SWATCH[part]}`} />
);

interface PayBarProps {
  bar: PayBarData;
  /** Précision : à l'euro ou au centime (pilotView.barDecimals) ; par défaut, selon le montant. */
  decimals?: 0 | 2;
  /** Précision sous le montant d'une part (« dont prime 500 € »…). */
  notes?: Partial<Record<PayBarKey, React.ReactNode>>;
  className?: string;
}

export const PayBar: React.FC<PayBarProps> = ({ bar, notes = {}, decimals, className = '' }) => {
  const segments = bar.parts.flatMap(p => {
    const cut = p.planned !== undefined ? Math.max(0, p.planned - p.amount) : 0;
    return [
      ...(p.amount > 0 ? [{ key: p.key, grow: p.amount, cut: false }] : []),
      ...(cut > 0 ? [{ key: p.key, grow: cut, cut: true }] : []),
    ];
  });
  return (
    <div className={className}>
      <div role="img" aria-label={bar.label} className="flex h-4 w-full gap-0.5 overflow-hidden rounded-full">
        {segments.length === 0 && <div className="flex-1 rounded-full bg-surface-container-highest" />}
        {segments.map((s, i) => (
          <div
            key={`${s.key}-${s.cut ? 'cut' : 'part'}`}
            style={{ flexGrow: s.grow, flexBasis: 0, minWidth: 4 }}
            className={`${s.cut ? 'border-2 border-dashed border-outline' : SWATCH[s.key]} ${i === 0 ? 'rounded-l-full' : ''} ${i === segments.length - 1 ? 'rounded-r-full' : ''}`}
          />
        ))}
      </div>
      <dl className="mt-3 grid grid-cols-1 min-[360px]:grid-cols-2 gap-x-4 gap-y-2 text-sm">
        {bar.parts.map(p => (
          <div key={p.key} className="min-w-0">
            <dt className="flex items-center gap-2 text-on-surface-variant">
              <PartSwatch part={p.key} />
              {p.label}
            </dt>
            <dd className="ml-5 text-on-surface">
              <MoneyText value={p.amount} decimals={decimals} className="font-medium" />
              {p.planned !== undefined && <span className="text-on-surface-variant"> (prévu {formatEUR(p.planned, decimals)})</span>}
              {notes[p.key] && <span className="block text-xs text-on-surface-variant">{notes[p.key]}</span>}
            </dd>
          </div>
        ))}
      </dl>
      {bar.missingFixed > 0 && (
        <p className="mt-2 text-sm font-medium text-error">Il manque {formatEUR(bar.missingFixed)} pour les virements fixes.</p>
      )}
    </div>
  );
};

export default PayBar;
