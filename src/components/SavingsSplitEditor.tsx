// ================================================
// FILE: src/components/SavingsSplitEditor.tsx
// Répartition de l'épargne : automatique (meilleur taux d'abord, livrets jusqu'au
// plafond) ou personnalisée (ex. 50 % Livret A, 50 % Assurance Vie), avec une date de
// début facultative (ex. après la restitution du capital parental).
// ================================================
import React, { useMemo, useState } from 'react';
import { SavingsAccount, AccountType, FiscalConfig } from '../types';
import { computePlacementStrategy, missingSplitAccounts } from '../lib/finance';
import { parseFrenchNumber } from '../lib/numbers';
import { parseISODate } from '../lib/dates';
import { Plus, X, Info } from 'lucide-react';
import { SegmentedButton, MoneyText } from './ui';

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
    <div className="space-y-4">
      <SegmentedButton
        label="Mode de répartition"
        value={custom ? 'custom' : 'auto'}
        onChange={v => { if (v === 'auto') onChange(undefined, undefined); else if (!custom) enableCustom(); }}
        options={[{ value: 'auto', label: 'Automatique' }, { value: 'custom', label: 'Personnalisée' }]}
      />

      {missingSplitAccounts(split, accounts).length > 0 && (
        <p className="text-sm text-on-tertiary-container bg-tertiary-container rounded-xl p-3">
          Un compte de votre répartition a été supprimé : sa part est redistribuée sur les autres.{' '}
          <button type="button" onClick={() => { setDrafts({}); setRows(split!.filter(r => accounts.some(a => a.id === r.accountId))); }} className="underline font-medium">Le retirer</button>
        </p>
      )}
      {!custom ? (
        <p className="text-sm text-on-surface-variant">Meilleur taux d'abord : livrets jusqu'à leur plafond, puis le reste sur vos autres placements.</p>
      ) : (
        <>
          <div className="space-y-2">
            {split!.map((row, i) => (
              <div key={i} className="flex items-center gap-2">
                <select
                  value={row.accountId}
                  onChange={e => setRows(split!.map((r, j) => (j === i ? { ...r, accountId: e.target.value } : r)))}
                  className="flex-1 min-w-0 h-10 px-3 rounded-xs bg-transparent border border-outline text-sm text-on-surface hover:border-on-surface focus:border-indigo-600 dark:focus:border-indigo-300 focus:border-2 outline-none dark:bg-surface-container-low"
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
                  className="w-20 text-right tabular-nums h-10 px-3 rounded-xs bg-transparent border border-outline text-sm text-on-surface hover:border-on-surface focus:border-indigo-600 dark:focus:border-indigo-300 focus:border-2 outline-none"
                  aria-label="Pourcentage"
                />
                <span className="text-sm text-on-surface-variant" aria-hidden="true">%</span>
                <button type="button" onClick={() => { setDrafts({}); setRows(split!.filter((_, j) => j !== i)); }} aria-label="Retirer ce compte de la répartition" className="w-10 h-10 shrink-0 rounded-full flex items-center justify-center text-on-surface-variant hover:bg-on-surface/8 hover:text-error"><X className="w-5 h-5" aria-hidden="true" /></button>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {split!.length < eligible.length && (
              <button type="button" onClick={() => setRows([...split!, { accountId: eligible.find(a => !split!.some(r => r.accountId === a.id))!.id, pct: 0 }])} className="h-10 px-3 -ml-3 rounded-full text-sm font-medium text-indigo-700 dark:text-indigo-200 hover:bg-indigo-600/8 inline-flex items-center gap-2"><Plus className="w-4 h-4" aria-hidden="true" /> Ajouter un compte</button>
            )}
            <span className={`text-sm tabular-nums ${Math.abs(total - 100) < 0.01 ? 'text-on-surface-variant' : 'text-on-tertiary-container bg-tertiary-container rounded-sm px-2 py-0.5'}`}>
              Total : {total.toLocaleString('fr-FR')} %{Math.abs(total - 100) >= 0.01 && ' (ramené à 100 % dans le calcul)'}
            </span>
          </div>
          <label className="flex flex-wrap items-center gap-2 text-sm text-on-surface-variant">
            À partir du
            <input type="date" value={from || ''} onChange={e => onChange(split, e.target.value || undefined)} className="h-10 px-3 rounded-xs bg-transparent border border-outline text-sm text-on-surface hover:border-on-surface focus:border-indigo-600 dark:focus:border-indigo-300 focus:border-2 outline-none dark:[color-scheme:dark]" />
            <span className="text-xs">{from ? `(plan automatique jusqu'au ${parseISODate(from).toLocaleDateString('fr-FR')})` : '(vide = dès maintenant)'}</span>
          </label>
          {preview.length > 0 && (
            <div className="rounded-xl bg-surface-container p-3 text-sm">
              <p className="text-on-surface-variant mb-1">Exemple sur <MoneyText value={sample} /> :</p>
              <ul className="space-y-0.5">
                {preview.filter(p => !p.infoOnly).map(p => (
                  <li key={p.accountName} className="flex justify-between gap-3 text-on-surface"><span className="min-w-0 truncate">{p.accountName}</span><MoneyText value={p.fillAmount} decimals={0} /></li>
                ))}
              </ul>
              {preview.filter(p => p.infoOnly && p.hint).map(p => <p key={p.accountName} className="mt-2 text-on-tertiary-container bg-tertiary-container rounded-lg p-2 flex items-start gap-2"><Info className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />{p.hint}</p>)}
            </div>
          )}
        </>
      )}
    </div>
  );
};
