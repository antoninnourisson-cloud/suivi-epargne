import React, { useEffect, useMemo, useState } from 'react';
import { SavingsAccount, AccountType, Expense, SavingsGoal } from '../types';
import { Calculator, Hourglass, Target, ArrowRight, Info } from 'lucide-react';
import { safeNumber } from '../lib/numbers';

interface SimulatorProps {
  accounts: SavingsAccount[];
  expenses: Expense[];
  goals: SavingsGoal[];
}

const fmt = (n: number) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);
const LIQUID_EXCLUDED = [AccountType.IMMOBILIER, AccountType.PER, AccountType.PEE];

const isLiquid = (a: SavingsAccount) => !a.contractEndDate && !LIQUID_EXCLUDED.includes(a.type);

export const WithdrawalSimulator: React.FC<SimulatorProps> = ({ accounts, expenses, goals }) => {
  const eligibleAccounts = useMemo(() => accounts.filter(a => a.ownedAmount > 0), [accounts]);
  const [accountId, setAccountId] = useState(eligibleAccounts[0]?.id || '');
  const [amount, setAmount] = useState('');
  const [goalId, setGoalId] = useState(goals[0]?.id || '');

  // Les sélections sont initialisées au montage uniquement : si la liste change en
  // cours de session (compte supprimé, objectif renommé/retiré), on retombe sur une
  // valeur valide, sinon le panneau disparaît sans explication.
  useEffect(() => {
    if (!eligibleAccounts.some(a => a.id === accountId)) {
      setAccountId(eligibleAccounts[0]?.id || '');
    }
  }, [eligibleAccounts, accountId]);

  useEffect(() => {
    if (!goals.some(g => g.id === goalId)) {
      setGoalId(goals[0]?.id || '');
    }
  }, [goals, goalId]);

  const account = eligibleAccounts.find(a => a.id === accountId);
  const available = account?.ownedAmount || 0;
  const requestedAmount = safeNumber(amount, 0);
  const withdrawAmount = Math.max(0, Math.min(requestedAmount, available));
  // Un retrait depuis un compte NON liquide (PEE, PER, Immobilier, contrat bloqué) ne
  // touche pas le pot liquide : l'ancien calcul le soustrayait quand même, produisant des
  // durées de survie négatives ("-2a -3m") pour de l'argent qui n'y était pas.
  const sourceIsLiquid = account ? isLiquid(account) : false;
  // Le plafonnement au montant possédé était silencieux : on le rend explicite,
  // car le capital des parents présent sur le compte n'est pas mobilisable.
  const isCapped = requestedAmount > available;
  const parentalCapital = account?.parentalCapital || 0;

  const totalFixed = useMemo(() => expenses.reduce((s, e) => s + e.amount, 0), [expenses]);

  const survival = useMemo(() => {
    const before = accounts.filter(isLiquid).reduce((s, a) => s + a.ownedAmount, 0);
    const after = Math.max(0, before - (sourceIsLiquid ? withdrawAmount : 0));
    const monthsBefore = totalFixed > 0 ? before / totalFixed : Infinity;
    const monthsAfter = totalFixed > 0 ? after / totalFixed : Infinity;
    return { before, after, monthsBefore, monthsAfter };
  }, [accounts, totalFixed, withdrawAmount, sourceIsLiquid]);

  const goal = goals.find(g => g.id === goalId);
  const goalImpact = useMemo(() => {
    if (!goal) return null;
    const before = goal.savedAmount;
    const after = Math.max(0, goal.savedAmount - withdrawAmount);
    // Borné à 100 comme sur l'écran Objectifs, pour ne pas afficher 140% ici et 100% là-bas.
    const pctBefore = goal.targetAmount > 0 ? Math.min(100, (before / goal.targetAmount) * 100) : 0;
    const pctAfter = goal.targetAmount > 0 ? Math.min(100, (after / goal.targetAmount) * 100) : 0;
    return { before, after, pctBefore, pctAfter };
  }, [goal, withdrawAmount]);

  const fmtMonths = (m: number) => {
    if (!isFinite(m)) return 'Infini';
    const clamped = Math.max(0, m); // jamais de "-2a -3m"
    const years = Math.floor(clamped / 12);
    const months = Math.floor(clamped % 12);
    return `${years > 0 ? years + 'a ' : ''}${months}m`;
  };

  return (
    <div className="space-y-6 animate-fade-in pb-20">
      <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm">
        <h2 className="text-2xl font-black text-slate-800 dark:text-slate-100 flex items-center gap-2 mb-1"><Calculator className="w-6 h-6 text-indigo-600" /> Simulateur de retrait</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">Teste l'impact d'un retrait avant de faire le virement réellement — rien n'est modifié ici.</p>
      </div>

      <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase">Compte source</label>
          <select value={accountId} onChange={e => setAccountId(e.target.value)} className="w-full p-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg font-bold text-slate-800 dark:text-slate-100">
            {eligibleAccounts.map(a => <option key={a.id} value={a.id}>{a.name} ({fmt(a.ownedAmount)})</option>)}
          </select>
        </div>
        <div>
          <label className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase">Montant à retirer (€)</label>
          <input type="text" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0" className="w-full p-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg font-bold text-slate-800 dark:text-slate-100" />
          {isCapped && (
            <p className="mt-2 flex items-start gap-1.5 text-[11px] font-bold text-amber-700 dark:text-amber-300">
              <Info className="w-3.5 h-3.5 flex-shrink-0 mt-px" />
              <span>
                Simulation ramenée à <b>{fmt(available)}</b>, le maximum disponible sur ce compte.
                {parentalCapital > 0 && <> Les <b>{fmt(parentalCapital)}</b> de capital parental présents dessus ne sont pas mobilisables.</>}
              </span>
            </p>
          )}
        </div>
      </div>

      {withdrawAmount > 0 && (
        <>
          <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm">
            <h3 className="font-black text-slate-800 dark:text-slate-100 mb-4 flex items-center gap-2"><Hourglass className="w-5 h-5 text-indigo-600" /> Impact sur ta durée de survie</h3>
            {!sourceIsLiquid && (
              <p className="mb-4 flex items-start gap-1.5 text-[11px] font-bold text-slate-500 dark:text-slate-400">
                <Info className="w-3.5 h-3.5 flex-shrink-0 mt-px" />
                Ce compte ne fait pas partie de ton épargne liquide : le retirer ne change pas ta durée de survie (qui ne compte que le liquide).
              </p>
            )}
            <div className="flex items-center gap-4 flex-wrap">
              <div className="text-center">
                <p className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase mb-1">Avant</p>
                <p className="text-2xl font-black text-slate-700 dark:text-slate-200">{fmtMonths(survival.monthsBefore)}</p>
                <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">{fmt(survival.before)}</p>
              </div>
              <ArrowRight className="w-5 h-5 text-slate-300" />
              <div className="text-center">
                <p className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase mb-1">Après retrait</p>
                <p className={`text-2xl font-black ${survival.monthsAfter < 3 ? 'text-rose-600' : survival.monthsAfter < 6 ? 'text-orange-500' : 'text-emerald-600'}`}>{fmtMonths(survival.monthsAfter)}</p>
                <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">{fmt(survival.after)}</p>
              </div>
            </div>
          </div>

          {goals.length > 0 && (
            <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm">
              <h3 className="font-black text-slate-800 dark:text-slate-100 mb-4 flex items-center gap-2"><Target className="w-5 h-5 text-indigo-600" /> Impact sur un objectif</h3>
              <select value={goalId} onChange={e => setGoalId(e.target.value)} className="w-full p-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg font-bold text-slate-800 dark:text-slate-100 mb-4">
                {goals.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
              {goalImpact && (
                <div className="flex items-center gap-4 flex-wrap">
                  <div className="text-center">
                    <p className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase mb-1">Avant</p>
                    <p className="text-xl font-black text-slate-700 dark:text-slate-200">{goalImpact.pctBefore.toFixed(0)}%</p>
                    <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">{fmt(goalImpact.before)}</p>
                  </div>
                  <ArrowRight className="w-5 h-5 text-slate-300" />
                  <div className="text-center">
                    <p className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase mb-1">Après retrait</p>
                    <p className="text-xl font-black text-rose-600">{goalImpact.pctAfter.toFixed(0)}%</p>
                    <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">{fmt(goalImpact.after)}</p>
                  </div>
                </div>
              )}
              <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-3">Ceci suppose que le retrait provient de l'épargne allouée à cet objectif — à ajuster mentalement si ce n'est pas le cas.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
};
