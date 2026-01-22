// ================================================
// FILE: src/components/Settings.tsx
// ================================================
import React, { useState } from 'react';
import { FiscalConfig, TaxBracket } from '../types';
import { Button } from './Button';
import { Save, AlertTriangle, Settings as SettingsIcon, Plus, Trash2 } from 'lucide-react';

interface SettingsProps {
  config: FiscalConfig;
  onSave: (newConfig: FiscalConfig) => void;
}

export const Settings: React.FC<SettingsProps> = ({ config, onSave }) => {
  const [localConfig, setLocalConfig] = useState<FiscalConfig>(config);

  const handleChange = (field: keyof FiscalConfig, value: any) => {
    setLocalConfig(prev => ({ ...prev, [field]: value }));
  };

  const handleCeilingChange = (key: string, value: number) => {
    setLocalConfig(prev => ({
      ...prev,
      ceilings: { ...prev.ceilings, [key]: value }
    }));
  };

  const updateBracket = (index: number, field: keyof TaxBracket, value: number) => {
    const newBrackets = [...localConfig.taxBrackets];
    newBrackets[index] = { ...newBrackets[index], [field]: value };
    handleChange('taxBrackets', newBrackets);
  };

  const addBracket = () => {
    handleChange('taxBrackets', [...localConfig.taxBrackets, { limit: 0, rate: 0 }]);
  };

  const removeBracket = (index: number) => {
    const newBrackets = localConfig.taxBrackets.filter((_, i) => i !== index);
    handleChange('taxBrackets', newBrackets);
  };

  return (
    <div className="space-y-6 animate-fade-in pb-20">
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex items-center justify-between">
        <div>
          <h2 className="text-xl font-black text-slate-800 flex items-center gap-2">
            <SettingsIcon className="w-6 h-6 text-indigo-600" /> Paramètres Globaux
          </h2>
          <p className="text-sm text-slate-500">
            Modifiez ici les constantes fiscales et sociales. <br/>
            <span className="text-rose-500 font-bold">Attention : Ces changements impactent tous les calculs (IA, Pilotage, Graphiques).</span>
          </p>
        </div>
        <Button onClick={() => onSave(localConfig)} className="gap-2">
          <Save className="w-4 h-4" /> Enregistrer les Paramètres
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Taux & Charges */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200">
          <h3 className="font-bold text-slate-800 mb-4 border-b pb-2">Taux & Charges Sociales</h3>
          <div className="space-y-4">
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase">Charges Salariales (Ex: 0.22 pour 22%)</label>
              <input type="number" step="0.0001" value={localConfig.salaryChargesRate} onChange={e => handleChange('salaryChargesRate', parseFloat(e.target.value))} className="w-full p-2 bg-slate-50 border border-slate-200 rounded font-bold" />
              <p className="text-xs text-slate-400 mt-1">Actuel : {(localConfig.salaryChargesRate * 100).toFixed(2)}% (Impacte calcul salaire Net)</p>
            </div>
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase">Prélèvements Sociaux Capital (CSG/CRDS)</label>
              <input type="number" step="0.001" value={localConfig.socialChargesCapital} onChange={e => handleChange('socialChargesCapital', parseFloat(e.target.value))} className="w-full p-2 bg-slate-50 border border-slate-200 rounded font-bold" />
              <p className="text-xs text-slate-400 mt-1">Actuel : {(localConfig.socialChargesCapital * 100).toFixed(1)}% (Impacte AV, PEA, etc.)</p>
            </div>
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase">Abattement Forfaitaire Impôt (10%)</label>
              <input type="number" step="0.01" value={localConfig.standardAllowance} onChange={e => handleChange('standardAllowance', parseFloat(e.target.value))} className="w-full p-2 bg-slate-50 border border-slate-200 rounded font-bold" />
            </div>
          </div>
        </div>

        {/* Plafonds Livrets */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200">
          <h3 className="font-bold text-slate-800 mb-4 border-b pb-2">Plafonds Réglementés (€)</h3>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
                <div>
                    <label className="text-[10px] font-black text-indigo-600 uppercase">Livret A</label>
                    <input type="number" value={localConfig.ceilings.livretA} onChange={e => handleCeilingChange('livretA', parseFloat(e.target.value))} className="w-full p-2 bg-indigo-50 border border-indigo-100 rounded font-bold" />
                </div>
                <div>
                    <label className="text-[10px] font-black text-emerald-600 uppercase">LDDS</label>
                    <input type="number" value={localConfig.ceilings.ldds} onChange={e => handleCeilingChange('ldds', parseFloat(e.target.value))} className="w-full p-2 bg-emerald-50 border border-emerald-100 rounded font-bold" />
                </div>
                <div>
                    <label className="text-[10px] font-black text-rose-600 uppercase">LEP</label>
                    <input type="number" value={localConfig.ceilings.lep} onChange={e => handleCeilingChange('lep', parseFloat(e.target.value))} className="w-full p-2 bg-rose-50 border border-rose-100 rounded font-bold" />
                </div>
            </div>
          </div>
        </div>

        {/* Barème Impôts */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 lg:col-span-2">
          <div className="flex justify-between items-center mb-4 border-b pb-2">
            <h3 className="font-bold text-slate-800">Barème Progressif de l'Impôt</h3>
            <button onClick={addBracket} className="text-xs flex items-center gap-1 bg-slate-100 px-2 py-1 rounded hover:bg-slate-200"><Plus className="w-3 h-3"/> Ajouter tranche</button>
          </div>
          
          <div className="space-y-2">
            {localConfig.taxBrackets.map((bracket, index) => (
                <div key={index} className="flex items-center gap-4">
                    <div className="flex-1">
                        <label className="text-[8px] uppercase font-bold text-slate-400">Limite Supérieure (€)</label>
                        <input type="number" value={bracket.limit === Infinity ? 999999999 : bracket.limit} onChange={e => updateBracket(index, 'limit', parseFloat(e.target.value))} className="w-full p-2 bg-slate-50 border border-slate-200 rounded text-sm" />
                    </div>
                    <div className="w-32">
                        <label className="text-[8px] uppercase font-bold text-slate-400">Taux (0.11 = 11%)</label>
                        <input type="number" step="0.01" value={bracket.rate} onChange={e => updateBracket(index, 'rate', parseFloat(e.target.value))} className="w-full p-2 bg-slate-50 border border-slate-200 rounded text-sm font-bold text-indigo-600" />
                    </div>
                    <button onClick={() => removeBracket(index)} className="mt-4 p-2 text-slate-300 hover:text-rose-500"><Trash2 className="w-4 h-4" /></button>
                </div>
            ))}
            <div className="bg-amber-50 p-3 rounded-lg flex gap-2 items-start mt-4">
                <AlertTriangle className="w-4 h-4 text-amber-500 mt-1 flex-shrink-0"/>
                <p className="text-xs text-amber-700 leading-relaxed">
                    Le système utilise ce barème pour estimer votre impôt. Assurez-vous que les tranches sont ordonnées de la plus petite à la plus grande. Mettez "999999999" pour l'infini.
                </p>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
};