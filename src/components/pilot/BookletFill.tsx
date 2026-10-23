// Remplissage des livrets réglementés : part des parents (rôle « parents », l'or de Pécule
// partout), part propre (primaire), plafond.
import React from 'react';
import { BarChart3 } from 'lucide-react';
import { Card, MoneyText } from '../ui';

export interface BookletStat {
  id: string;
  name: string;
  ceiling: number;
  parentAmount: number;
  ownedAmount: number;
  parentPct: number;
  ownedPct: number;
  totalPct: number;
  monthsToFull: number | null;
}

export const BookletFill: React.FC<{ booklets: BookletStat[] }> = ({ booklets }) => (
  <Card title="Remplissage des livrets" icon={BarChart3}>
    {booklets.length === 0 ? (
      <p className="text-sm text-on-surface-variant">Aucun livret réglementé (LEP, Livret A, LDDS) pour l'instant.</p>
    ) : (
      <ul className="space-y-5">
        {booklets.map(b => (
          <li key={b.id} className="space-y-2">
            <div className="flex justify-between gap-3 text-sm">
              <span className="font-medium text-on-surface min-w-0 truncate">{b.name}</span>
              <span className="tabular-nums text-on-surface">
                {Math.round(b.totalPct)} %{b.totalPct >= 100 && <span className="ml-2 text-gain font-medium">Plein</span>}
              </span>
            </div>
            <div className="w-full h-2 bg-surface-container-highest rounded-full overflow-hidden flex" aria-hidden="true">
              <div className="h-full bg-parents" style={{ width: `${b.parentPct}%` }} />
              <div className="h-full bg-primary" style={{ width: `${b.ownedPct}%` }} />
            </div>
            <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 text-xs text-on-surface-variant">
              {b.parentAmount > 0 && (
                <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-parents" aria-hidden="true" />Parents <MoneyText value={b.parentAmount} /></span>
              )}
              <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-primary" aria-hidden="true" />Moi <MoneyText value={b.ownedAmount} /></span>
              {b.parentAmount > 0 && b.ownedAmount > 0 && <span>Total <MoneyText value={b.parentAmount + b.ownedAmount} /></span>}
              <span>Plafond <MoneyText value={b.ceiling} /></span>
            </div>
            {b.monthsToFull !== null && <p className="text-xs text-on-surface-variant">Plein dans ~{b.monthsToFull} mois au rythme actuel</p>}
          </li>
        ))}
      </ul>
    )}
  </Card>
);
