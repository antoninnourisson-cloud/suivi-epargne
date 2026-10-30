// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { OverflowMenu } from './OverflowMenu';

const rect = (top: number) => ({ top, left: 300, right: 340, bottom: top + 40, width: 40, height: 40, x: 300, y: top, toJSON: () => ({}) }) as DOMRect;

const setup = () => {
  const onRename = vi.fn();
  render(<OverflowMenu label="Actions pour « Versement »" actions={[{ label: 'Renommer', onClick: onRename }, { label: 'Supprimer', onClick: () => {}, tone: 'danger' }]} />);
  const button = screen.getByRole('button', { name: 'Actions pour « Versement »' });
  let top = 100;
  vi.spyOn(button, 'getBoundingClientRect').mockImplementation(() => rect(top));
  return { button, onRename, moveTo: (t: number) => { top = t; } };
};

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('OverflowMenu', () => {
  it('s’ouvre sur la première action, et Échap rend le focus au bouton', () => {
    const { button } = setup();
    fireEvent.click(button);
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Renommer' }));
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it('reste ouvert sur un défilement qui ne déplace pas le bouton (inertie juste après le toucher)', () => {
    const { button } = setup();
    fireEvent.click(button);
    fireEvent.scroll(window);
    expect(screen.getByRole('menu')).toBeTruthy();
  });

  it('se ferme quand un défilement déplace le bouton', () => {
    const { button, moveTo } = setup();
    fireEvent.click(button);
    moveTo(60);
    fireEvent.scroll(window);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('lance l’action choisie et referme le menu', () => {
    const { button, onRename } = setup();
    fireEvent.click(button);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Renommer' }));
    expect(onRename).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
