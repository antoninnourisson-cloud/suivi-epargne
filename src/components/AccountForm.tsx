// ================================================
// FILE: src/components/AccountForm.tsx
// ================================================
import React, { useState, useEffect } from 'react';
import { AccountType, SavingsAccount, FiscalConfig } from '../types';
import { Button } from './Button';
import { NumberInput } from './NumberInput';
import { PlusCircle, Save, Users, Calculator, ShieldCheck, TrendingUp, TrendingDown, Tag, X, History } from 'lucide-react';

interface AccountFormProps {
  onSave: (account: SavingsAccount) => void;
  initialData?: SavingsAccount;
  onCancel?: () => void;
  fiscalConfig: FiscalConfig;
}

export const AccountForm: React.FC<AccountFormProps> = ({ onSave, initialData, onCancel, fiscalConfig }) => {
  const [type, setType] = useState<AccountType>(initialData?.type || AccountType.LIVRET_A);
  const [name, setName] = useState(initialData?.name || '');
  const [institution, setInstitution] = useState(initialData?.institution || '');
  const [totalAmount, setTotalAmount] = useState<number>(initialData?.totalAmount || 0);
  const [parentalCapital, setParentalCapital] = useState<number>(initialData?.parentalCapital || 0);
  const [ownedAmount, setOwnedAmount] = useState<number>(initialData?.ownedAmount || 0);
  const [interestRate, setInterestRate] = useState<string>(initialData?.interestRate?.toString() || '');
  const [highRate, setHighRate] = useState<string>(initialData?.recentHighRate?.toString() || '');
  const [lowRate, setLowRate] = useState<string>(initialData?.recentLowRate?.toString() || '');
  const [openingDate, setOpeningDate] = useState(initialData?.openingDate || '');
  const [contractEndDate, setContractEndDate] = useState(initialData?.contractEndDate || '');
  const [ceiling, setCeiling] = useState<number>(initialData?.ceiling || 0);
  const [isRevolut, setIsRevolut] = useState(initialData?.isRevolut || false);
  const [tags, setTags] = useState<string[]>(initialData?.tags || []);
  const [tagInput, setTagInput] = useState('');

  const isTaxableType = [AccountType.ASSURANCE_VIE, AccountType.PEA, AccountType.PEE, AccountType.CRYPTO, AccountType.IMMOBILIER].includes(type);

  useEffect(() => {
    if (!initialData) {
      if (type === AccountType.LIVRET_A) setCeiling(fiscalConfig.ceilings.livretA);
      else if (type === AccountType.LDDS) setCeiling(fiscalConfig.ceilings.ldds);
      else if (type === AccountType.LEP) setCeiling(fiscalConfig.ceilings.lep);
      else setCeiling(0);
    }
  }, [type, initialData, fiscalConfig]);

  const handleTotalChange = (total: number) => {
    setTotalAmount(total);
    setOwnedAmount(Math.round((total - parentalCapital) * 100) / 100);
  };

  const handleParentalChange = (parents: number) => {
    setParentalCapital(parents);
    setOwnedAmount(Math.round((totalAmount - parents) * 100) / 100);
  };

  const handleOwnedChange = (owned: number) => {
    setOwnedAmount(owned);
    if (totalAmount >= owned) setParentalCapital(Math.round((totalAmount - owned) * 100) / 100);
  };

  const setRevolutMode = () => {
    setInstitution('Revolut');
    setName('Poche Loisirs/Projets');
    setType(AccountType.COMPTE_COURANT);
    setIsRevolut(true);
  };

  const addTag = () => {
    const t = tagInput.trim();
    if (t && !tags.includes(t)) setTags([...tags, t]);
    setTagInput('');
  };
  const removeTag = (t: string) => setTags(tags.filter(x => x !== t));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const newRate = parseFloat(interestRate) || 0;

    // Historise l'ancien taux s'il a changé, pour affiner le calcul de rendement dans le temps.
    let rateHistory = initialData?.rateHistory || [];
    if (initialData && initialData.interestRate !== undefined && initialData.interestRate !== newRate) {
      const today = new Date().toISOString().split('T')[0];
      rateHistory = [...rateHistory, { date: today, rate: initialData.interestRate }];
    }

    onSave({
      id: initialData?.id || crypto.randomUUID(),
      name: name || `${type} - ${institution}`,
      type,
      institution,
      totalAmount,
      ownedAmount,
      parentalCapital,
      interestRate: newRate,
      recentHighRate: parseFloat(highRate) || undefined,
      recentLowRate: parseFloat(lowRate) || undefined,
      openingDate,
      contractEndDate: type === AccountType.PEE ? contractEndDate : undefined,
      ceiling: ceiling || undefined,
      isRevolut,
      isTaxable: isTaxableType,
      rateHistory: rateHistory.length > 0 ? rateHistory : undefined,
      tags: tags.length > 0 ? tags : undefined,
    });
  };

  const moneyInputClass = "w-full bg-transparent font-black text-slate-800 dark:text-slate-100 text-lg outline-none";

  return (
    <div className="space-y-6">
      {!initialData && (
        <button type="button" onClick={setRevolutMode} className="w-full bg-white dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-700 p-5 rounded-3xl flex items-center gap-4 hover:border-indigo-400 hover:bg-indigo-50 transition-all text-left">
          <div className="bg-indigo-600 p-3 rounded-2xl"><ShieldCheck className="w-6 h-6 text-white" /></div>
          <div><p className="text-sm font-black text-slate-800 dark:text-slate-100">Ajouter mon compte Revolut</p><p className="text-[10px] text-slate-500 dark:text-slate-400 font-bold uppercase">(Loisirs & Projets Court Terme)</p></div>
        </button>
      )}

      <form onSubmit={handleSubmit} className="bg-white dark:bg-slate-800 p-6 rounded-3xl shadow-sm border border-slate-200 dark:border-slate-700">
        <h3 className="text-lg font-black text-slate-800 dark:text-slate-100 mb-6 flex items-center gap-2">
          {initialData ? <Save className="w-5 h-5 text-indigo-600" /> : <PlusCircle className="w-5 h-5 text-indigo-600" />}
          Configuration du compte
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div><label className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase block mb-1">Type</label><select value={type} onChange={(e) => setType(e.target.value as AccountType)} className="w-full p-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl font-bold">{Object.values(AccountType).map(t => <option key={t} value={t}>{t}</option>)}</select></div>
          <div><label className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase block mb-1">Banque</label><input type="text" value={institution} onChange={e => setInstitution(e.target.value)} className="w-full p-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl font-bold" required /></div>

          <div className="md:col-span-2 bg-indigo-50/50 p-5 rounded-2xl border border-indigo-100">
            <label className="flex items-center gap-2 text-[10px] font-black text-indigo-700 uppercase mb-4"><Calculator className="w-4 h-4" /> Répartition du Capital</label>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-white dark:bg-slate-800 p-3 rounded-xl border border-indigo-100"><label className="text-[10px] font-black text-indigo-700 block mb-1">Solde Total (€)</label><NumberInput value={totalAmount} onChange={handleTotalChange} className={moneyInputClass} /></div>
              <div className="bg-white dark:bg-slate-800 p-3 rounded-xl border border-amber-100"><label className="text-[10px] font-black text-amber-700 block mb-1"><Users className="w-3 h-3" /> Part Parents (€)</label><NumberInput value={parentalCapital} onChange={handleParentalChange} className={`${moneyInputClass} text-amber-700`} /></div>
              <div className="bg-white dark:bg-slate-800 p-3 rounded-xl border border-emerald-100"><label className="text-[10px] font-black text-emerald-700 block mb-1">Ma Part Nette (€)</label><NumberInput value={ownedAmount} onChange={handleOwnedChange} className={`${moneyInputClass} text-emerald-800`} /></div>
            </div>
          </div>

          <div className="md:col-span-2 grid grid-cols-2 md:grid-cols-3 gap-4 bg-slate-50 dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-700">
            <div>
              <label className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase mb-1 flex items-center gap-1">Taux Actuel (%)</label>
              <input type="number" step="0.01" value={interestRate} onChange={e => setInterestRate(e.target.value)} className="w-full p-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-bold" />
              {initialData?.rateHistory && initialData.rateHistory.length > 0 && (
                <p className="text-[9px] text-slate-400 dark:text-slate-500 mt-1 flex items-center gap-1"><History className="w-3 h-3" /> {initialData.rateHistory.length} changement(s) historisé(s)</p>
              )}
            </div>
            {isTaxableType && (
              <>
                <div><label className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase mb-1 flex items-center gap-1"><TrendingUp className="w-3 h-3 text-emerald-500" /> Taux Haut Net</label><input type="number" step="0.01" value={highRate} onChange={e => setHighRate(e.target.value)} className="w-full p-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-bold text-emerald-600" /></div>
                <div><label className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase mb-1 flex items-center gap-1"><TrendingDown className="w-3 h-3 text-rose-500" /> Taux Bas Net</label><input type="number" step="0.01" value={lowRate} onChange={e => setLowRate(e.target.value)} className="w-full p-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-bold text-rose-600" /></div>
              </>
            )}
            {!isTaxableType && <div><label className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase mb-1">Plafond (€)</label><NumberInput value={ceiling} onChange={setCeiling} className="w-full p-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-bold" /></div>}
          </div>

          <div><label className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase mb-1">Date d'ouverture</label><input type="date" value={openingDate} onChange={e => setOpeningDate(e.target.value)} className="w-full p-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl font-bold" /></div>
          {type === AccountType.PEE && <div><label className="text-[10px] font-black text-amber-800 mb-1 uppercase">Fin contrat</label><input type="date" value={contractEndDate} onChange={e => setContractEndDate(e.target.value)} className="w-full p-3 bg-amber-50 border border-amber-200 rounded-xl font-bold" /></div>}

          <div className="md:col-span-2">
            <label className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase mb-1 flex items-center gap-1"><Tag className="w-3 h-3" /> Étiquettes (libres)</label>
            <div className="flex flex-wrap gap-2 mb-2">
              {tags.map(t => (
                <span key={t} className="inline-flex items-center gap-1 bg-indigo-50 text-indigo-700 text-xs font-bold px-2.5 py-1 rounded-full">
                  {t}
                  <button type="button" onClick={() => removeTag(t)}><X className="w-3 h-3" /></button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={tagInput}
                onChange={e => setTagInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }}
                placeholder="Ex : Précaution, Projet voyage..."
                className="flex-1 p-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-bold"
              />
              <button type="button" onClick={addTag} className="px-4 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 rounded-xl font-bold text-sm text-slate-600 dark:text-slate-300">Ajouter</button>
            </div>
          </div>
        </div>
        <div className="mt-8 flex justify-between items-center gap-4">
          <div className="flex items-center gap-2"><input type="checkbox" checked={isRevolut} onChange={e => setIsRevolut(e.target.checked)} className="w-4 h-4" /><label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase">Compte Revolut (3916)</label></div>
          <div className="flex gap-3">{onCancel && <Button type="button" variant="ghost" onClick={onCancel}>Annuler</Button>}<Button type="submit" className="px-10 py-4">Enregistrer</Button></div>
        </div>
      </form>
    </div>
  );
};
