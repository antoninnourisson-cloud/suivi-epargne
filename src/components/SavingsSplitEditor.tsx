// ================================================
// FILE: src/components/SavingsSplitEditor.tsx
// Répartition de l'épargne : automatique (meilleur taux d'abord, livrets jusqu'au
// plafond) ou personnalisée (ex. 50 % Livret A, 50 % Assurance Vie), avec une date de
// début facultative (ex. après la restitution du capital parental).
// ================================================
import React, { useMemo, useState } from 'react';
import { SavingsAccount, AccountType, FiscalConfig } from '../types';
import { computePlacementStrategy, missingSplitAccounts } from '../lib/finance';
import { formatEUR } from '../lib/format';
import { parseFrenchNumber } from '../lib/numbers';
import { parseISODate } from '../lib/dates';
import { PieChart, Plus, X } from 'lucide-react';

type Split = { accountId: string; pct: number }[];

interface Props {
  accounts: SavingsAccount[];
  split?: Split;
  from?: string;
  sampleAmount: number;
  fiscalConfig: FiscalConfig;
  onChange: (split: Split | undefined, from: string | undefined) => void;
}

const EXCLUDED = [AccountType.COMPTE_COURANT, AccountType.IMMOBILIER];

export const SavingsSplitEditor: React.FC<Props> = ({ accounts, split, from, sampleAmount, fiscalConfig, onChange }) => {
  const eligible = accounts.filter(a => !EXCLUDED.includes(a.type));
  const custom = !!split && split.length > 0;
  // Brouillon des pourcentages (saisie libre, virgule acceptée).
  const [drafts, setDrafts] = useState<Record<number, string>>({});

  const total = (split || []).reduce((s, x) => s + x.pct, 0);
  const sample = sampleAmount > 0 ? sampleAmount : 1000;
  const preview = useMemo(
    () => (custom ? computePlacementStrategy(sample, accounts, fiscalConfig, split) : []),
    [custom, sample, accounts, fiscalConfig, split]
  );

  const setRows = (rows: Split) => onChange(rows.length > 0 ? rows : undefined, rows.length > 0 ? from : undefined);
  const enableCustom = () => {
    const la = eligible.find(a => a.type === AccountType.LIVRET_A);
    const av = eligible.find(a => a.type === AccountType.ASSURANCE_VIE);
    const rows = la && av ? [{ accountId: la.id, pct: 50 }, { accountId: av.id, pct: 50 }] : eligible.slice(0, 1).map(a => ({ accountId: a.id, pct: 100 }));
    onChange(rows, from);
  };

  return (
    <div className="mt-6 pt-4 border-t border-slate-100 dark:border-slate-700 space-y-3">
      <p className="text-sm font-bold text-slate-700 dark:text-slate-200 flex items-center gap-2"><PieChart className="w-4 h-4 text-indigo-600" /> Répartition de l'épargne</p>
      <div className="flex rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700 w-fit" role="group" aria-label="Mode de répartition">
        <button type="button" onClick={() => onChange(undefined, undefined)} aria-pressed={!custom} className={`px-3 py-2 text-xs font-black${!custom ? 'bg-indigo-600 text-white' : 'bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400'}`}>Automatique</button>
        <button type="button" onClick={() => !custom && enableCustom()} aria-pressed={custom} className={`px-3 py-2 text-xs font-black${custom ? 'bg-indigo-600 text-white' : 'bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400'}`}>Personnalisée</button>
      </div>

      {missingSplitAccounts(split, accounts).length > 0 && (
        <p className="text-xs font-bold text-amber-700 dark:text-amber-300 p-2 rounded-lg bg-amber-50 dark:bg-amber-950/40">
          Un compte de votre répartition a été supprimé : sa part est redistribuée sur les autres.{' '}
          <button type="button" onClick={() => { setDrafts({}); setRows(split!.filter(r => accounts.some(a => a.id === r.accountId))); }} className="underline">Le retirer</button>
        </p>
      )}
      {!custom ? (
        <p className="text-xs text-slate-500 dark:text-slate-400">Meilleur taux d'abord : livrets jusqu'à leur plafond, puis le reste sur vos autres placements.</p>
      ) : (
        <>
          <div className="space-y-2">
            {split!.map((row, i) => (
              <div key={i} className="flex items-center gap-2">
                <select
                  value={row.accountId}
                  onChange={e => setRows(split!.map((r, j) => (j === i ? { ...r, accountId: e.target.value } : r)))}
                  className="flex-1 min-w-0 p-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm font-bold text-slate-700 dark:text-slate-200"
                  aria-label="Compte"
                >
                  {eligible.filter(a => a.id === row.accountId || !split!.some(r => r.accountId === a.id)).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
                <input
                  type="text"
                  inputMode="decimal"
                  value={drafts[i] ?? String(row.pct).replace('.', ',')}
                  onChange={e => {
                    setDrafts(d => ({ ...d, [i]: e.target.value }));
                    const v = parseFrenchNumber(e.target.value);
                    if (v !== null && v >= 0) setRows(split!.map((r, j) => (j === i ? { ...r, pct: v } : r)));
                  }}
                  onBlur={() => setDrafts(d => { const { [i]: _, ...rest } = d; return rest; })}
                  className="w-16 p-2 text-right bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm font-bold text-slate-700 dark:text-slate-200"
                  aria-label="Pourcentage"
                />
                <span className="text-sm font-bold text-slate-500 dark:text-slate-400">%</span>
                <button type="button" onClick={() => { setDrafts({}); setRows(split!.filter((_, j) => j !== i)); }} aria-label="Retirer" className="p-1.5 text-slate-400 hover:text-rose-500"><X className="w-4 h-4" /></button>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {split!.length < eligible.length && (
              <button type="button" onClick={() => setRows([...split!, { accountId: eligible.find(a => !split!.some(r => r.accountId === a.id))!.id, pct: 0 }])} className="text-xs font-bold text-indigo-600 dark:text-indigo-300 hover:underline flex items-center gap-1"><Plus className="w-3 h-3" /> Ajouter un compte</button>
            )}
            <span className={`text-xs font-bold${Math.abs(total - 100) < 0.01 ? 'text-emerald-600' : 'text-amber-600'}`}>
              Total : {total.toLocaleString('fr-FR')} %{Math.abs(total - 100) >= 0.01 && ' (ramené à 100 % dans le calcul)'}
            </span>
          </div>
          <label className="flex flex-wrap items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
            À partir du
            <input type="date" value={from || ''} onChange={e => onChange(split, e.target.value || undefined)} className="p-1.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg font-bold" />
            <span className="text-slate-500 dark:text-slate-400">{from ? `(plan automatique jusqu'au ${parseISODate(from).toLocaleDateString('fr-FR')})` : '(vide = dès maintenant)'}</span>
          </label>
          {preview.length > 0 && (
            <p className="text-xs text-slate-600 dark:text-slate-300">
              Sur {formatEUR(sample)} : {preview.filter(p => !p.infoOnly).map(p => `${formatEUR(p.fillAmount, 0)} ${p.accountName}`).join(', ')}.
              {preview.filter(p => p.infoOnly && p.hint).map(p => <span key={p.accountName} className="block text-amber-700 dark:text-amber-300 font-bold">{p.hint}</span>)}
            </p>
          )}
        </>
      )}
    </div>
  );
};
