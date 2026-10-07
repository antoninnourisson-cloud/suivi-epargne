// Petite courbe SVG faite main (sans bibliothèque) : tendance d'une série, ligne et
// dégradé dans la couleur principale. Décorative : la valeur et sa variation sont
// toujours écrites à côté, donc l'image est masquée aux lecteurs d'écran.
import React, { useId } from 'react';

interface SparklineProps {
  values: number[];
  width?: number;
  height?: number;
  className?: string;
}

export const sparkPath = (values: number[], width: number, height: number, pad = 2): { line: string; area: string } => {
  if (values.length < 2) return { line: '', area: '' };
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [
    (i / (values.length - 1)) * width,
    pad + (1 - (v - min) / span) * (height - pad * 2),
  ] as const);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  return { line, area: `${line} L${width} ${height} L0 ${height} Z` };
};

export const Sparkline: React.FC<SparklineProps> = ({ values, width = 160, height = 48, className = '' }) => {
  const gradient = useId();
  const { line, area } = sparkPath(values, width, height);
  if (!line) return null;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} className={`text-indigo-600 dark:text-indigo-300 ${className}`} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.28" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradient})`} />
      <path d={line} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
};
