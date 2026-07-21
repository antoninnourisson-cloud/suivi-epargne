import React, { useMemo, useState } from 'react';
import { Expense, FiscalConfig, WorkBenefits, SavingsGoal } from '../types';
import { computeIncome, computeSavingsCapacity } from '../lib/finance';
import { Target, Plus, Trash2, Check, X, Calendar, TrendingUp, Flag } from 'lucide-react';

interface IncomeCfg {
  grossAnnual: number;
  extraMonthlyIncome: number;
  navigoBase: number;
  navigoRate: number;
  taxRateManual: number;
  leisureBudget: number;
  projectSavings: number;
}

interface GoalsProps {
  goals: SavingsGoal[];
  onUpdateGoals: (goals: SavingsGoal[]) => void;
  expenses: Expense[];
  income: IncomeCfg;
  fiscalConfig: FiscalConfig;
  workBenefits: WorkBenefits;
}

const fmt = (n: number) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);
const monthsBetween = (from: Date, to: Date) =>
  (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth()) + (to.getDate() - from.getDate()) / 30;

export const Goals: React.FC<GoalsProps> = ({ goals, onUpdateGoals, expenses, income, fiscalConfig, workBenefits }) => {
  const [isAdding, setIsAdding] = useState(false);
  const [form, setForm] = useState({ name: '', targetAmount: '', savedAmount: '', deadline: '' });

  const capacity = useMemo(() => {
    const breakdown = computeIncome(
      { grossAnnual: income.grossAnnual, extraMonthlyIncome: income.extraMonthlyIncome, navigoBase: income.navigoBase, navigoRate: income.navigoRate, taxRateManual: income.taxRateManual },
      fiscalConfig,
      workBenefits
    );
    const totalFixed = expenses.reduce((s, e) => s + e.amount, 0);
    return computeSavingsCapacity(breakdown.superNet, totalFixed, income.leisureBudget, income.projectSavings);
  }, [income, expenses, fiscalConfig, workBenefits]);

  const resetForm = () => { setForm({ name: '', targetAmount: '', savedAmount: '', deadline: '' }); setIsAdding(false); };

  const addGoal = () => {
    if (!form.name || !form.targetAmount) return;
    const g: SavingsGoal = {
      id: crypto.randomUUID(),
      name: form.name,
      targetAmount: parseFloat(form.targetAmount) || 0,
      savedAmount: parseFloat(form.savedAmount) || 0,
      deadline: form.deadline || undefined,
    };
    onUpdateGoals([...goals, g]);
    resetForm();
  };

  const patchGoal = (id: string, patch: Partial<SavingsGoal>) =>
    onUpdateGoals(goals.map(g => (g.id === id ? { ...g, ...patch } : g)));
  const removeGoal = (id: string) => onUpdateGoals(goals.filter(g => g.id !== id));

  return (
    <div className="space-y-6 animate-fade-in pb-20">
      <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm flex flex-col sm:flex-row justify-between gap-4 sm:items-center">
        <div>
          <h2 className="text-2xl font-black text-slate-800 dark:text-slate-100 flex items-center gap-2"><Target className="w-6 h-6 text-indigo-600" /> Objectifs d'épargne</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Capacité d'épargne estimée : <span className={`font-black ${capacity >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{fmt(capacity)}/mois</span>
          </p>
        </div>
        {!isAdding && (
          <button onClick={() => setIsAdding(true)} className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-xl font-bold flex gap-2 items-center shadow-lg shadow-indigo-200"><Plus className="w-5 h-5" /> Nouvel objectif</button>
        )}
      </div>

      {isAdding && (
        <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-indigo-200 shadow-sm space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div><label className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase">Nom</label><input autoFocus value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Ex : Épargne de précaution" className="w-full p-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg font-bold" /></div>
            <div><label className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase">Montant cible (€)</label><input type="number" value={form.targetAmount} onChange={e => setForm({ ...form, targetAmount: e.target.value })} className="w-full p-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg font-bold" /></div>
            <div><label className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase">Déjà épargné (€)</label><input type="number" value={form.savedAmount} onChange={e => setForm({ ...form, savedAmount: e.target.value })} className="w-full p-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg font-bold" /></div>
            <div><label className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase">Échéance (optionnel)</label><input type="date" value={form.deadline} onChange={e => setForm({ ...form, deadline: e.target.value })} className="w-full p-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg font-bold" /></div>
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={resetForm} className="px-4 py-2 rounded-xl font-bold text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 flex items-center gap-1"><X className="w-4 h-4" /> Annuler</button>
            <button onClick={addGoal} className="px-4 py-2 rounded-xl font-bold text-sm bg-indigo-600 text-white hover:bg-indigo-700 flex items-center gap-1"><Check className="w-4 h-4" /> Ajouter</button>
          </div>
        </div>
      )}

      {goals.length === 0 && !isAdding && (
        <div className="text-center py-16 text-slate-400 dark:text-slate-500 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700">
          <Flag className="w-10 h-10 mx-auto mb-3 opacity-40" />
          Aucun objectif pour l'instant. Fixe une cible pour suivre ta progression.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {goals.map(g => {
          const pct = g.targetAmount > 0 ? Math.min(100, (g.savedAmount / g.targetAmount) * 100) : 0;
          const remaining = Math.max(0, g.targetAmount - g.savedAmount);
          const done = remaining <= 0;
          const monthsToGoal = capacity > 0 ? remaining / capacity : Infinity;

          let deadlineInfo: { text: string; ok: boolean } | null = null;
          if (g.deadline && !done) {
            const monthsLeft = monthsBetween(new Date(), new Date(g.deadline));
            if (monthsLeft <= 0) deadlineInfo = { text: 'Échéance dépassée', ok: false };
            else {
              const requiredMonthly = remaining / monthsLeft;
              const ok = capacity >= requiredMonthly;
              deadlineInfo = { text: `Nécessite ${fmt(requiredMonthly)}/mois (dispo : ${fmt(capacity)})`, ok };
            }
          }

          return (
            <div key={g.id} className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm">
              <div className="flex justify-between items-start mb-3">
                <div>
                  <h3 className="font-black text-slate-800 dark:text-slate-100 text-lg">{g.name}</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{fmt(g.savedAmount)} / {fmt(g.targetAmount)}</p>
                </div>
                <button onClick={() => removeGoal(g.id)} className="p-2 text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded-lg"><Trash2 className="w-4 h-4" /></button>
              </div>

              <div className="w-full h-3 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden mb-2">
                <div className={`h-full rounded-full transition-all ${done ? 'bg-emerald-500' : 'bg-indigo-600'}`} style={{ width: `${pct}%` }} />
              </div>
              <div className="flex justify-between text-[11px] font-bold text-slate-400 dark:text-slate-500 mb-4">
                <span>{pct.toFixed(0)}%</span>
                <span>{done ? 'Objectif atteint 🎉' : `Reste ${fmt(remaining)}`}</span>
              </div>

              {!done && (
                <div className="flex flex-wrap gap-3 text-xs">
                  <span className="inline-flex items-center gap-1 text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-900 px-3 py-1.5 rounded-lg font-bold">
                    <TrendingUp className="w-3.5 h-3.5 text-indigo-500" />
                    {capacity > 0 ? `≈ ${Math.ceil(monthsToGoal)} mois au rythme actuel` : 'Capacité d\'épargne insuffisante'}
                  </span>
                  {deadlineInfo && (
                    <span className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg font-bold ${deadlineInfo.ok ? 'text-emerald-700 bg-emerald-50' : 'text-rose-700 bg-rose-50'}`}>
                      <Calendar className="w-3.5 h-3.5" /> {deadlineInfo.text}
                    </span>
                  )}
                </div>
              )}

              <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800 flex items-center gap-2">
                <label className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase">Mettre à jour l'épargne</label>
                <input
                  type="number"
                  defaultValue={g.savedAmount}
                  onBlur={e => patchGoal(g.id, { savedAmount: parseFloat(e.target.value) || 0 })}
                  className="w-28 p-1.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg font-bold text-sm"
                />
                <span className="text-slate-400 dark:text-slate-500 text-sm">€</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
