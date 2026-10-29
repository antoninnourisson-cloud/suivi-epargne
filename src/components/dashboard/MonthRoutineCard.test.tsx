// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MonthRoutineCard } from './MonthRoutineCard';
import type { MonthRoutine } from '../../lib/monthRoutine';

afterEach(cleanup);

const routine = (done: boolean[]): MonthRoutine => {
  const steps = [
    { key: 'payslip' as const, label: 'Fiche de paie d\'octobre 2026', detail: done[0] ? 'Importée' : 'À importer', done: done[0], action: 'Importer' },
    { key: 'balances' as const, label: 'Soldes actualisés', detail: done[1] ? 'À jour' : '1 compte à actualiser', done: done[1], action: 'Actualiser' },
  ];
  const doneCount = done.filter(Boolean).length;
  return { periodKey: '2026-10', monthName: 'octobre', steps, doneCount, complete: doneCount === steps.length };
};

describe('MonthRoutineCard', () => {
  it('compte les étapes faites et mène aux étapes restantes', () => {
    const onOpen = vi.fn();
    render(<MonthRoutineCard routine={routine([true, false])} onOpen={onOpen} />);
    expect(screen.getByRole('heading', { name: 'Routine d\'octobre : 1/2' })).toBeTruthy();
    // Étape faite : pas de bouton ; étape restante : un bouton nommé avec son étape.
    expect(screen.queryByRole('button', { name: /Importer/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Actualiser : Soldes actualisés' }));
    expect(onOpen).toHaveBeenCalledWith('balances');
    expect(screen.getByText(/: fait/)).toBeTruthy();
  });

  it('se replie en une ligne une fois tout fait', () => {
    render(<MonthRoutineCard routine={routine([true, true])} onOpen={() => {}} />);
    expect(screen.getByText('Routine d\'octobre faite')).toBeTruthy();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryByRole('listitem')).toBeNull();
  });
});
