// ================================================
// FILE: src/components/SplitProjectionCard.tsx
// Projection de l'épargne selon la répartition : 100 % Livret A, votre répartition (ou
// 50/50), 100 % Assurance Vie, avec les taux NETS (prélèvements sociaux déduits pour l'AV)
// et les plafonds des livrets. Part de votre part propre actuelle.
// ================================================
import React, { useMemo, useState } from 'react';
import { SavingsAccount, AccountType, FiscalConfig } from '../types';
import { projectSavings, netAnnualRate } from '../lib/projection';
import { formatEUR, formatRate } from '../lib/format';
import { parseFrenchNumber } from '../lib/numbers';
import { LineChart } from 'lucide-react';

interface Props {
  accounts: SavingsAccount[];
  fiscalConfig: FiscalConfig;
  monthPlan?: number;
  savingsSplit?: { accountId: string; pct: number }[];
  restitutionInMonths?: number;
}

export const SplitProjectionCard: React.FC<Props> = ({ accounts, fiscalConfig, monthPlan, savingsSplit, restitutionInMonths }) => {
  const la = accounts.find(a => a.type === AccountType.LIVRET_A);
  const av = accounts.find(a => a.type === AccountType.ASSURANCE_VIE);
  const [monthlyRaw, setMonthlyRaw] = useState(String(Math.round(monthPlan && monthPlan > 0 ? monthPlan : 1000)));
  const [years, setYears] = useState(10);
  const monthly = parseFrenchNumber(monthlyRaw) ?? 0;

  const scenarios = useMemo(() => {
    if (!la || !av || monthly <= 0) return [];
    const custom = savingsSplit && savingsSplit.length > 0;
    const list: { label: string; split: { accountId: string; pct: number }[] }[] = [
      { label: `100 % ${la.name}`, split: [{ accountId: la.id, pct: 100 }] },
      { label: custom ? 'Votre répartition' : `50 % ${la.name} · 50 % ${av.name}`, split: custom ? savingsSplit! : [{ accountId: la.id, pct: 50 }, { accountId: av.id, pct: 50 }] },
      { label: `100 % ${av.name}`, split: [{ accountId: av.id, pct: 100 }] },
    ];
    return list.map(sc => ({ ...sc, result: projectSavings(accounts, fiscalConfig, monthly, years, sc.split, restitutionInMonths) }));
  }, [accounts, fiscalConfig, la, av, monthly, years, savingsSplit, restitutionInMonths]);

  if (!la || !av) return null;
  const best = Math.max(...scenarios.map(s => s.result.total), 0);

  return (
    <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm space-y-4">
      <div>
        <h3 className="font-black text-slate-800 dark:text-slate-100 flex items-center gap-2"><LineChart className="w-5 h-5 text-indigo-600" /> Projection selon la répartition</h3>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
          Taux nets : {la.name} {formatRate(netAnnualRate(la, fiscalConfig))} · {av.name} {formatRate(Math.round(netAnnualRate(av, fiscalConfig) * 100) / 100)} (après prélèvements sociaux).
          Taux supposés constants, à partir de votre part actuelle{restitutionInMonths !== undefined ? ' ; la restitution du capital de vos parents est prise en compte' : ''}.
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="text-[11px] font-black text-slate-500 dark:text-slate-400 uppercase">Épargne par mois (€)</span>
          <input type="text" inputMode="decimal" value={monthlyRaw} onChange={e => setMonthlyRaw(e.target.value)} className="block w-28 p-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg font-bold text-slate-800 dark:text-slate-100" />
        </label>
        <div className="flex rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700" role="group" aria-label="Durée">
          {[5, 10, 20].map(y => (
            <button key={y} type="button" onClick={() => setYears(y)} aria-pressed={years === y} className={`px-3 py-2 text-xs font-black ${years === y ? 'bg-indigo-600 text-white' : 'bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400'}`}>{y} ans</button>
          ))}
        </div>
      </div>
      <div className="space-y-2">
        {scenarios.map(sc => (
          <div key={sc.label} className={`p-3 rounded-xl border ${sc.result.total === best ? 'border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 dark:border-emerald-800' : 'border-slate-200 dark:border-slate-700'}`}>
            <div className="flex items-baseline justify-between gap-3">
              <p className="font-bold text-sm text-slate-800 dark:text-slate-100">{sc.label}</p>
              <p className="font-black text-slate-800 dark:text-slate-100 whitespace-nowrap">{formatEUR(sc.result.total, 0)}</p>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              dont {formatEUR(sc.result.interest, 0)} d'intérêts nets · {sc.result.byAccount.map(b => `${b.name} ${formatEUR(b.amount, 0)}`).join(' · ')}
            </p>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-slate-500 dark:text-slate-400">
        Le Livret A est disponible à tout moment et sans impôt. L'Assurance Vie l'est aussi, mais un retrait est imposé sur la part de gains (moins après 8 ans) : la différence de rendement se paie en souplesse.
      </p>
    </div>
  );
};
