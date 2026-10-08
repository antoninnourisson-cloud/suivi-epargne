// Pièces communes des graphiques Material 3 : pastille de série, légende qui écrit les
// valeurs, infobulle en carte (surface-container-high, rayon 12 px, ombre moyenne).
// Le texte reste dans les couleurs de texte du thème ; seule la pastille porte la couleur
// de la série.
import React from 'react';

/** Pastille de couleur d'une série ; hachurée pour l'épargne bloquée ou fiscalisée. */
const SeriesSwatch: React.FC<{ color: string; striped?: boolean; shape?: 'square' | 'line' }> = ({ color, striped, shape = 'square' }) => (
  <span
    aria-hidden="true"
    className={shape === 'line' ? 'inline-block w-3 h-0.5 rounded-full shrink-0' : 'inline-block w-2.5 h-2.5 rounded-[3px] shrink-0'}
    style={striped
      ? { backgroundImage: `repeating-linear-gradient(45deg, ${color} 0 2px, transparent 2px 4px)`, boxShadow: `inset 0 0 0 1.5px ${color}` }
      : { backgroundColor: color }}
  />
);

export interface LegendItem {
  key: string;
  label: string;
  color: string;
  /** Valeur écrite à côté du nom (ex. dernier solde). */
  value?: string;
  striped?: boolean;
}

/** Légende HTML : nom + valeur, lisible sans survol ni couleur. */
export const ChartLegend: React.FC<{ items: LegendItem[]; label?: string }> = ({ items, label = 'Légende' }) => (
  <ul aria-label={label} className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-on-surface-variant">
    {items.map(i => (
      <li key={i.key} className="inline-flex items-center gap-1.5 min-w-0">
        <SeriesSwatch color={i.color} striped={i.striped} />
        <span className="truncate">{i.label}</span>
        {i.value !== undefined && <span className="font-medium text-on-surface tabular-nums whitespace-nowrap">{i.value}</span>}
      </li>
    ))}
  </ul>
);

export interface TooltipRow {
  key: string;
  label: string;
  value: string;
  color?: string;
  striped?: boolean;
}

/** Contenu d'infobulle : titre (date…), une ligne par série, total facultatif. */
export const ChartTooltipCard: React.FC<{ title: string; rows: TooltipRow[]; total?: { label: string; value: string } }> = ({ title, rows, total }) => (
  <div className="rounded-xl bg-surface-container-high text-on-surface shadow-md px-3 py-2.5 text-xs tabular-nums min-w-40 max-w-72">
    <p className="font-medium text-on-surface-variant mb-1.5">{title}</p>
    <ul className="space-y-1">
      {rows.map(r => (
        <li key={r.key} className="flex items-center justify-between gap-4">
          <span className="inline-flex items-center gap-1.5 min-w-0">
            {r.color && <SeriesSwatch color={r.color} striped={r.striped} />}
            <span className="truncate">{r.label}</span>
          </span>
          <span className="font-medium whitespace-nowrap">{r.value}</span>
        </li>
      ))}
    </ul>
    {total && (
      <p className="flex items-center justify-between gap-4 border-t border-outline-variant mt-1.5 pt-1.5 font-medium">
        <span>{total.label}</span><span className="whitespace-nowrap">{total.value}</span>
      </p>
    )}
  </div>
);
