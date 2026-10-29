// @vitest-environment jsdom
// Champ numérique : une saisie ambiguë (« 12.500 ») n’est jamais devinée.
import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NumberInput } from './NumberInput';
afterEach(cleanup);

describe('NumberInput : saisie ambiguë', () => {
  it('« 12.500 » : rien n’est retenu, les deux lectures sont proposées', () => {
    const onChange = vi.fn();
    render(<NumberInput value={100} onChange={onChange} id="m" />);
    const input = screen.getByRole('textbox');
    fireEvent.focus(input);
    for (const v of ['1', '12', '12.', '12.5', '12.50', '12.500']) fireEvent.change(input, { target: { value: v } });
    // « 12.50 » avait transmis 12,5 ; « 12.500 » rend la valeur d'avant la saisie.
    expect(onChange).toHaveBeenLastCalledWith(100);
    expect(screen.getByRole('alert').textContent).toBe('« 12.500 » est ambigu : écrivez 12 500 ou 12,5.');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    fireEvent.blur(input);
    expect(onChange).toHaveBeenLastCalledWith(100);
    expect(screen.getByRole('alert').textContent).toMatch(/ambigu/);
  });

  it('« 12 500 » est lu 12 500, sans message', () => {
    const onChange = vi.fn();
    render(<NumberInput value={0} onChange={onChange} />);
    const input = screen.getByRole('textbox');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '12 500' } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenLastCalledWith(12500);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('autre saisie illisible : message habituel', () => {
    render(<NumberInput value={5} onChange={() => {}} />);
    const input = screen.getByRole('textbox');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '12abc' } });
    fireEvent.blur(input);
    expect(screen.getByRole('alert').textContent).toBe('Montant non reconnu : la valeur précédente est conservée.');
  });
});
