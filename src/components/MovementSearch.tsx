// ================================================
// FILE: src/components/MovementSearch.tsx
// Recherche dans les mouvements de tous les comptes : par libellé (sans tenir compte des
// accents ni des majuscules), par montant (« 250 », « 13,50 ») ou par date (« 2026-09 »,
// « 09/2026 », « 15/09/2026 »).
// ================================================
import React, { useMemo, useState } from 'react';
import { SavingsAccount } from '../types';
import { Search, X } from 'lucide-react';
import { formatEUR, formatSignedEUR } from '../lib/format';
import { parseFrenchNumber } from '../lib/numbers';
import { parseISODate } from '../lib/dates';

interface MovementSearchProps {
  accounts: SavingsAccount[];
}

const MAX_RESULTS = 100;
const normalize = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** « 15/09/2026 » → « 2026-09-15 », « 09/2026 » → « 2026-09 » ; sinon tel quel. */
const toIsoFragment = (q: string): string | null => {
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(q);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = /^(\d{1,2})\/(\d{4})$/.exec(q);
  if (m) return `${m[2]}-${m[1].padStart(2, '0')}`;
  if (/^\d{4}(-\d{2}){0,2}$/.test(q)) return q;
  return null;
};

export const MovementSearch: React.FC<MovementSearchProps> = ({ accounts }) => {
  const [query, setQuery] = useState('');
  const [direction, setDirection] = useState<'all' | 'IN' | 'OUT'>('all');

  const results = useMemo(() => {
    const q = query.trim();
    if (!q) return [];
    const text = normalize(q);
    const isoFragment = toIsoFragment(q);
    const amount = isoFragment ? null : parseFrenchNumber(q);
    return accounts
      .flatMap(a => (a.movements || []).map(m => ({ account: a, m })))
      .filter(({ m }) => direction === 'all' || m.type === direction)
      .filter(({ account, m }) => {
        if (isoFragment) return m.date.startsWith(isoFragment);
        if (amount !== null) return Math.abs(m.amount - amount) < 0.005 || String(m.amount).startsWith(q.replace(',', '.'));
        return normalize(m.label).includes(text) || normalize(account.name).includes(text);
      })
      .sort((x, y) => y.m.date.localeCompare(x.m.date));
  }, [accounts, query, direction]);

  // Solde net de VOTRE part : les mouvements de la part des parents n'y entrent pas.
  const net = results.filter(r => r.m.kind !== 'parental').reduce((sum, r) => sum + (r.m.type === 'IN' ? r.m.amount : -r.m.amount), 0);
  const seg = (active: boolean) => `px-3 py-2 text-xs font-bold ${active ? 'bg-indigo-600 text-white' : 'bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400'}`;

  return (
    <div className="bg-white dark:bg-slate-800 p-4 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex-1 min-w-[12rem] flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700">
          <Search className="w-4 h-4 text-slate-500 dark:text-slate-400 flex-shrink-0" />
          <span className="sr-only">Rechercher un mouvement</span>
          <input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Rechercher un mouvement : libellé, montant, 09/2026…"
            className="flex-1 min-w-0 bg-transparent outline-none text-sm font-bold text-slate-800 dark:text-slate-100"
          />
          {query && <button type="button" onClick={() => setQuery('')} aria-label="Effacer la recherche" className="p-1 text-slate-500 dark:text-slate-400"><X className="w-4 h-4" /></button>}
        </label>
        <div className="flex rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700" role="group" aria-label="Sens">
          <button type="button" onClick={() => setDirection('all')} aria-pressed={direction === 'all'} className={seg(direction === 'all')}>Tous</button>
          <button type="button" onClick={() => setDirection('IN')} aria-pressed={direction === 'IN'} className={seg(direction === 'IN')}>Entrées</button>
          <button type="button" onClick={() => setDirection('OUT')} aria-pressed={direction === 'OUT'} className={seg(direction === 'OUT')}>Sorties</button>
        </div>
      </div>

      {query.trim() && (
        results.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400 italic">Aucun mouvement ne correspond.</p>
        ) : (
          <>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {results.length} mouvement{results.length > 1 ? 's' : ''} · solde net <b className="text-slate-700 dark:text-slate-200">{formatSignedEUR(net)}</b>
              {results.length > MAX_RESULTS && ` · ${MAX_RESULTS} premiers affichés`}
            </p>
            <ul className="divide-y divide-slate-100 dark:divide-slate-700 max-h-96 overflow-y-auto">
              {results.slice(0, MAX_RESULTS).map(({ account, m }) => (
                <li key={`${account.id}-${m.id}`} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <div className="min-w-0">
                    <p className="font-bold text-slate-800 dark:text-slate-100 truncate">{m.label}{m.kind === 'valuation' && <span className="ml-1 text-[11px] font-bold text-slate-500 dark:text-slate-400">(valorisation)</span>}</p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">{parseISODate(m.date).toLocaleDateString('fr-FR')} · {account.name}</p>
                  </div>
                  <span className={`font-mono font-bold flex-shrink-0${m.type === 'IN' ? 'text-emerald-600' : 'text-rose-600'}`}>{m.type === 'IN' ? '+' : '−'}{formatEUR(m.amount)}</span>
                </li>
              ))}
            </ul>
          </>
        )
      )}
    </div>
  );
};
