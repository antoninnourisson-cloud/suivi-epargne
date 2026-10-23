// @vitest-environment jsdom
// Aide à la déclaration : la case 1AJ estimée est celle de l'année choisie (règles de cette
// année-là, voir salaryTaxEstimate), jamais l'estimation d'une autre année.
import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TaxReturnHelper } from './TaxReturnHelper';

afterEach(cleanup);

describe('Aide à la déclaration', () => {
  it('salaires estimés : ceux de l’année choisie, rien pour une année plus ancienne', () => {
    const thisYear = new Date().getFullYear();
    const taxEstimates = { [thisYear - 1]: { beforeAllowance: 25_000 }, [thisYear]: { beforeAllowance: 26_000 } };
    render(<TaxReturnHelper data={{ payslips: [], donations: [], accounts: [] }} taxEstimates={taxEstimates} />);
    // Par défaut : les revenus de l'an passé, déclarés au printemps.
    expect(screen.getByTestId('tax-line-salary').textContent).toMatch(/25\s000/);
    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: String(thisYear) } });
    expect(screen.getByTestId('tax-line-salary').textContent).toMatch(/26\s000/);
    fireEvent.change(select, { target: { value: String(thisYear - 2) } });
    expect(screen.queryByTestId('tax-line-salary')).toBeNull();
  });
});
