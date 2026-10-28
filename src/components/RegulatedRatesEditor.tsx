// ================================================
// FILE: src/components/RegulatedRatesEditor.tsx
// Mise à jour des taux des livrets réglementés avec leur date d'effet (ex. Livret A à
// 1,7 % au 1er août 2026), appliquée à tous les livrets concernés d'un coup. Les intérêts
// sont recalculés avec l'ancien taux avant cette date et le nouveau après.
// Champs Material 3 (ui/TextField) : libellé visible et relié, erreur annoncée.
// ================================================
import React, { useMemo, useState } from 'react';
import { SavingsAccount } from '../types';
import { REGULATED_RATE_GROUPS, applyRateChange, lastRateRevision } from '../lib/finance';
import { formatRate } from '../lib/format';
import { parseFrenchNumber } from '../lib/numbers';
import { formatISODay } from '../lib/dates';
import { Percent, Check } from 'lucide-react';
import { Button, TextField } from './ui';

interface Props {
  accounts: SavingsAccount[];
  onApply: (update: (prev: SavingsAccount[]) => SavingsAccount[]) => void;
}

export const RegulatedRatesEditor: React.FC<Props> = ({ accounts, onApply }) => {
  const groups = useMemo(() => REGULATED_RATE_GROUPS
    .map(g => ({ ...g, accounts: accounts.filter(a => g.types.includes(a.type)) }))
    .filter(g => g.accounts.length > 0), [accounts]);
  const defaultDate = formatISODay(lastRateRevision().date);
  const [drafts, setDrafts] = useState<Record<string, { rate: string; date: string }>>(() =>
    Object.fromEntries(groups.map(g => [g.key, { rate: String(g.accounts[0].interestRate ?? '').replace('.', ','), date: defaultDate }])));
  const [saved, setSaved] = useState<string | null>(null);

  if (groups.length === 0) return null;

  const edit = (key: string, field: 'rate' | 'date', value: string) => {
    setDrafts(p => ({ ...p, [key]: { ...p[key], [field]: value } }));
    setSaved(null);
  };

  const apply = (key: string) => {
    const g = groups.find(x => x.key === key)!;
    const d = drafts[key];
    const rate = parseFrenchNumber(d.rate);
    if (rate === null || rate < 0 || !d.date) return;
    const ids = new Set(g.accounts.map(a => a.id));
    onApply(prev => prev.map(a => (ids.has(a.id) ? applyRateChange(a, rate, d.date) : a)));
    setSaved(key);
  };

  return (
    <div className="space-y-3">
      {groups.map(g => {
        const d = drafts[g.key];
        const current = g.accounts[0].interestRate;
        const parsed = parseFrenchNumber(d.rate);
        const invalid = d.rate.trim() !== '' && (parsed === null || parsed < 0);
        return (
          <div key={g.key} className="flex flex-wrap items-start gap-3 p-4 rounded-xl bg-surface-container-low border border-outline-variant">
            <div className="min-w-40 flex-1 basis-full sm:basis-auto">
              <p className="font-medium text-sm text-on-surface flex items-center gap-1.5"><Percent className="w-4 h-4 text-primary" aria-hidden="true" /> {g.label}</p>
              <p className="text-xs text-on-surface-variant">Actuel : {current !== undefined ? formatRate(current) : '—'} · {g.accounts.map(a => a.name).join(', ')}</p>
            </div>
            <TextField className="w-32" label="Nouveau taux" aria-label={`Nouveau taux, ${g.label}`} suffix="%" inputMode="decimal" value={d.rate}
              error={invalid ? 'Taux illisible' : undefined} onChange={e => edit(g.key, 'rate', e.target.value)} />
            <TextField className="w-44" label="À partir du" aria-label={`À partir du, ${g.label}`} type="date" value={d.date}
              onChange={e => edit(g.key, 'date', e.target.value)} />
            <Button className="sm:mt-[30px]" onClick={() => apply(g.key)} disabled={parsed === null || parsed < 0 || !d.date}>
              {saved === g.key ? <><Check className="w-4 h-4" aria-hidden="true" /> Appliqué</> : 'Appliquer'}
            </Button>
          </div>
        );
      })}
      <p className="text-xs text-on-surface-variant">Les intérêts sont recalculés avec l'ancien taux avant la date d'effet et le nouveau après. Les taux réglementés changent en général le 1er février ou le 1er août.</p>
    </div>
  );
};
