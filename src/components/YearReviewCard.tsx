// ================================================
// FILE: src/components/YearReviewCard.tsx
// Bilan d'une année : épargne mise de côté, taux d'épargne, intérêts (dont part
// parentale), meilleur et pire mois, évolution de l'épargne nette, dons, abonnements,
// restitution. Proposé chaque année (notification début janvier) et consultable à tout
// moment dans Historique.
// ================================================
import React, { useMemo, useState } from 'react';
import { GlobalAppData } from '../types';
import { computeYearReview } from '../lib/agenda';
import { formatEUR, formatSignedEUR } from '../lib/format';
import { parseISODate } from '../lib/dates';
import { Sparkles } from 'lucide-react';

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

export const YearReviewCard: React.FC<{ data: GlobalAppData }> = ({ data }) => {
  const now = new Date();
  // Années qui ont des mouvements ; par défaut l'année écoulée jusqu'en mars, sinon l'année en cours.
  const years = useMemo(() => {
    const set = new Set<number>([now.getFullYear()]);
    (data.accounts || []).forEach(a => (a.movements || []).forEach(m => set.add(Number(m.date.slice(0, 4)))));
    return [...set].filter(y => y > 2000 && y <= now.getFullYear()).sort((a, b) => b - a);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.accounts]);
  const [year, setYear] = useState(() => (now.getMonth() <= 2 && years.includes(now.getFullYear() - 1) ? now.getFullYear() - 1 : now.getFullYear()));
  const r = useMemo(() => computeYearReview(data, year), [data, year]);

  const Stat = ({ label, value, sub }: { label: string; value: string; sub?: string }) => (
    <div className="bg-slate-50 dark:bg-slate-900 p-3 rounded-xl">
      <p className="text-[11px] font-black text-slate-500 dark:text-slate-400 uppercase">{label}</p>
      <p className="text-lg font-black text-slate-800 dark:text-slate-100">{value}</p>
      {sub && <p className="text-[11px] text-slate-500 dark:text-slate-400">{sub}</p>}
    </div>
  );

  return (
    <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-lg font-black text-slate-800 dark:text-slate-100 flex items-center gap-2"><Sparkles className="w-5 h-5 text-indigo-600" /> Bilan {year}{!r.complete && <span className="text-xs font-bold text-slate-500 dark:text-slate-400">(en cours)</span>}</h3>
        <select value={year} onChange={e => setYear(Number(e.target.value))} aria-label="Année" className="p-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg font-bold text-slate-700 dark:text-slate-200 text-sm">
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Mis de côté" value={formatSignedEUR(r.saved, 0)} sub={r.savingsRate !== null ? `≈ ${Math.round(r.savingsRate)} % de la paie` : undefined} />
        <Stat label={r.complete ? 'Intérêts gagnés' : 'Intérêts attendus'} value={formatEUR(r.interest, 0)} sub={r.parentalInterest >= 1 ? `dont ${formatEUR(r.parentalInterest, 0)} offerts par vos parents` : undefined} />
        <Stat label="Épargne nette" value={formatEUR(r.netEnd, 0)} sub={`${formatSignedEUR(r.netEnd - r.netStart, 0)} depuis ${r.netStartDate ? parseISODate(r.netStartDate).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) : 'le 1er janvier'}`} />
        <Stat label="Meilleur mois" value={r.best ? MONTHS[r.best.month] : '—'} sub={r.best ? formatSignedEUR(r.best.saved, 0) : undefined} />
      </div>

      {r.unexplainedGap !== undefined && (
        <p className="text-xs font-bold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 p-3 rounded-lg">
          Vos mouvements de l'année ne correspondent pas à l'évolution de votre épargne : écart de {formatSignedEUR(-r.unexplainedGap, 0)}.
          Des soldes ont sans doute été modifiés sans mouvement (ancienne version de l'app, part des parents corrigée…). « Mis de côté » et le meilleur mois peuvent donc être faussés ; l'épargne nette, elle, vient de vos relevés mensuels.
        </p>
      )}

      <ul className="text-sm text-slate-600 dark:text-slate-300 space-y-1">
        {r.worst && r.worst.saved < 0 && <li>Mois le plus difficile : <b>{MONTHS[r.worst.month]}</b> ({formatSignedEUR(r.worst.saved, 0)}).</li>}
        {r.donations > 0 && <li>Dons aux associations : <b>{formatEUR(r.donations)}</b>.</li>}
        {r.subscriptionsYearly > 0 && <li>Abonnements actifs : <b>{formatEUR(r.subscriptionsYearly, 0)}</b> par an.</li>}
        {r.restitution && <li>Restitution du capital de vos parents le {parseISODate(r.restitution.date).toLocaleDateString('fr-FR')} : <b>{formatEUR(r.restitution.amount)}</b>.</li>}
      </ul>
      <p className="text-[11px] text-slate-500 dark:text-slate-400">« Mis de côté » = versements moins retraits sur vos comptes d'épargne, hors variations de valeur. Taux d'épargne rapporté à votre paie actuelle.</p>
    </div>
  );
};
