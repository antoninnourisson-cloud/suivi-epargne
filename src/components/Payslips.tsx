// ================================================
// FILE: src/components/Payslips.tsx
// Import de fiches de paie depuis le Drive de l'utilisateur (Google Picker — le fichier
// original n'est jamais copié, on ne stocke que sa référence) et extraction des montants
// via l'API Gemini, à la demande explicite (chaque clic consomme le quota de l'utilisateur).
// ================================================
import React, { useMemo, useState } from 'react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend } from 'recharts';
import { PayslipRecord, PayslipExtractedData } from '../types';
import { openDrivePicker, downloadFileAsBase64 } from '../services/googleDriveService';
import { extractPayslipData, GeminiError } from '../services/geminiService';
import { FileText, Upload, Sparkles, Trash2, ExternalLink, AlertTriangle, Check, X, Loader2, KeyRound, TrendingUp, Wand2 } from 'lucide-react';

interface PayslipsProps {
  payslips: PayslipRecord[];
  onUpdatePayslips: (payslips: PayslipRecord[]) => void;
  geminiApiKey: string;
  pickerApiKey: string;
  // Bascule le Pilotage Budgétaire sur les chiffres exacts de cette fiche (brut, charges,
  // navigo, mutuelle, titres resto, impôt réellement prélevé) à la place de la formule
  // théorique. L'appelant (App.tsx) est responsable de demander confirmation avant
  // d'écraser l'état courant — ce composant ne fait que déclencher la demande.
  onApplyToPilotage: (payslip: PayslipRecord) => void;
  // Fiche actuellement utilisée comme référence exacte du Pilotage (undefined = mode
  // estimation), pour la mettre en évidence dans la liste et permettre de désactiver.
  activePayslipId?: string;
  onClearActivePayslip: () => void;
}

const fmt = (n: number | undefined) =>
  n === undefined ? '—' : new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }).format(n);

// Fiche en cours d'import, avant d'être définitivement enregistrée dans `payslips`.
interface DraftPayslip {
  fileId: string;
  fileName: string;
  mimeType: string;
  status: 'picked' | 'extracting' | 'reviewing' | 'error';
  error?: string;
  fields: PayslipExtractedData;
}

const emptyFields: PayslipExtractedData = {};

const monthLabel = (period: string) => {
  // period attendu au format "AAAA-MM" ; si l'IA a renvoyé autre chose, on l'affiche tel quel
  // plutôt que planter sur un Date invalide.
  const match = /^(\d{4})-(\d{2})$/.exec(period);
  if (!match) return period;
  const d = new Date(Number(match[1]), Number(match[2]) - 1, 1);
  return d.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' });
};

export const Payslips: React.FC<PayslipsProps> = ({ payslips, onUpdatePayslips, geminiApiKey, pickerApiKey, onApplyToPilotage, activePayslipId, onClearActivePayslip }) => {
  const [draft, setDraft] = useState<DraftPayslip | null>(null);
  const [pickerBusy, setPickerBusy] = useState(false);

  const keysMissing = !geminiApiKey || !pickerApiKey;

  // Courbe d'évolution du net : uniquement les fiches dont la période et le net ont bien
  // été renseignés (extraction partielle ou saisie manuelle incomplète exclues du tracé).
  const chartData = useMemo(() =>
    payslips
      .filter(p => p.extracted.period && (p.extracted.netPaid !== undefined || p.extracted.netAmount !== undefined))
      .map(p => ({ period: p.extracted.period as string, net: (p.extracted.netPaid ?? p.extracted.netAmount) as number, brut: p.extracted.grossAmount }))
      .sort((a, b) => a.period.localeCompare(b.period))
      .map(p => ({ ...p, label: monthLabel(p.period) })),
    [payslips]);

  const handlePick = async () => {
    if (!pickerApiKey) return;
    setPickerBusy(true);
    try {
      const picked = await openDrivePicker(pickerApiKey);
      if (picked) {
        setDraft({ fileId: picked.id, fileName: picked.name, mimeType: picked.mimeType, status: 'picked', fields: { ...emptyFields } });
      }
    } catch (e) {
      console.error('Ouverture du sélecteur Drive échouée', e);
      setDraft({ fileId: '', fileName: '', mimeType: '', status: 'error', error: "Impossible d'ouvrir le sélecteur Google Drive. Vérifiez la clé API Picker dans les Paramètres.", fields: { ...emptyFields } });
    } finally {
      setPickerBusy(false);
    }
  };

  const handleExtract = async () => {
    if (!draft || !geminiApiKey) return;
    setDraft({ ...draft, status: 'extracting', error: undefined });
    try {
      const base64 = await downloadFileAsBase64(draft.fileId);
      const fields = await extractPayslipData(geminiApiKey, base64, draft.mimeType);
      setDraft(d => d && ({ ...d, status: 'reviewing', fields }));
    } catch (e) {
      const message = e instanceof GeminiError
        ? "L'extraction automatique a échoué. Vous pouvez saisir les montants manuellement ci-dessous."
        : "Le téléchargement du fichier depuis Drive a échoué.";
      console.error('Extraction fiche de paie échouée', e);
      setDraft(d => d && ({ ...d, status: 'reviewing', error: message }));
    }
  };

  const patchDraftField = (field: keyof PayslipExtractedData, value: string) => {
    if (!draft) return;
    const isNumeric = field !== 'employer' && field !== 'period';
    setDraft({
      ...draft,
      fields: { ...draft.fields, [field]: isNumeric ? (value === '' ? undefined : parseFloat(value)) : value },
    });
  };

  const saveDraft = () => {
    if (!draft) return;
    const record: PayslipRecord = {
      id: crypto.randomUUID(),
      fileId: draft.fileId,
      fileName: draft.fileName,
      addedAt: new Date().toISOString(),
      extracted: draft.fields,
      reviewed: true, // l'utilisateur vient de relire/valider l'écran ci-dessous
    };
    onUpdatePayslips([record, ...payslips]);
    setDraft(null);
  };

  const removePayslip = (id: string) => onUpdatePayslips(payslips.filter(p => p.id !== id));

  return (
    <div className="space-y-6 animate-fade-in pb-20">
      <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm flex flex-col sm:flex-row justify-between gap-4 sm:items-center">
        <div>
          <h2 className="text-2xl font-black text-slate-800 dark:text-slate-100 flex items-center gap-2"><FileText className="w-6 h-6 text-indigo-600" /> Fiches de paie</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">Importe une fiche déjà présente sur ton Drive ; l'IA en extrait les montants clés.</p>
        </div>
        {!draft && (
          <button
            onClick={handlePick}
            disabled={!pickerApiKey || pickerBusy}
            className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed text-white px-5 py-2.5 rounded-xl font-bold flex gap-2 items-center shadow-lg shadow-indigo-200 flex-shrink-0"
          >
            {pickerBusy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Upload className="w-5 h-5" />}
            Importer depuis Drive
          </button>
        )}
      </div>

      {keysMissing && (
        <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-2xl p-5 flex items-start gap-3">
          <KeyRound className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-amber-800 dark:text-amber-300">
            <p className="font-black mb-1">Configuration requise</p>
            <p>
              {!pickerApiKey && !geminiApiKey && "Renseigne une clé API Picker et une clé API Gemini dans "}
              {!pickerApiKey && geminiApiKey && "Renseigne une clé API Google Picker dans "}
              {pickerApiKey && !geminiApiKey && "Renseigne une clé API Gemini dans "}
              <span className="font-bold">Paramètres → Fiches de paie</span> pour importer et analyser tes fiches.
            </p>
          </div>
        </div>
      )}

      {/* --- IMPORT EN COURS --- */}
      {draft && (
        <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-indigo-200 dark:border-indigo-800 shadow-sm space-y-4">
          {draft.fileName && (
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <FileText className="w-4 h-4 text-indigo-600 flex-shrink-0" />
                <span className="font-bold text-slate-800 dark:text-slate-100 truncate">{draft.fileName}</span>
              </div>
              <button onClick={() => setDraft(null)} className="p-1.5 text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg flex-shrink-0"><X className="w-4 h-4" /></button>
            </div>
          )}

          {draft.status === 'error' && (
            <p className="text-sm text-rose-600 dark:text-rose-400 flex items-start gap-2"><AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" /> {draft.error}</p>
          )}

          {draft.status === 'picked' && (
            <button
              onClick={handleExtract}
              disabled={!geminiApiKey}
              className="w-full flex items-center justify-center gap-2 bg-indigo-50 dark:bg-indigo-950/40 hover:bg-indigo-100 dark:hover:bg-indigo-900 disabled:opacity-40 disabled:cursor-not-allowed text-indigo-700 dark:text-indigo-300 py-3 rounded-xl font-bold text-sm"
            >
              <Sparkles className="w-4 h-4" /> Analyser avec l'IA (utilise votre quota Gemini)
            </button>
          )}

          {draft.status === 'extracting' && (
            <div className="flex items-center justify-center gap-2 text-slate-500 dark:text-slate-400 py-6 text-sm font-bold">
              <Loader2 className="w-4 h-4 animate-spin" /> Analyse en cours…
            </div>
          )}

          {draft.status === 'reviewing' && (
            <>
              {draft.error && (
                <p className="text-xs text-amber-700 dark:text-amber-300 flex items-start gap-2 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" /> {draft.error}
                </p>
              )}
              <p className="text-[11px] text-slate-400 dark:text-slate-500 -mt-1">Vérifie et corrige les valeurs avant d'enregistrer — l'extraction automatique peut se tromper.</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div><label className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase">Employeur</label><input value={draft.fields.employer ?? ''} onChange={e => patchDraftField('employer', e.target.value)} className="w-full p-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg font-bold" /></div>
                <div><label className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase">Période (AAAA-MM)</label><input value={draft.fields.period ?? ''} onChange={e => patchDraftField('period', e.target.value)} placeholder="2026-08" className="w-full p-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg font-bold" /></div>
                <div><label className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase">Brut (€)</label><input type="number" value={draft.fields.grossAmount ?? ''} onChange={e => patchDraftField('grossAmount', e.target.value)} className="w-full p-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg font-bold" /></div>
                <div><label className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase">Charges salariales (€)</label><input type="number" value={draft.fields.socialCharges ?? ''} onChange={e => patchDraftField('socialCharges', e.target.value)} className="w-full p-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg font-bold" /></div>
                <div><label className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase">Net à payer avant impôt (€)</label><input type="number" value={draft.fields.netAmount ?? ''} onChange={e => patchDraftField('netAmount', e.target.value)} className="w-full p-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg font-bold" /></div>
                <div><label className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase">Net imposable (€)</label><input type="number" value={draft.fields.netTaxable ?? ''} onChange={e => patchDraftField('netTaxable', e.target.value)} className="w-full p-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg font-bold" /></div>
                <div><label className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase">Remb. Navigo (€)</label><input type="number" value={draft.fields.navigoRefund ?? ''} onChange={e => patchDraftField('navigoRefund', e.target.value)} className="w-full p-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg font-bold" /></div>
                <div><label className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase">Mutuelle (part salarié, €)</label><input type="number" value={draft.fields.mutuelleCost ?? ''} onChange={e => patchDraftField('mutuelleCost', e.target.value)} className="w-full p-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg font-bold" /></div>
                <div><label className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase">Tickets restaurant (€)</label><input type="number" value={draft.fields.mealVouchers ?? ''} onChange={e => patchDraftField('mealVouchers', e.target.value)} className="w-full p-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg font-bold" /></div>
                <div><label className="text-[10px] font-black text-amber-500 uppercase">Impôt prélevé à la source (€)</label><input type="number" value={draft.fields.incomeTaxWithheld ?? ''} onChange={e => patchDraftField('incomeTaxWithheld', e.target.value)} className="w-full p-2 bg-slate-50 dark:bg-slate-900 border border-amber-200 dark:border-amber-800 rounded-lg font-bold" /></div>
                <div><label className="text-[10px] font-black text-emerald-600 uppercase">Net payé (viré en banque, €)</label><input type="number" value={draft.fields.netPaid ?? ''} onChange={e => patchDraftField('netPaid', e.target.value)} className="w-full p-2 bg-slate-50 dark:bg-slate-900 border border-emerald-200 dark:border-emerald-800 rounded-lg font-bold" /></div>
              </div>
              <div className="flex gap-2 justify-end pt-2">
                <button onClick={() => setDraft(null)} className="px-4 py-2 rounded-xl font-bold text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 flex items-center gap-1"><X className="w-4 h-4" /> Annuler</button>
                <button onClick={saveDraft} className="px-4 py-2 rounded-xl font-bold text-sm bg-indigo-600 text-white hover:bg-indigo-700 flex items-center gap-1"><Check className="w-4 h-4" /> Enregistrer</button>
              </div>
            </>
          )}
        </div>
      )}

      {/* --- ÉVOLUTION DU NET --- */}
      {chartData.length >= 2 && !draft && (
        <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm">
          <h3 className="font-black text-slate-800 dark:text-slate-100 flex items-center gap-2 mb-4"><TrendingUp className="w-5 h-5 text-indigo-600" /> Évolution du net</h3>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="gNet" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#10b981" stopOpacity={0.6} /><stop offset="95%" stopColor="#10b981" stopOpacity={0.05} /></linearGradient>
                </defs>
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={(v) => `${v}€`} tick={{ fontSize: 11 }} />
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <RechartsTooltip formatter={(v: number, name: string) => [fmt(v), name === 'net' ? 'Net' : 'Brut']} contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                <Legend formatter={(v) => (v === 'net' ? 'Net' : 'Brut')} wrapperStyle={{ fontSize: 12 }} />
                <Area type="monotone" dataKey="net" stroke="#10b981" fill="url(#gNet)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* --- HISTORIQUE --- */}
      {payslips.length === 0 && !draft && (
        <div className="text-center py-16 text-slate-400 dark:text-slate-500 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700">
          <FileText className="w-10 h-10 mx-auto mb-3 opacity-40" />
          Aucune fiche de paie importée pour l'instant.
        </div>
      )}

      {payslips.length > 0 && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700">
              <tr>
                <th className="px-6 py-3 text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase">Période</th>
                <th className="px-6 py-3 text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase text-right">Brut</th>
                <th className="px-6 py-3 text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase text-right">Net payé</th>
                <th className="px-6 py-3 text-right"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {payslips.map(p => {
                const isActive = p.id === activePayslipId;
                return (
                <tr key={p.id} className={`hover:bg-slate-50 dark:hover:bg-slate-800 ${isActive ? 'bg-amber-50/60 dark:bg-amber-950/20' : ''}`}>
                  <td className="px-6 py-3">
                    <div className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                      {p.extracted.period || '—'}
                      {isActive && <span className="text-[9px] font-black uppercase bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-300 px-1.5 py-0.5 rounded">Référence Pilotage</span>}
                    </div>
                    <div className="text-[10px] uppercase text-slate-400 dark:text-slate-500 font-bold">{p.extracted.employer || p.fileName}</div>
                  </td>
                  <td className="px-6 py-3 text-right font-mono text-slate-600 dark:text-slate-300">{fmt(p.extracted.grossAmount)}</td>
                  <td className="px-6 py-3 text-right font-black text-emerald-600">{fmt(p.extracted.netPaid ?? p.extracted.netAmount)}</td>
                  <td className="px-6 py-3 text-right">
                    <div className="flex justify-end gap-1">
                      {isActive ? (
                        <button onClick={onClearActivePayslip} className="p-2 text-amber-600 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 hover:bg-amber-100 dark:hover:bg-amber-900 rounded-lg" title="Revenir à l'estimation théorique"><Wand2 className="w-4 h-4" /></button>
                      ) : p.extracted.grossAmount !== undefined && (
                        <button onClick={() => onApplyToPilotage(p)} className="p-2 text-amber-600 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/40 rounded-lg" title="Utiliser pour mon Pilotage Budgétaire (chiffres exacts)"><Wand2 className="w-4 h-4" /></button>
                      )}
                      <a href={`https://drive.google.com/file/d/${p.fileId}/view`} target="_blank" rel="noopener noreferrer" className="p-2 text-indigo-600 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 rounded-lg" title="Ouvrir sur Drive"><ExternalLink className="w-4 h-4" /></a>
                      <button onClick={() => removePayslip(p.id)} className="p-2 text-slate-300 dark:text-slate-600 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg" title="Retirer de la liste"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
