import React, { useState } from 'react';
import { SavingsAccount } from '../types';
import { Button } from './Button';
import { ArrowRightLeft, Download, Wallet, AlertCircle, ArrowDown, Calendar } from 'lucide-react';

interface TransferManagerProps {
  accounts: SavingsAccount[];
  onUpdateAccountsComplex: (updates: { account: SavingsAccount, date: string }[]) => void;
}

export const TransferManager: React.FC<TransferManagerProps> = ({ accounts, onUpdateAccountsComplex }) => {
  const today = new Date().toISOString().split('T')[0];
  const [activeTab, setActiveTab] = useState<'deposit' | 'transfer'>('deposit');
  const [opDate, setOpDate] = useState<string>(today);
  
  // Deposit State
  const [depositAccountId, setDepositAccountId] = useState<string>('');
  const [depositAmount, setDepositAmount] = useState<string>('');

  // Transfer State
  const [sourceAccountId, setSourceAccountId] = useState<string>('');
  const [destAccountId, setDestAccountId] = useState<string>('');
  const [transferAmount, setTransferAmount] = useState<string>('');

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
    alert("Dépôt enregistré !");
  };

  const handleTransfer = (e: React.FormEvent) => {
    e.preventDefault();
    if (!sourceAccountId || !destAccountId || !transferAmount) return;
    if (sourceAccountId === destAccountId) return;

    const amount = parseFloat(transferAmount);
    const sourceAcc = accounts.find(a => a.id === sourceAccountId);
    const destAcc = accounts.find(a => a.id === destAccountId);

    if (isNaN(amount) || amount <= 0 || !sourceAcc || !destAcc) return;
    if (sourceAcc.totalAmount < amount) {
        alert("Fonds insuffisants.");
        return;
    }

    const updatedSource: SavingsAccount = {
      ...sourceAcc,
      totalAmount: sourceAcc.totalAmount - amount,
      ownedAmount: Math.max(0, sourceAcc.ownedAmount - amount)
    };

    const updatedDest: SavingsAccount = {
      ...destAcc,
      totalAmount: destAcc.totalAmount + amount,
      ownedAmount: destAcc.ownedAmount + amount
    };

    onUpdateAccountsComplex([
      { account: updatedSource, date: opDate },
      { account: updatedDest, date: opDate }
    ]);
    
    setTransferAmount('');
    alert("Virement enregistré !");
  };

  if (accounts.length === 0) return null;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
      <div className="border-b border-slate-200 flex">
        <button onClick={() => setActiveTab('deposit')} className={`flex-1 py-4 text-sm font-black flex items-center justify-center gap-2 ${activeTab === 'deposit' ? 'bg-emerald-50 text-emerald-700 border-b-2 border-emerald-600' : 'text-slate-500 hover:bg-slate-50'}`}>
          <Download className="w-4 h-4" /> DÉPÔT
        </button>
        <button onClick={() => setActiveTab('transfer')} className={`flex-1 py-4 text-sm font-black flex items-center justify-center gap-2 ${activeTab === 'transfer' ? 'bg-indigo-50 text-indigo-700 border-b-2 border-indigo-600' : 'text-slate-500 hover:bg-slate-50'}`}>
          <ArrowRightLeft className="w-4 h-4" /> VIREMENT
        </button>
      </div>

      <div className="p-6 max-w-lg mx-auto space-y-6">
        {/* Champ Date Partagé */}
        <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 flex items-center gap-4">
          <Calendar className="w-5 h-5 text-slate-400" />
          <div className="flex-1">
            <label className="text-[10px] font-black text-slate-500 uppercase block">Date de l'opération</label>
            <input type="date" value={opDate} onChange={e => setOpDate(e.target.value)} className="w-full bg-transparent font-bold text-slate-700 outline-none" />
          </div>
        </div>

        {activeTab === 'deposit' ? (
          <form onSubmit={handleDeposit} className="space-y-4">
            <select value={depositAccountId} onChange={e => setDepositAccountId(e.target.value)} className="w-full p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 font-bold" required>
              <option value="">Compte de destination</option>
              {accounts.map(acc => <option key={acc.id} value={acc.id}>{acc.name} ({acc.institution})</option>)}
            </select>
            <input type="number" step="0.01" value={depositAmount} onChange={e => setDepositAmount(e.target.value)} className="w-full p-4 border border-slate-300 rounded-lg text-2xl font-black" placeholder="0.00 €" required />
            <Button type="submit" className="w-full bg-emerald-600 py-4">Valider le dépôt</Button>
          </form>
        ) : (
          <form onSubmit={handleTransfer} className="space-y-4">
            <select value={sourceAccountId} onChange={e => setSourceAccountId(e.target.value)} className="w-full p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 font-bold" required>
              <option value="">Depuis</option>
              {accounts.map(acc => <option key={acc.id} value={acc.id} disabled={acc.id === destAccountId}>{acc.name}</option>)}
            </select>
            <div className="flex justify-center"><ArrowDown className="text-slate-300" /></div>
            <select value={destAccountId} onChange={e => setDestAccountId(e.target.value)} className="w-full p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 font-bold" required>
              <option value="">Vers</option>
              {accounts.map(acc => <option key={acc.id} value={acc.id} disabled={acc.id === sourceAccountId}>{acc.name}</option>)}
            </select>
            <input type="number" step="0.01" value={transferAmount} onChange={e => setTransferAmount(e.target.value)} className="w-full p-4 border border-slate-300 rounded-lg text-2xl font-black" placeholder="0.00 €" required />
            <Button type="submit" className="w-full py-4">Exécuter le virement</Button>
          </form>
        )}
      </div>
    </div>
  );
};
