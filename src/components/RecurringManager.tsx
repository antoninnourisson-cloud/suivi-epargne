// ================================================
// FILE: src/components/RecurringManager.tsx
// Déclaration des versements/retraits qui reviennent chaque mois. Rien n'est jamais écrit
// automatiquement : le Dashboard PROPOSE l'écriture à l'échéance (voir findDueRecurring),
// l'utilisateur confirme d'un clic.
// ================================================
import React, { useState } from 'react';
import { SavingsAccount, RecurringMovement } from '../types';
import { Repeat, Plus, Trash2, AlertCircle, Pause, Play } from 'lucide-react';
import { safeNumber } from '../lib/numbers';

interface RecurringManagerProps {
  accounts: SavingsAccount[];
  recurringMovements: RecurringMovement[];
  onUpdate: (next: RecurringMovement[]) => void;
}

const fmt = (n: number) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }).format(n);

export const RecurringManager: React.FC<RecurringManagerProps> = ({ accounts, recurringMovements, onUpdate }) => {
  const [accountId, setAccountId] = useState('');
  const [amount, setAmount] = useState('');
  const [type, setType] = useState<'IN' | 'OUT'>('IN');
  const [label, setLabel] = useState('');
  const [day, setDay] = useState('5');
  const [error, setError] = useState<string | null>(null);

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!accountId) { setError('Choisis un compte.'); return; }
    const value = safeNumber(amount, 0);
    if (value <= 0) { setError('Saisis un montant supérieur à 0.'); return; }
    const dayOfMonth = Math.round(safeNumber(day, 0));
    if (dayOfMonth < 1 || dayOfMonth > 31) { setError('Le jour doit être compris entre 1 et 31.'); return; }
    const next: RecurringMovement = {
      id: crypto.randomUUID(),
      accountId, amount: value, type, dayOfMonth, active: true,
      label: label.trim() || (type === 'IN' ? 'Versement mensuel' : 'Retrait mensuel'),
    };
    onUpdate([...recurringMovements, next]);
    setAmount(''); setLabel('');
  };

  const toggle = (id: string) => onUpdate(recurringMovements.map(r => r.id === id ? { ...r, active: !r.active } : r));
  const remove = (id: string) => onUpdate(recurringMovements.filter(r => r.id !== id));

  const accountName = (id: string) => accounts.find(a => a.id === id)?.name;
  const inputClass = 'w-full p-3 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 border border-slate-300 dark:border-slate-700 rounded-lg font-bold';

  return (
    <div className="space-y-6">
      <p className="text-xs text-slate-500 dark:text-slate-400 flex items-start gap-2">
        <Repeat className="w-4 h-4 flex-shrink-0 mt-px text-indigo-500" />
        À l'échéance, le tableau de bord te proposera d'enregistrer le mouvement en un clic. Rien n'est jamais ajouté sans ta confirmation.
      </p>

      {recurringMovements.length > 0 && (
        <ul className="space-y-2">
          {recurringMovements.map(r => {
            const name = accountName(r.accountId);
            return (
              <li key={r.id} className={`flex items-center gap-3 p-3 rounded-xl border ${r.active ? 'border-slate-200 dark:border-slate-700' : 'border-dashed border-slate-300 dark:border-slate-700 opacity-60'}`}>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-slate-800 dark:text-slate-100 text-sm truncate">
                    <span className={r.type === 'IN' ? 'text-emerald-600' : 'text-rose-600'}>{r.type === 'IN' ? '+' : '-'}{fmt(r.amount)}</span>
                    {' · '}{r.label}
                  </p>
                  <p className="text-[11px] text-slate-400 dark:text-slate-500 font-bold">
                    le {r.dayOfMonth} du mois · {name ?? <span className="text-rose-500">compte supprimé</span>}
                    {!r.active && ' · en pause'}
                  </p>
                </div>
                <button type="button" onClick={() => toggle(r.id)} aria-label={r.active ? 'Mettre en pause' : 'Réactiver'} className="p-2.5 text-slate-400 hover:text-indigo-600 rounded-lg">
                  {r.active ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                </button>
                <button type="button" onClick={() => remove(r.id)} aria-label={`Supprimer ${r.label}`} className="p-2.5 text-slate-400 hover:text-rose-500 rounded-lg">
                  <Trash2 className="w-4 h-4" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <form onSubmit={add} className="space-y-3 border-t border-slate-100 dark:border-slate-800 pt-4">
        <p className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase">Nouvelle échéance</p>
        <select value={accountId} onChange={e => setAccountId(e.target.value)} className={inputClass}>
          <option value="">Compte</option>
          {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <div className="flex gap-2">
          <button type="button" onClick={() => setType('IN')} className={`flex-1 py-2.5 rounded-lg text-sm font-bold border-2 ${type === 'IN' ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-400 text-emerald-700 dark:text-emerald-300' : 'border-slate-200 dark:border-slate-700 text-slate-400'}`}>Versement</button>
          <button type="button" onClick={() => setType('OUT')} className={`flex-1 py-2.5 rounded-lg text-sm font-bold border-2 ${type === 'OUT' ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-400 text-rose-700 dark:text-rose-300' : 'border-slate-200 dark:border-slate-700 text-slate-400'}`}>Retrait</button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <input type="text" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder="Montant (€)" className={inputClass} />
          <input type="text" inputMode="numeric" value={day} onChange={e => setDay(e.target.value)} placeholder="Jour (1-31)" aria-label="Jour du mois" className={inputClass} />
        </div>
        <input type="text" value={label} onChange={e => setLabel(e.target.value)} placeholder="Libellé (optionnel)" className={inputClass} />
        {error && (
          <p className="text-sm font-bold text-rose-700 dark:text-rose-300 flex items-center gap-2"><AlertCircle className="w-4 h-4" /> {error}</p>
        )}
        <button type="submit" className="w-full py-3 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-bold flex items-center justify-center gap-2">
          <Plus className="w-4 h-4" /> Ajouter l'échéance
        </button>
      </form>
    </div>
  );
};
