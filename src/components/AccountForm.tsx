// ================================================
// FILE: src/components/AccountForm.tsx
// ================================================
import React, { useState, useEffect } from 'react';
import { AccountType, SavingsAccount, FiscalConfig } from '../types';
import { Button } from './Button';
import { NumberInput } from './NumberInput';
import { localTodayISO } from '../lib/dates';
import { parseFrenchNumber } from '../lib/numbers';
import { tracksDeposits, PEA_DEPOSIT_CEILING, applyRateChange } from '../lib/finance';
import { PlusCircle, Save, Users, Calculator, Tag, X, History } from 'lucide-react';
import { formatEUR } from '../lib/format';

interface AccountFormProps {
  onSave: (account: SavingsAccount) => void;
  // Faux en mode solo (plus aucune part parentale) : le champ n'est plus proposé.
  showParental?: boolean;
  initialData?: SavingsAccount;
  onCancel?: () => void;
  fiscalConfig: FiscalConfig;
}

export const AccountForm: React.FC<AccountFormProps> = ({ onSave, initialData, onCancel, fiscalConfig, showParental = true }) => {
  const [type, setType] = useState<AccountType>(initialData?.type || AccountType.LIVRET_A);
  const [name, setName] = useState(initialData?.name || '');
  const [institution, setInstitution] = useState(initialData?.institution || '');
  const [totalAmount, setTotalAmount] = useState<number>(initialData?.totalAmount || 0);
  const [parentalCapital, setParentalCapital] = useState<number>(initialData?.parentalCapital || 0);
  const [ownedAmount, setOwnedAmount] = useState<number>(initialData?.ownedAmount || 0);
  const [interestRate, setInterestRate] = useState<string>(initialData?.interestRate?.toString() || '');
  const [openingDate, setOpeningDate] = useState(initialData?.openingDate || '');
  const [contractEndDate, setContractEndDate] = useState(initialData?.contractEndDate || '');
  const [ceiling, setCeiling] = useState<number>(initialData?.ceiling || 0);
  const [tags, setTags] = useState<string[]>(initialData?.tags || []);
  const [tagInput, setTagInput] = useState('');
  const [rateEffectiveDate, setRateEffectiveDate] = useState(localTodayISO());
  const [euroFundPct, setEuroFundPct] = useState(initialData?.euroFundPct !== undefined ? String(initialData.euroFundPct) : '');
  const [managementFee, setManagementFee] = useState(initialData?.managementFee !== undefined ? String(initialData.managementFee).replace('.', ',') : '');
  const showFee = [AccountType.ASSURANCE_VIE, AccountType.PEA, AccountType.PER].includes(type);
  // Texte et non nombre : vide = versements inconnus (différent de 0 €).
  const [totalDeposits, setTotalDeposits] = useState(initialData?.totalDeposits !== undefined ? String(initialData.totalDeposits) : '');
  const showDeposits = tracksDeposits(type);
  const parsedDeposits = totalDeposits.trim() === '' ? undefined : parseFrenchNumber(totalDeposits);

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
    const rest = Math.round((totalAmount - owned) * 100) / 100;
    if (rest >= 0) {
      setParentalCapital(rest);
    } else {
      // Ma part saisie dépasse le total : plutôt que de laisser le formulaire afficher des
      // nombres incohérents (silencieusement renormalisés à la sauvegarde, en GONFLANT le
      // total), on maintient l'invariant total = ma part + parents immédiatement.
      setParentalCapital(0);
      setTotalAmount(owned);
    }
  };

  // Raccourcis de création : choisissent le type (et un nom par défaut modifiable).
  const PRESETS: { type: AccountType; label: string }[] = [
    { type: AccountType.LIVRET_A, label: 'Livret A' },
    { type: AccountType.LDDS, label: 'LDDS' },
    { type: AccountType.LEP, label: 'LEP' },
    { type: AccountType.ASSURANCE_VIE, label: 'Assurance vie' },
    { type: AccountType.PEA, label: 'PEA' },
    { type: AccountType.COMPTE_COURANT, label: 'Compte courant' },
  ];
  const applyPreset = (t: AccountType, label: string) => {
    setType(t);
    if (!name.trim() || PRESETS.some(p => p.label === name)) setName(label);
  };

  const addTag = () => {
    const t = tagInput.trim();
    if (t && !tags.includes(t)) setTags([...tags, t]);
    setTagInput('');
  };
  const removeTag = (t: string) => setTags(tags.filter(x => x !== t));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // parseFrenchNumber et non parseFloat : « 2,4 » donnait 2 %.
    const newRate = parseFrenchNumber(interestRate) ?? 0;

    // Historise l'ancien taux s'il a changé, à la date d'effet choisie (par défaut
    // aujourd'hui) : un taux passé à 1,7 % le 1er août se saisit encore en octobre.
    let rateHistory = initialData?.rateHistory || [];
    if (initialData && initialData.interestRate !== undefined && initialData.interestRate !== newRate) {
      rateHistory = applyRateChange(initialData, newRate, rateEffectiveDate || localTodayISO()).rateHistory || [];
    }

    onSave({
      id: initialData?.id || crypto.randomUUID(),
      // Espaces superflus retirés : « BPVF » et « BPVF  » apparaissaient comme deux établissements.
      name: name.trim().replace(/\s+/g, ' ') || `${type} - ${institution.trim()}`,
      type,
      institution: institution.trim().replace(/\s+/g, ' '),
      totalAmount,
      ownedAmount,
      parentalCapital,
      interestRate: newRate,
      openingDate,
      contractEndDate: type === AccountType.PEE ? contractEndDate : undefined,
      ceiling: ceiling || undefined,
      isTaxable: isTaxableType,
      rateHistory: rateHistory.length > 0 ? rateHistory : undefined,
      tags: tags.length > 0 ? tags : undefined,
      euroFundPct: type === AccountType.ASSURANCE_VIE && euroFundPct.trim() !== '' && (parseFrenchNumber(euroFundPct) ?? -1) >= 0 ? Math.min(100, parseFrenchNumber(euroFundPct)!) : undefined,
      managementFee: showFee && managementFee.trim() !== '' && (parseFrenchNumber(managementFee) ?? -1) >= 0 ? parseFrenchNumber(managementFee)! : undefined,
      totalDeposits: showDeposits && parsedDeposits !== null && parsedDeposits !== undefined && parsedDeposits >= 0 ? parsedDeposits : undefined,
    });
  };

  const moneyInputClass = "w-full bg-transparent font-black text-slate-800 dark:text-slate-100 text-lg rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";

  return (
    <div className="space-y-6">

      <form onSubmit={handleSubmit} className="bg-white dark:bg-slate-800 p-6 rounded-3xl shadow-sm border border-slate-200 dark:border-slate-700">
        <h3 className="text-lg font-black text-slate-800 dark:text-slate-100 mb-6 flex items-center gap-2">
          {initialData ? <Save className="w-5 h-5 text-indigo-600" aria-hidden="true" /> : <PlusCircle className="w-5 h-5 text-indigo-600" aria-hidden="true" />}
          {initialData ? `Modifier « ${initialData.name} »` : 'Nouveau compte'}
        </h3>
        {!initialData && (
          <div className="mb-5">
            <p className="text-[11px] font-black text-slate-600 dark:text-slate-300 uppercase mb-2">Type de compte</p>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Raccourcis de type de compte">
              {PRESETS.map(p => (
                <button key={p.type} type="button" aria-pressed={type === p.type} onClick={() => applyPreset(p.type, p.label)}
                  className={`px-3 py-1.5 rounded-full text-xs font-bold border ${type === p.type ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:border-indigo-400'}`}>{p.label}</button>
              ))}
            </div>
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2"><label htmlFor="acc-name" className="text-[11px] font-black text-slate-600 dark:text-slate-300 uppercase block mb-1">Nom du compte</label><input id="acc-name" type="text" value={name} onChange={e => setName(e.target.value)} placeholder={`${type}${institution ? ` - ${institution}` : ''}`} className="w-full p-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl font-bold" /></div>
          <div><label htmlFor="acc-type" className="text-[11px] font-black text-slate-600 dark:text-slate-300 uppercase block mb-1">Type</label><select id="acc-type" value={type} onChange={(e) => setType(e.target.value as AccountType)} className="w-full p-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl font-bold">{Object.values(AccountType).map(t => <option key={t} value={t}>{t}</option>)}</select></div>
          <div><label htmlFor="acc-bank" className="text-[11px] font-black text-slate-600 dark:text-slate-300 uppercase block mb-1">Banque <span aria-hidden="true" className="text-rose-600">*</span></label><input id="acc-bank" type="text" value={institution} onChange={e => setInstitution(e.target.value)} className="w-full p-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl font-bold" required /></div>

          <div className="md:col-span-2 bg-indigo-50 dark:bg-indigo-950/40 p-5 rounded-2xl border border-indigo-100 dark:border-indigo-900">
            <label className="flex items-center gap-2 text-[11px] font-black text-indigo-700 dark:text-indigo-300 uppercase mb-4"><Calculator className="w-4 h-4" /> Répartition du capital</label>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-white dark:bg-slate-900 p-3 rounded-xl border border-indigo-100 dark:border-indigo-900"><label className="text-[11px] font-black text-indigo-700 dark:text-indigo-300 block mb-1">Solde total (€)</label><NumberInput ariaLabel="Solde total (€)" value={totalAmount} onChange={handleTotalChange} className={moneyInputClass} min={0} /></div>
              {showParental && (<div className="bg-white dark:bg-slate-900 p-3 rounded-xl border border-amber-100 dark:border-amber-900"><label className="text-[11px] font-black text-amber-700 dark:text-amber-300 block mb-1"><Users className="w-3 h-3" /> Part des parents (€)</label><NumberInput ariaLabel="Part des parents (€)" value={parentalCapital} onChange={handleParentalChange} className={`${moneyInputClass} text-amber-700 dark:text-amber-300`} min={0} /></div>)}
              <div className="bg-white dark:bg-slate-900 p-3 rounded-xl border border-emerald-100 dark:border-emerald-900"><label className="text-[11px] font-black text-emerald-700 dark:text-emerald-300 block mb-1">Ma part nette (€)</label><NumberInput ariaLabel="Ma part nette (€)" value={ownedAmount} onChange={handleOwnedChange} className={`${moneyInputClass} text-emerald-800 dark:text-emerald-300`} min={0} /></div>
            </div>
          </div>

          <div className="md:col-span-2 grid grid-cols-2 md:grid-cols-3 gap-4 bg-slate-50 dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-700">
            <div>
              <label className="text-[11px] font-black text-slate-500 dark:text-slate-400 uppercase mb-1 flex items-center gap-1">Taux actuel (%)</label>
              <input type="text" inputMode="decimal" value={interestRate} onChange={e => setInterestRate(e.target.value)} className="w-full p-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-bold" />
              {initialData && initialData.interestRate !== undefined && parseFrenchNumber(interestRate) !== null && parseFrenchNumber(interestRate) !== initialData.interestRate && (
                <label className="block mt-2">
                  <span className="text-[11px] font-black text-slate-500 dark:text-slate-400 uppercase">Nouveau taux à partir du</span>
                  <input type="date" value={rateEffectiveDate} onChange={e => setRateEffectiveDate(e.target.value)} className="block w-full p-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg font-bold text-sm" />
                </label>
              )}
              {initialData?.rateHistory && initialData.rateHistory.length > 0 && (
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 flex items-center gap-1"><History className="w-3 h-3" /> {initialData.rateHistory.length} changement(s) historisé(s)</p>
              )}
            </div>
            {!isTaxableType && <div><label className="text-[11px] font-black text-slate-500 dark:text-slate-400 uppercase mb-1">Plafond (€)</label><NumberInput ariaLabel="Plafond (€)" value={ceiling} onChange={setCeiling} className="w-full p-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-bold" min={0} /></div>}
            {showFee && (
              <div className="col-span-2">
                <label className="text-[11px] font-black text-slate-500 dark:text-slate-400 uppercase mb-1 block">Frais de gestion annuels (%)</label>
                <input type="text" inputMode="decimal" value={managementFee} onChange={e => setManagementFee(e.target.value)} placeholder="0" className="w-full p-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-bold" />
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">Facultatif. Le taux servi d'un fonds euros est déjà net de frais : laissez vide. Pour des unités de compte, indiquez les frais du contrat (souvent 0,5 à 0,85 %).</p>
              </div>
            )}
            {type === AccountType.ASSURANCE_VIE && (
              <div className="col-span-2">
                <label htmlFor="acc-eurofund" className="text-[11px] font-black text-slate-600 dark:text-slate-300 uppercase mb-1 block">Part en fonds euros (%)</label>
                <input id="acc-eurofund" type="text" inputMode="decimal" value={euroFundPct} onChange={e => setEuroFundPct(e.target.value)} placeholder="100" className="w-full p-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-bold" />
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">Facultatif. Sur le fonds euros, les prélèvements sociaux sont déjà retenus chaque année : un retrait ne les redoit pas. 100 si tout est en fonds euros.</p>
              </div>
            )}
            {showDeposits && (
              <div className="col-span-2">
                <label className="text-[11px] font-black text-slate-500 dark:text-slate-400 uppercase mb-1 block">Versements cumulés (€)</label>
                <input type="text" inputMode="decimal" value={totalDeposits} onChange={e => setTotalDeposits(e.target.value)} placeholder="Inconnu" className="w-full p-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-bold" />
                {parsedDeposits === null && <p className="text-[11px] text-rose-600 mt-1">Montant non reconnu : il ne sera pas enregistré.</p>}
                {parsedDeposits !== null && parsedDeposits !== undefined && totalAmount > 0 && (
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">Plus-value latente : <b>{formatEUR(totalAmount - parsedDeposits, 0)}</b>{type === AccountType.PEA && <> · reste {formatEUR(Math.max(0, PEA_DEPOSIT_CEILING - parsedDeposits))} de versements possibles</>}</p>
                )}
                {parsedDeposits === undefined && <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">Ce que vous avez versé, hors gains (voir votre relevé). Sert au calcul exact de l'impôt en cas de retrait.</p>}
              </div>
            )}
          </div>

          <div><label className="text-[11px] font-black text-slate-500 dark:text-slate-400 uppercase mb-1">Date d'ouverture</label><input type="date" value={openingDate} onChange={e => setOpeningDate(e.target.value)} className="w-full p-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl font-bold" /></div>
          {type === AccountType.PEE && <div><label className="text-[11px] font-black text-amber-800 dark:text-amber-300 mb-1 uppercase">Fin contrat</label><input type="date" value={contractEndDate} onChange={e => setContractEndDate(e.target.value)} className="w-full p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-xl font-bold text-slate-800 dark:text-slate-100" /></div>}

          <div className="md:col-span-2">
            <label className="text-[11px] font-black text-slate-500 dark:text-slate-400 uppercase mb-1 flex items-center gap-1"><Tag className="w-3 h-3" /> Étiquettes (libres)</label>
            <div className="flex flex-wrap gap-2 mb-2">
              {tags.map(t => (
                <span key={t} className="inline-flex items-center gap-1 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 text-xs font-bold px-2.5 py-1 rounded-full">
                  {t}
                  <button type="button" onClick={() => removeTag(t)} aria-label={`Retirer l'étiquette ${t}`} className="p-2 -m-1.5 hover:text-indigo-900 dark:hover:text-indigo-100"><X className="w-3.5 h-3.5" /></button>
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
              <button type="button" onClick={addTag} className="px-4 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 rounded-xl font-bold text-sm text-slate-600 dark:text-slate-300">Ajouter</button>
            </div>
          </div>
        </div>
        <div className="mt-8 sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] md:static flex justify-end items-center gap-3 bg-white/95 dark:bg-slate-800/95 py-3 -mx-2 px-2 rounded-xl">
          {onCancel && <Button type="button" variant="ghost" onClick={onCancel}>Annuler</Button>}
          <Button type="submit" className="px-10 py-4">Enregistrer</Button>
        </div>
      </form>
    </div>
  );
};
