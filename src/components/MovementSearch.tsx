// ================================================
// FILE: src/components/MovementSearch.tsx
// Recherche dans les mouvements de tous les comptes : par libellé (sans tenir compte des
// accents ni des majuscules), par montant (« 250 », « 13,50 ») ou par date (« 2026-09 »,
// « 09/2026 », « 15/09/2026 »).
// ================================================
import React, { useMemo, useState } from 'react';
import { SavingsAccount } from '../types';
import { Search, X } from 'lucide-react';
import { formatSignedEUR } from '../lib/format';
import { parseFrenchNumber } from '../lib/numbers';
import { parseISODate } from '../lib/dates';
import { Card, IconButton, ListItem, MoneyText, SegmentedButton } from './ui';

interface MovementSearchProps {
  accounts: SavingsAccount[];
}

type Direction = 'all' | 'IN' | 'OUT';
const DIRECTIONS: { value: Direction; label: string }[] = [
  { value: 'all', label: 'Tous' },
  { value: 'IN', label: 'Entrées' },
  { value: 'OUT', label: 'Sorties' },
];

const MAX_RESULTS = 100;
const DAY = new Intl.DateTimeFormat('fr-FR');
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
  const [direction, setDirection] = useState<Direction>('all');

  const results = useMemo(() => {
    const q = query.trim();
    if (!q) return [];
    const text = normalize(q);
    const isoFragment = toIsoFragment(q);
    const amount = isoFragment ? null : parseFrenchNumber(q);
    return accounts
      .flatMap(a => a.movements.map(m => ({ account: a, m })))
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

  return (
    <Card padding="sm" className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        {/* Barre de recherche Material 3 : pilule teintée, loupe à gauche, effacement à droite. */}
        <label className="flex-1 min-w-0 basis-56 h-14 flex items-center gap-2 pl-4 pr-1 rounded-full bg-surface-container-high focus-within:outline-2 focus-within:outline-primary">
          <Search className="w-5 h-5 text-on-surface-variant shrink-0" aria-hidden="true" />
          <span className="sr-only">Rechercher un mouvement</span>
          <input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Libellé, montant, 09/2026…"
            // Contour de focus porté par la pilule (focus-within), pas un second cadre sur le champ :
            // le « ! » l'emporte sur la règle globale `html :focus-visible` (index.css), hors couche.
            className="flex-1 min-w-0 h-full bg-transparent outline-hidden focus-visible:outline-none! text-base text-on-surface placeholder:text-on-surface-variant [&::-webkit-search-cancel-button]:hidden"
          />
          {query && <IconButton icon={X} label="Effacer la recherche" onClick={() => setQuery('')} />}
        </label>
        <SegmentedButton
          label="Sens du mouvement" options={DIRECTIONS} value={direction} onChange={setDirection}
          className="w-full sm:w-auto [&>button]:whitespace-nowrap max-sm:[&>button]:flex-1 max-sm:[&>button]:h-12 max-sm:[&>button]:px-1 max-sm:[&>button]:gap-1"
        />
      </div>

      {query.trim() && (
        results.length === 0 ? (
          <p role="status" className="text-sm text-on-surface-variant">Aucun mouvement ne correspond.</p>
        ) : (
          <>
            <p role="status" className="text-sm text-on-surface-variant">
              {results.length} mouvement{results.length > 1 ? 's' : ''} · solde net <b className="font-medium text-on-surface whitespace-nowrap">{formatSignedEUR(net)}</b>
              {results.length > MAX_RESULTS && ` · ${MAX_RESULTS} premiers affichés`}
            </p>
            <ul className="divide-y divide-outline-variant max-h-96 overflow-y-auto" aria-label="Mouvements trouvés">
              {results.slice(0, MAX_RESULTS).map(({ account, m }) => (
                <ListItem
                  key={`${account.id}-${m.id}`}
                  headline={<>{m.label}{m.kind === 'valuation' && <span className="ml-1 text-xs font-normal text-on-surface-variant">(valorisation)</span>}</>}
                  supporting={<><time dateTime={m.date}>{DAY.format(parseISODate(m.date))}</time> · {account.name}</>}
                  trailing={<MoneyText value={m.type === 'IN' ? m.amount : -m.amount} signed tone="auto" />}
                />
              ))}
            </ul>
          </>
        )
      )}
    </Card>
  );
};
