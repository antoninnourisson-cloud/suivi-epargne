// ================================================
// FILE: src/components/Donations.tsx
// Dons aux associations, notés au fil de l'année pour la déclaration de revenus : total
// par taux (66 % / 75 %), réduction d'impôt estimée, reçus fiscaux (joignables depuis le
// Drive). Rappel en avril côté serveur (voir worker/src/reminders.ts).
// ================================================
import React, { useMemo, useState } from 'react';
import { Donation } from '../types';
import { HandHeart, Plus, Trash2, AlertCircle, Pencil, X, FileDown, Paperclip, CheckCircle2, Info, ExternalLink } from 'lucide-react';
import { parseFrenchNumber } from '../lib/numbers';
import { localTodayISO, parseISODate } from '../lib/dates';
import { computeDonationSummary, DONATION_75_CEILING } from '../lib/finance';
import { openDrivePicker } from '../services/googleDriveService';
import { formatEUR } from '../lib/format';
import { useUndoableRemove } from './Toast';

interface DonationsProps {
  taxEstimate?: { taxDue: number; taxableIncome: number };
  ceiling75?: number;
  donations: Donation[];
  onUpdate: React.Dispatch<React.SetStateAction<Donation[]>>;
  pickerApiKey?: string;
}

const fmt = (n: number) => formatEUR(n);
const driveUrl = (id: string) => `https://drive.google.com/file/d/${encodeURIComponent(id)}/view`;

type Draft = { date: string; amount: string; organization: string; rate: 66 | 75; receiptReceived: boolean; receiptFileId?: string; receiptFileName?: string; note: string };
const emptyDraft = (): Draft => ({ date: localTodayISO(), amount: '', organization: '', rate: 66, receiptReceived: false, note: '' });

export const Donations: React.FC<DonationsProps> = ({ donations, onUpdate, pickerApiKey, taxEstimate, ceiling75 }) => {
  const thisYear = new Date().getFullYear();
  // Jusqu'en juin, c'est l'année écoulée qu'on déclare : on l'affiche par défaut.
  const [year, setYear] = useState(() => new Date().getMonth() < 6 && donations.some(d => d.date.startsWith(`${thisYear - 1}-`)) ? thisYear - 1 : thisYear);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pickerBusy, setPickerBusy] = useState(false);

  const years = useMemo(() => {
    const set = new Set<number>([thisYear, ...donations.map(d => Number(d.date.slice(0, 4)))]);
    return [...set].filter(y => y > 2000).sort((a, b) => b - a);
  }, [donations, thisYear]);
  const summary = useMemo(() => computeDonationSummary(donations, year, { ...taxEstimate, ceiling75 }), [donations, year, taxEstimate, ceiling75]);
  const rows = useMemo(
    () => donations.filter(d => d.date.startsWith(`${year}-`)).sort((a, b) => b.date.localeCompare(a.date)),
    [donations, year]
  );
  const knownOrgs = Array.from(new Set(donations.map(d => d.organization).filter(Boolean)));

  const set = (patch: Partial<Draft>) => { setDraft(d => ({ ...d, ...patch })); setError(null); };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const organization = draft.organization.trim();
    if (!organization) { setError("Indiquez l'association."); return; }
    const amount = parseFrenchNumber(draft.amount);
    if (amount === null || amount <= 0) { setError('Saisissez un montant supérieur à 0.'); return; }
    if (!draft.date) { setError('Indiquez la date du don.'); return; }
    const entry: Omit<Donation, 'id'> = {
      date: draft.date, amount, organization, rate: draft.rate,
      receiptReceived: draft.receiptReceived || !!draft.receiptFileId,
      receiptFileId: draft.receiptFileId, receiptFileName: draft.receiptFileName,
      note: draft.note.trim() || undefined,
    };
    onUpdate(editingId
      ? donations.map(d => d.id === editingId ? { ...entry, id: d.id } : d)
      : [...donations, { ...entry, id: crypto.randomUUID() }]);
    setYear(Number(draft.date.slice(0, 4)));
    setDraft(emptyDraft());
    setEditingId(null);
  };

  const edit = (d: Donation) => {
    setEditingId(d.id);
    setDraft({ date: d.date, amount: String(d.amount), organization: d.organization, rate: d.rate, receiptReceived: d.receiptReceived, receiptFileId: d.receiptFileId, receiptFileName: d.receiptFileName, note: d.note || '' });
    setError(null);
  };
  const cancelEdit = () => { setEditingId(null); setDraft(emptyDraft()); setError(null); };
  const removeWithUndo = useUndoableRemove();
  const remove = (id: string) => {
    const don = donations.find(d => d.id === id);
    if (!don) return;
    removeWithUndo(donations, don, onUpdate, `Don à ${don.organization} supprimé`);
    if (editingId === id) cancelEdit();
  };
  const toggleReceipt = (id: string) => onUpdate(donations.map(d => d.id === id ? { ...d, receiptReceived: !d.receiptReceived } : d));

  const attachReceipt = async () => {
    if (!pickerApiKey) { setError('Renseignez la clé API Google Picker dans les Paramètres pour joindre un reçu.'); return; }
    setPickerBusy(true);
    try {
      const picked = await openDrivePicker(pickerApiKey);
      if (picked) set({ receiptFileId: picked.id, receiptFileName: picked.name, receiptReceived: true });
    } catch {
      setError("Impossible d'ouvrir le sélecteur Google Drive.");
    } finally {
      setPickerBusy(false);
    }
  };

  const exportCsv = () => {
    let csv = 'Date,Association,Montant,Taux,Reçu fiscal,Fichier du reçu,Note\n';
    rows.forEach(d => {
      csv += `${d.date},"${d.organization.replace(/"/g, '""')}",${d.amount},${d.rate} %,${d.receiptReceived ? 'oui' : 'non'},"${(d.receiptFileName || '').replace(/"/g, '""')}","${(d.note || '').replace(/"/g, '""')}"\n`;
    });
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `dons-${year}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const inputClass = 'w-full p-3 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 border border-slate-300 dark:border-slate-700 rounded-lg font-bold';

  return (
    <div className="space-y-6 animate-fade-in pb-20">
      <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-2xl font-black text-slate-800 dark:text-slate-100 flex items-center gap-2 mb-1"><HandHeart className="w-6 h-6 text-indigo-600" /> Dons</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">Notez vos dons au fil de l'année : au printemps, tout est prêt pour la déclaration. Rappel début avril.</p>
          </div>
          <select value={year} onChange={e => setYear(Number(e.target.value))} aria-label="Année" className="p-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg font-bold text-slate-700 dark:text-slate-200">
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-5">
          <div>
            <p className="text-[11px] font-black text-slate-500 dark:text-slate-400 uppercase">Total {year}</p>
            <p className="text-xl font-black text-slate-800 dark:text-slate-100">{fmt(summary.total)}</p>
          </div>
          <div>
            <p className="text-[11px] font-black text-emerald-700 dark:text-emerald-400 uppercase">Réduction estimée</p>
            <p className="text-xl font-black text-emerald-700 dark:text-emerald-400">{fmt(summary.reduction)}</p>
            {summary.cappedByTax && <p className="text-[11px] text-amber-700 dark:text-amber-400">Limitée à votre impôt estimé : {fmt(summary.reductionUncapped)} en théorie, l'excédent n'est pas remboursé.</p>}
          </div>
          <div>
            <p className="text-[11px] font-black text-slate-500 dark:text-slate-400 uppercase">À déclarer à 75 %</p>
            <p className="text-lg font-black text-slate-700 dark:text-slate-200">{fmt(summary.total75)}</p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">case 7UD</p>
          </div>
          <div>
            <p className="text-[11px] font-black text-slate-500 dark:text-slate-400 uppercase">À déclarer à 66 %</p>
            <p className="text-lg font-black text-slate-700 dark:text-slate-200">{fmt(summary.total66)}</p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">case 7UF</p>
          </div>
        </div>
        {summary.missingReceipts.length > 0 && (
          <p className="mt-4 text-xs font-bold text-amber-700 dark:text-amber-400 flex items-start gap-1.5"><AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-px" /> Reçu fiscal manquant : {summary.missingReceipts.map(d => d.organization).join(', ')}. Il n'est pas à envoyer, mais à garder en cas de contrôle.</p>
        )}
        <p className="mt-3 text-[11px] text-slate-500 dark:text-slate-400 flex items-start gap-1">
          <Info className="w-3 h-3 flex-shrink-0 mt-0.5" />
          Estimation : 75 % jusqu'à {fmt(ceiling75 ?? DONATION_75_CEILING)} de dons aux organismes d'aide aux personnes en difficulté (l'excédent passe à 66 %), 66 % pour les autres, dans la limite de 20 % du revenu imposable. Les cases et plafonds peuvent changer chaque année : vérifiez sur impots.gouv.
        </p>
        {rows.length > 0 && (
          <button onClick={exportCsv} className="mt-4 flex items-center gap-2 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 px-4 py-2 rounded-xl font-bold text-sm"><FileDown className="w-4 h-4" /> Exporter {year} (CSV)</button>
        )}
      </div>

      {rows.length > 0 && (
        <ul className="space-y-2">
          {rows.map(d => (
            <li key={d.id} className="flex items-center gap-3 p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
              <div className="flex-1 min-w-0">
                <p className="font-bold text-slate-800 dark:text-slate-100 text-sm truncate">{d.organization} · {fmt(d.amount)} <span className="text-[11px] font-black text-slate-500 dark:text-slate-400">{d.rate} %</span></p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 font-bold flex flex-wrap items-center gap-x-2">
                  <span>{parseISODate(d.date).toLocaleDateString('fr-FR')}</span>
                  {d.receiptFileId
                    ? <a href={driveUrl(d.receiptFileId)} target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline inline-flex items-center gap-0.5"><Paperclip className="w-3 h-3" /> {d.receiptFileName || 'reçu'} <ExternalLink className="w-3 h-3" /></a>
                    : <button type="button" onClick={() => toggleReceipt(d.id)} className={`inline-flex items-center gap-0.5 ${d.receiptReceived ? 'text-emerald-600' : 'text-amber-600'}`}>
                        {d.receiptReceived ? <><CheckCircle2 className="w-3 h-3" /> reçu fiscal reçu</> : <><AlertCircle className="w-3 h-3" /> reçu à recevoir</>}
                      </button>}
                  {d.note && <span className="truncate">{d.note}</span>}
                </p>
              </div>
              <button type="button" onClick={() => edit(d)} aria-label={`Modifier le don à ${d.organization}`} className="p-2.5 text-slate-400 hover:text-indigo-600 rounded-lg"><Pencil className="w-4 h-4" /></button>
              <button type="button" onClick={() => remove(d.id)} aria-label={`Supprimer le don à ${d.organization}`} className="p-2.5 text-slate-400 hover:text-rose-500 rounded-lg"><Trash2 className="w-4 h-4" /></button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={submit} className="space-y-3 bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-black text-slate-500 dark:text-slate-400 uppercase">{editingId ? 'Modifier le don' : 'Nouveau don'}</p>
          {editingId && <button type="button" onClick={cancelEdit} className="text-xs font-bold text-slate-400 hover:text-slate-600 flex items-center gap-1"><X className="w-3 h-3" /> Annuler</button>}
        </div>
        <input type="text" list="donation-orgs" value={draft.organization} onChange={e => set({ organization: e.target.value })} placeholder="Association (ex : Restos du cœur)" className={inputClass} />
        <datalist id="donation-orgs">{knownOrgs.map(o => <option key={o} value={o} />)}</datalist>
        <div className="grid grid-cols-2 gap-2">
          <input type="text" inputMode="decimal" value={draft.amount} onChange={e => set({ amount: e.target.value })} placeholder="Montant (€)" className={inputClass} />
          <input type="date" value={draft.date} onChange={e => set({ date: e.target.value })} aria-label="Date du don" className={inputClass} />
        </div>
        <label className="flex items-start gap-2 text-sm text-slate-600 dark:text-slate-300">
          <input type="checkbox" className="mt-1" checked={draft.rate === 75} onChange={e => set({ rate: e.target.checked ? 75 : 66 })} />
          <span><b>Aide aux personnes en difficulté</b> (repas, soins, logement : Restos du cœur, Secours populaire…) : réduction de 75 % au lieu de 66 %.</span>
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <input type="checkbox" checked={draft.receiptReceived || !!draft.receiptFileId} disabled={!!draft.receiptFileId} onChange={e => set({ receiptReceived: e.target.checked })} />
            Reçu fiscal reçu
          </label>
          {draft.receiptFileId ? (
            <span className="text-xs font-bold text-indigo-600 flex items-center gap-1">
              <Paperclip className="w-3.5 h-3.5" /> {draft.receiptFileName || 'reçu'}
              <button type="button" onClick={() => set({ receiptFileId: undefined, receiptFileName: undefined })} aria-label="Retirer le reçu" className="p-1 text-slate-400 hover:text-rose-500"><X className="w-3 h-3" /></button>
            </span>
          ) : (
            <button type="button" onClick={attachReceipt} disabled={pickerBusy} className="text-xs font-bold text-indigo-600 hover:underline flex items-center gap-1 disabled:opacity-50"><Paperclip className="w-3.5 h-3.5" /> Joindre le reçu depuis Drive</button>
          )}
        </div>
        <input type="text" value={draft.note} onChange={e => set({ note: e.target.value })} placeholder="Note (optionnelle)" className={inputClass} />
        {error && (
          <p className="text-sm font-bold text-rose-700 dark:text-rose-300 flex items-center gap-2"><AlertCircle className="w-4 h-4" /> {error}</p>
        )}
        <button type="submit" className="w-full py-3 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-bold flex items-center justify-center gap-2">
          <Plus className="w-4 h-4" /> {editingId ? 'Enregistrer' : 'Ajouter le don'}
        </button>
      </form>
    </div>
  );
};
