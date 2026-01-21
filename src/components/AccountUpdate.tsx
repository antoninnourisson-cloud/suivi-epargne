import React, { useState } from 'react';
import { SavingsAccount } from '../types';
import { Button } from './Button';
import { Save, AlertCircle, TrendingUp, TrendingDown, RefreshCw, Calendar, User, Users } from 'lucide-react';

interface AccountUpdateProps {
  accounts: SavingsAccount[];
  onUpdateAccountsComplex: (updates: { account: SavingsAccount, date: string }[]) => void;
}

export const AccountUpdate: React.FC<AccountUpdateProps> = ({ accounts, onUpdateAccountsComplex }) => {
  const today = new Date().toISOString().split('T')[0];

  // Store update state per account
  const [updates, setUpdates] = useState<Record<string, { owned: string, parental: string, date: string }>>(
    accounts.reduce((acc, account) => ({ 
      ...acc, 
      [account.id]: { 
        owned: account.ownedAmount.toString(), 
        parental: account.parentalCapital.toString(), 
        date: today 
      } 
    }), {})
  );

  const handleOwnedChange = (id: string, val: string) => {
    setUpdates(prev => ({ ...prev, [id]: { ...prev[id], owned: val } }));
  };

  const handleParentalChange = (id: string, val: string) => {
    setUpdates(prev => ({ ...prev, [id]: { ...prev[id], parental: val } }));
  };

  const handleDateChange = (id: string, val: string) => {
    setUpdates(prev => ({ ...prev, [id]: { ...prev[id], date: val } }));
  };

  const handleSaveAll = () => {
    const payloads = accounts.map(account => {
      const u = updates[account.id];
      const newOwned = parseFloat(u.owned) || 0;
      const newParental = parseFloat(u.parental) || 0;
      
      const updatedAccount: SavingsAccount = {
        ...account,
        ownedAmount: newOwned,
        parentalCapital: newParental,
        totalAmount: newOwned + newParental
      };

      return { account: updatedAccount, date: u.date };
    });

    onUpdateAccountsComplex(payloads);
    alert("Tous les montants et historiques ont été actualisés avec succès !");
  };

  if (accounts.length === 0) {
    return (
      <div className="text-center py-20 bg-white rounded-xl shadow-sm border border-slate-200">
        <AlertCircle className="w-12 h-12 text-slate-300 mx-auto mb-3" />
        <h2 className="text-xl text-slate-600">Aucun compte à actualiser.</h2>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header Action */}
      <div className="bg-indigo-600 text-white p-6 rounded-2xl shadow-lg flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h3 className="text-xl font-bold flex items-center gap-2">
            <RefreshCw className="w-6 h-6" /> Actualisation Précise
          </h3>
          <p className="text-indigo-100 text-sm mt-1">
            Indiquez vos nouveaux soldes et la date du constat. Vos graphiques s'adapteront automatiquement.
          </p>
        </div>
        <Button onClick={handleSaveAll} className="bg-white text-indigo-600 hover:bg-indigo-50 border-none font-black px-8 py-3 shadow-xl">
          <Save className="w-5 h-5 mr-2" /> Tout Enregistrer
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {accounts.map(account => {
          const u = updates[account.id];
          const newTotal = (parseFloat(u.owned) || 0) + (parseFloat(u.parental) || 0);
          const diffOwned = (parseFloat(u.owned) || 0) - account.ownedAmount;
          const diffParental = (parseFloat(u.parental) || 0) - account.parentalCapital;
          const isChanged = diffOwned !== 0 || diffParental !== 0 || u.date !== today;

          return (
            <div key={account.id} className={`bg-white p-6 rounded-2xl border transition-all ${isChanged ? 'border-indigo-400 shadow-lg ring-1 ring-indigo-400/10' : 'border-slate-200 shadow-sm'}`}>
              <div className="flex justify-between items-start mb-6">
                <div>
                  <h4 className="font-black text-slate-900 text-lg leading-tight">{account.name}</h4>
                  <p className="text-xs text-slate-400 uppercase font-bold tracking-wider">{account.institution}</p>
                </div>
                <div className="text-right">
                  <div className="text-[10px] font-black text-slate-400 uppercase mb-1">Total Actuel</div>
                  <div className="text-xl font-black text-slate-800 font-mono">{newTotal.toFixed(2)}€</div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Part Personnelle */}
                <div className="bg-indigo-50/50 p-3 rounded-xl border border-indigo-100">
                  <label className="text-[10px] font-black text-indigo-700 uppercase tracking-widest flex items-center gap-1 mb-2">
                    <User className="w-3 h-3" /> Ma Part (€)
                  </label>
                  <input 
                    type="number"
                    step="0.01"
                    value={u.owned}
                    onChange={(e) => handleOwnedChange(account.id, e.target.value)}
                    className="w-full bg-transparent text-lg font-black text-indigo-900 outline-none"
                  />
                  {diffOwned !== 0 && (
                    <div className={`text-[10px] mt-1 font-bold ${diffOwned > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {diffOwned > 0 ? '+' : ''}{diffOwned.toFixed(2)}€
                    </div>
                  )}
                </div>

                {/* Part Parents */}
                <div className="bg-amber-50/50 p-3 rounded-xl border border-amber-100">
                  <label className="text-[10px] font-black text-amber-700 uppercase tracking-widest flex items-center gap-1 mb-2">
                    <Users className="w-3 h-3" /> Part Parents (€)
                  </label>
                  <input 
                    type="number"
                    step="0.01"
                    value={u.parental}
                    onChange={(e) => handleParentalChange(account.id, e.target.value)}
                    className="w-full bg-transparent text-lg font-black text-amber-900 outline-none"
                  />
                  {diffParental !== 0 && (
                    <div className={`text-[10px] mt-1 font-bold ${diffParental > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {diffParental > 0 ? '+' : ''}{diffParental.toFixed(2)}€
                    </div>
                  )}
                </div>

                {/* Date Input */}
                <div className="md:col-span-2 bg-slate-50 p-3 rounded-xl border border-slate-200 flex items-center gap-4">
                  <div className="bg-white p-2 rounded-lg border border-slate-200">
                    <Calendar className="w-4 h-4 text-slate-400" />
                  </div>
                  <div className="flex-1">
                    <label className="text-[10px] font-black text-slate-500 uppercase block">Date du relevé</label>
                    <input 
                      type="date"
                      value={u.date}
                      onChange={(e) => handleDateChange(account.id, e.target.value)}
                      className="w-full bg-transparent font-bold text-slate-700 outline-none text-sm"
                    />
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="bg-white p-8 rounded-2xl border border-slate-200 text-center shadow-sm">
        <p className="text-slate-500 text-sm mb-6 max-w-md mx-auto">
          En cliquant sur valider, les montants actuels seront mis à jour et de nouveaux points seront créés dans votre graphique d'évolution à la date indiquée.
        </p>
        <Button onClick={handleSaveAll} className="w-full md:w-auto px-16 py-4 text-lg">
          Valider les actualisations
        </Button>
      </div>
    </div>
  );
};
