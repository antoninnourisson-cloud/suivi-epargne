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

  it('sur téléphone, c’est la page qui défile : le bouton se réduit à son icône au-delà de 80 px', () => {
    const el = document.createElement('div');
    Object.defineProperty(el, 'scrollTop', { value: 0, writable: true, configurable: true });
    // jsdom ne fait pas défiler la page : élément de défilement et position simulés.
    const page = document.createElement('div');
    Object.defineProperty(page, 'scrollTop', { value: 0, writable: true, configurable: true });
    Object.defineProperty(document, 'scrollingElement', { value: page, configurable: true });
    render(<QuickAddFab scrollRef={{ current: el }} resetKey="dashboard" onClick={vi.fn()} />);
    const label = () => document.querySelector('button.fixed span') as HTMLSpanElement;
    expect(label().className).not.toContain('sr-only');
    act(() => {
      page.scrollTop = 200;
      window.dispatchEvent(new Event('scroll'));
    });
    expect(label().className).toContain('sr-only');
    act(() => {
      page.scrollTop = 0;
      window.dispatchEvent(new Event('scroll'));
    });
    expect(label().className).not.toContain('sr-only');
  });
});
