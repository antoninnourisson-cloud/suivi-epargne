// @vitest-environment jsdom
// Bouton flottant « Mouvement » : replié par le défilement, il n'est plus atteignable
// (ni au clavier ni au lecteur d'écran) ; de retour en haut, il l'est de nouveau.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { QuickAddFab } from './QuickAddFab';

afterEach(cleanup);

const scrollTo = (el: HTMLElement, y: number) => act(() => {
  (el as unknown as { scrollTop: number }).scrollTop = y;
  el.dispatchEvent(new Event('scroll'));
});

describe('QuickAddFab', () => {
  it('replié : inert, masqué aux lecteurs d’écran, hors tabulation ; déplié : de nouveau actif', () => {
    const el = document.createElement('div');
    Object.defineProperty(el, 'scrollTop', { value: 0, writable: true, configurable: true });
    render(<QuickAddFab scrollRef={{ current: el }} resetKey="dashboard" onClick={vi.fn()} />);
    const fab = () => document.querySelector('button.fixed') as HTMLButtonElement;
    expect(fab().hasAttribute('inert')).toBe(false);
    expect(fab().getAttribute('aria-hidden')).toBeNull();

    scrollTo(el, 300);
    expect(fab().hasAttribute('inert')).toBe(true);
    expect(fab().getAttribute('aria-hidden')).toBe('true');
    expect(fab().tabIndex).toBe(-1);

    scrollTo(el, 100);
    expect(fab().hasAttribute('inert')).toBe(false);
    expect(fab().getAttribute('aria-hidden')).toBeNull();
  });
});
