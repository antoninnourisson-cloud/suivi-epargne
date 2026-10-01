// ================================================
// FILE: src/components/Journal.tsx
// Journal des modifications : tous les mouvements (votre part, part des parents,
// valorisations, soldes initiaux), changements de taux et restitution, du plus récent au
// plus ancien. Un mouvement se supprime (avec annulation), le dernier changement de taux
// d'un compte s'annule.
// ================================================
import React, { useMemo, useState } from 'react';
import { SavingsAccount, ParentalRestitution } from '../types';
import { formatEUR, formatRate } from '../lib/format';
import { parseISODate } from '../lib/dates';
import { History, Trash2, Undo2 } from 'lucide-react';

type Filter = 'all' | 'own' | 'parental' | 'valuation' | 'rates';

interface Entry {
  key: string;
  date: string;
  account?: SavingsAccount;
  kind: 'own' | 'parental' | 'valuation' | 'initial' | 'rate' | 'restitution';
  title: string;
  amount?: number; // signé
  movementId?: string;
  rateEntryDate?: string;
  canRevertRate?: boolean;
}

interface Props {
  accounts: SavingsAccount[];
  restitution?: ParentalRestitution;
  onDeleteMovement: (accountId: string, movementId: string) => void;
  onRevertRate: (accountId: string, entryDate: string) => void;
}

const BADGE: Record<Entry['kind'], { label: string; cls: string }> = {
  own: { label: 'Votre part', cls: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300' },
  parental: { label: 'Parents', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300' },
  valuation: { label: 'Valorisation', cls: 'bg-teal-100 text-teal-700 dark:bg-teal-950/60 dark:text-teal-300' },
  initial: { label: 'Solde initial', cls: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300' },
  rate: { label: 'Taux', cls: 'bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300' },
  restitution: { label: 'Restitution', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300' },
};

const PAGE = 150;

export const Journal: React.FC<Props> = ({ accounts, restitution, onDeleteMovement, onRevertRate }) => {
  const [filter, setFilter] = useState<Filter>('all');
  const [accountId, setAccountId] = useState<string>('');
  const [limit, setLimit] = useState(PAGE);

  const entries = useMemo(() => {
    const out: Entry[] = [];
    for (const a of accounts) {
      for (const m of a.movements || []) {
        const kind: Entry['kind'] = m.kind === 'parental' ? 'parental' : m.kind === 'valuation' ? 'valuation' : m.label === 'Solde initial' ? 'initial' : 'own';
        // Les mouvements de restitution s'annulent depuis Part parentale (sinon le relevé
        // de restitution resterait affiché alors que le capital serait rétabli).
        const isRestitution = m.kind === 'parental' && m.label === 'Restitution aux parents';
        out.push({ key: `m-${a.id}-${m.id}`, date: m.date, account: a, kind, title: m.label, amount: m.type === 'IN' ? m.amount : -m.amount, movementId: isRestitution ? undefined : m.id });
      }
      // Historique des taux : une entrée { date, rate } = « rate » courait jusqu'à « date ».
      const hist = [...(a.rateHistory || [])].sort((x, y) => x.date.localeCompare(y.date));
      hist.forEach((h, i) => {
        const next = i + 1 < hist.length ? hist[i + 1].rate : a.interestRate ?? 0;
        out.push({
          key: `r-${a.id}-${h.date}`, date: h.date, account: a, kind: 'rate',
          title: `Taux : ${formatRate(h.rate)} → ${formatRate(next)}`,
          rateEntryDate: h.date, canRevertRate: i === hist.length - 1,
        });
      });
    }
    if (restitution?.done) {
      const total = restitution.done.accounts.reduce((s, x) => s + x.amount, 0);
      out.push({ key: 'restitution', date: restitution.done.date, kind: 'restitution', title: `Restitution du capital de vos parents${restitution.done.emailed ? ' (récapitulatif envoyé)' : ''}`, amount: -total });
    }
    return out.sort((x, y) => y.date.localeCompare(x.date) || x.key.localeCompare(y.key));
  }, [accounts, restitution]);

  const shown = entries.filter(e =>
    (!accountId || e.account?.id === accountId) &&
    (filter === 'all'
      || (filter === 'own' && (e.kind === 'own' || e.kind === 'initial'))
      || (filter === 'parental' && (e.kind === 'parental' || e.kind === 'restitution'))
      || (filter === 'valuation' && e.kind === 'valuation')
      || (filter === 'rates' && e.kind === 'rate')));

  const seg = (f: Filter, label: string) => (
    <button type="button" onClick={() => { setFilter(f); setLimit(PAGE); }} aria-pressed={filter === f}
      className={`px-3 py-2 text-xs font-bold ${filter === f ? 'bg-indigo-600 text-white' : 'bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400'}`}>{label}</button>
  );

  return (
    <div className="space-y-6 animate-fade-in pb-20">
      <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm">
        <h2 className="text-2xl font-black text-slate-800 dark:text-slate-100 flex items-center gap-2 mb-1"><History className="w-6 h-6 text-indigo-600" /> Journal des modifications</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">Tout ce qui a changé sur vos comptes : versements et retraits, part des parents, variations de valeur, taux. Chaque mouvement peut être supprimé (avec annulation possible).</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700" role="group" aria-label="Type">
          {seg('all', 'Tout')}{seg('own', 'Votre part')}{seg('parental', 'Parents')}{seg('valuation', 'Valorisation')}{seg('rates', 'Taux')}
        </div>
        <select value={accountId} onChange={e => { setAccountId(e.target.value); setLimit(PAGE); }} aria-label="Compte"
          className="p-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm font-bold text-slate-700 dark:text-slate-200">
          <option value="">Tous les comptes</option>
          {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <span className="text-xs text-slate-500 dark:text-slate-400">{shown.length} entrée{shown.length > 1 ? 's' : ''}</span>
      </div>

      <ul className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm divide-y divide-slate-100 dark:divide-slate-700">
        {shown.length === 0 && <li className="p-6 text-sm text-slate-500 dark:text-slate-400 italic">Rien à afficher.</li>}
        {shown.slice(0, limit).map(e => (
          <li key={e.key} className="flex items-center gap-3 px-4 py-3">
            <span className="w-20 flex-shrink-0 text-xs font-bold text-slate-500 dark:text-slate-400">{parseISODate(e.date).toLocaleDateString('fr-FR')}</span>
            <span className="flex-1 min-w-0">
              <span className="block text-sm font-bold text-slate-800 dark:text-slate-100 truncate">{e.title}</span>
              <span className="flex flex-wrap items-center gap-1.5 mt-0.5">
                <span className={`text-[11px] font-black px-1.5 py-0.5 rounded ${BADGE[e.kind].cls}`}>{BADGE[e.kind].label}</span>
                {e.account && <span className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{e.account.name}</span>}
              </span>
            </span>
            {e.amount !== undefined && (
              <span className={`font-mono font-bold text-sm flex-shrink-0 ${e.amount >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{e.amount >= 0 ? '+' : '−'}{formatEUR(Math.abs(e.amount))}</span>
            )}
            {e.movementId && e.account && (
              <button type="button" onClick={() => onDeleteMovement(e.account!.id, e.movementId!)} aria-label={`Supprimer « ${e.title} »`} className="p-2 text-slate-400 hover:text-rose-500 flex-shrink-0"><Trash2 className="w-4 h-4" /></button>
            )}
            {e.kind === 'rate' && e.canRevertRate && e.account && (
              <button type="button" onClick={() => onRevertRate(e.account!.id, e.rateEntryDate!)} title="Revenir au taux précédent" aria-label="Annuler ce changement de taux" className="p-2 text-slate-400 hover:text-indigo-600 flex-shrink-0"><Undo2 className="w-4 h-4" /></button>
            )}
          </li>
        ))}
      </ul>
      {shown.length > limit && (
        <button type="button" onClick={() => setLimit(l => l + PAGE)} className="w-full py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-bold text-slate-600 dark:text-slate-300">Afficher plus ({shown.length - limit} restantes)</button>
      )}
    </div>
  );
};
