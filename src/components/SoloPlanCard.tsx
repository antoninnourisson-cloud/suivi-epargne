// Plan « solo » : à quoi ressemble votre épargne, année par année, après la restitution
// du capital de vos parents, avec les étapes (précaution atteinte, livrets pleins).
import React, { useMemo, useState } from 'react';
import { Sprout, Flag } from 'lucide-react';
import { FiscalConfig, SavingsAccount } from '../types';
import { buildSoloPlan } from '../lib/planning';
import { SavingsSplit } from '../lib/finance';
import { parseFrenchNumber } from '../lib/numbers';
import { formatEUR } from '../lib/format';
import { parseISODate } from '../lib/dates';

interface Props {
  accounts: SavingsAccount[];
  fiscalConfig: FiscalConfig;
  monthPlan?: number;
  restitutionISO: string;
  split?: SavingsSplit;
  emergencyTarget?: number;
}

export const SoloPlanCard: React.FC<Props> = ({ accounts, fiscalConfig, monthPlan, restitutionISO, split, emergencyTarget }) => {
  const [raw, setRaw] = useState(String(Math.round(monthPlan && monthPlan > 0 ? monthPlan : 500)));
  const monthly = parseFrenchNumber(raw) ?? 0;
  const plan = useMemo(() => buildSoloPlan(accounts, fiscalConfig, monthly, restitutionISO, { years: 4, split, emergencyTarget }), [accounts, fiscalConfig, monthly, restitutionISO, split, emergencyTarget]);
  const startYear = parseISODate(restitutionISO).getFullYear();

  return (
    <section aria-labelledby="solo-plan-title" className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-xs space-y-4">
      <div>
        <h3 id="solo-plan-title" className="font-black text-slate-800 dark:text-slate-100 flex items-center gap-2"><Sprout className="w-5 h-5 text-indigo-600" aria-hidden="true" /> Votre plan solo {startYear}-{startYear + 3}</h3>
        <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">Après la restitution, vous repartez de {formatEUR(plan.startTotal, 0)} : votre part seulement. Les livrets retrouvent de la place sous leurs plafonds.</p>
      </div>
      <label className="block max-w-xs">
        <span className="text-[11px] font-black text-slate-600 dark:text-slate-300 uppercase">Épargne par mois (€)</span>
        <input type="text" inputMode="decimal" value={raw} onChange={e => setRaw(e.target.value)} className="block w-32 mt-1 p-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg font-bold text-slate-800 dark:text-slate-100" />
      </label>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">Épargne au 31 décembre de chaque année</caption>
          <thead>
            <tr className="text-left text-[11px] uppercase text-slate-500 dark:text-slate-400">
              <th scope="col" className="py-2 pr-3">Fin</th>
              <th scope="col" className="py-2 pr-3 text-right">Total</th>
              <th scope="col" className="py-2">Détail</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
            {plan.years.map(y => (
              <tr key={y.year}>
                <th scope="row" className="py-2 pr-3 font-bold text-slate-800 dark:text-slate-100">{y.year}</th>
                <td className="py-2 pr-3 text-right font-black text-slate-800 dark:text-slate-100 tabular-nums">{formatEUR(y.total, 0)}</td>
                <td className="py-2 text-xs text-slate-600 dark:text-slate-300">{y.byAccount.map(b => `${b.name} ${formatEUR(b.amount, 0)}`).join(' · ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {plan.milestones.length > 0 && (
        <ul className="space-y-1">
          {plan.milestones.map(m => (
            <li key={`${m.date}-${m.label}`} className="text-sm text-slate-700 dark:text-slate-200 flex items-center gap-2">
              <Flag className="w-4 h-4 text-amber-700" aria-hidden="true" />
              <b>{parseISODate(m.date).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}</b> : {m.label}
            </li>
          ))}
        </ul>
      )}
      <p className="text-[11px] text-slate-500 dark:text-slate-400">Taux d'aujourd'hui supposés constants, intérêts nets. Votre répartition personnalisée est utilisée si vous en avez une, sinon le plan « meilleur taux d'abord ».</p>
    </section>
  );
};
