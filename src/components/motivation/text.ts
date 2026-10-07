// Phrases partagées par l'Accueil et les Fiches de paie (motivation, contrôle des fiches).
import type { PayslipAnomaly } from '../../lib/motivation';
import { formatEUR } from '../../lib/format';

/** « Net payé 2 400 € : +20 % par rapport à votre médiane de 2 000 €. Prime, … ? Vérifiez la fiche. » */
export const describeAnomaly = (a: PayslipAnomaly): string => {
  const pct = Math.round(Math.abs(a.delta) * 100);
  const sign = a.delta >= 0 ? '+' : '−';
  return `${a.label} ${formatEUR(a.value, 0)} : ${sign}${pct} % par rapport à votre médiane de ${formatEUR(a.median, 0)}. Prime, heures supplémentaires, absence ? Vérifiez la fiche.`;
};

/** « 2026-08 » → « août » (avec l'année si elle diffère de `currentYear`). */
export const payMonthName = (key: string, currentYear?: number): string => {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1, 1);
  return d.toLocaleDateString('fr-FR', y === currentYear ? { month: 'long' } : { month: 'long', year: 'numeric' });
};

/** « d'août », « de septembre » : élision devant une voyelle. */
export const deMonth = (name: string): string => (/^[aeiouyéèêàâîôûh]/i.test(name) ? `d'${name}` : `de ${name}`);
