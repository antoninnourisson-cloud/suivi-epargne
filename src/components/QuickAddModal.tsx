import React, { useState } from 'react';
import { SavingsAccount } from '../types';
import { X, Zap, ArrowUpCircle, ArrowDownCircle } from 'lucide-react';
import { NumberInput } from './NumberInput';

interface QuickAddModalProps {
  open: boolean;
  accounts: SavingsAccount[];
  onClose: () => void;
  onSubmit: (accountId: string, amount: number, type: 'IN' | 'OUT', label: string, date: string) => void;
}

export const QuickAddModal: React.FC<QuickAddModalProps> = ({ open, accounts, onClose, onSubmit }) => {
  const [accountId, setAccountId] = useState(accounts[0]?.id || '');
  const [amount, setAmount] = useState(0);
  const [type, setType] = useState<'IN' | 'OUT'>('IN');
  const [label, setLabel] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);

  if (!open) return null;

  const submit = () => {
    if (!accountId || amount <= 0) return;
    onSubmit(accountId, amount, type, label || (type === 'IN' ? 'Dépôt rapide' : 'Retrait rapide'), date);
    setAmount(0);
    setLabel('');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/50 backdrop-blur-sm animate-fade-in" onClick={onClose}>
      <div className="bg-white dark:bg-slate-800 rounded-t-3xl sm:rounded-3xl shadow-2xl max-w-sm w-full p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-black text-slate-800 dark:text-slate-100 flex items-center gap-2"><Zap className="w-5 h-5 text-indigo-600" /> Ajout rapide</h3>
          <button onClick={onClose} className="p-1 text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200"><X className="w-5 h-5" /></button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase">Compte</label>
            <select value={accountId} onChange={e => setAccountId(e.target.value)} className="w-full p-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl font-bold text-slate-800 dark:text-slate-100">
              {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>

          <div className="flex gap-2">
            <button onClick={() => setType('IN')} className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm border-2 transition-colors ${type === 'IN' ? 'bg-emerald-50 border-emerald-400 text-emerald-700' : 'border-slate-200 dark:border-slate-700 text-slate-400 dark:text-slate-500'}`}>
              <ArrowUpCircle className="w-4 h-4" /> Dépôt
            </button>
            <button onClick={() => setType('OUT')} className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm border-2 transition-colors ${type === 'OUT' ? 'bg-rose-50 border-rose-400 text-rose-700' : 'border-slate-200 dark:border-slate-700 text-slate-400 dark:text-slate-500'}`}>
              <ArrowDownCircle className="w-4 h-4" /> Retrait
            </button>
          </div>

          <div>
            <label className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase">Montant (€)</label>
            <NumberInput value={amount} onChange={setAmount} className="w-full p-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl font-black text-2xl text-slate-800 dark:text-slate-100" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase">Libellé (optionnel)</label>
              <input value={label} onChange={e => setLabel(e.target.value)} placeholder="Ex : Virement" className="w-full p-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl font-bold text-slate-800 dark:text-slate-100 text-sm" />
            </div>
            <div>
              <label className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase">Date</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-full p-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl font-bold text-slate-800 dark:text-slate-100 text-sm" />
            </div>
          </div>
        </div>

        <button
          onClick={submit}
          disabled={!accountId || amount <= 0}
          className="w-full mt-6 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white py-3.5 rounded-xl font-bold"
        >
          Ajouter
        </button>
      </div>
    </div>
  );
};
