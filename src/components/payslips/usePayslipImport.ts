// ================================================
// FILE: src/components/payslips/usePayslipImport.ts
// Import d'UNE fiche de paie, partagé par l'écran Fiches de paie et le rituel « J'ai reçu
// ma paie » (étape « Votre paie ») : choix du fichier (appareil ou Drive), lecture par
// Gemini à la demande, relecture obligatoire des montants, contrôles (montants qui ne se
// recoupent pas, fiche du même mois : « Remplacer » ou « Ajouter »), puis enregistrement
// dans la liste des fiches. Les composants d'affichage sont dans PayslipImportParts.
// ================================================
import React, { useMemo, useState } from 'react';
import type { PayslipExtractedData, PayslipRecord } from '../../types';
import { openDrivePicker, downloadFileAsBase64 } from '../../services/googleDriveService';
import { extractPayslipData, fileToBase64, GeminiError } from '../../services/geminiService';
import { parseFrenchNumber } from '../../lib/numbers';
import { payslipConsistency } from '../../lib/payslipChecks';
import { STATEMENT_MAX_BYTES, statementMimeType } from '../../services/statementReader';

// Fiche en cours d'import, avant d'être définitivement enregistrée dans `payslips`.
export interface DraftPayslip {
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
  /** Fichier de l'appareil (choisi ou partagé vers Pécule), lu sans passer par Drive ; `fileId` vide. */
  localFile?: File;
}

export type AmountField = Exclude<keyof PayslipExtractedData, 'employer' | 'period'>;
// Montants relus avant d'enregistrer : un seul style de champ (TextField), libellés reliés.
export const AMOUNT_FIELDS: { key: AmountField; label: string; supporting?: string }[] = [
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

export type PayslipSaveMode = 'new' | 'replace' | 'add';

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

/**
 * Fiches après l'enregistrement de `record` : « Remplacer » retire les fiches du même mois,
 * « Ajouter » marque la nouvelle comme s'ajoutant au mois (deuxième employeur, rappel). La
 * plus récente en tête, comme l'écran Fiches de paie l'a toujours fait.
 */
export const withSavedPayslip = (prev: PayslipRecord[], record: PayslipRecord, replaced: ReadonlySet<string>): PayslipRecord[] =>
  [record, ...prev.filter(p => !replaced.has(p.id))];

export interface PayslipImportOptions {
  payslips: PayslipRecord[];
  geminiApiKey: string;
  pickerApiKey: string;
  /** Fiche relue et enregistrée : la liste à jour se fait chez l'appelant. */
  onSave: (record: PayslipRecord, replacedIds: ReadonlySet<string>) => void;
  /** Mois proposé pour une saisie à la main ('YYYY-MM'), si la lecture n'en donne pas. */
  defaultPeriod?: string;
}

export const usePayslipImport = ({ payslips, geminiApiKey, pickerApiKey, onSave, defaultPeriod }: PayslipImportOptions) => {
  const [draft, setDraft] = useState<DraftPayslip | null>(null);
  const [pickerBusy, setPickerBusy] = useState(false);
  // Montants saisis mais illisibles (« 12a ») : signalés sous le champ, valeur précédente gardée.
  const [badFields, setBadFields] = useState<Partial<Record<AmountField, boolean>>>({});
  const emptyFields = (): PayslipExtractedData => (defaultPeriod ? { period: defaultPeriod } : {});

  /** Fichier déjà sur l'appareil (partagé vers Pécule) : il devient l'import en cours. */
  const openFile = (file: File) => {
    setDraft({ fileId: '', fileName: file.name, mimeType: file.type || 'application/pdf', status: 'picked', fields: emptyFields(), localFile: file });
    setBadFields({});
  };

  const handlePick = async () => {
    if (!pickerApiKey) return;
    setPickerBusy(true);
    const pickerBlocked: string[] = [];
    const onPickerViolation = (ev: SecurityPolicyViolationEvent) => pickerBlocked.push(`${ev.effectiveDirective} ${ev.blockedURI || '(inline)'}`);
    document.addEventListener('securitypolicyviolation', onPickerViolation);
    try {
      const picked = await openDrivePicker(pickerApiKey);
      if (picked) {
        setDraft({ fileId: picked.id, fileName: picked.name, mimeType: picked.mimeType, status: 'picked', fields: emptyFields() });
      }
    } catch (e) {
      console.error('Ouverture du sélecteur Drive échouée', e);
      setDraft({ fileId: '', fileName: '', mimeType: '', status: 'error', error: "Impossible d'ouvrir le sélecteur Google Drive. Vérifiez la clé API Picker dans les Paramètres.", errorDetail: describeError(e, pickerBlocked), fields: emptyFields() });
    } finally {
      document.removeEventListener('securitypolicyviolation', onPickerViolation);
      setPickerBusy(false);
    }
  };

  // Fichier de l'appareil : mêmes types et même limite que le partage et « Lire un relevé ».
  // Rien n'est lu ni envoyé avant « Analyser avec l'IA ».
  const onDeviceFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBadFields({});
    const mimeType = statementMimeType(file);
    const refused = !mimeType ? 'Pécule ne lit que les PDF et les images (PNG, JPEG, WebP…). Choisissez la fiche au format PDF ou une photo nette.'
      : file.size > STATEMENT_MAX_BYTES ? 'Ce fichier est trop lourd : 15 Mo au plus.' : null;
    if (refused || !mimeType) {
      setDraft({ fileId: '', fileName: file.name, mimeType: '', status: 'error', error: refused ?? undefined, fields: emptyFields() });
      return;
    }
    setDraft({ fileId: '', fileName: file.name, mimeType, status: 'picked', fields: emptyFields(), localFile: file });
  };

  /** Saisie de la fiche à la main, sans fichier (rituel de paie, sans clé Gemini). */
  const startManual = () => {
    setBadFields({});
    setDraft({ fileId: '', fileName: '', mimeType: '', status: 'reviewing', fields: emptyFields() });
  };

  const handleExtract = async () => {
    if (!draft || !geminiApiKey) return;
    setDraft({ ...draft, status: 'extracting', error: undefined, errorDetail: undefined, retryable: false });
    setBadFields({});

    // Étape 1 : lecture du fichier (téléchargement depuis Drive, ou fichier partagé déjà sur
    // l'appareil). Étape 2 : analyse Gemini. Chacune est diagnostiquée séparément, avec la
    // cause technique exacte affichée à l'écran.
    const local = draft.localFile;
    const download = await withCspWatch(() => (local ? fileToBase64(local) : downloadFileAsBase64(draft.fileId)));
    if (download.error !== undefined) {
      console.error('Lecture fiche de paie échouée', download.error);
      const error = local ? 'La lecture du fichier a échoué.' : 'Le téléchargement du fichier depuis Drive a échoué.';
      setDraft(d => d && ({ ...d, status: 'reviewing', error, errorDetail: describeError(download.error, download.blocked), retryable: true }));
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
    // Mois illisible pour l'IA : celui proposé par l'appelant reste.
    setDraft(d => d && ({ ...d, status: 'reviewing', fields: { ...(defaultPeriod ? { period: defaultPeriod } : {}), ...analysis.result! } }));
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
  const toReviewing = () => setDraft(d => d && ({ ...d, status: 'reviewing' }));

  // Doublon de période : la fiche rectificative (ou la même fiche importée deux fois)
  // remplace l'ancienne ; un deuxième employeur ou un rappel de salaire s'ajoute. Le choix
  // est demandé à l'enregistrement : sans lui, la déclaration (1AJ, 8HV) et le revenu estimé
  // pour le LEP compteraient le mois deux fois (lib/payslipChecks, countedPayslips).
  const draftPeriod = draft?.fields.period;
  const samePeriod = useMemo(
    () => (draftPeriod ? payslips.filter(p => p.extracted.period === draftPeriod) : []),
    [payslips, draftPeriod]);
  // Montants qui ne se recoupent pas (net avant impôt − impôt ≠ net payé…) : avertissement,
  // l'enregistrement reste possible.
  const reviewFields = draft?.status === 'reviewing' ? draft.fields : null;
  const warnings = useMemo(() => (reviewFields ? payslipConsistency(reviewFields) : []), [reviewFields]);
  const suspect = new Set(warnings.flatMap(w => w.fields));

  const saveDraft = (mode: PayslipSaveMode) => {
    if (!draft) return;
    const record: PayslipRecord = {
      id: crypto.randomUUID(),
      fileId: draft.fileId,
      fileName: draft.fileName,
      addedAt: new Date().toISOString(),
      extracted: draft.fields,
      reviewed: true, // l'utilisateur vient de relire/valider l'écran de relecture
      ...(mode === 'add' ? { addsToPeriod: true } : {}),
    };
    onSave(record, new Set(mode === 'replace' ? samePeriod.map(p => p.id) : []));
    closeDraft();
  };

  return {
    draft, pickerBusy, badFields, samePeriod, warnings, suspect,
    openFile, handlePick, onDeviceFile, startManual, handleExtract, patchDraftField, patchAmount, closeDraft, toReviewing, saveDraft,
    hasGemini: !!geminiApiKey, hasPicker: !!pickerApiKey,
  };
};

export type PayslipImport = ReturnType<typeof usePayslipImport>;
