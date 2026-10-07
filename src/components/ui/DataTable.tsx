// Tableau de données : légende (lue par les lecteurs d'écran, visible si `showCaption`),
// en-têtes de colonne, première colonne en en-tête de ligne, nombres alignés à droite.
// Sert aussi d'alternative textuelle aux graphiques.
import React from 'react';

export interface Column<R> {
  key: string;
  header: React.ReactNode;
  cell: (row: R) => React.ReactNode;
  numeric?: boolean;
}

interface DataTableProps<R> {
  caption: string;
  columns: Column<R>[];
  rows: R[];
  rowKey: (row: R) => string;
  showCaption?: boolean;
  className?: string;
}

export const DataTable = <R,>({ caption, columns, rows, rowKey, showCaption = false, className = '' }: DataTableProps<R>) => (
  <div className={`overflow-x-auto ${className}`}>
    <table className="w-full text-sm tabular-nums">
      <caption className={showCaption ? 'text-left text-sm font-medium text-on-surface-variant pb-2' : 'sr-only'}>{caption}</caption>
      <thead>
        <tr className="border-b border-outline-variant">
          {columns.map(c => (
            <th key={c.key} scope="col" className={`py-2 px-3 first:pl-0 last:pr-0 text-xs font-medium text-on-surface-variant ${c.numeric ? 'text-right' : 'text-left'}`}>{c.header}</th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-outline-variant">
        {rows.map(r => (
          <tr key={rowKey(r)}>
            {columns.map((c, i) => {
              const Cell = i === 0 ? 'th' : 'td';
              return (
                <Cell key={c.key} scope={i === 0 ? 'row' : undefined} className={`py-2.5 px-3 first:pl-0 last:pr-0 ${i === 0 ? 'font-medium text-on-surface text-left' : 'text-on-surface'} ${c.numeric ? 'text-right whitespace-nowrap' : ''}`}>
                  {c.cell(r)}
                </Cell>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);
