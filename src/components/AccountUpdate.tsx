// src/components/AccountUpdate.tsx
import React, { useState } from 'react';
import { SavingsAccount } from '../types';
import { Button } from './Button';
import { Save, AlertCircle, RefreshCw, Calendar, User, Users, CheckCircle } from 'lucide-react';
import { useSaveFeedback } from '../hooks/useSaveFeedback';
import { safeNumber, parseFrenchNumber } from '../lib/numbers';
import { tracksDeposits, depositsAfterWithdrawal } from '../lib/finance';
import { localTodayISO } from '../lib/dates';
import { formatEUR, formatSignedEUR } from '../lib/format';

interface AccountUpdateProps {
  accounts: SavingsAccount[];
  onUpdateAccountsComplex: (updates: { account: SavingsAccount, date: string, cashFlow?: number }[]) => void;
  onCancel?: () => void; // Ajout prop optionnelle pour cohérence
  // Horodatage de la dernière écriture Drive CONFIRMÉE : sert à n'annoncer le succès que
  // lorsqu'il est réel (voir useSaveFeedback).
  lastSavedAt?: Date | null;
}

export const AccountUpdate: React.FC<AccountUpdateProps> = ({ accounts, onUpdateAccountsComplex, lastSavedAt }) => {
  const today = localTodayISO();
  const { status: saveStatus, markPending } = useSaveFeedback(lastSavedAt);

  // `deposits` : versements cumulés des placements (PEA, AV…), '' = inconnus.
  // `cashFlow` : argent réellement versé/retiré via l'ajustement rapide, pour distinguer
  // un versement d'une simple variation de valeur à l'enregistrement.
  type Draft = { owned: string, parental: string, date: string, deposits: string, cashFlow: number, bankTotal?: string };
  const [updates, setUpdates] = useState<Record<string, Draft>>(
    accounts.reduce((acc, account) => ({ 
      ...acc, 
      [account.id]: { 
        owned: account.ownedAmount.toString(), 
        parental: account.parentalCapital.toString(), 
        date: today,
        deposits: account.totalDeposits !== undefined ? String(account.totalDeposits) : '',
        cashFlow: 0,
      } 
    }), {})
  );

  const handleOwnedChange = (id: string, val: string) => {
    setUpdates(prev => ({ ...prev, [id]: { ...prev[id], owned: val, bankTotal: undefined } }));
  };

  const handleParentalChange = (id: string, val: string) => {
    setUpdates(prev => ({ ...prev, [id]: { ...prev[id], parental: val, bankTotal: undefined } }));
  };

  const handleDepositsChange = (id: string, val: string) => {
    setUpdates(prev => ({ ...prev, [id]: { ...prev[id], deposits: val } }));
  };
  const parseDeposits = (val: string): number | undefined | null =>
    val.trim() === '' ? undefined : parseFrenchNumber(val);

  const handleDateChange = (id: string, val: string) => {
    setUpdates(prev => ({ ...prev, [id]: { ...prev[id], date: val } }));
  };

  // --- AJUSTEMENT RAPIDE : « +/- x € sur ma part / celle des parents » ---
  // Évite de recalculer soi-même le nouveau solde : l'écart est appliqué au montant en
  // cours de saisie (et donc cumulable), puis enregistré avec le reste via « Tout
  // Enregistrer ». Les pastilles d'écart existantes montrent le résultat avant validation.
  // `isCash` (placements suivis) : l'ajustement est un versement/retrait d'argent, pas un
  // gain ou une perte de valeur — il met alors à jour les versements cumulés.
  type Adjust = { sign: 1 | -1; amount: string; target: 'owned' | 'parental'; isCash: boolean };
  const [adjusts, setAdjusts] = useState<Record<string, Adjust>>({});
  const [adjustErrors, setAdjustErrors] = useState<Record<string, string | null>>({});
  const DEFAULT_ADJUST: Adjust = { sign: 1, amount: '', target: 'owned', isCash: true };
  const adjustFor = (id: string): Adjust => adjusts[id] ?? DEFAULT_ADJUST;
  const patchAdjust = (id: string, patch: Partial<Adjust>) => {
    // Fusion sur l'état le plus RÉCENT (`prev`), pas sur celui du rendu courant : deux
    // clics rapprochés (« − » puis « Parents ») s'écrasaient sinon l'un l'autre.
    setAdjusts(prev => ({ ...prev, [id]: { ...(prev[id] ?? DEFAULT_ADJUST), ...patch } }));
    setAdjustErrors(prev => ({ ...prev, [id]: null }));
  };

  const applyAdjust = (id: string) => {
    const a = adjustFor(id);
    const amount = safeNumber(a.amount, 0);
    if (amount <= 0) { setAdjustErrors(prev => ({ ...prev, [id]: 'Saisissez un montant supérieur à 0.' })); return; }
    const current = safeNumber(updates[id][a.target], 0);
    const next = Math.round((current + a.sign * amount) * 100) / 100;
    if (next < 0) {
      setAdjustErrors(prev => ({ ...prev, [id]: `Impossible : ${a.target === 'owned' ? 'votre part' : 'la part des parents'} deviendrait négative (${formatEUR(next)}).` }));
      return;
    }
    const account = accounts.find(acc => acc.id === id);
    const draft = updates[id];
    const deposits = parseDeposits(draft.deposits);
    const tracksCash = !!account && tracksDeposits(account.type) && typeof deposits === 'number' && a.isCash && a.target === 'owned';
    const valueBefore = safeNumber(draft.owned, 0) + safeNumber(draft.parental, 0);
    setUpdates(prev => ({
      ...prev,
      [id]: {
        ...prev[id],
        [a.target]: String(next),
        ...(tracksCash ? {
          cashFlow: prev[id].cashFlow + a.sign * amount,
          deposits: String(Math.round((a.sign > 0 ? deposits + amount : depositsAfterWithdrawal(deposits, valueBefore, amount)) * 100) / 100),
        } : {}),
      },
    }));
    patchAdjust(id, { amount: '' });
  };

  const changedCount = accounts.filter(account => {
    const u = updates[account.id];
    if (!u) return false;
    const deposits = parseDeposits(u.deposits);
    return Math.abs(safeNumber(u.owned, 0) - account.ownedAmount) > 0.004
      || Math.abs(safeNumber(u.parental, 0) - account.parentalCapital) > 0.004
      || (tracksDeposits(account.type) && deposits !== null && deposits !== account.totalDeposits);
  }).length;

  // Saisie directe du total affiché par la banque : la part propre en est déduite, le
  // capital parental (qui ne bouge pas) restant tel quel.
  const handleBankTotalChange = (id: string, val: string) => {
    setUpdates(prev => {
      const u = prev[id];
      const total = parseFrenchNumber(val);
      const parental = safeNumber(u.parental, 0);
      // Total inférieur à la part des parents : saisie incohérente, la part propre n'est
      // pas touchée (message sous le champ).
      const owned = total === null || total < parental ? u.owned : String(Math.round((total - parental) * 100) / 100);
      return { ...prev, [id]: { ...u, bankTotal: val, owned } };
    });
  };

  const handleSaveAll = () => {
    const payloads = accounts.map(account => {
      const u = updates[account.id];
      const newOwned = safeNumber(u.owned, 0);
      const newParental = safeNumber(u.parental, 0);
      const deposits = parseDeposits(u.deposits);
      const updatedAccount: SavingsAccount = {
        ...account,
        ownedAmount: newOwned,
        parentalCapital: newParental,
        totalAmount: newOwned + newParental,
        // Saisie illisible : on garde la valeur connue plutôt que de l'effacer.
        totalDeposits: tracksDeposits(account.type)
          ? (deposits === null ? account.totalDeposits : deposits !== undefined && deposits >= 0 ? deposits : undefined)
          : account.totalDeposits,
      };
      return { account: updatedAccount, date: u.date, cashFlow: u.cashFlow || undefined };
    });

    markPending();
    onUpdateAccountsComplex(payloads);
  };

  if (accounts.length === 0) {
    return (
      <div className="text-center py-20 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
        <AlertCircle className="w-12 h-12 text-slate-300 mx-auto mb-3" />
        <h2 className="text-xl text-slate-600 dark:text-slate-300">Aucun compte à actualiser.</h2>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header Action */}
      <div className="bg-indigo-600 text-white p-6 rounded-2xl shadow-lg flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h3 className="text-xl font-bold flex items-center gap-2">
            <RefreshCw className="w-6 h-6" /> Actualiser les soldes
          </h3>
          <p className="text-indigo-100 text-sm mt-1">
            Indiquez vos nouveaux soldes et la date du constat. Vos graphiques s'adapteront automatiquement.
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
             <Button onClick={handleSaveAll} isLoading={saveStatus === 'pending'} className="!bg-white dark:!bg-slate-800 !text-indigo-600 dark:!text-indigo-300 hover:!bg-indigo-50 dark:hover:!bg-slate-700 border-none font-black px-8 py-3 shadow-xl">
                <Save className="w-5 h-5 mr-2" /> Tout enregistrer
            </Button>
            {saveStatus === 'saved' && <span className="text-emerald-300 font-bold text-sm flex items-center gap-1"><CheckCircle className="w-4 h-4"/> Enregistré sur Drive</span>}
        </div>
       
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {accounts.map(account => {
          const u = updates[account.id];
          const newTotal = safeNumber(u.owned, 0) + safeNumber(u.parental, 0);
          const diffOwned = Math.round((safeNumber(u.owned, 0) - account.ownedAmount) * 100) / 100;
          const diffParental = Math.round((safeNumber(u.parental, 0) - account.parentalCapital) * 100) / 100;
          const depositsDraft = parseDeposits(u.deposits);
          const depositsChanged = tracksDeposits(account.type) && depositsDraft !== null && depositsDraft !== account.totalDeposits;
          const isChanged = diffOwned !== 0 || diffParental !== 0 || u.date !== today || depositsChanged;

          return (
            <div key={account.id} className={`bg-white dark:bg-slate-800 p-6 rounded-2xl border transition-all ${isChanged ? 'border-indigo-400 shadow-lg ring-1 ring-indigo-400/10' : 'border-slate-200 dark:border-slate-700 shadow-sm'}`}>
              <div className="flex justify-between items-start mb-6">
                <div>
                  <h4 className="font-black text-slate-900 dark:text-slate-100 text-lg leading-tight">{account.name}</h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400 uppercase font-bold tracking-wider">{account.institution}</p>
                </div>
                <div className="text-right">
                  <div className="text-[11px] font-black text-slate-500 dark:text-slate-400 uppercase mb-1">Total actuel</div>
                  <div className="text-xl font-black text-slate-800 dark:text-slate-100 font-mono">{formatEUR(newTotal, 2)}</div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Part Personnelle */}
                <div className="bg-indigo-50 dark:bg-indigo-950/40 p-3 rounded-xl border border-indigo-100 dark:border-indigo-900">
                  <label className="text-[11px] font-black text-indigo-700 dark:text-indigo-300 uppercase tracking-widest flex items-center gap-1 mb-2">
                    <User className="w-3 h-3" /> Ma part (€)
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={u.owned}
                    onChange={(e) => handleOwnedChange(account.id, e.target.value)}
                    className="w-full bg-transparent text-lg font-black text-indigo-900 dark:text-indigo-200 outline-none"
                  />
                  {diffOwned !== 0 && (
                    <div className={`text-[11px] mt-1 font-bold ${diffOwned > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {formatSignedEUR(diffOwned, 2)}
                    </div>
                  )}
                </div>

                {/* Part des parents */}
                <div className="bg-amber-50 dark:bg-amber-950/40 p-3 rounded-xl border border-amber-100 dark:border-amber-900">
                  <label className="text-[11px] font-black text-amber-700 dark:text-amber-300 uppercase tracking-widest flex items-center gap-1 mb-2">
                    <Users className="w-3 h-3" /> Part des parents (€)
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={u.parental}
                    onChange={(e) => handleParentalChange(account.id, e.target.value)}
                    className="w-full bg-transparent text-lg font-black text-amber-900 dark:text-amber-200 outline-none"
                  />
                  {diffParental !== 0 && (
                    <div className={`text-[11px] mt-1 font-bold ${diffParental > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {formatSignedEUR(diffParental, 2)}
                    </div>
                  )}
                </div>

                {safeNumber(u.parental, 0) > 0 && (
                  <div className="md:col-span-2 bg-slate-50 dark:bg-slate-900 p-3 rounded-xl border border-slate-200 dark:border-slate-700">
                    <label className="text-[11px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest block mb-1">Total affiché par la banque (€)</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={u.bankTotal ?? String(Math.round(newTotal * 100) / 100).replace('.', ',')}
                      onChange={(e) => handleBankTotalChange(account.id, e.target.value)}
                      className="w-full bg-transparent text-lg font-black text-slate-800 dark:text-slate-100 outline-none"
                    />
                    {u.bankTotal !== undefined && (parseFrenchNumber(u.bankTotal) ?? Infinity) < safeNumber(u.parental, 0)
                      ? <p className="text-[11px] font-bold text-rose-600">Ce total est inférieur à la part de vos parents ({formatEUR(safeNumber(u.parental, 0))}) : vérifiez la saisie.</p>
                      : <p className="text-[11px] text-slate-500 dark:text-slate-400">Saisissez le solde de l'app bancaire : votre part est recalculée, celle de vos parents ne change pas.</p>}
                  </div>
                )}

                {/* Ajustement rapide */}
                {(() => {
                  const a = adjustFor(account.id);
                  const seg = (active: boolean, activeClass: string) =>
                    `px-3 py-2 text-xs font-black transition-colors ${active ? activeClass : 'bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:text-slate-600'}`;
                  return (
                    <div className="md:col-span-2 p-3 rounded-xl border border-dashed border-slate-300 dark:border-slate-600">
                      <label className="text-[11px] font-black text-slate-500 dark:text-slate-400 uppercase block mb-2">Ajuster d'un montant</label>
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="flex rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700" role="group" aria-label="Sens">
                          <button type="button" onClick={() => patchAdjust(account.id, { sign: 1 })} aria-pressed={a.sign === 1} className={seg(a.sign === 1, 'bg-emerald-600 text-white')}>+</button>
                          <button type="button" onClick={() => patchAdjust(account.id, { sign: -1 })} aria-pressed={a.sign === -1} className={seg(a.sign === -1, 'bg-rose-600 text-white')}>−</button>
                        </div>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={a.amount}
                          onChange={e => patchAdjust(account.id, { amount: e.target.value })}
                          onKeyDown={e => { if (e.key === 'Enter') applyAdjust(account.id); }}
                          placeholder="0,00"
                          aria-label="Montant de l'ajustement"
                          className="w-24 p-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg font-bold text-slate-800 dark:text-slate-100 text-sm"
                        />
                        <span className="text-xs font-bold text-slate-500 dark:text-slate-400">€ sur</span>
                        <div className="flex rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700" role="group" aria-label="Part concernée">
                          <button type="button" onClick={() => patchAdjust(account.id, { target: 'owned' })} aria-pressed={a.target === 'owned'} className={seg(a.target === 'owned', 'bg-indigo-600 text-white')}>Ma part</button>
                          <button type="button" onClick={() => patchAdjust(account.id, { target: 'parental' })} aria-pressed={a.target === 'parental'} className={seg(a.target === 'parental', 'bg-amber-500 text-white')}>Parents</button>
                        </div>
                        {tracksDeposits(account.type) && typeof depositsDraft === 'number' && a.target === 'owned' && (
                          <label className="flex items-center gap-1.5 text-xs font-bold text-slate-500 dark:text-slate-400">
                            <input type="checkbox" checked={a.isCash} onChange={e => patchAdjust(account.id, { isCash: e.target.checked })} />
                            {a.sign > 0 ? 'Versement' : 'Retrait'} d'argent
                          </label>
                        )}
                        <button type="button" onClick={() => applyAdjust(account.id)} className="px-3 py-2 rounded-lg bg-slate-800 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-black hover:opacity-90">Appliquer</button>
                      </div>
                      {adjustErrors[account.id] && (
                        <p className="mt-2 text-[11px] font-bold text-rose-600 dark:text-rose-400">{adjustErrors[account.id]}</p>
                      )}
                    </div>
                  );
                })()}

                {tracksDeposits(account.type) && (
                  <div className="md:col-span-2 bg-slate-50 dark:bg-slate-900 p-3 rounded-xl border border-slate-200 dark:border-slate-700">
                    <label className="text-[11px] font-black text-slate-500 dark:text-slate-400 uppercase block mb-1">Versements cumulés (€)</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={u.deposits}
                      onChange={(e) => handleDepositsChange(account.id, e.target.value)}
                      placeholder="Inconnu"
                      className="w-full bg-transparent font-bold text-slate-700 dark:text-slate-200 outline-none text-sm"
                    />
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                      {depositsDraft === null ? 'Montant non reconnu.'
                        : depositsDraft === undefined ? 'Renseignez-les une fois : ensuite, les versements cochés ci-dessus les mettent à jour, et le reste de l’écart compte comme gain ou perte de valeur.'
                        : <>Plus-value latente : <b>{formatEUR(newTotal - depositsDraft, 0)}</b></>}
                    </p>
                  </div>
                )}

                {/* Date Input */}
                <div className="md:col-span-2 bg-slate-50 dark:bg-slate-900 p-3 rounded-xl border border-slate-200 dark:border-slate-700 flex items-center gap-4">
                  <div className="bg-white dark:bg-slate-800 p-2 rounded-lg border border-slate-200 dark:border-slate-700">
                    <Calendar className="w-4 h-4 text-slate-500 dark:text-slate-400" />
                  </div>
                  <div className="flex-1">
                    <label className="text-[11px] font-black text-slate-500 dark:text-slate-400 uppercase block">Date du relevé</label>
                    <input 
                      type="date"
                      value={u.date}
                      onChange={(e) => handleDateChange(account.id, e.target.value)}
                      className="w-full bg-transparent font-bold text-slate-700 dark:text-slate-200 outline-none text-sm"
                    />
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {changedCount > 0 && (
        <div className="fixed left-4 right-4 bottom-20 md:bottom-6 md:left-auto md:right-8 md:w-96 z-30 flex items-center justify-between gap-3 p-3 pl-4 rounded-2xl bg-slate-900 text-white shadow-2xl dark:bg-slate-100 dark:text-slate-900">
          <span className="text-sm font-bold">{changedCount} compte{changedCount > 1 ? 's' : ''} modifié{changedCount > 1 ? 's' : ''}</span>
          <Button onClick={handleSaveAll} isLoading={saveStatus === 'pending'} className="gap-2 px-5">
            <Save className="w-4 h-4" /> Enregistrer
          </Button>
        </div>
      )}
      {changedCount > 0 && <div className="h-16" aria-hidden />}
    </div>
  );
};