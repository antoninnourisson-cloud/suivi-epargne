// Onglet « Horloge fiscale » : quand chaque PEA, PEE ou assurance-vie devient disponible.
import React from 'react';
import { Hourglass, Lock, Unlock } from 'lucide-react';
import { Card, EmptyState, StatTile } from '../ui';

export interface FiscalClockItem {
  id: string;
  name: string;
  type: string;
  date: string;
  timeLeft: string;
  isAvailable: boolean;
}

export const FiscalClock: React.FC<{ items: FiscalClockItem[] }> = ({ items }) => {
  if (items.length === 0) {
    return (
      <Card>
        <EmptyState icon={Hourglass} title="Aucun compte fiscal à échéance pour l'instant.">
          Les PEA, PEE et assurances-vie avec une date d'ouverture apparaîtront ici.
        </EmptyState>
      </Card>
    );
  }
  const available = items.filter(i => i.isAvailable).length;
  return (
    <div className="space-y-6">
      <Card>
        <div className="grid grid-cols-3 gap-4 items-end">
          <StatTile label="Comptes suivis" value={items.length} />
          <StatTile label="Disponibles" value={available} />
          <StatTile label="Encore bloqués" value={items.length - available} />
        </div>
      </Card>
      <ul className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" aria-label="Échéances fiscales">
        {items.map(item => {
          const Icon = item.isAvailable ? Unlock : Lock;
          return (
            <li key={item.id} className="rounded-2xl border border-outline-variant bg-surface-container-lowest dark:bg-surface-container-low p-5 text-on-surface flex flex-col gap-4">
              <div className="flex items-start justify-between gap-3">
                <span className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-sm text-xs font-medium ${item.isAvailable ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200' : 'bg-secondary-container text-on-secondary-container'}`}>
                  <Icon className="w-3.5 h-3.5" aria-hidden="true" />
                  {item.isAvailable ? 'Disponible' : 'Bloqué'}
                </span>
                <span className="text-xs font-medium text-on-surface-variant">{item.type}</span>
              </div>
              <h3 className="text-base font-medium text-on-surface">{item.name}</h3>
              <dl className="mt-auto pt-4 border-t border-outline-variant flex items-end justify-between gap-3">
                <div>
                  <dt className="text-xs text-on-surface-variant">Échéance</dt>
                  <dd className="text-sm text-on-surface tabular-nums">{item.date || '—'}</dd>
                </div>
                <div className="text-right">
                  <dt className="text-xs text-on-surface-variant">{item.isAvailable ? 'Statut' : 'Encore'}</dt>
                  <dd className={`text-xl tabular-nums ${item.isAvailable ? 'text-emerald-700 dark:text-emerald-300' : 'text-indigo-700 dark:text-indigo-200'}`}>{item.timeLeft}</dd>
                </div>
              </dl>
            </li>
          );
        })}
      </ul>
    </div>
  );
};
