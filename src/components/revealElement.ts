// Amener à l'écran une carte d'un autre écran (ex. l'aide à la déclaration, #tax-return),
// juste après un changement d'écran. Indépendant du composant appelant, qui est démonté par
// le changement d'écran : la minuterie survit. L'écran visé peut être chargé à la demande :
// on attend que l'élément existe (3 s au plus). Le délai initial laisse App remonter en haut
// de l'écran et poser le focus sur le titre (voir l'effet de changement d'écran dans App).

const prefersReducedMotion = () => {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
};

/** Fait défiler jusqu'à l'élément `id` et place le focus sur son titre (lecteurs d'écran). */
export const revealElementById = (id: string, { delayMs = 300, timeoutMs = 3000 }: { delayMs?: number; timeoutMs?: number } = {}): void => {
  const started = Date.now();
  const tick = () => {
    const el = document.getElementById(id);
    if (!el) {
      if (Date.now() - started < timeoutMs) setTimeout(tick, 100);
      return;
    }
    el.scrollIntoView({ block: 'start', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    const heading = el.querySelector<HTMLElement>('h1, h2, h3');
    if (heading) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
  };
  setTimeout(tick, delayMs);
};
