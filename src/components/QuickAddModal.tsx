// Ajout rapide d'un dépôt ou d'un retrait.
import React, { useEffect, useId, useRef, useState } from 'react';
import { lsGet, lsSet } from '../lib/storage';
import { SavingsAccount } from '../types';
import { X, Plus, ArrowUpCircle, ArrowDownCircle, Lightbulb } from 'lucide-react';
import { NumberInput } from './NumberInput';
import { localTodayISO, parseISODate } from '../lib/dates';
import { quinzaineWithdrawalTip } from '../lib/finance';
import { formatEUR, frenchDay } from '../lib/format';
import { Modal } from './Modal';
import { canWithdrawOwn } from '../lib/accountOps';

interface QuickAddModalProps {
  open: boolean;
  accounts: SavingsAccount[];
  onClose: () => void;
  onSubmit: (accountId: string, amount: number, type: 'IN' | 'OUT', label: string, date: string) => void;
}

const LAST_ACCOUNT_KEY = 'quickadd_last_account';
const SUGGESTIONS: Record<'IN' | 'OUT', string[]> = {
  IN: ['Virement de paie', 'Épargne du mois', 'Intérêts', 'Cadeau'],
  OUT: ['Retrait', 'Dépense imprévue', 'Projet'],
};

export const QuickAddModal: React.FC<QuickAddModalProps> = ({ open, accounts, onClose, onSubmit }) => {
  const [accountId, setAccountId] = useState('');
  const [amount, setAmount] = useState(0);
  const [type, setType] = useState<'IN' | 'OUT'>('IN');
  const [label, setLabel] = useState('');
  const [date, setDate] = useState(localTodayISO());
  const amountRef = useRef<HTMLInputElement>(null);
  const ids = { account: useId(), amount: useId(), label: useId(), date: useId(), error: useId() };

  // Chaque ouverture repart d'un formulaire propre, sur le dernier compte utilisé (les
  // comptes ont pu être créés depuis le montage).
  useEffect(() => {
    if (!open) return;
    const last = lsGet(LAST_ACCOUNT_KEY) || '';
    setAccountId(accounts.some(a => a.id === last) ? last : accounts[0]?.id || '');
    setAmount(0);
    setType('IN');
    setLabel('');
    setDate(localTodayISO());
  }, [open, accounts]);

  const account = accounts.find(a => a.id === accountId);
  const tip = open && type === 'OUT' && account ? quinzaineWithdrawalTip(account, amount, parseISODate(date)) : null;
  const since = parseISODate(date).getDate() < 16 ? '1er' : '16';
  const tooMuch = type === 'OUT' && !!account && amount > 0 && !canWithdrawOwn(account, amount);
  const canSubmit = !!accountId && amount > 0 && !tooMuch;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    lsSet(LAST_ACCOUNT_KEY, accountId);
    onSubmit(accountId, amount, type, label.trim() || (type === 'IN' ? 'Dépôt' : 'Retrait'), date);
    onClose();
  };

  const fieldClass = 'w-full p-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl font-bold text-slate-800 dark:text-slate-100';
  const labelClass = 'text-[11px] font-black text-slate-600 dark:text-slate-300 uppercase';

  return (
    <Modal open={open} onClose={onClose} label="Ajouter un mouvement" variant="sheet" className="max-w-sm p-6" initialFocusRef={amountRef}>
      <form onSubmit={submit}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-black text-slate-800 dark:text-slate-100 flex items-center gap-2"><Plus className="w-5 h-5 text-indigo-600" aria-hidden="true" /> Ajouter un mouvement</h2>
          <button type="button" onClick={onClose} aria-label="Fermer" className="p-2.5 -m-1.5 text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"><X className="w-5 h-5" /></button>
        </div>

        <div className="space-y-4">
          <div>
            <label htmlFor={ids.account} className={labelClass}>Compte</label>
            <select id={ids.account} value={accountId} onChange={e => setAccountId(e.target.value)} className={fieldClass}>
              {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>

          <div className="flex gap-2" role="group" aria-label="Sens du mouvement">
            <button type="button" aria-pressed={type === 'IN'} onClick={() => setType('IN')} className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm border-2 transition-colors ${type === 'IN' ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-500 text-emerald-800 dark:text-emerald-300' : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'}`}>
              <ArrowUpCircle className="w-4 h-4" aria-hidden="true" /> Dépôt
            </button>
            <button type="button" aria-pressed={type === 'OUT'} onClick={() => setType('OUT')} className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm border-2 transition-colors ${type === 'OUT' ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-500 text-rose-800 dark:text-rose-300' : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'}`}>
              <ArrowDownCircle className="w-4 h-4" aria-hidden="true" /> Retrait
            </button>
          </div>

          <div>
            <label htmlFor={ids.amount} className={labelClass}>Montant</label>
            <NumberInput id={ids.amount} inputRef={amountRef} value={amount} onChange={setAmount} suffix="€" className={`${fieldClass} font-black text-2xl`} min={0} describedBy={tooMuch ? ids.error : undefined} invalid={tooMuch} />
            {tooMuch && <p id={ids.error} role="alert" className="text-xs font-bold text-rose-700 dark:text-rose-300 mt-1">Votre part sur ce compte est de {formatEUR(account!.ownedAmount)} : la part de vos parents ne peut pas être retirée.</p>}
            {tip && <p className="text-xs font-bold text-amber-800 dark:text-amber-300 flex items-start gap-1 mt-1"><Lightbulb className="w-3.5 h-3.5 shrink-0" aria-hidden="true" /> <span>Retiré à cette date, ce montant ne rapporte déjà plus rien depuis le {since}. En attendant le {frenchDay(parseISODate(tip.waitUntil))}, vous gardez environ {formatEUR(tip.gain, 0)} d'intérêts.</span></p>}
          </div>

          <div>
            <label htmlFor={ids.label} className={labelClass}>Libellé (facultatif)</label>
            <input id={ids.label} value={label} onChange={e => setLabel(e.target.value)} placeholder={SUGGESTIONS[type][0]} className={`${fieldClass} text-sm`} />
            <div className="flex flex-wrap gap-1.5 mt-2">
              {SUGGESTIONS[type].map(sug => (
                <button key={sug} type="button" onClick={() => setLabel(sug)} className={`px-2.5 py-1 rounded-full text-xs font-bold border ${label === sug ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'}`}>{sug}</button>
              ))}
            </div>
          </div>

          <div>
            <label htmlFor={ids.date} className={labelClass}>Date</label>
            <input id={ids.date} type="date" value={date} onChange={e => setDate(e.target.value)} className={`${fieldClass} text-sm`} />
          </div>
        </div>

        <button type="submit" disabled={!canSubmit} className="w-full mt-6 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white py-3.5 rounded-xl font-bold">
          Ajouter
        </button>
      </form>
    </Modal>
  );
};
