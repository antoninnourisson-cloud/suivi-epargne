// ================================================
// FILE: src/components/Payslips.tsx
// Import de fiches de paie depuis le Drive de l'utilisateur (Google Picker — le fichier
// original n'est jamais copié, on ne stocke que sa référence) et extraction des montants
// via l'API Gemini, à la demande explicite (chaque clic consomme le quota de l'utilisateur).
// ================================================
import React, { useMemo, useRef, useState } from 'react';
import { PayslipRecord, PayslipExtractedData } from '../types';
import { openDrivePicker, downloadFileAsBase64 } from '../services/googleDriveService';
import { extractPayslipData, GeminiError } from '../services/geminiService';
import { parseFrenchNumber } from '../lib/numbers';
import { FileText, Upload, Sparkles, Trash2, ExternalLink, AlertTriangle, Check, X, Loader2, KeyRound, TrendingUp, Wand2, PenLine } from 'lucide-react';
import { formatEUR, formatPeriod, toInputAmount } from '../lib/format';
import { useIsDark, chartTheme } from '../lib/chartTheme';
import { describeEvolution } from '../lib/chartData';
import { AreaSeriesChart, type AreaRow } from './charts/AreaSeriesChart';
import { ChartFrame } from './charts/ChartFrame';
import { Button, Card, DataTable, EmptyState, IconButton, ListItem, MoneyText, PageHeader, TextField, type Column } from './ui';
import { detectPayslipAnomalies } from '../lib/motivation';
import { describeAnomaly } from './motivation/text';
import { useUndoableRemove } from './Toast';
import { focusAfterRemoval } from './focusAfterRemoval';

interface PayslipsProps {
  payslips: PayslipRecord[];
  onUpdatePayslips: React.Dispatch<React.SetStateAction<PayslipRecord[]>>;
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
  /** Clé manquante : ouvre Paramètres, rubrique « Clés et services ». */
  onOpenKeys?: () => void;
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

type AmountField = Exclude<keyof PayslipExtractedData, 'employer' | 'period'>;
// Montants relus avant d'enregistrer : un seul style de champ (TextField), libellés reliés.
const AMOUNT_FIELDS: { key: AmountField; label: string; supporting?: string }[] = [
  { key: 'grossAmount', label: 'Brut' },
  { key: 'socialCharges', label: 'Charges salariales' },
  { key: 'netAmount', label: 'Net à payer avant impôt' },
  { key: 'netTaxable', label: 'Net imposable' },
  { key: 'navigoRefund', label: 'Remboursement Navigo' },
  { key: 'mutuelleCost', label: 'Mutuelle (votre part)' },
  { key: 'mealVouchers', label: 'Tickets restaurant' },
  { key: 'incomeTaxWithheld', label: 'Impôt prélevé à la source', supporting: 'Le prélèvement réellement appliqué ce mois-ci.' },
  { key: 'netPaid', label: 'Net payé', supporting: 'Le montant viré sur votre compte.' },
];

const KEYS_NOTE_ID = 'payslips-keys-note';
const keysNote = (picker: boolean, gemini: boolean) =>
  !picker && !gemini ? 'Ajoutez une clé Google Picker et une clé Gemini dans Paramètres, rubrique « Clés et services », pour importer vos fiches et en lire les montants.'
    : !picker ? 'Ajoutez une clé Google Picker dans Paramètres, rubrique « Clés et services », pour choisir une fiche sur votre Drive.'
      : 'Ajoutez une clé Gemini dans Paramètres, rubrique « Clés et services », pour que l\'IA lise vos fiches. Sans elle, vous pouvez saisir les montants à la main.';

const driveUrl = (id: string) => `https://drive.google.com/file/d/${encodeURIComponent(id)}/view`;
// Lien fait d'une seule icône, à l'image de ui/IconButton : 48 px de côté, libellé dans aria-label.
const iconLink = 'w-12 h-12 shrink-0 rounded-full inline-flex items-center justify-center text-on-surface-variant transition-colors hover:text-on-surface hover:bg-on-surface/8';

const periodName = (p: PayslipRecord) => (p.extracted.period ? formatPeriod(p.extracted.period) : p.fileName || 'sans date');

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

export const Payslips: React.FC<PayslipsProps> = ({ payslips, onUpdatePayslips, geminiApiKey, pickerApiKey, onApplyToPilotage, activePayslipId, onClearActivePayslip, onOpenKeys }) => {
  const t = chartTheme(useIsDark());
  const [draft, setDraft] = useState<DraftPayslip | null>(null);
  const [pickerBusy, setPickerBusy] = useState(false);
  // Montants saisis mais illisibles (« 12a ») : signalés sous le champ, valeur précédente gardée.
  const [badFields, setBadFields] = useState<Partial<Record<AmountField, boolean>>>({});
  const listRef = useRef<HTMLUListElement>(null);
  const importRef = useRef<HTMLButtonElement>(null);
  const removeWithUndo = useUndoableRemove();

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
    setBadFields({});

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

  const patchDraftField = (field: 'employer' | 'period', value: string) => {
    setDraft(d => d && ({ ...d, fields: { ...d.fields, [field]: value } }));
  };
  // parseFrenchNumber : parseFloat stockerait NaN dans le record (propagé jusqu'à « NaN € »
  // dans le Pilotage) et perdrait les virgules décimales. Champ vidé : montant retiré.
  const patchAmount = (field: AmountField, value: string) => {
    const raw = value.trim();
    const parsed = raw === '' ? undefined : parseFrenchNumber(raw);
    if (parsed === null) { setBadFields(b => ({ ...b, [field]: true })); return; }
    setBadFields(b => ({ ...b, [field]: false }));
    setDraft(d => d && ({ ...d, fields: { ...d.fields, [field]: parsed } }));
  };
  const closeDraft = () => { setDraft(null); setBadFields({}); };

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
    onUpdatePayslips(prev => [record, ...prev]);
    closeDraft();
  };

  const sorted = useMemo(
    () => [...payslips].sort((a, b) => (b.extracted.period || '').localeCompare(a.extracted.period || '')),
    [payslips]
  );
  // Retrait annulable (le fichier reste sur le Drive) ; le focus va sur la fiche voisine,
  // sinon sur « Importer depuis Drive », sinon (bouton absent ou désactivé) sur le titre.
  const removePayslip = (p: PayslipRecord) => {
    removeWithUndo(payslips, p, onUpdatePayslips, `Fiche de ${periodName(p)} retirée de la liste (le fichier reste sur votre Drive)`);
    focusAfterRemoval(() => listRef.current, sorted.findIndex(x => x.id === p.id), () => importRef.current);
  };


  return (
    <div className="space-y-6 animate-fade-in pb-20">
      <PageHeader
        title="Fiches de paie"
        subtitle="Importez une fiche déjà rangée sur votre Drive : l'IA en lit les montants, vous les vérifiez avant d'enregistrer."
        actions={!draft && (
          // Désactivé sans clé Picker : la raison est écrite juste en dessous (aria-describedby).
          <Button ref={importRef} onClick={handlePick} disabled={!pickerApiKey || pickerBusy} aria-describedby={!pickerApiKey ? KEYS_NOTE_ID : undefined} className="max-sm:h-12">
            {pickerBusy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Upload className="w-4 h-4" aria-hidden="true" />}
            Importer depuis Drive
          </Button>
        )}
      />

      {keysMissing && (
        <div className="rounded-2xl bg-tertiary-container text-on-tertiary-container p-4 text-sm flex items-start gap-3">
          <KeyRound className="w-5 h-5 shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <p id={KEYS_NOTE_ID}>{keysNote(!!pickerApiKey, !!geminiApiKey)}</p>
            {onOpenKeys && (
              <Button variant="text" onClick={onOpenKeys} className="mt-1 -ml-3 px-3! max-sm:h-12 text-on-tertiary-container! enabled:hover:bg-on-tertiary-container/8!">
                Ouvrir « Clés et services »
              </Button>
            )}
          </div>
        </div>
      )}

      {/* --- IMPORT EN COURS --- */}
      {draft && (
        <Card
          title={<span className="break-all">{draft.fileName || 'Import impossible'}</span>}
          icon={draft.status === 'error' ? AlertTriangle : FileText}
          action={<IconButton icon={X} label={draft.status === 'reviewing' ? 'Abandonner cette fiche' : "Fermer l'import"} onClick={closeDraft} className="-my-3 -mr-3" />}
        >
          <div className="space-y-4">
            {draft.status === 'error' && (
              <div role="alert" className="text-sm text-error flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="font-medium">{draft.error}</p>
                  {draft.errorDetail && <p className="mt-1 text-xs text-on-surface-variant break-all">Détail technique : {draft.errorDetail}</p>}
                </div>
              </div>
            )}

            {draft.status === 'picked' && (
              <>
                <div className="flex flex-wrap gap-2">
                  <Button variant="tonal" onClick={handleExtract} disabled={!geminiApiKey} aria-describedby={!geminiApiKey ? KEYS_NOTE_ID : undefined} className="flex-1 max-sm:h-12">
                    <Sparkles className="w-4 h-4" aria-hidden="true" /> Analyser avec l'IA
                  </Button>
                  <Button variant="text" onClick={() => setDraft(d => d && ({ ...d, status: 'reviewing' }))} className="max-sm:h-12">
                    <PenLine className="w-4 h-4" aria-hidden="true" /> Saisir à la main
                  </Button>
                </div>
                <p className="text-xs text-on-surface-variant">L'analyse utilise votre quota Gemini, à chaque clic.</p>
              </>
            )}

            {draft.status === 'extracting' && (
              <p role="status" className="flex items-center justify-center gap-2 py-6 text-sm text-on-surface-variant">
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Analyse en cours…
              </p>
            )}

            {draft.status === 'reviewing' && (
              <>
                {draft.error && (
                  <div role="alert" className="rounded-xl bg-tertiary-container text-on-tertiary-container p-3 text-sm flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                    <div className="min-w-0">
                      <p>{draft.error}</p>
                      {draft.errorDetail && <p className="mt-1 text-xs break-all">Détail technique : {draft.errorDetail}</p>}
                      {draft.retryable && (
                        <Button variant="tonal" onClick={handleExtract} className="mt-3 max-sm:h-12">
                          <Sparkles className="w-4 h-4" aria-hidden="true" /> Réessayer l'analyse
                        </Button>
                      )}
                    </div>
                  </div>
                )}
                <p className="text-sm text-on-surface-variant">Vérifiez et corrigez les montants avant d'enregistrer : la lecture automatique peut se tromper.</p>
                {/* key={status} : les montants sont non contrôlés (defaultValue, lus en quittant le
                    champ pour accepter la virgule) ; le remontage à l'arrivée des données
                    extraites recharge leurs valeurs initiales. */}
                <div key={draft.status} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <TextField label="Employeur" value={draft.fields.employer ?? ''} onChange={e => patchDraftField('employer', e.target.value)} />
                  <TextField label="Mois de la paie (AAAA-MM)" value={draft.fields.period ?? ''} onChange={e => patchDraftField('period', e.target.value)} placeholder="ex. 2026-08" />
                  {AMOUNT_FIELDS.map(f => {
                    const v = draft.fields[f.key];
                    return (
                      <TextField
                        key={f.key}
                        label={f.label}
                        suffix="€"
                        inputMode="decimal"
                        defaultValue={v === undefined ? '' : toInputAmount(v)}
                        onBlur={e => patchAmount(f.key, e.target.value)}
                        supporting={f.supporting}
                        error={badFields[f.key] ? 'Montant non reconnu (exemple : 1 234,56) : la valeur précédente est gardée.' : undefined}
                      />
                    );
                  })}
                </div>
                {duplicatePeriod && (
                  <p role="status" className="text-sm text-on-surface-variant flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-tertiary" aria-hidden="true" />
                    Une fiche existe déjà pour {formatPeriod(draft.fields.period ?? '')} : les deux apparaîtront sur le graphique.
                  </p>
                )}
                <div className="flex flex-wrap justify-end gap-2 pt-2">
                  <Button variant="text" onClick={closeDraft} className="max-sm:h-12">Annuler</Button>
                  <Button onClick={saveDraft} className="max-sm:h-12"><Check className="w-4 h-4" aria-hidden="true" /> Enregistrer la fiche</Button>
                </div>
              </>
            )}
          </div>
        </Card>
      )}

      {/* --- ÉVOLUTION DU NET --- */}
      {chartData.length >= 2 && !draft && (
        <Card title="Évolution du net" icon={TrendingUp}>
          <ChartFrame
            summary={describeEvolution('Votre salaire net', chartData[0].net, chartData[chartData.length - 1].net, chartData[0].period, chartData[chartData.length - 1].period, 'm')}
            table={<DataTable caption="Salaire net et brut, fiche par fiche" columns={netColumns} rows={chartData} rowKey={p => p.period} />}
          >
            <AreaSeriesChart data={netRows} series={[{ key: 'net', label: 'Net', color: t.brand }]} />
          </ChartFrame>
        </Card>
      )}

      {/* --- HISTORIQUE --- */}
      {payslips.length === 0 && !draft && (
        <Card variant="filled" padding="none">
          <EmptyState icon={FileText} title="Aucune fiche de paie pour l'instant">
            Importez une fiche rangée sur votre Drive avec « Importer depuis Drive ». Une fois vérifiée, le Pilotage peut s'en servir à la place de son estimation.
          </EmptyState>
        </Card>
      )}

      {sorted.length > 0 && (
        <Card title="Vos fiches" icon={FileText} padding="none" className="pb-1">
          <ul ref={listRef} className="divide-y divide-outline-variant border-t border-outline-variant">
            {sorted.map(p => {
              const isActive = p.id === activePayslipId;
              const anomaly = anomalies.get(p.id);
              const name = periodName(p);
              const net = p.extracted.netPaid ?? p.extracted.netAmount;
              return (
                <ListItem
                  key={p.id}
                  className={`px-4 sm:px-6 ${isActive ? 'bg-secondary-container/50' : ''}`}
                  headline={<>
                    {name}
                    {isActive && <span className="ml-2 inline-flex items-center h-6 px-2 rounded-sm text-xs font-medium bg-secondary-container text-on-secondary-container align-middle">Référence du Pilotage</span>}
                    {anomaly && <span className="ml-2 inline-flex items-center gap-1 h-6 px-2 rounded-sm text-xs font-medium bg-tertiary-container text-on-tertiary-container align-middle whitespace-nowrap"><AlertTriangle className="w-3 h-3" aria-hidden="true" /> À vérifier</span>}
                  </>}
                  supporting={<>
                    {p.extracted.employer || p.fileName}
                    {p.extracted.grossAmount !== undefined && <> · brut {fmt(p.extracted.grossAmount)}</>}
                    {anomaly && <span className="block mt-1">{describeAnomaly(anomaly)}</span>}
                  </>}
                  trailing={net !== undefined
                    ? <><MoneyText value={net} className="text-on-surface" /><span className="block text-xs font-normal text-on-surface-variant">net payé</span></>
                    : <span className="text-on-surface-variant">—<span className="sr-only">net payé inconnu</span></span>}
                  actions={<>
                    {isActive ? (
                      <Button variant="tonal" onClick={onClearActivePayslip} className="max-sm:h-12">
                        <Wand2 className="w-4 h-4" aria-hidden="true" /> Revenir à l'estimation
                      </Button>
                    ) : p.extracted.grossAmount !== undefined && (
                      <Button variant="text" onClick={() => onApplyToPilotage(p)} className="max-sm:h-12">
                        <Wand2 className="w-4 h-4" aria-hidden="true" /> Utiliser pour le Pilotage{' '}<span className="sr-only">(fiche de {name})</span>
                      </Button>
                    )}
                    <a
                      href={driveUrl(p.fileId)}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`Ouvrir la fiche de ${name} sur Drive (nouvel onglet)`}
                      title="Ouvrir sur Drive"
                      className={iconLink}
                      data-focus-after-removal
                    >
                      <ExternalLink className="w-5 h-5" aria-hidden="true" />
                    </a>
                    <IconButton icon={Trash2} tone="danger" label={`Retirer la fiche de ${name} de la liste`} onClick={() => removePayslip(p)} />
                  </>}
                />
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
};
