// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import { DataTable, DeltaBadge, MoneyText, SegmentedButton, Tabs, TextField, sparkPath } from './index';

describe('sparkPath', () => {
  it('trace la série de gauche à droite, le maximum en haut', () => {
    const { line } = sparkPath([0, 10], 100, 20, 0);
    expect(line).toBe('M0.0 20.0 L100.0 0.0');
  });
  it('ne trace rien avec moins de deux points, et une série plate reste à plat', () => {
    expect(sparkPath([5], 100, 20).line).toBe('');
    expect(sparkPath([3, 3, 3], 100, 20, 0).line).toBe('M0.0 20.0 L50.0 20.0 L100.0 20.0');
  });
});

describe('MoneyText et DeltaBadge', () => {
  it('écrit le signe, pas seulement la couleur', () => {
    render(<MoneyText value={-12.5} signed tone="auto" />);
    expect(screen.getByText(/−12,50/)).toBeTruthy();
  });
  it('annonce la variation en toutes lettres', () => {
    render(<DeltaBadge value={120} period="sur 30 jours" />);
    expect(screen.getByText('en hausse de 120 € sur 30 jours')).toBeTruthy();
  });
});

describe('DataTable', () => {
  it('a une légende, des en-têtes de colonne et de ligne', () => {
    render(<DataTable caption="Épargne par mois" rowKey={r => r.m} rows={[{ m: 'janv.', v: 10 }]}
      columns={[{ key: 'm', header: 'Mois', cell: r => r.m }, { key: 'v', header: 'Montant', cell: r => r.v, numeric: true }]} />);
    expect(screen.getByRole('table', { name: 'Épargne par mois' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Montant' })).toBeTruthy();
    expect(screen.getByRole('rowheader', { name: 'janv.' })).toBeTruthy();
  });
});

describe('Tabs', () => {
  const Demo = () => {
    const [v, setV] = useState<'a' | 'b'>('a');
    return <Tabs label="Vues" value={v} onChange={setV} tabs={[{ value: 'a', label: 'Un' }, { value: 'b', label: 'Deux' }]}><p>Contenu {v}</p></Tabs>;
  };
  it('relie onglets et panneau, et se pilote aux flèches', () => {
    render(<Demo />);
    const un = screen.getByRole('tab', { name: 'Un' });
    expect(screen.getByRole('tabpanel', { name: 'Un' })).toBeTruthy();
    un.focus();
    fireEvent.keyDown(un, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Deux' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('Contenu b')).toBeTruthy();
  });
});

describe('SegmentedButton', () => {
  it('indique le choix courant et transmet le nouveau', () => {
    const onChange = vi.fn();
    render(<SegmentedButton label="Durée" value="3" onChange={onChange} options={[{ value: '3', label: '3 mois' }, { value: '6', label: '6 mois' }]} />);
    expect(screen.getByRole('button', { name: '3 mois' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '6 mois' }));
    expect(onChange).toHaveBeenCalledWith('6');
  });
});

describe('TextField', () => {
  it('relie le libellé et annonce l\'erreur', () => {
    render(<TextField label="Montant" error="Montant trop élevé" />);
    const input = screen.getByLabelText('Montant');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByRole('alert').textContent).toBe('Montant trop élevé');
  });
});
