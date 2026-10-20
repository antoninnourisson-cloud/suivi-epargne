// @vitest-environment jsdom
// revealElementById : amène à l'écran une carte qui n'existe pas encore (écran chargé à la
// demande), puis place le focus sur son titre.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { revealElementById } from './revealElement';

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

const mount = () => {
  const section = document.createElement('section');
  section.id = 'tax-return';
  const heading = document.createElement('h3');
  heading.textContent = 'Déclaration de revenus';
  section.appendChild(heading);
  const scroll = vi.fn();
  section.scrollIntoView = scroll;
  document.body.appendChild(section);
  return { heading, scroll };
};

describe('revealElementById', () => {
  it('attend que la carte existe, la fait défiler et met le focus sur son titre', () => {
    vi.useFakeTimers();
    revealElementById('tax-return');
    vi.advanceTimersByTime(500);
    // La carte arrive après le changement d'écran.
    const { heading, scroll } = mount();
    vi.advanceTimersByTime(100);
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(heading);
    expect(heading.tabIndex).toBe(-1);
  });

  it('abandonne sans erreur si la carte n’apparaît pas', () => {
    vi.useFakeTimers();
    revealElementById('tax-return', { delayMs: 0, timeoutMs: 300 });
    vi.advanceTimersByTime(1000);
    const { scroll } = mount();
    vi.advanceTimersByTime(1000);
    expect(scroll).not.toHaveBeenCalled();
  });
});
