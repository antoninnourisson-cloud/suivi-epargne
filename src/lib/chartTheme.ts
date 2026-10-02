// Couleurs des graphiques selon le thème (clair / sombre) et palette de comptes distincte.
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

export interface ChartTheme { grid: string; tick: string; tooltipBg: string; tooltipText: string; tooltipLabel: string; brand: string; gold: string }
export const chartTheme = (dark: boolean): ChartTheme => dark
  ? { grid: '#3a3532', tick: '#a8a29e', tooltipBg: '#f5f5f4', tooltipText: '#1c1917', tooltipLabel: '#57534e', brand: '#5ca37d', gold: '#fbbf24' }
  : { grid: '#e7e5e4', tick: '#57534e', tooltipBg: '#1c1917', tooltipText: '#f5f5f4', tooltipLabel: '#d6d3d1', brand: '#2a6b4b', gold: '#d97706' };

/** Palette de comptes : sapin, or, bleu, terracotta, violet, rose, cyan, olive, gris… */
export const ACCOUNT_PALETTE = ['#2a6b4b', '#d97706', '#2563eb', '#c2410c', '#7c3aed', '#db2777', '#0891b2', '#65a30d', '#57534e', '#9f1239'];
/** Couleur stable d'un compte : selon son rang dans la liste (deux comptes n'ont jamais la même tant qu'il y en a ≤ 10). */
export const accountColor = (ids: string[], id: string): string => ACCOUNT_PALETTE[Math.max(0, ids.indexOf(id)) % ACCOUNT_PALETTE.length];
