// Écran « Mes comptes » : liste, filtres par étiquette, mouvements de chaque compte,
// création et modification. Sorti d'App.tsx pour qu'App ne fasse plus que router.
import React, { useMemo, useState } from 'react';
import { AccountMovement, AccountType, SavingsAccount } from '../types';
import { usePortfolioData } from '../hooks/usePortfolioData';
import type { View } from '../navigation';
import { AccountForm } from './AccountForm';
import { MovementSearch } from './MovementSearch';
import { RegulatedRatesEditor } from './RegulatedRatesEditor';
import { AccountTotal } from './AccountTotal';
import { computeMaturityCountdown } from '../lib/finance';
import { isRestitutionMovement } from '../lib/accountOps';
import { formatEUR, formatSignedEUR } from '../lib/format';
import { PlusCircle, Edit2, Trash2, Clock, ChevronDown, Tag } from 'lucide-react';
import { signedAmount } from '../lib/money';

interface AccountsViewProps {
  data: ReturnType<typeof usePortfolioData>;
  setView: (v: View) => void;
  editingAccount: SavingsAccount | undefined;
  setEditingAccount: (a: SavingsAccount | undefined) => void;
  showForm: boolean;
  setShowForm: (v: boolean) => void;
  handleSaveAccount: (acc: SavingsAccount) => void;
  handleDeleteAccount: (acc: SavingsAccount) => void;
  handleDeleteMovement: (accountId: string, movementId: string) => void;
  handleRenameMovement: (accountId: string, movementId: string, currentLabel: string) => void;
  hasParental: boolean;
}

export const AccountsView: React.FC<AccountsViewProps> = ({
  data, setView, editingAccount, setEditingAccount, showForm, setShowForm,
  handleSaveAccount, handleDeleteAccount, handleDeleteMovement, handleRenameMovement, hasParental,
}) => {
  const [groupSmallMovements, setGroupSmallMovements] = useState(true);
  const [activeTagFilter, setActiveTagFilter] = useState<string | null>(null);

  // Regroupe les mouvements < 1€ (bruit typique des PEE) en une ligne synthétique.
  type DisplayMovement = AccountMovement & { grouped?: boolean };
  const buildDisplayMovements = (movements: AccountMovement[] | undefined): DisplayMovement[] => {
    const sorted = [...(movements || [])].sort((a, b) => b.date.localeCompare(a.date));
    if (!groupSmallMovements) return sorted;
    const small = sorted.filter(m => Math.abs(m.amount) < 1);
    const large = sorted.filter(m => Math.abs(m.amount) >= 1);
    if (small.length <= 1) return sorted;
    const total = small.reduce((s, m) => s + (signedAmount(m)), 0);
    const synthetic: DisplayMovement = {
      id: '__grouped_small__',
      date: small[0].date,
      amount: Math.abs(total),
      label: `${small.length} mouvements < 1 € (total ${formatSignedEUR(total, 2)})`,
      type: total >= 0 ? 'IN' : 'OUT',
      grouped: true,
    };
    return [...large, synthetic].sort((a, b) => b.date.localeCompare(a.date));
  };

  const allTags = useMemo(() => {
    const set = new Set<string>();
    data.accounts.forEach(a => (a.tags || []).forEach(t => set.add(t)));
    return Array.from(set).sort();
  }, [data.accounts]);

  const filteredAccounts = useMemo(() => {
    if (!activeTagFilter) return data.accounts;
    return data.accounts.filter(a => (a.tags || []).includes(activeTagFilter));
  }, [data.accounts, activeTagFilter]);

  return (

              <div className="space-y-6 animate-fade-in">
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700">
                  <div><h2 className="text-2xl font-black text-slate-800 dark:text-slate-100">Mes comptes</h2><p className="text-sm text-slate-500 dark:text-slate-400 font-medium">{data.accounts.length} compte{data.accounts.length > 1 ? 's' : ''} · <button onClick={() => setView('journal')} className="underline hover:text-indigo-700 dark:hover:text-indigo-300">voir le journal des mouvements</button></p></div>
                  {!showForm && <button onClick={() => { setEditingAccount(undefined); setShowForm(true); }} className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-3 rounded-xl font-bold flex gap-2 transition-colors shadow-lg shadow-indigo-200"><PlusCircle className="w-5 h-5"/> Ajouter un compte</button>}
                </div>
                {!showForm && <MovementSearch accounts={data.accounts} />}
                {!showForm && data.accounts.some(a => [AccountType.LIVRET_A, AccountType.LDDS, AccountType.LEP].includes(a.type)) && (
                  <details className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 group">
                    <summary className="list-none cursor-pointer p-4 flex items-center justify-between font-bold text-sm text-slate-800 dark:text-slate-100">
                      Mettre à jour les taux des livrets
                      <ChevronDown className="w-4 h-4 text-slate-500 transition-transform group-open:rotate-180" />
                    </summary>
                    <div className="px-4 pb-4"><RegulatedRatesEditor accounts={data.accounts} onApply={data.setAccounts} /></div>
                  </details>
                )}
                {showForm ? (
                  <AccountForm
                      onSave={handleSaveAccount}
                      initialData={editingAccount}
                      onCancel={() => { setShowForm(false); setEditingAccount(undefined); }}
                      fiscalConfig={data.fiscalConfig}
                      showParental={hasParental || !!editingAccount?.parentalCapital}
                  />
                ) : (
                  <>
                  {allTags.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2">
                      <Tag className="w-3.5 h-3.5 text-slate-400" />
                      <button onClick={() => setActiveTagFilter(null)} className={`text-xs font-bold px-3 py-1.5 rounded-full transition-colors ${!activeTagFilter ? 'bg-indigo-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'}`}>Tous</button>
                      {allTags.map(t => (
                        <button key={t} onClick={() => setActiveTagFilter(t === activeTagFilter ? null : t)} className={`text-xs font-bold px-3 py-1.5 rounded-full transition-colors ${activeTagFilter === t ? 'bg-indigo-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'}`}>{t}</button>
                      ))}
                    </div>
                  )}
                  <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-left md:min-w-[34rem]">
                        <thead className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700">
                          <tr><th className="px-6 py-4 text-[11px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-wider">Compte</th><th className="px-6 py-4 text-[11px] text-right text-slate-500 dark:text-slate-400 uppercase tracking-wider">Ma part</th><th className="hidden md:table-cell px-6 py-4 text-[11px] text-right text-slate-500 dark:text-slate-400 uppercase tracking-wider">Parents</th><th className="hidden md:table-cell px-6 py-4 text-right"></th></tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                          {filteredAccounts.map(acc => (
                            <React.Fragment key={acc.id}>
                              <tr className="hover:bg-slate-50 dark:hover:bg-slate-800 group transition-colors">
                                <td className="px-4 md:px-6 py-4">
                                  <button type="button" onClick={() => setEditingAccount(editingAccount?.id === acc.id ? undefined : acc)} aria-expanded={editingAccount?.id === acc.id && !showForm}
                                    className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-1 text-left hover:text-indigo-700 dark:hover:text-indigo-300">
                                    {acc.name} <ChevronDown className={`w-4 h-4 text-slate-500 transition-transform ${editingAccount?.id === acc.id && !showForm ? 'rotate-180' : ''}`} aria-hidden="true" /><span className="sr-only">: voir les mouvements</span>
                                  </button>
                                  <div className="text-[11px] uppercase text-slate-500 dark:text-slate-400 font-bold">{acc.institution}</div>
                                  {acc.tags && acc.tags.length > 0 && (
                                    <div className="flex flex-wrap gap-1 mt-1">
                                      {acc.tags.map(t => <span key={t} className="text-[11px] bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-300 px-1.5 py-0.5 rounded-full font-bold normal-case">{t}</span>)}
                                    </div>
                                  )}
                                  {(() => {
                                    // Compte à rebours de maturité fiscale (PEA/AV/PEE) : réutilise
                                    // exactement le calcul de fiscalité du capital de Rendement, pour
                                    // ne jamais annoncer un régime différent d'un écran à l'autre.
                                    const maturity = computeMaturityCountdown(acc, data.fiscalConfig);
                                    if (!maturity) return null;
                                    const label = maturity.regimeAfter === 'EXONERE_IR' ? 'exonéré d\'impôt' : 'impôt réduit';
                                    return (
                                      <div className="mt-1 text-[11px] font-bold text-indigo-700 dark:text-indigo-300 flex items-center gap-1">
                                        <Clock className="w-3 h-3 flex-shrink-0" />
                                        {label.charAt(0).toUpperCase() + label.slice(1)} dans {maturity.monthsRemaining} mois
                                      </div>
                                    );
                                  })()}
                                  <div className="md:hidden mt-2 flex items-center gap-2">
                                    {acc.parentalCapital > 0 && <span className="text-xs font-bold text-amber-600 dark:text-amber-400 flex-1">Parents : {formatEUR(acc.parentalCapital)}</span>}
                                    <span className="flex-1" />
                                    <button onClick={(e) => { e.stopPropagation(); setEditingAccount(acc); setShowForm(true); }} aria-label={`Modifier ${acc.name}`} className="p-2.5 text-indigo-600 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/40 rounded-lg"><Edit2 className="w-4 h-4"/></button>
                                    <button onClick={(e) => { e.stopPropagation(); handleDeleteAccount(acc); }} aria-label={`Supprimer ${acc.name}`} className="p-2.5 text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 rounded-lg"><Trash2 className="w-4 h-4"/></button>
                                  </div>
                                </td>
                                <td className="px-4 md:px-6 py-4 text-right align-top"><div className="font-black text-indigo-700 dark:text-indigo-300 text-lg whitespace-nowrap">{formatEUR(acc.ownedAmount)}</div><AccountTotal account={acc} /></td>
                                <td className="hidden md:table-cell px-6 py-4 text-right font-bold text-amber-700 dark:text-amber-400">{formatEUR(acc.parentalCapital)}</td>
                                <td className="hidden md:table-cell px-6 py-4 text-right"><div className="flex justify-end gap-2 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 transition-opacity">
                                   <button onClick={(e) => { e.stopPropagation(); setEditingAccount(acc); setShowForm(true); }} aria-label={`Modifier ${acc.name}`} className="p-2 text-indigo-600 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/40 rounded-lg hover:bg-indigo-100 dark:hover:bg-indigo-900"><Edit2 className="w-4 h-4"/></button>
                                   <button onClick={(e) => { e.stopPropagation(); handleDeleteAccount(acc); }} aria-label={`Supprimer ${acc.name}`} className="p-2 text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 rounded-lg hover:bg-rose-100 dark:hover:bg-rose-900"><Trash2 className="w-4 h-4"/></button>
                                </div></td>
                              </tr>
                              {editingAccount?.id === acc.id && !showForm && (
                                 <tr className="bg-slate-50 dark:bg-slate-900 animate-in slide-in-from-top-2"><td colSpan={4} className="p-4"><div className="space-y-2 p-2">
                                   <label className="flex items-center gap-2 text-[11px] font-black text-slate-500 dark:text-slate-400 uppercase mb-1 cursor-pointer">
                                     <input type="checkbox" checked={groupSmallMovements} onChange={e => setGroupSmallMovements(e.target.checked)} className="accent-indigo-600" />
                                     Regrouper les mouvements &lt; 1€
                                   </label>
                                   <div className="max-h-60 overflow-y-auto space-y-2">
                                   {buildDisplayMovements(acc.movements).map(m => (
                                     <div key={m.id} className={`flex justify-between items-center p-3 rounded-xl text-xs border shadow-sm ${m.grouped ? 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 italic' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700'}`}>
                                       <div className="flex items-center gap-3">
                                           <span className="text-slate-500 dark:text-slate-400 font-mono bg-slate-100 dark:bg-slate-700 px-2 py-1 rounded whitespace-nowrap">{m.date.split('-').reverse().join('/')}</span>
                                           <span className="font-bold text-slate-700 dark:text-slate-200">{m.label}</span>
                                           {!m.grouped && !isRestitutionMovement(m) && <button onClick={()=>handleRenameMovement(acc.id, m.id, m.label)} aria-label={`Renommer « ${m.label} »`} className="p-2 -m-1 opacity-60 hover:opacity-100"><Edit2 className="w-4 h-4 text-slate-500 dark:text-slate-400"/></button>}
                                       </div>
                                       <div className="flex items-center gap-3">
                                           <span className={`font-mono text-sm ${m.type==='IN'?'text-emerald-600 font-bold':'text-rose-600 font-bold'}`}>{m.type==='IN'?'+':'−'}{formatEUR(m.amount)}</span>
                                           {!m.grouped && !isRestitutionMovement(m) && <button onClick={()=>handleDeleteMovement(acc.id, m.id)} aria-label={`Supprimer « ${m.label} »`} className="p-2.5 -m-1 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded text-slate-500 dark:text-slate-400 hover:text-rose-500"><Trash2 className="w-4 h-4"/></button>}
                                       </div>
                                     </div>
                                   ))}
                                   {(!acc.movements || acc.movements.length===0) && <div className="text-center text-slate-500 dark:text-slate-400 italic py-4">Aucun mouvement historique.</div>}
                                   </div>
                                 </div></td></tr>
                               )}
                            </React.Fragment>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  </>
                )}
              </div>
            
  );
};
