// src/components/TransferManager.tsx
import React, { useState } from 'react';
import { SavingsAccount } from '../types';
import { Button } from './Button';
import { ArrowRightLeft, Download, Calendar, ArrowDown, CheckCircle } from 'lucide-react';

interface TransferManagerProps {
  accounts: SavingsAccount[];
  onUpdateAccountsComplex: (updates: { account: SavingsAccount, date: string }[]) => void;
  onLinkedTransfer: (sourceId: string, destId: string, amount: number, date: string) => void;
}

export const TransferManager: React.FC<TransferManagerProps> = ({ accounts, onUpdateAccountsComplex, onLinkedTransfer }) => {
  const today = new Date().toISOString().split('T')[0];
  const [activeTab, setActiveTab] = useState<'deposit' | 'transfer'>('deposit');
  const [opDate, setOpDate] = useState<string>(today);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Deposit State
  const [depositAccountId, setDepositAccountId] = useState<string>('');
  const [depositAmount, setDepositAmount] = useState<string>('');

  // Transfer State
  const [sourceAccountId, setSourceAccountId] = useState<string>('');
  const [destAccountId, setDestAccountId] = useState<string>('');
  const [transferAmount, setTransferAmount] = useState<string>('');

  const showSuccess = (msg: string) => {
      setSuccessMsg(msg);
      setTimeout(() => setSuccessMsg(null), 3000);
  };

  const handleDeposit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!depositAccountId || !depositAmount) return;

    const amount = parseFloat(depositAmount);
    if (isNaN(amount) || amount <= 0) return;

    const targetAcc = accounts.find(a => a.id === depositAccountId);
    if (!targetAcc) return;

    const updatedAcc: SavingsAccount = {
      ...targetAcc,
      totalAmount: targetAcc.totalAmount + amount,
      ownedAmount: targetAcc.ownedAmount + amount
    };

    onUpdateAccountsComplex([{ account: updatedAcc, date: opDate }]);
    setDepositAmount('');
    showSuccess("Dépôt enregistré avec succès !");
  };

  const handleTransfer = (e: React.FormEvent) => {
    e.preventDefault();
    if (!sourceAccountId || !destAccountId || !transferAmount) return;
    if (sourceAccountId === destAccountId) return;

    const amount = parseFloat(transferAmount);
    const sourceAcc = accounts.find(a => a.id === sourceAccountId);

    if (isNaN(amount) || amount <= 0 || !sourceAcc) return;

    if (sourceAcc.totalAmount < amount) {
        alert("Fonds insuffisants."); // Exception: ici alert ok car erreur blocante
        return;
    }

    onLinkedTransfer(sourceAccountId, destAccountId, amount, opDate);
    setTransferAmount('');
    showSuccess("Virement exécuté avec succès !");
  };

  if (accounts.length === 0) return null;

  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
      <div className="border-b border-slate-200 dark:border-slate-700 flex">
        <button onClick={() => setActiveTab('deposit')} className={`flex-1 py-4 text-sm font-black flex items-center justify-center gap-2 ${activeTab === 'deposit' ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border-b-2 border-emerald-600' : 'text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'}`}>
          <Download className="w-4 h-4" /> DÉPÔT
        </button>
        <button onClick={() => setActiveTab('transfer')} className={`flex-1 py-4 text-sm font-black flex items-center justify-center gap-2 ${activeTab === 'transfer' ? 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-400 border-b-2 border-indigo-600' : 'text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'}`}>
          <ArrowRightLeft className="w-4 h-4" /> VIREMENT
        </button>
      </div>

      <div className="p-6 max-w-lg mx-auto space-y-6">
        <div className="bg-slate-50 dark:bg-slate-900 p-3 rounded-xl border border-slate-200 dark:border-slate-700 flex items-center gap-4">
          <Calendar className="w-5 h-5 text-slate-400 dark:text-slate-500" />
          <div className="flex-1">
            <label className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase block">Date de l'opération</label>
            <input type="date" value={opDate} onChange={e => setOpDate(e.target.value)} className="w-full bg-transparent font-bold text-slate-700 dark:text-slate-200 outline-none" />
          </div>
        </div>

        {successMsg && (
            <div className="bg-emerald-100 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300 p-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2 animate-pulse">
                <CheckCircle className="w-4 h-4"/> {successMsg}
            </div>
        )}

        {activeTab === 'deposit' ? (
          <form onSubmit={handleDeposit} className="space-y-4">
            <select value={depositAccountId} onChange={e => setDepositAccountId(e.target.value)} className="w-full p-3 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 border border-slate-300 dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-emerald-500 font-bold" required>
              <option value="">Compte de destination</option>
              {accounts.map(acc => <option key={acc.id} value={acc.id}>{acc.name} ({acc.institution})</option>)}
            </select>
            <input type="number" step="0.01" value={depositAmount} onChange={e => setDepositAmount(e.target.value)} className="w-full p-4 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 border border-slate-300 dark:border-slate-700 rounded-lg text-2xl font-black" placeholder="0.00 €" required />
            <Button type="submit" className="w-full bg-emerald-600 py-4">Valider le dépôt</Button>
          </form>
        ) : (
          <form onSubmit={handleTransfer} className="space-y-4">
            <select value={sourceAccountId} onChange={e => setSourceAccountId(e.target.value)} className="w-full p-3 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 border border-slate-300 dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-indigo-500 font-bold" required>
              <option value="">Depuis</option>
              {accounts.map(acc => <option key={acc.id} value={acc.id} disabled={acc.id === destAccountId}>{acc.name}</option>)}
            </select>
            <div className="flex justify-center"><ArrowDown className="text-slate-300 dark:text-slate-600" /></div>
            <select value={destAccountId} onChange={e => setDestAccountId(e.target.value)} className="w-full p-3 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 border border-slate-300 dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-indigo-500 font-bold" required>
              <option value="">Vers</option>
              {accounts.map(acc => <option key={acc.id} value={acc.id} disabled={acc.id === sourceAccountId}>{acc.name}</option>)}
            </select>
            <input type="number" step="0.01" value={transferAmount} onChange={e => setTransferAmount(e.target.value)} className="w-full p-4 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 border border-slate-300 dark:border-slate-700 rounded-lg text-2xl font-black" placeholder="0.00 €" required />
            <Button type="submit" className="w-full py-4">Exécuter le virement</Button>
          </form>
        )}
      </div>
    </div>
  );
};