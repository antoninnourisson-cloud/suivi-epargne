// Couleurs des graphiques, alignées sur les rôles Material 3 de src/theme/m3.css.
// Les valeurs sont les hexadécimaux générés (et non `var(--md-…)`) : recharts les pose en
// attributs SVG `fill`/`stroke`, où les variables CSS ne sont pas fiables partout.
// Les teintes des séries sont validées (séparation daltonisme, contraste ≥ 3:1 sur la
// surface) par le validateur de palette dataviz, en clair sur #ffffff et en sombre sur
// #191c19 (surface-container-low, fond des cartes en sombre).
import { useEffect, useState } from 'react';

/** Suit la classe `dark` posée sur <html> par le sélecteur de thème. */
export const useIsDark = (): boolean => {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  useEffect(() => {
    const obs = new MutationObserver(() => setDark(document.documentElement.classList.contains('dark')));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);
  return dark;
};

/** `prefers-reduced-motion: reduce` : les animations recharts sont alors coupées. */
export const usePrefersReducedMotion = (): boolean => {
  const query = '(prefers-reduced-motion: reduce)';
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(query);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);
  return reduced;
};

/** Palette de comptes (clair) : sapin, or, bleu, terracotta, violet, rose, bleu canard, olive, indigo, framboise. */
export const ACCOUNT_PALETTE = ['#21804a', '#c08b00', '#2f6fb5', '#c0532e', '#6b55b8', '#c2456f', '#008aa8', '#7a8a1e', '#3a4a9e', '#a3274a'];
/** Mêmes teintes, éclaircies pour la surface sombre (même ordre). */
export const ACCOUNT_PALETTE_DARK = ['#2d8f62', '#bd8a00', '#4a86cc', '#d0623a', '#8b78d8', '#d05c86', '#1e98b2', '#8a9a2c', '#6a7ad0', '#c0405f'];

/** Couleur stable d'un compte : selon son rang dans la liste (deux comptes n'ont jamais la même tant qu'il y en a ≤ 10). */
export const accountColor = (ids: string[], id: string): string => ACCOUNT_PALETTE[Math.max(0, ids.indexOf(id)) % ACCOUNT_PALETTE.length];

/** Version sombre d'une couleur de la palette de comptes (inchangée si elle n'en fait pas partie). */
export const themedSeriesColor = (color: string, dark: boolean): string => {
  if (!dark) return color;
  const i = ACCOUNT_PALETTE.indexOf(color.toLowerCase());
  return i >= 0 ? ACCOUNT_PALETTE_DARK[i] : color;
};

export interface ChartTheme {
  /** Quadrillage (outline-variant, très discret). */
  grid: string;
  /** Libellés d'axes (on-surface-variant). */
  tick: string;
  /** Texte principal (on-surface), pour les valeurs écrites sur le graphique. */
  text: string;
  /** Surface de la carte qui porte le graphique : anneau des points, écart entre barres. */
  surface: string;
  /** Curseur de survol (outline). */
  cursor: string;
  /** Série principale : vert sapin. */
  brand: string;
  /** Part des parents : or (tertiaire). */
  gold: string;
  /** Troisième teinte, pour une série qui n'est pas de l'épargne (charges). */
  terracotta: string;
}

const LIGHT: ChartTheme = {
  grid: '#e1e3dd', tick: '#404941', text: '#191c19', surface: '#ffffff', cursor: '#717970',
  brand: ACCOUNT_PALETTE[0], gold: ACCOUNT_PALETTE[1], terracotta: ACCOUNT_PALETTE[3],
};
const DARK: ChartTheme = {
  grid: '#323632', tick: '#c0c9be', text: '#e1e3dd', surface: '#191c19', cursor: '#8a9389',
  brand: ACCOUNT_PALETTE_DARK[0], gold: ACCOUNT_PALETTE_DARK[1], terracotta: ACCOUNT_PALETTE_DARK[3],
};

export const chartTheme = (dark: boolean): ChartTheme => (dark ? DARK : LIGHT);

/** Style commun des graduations : 12 px, on-surface-variant, chiffres tabulaires. */
export const axisTick = (t: ChartTheme) => ({ fontSize: 12, fill: t.tick, fontVariantNumeric: 'tabular-nums' as const });
