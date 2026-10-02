// Aide à la déclaration de revenus : case par case, ce qu'il faut vérifier ou reporter.
import React, { useMemo, useState } from 'react';
import { ClipboardCheck, Info } from 'lucide-react';
import { GlobalAppData } from '../types';
import { buildTaxReturnChecklist } from '../lib/planning';
import { formatEUR } from '../lib/format';

interface Props {
  data: Pick<GlobalAppData, 'payslips' | 'donations' | 'accounts'>;
  estimatedNetTaxableBeforeAllowance?: number;
  allowanceRate?: number;
  allowanceCap?: number;
  ceiling75?: number;
}

const BADGE: Record<string, string> = {
  exact: 'bg-emerald-100 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300',
  estimate: 'bg-amber-100 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300',
  info: 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200',
};
const BADGE_LABEL: Record<string, string> = { exact: 'à reporter', estimate: 'estimation', info: 'à savoir' };

export const TaxReturnHelper: React.FC<Props> = ({ data, estimatedNetTaxableBeforeAllowance, allowanceRate, allowanceCap, ceiling75 }) => {
  const thisYear = new Date().getFullYear();
  // Au printemps, on déclare l'année précédente.
  const [year, setYear] = useState(thisYear - 1);
  const lines = useMemo(
    () => buildTaxReturnChecklist(data, year, { estimatedNetTaxableBeforeAllowance: year === thisYear - 1 || year === thisYear ? estimatedNetTaxableBeforeAllowance : undefined, allowanceRate, allowanceCap, ceiling75 }),
    [data, year, estimatedNetTaxableBeforeAllowance, allowanceRate, allowanceCap, ceiling75, thisYear]
  );
  return (
    <section aria-labelledby="tax-return-title" className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-xs">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="tax-return-title" className="font-black text-slate-800 dark:text-slate-100 flex items-center gap-2"><ClipboardCheck className="w-5 h-5 text-indigo-600" aria-hidden="true" /> Déclaration de revenus</h3>
          <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">Les cases à vérifier sur impots.gouv pour les revenus de {year} (déclaration au printemps {year + 1}).</p>
        </div>
        <label className="text-xs font-bold text-slate-600 dark:text-slate-300 flex items-center gap-2">
          Revenus de
          <select value={year} onChange={e => setYear(Number(e.target.value))} className="p-1.5 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-bold text-slate-800 dark:text-slate-100">
            {[thisYear, thisYear - 1, thisYear - 2].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
      </div>
      {lines.length === 0 ? (
        <p className="text-sm text-slate-600 dark:text-slate-300 mt-4">Rien de particulier pour cette année : importez vos fiches de paie pour vérifier vos salaires.</p>
      ) : (
        <ul className="mt-4 divide-y divide-slate-100 dark:divide-slate-700">
          {lines.map((l, i) => (
            <li key={`${l.box}-${i}`} className="py-3 flex gap-3">
              <span className="w-20 shrink-0 font-mono text-xs font-black text-indigo-700 dark:text-indigo-300 pt-0.5">{l.box}</span>
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-bold text-slate-800 dark:text-slate-100">{l.label}</p>
                  <span className="flex items-center gap-2">
                    {l.amount !== undefined && <span className="font-black text-slate-800 dark:text-slate-100 tabular-nums">{formatEUR(l.amount, 0)}</span>}
                    <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${BADGE[l.confidence]}`}>{BADGE_LABEL[l.confidence]}</span>
                  </span>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">{l.note}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-[11px] text-slate-500 dark:text-slate-400 flex items-start gap-1"><Info className="w-3 h-3 shrink-0 mt-0.5" aria-hidden="true" /> Les montants pré-remplis par l'administration font foi : cette liste aide à les contrôler, elle ne remplace pas votre déclaration.</p>
    </section>
  );
};
