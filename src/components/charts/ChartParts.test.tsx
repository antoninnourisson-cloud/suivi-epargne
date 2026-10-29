// @vitest-environment jsdom
// Légende des graphiques : la pastille reprend la forme de la série (trait, pointillé,
// aire pâle) pour qu'une courbe et une fourchette de même couleur ne se confondent pas.
import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ChartLegend } from './ChartParts';

afterEach(() => cleanup());

describe('ChartLegend', () => {
  it('une pastille par forme, carré par défaut', () => {
    render(<ChartLegend items={[
      { key: 'a', label: 'Courbe', color: '#00ff00', shape: 'line' },
      { key: 'b', label: 'Plan', color: '#00ff00', shape: 'dashed' },
      { key: 'c', label: 'Fourchette', color: '#00ff00', shape: 'band', bandOpacity: 0.16 },
      { key: 'd', label: 'Aire', color: '#00ff00' },
    ]} />);
    const shapes = screen.getAllByRole('listitem').map((li) => li.querySelector('[data-shape]')?.getAttribute('data-shape'));
    expect(shapes).toEqual(['line', 'dashed', 'band', 'square']);
  });

  it('la courbe et la fourchette de même couleur ne se dessinent pas pareil', () => {
    render(<ChartLegend items={[
      { key: 'a', label: 'Plan actuel', color: '#00ff00', shape: 'line' },
      { key: 'c', label: 'Fourchette', color: '#00ff00', shape: 'band', bandOpacity: 0.16 },
    ]} />);
    const [line, band] = screen.getAllByRole('listitem').map((li) => li.querySelector<HTMLElement>('[data-shape]')!);
    expect(line.className).not.toBe(band.className);
  });
});
