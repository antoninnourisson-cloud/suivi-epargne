// ================================================
// FILE: src/components/Settings.tsx
// ================================================
import React, { useEffect, useState } from 'react';
import { FiscalConfig, TaxBracket, WorkBenefits } from '../types';
import { Button } from './Button';
import { Save, AlertTriangle, Settings as SettingsIcon, Plus, Trash2, Mail, Download, Upload, Database, KeyRound, FileText, Fingerprint, Hash } from 'lucide-react';
import { isLockAvailable, isBiometricEnabled, isPinEnabled, enableLock, disableBiometric, enablePin, disablePin } from '../services/appLockService';

interface SettingsProps {
  config: FiscalConfig;
  workBenefits: WorkBenefits;
  parentsEmail: string; // <--- Prop
  geminiApiKey: string;
  pickerApiKey: string;
  onSave: (newConfig: FiscalConfig, newBenefits: WorkBenefits, newEmail: string, newGeminiKey: string, newPickerKey: string) => void;
  onExport: () => void;
  onImport: (file: File) => Promise<boolean>;
}

export const Settings: React.FC<SettingsProps> = ({ config, workBenefits, parentsEmail, geminiApiKey, pickerApiKey, onSave, onExport, onImport }) => {
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const ok = await onImport(file);
    setImportMsg(ok ? '✅ Données importées (sauvegarde en cours).' : '❌ Fichier invalide.');
    e.target.value = '';
  };

  const [localFiscal, setLocalFiscal] = useState<FiscalConfig>(config);
  const [localBenefits, setLocalBenefits] = useState<WorkBenefits>(workBenefits);
  const [localEmail, setLocalEmail] = useState<string>(parentsEmail || '');
  const [localGeminiKey, setLocalGeminiKey] = useState<string>(geminiApiKey || '');
  const [localPickerKey, setLocalPickerKey] = useState<string>(pickerApiKey || '');

  // Verrou (biométrie et/ou PIN) : réglage 100% local à cet appareil (localStorage), donc
  // en dehors du circuit onSave/Drive utilisé par le reste de cet écran — une empreinte ou
  // un code enregistrés sur ce téléphone n'ont aucun sens synchronisés sur un autre appareil.
  const [lockAvailable, setLockAvailable] = useState(false);
  const [biometricOn, setBiometricOn] = useState(isBiometricEnabled());
  const [lockError, setLockError] = useState<string | null>(null);
  useEffect(() => { isLockAvailable().then(setLockAvailable); }, []);

  const toggleBiometric = async () => {
    setLockError(null);
    if (biometricOn) {
      disableBiometric();
      setBiometricOn(false);
      return;
    }
    try {
      await enableLock();
      setBiometricOn(true);
    } catch {
      setLockError("Activation annulée ou échouée. Réessaie, ou vérifie que Face ID / l'empreinte est configuré sur cet appareil.");
    }
  };

  const [pinOn, setPinOn] = useState(isPinEnabled());
  const [pinDraft, setPinDraft] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [settingPin, setSettingPin] = useState(false);

  const submitPinSetup = async () => {
    setPinError(null);
    if (!/^\d{4,8}$/.test(pinDraft)) {
      setPinError('Le code doit faire entre 4 et 8 chiffres.');
      return;
    }
    await enablePin(pinDraft);
    setPinOn(true);
    setSettingPin(false);
    setPinDraft('');
  };

  const togglePin = () => {
    if (pinOn) {
      disablePin();
      setPinOn(false);
      return;
    }
    setSettingPin(true);
  };

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
      <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm flex items-center justify-between">
        <div>
          <h2 className="text-xl font-black text-slate-800 dark:text-slate-100 flex items-center gap-2"><SettingsIcon className="w-6 h-6 text-indigo-600" /> Paramètres Globaux</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">Ajustez la fiscalité et vos avantages salariaux.</p>
        </div>
        <Button onClick={() => onSave(localFiscal, localBenefits, localEmail, localGeminiKey, localPickerKey)} className="gap-2"><Save className="w-4 h-4" /> Enregistrer Tout</Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* SECTION SAUVEGARDE */}
        <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 lg:col-span-2">
          <h3 className="font-bold text-slate-800 dark:text-slate-100 mb-4 border-b border-slate-200 dark:border-slate-700 pb-2 flex items-center gap-2"><Database className="w-4 h-4 text-indigo-600" /> Sauvegarde des données</h3>
          <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
            <button onClick={onExport} className="flex items-center gap-2 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 px-4 py-2 rounded-xl font-bold text-sm"><Download className="w-4 h-4" /> Exporter (JSON)</button>
            <label className="flex items-center gap-2 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 px-4 py-2 rounded-xl font-bold text-sm cursor-pointer">
              <Upload className="w-4 h-4" /> Importer un fichier
              <input type="file" accept="application/json" onChange={handleImportFile} className="hidden" />
            </label>
            {importMsg && <span className="text-xs font-bold text-slate-500 dark:text-slate-400">{importMsg}</span>}
          </div>
          <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-3">Un export télécharge une copie locale de toutes vos données. L'import remplace les données actuelles puis les resynchronise sur Drive.</p>
        </div>

        {/* SECTION EMAIL */}
        <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 lg:col-span-2">
            <h3 className="font-bold text-slate-800 dark:text-slate-100 mb-4 border-b border-slate-200 dark:border-slate-700 pb-2 flex items-center gap-2"><Mail className="w-4 h-4 text-indigo-600"/> Notification Parents</h3>
            <div className="bg-slate-50 dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-700">
                <label className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase block mb-2">Email destinataire (Alertes Livret A / LEP)</label>
                <input 
                    type="email" 
                    value={localEmail} 
                    onChange={e => setLocalEmail(e.target.value)} 
                    placeholder="parents@exemple.com"
                    className="w-full p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl font-bold text-slate-800 dark:text-slate-100"
                />
                <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-2 flex items-start gap-1">
                    <span className="text-indigo-600 font-bold">Note :</span>
                    Un email récapitulatif sera envoyé automatiquement depuis VOTRE compte Gmail à cette adresse uniquement lorsqu'un mouvement est détecté sur un Livret A ou un LEP.
                </p>
            </div>
        </div>

        {/* SECTION FICHES DE PAIE (IA) */}
        <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 lg:col-span-2">
            <h3 className="font-bold text-slate-800 dark:text-slate-100 mb-4 border-b border-slate-200 dark:border-slate-700 pb-2 flex items-center gap-2"><FileText className="w-4 h-4 text-indigo-600"/> Fiches de paie (analyse IA)</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-slate-50 dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-700">
                    <label className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase block mb-2 flex items-center gap-1"><KeyRound className="w-3 h-3"/> Clé API Gemini</label>
                    <input
                        type="password"
                        autoComplete="off"
                        value={localGeminiKey}
                        onChange={e => setLocalGeminiKey(e.target.value)}
                        placeholder="AIza..."
                        className="w-full p-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-bold text-slate-800 dark:text-slate-100"
                    />
                    <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-2">Sert à extraire automatiquement les montants d'une fiche de paie importée. Créée sur <span className="font-bold">Google AI Studio</span>.</p>
                </div>
                <div className="bg-slate-50 dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-700">
                    <label className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase block mb-2 flex items-center gap-1"><KeyRound className="w-3 h-3"/> Clé API Google Picker</label>
                    <input
                        type="password"
                        autoComplete="off"
                        value={localPickerKey}
                        onChange={e => setLocalPickerKey(e.target.value)}
                        placeholder="AIza..."
                        className="w-full p-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-bold text-slate-800 dark:text-slate-100"
                    />
                    <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-2">Permet de choisir une fiche déjà présente sur votre Drive. Créée dans <span className="font-bold">Google Cloud Console</span>, restreinte à l'API Picker.</p>
                </div>
            </div>
            <div className="mt-4 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-lg p-3 flex gap-2 items-start">
                <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0"/>
                <p className="text-xs text-amber-700 dark:text-amber-300 leading-relaxed">Ces clés sont stockées en clair dans votre fichier sur Drive (comme le reste de vos réglages) — jamais envoyées ailleurs qu'à Google. Chaque extraction utilise votre propre quota Gemini.</p>
            </div>
        </div>

        {/* SECTION SÉCURITÉ (réglages locaux à cet appareil, non synchronisés) */}
        <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 lg:col-span-2 space-y-4">
            <h3 className="font-bold text-slate-800 dark:text-slate-100 mb-2 border-b border-slate-200 dark:border-slate-700 pb-2 flex items-center gap-2"><Fingerprint className="w-4 h-4 text-indigo-600"/> Sécurité</h3>
            <p className="text-[11px] text-slate-400 dark:text-slate-500 -mt-2">Verrouille l'accès à cet appareil (réglage propre à ce navigateur, jamais synchronisé sur Drive). Les deux méthodes peuvent être actives en même temps. Protège contre un accès occasionnel — pas une garantie cryptographique absolue sur un site sans serveur.</p>

            {!lockAvailable ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">Face ID / empreinte / Windows Hello non disponible sur cet appareil ou ce navigateur — seul le code PIN est proposé.</p>
            ) : (
                <div className="flex items-center justify-between gap-4 bg-slate-50 dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-700">
                    <div>
                        <p className="font-bold text-slate-800 dark:text-slate-100 text-sm">Verrou biométrique</p>
                        <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1 max-w-md">Face ID / empreinte / Windows Hello à chaque ouverture de l'app.</p>
                        {lockError && <p className="text-[11px] text-rose-600 dark:text-rose-400 mt-2 font-bold">{lockError}</p>}
                    </div>
                    <button
                        onClick={toggleBiometric}
                        className={`flex-shrink-0 px-4 py-2 rounded-xl font-bold text-sm ${biometricOn ? 'bg-emerald-600 hover:bg-emerald-700 text-white' : 'bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200'}`}
                    >
                        {biometricOn ? 'Activé' : 'Désactivé'}
                    </button>
                </div>
            )}

            <div className="bg-slate-50 dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-700">
                <div className="flex items-center justify-between gap-4">
                    <div>
                        <p className="font-bold text-slate-800 dark:text-slate-100 text-sm flex items-center gap-1.5"><Hash className="w-3.5 h-3.5"/> Code PIN</p>
                        <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1 max-w-md">4 à 8 chiffres, en repli si la biométrie n'est pas disponible ou par préférence.</p>
                    </div>
                    <button
                        onClick={togglePin}
                        className={`flex-shrink-0 px-4 py-2 rounded-xl font-bold text-sm ${pinOn ? 'bg-emerald-600 hover:bg-emerald-700 text-white' : 'bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200'}`}
                    >
                        {pinOn ? 'Activé' : 'Désactivé'}
                    </button>
                </div>
                {settingPin && (
                    <div className="mt-3 flex items-center gap-2">
                        <input
                            type="password"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            maxLength={8}
                            value={pinDraft}
                            onChange={e => setPinDraft(e.target.value.replace(/\D/g, ''))}
                            placeholder="Nouveau code (4-8 chiffres)"
                            className="flex-1 p-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg font-bold text-slate-800 dark:text-slate-100"
                            autoFocus
                        />
                        <button onClick={submitPinSetup} className="px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-bold text-sm">Définir</button>
                        <button onClick={() => { setSettingPin(false); setPinDraft(''); setPinError(null); }} className="px-3 py-2 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 rounded-lg font-bold text-sm">Annuler</button>
                    </div>
                )}
                {pinError && <p className="text-[11px] text-rose-600 dark:text-rose-400 mt-2 font-bold">{pinError}</p>}
            </div>
        </div>

        {/* SECTION 1: AVANTAGES SALARIAUX */}
        <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 lg:col-span-2">
           <h3 className="font-bold text-slate-800 dark:text-slate-100 mb-4 border-b border-slate-200 dark:border-slate-700 pb-2 flex items-center gap-2">🏢 Avantages & Prélèvements Entreprise</h3>
           <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
               {/* NAVIGO */}
               <div className="bg-indigo-50 dark:bg-indigo-950/40 p-4 rounded-xl border border-indigo-100 dark:border-indigo-900">
                   <label className="flex items-center gap-2 font-black text-xs uppercase text-indigo-600 dark:text-indigo-300 mb-3 cursor-pointer">
                       <input type="checkbox" checked={localBenefits.navigo.active} onChange={e => updateBenefit('navigo', 'active', e.target.checked)} className="accent-indigo-600"/>
                       Transport (Navigo)
                   </label>
                   {localBenefits.navigo.active && (
                       <div className="space-y-2">
                           <div><label className="text-[9px] font-bold text-slate-400 dark:text-slate-500">Prix Base Mensuel (€)</label><input type="number" value={localBenefits.navigo.basePrice} onChange={e => updateBenefit('navigo', 'basePrice', parseFloat(e.target.value))} className="w-full p-2 rounded border border-indigo-200 dark:border-indigo-800 bg-white dark:bg-slate-800 text-sm font-bold text-slate-800 dark:text-slate-100"/></div>
                           <div><label className="text-[9px] font-bold text-slate-400 dark:text-slate-500">Remboursement (%)</label><input type="number" value={localBenefits.navigo.refundRate} onChange={e => updateBenefit('navigo', 'refundRate', parseFloat(e.target.value))} className="w-full p-2 rounded border border-indigo-200 dark:border-indigo-800 bg-white dark:bg-slate-800 text-sm font-bold text-slate-800 dark:text-slate-100"/></div>
                           <p className="text-[9px] text-emerald-600 dark:text-emerald-400 text-right mt-1">+{(localBenefits.navigo.basePrice * localBenefits.navigo.refundRate / 100).toFixed(2)}€/mois (Gain)</p>
                       </div>
                   )}
               </div>

               {/* MUTUELLE */}
               <div className="bg-rose-50 dark:bg-rose-950/40 p-4 rounded-xl border border-rose-100 dark:border-rose-900">
                   <label className="flex items-center gap-2 font-black text-xs uppercase text-rose-600 dark:text-rose-300 mb-3 cursor-pointer">
                       <input type="checkbox" checked={localBenefits.mutuelle.active} onChange={e => updateBenefit('mutuelle', 'active', e.target.checked)} className="accent-rose-600"/>
                       Mutuelle Santé
                   </label>
                   {localBenefits.mutuelle.active && (
                       <div className="space-y-2">
                           <div><label className="text-[9px] font-bold text-slate-400 dark:text-slate-500">Coût Contrat Total (€)</label><input type="number" value={localBenefits.mutuelle.totalCost} onChange={e => updateBenefit('mutuelle', 'totalCost', parseFloat(e.target.value))} className="w-full p-2 rounded border border-rose-200 dark:border-rose-800 bg-white dark:bg-slate-800 text-sm font-bold text-slate-800 dark:text-slate-100"/></div>
                           <div><label className="text-[9px] font-bold text-slate-400 dark:text-slate-500">Prise en charge Boite (%)</label><input type="number" value={localBenefits.mutuelle.employerRate} onChange={e => updateBenefit('mutuelle', 'employerRate', parseFloat(e.target.value))} className="w-full p-2 rounded border border-rose-200 dark:border-rose-800 bg-white dark:bg-slate-800 text-sm font-bold text-slate-800 dark:text-slate-100"/></div>
                           <p className="text-[9px] text-rose-600 dark:text-rose-400 text-right mt-1">-{(localBenefits.mutuelle.totalCost * (1 - localBenefits.mutuelle.employerRate/100)).toFixed(2)}€/mois (Coût)</p>
                       </div>
                   )}
               </div>

               {/* TICKETS RESTO */}
               <div className="bg-emerald-50 dark:bg-emerald-950/40 p-4 rounded-xl border border-emerald-100 dark:border-emerald-900">
                   <label className="flex items-center gap-2 font-black text-xs uppercase text-emerald-600 dark:text-emerald-300 mb-3 cursor-pointer">
                       <input type="checkbox" checked={localBenefits.mealVouchers.active} onChange={e => updateBenefit('mealVouchers', 'active', e.target.checked)} className="accent-emerald-600"/>
                       Titres Restaurant
                   </label>
                   {localBenefits.mealVouchers.active && (
                       <div className="space-y-2">
                           <div className="grid grid-cols-2 gap-2">
                               <div><label className="text-[9px] font-bold text-slate-400 dark:text-slate-500">Valeur (€)</label><input type="number" value={localBenefits.mealVouchers.faceValue} onChange={e => updateBenefit('mealVouchers', 'faceValue', parseFloat(e.target.value))} className="w-full p-2 rounded border border-emerald-200 dark:border-emerald-800 bg-white dark:bg-slate-800 text-sm font-bold text-slate-800 dark:text-slate-100"/></div>
                               <div><label className="text-[9px] font-bold text-slate-400 dark:text-slate-500">Jours/Mois</label><input type="number" value={localBenefits.mealVouchers.daysPerMonth} onChange={e => updateBenefit('mealVouchers', 'daysPerMonth', parseFloat(e.target.value))} className="w-full p-2 rounded border border-emerald-200 dark:border-emerald-800 bg-white dark:bg-slate-800 text-sm font-bold text-slate-800 dark:text-slate-100"/></div>
                           </div>
                           <div><label className="text-[9px] font-bold text-slate-400 dark:text-slate-500">Prise en charge Boite (%)</label><input type="number" value={localBenefits.mealVouchers.employerRate} onChange={e => updateBenefit('mealVouchers', 'employerRate', parseFloat(e.target.value))} className="w-full p-2 rounded border border-emerald-200 dark:border-emerald-800 bg-white dark:bg-slate-800 text-sm font-bold text-slate-800 dark:text-slate-100"/></div>
                           <p className="text-[9px] text-emerald-600 dark:text-emerald-400 text-right mt-1">-{(localBenefits.mealVouchers.faceValue * localBenefits.mealVouchers.daysPerMonth * (1 - localBenefits.mealVouchers.employerRate/100)).toFixed(2)}€/mois (Coût)</p>
                       </div>
                   )}
               </div>
           </div>
        </div>

        {/* SECTION 2: PARAMÈTRES FISCAUX */}
        <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700">
          <h3 className="font-bold text-slate-800 dark:text-slate-100 mb-4 border-b border-slate-200 dark:border-slate-700 pb-2">⚖️ Fiscalité & Social</h3>
          <div className="space-y-4">
            <div>
              <label className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase">Charges Salariales (Ex: 0.2232)</label>
              <input type="number" step="0.0001" value={localFiscal.salaryChargesRate} onChange={e => handleFiscalChange('salaryChargesRate', parseFloat(e.target.value))} className="w-full p-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded font-bold" />
            </div>
            <div>
              <label className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase">Abattement Forfaitaire Impôt (Ex: 0.10)</label>
              <input type="number" step="0.01" value={localFiscal.standardAllowance} onChange={e => handleFiscalChange('standardAllowance', parseFloat(e.target.value))} className="w-full p-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded font-bold" />
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700">
          <h3 className="font-bold text-slate-800 dark:text-slate-100 mb-4 border-b border-slate-200 dark:border-slate-700 pb-2">📈 Plafonds Livrets (€)</h3>
          <div className="grid grid-cols-2 gap-4">
              <div><label className="text-[10px] text-indigo-600 dark:text-indigo-300 font-black uppercase">Livret A</label><input type="number" value={localFiscal.ceilings.livretA} onChange={e => handleCeilingChange('livretA', parseFloat(e.target.value))} className="w-full p-2 bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-100 dark:border-indigo-900 rounded font-bold text-slate-800 dark:text-slate-100" /></div>
              <div><label className="text-[10px] text-rose-600 dark:text-rose-300 font-black uppercase">LEP</label><input type="number" value={localFiscal.ceilings.lep} onChange={e => handleCeilingChange('lep', parseFloat(e.target.value))} className="w-full p-2 bg-rose-50 dark:bg-rose-950/40 border border-rose-100 dark:border-rose-900 rounded font-bold text-slate-800 dark:text-slate-100" /></div>
          </div>
        </div>

        {/* SECTION 3: BARÈME IMPÔT */}
        <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 lg:col-span-2">
          <div className="flex justify-between items-center mb-4 border-b border-slate-200 dark:border-slate-700 pb-2">
            <h3 className="font-bold text-slate-800 dark:text-slate-100">🏛️ Barème Impôt sur le Revenu</h3>
            <button onClick={addBracket} className="text-xs flex items-center gap-1 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 px-2 py-1 rounded hover:bg-slate-200 dark:hover:bg-slate-600"><Plus className="w-3 h-3"/> Ajouter tranche</button>
          </div>
          <div className="space-y-2">
            {localFiscal.taxBrackets.map((bracket, index) => (
                <div key={index} className="flex items-center gap-4">
                    <div className="flex-1">
                        <label className="text-[8px] uppercase font-bold text-slate-400 dark:text-slate-500">Limite Sup (€)</label>
                        <input type="number" value={bracket.limit === Infinity ? 999999999 : bracket.limit} onChange={e => updateBracket(index, 'limit', parseFloat(e.target.value))} className="w-full p-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded text-sm text-slate-800 dark:text-slate-100" />
                    </div>
                    <div className="w-32">
                        <label className="text-[8px] uppercase font-bold text-slate-400 dark:text-slate-500">Taux (0.11)</label>
                        <input type="number" step="0.01" value={bracket.rate} onChange={e => updateBracket(index, 'rate', parseFloat(e.target.value))} className="w-full p-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded text-sm font-bold text-indigo-600 dark:text-indigo-300" />
                    </div>
                    <button onClick={() => removeBracket(index)} className="mt-4 p-2 text-slate-300 hover:text-rose-500"><Trash2 className="w-4 h-4" /></button>
                </div>
            ))}
            <div className="bg-amber-50 dark:bg-amber-950/40 p-3 rounded-lg flex gap-2 items-start mt-4">
                <AlertTriangle className="w-4 h-4 text-amber-500 mt-1 flex-shrink-0"/>
                <p className="text-xs text-amber-700 dark:text-amber-300 leading-relaxed">Les tranches doivent être ordonnées. Mettez 999999999 pour l'infini.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};