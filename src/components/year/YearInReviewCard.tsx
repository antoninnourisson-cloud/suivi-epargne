// Entrée « Votre année <Y> » de l'Historique : le chiffre d'ouverture du récapitulatif
// annuel et un bouton qui ouvre la feuille des pages. Lien direct possible depuis la
// notification de début janvier (`?view=history&year=2026`).
import React, { useEffect, useMemo, useState } from 'react';
import { Sparkles } from 'lucide-react';
import type { GlobalAppData } from '../../types';
import { buildYearInReview, defaultReviewYear, yearsWithData } from '../../lib/yearReview';
import { Button } from '../ui';
import { YearInReviewSheet } from './YearInReviewSheet';

/** Année demandée par un lien direct (`?year=2026`), à ouvrir une seule fois. */
const readLinkedYear = (): number | null => {
  try {
    const raw = new URLSearchParams(window.location.search).get('year');
    const y = raw && /^\d{4}$/.test(raw) ? Number(raw) : null;
    return y;
  } catch { return null; }
};

export const YearInReviewCard: React.FC<{ data: GlobalAppData }> = ({ data }) => {
  const today = useMemo(() => new Date(), []);
  const years = useMemo(() => yearsWithData(data, today), [data, today]);
  const [linked] = useState(readLinkedYear);
  const [year, setYear] = useState(() => (linked !== null && linked <= today.getFullYear() ? linked : defaultReviewYear(years, today)));
  const [open, setOpen] = useState(() => linked !== null && linked <= today.getFullYear());
  const story = useMemo(() => buildYearInReview(data, year, today), [data, year, today]);
  const options = years.includes(year) ? years : [...years, year].sort((a, b) => b - a);

  // Notification cliquée alors qu'Historique est déjà affiché (voir App).
  useEffect(() => {
    const onOpen = (e: Event) => {
      const y = (e as CustomEvent<number>).detail;
      if (!Number.isInteger(y) || y > today.getFullYear()) return;
      setYear(y);
      setOpen(true);
      const params = new URLSearchParams(window.location.search);
      params.delete('year');
      const rest = params.toString();
      window.history.replaceState(window.history.state, '', window.location.pathname + (rest ? `?${rest}` : ''));
    };
    window.addEventListener('pecule:open-year', onOpen);
    return () => window.removeEventListener('pecule:open-year', onOpen);
  }, [today]);

  // Lien consommé : retiré de l'adresse pour qu'un rechargement ne rouvre pas la feuille.
  useEffect(() => {
    if (linked === null) return;
    const params = new URLSearchParams(window.location.search);
    params.delete('year');
    const rest = params.toString();
    window.history.replaceState(window.history.state, '', window.location.pathname + (rest ? `?${rest}` : ''));
  }, [linked]);

  const title = `Votre année ${year}`;
  return (
    <section aria-labelledby="year-in-review-title" className="rounded-3xl p-5 sm:p-6 bg-primary-container text-on-primary-container">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h3 id="year-in-review-title" className="text-[22px] leading-7 font-normal flex items-center gap-2">
          <Sparkles className="w-5 h-5" aria-hidden="true" /> {title}
          {!story.complete && <span className="whitespace-nowrap text-xs font-medium px-2 py-0.5 rounded-lg bg-surface-container-lowest/60 text-on-surface">année en cours</span>}
        </h3>
        {options.length > 1 && (
          <select
            value={year}
            onChange={e => setYear(Number(e.target.value))}
            aria-label="Année du récapitulatif"
            className="h-10 px-3 rounded-lg bg-surface-container-lowest text-on-surface border border-outline-variant text-sm font-medium"
          >
            {options.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        )}
      </div>
      <p className="mt-4 text-sm font-medium">{story.headline.label}</p>
      <p className="text-[44px] leading-[52px] font-normal tracking-tight tabular-nums">{story.headline.value}</p>
      <p className="mt-1 text-sm">{story.empty ? 'Votre année se racontera au fil des mois.' : story.headline.text}</p>
      <div className="mt-4">
        <Button variant="filled" onClick={() => setOpen(true)} aria-haspopup="dialog">Voir votre année {year}</Button>
      </div>
      <YearInReviewSheet open={open} onClose={() => setOpen(false)} story={story} />
    </section>
  );
};
