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
import { parseISODate, formatISODay as formatISODayLocal } from '../lib/dates';
import { History, Trash2, Undo2 } from 'lucide-react';
import { isRestitutionMovement, findCancellingGroups, CancellingGroup } from '../lib/accountOps';
import { isInitialBalance } from '../lib/finance';
import { signedAmount } from '../lib/money';

type Filter = 'all' | 'own' | 'parental' | 'valuation' | 'rates';

interface Entry {
  key: string;
  date: string;
  account?: SavingsAccount;
  kind: 'own' | 'parental' | 'valuation' | 'initial' | 'rate' | 'restitution' | 'adjustment';
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
  onRemoveCancelling: (groups: CancellingGroup[]) => void;
  trackingStartDate?: string;
  onSetTrackingStart: (date: string | undefined) => void;
  onToggleAdjustment: (accountId: string, movementId: string) => void;
}

const BADGE: Record<Entry['kind'], { label: string; cls: string }> = {
  own: { label: 'Votre part', cls: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300' },
  parental: { label: 'Parents', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300' },
  valuation: { label: 'Valorisation', cls: 'bg-teal-100 text-teal-700 dark:bg-teal-950/60 dark:text-teal-300' },
  adjustment: { label: "Correction (pas de l'épargne)", cls: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300' },
  initial: { label: 'Solde initial', cls: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300' },
  rate: { label: 'Taux', cls: 'bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300' },
  restitution: { label: 'Restitution', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300' },
};

const PAGE = 150;

export const Journal: React.FC<Props> = ({ accounts, restitution, onDeleteMovement, onRevertRate, onRemoveCancelling, trackingStartDate, onSetTrackingStart, onToggleAdjustment }) => {
  const [filter, setFilter] = useState<Filter>('all');
  const [accountId, setAccountId] = useState<string>('');
  const [limit, setLimit] = useState(PAGE);
  const [showCleanup, setShowCleanup] = useState(false);
  const cancelling = useMemo(() => findCancellingGroups(accounts), [accounts]);
  const cancellingCount = cancelling.reduce((n, g) => n + g.movements.length, 0);

  const entries = useMemo(() => {
    const out: Entry[] = [];
    for (const a of accounts) {
      for (const m of a.movements || []) {
        const kind: Entry['kind'] = m.kind === 'parental' ? 'parental' : m.kind === 'valuation' ? 'valuation' : m.kind === 'adjustment' ? 'adjustment' : isInitialBalance(m) ? 'initial' : 'own';
        // Les mouvements de restitution s'annulent depuis Part parentale (sinon le relevé
        // de restitution resterait affiché alors que le capital serait rétabli).
        const isRestitution = isRestitutionMovement(m);
        out.push({ key: `m-${a.id}-${m.id}`, date: m.date, account: a, kind, title: m.label, amount: signedAmount(m), movementId: isRestitution ? undefined : m.id });
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
      out.push({ key: 'restitution', date: restitution.done.date, kind: 'restitution', title: 'Restitution du capital de vos parents', amount: -total });
    }
    return out.sort((x, y) => y.date.localeCompare(x.date) || x.key.localeCompare(y.key));
  }, [accounts, restitution]);

  const shown = entries.filter(e =>
    (!accountId || e.account?.id === accountId) &&
    (filter === 'all'
      || (filter === 'own' && (e.kind === 'own' || e.kind === 'initial' || e.kind === 'adjustment'))
      || (filter === 'parental' && (e.kind === 'parental' || e.kind === 'restitution'))
      || (filter === 'valuation' && e.kind === 'valuation')
      || (filter === 'rates' && e.kind === 'rate')));

  const seg = (f: Filter, label: string) => (
    <button type="button" onClick={() => { setFilter(f); setLimit(PAGE); }} aria-pressed={filter === f}
      className={`px-3 py-2 text-xs font-bold ${filter === f ? 'bg-indigo-600 text-white' : 'bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400'}`}>{label}</button>
  );

  return (
    <div className="space-y-6 animate-fade-in pb-20">
      <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-xs">
        <h2 className="text-2xl font-black text-slate-800 dark:text-slate-100 flex items-center gap-2 mb-1"><History className="w-6 h-6 text-indigo-600" /> Journal des modifications</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">Tout ce qui a changé sur vos comptes : versements et retraits, part des parents, variations de valeur, taux. Chaque mouvement peut être supprimé (avec annulation possible).</p>
      </div>

      <details className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-xs group" open={!!trackingStartDate}>
        <summary className="list-none cursor-pointer p-4 text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center justify-between">
          {trackingStartDate ? `Suivi de l'épargne reparti du ${parseISODate(trackingStartDate).toLocaleDateString('fr-FR')}` : "Repartir de zéro pour le suivi de l'épargne"}
          <span className="text-xs text-slate-500 dark:text-slate-400 group-open:hidden">Afficher</span>
        </summary>
        <div className="px-4 pb-4 space-y-2 text-sm text-slate-600 dark:text-slate-300">
          <p>Seuls les mouvements à partir de cette date comptent dans « Placé depuis la paie », le taux d'épargne et les bilans. Vos soldes, leur historique et les intérêts ne changent pas, et rien n'est effacé.</p>
          <div className="flex flex-wrap items-center gap-2">
            <input type="date" defaultValue={trackingStartDate || formatISODayLocal(new Date())} id="tracking-start" aria-label="Point de départ du suivi" className="p-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg font-bold" />
            <button type="button" onClick={() => { const v = (document.getElementById('tracking-start') as HTMLInputElement | null)?.value; if (v) onSetTrackingStart(v); }} className="px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black">{trackingStartDate ? 'Changer la date' : 'Repartir de cette date'}</button>
            {trackingStartDate && <button type="button" onClick={() => onSetTrackingStart(undefined)} className="text-xs font-bold underline">Retirer le point de départ</button>}
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">Pour un seul mouvement qui n'était pas de l'épargne (correction, intérêts, argent en transit), utilisez plutôt « Pas de l'épargne » sur sa ligne.</p>
        </div>
      </details>

      {cancellingCount > 0 && (
        <div className="p-4 rounded-2xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-bold text-amber-900 dark:text-amber-200">
              {cancellingCount} mouvements s'annulent entre eux (même compte, même jour) : sans effet sur vos soldes, sans doute des tests.
            </p>
            <div className="flex gap-2">
              <button type="button" onClick={() => setShowCleanup(v => !v)} className="text-xs font-bold underline text-amber-900 dark:text-amber-200">{showCleanup ? 'Masquer' : 'Voir'}</button>
              <button type="button" onClick={() => onRemoveCancelling(cancelling)} className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-black">Les supprimer</button>
            </div>
          </div>
          {showCleanup && (
            <ul className="text-xs text-amber-900 dark:text-amber-200 space-y-1">
              {cancelling.map(g => (
                <li key={g.accountId + g.date}>
                  <b>{parseISODate(g.date).toLocaleDateString('fr-FR')} · {g.accountName}</b> : {g.movements.map(m => `${m.label} (${m.type === 'IN' ? '+' : '−'}${formatEUR(m.amount)})`).join(', ')}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

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

      <ul className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-xs divide-y divide-slate-100 dark:divide-slate-700">
        {shown.length === 0 && <li className="p-6 text-sm text-slate-500 dark:text-slate-400 italic">Rien à afficher.</li>}
        {shown.slice(0, limit).map(e => (
          <li key={e.key} className="flex items-center gap-3 px-4 py-3">
            <span className="w-20 shrink-0 text-xs font-bold text-slate-500 dark:text-slate-400">{parseISODate(e.date).toLocaleDateString('fr-FR')}</span>
            <span className="flex-1 min-w-0">
              <span className="block text-sm font-bold text-slate-800 dark:text-slate-100 truncate">{e.title}</span>
              <span className="flex flex-wrap items-center gap-1.5 mt-0.5">
                <span className={`text-[11px] font-black px-1.5 py-0.5 rounded-sm ${BADGE[e.kind].cls}`}>{BADGE[e.kind].label}</span>
                {e.account && <span className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{e.account.name}</span>}
              </span>
            </span>
            {e.amount !== undefined && (
              <span className={`font-mono font-bold text-sm shrink-0 ${e.amount >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{e.amount >= 0 ? '+' : '−'}{formatEUR(Math.abs(e.amount))}</span>
            )}
            {e.movementId && e.account && (e.kind === 'own' || e.kind === 'adjustment') && (
              <button type="button" onClick={() => onToggleAdjustment(e.account!.id, e.movementId!)}
                title={e.kind === 'adjustment' ? "Compter de nouveau comme de l'épargne" : "Ce n'est pas de l'épargne (correction) : reste dans les soldes, sort de « Placé » et des bilans"}
                className={`px-2 py-1 rounded-md text-[11px] font-bold shrink-0 ${e.kind === 'adjustment' ? 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200' : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'}`}>
                {e.kind === 'adjustment' ? 'Compter comme épargne' : "Pas de l'épargne"}
              </button>
            )}
            {e.movementId && e.account && (
              <button type="button" onClick={() => onDeleteMovement(e.account!.id, e.movementId!)} aria-label={`Supprimer « ${e.title} »`} className="p-2 text-slate-400 hover:text-rose-500 shrink-0"><Trash2 className="w-4 h-4" /></button>
            )}
            {e.kind === 'rate' && e.canRevertRate && e.account && (
              <button type="button" onClick={() => onRevertRate(e.account!.id, e.rateEntryDate!)} title="Revenir au taux précédent" aria-label="Annuler ce changement de taux" className="p-2 text-slate-400 hover:text-indigo-600 shrink-0"><Undo2 className="w-4 h-4" /></button>
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
