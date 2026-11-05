// Barre « disponible / avec impôt / bloqué ».
// (Extrait de home.ts, code déplacé tel quel ; home.ts le ré-exporte.)
import { type AvailabilityBreakdown } from './finance';
import { parseISODate } from './dates';
import { elideDe, formatEUR } from './format';

// ---------------------------------------------------------------------------
// Disponibilité (barre « disponible / avec impôt / bloqué »)
// ---------------------------------------------------------------------------

export interface AvailabilitySlice { key: 'available' | 'tax' | 'locked'; label: string; hint: string; amount: number }

const dayFr = (iso: string) => parseISODate(iso).toLocaleDateString('fr-FR');

export const availabilitySlices = (stats: AvailabilityBreakdown): AvailabilitySlice[] => {
  const out: AvailabilitySlice[] = [{ key: 'available', label: 'Disponible tout de suite', hint: 'Livrets et comptes courants', amount: stats.available }];
  if (stats.taxLocked > 0) out.push({ key: 'tax', label: 'Disponible avec impôt', hint: 'Assurance vie et PEA récents', amount: stats.taxLocked });
  if (stats.hardLocked > 0) {
    // PEE : chaque versement se libère 5 ans après sa date ; on annonce le prochain. Une part
    // sans date de versement connue est comptée bloquée par prudence, et on le dit.
    const next = stats.peeNextRelease;
    const hint = (next
      ? `Retraite, épargne salariale, PEL, placements à terme · ${formatEUR(next.amount, 0)} ${elideDe(next.name)} libres le ${dayFr(next.date)}`
      : 'Retraite, épargne salariale, PEL, placements à terme')
      + (stats.peeUndated ? ' · épargne salariale sans date de versement connue comptée bloquée par prudence' : '');
    out.push({ key: 'locked', label: 'Bloqué', hint, amount: stats.hardLocked });
  }
  return out;
};

