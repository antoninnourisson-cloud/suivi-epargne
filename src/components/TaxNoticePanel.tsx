// Revenus fiscaux de référence (éligibilité au LEP) : importés depuis un avis d'imposition
// lu par Gemini, ou corrigés à la main. Rien n'est enregistré sans validation.
import React, { useRef, useState } from 'react';
import { FileSearch, Loader2, Check, X, Upload } from 'lucide-react';
import { extractTaxNotice, TaxNoticeData } from '../services/geminiService';
import { formatEUR } from '../lib/format';
import { Button, Card } from './ui';
import { Hint, useCardSummary, useInSettingsCard } from './settings/SettingsCard';
import { NumberField } from './settings/fields';
import { openSettingsSection } from './settings/sections';

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
  const embedded = useInSettingsCard();
  const thisYear = new Date().getFullYear();
  const years = [thisYear - 1, thisYear - 2, thisYear - 3];

  const known = Object.entries(rfrByYear).filter(([, v]) => v > 0).sort(([a], [b]) => Number(b) - Number(a))[0];
  useCardSummary('rfr', known ? `RFR ${known[0]} : ${formatEUR(known[1], 0)}` : 'RFR estimé (aucun avis saisi)');

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

  const body = (
    <>
      <Hint className="mb-4">
        Votre banque vérifie chaque année le revenu fiscal de référence (RFR) pour le LEP. Importez votre avis d'imposition : Gemini en relève le RFR, et Pécule vous prévient si vous risquez de perdre le livret, avec la date de fermeture probable.
      </Hint>

      <input ref={fileRef} type="file" accept="application/pdf,image/*" onChange={onFile} className="hidden" tabIndex={-1} aria-hidden="true" />
      <Button type="button" disabled={busy || !geminiApiKey} onClick={() => fileRef.current?.click()}>
        {busy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Upload className="w-4 h-4" aria-hidden="true" />}
        {busy ? 'Lecture de l\'avis…' : 'Importer un avis d\'imposition'}
      </Button>
      {!geminiApiKey && (
        <p className="text-sm text-on-surface-variant mt-2 flex flex-wrap items-center gap-x-1">
          La lecture de l'avis demande une clé Gemini.
          {embedded && <Button variant="text" className="-ml-3 sm:ml-0" onClick={() => openSettingsSection('keys')}>Ajouter la clé Gemini</Button>}
        </p>
      )}
      {error && <p role="alert" className="text-xs font-medium text-error mt-2">{error}</p>}

      {draft && draft.incomeYear && draft.rfr !== undefined && (
        <div className="mt-4 p-4 rounded-xl bg-secondary-container text-on-secondary-container">
          <p className="text-sm font-medium">Revenus {draft.incomeYear} : RFR {formatEUR(draft.rfr, 0)}{draft.parts ? ` · ${draft.parts.toLocaleString('fr-FR')} part${draft.parts > 1 ? 's' : ''}` : ''}</p>
          <p className="text-xs mt-1">Vérifiez ces valeurs sur votre avis avant d'enregistrer.</p>
          <div className="flex flex-wrap gap-2 mt-3">
            <Button type="button" onClick={() => { onSave(draft.incomeYear!, draft.rfr!); if (draft.parts && draft.parts !== householdParts) onSetParts(draft.parts); setDraft(null); }}>
              <Check className="w-4 h-4" aria-hidden="true" /> Enregistrer</Button>
            <Button type="button" variant="text" onClick={() => setDraft(null)}><X className="w-4 h-4" aria-hidden="true" /> Annuler</Button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-5">
        {years.map(y => (
          <NumberField key={y} label={`Revenu fiscal de référence ${y}`} value={rfrByYear[String(y)] ?? 0} onChange={v => onSave(y, v)} min={0} suffix="€" />
        ))}
      </div>
      <Hint className="mt-2">Vide (0) = estimé d'après vos fiches de paie ou votre salaire.</Hint>
    </>
  );

  return embedded ? body : <Card title="Avis d'imposition (LEP)" icon={FileSearch}>{body}</Card>;
};
