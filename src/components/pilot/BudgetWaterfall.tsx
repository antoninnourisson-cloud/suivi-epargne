// « D'où vient ce chiffre » : de la paie au montant à placer, ligne par ligne. Chaque
// montant porte son signe écrit (− / +), la couleur ne sert que d'appui.
import React from 'react';
import { WaterfallRow } from '../../lib/pilotView';
import { MoneyText } from '../ui';

const rowAmount = (r: WaterfallRow) => {
  switch (r.kind) {
    case 'minus': return <MoneyText value={-r.amount} signed className={r.amount !== 0 ? 'text-rose-700 dark:text-rose-300' : ''} />;
    case 'adjust': return <MoneyText value={r.amount} signed tone="auto" />;
    default: return <MoneyText value={r.amount} />;
  }
};

export const BudgetWaterfall: React.FC<{ rows: WaterfallRow[] }> = ({ rows }) => (
  <table className="w-full text-sm tabular-nums">
    <caption className="sr-only">Calcul du montant à placer ce mois</caption>
    <thead className="sr-only">
      <tr><th scope="col">Étape</th><th scope="col">Montant</th></tr>
    </thead>
    <tbody>
      {rows.map(r => {
        const strong = r.kind === 'subtotal' || r.kind === 'total' || r.kind === 'start';
        const ruled = r.kind === 'subtotal' || r.kind === 'total';
        return (
          <tr key={r.key} className={ruled ? 'border-t border-outline-variant' : ''}>
            <th scope="row" className={`py-2 pr-4 text-left align-top ${strong ? 'font-medium text-on-surface' : 'font-normal text-on-surface-variant'} ${r.kind === 'total' ? 'text-base' : ''}`}>
              {r.kind === 'subtotal' || r.kind === 'total' ? <span aria-hidden="true">= </span> : null}
              {r.label}
              {r.note && <span className="block text-xs font-normal text-on-surface-variant">{r.note}</span>}
            </th>
            <td className={`py-2 text-right align-top whitespace-nowrap ${strong ? 'font-medium text-on-surface' : ''} ${r.kind === 'total' ? 'text-base text-indigo-700 dark:text-indigo-200' : ''} ${r.kind === 'replace' ? 'text-on-surface' : ''}`}>
              {rowAmount(r)}
            </td>
          </tr>
        );
      })}
    </tbody>
  </table>
);
