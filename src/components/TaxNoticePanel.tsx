// Revenus fiscaux de référence (éligibilité au LEP) : importés depuis un avis d'imposition
// lu par Gemini, ou corrigés à la main. Rien n'est enregistré sans validation.
import React, { useRef, useState } from 'react';
import { FileSearch, Loader2, Check, X, Upload } from 'lucide-react';
import { extractTaxNotice, TaxNoticeData } from '../services/geminiService';
import { NumberInput } from './NumberInput';
import { formatEUR } from '../lib/format';

interface Props {
  geminiApiKey: string;
  rfrByYear: Record<string, number>;
  householdParts?: number;
  onSave: (year: number, rfr: number) => void;
  onSetParts: (parts: number) => void;
}

const toBase64 = (file: File) => new Promise<string>((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1] || '');
  r.onerror = () => reject(r.error);
  r.readAsDataURL(file);
});

export const TaxNoticePanel: React.FC<Props> = ({ geminiApiKey, rfrByYear, householdParts, onSave, onSetParts }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<TaxNoticeData | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const thisYear = new Date().getFullYear();
  const years = [thisYear - 1, thisYear - 2, thisYear - 3];

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) { setError('Fichier trop lourd (15 Mo au plus).'); return; }
    setBusy(true); setError(null); setDraft(null);
    try {
      const data = await extractTaxNotice(geminiApiKey, await toBase64(file), file.type || 'application/pdf');
      if (!data.incomeYear || data.rfr === undefined) setError("Gemini n'a pas trouvé l'année ou le revenu fiscal de référence : saisissez-les à la main ci-dessous.");
      else setDraft(data);
    } catch (err) {
      setError(err instanceof Error ? `Lecture impossible : ${err.message.slice(0, 160)}` : 'Lecture impossible.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700">
      <h3 className="font-bold text-slate-800 dark:text-slate-100 mb-1 flex items-center gap-2"><FileSearch className="w-4 h-4 text-indigo-600" aria-hidden="true" /> Avis d'imposition (LEP)</h3>
      <p className="text-xs text-slate-600 dark:text-slate-300 mb-4">
        Votre banque vérifie chaque année le revenu fiscal de référence (RFR) pour le LEP. Importez votre avis d'imposition : Gemini en relève le RFR, et Pécule vous prévient si vous risquez de perdre le livret, avec la date de fermeture probable.
      </p>

      <input ref={fileRef} type="file" accept="application/pdf,image/*" onChange={onFile} className="hidden" />
      <button type="button" disabled={busy || !geminiApiKey} onClick={() => fileRef.current?.click()}
        className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-4 py-2 rounded-xl font-bold text-sm">
        {busy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Upload className="w-4 h-4" aria-hidden="true" />}
        {busy ? 'Lecture de l\'avis…' : 'Importer un avis d\'imposition'}
      </button>
      {!geminiApiKey && <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">Ajoutez d'abord votre clé Gemini (section Fiches de paie ci-dessous).</p>}
      {error && <p role="alert" className="text-xs font-bold text-rose-700 dark:text-rose-300 mt-2">{error}</p>}

      {draft && draft.incomeYear && draft.rfr !== undefined && (
        <div className="mt-4 p-4 rounded-xl border border-indigo-200 dark:border-indigo-900 bg-indigo-50/60 dark:bg-indigo-950/30">
          <p className="text-sm font-bold text-slate-800 dark:text-slate-100">Revenus {draft.incomeYear} : RFR {formatEUR(draft.rfr, 0)}{draft.parts ? ` · ${draft.parts.toLocaleString('fr-FR')} part${draft.parts > 1 ? 's' : ''}` : ''}</p>
          <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">Vérifiez ces valeurs sur votre avis avant d'enregistrer.</p>
          <div className="flex gap-2 mt-3">
            <button type="button" onClick={() => { onSave(draft.incomeYear!, draft.rfr!); if (draft.parts && draft.parts !== householdParts) onSetParts(draft.parts); setDraft(null); }}
              className="flex items-center gap-1 text-xs font-black px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white"><Check className="w-3.5 h-3.5" aria-hidden="true" /> Enregistrer</button>
            <button type="button" onClick={() => setDraft(null)} className="flex items-center gap-1 text-xs font-bold px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200"><X className="w-3.5 h-3.5" aria-hidden="true" /> Annuler</button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-3 gap-3 mt-5">
        {years.map(y => (
          <div key={y}>
            <label className="text-[11px] font-black text-slate-600 dark:text-slate-300 uppercase">RFR {y}</label>
            <NumberInput ariaLabel={`Revenu fiscal de référence ${y}`} value={rfrByYear[String(y)] ?? 0} onChange={v => onSave(y, v)} min={0} suffix="€"
              className="w-full p-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded font-bold" />
          </div>
        ))}
      </div>
      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-2">Vide (0) = estimé d'après vos fiches de paie ou votre salaire.</p>
    </div>
  );
};
