// ================================================
// FILE: src/components/RegulatedRatesEditor.tsx
// Mise à jour des taux des livrets réglementés avec leur date d'effet (ex. Livret A à
// 1,7 % au 1er août 2026), appliquée à tous les livrets concernés d'un coup. Les intérêts
// sont recalculés avec l'ancien taux avant cette date et le nouveau après.
// ================================================
import React, { useMemo, useState } from 'react';
import { SavingsAccount } from '../types';
import { REGULATED_RATE_GROUPS, applyRateChange, lastRateRevision } from '../lib/finance';
import { formatRate } from '../lib/format';
import { parseFrenchNumber } from '../lib/numbers';
import { formatISODay } from '../lib/dates';
import { Percent, Check } from 'lucide-react';

interface Props {
  accounts: SavingsAccount[];
  onApply: (update: (prev: SavingsAccount[]) => SavingsAccount[]) => void;
  onDone?: () => void;
}

export const RegulatedRatesEditor: React.FC<Props> = ({ accounts, onApply, onDone }) => {
  const groups = useMemo(() => REGULATED_RATE_GROUPS
    .map(g => ({ ...g, accounts: accounts.filter(a => g.types.includes(a.type)) }))
    .filter(g => g.accounts.length > 0), [accounts]);
  const defaultDate = formatISODay(lastRateRevision().date);
  const [drafts, setDrafts] = useState<Record<string, { rate: string; date: string }>>(() =>
    Object.fromEntries(groups.map(g => [g.key, { rate: String(g.accounts[0].interestRate ?? '').replace('.', ','), date: defaultDate }])));
  const [saved, setSaved] = useState<string | null>(null);

  if (groups.length === 0) return null;

  const apply = (key: string) => {
    const g = groups.find(x => x.key === key)!;
    const d = drafts[key];
    const rate = parseFrenchNumber(d.rate);
    if (rate === null || rate < 0 || !d.date) return;
    const ids = new Set(g.accounts.map(a => a.id));
    onApply(prev => prev.map(a => (ids.has(a.id) ? applyRateChange(a, rate, d.date) : a)));
    setSaved(key);
    onDone?.();
  };

  return (
    <div className="space-y-3">
      {groups.map(g => {
        const d = drafts[g.key];
        const current = g.accounts[0].interestRate;
        const parsed = parseFrenchNumber(d.rate);
        return (
          <div key={g.key} className="flex flex-wrap items-end gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700">
            <div className="min-w-[8rem] flex-1">
              <p className="font-bold text-sm text-slate-800 dark:text-slate-100 flex items-center gap-1.5"><Percent className="w-4 h-4 text-indigo-600" /> {g.label}</p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">Actuel : {current !== undefined ? formatRate(current) : '—'} · {g.accounts.map(a => a.name).join(', ')}</p>
            </div>
            <label className="block">
              <span className="text-[11px] font-black text-slate-500 dark:text-slate-400 uppercase">Nouveau taux (%)</span>
              <input type="text" inputMode="decimal" value={d.rate} onChange={e => { setDrafts(p => ({ ...p, [g.key]: { ...p[g.key], rate: e.target.value } })); setSaved(null); }}
                className={`block w-24 p-2 bg-white dark:bg-slate-800 border rounded-lg font-bold text-slate-800 dark:text-slate-100 ${parsed === null && d.rate ? 'border-rose-400' : 'border-slate-200 dark:border-slate-700'}`} />
            </label>
            <label className="block">
              <span className="text-[11px] font-black text-slate-500 dark:text-slate-400 uppercase">À partir du</span>
              <input type="date" value={d.date} onChange={e => { setDrafts(p => ({ ...p, [g.key]: { ...p[g.key], date: e.target.value } })); setSaved(null); }}
                className="block p-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg font-bold text-slate-800 dark:text-slate-100" />
            </label>
            <button type="button" onClick={() => apply(g.key)} disabled={parsed === null || !d.date}
              className="px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-black flex items-center gap-1">
              {saved === g.key ? <><Check className="w-4 h-4" /> Appliqué</> : 'Appliquer'}
            </button>
          </div>
        );
      })}
      <p className="text-[11px] text-slate-500 dark:text-slate-400">Les intérêts sont recalculés avec l'ancien taux avant la date d'effet et le nouveau après. Les taux réglementés changent en général le 1er février ou le 1er août.</p>
    </div>
  );
};
