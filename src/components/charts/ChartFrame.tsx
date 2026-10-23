// Cadre accessible d'un graphique : phrase de synthèse visible, légende, graphique
// (masqué aux lecteurs d'écran, la synthèse et le tableau le remplacent) et bouton
// « Voir les données » qui révèle le même contenu sous forme de tableau.
// - `fill` : le cadre remplit la hauteur imposée par son parent ; le tableau prend alors
//   la place du graphique (défilable) au lieu de déborder sous la carte.
// - sinon : le graphique a la hauteur `chartClassName` et le tableau s'ouvre dessous.
import React, { useId, useState } from 'react';
import { Table2, ChartArea } from 'lucide-react';
import { Button } from '../Button';

interface ChartFrameProps {
  summary: React.ReactNode;
  legend?: React.ReactNode;
  /** Le tableau de données (ui/DataTable). */
  table: React.ReactNode;
  children: React.ReactNode;
  fill?: boolean;
  chartClassName?: string;
  /** Synthèse en petit (cadres très bas). */
  compact?: boolean;
}

export const ChartFrame: React.FC<ChartFrameProps> = ({ summary, legend, table, children, fill = false, chartClassName = 'h-72', compact = false }) => {
  const [showData, setShowData] = useState(false);
  const tableId = useId();
  const swapped = fill && showData;

  const toggle = (
    <Button
      type="button"
      variant="text"
      size="sm"
      aria-expanded={showData}
      aria-controls={tableId}
      onClick={() => setShowData(v => !v)}
      // Bouton texte compact (12 px) : il accompagne le graphique sans lui voler la place.
      className={`text-xs ${compact ? 'h-7! px-2! -mr-2' : '-ml-3'}`}
    >
      {fill && showData
        ? <><ChartArea className="w-4 h-4" aria-hidden="true" /> Revenir au graphique</>
        : <><Table2 className="w-4 h-4" aria-hidden="true" /> {showData ? 'Masquer les données' : 'Voir les données'}</>}
    </Button>
  );

  return (
    <div className={fill ? 'h-full flex flex-col gap-2 min-h-0' : 'flex flex-col gap-3'}>
      {compact ? (
        // Cadre bas (Accueil) : synthèse et bouton sur la même ligne, pour laisser la hauteur au tracé.
        <div className="flex items-start justify-between gap-2 shrink-0">
          <p className="text-xs text-on-surface-variant pt-1.5">{summary}</p>
          <div className="shrink-0">{toggle}</div>
        </div>
      ) : <p className="text-sm text-on-surface-variant">{summary}</p>}
      {!swapped && legend}
      {!swapped && (
        <div aria-hidden="true" className={fill ? 'flex-1 min-h-0' : chartClassName}>
          {children}
        </div>
      )}
      <div id={tableId} hidden={!showData} className={swapped ? 'flex-1 min-h-0 overflow-auto' : ''}>
        {showData && table}
      </div>
      {!compact && <div className="shrink-0">{toggle}</div>}
    </div>
  );
};
