// ================================================
// FILE: src/components/Settings.tsx
// ================================================
import React, { useState } from 'react';
import { FiscalConfig, TaxBracket, WorkBenefits } from '../types';
import { Button } from './Button';
import { Save, AlertTriangle, Settings as SettingsIcon, Plus, Trash2 } from 'lucide-react';

interface SettingsProps {
  config: FiscalConfig;
  workBenefits: WorkBenefits;
  onSave: (newConfig: FiscalConfig, newBenefits: WorkBenefits) => void;
}

export const Settings: React.FC<SettingsProps> = ({ config, workBenefits, onSave }) => {
  const [localFiscal, setLocalFiscal] = useState<FiscalConfig>(config);
  const [localBenefits, setLocalBenefits] = useState<WorkBenefits>(workBenefits);

  const handleFiscalChange = (field: keyof FiscalConfig, value: any) => {
    setLocalFiscal(prev => ({ ...prev, [field]: value }));
  };

  const handleCeilingChange = (key: string, value: number) => {
    setLocalFiscal(prev => ({ ...prev, ceilings: { ...prev.ceilings, [key]: value } }));
  };

  const updateBracket = (index: number, field: keyof TaxBracket, value: number) => {
    const newBrackets = [...localFiscal.taxBrackets];
    newBrackets[index] = { ...newBrackets[index], [field]: value };
    handleFiscalChange('taxBrackets', newBrackets);
  };

  const addBracket = () => handleFiscalChange('taxBrackets', [...localFiscal.taxBrackets, { limit: 0, rate: 0 }]);
  const removeBracket = (index: number) => handleFiscalChange('taxBrackets', localFiscal.taxBrackets.filter((_, i) => i !== index));

  const updateBenefit = (category: keyof WorkBenefits, field: string, value: any) => {
    setLocalBenefits(prev => ({
        ...prev,
        [category]: { ...prev[category], [field]: value }
    }));
  };

  return (
    <div className="space-y-6 animate-fade-in pb-20">
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex items-center justify-between">
        <div>
          <h2 className="text-xl font-black text-slate-800 flex items-center gap-2"><SettingsIcon className="w-6 h-6 text-indigo-600" /> Paramètres Globaux</h2>
          <p className="text-sm text-slate-500">Ajustez la fiscalité et vos avantages salariaux.</p>
        </div>
        <Button onClick={() => onSave(localFiscal, localBenefits)} className="gap-2"><Save className="w-4 h-4" /> Enregistrer Tout</Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* SECTION 1: AVANTAGES SALARIAUX */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 lg:col-span-2">
           <h3 className="font-bold text-slate-800 mb-4 border-b pb-2 flex items-center gap-2">🏢 Avantages & Prélèvements Entreprise</h3>
           <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
               
               {/* NAVIGO */}
               <div className="bg-indigo-50/50 p-4 rounded-xl border border-indigo-100">
                   <label className="flex items-center gap-2 font-black text-xs uppercase text-indigo-600 mb-3 cursor-pointer">
                       <input type="checkbox" checked={localBenefits.navigo.active} onChange={e => updateBenefit('navigo', 'active', e.target.checked)} className="accent-indigo-600"/> 
                       Transport (Navigo)
                   </label>
                   {localBenefits.navigo.active && (
                       <div className="space-y-2">
                           <div><label className="text-[9px] font-bold text-slate-400">Prix Base Mensuel (€)</label><input type="number" value={localBenefits.navigo.basePrice} onChange={e => updateBenefit('navigo', 'basePrice', parseFloat(e.target.value))} className="w-full p-2 rounded border border-indigo-200 text-sm font-bold"/></div>
                           <div><label className="text-[9px] font-bold text-slate-400">Remboursement (%)</label><input type="number" value={localBenefits.navigo.refundRate} onChange={e => updateBenefit('navigo', 'refundRate', parseFloat(e.target.value))} className="w-full p-2 rounded border border-indigo-200 text-sm font-bold"/></div>
                           <p className="text-[9px] text-emerald-600 text-right mt-1">+{(localBenefits.navigo.basePrice * localBenefits.navigo.refundRate / 100).toFixed(2)}€/mois (Gain)</p>
                       </div>
                   )}
               </div>

               {/* MUTUELLE */}
               <div className="bg-rose-50/50 p-4 rounded-xl border border-rose-100">
                   <label className="flex items-center gap-2 font-black text-xs uppercase text-rose-600 mb-3 cursor-pointer">
                       <input type="checkbox" checked={localBenefits.mutuelle.active} onChange={e => updateBenefit('mutuelle', 'active', e.target.checked)} className="accent-rose-600"/> 
                       Mutuelle Santé
                   </label>
                   {localBenefits.mutuelle.active && (
                       <div className="space-y-2">
                           <div><label className="text-[9px] font-bold text-slate-400">Coût Contrat Total (€)</label><input type="number" value={localBenefits.mutuelle.totalCost} onChange={e => updateBenefit('mutuelle', 'totalCost', parseFloat(e.target.value))} className="w-full p-2 rounded border border-rose-200 text-sm font-bold"/></div>
                           <div><label className="text-[9px] font-bold text-slate-400">Prise en charge Boite (%)</label><input type="number" value={localBenefits.mutuelle.employerRate} onChange={e => updateBenefit('mutuelle', 'employerRate', parseFloat(e.target.value))} className="w-full p-2 rounded border border-rose-200 text-sm font-bold"/></div>
                           <p className="text-[9px] text-rose-600 text-right mt-1">-{(localBenefits.mutuelle.totalCost * (1 - localBenefits.mutuelle.employerRate/100)).toFixed(2)}€/mois (Coût)</p>
                       </div>
                   )}
               </div>

               {/* TICKETS RESTO */}
               <div className="bg-emerald-50/50 p-4 rounded-xl border border-emerald-100">
                   <label className="flex items-center gap-2 font-black text-xs uppercase text-emerald-600 mb-3 cursor-pointer">
                       <input type="checkbox" checked={localBenefits.mealVouchers.active} onChange={e => updateBenefit('mealVouchers', 'active', e.target.checked)} className="accent-emerald-600"/> 
                       Titres Restaurant
                   </label>
                   {localBenefits.mealVouchers.active && (
                       <div className="space-y-2">
                           <div className="grid grid-cols-2 gap-2">
                               <div><label className="text-[9px] font-bold text-slate-400">Valeur (€)</label><input type="number" value={localBenefits.mealVouchers.faceValue} onChange={e => updateBenefit('mealVouchers', 'faceValue', parseFloat(e.target.value))} className="w-full p-2 rounded border border-emerald-200 text-sm font-bold"/></div>
                               <div><label className="text-[9px] font-bold text-slate-400">Jours/Mois</label><input type="number" value={localBenefits.mealVouchers.daysPerMonth} onChange={e => updateBenefit('mealVouchers', 'daysPerMonth', parseFloat(e.target.value))} className="w-full p-2 rounded border border-emerald-200 text-sm font-bold"/></div>
                           </div>
                           <div><label className="text-[9px] font-bold text-slate-400">Prise en charge Boite (%)</label><input type="number" value={localBenefits.mealVouchers.employerRate} onChange={e => updateBenefit('mealVouchers', 'employerRate', parseFloat(e.target.value))} className="w-full p-2 rounded border border-emerald-200 text-sm font-bold"/></div>
                           <p className="text-[9px] text-emerald-600 text-right mt-1">-{(localBenefits.mealVouchers.faceValue * localBenefits.mealVouchers.daysPerMonth * (1 - localBenefits.mealVouchers.employerRate/100)).toFixed(2)}€/mois (Coût)</p>
                       </div>
                   )}
               </div>
           </div>
        </div>

        {/* SECTION 2: PARAMÈTRES FISCAUX */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200">
          <h3 className="font-bold text-slate-800 mb-4 border-b pb-2">⚖️ Fiscalité & Social</h3>
          <div className="space-y-4">
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase">Charges Salariales (Ex: 0.2232)</label>
              <input type="number" step="0.0001" value={localFiscal.salaryChargesRate} onChange={e => handleFiscalChange('salaryChargesRate', parseFloat(e.target.value))} className="w-full p-2 bg-slate-50 border border-slate-200 rounded font-bold" />
            </div>
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase">Abattement Forfaitaire Impôt (Ex: 0.10)</label>
              <input type="number" step="0.01" value={localFiscal.standardAllowance} onChange={e => handleFiscalChange('standardAllowance', parseFloat(e.target.value))} className="w-full p-2 bg-slate-50 border border-slate-200 rounded font-bold" />
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-slate-200">
          <h3 className="font-bold text-slate-800 mb-4 border-b pb-2">📈 Plafonds Livrets (€)</h3>
          <div className="grid grid-cols-2 gap-4">
              <div><label className="text-[10px] text-indigo-600 font-black uppercase">Livret A</label><input type="number" value={localFiscal.ceilings.livretA} onChange={e => handleCeilingChange('livretA', parseFloat(e.target.value))} className="w-full p-2 bg-indigo-50 border border-indigo-100 rounded font-bold" /></div>
              <div><label className="text-[10px] text-rose-600 font-black uppercase">LEP</label><input type="number" value={localFiscal.ceilings.lep} onChange={e => handleCeilingChange('lep', parseFloat(e.target.value))} className="w-full p-2 bg-rose-50 border border-rose-100 rounded font-bold" /></div>
          </div>
        </div>

        {/* SECTION 3: BARÈME IMPÔT */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 lg:col-span-2">
          <div className="flex justify-between items-center mb-4 border-b pb-2">
            <h3 className="font-bold text-slate-800">🏛️ Barème Impôt sur le Revenu</h3>
            <button onClick={addBracket} className="text-xs flex items-center gap-1 bg-slate-100 px-2 py-1 rounded hover:bg-slate-200"><Plus className="w-3 h-3"/> Ajouter tranche</button>
          </div>
          <div className="space-y-2">
            {localFiscal.taxBrackets.map((bracket, index) => (
                <div key={index} className="flex items-center gap-4">
                    <div className="flex-1">
                        <label className="text-[8px] uppercase font-bold text-slate-400">Limite Sup (€)</label>
                        <input type="number" value={bracket.limit === Infinity ? 999999999 : bracket.limit} onChange={e => updateBracket(index, 'limit', parseFloat(e.target.value))} className="w-full p-2 bg-slate-50 border border-slate-200 rounded text-sm" />
                    </div>
                    <div className="w-32">
                        <label className="text-[8px] uppercase font-bold text-slate-400">Taux (0.11)</label>
                        <input type="number" step="0.01" value={bracket.rate} onChange={e => updateBracket(index, 'rate', parseFloat(e.target.value))} className="w-full p-2 bg-slate-50 border border-slate-200 rounded text-sm font-bold text-indigo-600" />
                    </div>
                    <button onClick={() => removeBracket(index)} className="mt-4 p-2 text-slate-300 hover:text-rose-500"><Trash2 className="w-4 h-4" /></button>
                </div>
            ))}
            <div className="bg-amber-50 p-3 rounded-lg flex gap-2 items-start mt-4">
                <AlertTriangle className="w-4 h-4 text-amber-500 mt-1 flex-shrink-0"/>
                <p className="text-xs text-amber-700 leading-relaxed">Les tranches doivent être ordonnées. Mettez 999999999 pour l'infini.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};