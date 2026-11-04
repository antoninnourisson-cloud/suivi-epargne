// « Clôture de l'année » (Historique) : où en est la clôture de l'année écoulée (étapes faites,
// année clôturée), et le bouton qui ouvre la feuille de clôture (year/YearClosingSheet), où
// l'on saisit et coche tout. Aucun calcul ici : lib/yearClosing.
import React, { useMemo } from 'react';
import { CalendarCheck } from 'lucide-react';
import type { GlobalAppData } from '../../types';
import { buildYearClosing, closingApplies, closingYearOf } from '../../lib/yearClosing';
import { Button } from '../ui';

export interface YearClosingCardProps {
  /** Données complètes (comptes, dons, restitution, réglages). */
  data: GlobalAppData;
  /** Ouvre la feuille de clôture. */
  onOpen: () => void;
  /** Date du jour (tests). */
  now?: Date;
}

export const YearClosingCard: React.FC<YearClosingCardProps> = ({ data, onOpen, now: nowProp }) => {
  const now = useMemo(() => nowProp ?? new Date(), [nowProp]);
  const year = closingYearOf(now);
  const closing = useMemo(() => buildYearClosing(data, year, now), [data, year, now]);

  // Rien à clôturer (aucun compte suivi l'an dernier : tout premier usage) : pas de carte.
  if (!closingApplies(data, year)) return null;

  const summary = closing.closedOn
    ? 'Année clôturée : plus de rappel de clôture.'
    : `${closing.done} étape${closing.done > 1 ? 's' : ''} sur ${closing.total} faite${closing.done > 1 ? 's' : ''}`;

  return (
    <section id="year-closing" aria-labelledby="year-closing-title" className="rounded-2xl p-5 sm:p-6 bg-surface-container-lowest dark:bg-surface-container-low border border-outline-variant text-on-surface">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id="year-closing-title" className="text-base font-medium flex items-center gap-2">
            <CalendarCheck className="w-5 h-5 shrink-0 text-primary" aria-hidden="true" /> Clôture de l'année {year}
          </h3>
          <p className="mt-1 text-sm text-on-surface-variant" aria-live="polite">{summary}</p>
        </div>
        <Button variant={closing.closedOn ? 'text' : 'tonal'} className="max-sm:h-12" onClick={onOpen}>
          {closing.closedOn ? 'Voir la clôture' : 'Ouvrir la clôture'}
        </Button>
      </div>
      {!closing.closedOn && closing.total > 0 && (
        <div className="mt-3 h-1.5 rounded-full bg-surface-container-highest overflow-hidden" aria-hidden="true">
          <div className="h-full bg-primary rounded-full" style={{ width: `${Math.round((closing.done / closing.total) * 100)}%` }} />
        </div>
      )}
    </section>
  );
};
