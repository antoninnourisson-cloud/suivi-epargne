// ================================================
// FILE: src/components/Payslips.tsx
// Import de fiches de paie depuis le Drive de l'utilisateur (Google Picker — le fichier
// original n'est jamais copié, on ne stocke que sa référence) et extraction des montants
// via l'API Gemini, à la demande explicite (chaque clic consomme le quota de l'utilisateur).
// ================================================
import React, { useMemo, useState } from 'react';
import { PayslipRecord, PayslipExtractedData } from '../types';
import { openDrivePicker, downloadFileAsBase64 } from '../services/googleDriveService';
import { extractPayslipData, GeminiError } from '../services/geminiService';
import { parseFrenchNumber } from '../lib/numbers';
import { FileText, Upload, Sparkles, Trash2, ExternalLink, AlertTriangle, Check, X, Loader2, KeyRound, TrendingUp, Wand2 } from 'lucide-react';
import { formatEUR, formatPeriod } from '../lib/format';
import { useIsDark, chartTheme } from '../lib/chartTheme';
import { describeEvolution } from '../lib/chartData';
import { AreaSeriesChart, type AreaRow } from './charts/AreaSeriesChart';
import { ChartFrame } from './charts/ChartFrame';
import { DataTable, type Column } from './ui/DataTable';
import { detectPayslipAnomalies } from '../lib/motivation';
import { describeAnomaly } from './motivation/text';

interface PayslipsProps {
  payslips: PayslipRecord[];
  onUpdatePayslips: (payslips: PayslipRecord[]) => void;
  geminiApiKey: string;
  pickerApiKey: string;
  // Bascule le Pilotage budgétaire sur les chiffres exacts de cette fiche (brut, charges,
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
  n === undefined ? '—' : formatEUR(n);

// Fiche en cours d'import, avant d'être définitivement enregistrée dans `payslips`.
interface DraftPayslip {
  fileId: string;
  fileName: string;
  mimeType: string;
  status: 'picked' | 'extracting' | 'reviewing' | 'error';
  error?: string;
  // Cause technique exacte (statut HTTP, message Google, adresse bloquée par la CSP) :
  // affichée sous le message, pour diagnostiquer sans ouvrir la console.
  errorDetail?: string;
  // Échec passager (saturation, réseau) : on propose de relancer l'extraction.
  retryable?: boolean;
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

/**
 * Exécute `fn` en notant les violations de CSP survenues pendant ce temps. Un appel réseau
 * bloqué par la CSP ne lève qu'un « Failed to fetch » générique ; l'événement
 * `securitypolicyviolation`, lui, donne l'adresse exacte refusée — indispensable pour
 * diagnostiquer sans console (typiquement sur téléphone).
 */
const withCspWatch = async <T,>(fn: () => Promise<T>): Promise<{ result?: T; error?: unknown; blocked: string[] }> => {
  const blocked: string[] = [];
  const onViolation = (e: SecurityPolicyViolationEvent) => {
    blocked.push(`${e.effectiveDirective} ${e.blockedURI || '(inline)'}`);
  };
  document.addEventListener('securitypolicyviolation', onViolation);
  try {
    return { result: await fn(), blocked };
  } catch (error) {
    // L'événement CSP est asynchrone : on lui laisse un instant pour arriver.
    await new Promise(r => setTimeout(r, 50));
    return { error, blocked };
  } finally {
    document.removeEventListener('securitypolicyviolation', onViolation);
  }
};

const describeError = (e: unknown, blocked: string[]): string => {
  const parts: string[] = [];
  if (blocked.length) parts.push(`bloqué par la politique de sécurité : ${[...new Set(blocked)].join(', ')}`);
  const msg = e instanceof Error ? `${e.name === 'Error' ? '' : e.name + ' : '}${e.message}` : String(e);
  if (msg) parts.push(msg.slice(0, 300));
  return parts.join(' — ');
};

export const Payslips: React.FC<PayslipsProps> = ({ payslips, onUpdatePayslips, geminiApiKey, pickerApiKey, onApplyToPilotage, activePayslipId, onClearActivePayslip }) => {
  const t = chartTheme(useIsDark());
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
  // Contrôle des fiches : écart net avec la médiane des fiches précédentes.
  const anomalies = useMemo(() => new Map(detectPayslipAnomalies(payslips).map(a => [a.payslipId, a])), [payslips]);
  const netRows = useMemo<AreaRow[]>(() => chartData.map(p => ({ label: p.label, title: formatPeriod(p.period), net: p.net })), [chartData]);
  const netColumns: Column<(typeof chartData)[number]>[] = [
    { key: 'period', header: 'Mois', cell: p => formatPeriod(p.period) },
    { key: 'net', header: 'Net', numeric: true, cell: p => fmt(p.net) },
    { key: 'brut', header: 'Brut', numeric: true, cell: p => fmt(p.brut) },
  ];

  const handlePick = async () => {
    if (!pickerApiKey) return;
    setPickerBusy(true);
    const pickerBlocked: string[] = [];
    const onPickerViolation = (ev: SecurityPolicyViolationEvent) => pickerBlocked.push(`${ev.effectiveDirective} ${ev.blockedURI || '(inline)'}`);
    document.addEventListener('securitypolicyviolation', onPickerViolation);
    try {
      const picked = await openDrivePicker(pickerApiKey);
      if (picked) {
        setDraft({ fileId: picked.id, fileName: picked.name, mimeType: picked.mimeType, status: 'picked', fields: { ...emptyFields } });
      }
    } catch (e) {
      console.error('Ouverture du sélecteur Drive échouée', e);
      setDraft({ fileId: '', fileName: '', mimeType: '', status: 'error', error: "Impossible d'ouvrir le sélecteur Google Drive. Vérifiez la clé API Picker dans les Paramètres.", errorDetail: describeError(e, pickerBlocked), fields: { ...emptyFields } });
    } finally {
      document.removeEventListener('securitypolicyviolation', onPickerViolation);
      setPickerBusy(false);
    }
  };

  const handleExtract = async () => {
    if (!draft || !geminiApiKey) return;
    setDraft({ ...draft, status: 'extracting', error: undefined, errorDetail: undefined, retryable: false });

    // Étape 1 : téléchargement depuis Drive. Étape 2 : analyse Gemini. Chacune est
    // diagnostiquée séparément, avec la cause technique exacte affichée à l'écran.
    const download = await withCspWatch(() => downloadFileAsBase64(draft.fileId));
    if (download.error !== undefined) {
      console.error('Téléchargement fiche de paie échoué', download.error);
      setDraft(d => d && ({ ...d, status: 'reviewing', error: 'Le téléchargement du fichier depuis Drive a échoué.', errorDetail: describeError(download.error, download.blocked), retryable: true }));
      return;
    }
    const analysis = await withCspWatch(() => extractPayslipData(geminiApiKey, download.result as string, draft.mimeType));
    if (analysis.error !== undefined) {
      console.error('Analyse Gemini échouée', analysis.error);
      const code = analysis.error instanceof GeminiError ? analysis.error.code : undefined;
      const error = code === 'OVERLOADED'
        ? "Gemini est très sollicité en ce moment (plusieurs tentatives et modèles essayés automatiquement). Réessayez dans quelques minutes, ou saisissez les montants à la main."
        : code === 'AUTH'
          ? "Gemini refuse la clé API : vérifiez-la dans les Paramètres."
          : "L'extraction automatique a échoué. Vous pouvez saisir les montants manuellement ci-dessous.";
      setDraft(d => d && ({ ...d, status: 'reviewing', error, errorDetail: describeError(analysis.error, analysis.blocked), retryable: code !== 'AUTH' }));
      return;
    }
    setDraft(d => d && ({ ...d, status: 'reviewing', fields: analysis.result! }));
  };

  const patchDraftField = (field: keyof PayslipExtractedData, value: string) => {
    if (!draft) return;
    const isNumeric = field !== 'employer' && field !== 'period';
    // parseFrenchNumber : parseFloat stockait NaN dans le record (propagé jusqu'à
    // "NaN €" dans le Pilotage) et perdait les virgules décimales.
    const parsed = isNumeric ? (value === '' ? undefined : parseFrenchNumber(value) ?? undefined) : value;
    setDraft({
      ...draft,
      fields: { ...draft.fields, [field]: parsed },
    });
  };

  // Doublon de période : deux fiches du même mois mettent deux points sur le même X du
  // graphique et rendent ambigu "Utiliser pour le Pilotage". On prévient, sans bloquer
  // (cas légitimes possibles : fiche rectificative, double contrat).
  const duplicatePeriod = draft?.fields.period && payslips.some(p => p.extracted.period === draft.fields.period);

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
      <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-xs flex flex-col sm:flex-row justify-between gap-4 sm:items-center">
        <div>
          <h2 className="text-2xl font-black text-slate-800 dark:text-slate-100 flex items-center gap-2"><FileText className="w-6 h-6 text-indigo-600" /> Fiches de paie</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">Importez une fiche déjà présente sur votre Drive ; l'IA en extrait les montants clés.</p>
        </div>
        {!draft && (
          <button
            onClick={handlePick}
            disabled={!pickerApiKey || pickerBusy}
            className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed text-white px-5 py-2.5 rounded-xl font-bold flex gap-2 items-center shadow-lg shadow-indigo-200 shrink-0"
          >
            {pickerBusy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Upload className="w-5 h-5" />}
            Importer depuis Drive
          </button>
        )}
      </div>

      {keysMissing && (
        <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-2xl p-5 flex items-start gap-3">
          <KeyRound className="w-5 h-5 text-amber-700 dark:text-amber-400 shrink-0 mt-0.5" />
          <div className="text-sm text-amber-800 dark:text-amber-300">
            <p className="font-black mb-1">Configuration requise</p>
            <p>
              {!pickerApiKey && !geminiApiKey && "Renseignez une clé API Picker et une clé API Gemini dans "}
              {!pickerApiKey && geminiApiKey && "Renseignez une clé API Google Picker dans "}
              {pickerApiKey && !geminiApiKey && "Renseignez une clé API Gemini dans "}
              <span className="font-bold">Paramètres → Fiches de paie</span> pour importer et analyser vos fiches.
            </p>
          </div>
        </div>
      )}

      {/* --- IMPORT EN COURS --- */}
      {draft && (
        <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-indigo-200 dark:border-indigo-800 shadow-xs space-y-4">
          {draft.fileName && (
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <FileText className="w-4 h-4 text-indigo-600 shrink-0" />
                <span className="font-bold text-slate-800 dark:text-slate-100 truncate">{draft.fileName}</span>
              </div>
              <button onClick={() => setDraft(null)} className="p-1.5 text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg shrink-0"><X className="w-4 h-4" /></button>
            </div>
          )}

          {draft.status === 'error' && (
            <div className="text-sm text-rose-700 dark:text-rose-400 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                {draft.error}
                {draft.errorDetail && <p className="mt-1 text-[11px] font-mono break-all opacity-80">Détail : {draft.errorDetail}</p>}
              </div>
            </div>
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
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>
                    {draft.error}
                    {draft.errorDetail && <span className="block mt-1 text-[11px] font-mono break-all opacity-80">Détail : {draft.errorDetail}</span>}
                    {draft.retryable && (
                      <button type="button" onClick={handleExtract} className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold">
                        <Sparkles className="w-3.5 h-3.5" /> Réessayer l'extraction
                      </button>
                    )}
                  </span>
                </p>
              )}
              <p className="text-[11px] text-slate-500 dark:text-slate-400 -mt-1">Vérifiez et corrigez les valeurs avant d'enregistrer — l'extraction automatique peut se tromper.</p>
              {/* key={status} : les champs numériques sont non contrôlés (defaultValue, parsés au
                  blur pour accepter la virgule française) — le remontage à l'arrivée des données
                  extraites recharge leurs valeurs initiales. */}
              <div key={draft.status} className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div><label className="text-[11px] font-black text-slate-500 dark:text-slate-400 uppercase">Employeur</label><input value={draft.fields.employer ?? ''} onChange={e => patchDraftField('employer', e.target.value)} className="w-full p-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg font-bold" /></div>
                <div><label className="text-[11px] font-black text-slate-500 dark:text-slate-400 uppercase">Période (AAAA-MM)</label><input value={draft.fields.period ?? ''} onChange={e => patchDraftField('period', e.target.value)} placeholder="2026-08" className="w-full p-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg font-bold" /></div>
                <div><label className="text-[11px] font-black text-slate-500 dark:text-slate-400 uppercase">Brut (€)</label><input type="text" inputMode="decimal" defaultValue={draft.fields.grossAmount ?? ''} onBlur={e => patchDraftField('grossAmount', e.target.value)} className="w-full p-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg font-bold" /></div>
                <div><label className="text-[11px] font-black text-slate-500 dark:text-slate-400 uppercase">Charges salariales (€)</label><input type="text" inputMode="decimal" defaultValue={draft.fields.socialCharges ?? ''} onBlur={e => patchDraftField('socialCharges', e.target.value)} className="w-full p-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg font-bold" /></div>
                <div><label className="text-[11px] font-black text-slate-500 dark:text-slate-400 uppercase">Net à payer avant impôt (€)</label><input type="text" inputMode="decimal" defaultValue={draft.fields.netAmount ?? ''} onBlur={e => patchDraftField('netAmount', e.target.value)} className="w-full p-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg font-bold" /></div>
                <div><label className="text-[11px] font-black text-slate-500 dark:text-slate-400 uppercase">Net imposable (€)</label><input type="text" inputMode="decimal" defaultValue={draft.fields.netTaxable ?? ''} onBlur={e => patchDraftField('netTaxable', e.target.value)} className="w-full p-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg font-bold" /></div>
                <div><label className="text-[11px] font-black text-slate-500 dark:text-slate-400 uppercase">Remb. Navigo (€)</label><input type="text" inputMode="decimal" defaultValue={draft.fields.navigoRefund ?? ''} onBlur={e => patchDraftField('navigoRefund', e.target.value)} className="w-full p-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg font-bold" /></div>
                <div><label className="text-[11px] font-black text-slate-500 dark:text-slate-400 uppercase">Mutuelle (part salarié, €)</label><input type="text" inputMode="decimal" defaultValue={draft.fields.mutuelleCost ?? ''} onBlur={e => patchDraftField('mutuelleCost', e.target.value)} className="w-full p-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg font-bold" /></div>
                <div><label className="text-[11px] font-black text-slate-500 dark:text-slate-400 uppercase">Tickets restaurant (€)</label><input type="text" inputMode="decimal" defaultValue={draft.fields.mealVouchers ?? ''} onBlur={e => patchDraftField('mealVouchers', e.target.value)} className="w-full p-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg font-bold" /></div>
                <div><label className="text-[11px] font-black text-amber-700 dark:text-amber-400 uppercase">Impôt prélevé à la source (€)</label><input type="text" inputMode="decimal" defaultValue={draft.fields.incomeTaxWithheld ?? ''} onBlur={e => patchDraftField('incomeTaxWithheld', e.target.value)} className="w-full p-2 bg-slate-50 dark:bg-slate-900 border border-amber-200 dark:border-amber-800 rounded-lg font-bold" /></div>
                <div><label className="text-[11px] font-black text-emerald-700 dark:text-emerald-400 uppercase">Net payé (viré en banque, €)</label><input type="text" inputMode="decimal" defaultValue={draft.fields.netPaid ?? ''} onBlur={e => patchDraftField('netPaid', e.target.value)} className="w-full p-2 bg-slate-50 dark:bg-slate-900 border border-emerald-200 dark:border-emerald-800 rounded-lg font-bold" /></div>
              </div>
              <div className="flex gap-2 justify-end pt-2">
                <button onClick={() => setDraft(null)} className="px-4 py-2 rounded-xl font-bold text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 flex items-center gap-1"><X className="w-4 h-4" /> Annuler</button>
                <button onClick={saveDraft} className="px-4 py-2 rounded-xl font-bold text-sm bg-indigo-600 text-white hover:bg-indigo-700 flex items-center gap-1"><Check className="w-4 h-4" /> Enregistrer</button>
              </div>
              {duplicatePeriod && (
                <p className="mt-2 flex items-start justify-end gap-1.5 text-[11px] font-bold text-amber-700 dark:text-amber-300">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
                  Une fiche existe déjà pour la période {draft?.fields.period} : les deux apparaîtront sur le graphique.
                </p>
              )}
            </>
          )}
        </div>
      )}

      {/* --- ÉVOLUTION DU NET --- */}
      {chartData.length >= 2 && !draft && (
        <section aria-labelledby="payslips-net-title" className="bg-surface-container-lowest dark:bg-surface-container-low p-5 sm:p-6 rounded-2xl border border-outline-variant">
          <h3 id="payslips-net-title" className="text-base font-medium text-on-surface flex items-center gap-2 mb-2"><TrendingUp className="w-5 h-5 text-indigo-600 dark:text-indigo-300" aria-hidden="true" /> Évolution du net</h3>
          <ChartFrame
            summary={describeEvolution('Votre salaire net', chartData[0].net, chartData[chartData.length - 1].net, chartData[0].period, chartData[chartData.length - 1].period, 'm')}
            table={<DataTable caption="Salaire net et brut, fiche par fiche" columns={netColumns} rows={chartData} rowKey={p => p.period} />}
          >
            <AreaSeriesChart data={netRows} series={[{ key: 'net', label: 'Net', color: t.brand }]} />
          </ChartFrame>
        </section>
      )}

      {/* --- HISTORIQUE --- */}
      {payslips.length === 0 && !draft && (
        <div className="text-center py-16 text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700">
          <FileText className="w-10 h-10 mx-auto mb-3 opacity-40" />
          Aucune fiche de paie importée pour l'instant.
        </div>
      )}

      {payslips.length > 0 && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm sm:min-w-136">
              <thead className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700">
                <tr>
                  <th className="px-3 sm:px-6 py-3 text-[11px] font-black text-slate-500 dark:text-slate-400 uppercase">Période</th>
                  <th className="hidden sm:table-cell px-6 py-3 text-[11px] font-black text-slate-500 dark:text-slate-400 uppercase text-right">Brut</th>
                  <th className="px-3 sm:px-6 py-3 text-[11px] font-black text-slate-500 dark:text-slate-400 uppercase text-right">Net payé</th>
                  <th className="px-3 sm:px-6 py-3 text-right"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {[...payslips].sort((a, b) => (b.extracted.period || '').localeCompare(a.extracted.period || '')).map(p => {
                  const isActive = p.id === activePayslipId;
                  const anomaly = anomalies.get(p.id);
                  return (
                  <React.Fragment key={p.id}>
                  <tr className={`hover:bg-slate-50 dark:hover:bg-slate-800 ${isActive ? 'bg-amber-50/60 dark:bg-amber-950/20' : ''}`}>
                    <td className="px-3 sm:px-6 py-3">
                      <div className="font-bold text-slate-800 dark:text-slate-100 flex flex-wrap items-center gap-x-2 gap-y-1">
                        {p.extracted.period ? formatPeriod(p.extracted.period) : '—'}
                        {isActive && <span className="text-[11px] font-black uppercase bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-300 px-1.5 py-0.5 rounded-sm">Référence du Pilotage</span>}
                        {anomaly && <span className="text-[11px] font-medium bg-tertiary-container text-on-tertiary-container px-1.5 py-0.5 rounded-sm inline-flex items-center gap-1 whitespace-nowrap"><AlertTriangle className="w-3 h-3" aria-hidden="true" /> À vérifier</span>}
                      </div>
                      <div className="text-[11px] uppercase text-slate-500 dark:text-slate-400 font-bold">{p.extracted.employer || p.fileName}</div>
                    </td>
                    <td className="hidden sm:table-cell px-6 py-3 text-right font-mono text-slate-600 dark:text-slate-300">{fmt(p.extracted.grossAmount)}</td>
                    <td className="px-3 sm:px-6 py-3 text-right font-black text-emerald-700 dark:text-emerald-400">{fmt(p.extracted.netPaid ?? p.extracted.netAmount)}</td>
                    <td className="px-3 sm:px-6 py-3 text-right">
                      <div className="flex justify-end gap-1">
                        {isActive ? (
                          <button onClick={onClearActivePayslip} className="p-2 text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 hover:bg-amber-100 dark:hover:bg-amber-900 rounded-lg" title="Revenir à l'estimation théorique"><Wand2 className="w-4 h-4" /></button>
                        ) : p.extracted.grossAmount !== undefined && (
                          <button onClick={() => onApplyToPilotage(p)} className="p-2 text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/40 rounded-lg" title="Utiliser pour mon Pilotage budgétaire (chiffres exacts)"><Wand2 className="w-4 h-4" /></button>
                        )}
                        <a href={`https://drive.google.com/file/d/${p.fileId}/view`} target="_blank" rel="noopener noreferrer" className="p-2 text-indigo-600 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 rounded-lg" title="Ouvrir sur Drive"><ExternalLink className="w-4 h-4" /></a>
                        <button onClick={() => removePayslip(p.id)} className="p-2 text-slate-300 dark:text-slate-600 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg" title="Retirer de la liste"><Trash2 className="w-4 h-4" /></button>
                      </div>
                    </td>
                  </tr>
                  {anomaly && (
                    <tr className={isActive ? 'bg-amber-50/60 dark:bg-amber-950/20' : ''}>
                      <td colSpan={4} className="px-3 sm:px-6 pb-3 pt-0">
                        <p className="text-xs text-on-surface-variant flex items-start gap-1.5 bg-surface-container rounded-lg p-2.5">
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px text-on-tertiary-container" aria-hidden="true" />
                          <span><span className="sr-only">Fiche de {p.extracted.period ? formatPeriod(p.extracted.period) : ''} à vérifier : </span>{describeAnomaly(anomaly)}</span>
                        </p>
                      </td>
                    </tr>
                  )}
                  </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
