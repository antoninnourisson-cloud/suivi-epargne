// ================================================
// FILE: src/components/AccountForm.tsx
// ================================================
import React, { useState, useEffect } from 'react';
import { AccountType, SavingsAccount, FiscalConfig } from '../types'; // Ajout FiscalConfig
import { Button } from './Button';
// RETRAIT DE L'IMPORT ACCOUNT_CEILINGS QUI FAISAIT PLANTER
import { PlusCircle, Save, Users, Calculator, ShieldCheck, TrendingUp, TrendingDown } from 'lucide-react';

interface AccountFormProps {
  onSave: (account: SavingsAccount) => void;
  initialData?: SavingsAccount;
  onCancel?: () => void;
  fiscalConfig: FiscalConfig; // <--- NOUVELLE PROP OBLIGATOIRE
}

export const AccountForm: React.FC<AccountFormProps> = ({ onSave, initialData, onCancel, fiscalConfig }) => {
  const [type, setType] = useState<AccountType>(initialData?.type || AccountType.LIVRET_A);
  const [name, setName] = useState(initialData?.name || '');
  const [institution, setInstitution] = useState(initialData?.institution || '');
  const [totalAmount, setTotalAmount] = useState<string>(initialData?.totalAmount?.toString() || '');
  const [parentalCapital, setParentalCapital] = useState<string>(initialData?.parentalCapital?.toString() || '0');
  const [ownedAmount, setOwnedAmount] = useState<string>(initialData?.ownedAmount?.toString() || '');
  const [interestRate, setInterestRate] = useState<string>(initialData?.interestRate?.toString() || '');
  const [highRate, setHighRate] = useState<string>(initialData?.recentHighRate?.toString() || '');
  const [lowRate, setLowRate] = useState<string>(initialData?.recentLowRate?.toString() || '');
  const [openingDate, setOpeningDate] = useState(initialData?.openingDate || '');
  const [contractEndDate, setContractEndDate] = useState(initialData?.contractEndDate || '');
  const [ceiling, setCeiling] = useState<string>(initialData?.ceiling?.toString() || '');
  const [isRevolut, setIsRevolut] = useState(initialData?.isRevolut || false);
  
  const isTaxableType = [AccountType.ASSURANCE_VIE, AccountType.PEA, AccountType.PEE, AccountType.CRYPTO, AccountType.IMMOBILIER].includes(type);

  // --- MISE À JOUR : UTILISATION DE LA CONFIG DYNAMIQUE ---
  useEffect(() => {
    if (!initialData) {
      // On pioche dans fiscalConfig.ceilings au lieu de la constante
      if (type === AccountType.LIVRET_A) setCeiling(fiscalConfig.ceilings.livretA.toString());
      else if (type === AccountType.LDDS) setCeiling(fiscalConfig.ceilings.ldds.toString());
      else if (type === AccountType.LEP) setCeiling(fiscalConfig.ceilings.lep.toString());
      else setCeiling('');
    }
  }, [type, initialData, fiscalConfig]); // Ajout dépendance

  const handleTotalChange = (val: string) => {
    setTotalAmount(val);
    const total = parseFloat(val) || 0;
    const parents = parseFloat(parentalCapital) || 0;
    setOwnedAmount((total - parents).toFixed(2));
  };

  const handleParentalChange = (val: string) => {
    setParentalCapital(val);
    const parents = parseFloat(val) || 0;
    const total = parseFloat(totalAmount) || 0;
    setOwnedAmount((total - parents).toFixed(2));
  };

  const handleOwnedChange = (val: string) => {
    setOwnedAmount(val);
    const owned = parseFloat(val) || 0;
    const total = parseFloat(totalAmount) || 0;
    if (total >= owned) setParentalCapital((total - owned).toFixed(2));
  };

  const setRevolutMode = () => {
    setInstitution('Revolut');
    setName('Poche Loisirs/Projets');
    setType(AccountType.COMPTE_COURANT);
    setIsRevolut(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      id: initialData?.id || crypto.randomUUID(),
      name: name || `${type} - ${institution}`,
      type,
      institution,
      totalAmount: parseFloat(totalAmount) || 0,
      ownedAmount: parseFloat(ownedAmount) || 0,
      parentalCapital: parseFloat(parentalCapital) || 0,
      interestRate: parseFloat(interestRate) || 0,
      recentHighRate: parseFloat(highRate) || undefined,
      recentLowRate: parseFloat(lowRate) || undefined,
      openingDate,
      contractEndDate: type === AccountType.PEE ? contractEndDate : undefined,
      ceiling: parseFloat(ceiling) || undefined,
      isRevolut,
      isTaxable: isTaxableType
    });
  };

  return (
    <div className="space-y-6">
      {!initialData && (
        <button type="button" onClick={setRevolutMode} className="w-full bg-white border-2 border-slate-200 p-5 rounded-3xl flex items-center gap-4 hover:border-indigo-400 hover:bg-indigo-50 transition-all text-left">
          <div className="bg-indigo-600 p-3 rounded-2xl"><ShieldCheck className="w-6 h-6 text-white" /></div>
          <div><p className="text-sm font-black text-slate-800">Ajouter mon compte Revolut</p><p className="text-[10px] text-slate-500 font-bold uppercase">(Loisirs & Projets Court Terme)</p></div>
        </button>
      )}

      <form onSubmit={handleSubmit} className="bg-white p-6 rounded-3xl shadow-sm border border-slate-200">
        <h3 className="text-lg font-black text-slate-800 mb-6 flex items-center gap-2">
          {initialData ? <Save className="w-5 h-5 text-indigo-600" /> : <PlusCircle className="w-5 h-5 text-indigo-600" />}
          Configuration du compte
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div><label className="text-[10px] font-black text-slate-400 uppercase block mb-1">Type</label><select value={type} onChange={(e) => setType(e.target.value as AccountType)} className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl font-bold">{Object.values(AccountType).map(t => <option key={t} value={t}>{t}</option>)}</select></div>
          <div><label className="text-[10px] font-black text-slate-400 uppercase block mb-1">Banque</label><input type="text" value={institution} onChange={e => setInstitution(e.target.value)} className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl font-bold" required /></div>
          <div className="md:col-span-2 bg-indigo-50/50 p-5 rounded-2xl border border-indigo-100">
            <label className="flex items-center gap-2 text-[10px] font-black text-indigo-700 uppercase mb-4"><Calculator className="w-4 h-4" /> Répartition du Capital</label>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-white p-3 rounded-xl border border-indigo-100"><label className="text-[10px] font-black text-indigo-700 block mb-1">Solde Total (€)</label><input type="number" step="0.01" value={totalAmount} onChange={e => handleTotalChange(e.target.value)} className="w-full bg-transparent font-black text-slate-800 text-lg outline-none" required /></div>
              <div className="bg-white p-3 rounded-xl border border-amber-100"><label className="text-[10px] font-black text-amber-700 block mb-1"><Users className="w-3 h-3" /> Part Parents (€)</label><input type="number" step="0.01" value={parentalCapital} onChange={e => handleParentalChange(e.target.value)} className="w-full bg-transparent font-black text-amber-700 text-lg outline-none" /></div>
              <div className="bg-white p-3 rounded-xl border border-emerald-100"><label className="text-[10px] font-black text-emerald-700 block mb-1">Ma Part Nette (€)</label><input type="number" step="0.01" value={ownedAmount} onChange={e => handleOwnedChange(e.target.value)} className="w-full bg-transparent font-black text-emerald-800 text-lg outline-none" /></div>
            </div>
          </div>

          <div className="md:col-span-2 grid grid-cols-2 md:grid-cols-3 gap-4 bg-slate-50 p-5 rounded-2xl border border-slate-200">
            <div><label className="text-[10px] font-black text-slate-400 uppercase mb-1">Taux Actuel (%)</label><input type="number" step="0.01" value={interestRate} onChange={e => setInterestRate(e.target.value)} className="w-full p-3 bg-white border border-slate-200 rounded-xl font-bold" /></div>
            {isTaxableType && (
              <>
                <div><label className="text-[10px] font-black text-slate-400 uppercase mb-1 flex items-center gap-1"><TrendingUp className="w-3 h-3 text-emerald-500" /> Taux Haut Net</label><input type="number" step="0.01" value={highRate} onChange={e => setHighRate(e.target.value)} className="w-full p-3 bg-white border border-slate-200 rounded-xl font-bold text-emerald-600" /></div>
                <div><label className="text-[10px] font-black text-slate-400 uppercase mb-1 flex items-center gap-1"><TrendingDown className="w-3 h-3 text-rose-500" /> Taux Bas Net</label><input type="number" step="0.01" value={lowRate} onChange={e => setLowRate(e.target.value)} className="w-full p-3 bg-white border border-slate-200 rounded-xl font-bold text-rose-600" /></div>
              </>
            )}
            {!isTaxableType && <div><label className="text-[10px] font-black text-slate-400 uppercase mb-1">Plafond (€)</label><input type="number" value={ceiling} onChange={e => setCeiling(e.target.value)} className="w-full p-3 bg-white border border-slate-200 rounded-xl font-bold" /></div>}
          </div>

          <div><label className="text-[10px] font-black text-slate-400 uppercase mb-1">Date d'ouverture</label><input type="date" value={openingDate} onChange={e => setOpeningDate(e.target.value)} className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl font-bold" /></div>
          {type === AccountType.PEE && <div><label className="text-[10px] font-black text-amber-800 mb-1 uppercase">Fin contrat</label><input type="date" value={contractEndDate} onChange={e => setContractEndDate(e.target.value)} className="w-full p-3 bg-amber-50 border border-amber-200 rounded-xl font-bold" /></div>}
        </div>
        <div className="mt-8 flex justify-between items-center gap-4">
          <div className="flex items-center gap-2"><input type="checkbox" checked={isRevolut} onChange={e => setIsRevolut(e.target.checked)} className="w-4 h-4" /><label className="text-xs font-bold text-slate-500 uppercase">Compte Revolut (3916)</label></div>
          <div className="flex gap-3">{onCancel && <Button type="button" variant="ghost" onClick={onCancel}>Annuler</Button>}<Button type="submit" className="px-10 py-4">Enregistrer</Button></div>
        </div>
      </form>
    </div>
  );
};