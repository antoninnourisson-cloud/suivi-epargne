// ================================================
// FILE: src/components/payslips/PayslipImportParts.tsx
// Ce que l'on voit de l'import d'une fiche de paie (usePayslipImport) : les deux boutons de
// choix du fichier et la carte de l'import en cours (analyse, relecture des montants,
// contrôles, enregistrement). Les mêmes dans l'écran Fiches de paie et dans le rituel
// « J'ai reçu ma paie ».
// ================================================
import React, { useRef } from 'react';
import { AlertTriangle, Check, FileText, Loader2, PenLine, Smartphone, Sparkles, Upload, X } from 'lucide-react';
import { formatPeriod, toInputAmount } from '../../lib/format';
import { STATEMENT_ACCEPT } from '../../services/statementReader';
import { deMonth } from '../motivation/text';
import { Button, Card, IconButton, TextField } from '../ui';
import { AMOUNT_FIELDS, type PayslipImport } from './usePayslipImport';

interface PickButtonsProps {
  imp: PayslipImport;
  /** Id du texte qui dit pourquoi « Importer depuis Drive » est désactivé. */
  keysNoteId?: string;
  deviceRef?: React.Ref<HTMLButtonElement>;
  importRef?: React.Ref<HTMLButtonElement>;
}

/** « Choisir sur l'appareil » et « Importer depuis Drive ». */
export const PayslipPickButtons: React.FC<PickButtonsProps> = ({ imp, keysNoteId, deviceRef, importRef }) => {
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <>
      {/* Fichier lu sur l'appareil : rien n'est copié sur Drive, aucune autorisation Google en plus. */}
      <input ref={fileRef} type="file" accept={STATEMENT_ACCEPT} onChange={imp.onDeviceFile} className="hidden" tabIndex={-1} aria-hidden="true" data-testid="payslip-file" />
      <Button ref={deviceRef} variant="tonal" onClick={() => fileRef.current?.click()} className="max-sm:h-12">
        <Smartphone className="w-4 h-4" aria-hidden="true" /> Choisir sur l'appareil
      </Button>
      {/* Désactivé sans clé Picker : la raison est écrite à côté (aria-describedby). */}
      <Button ref={importRef} onClick={imp.handlePick} disabled={!imp.hasPicker || imp.pickerBusy} aria-describedby={!imp.hasPicker ? keysNoteId : undefined} className="max-sm:h-12">
        {imp.pickerBusy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Upload className="w-4 h-4" aria-hidden="true" />}
        Importer depuis Drive
      </Button>
    </>
  );
};

interface DraftCardProps {
  imp: PayslipImport;
  keysNoteId?: string;
  /** Rituel de paie : carte posée dans la feuille (sans ombre). */
  variant?: 'elevated' | 'outlined';
}

/** L'import en cours : analyse par l'IA, relecture obligatoire, puis enregistrement. */
export const PayslipDraftCard: React.FC<DraftCardProps> = ({ imp, keysNoteId, variant }) => {
  const { draft, badFields, samePeriod, warnings, suspect } = imp;
  if (!draft) return null;
  const periodLabel = formatPeriod(draft.fields.period ?? '');
  const title = draft.fileName || (draft.status === 'error' ? 'Import impossible' : 'Fiche saisie à la main');
  return (
    <Card
      variant={variant}
      title={<span className="break-all">{title}</span>}
      icon={draft.status === 'error' ? AlertTriangle : FileText}
      action={<IconButton icon={X} label={draft.status === 'reviewing' ? 'Abandonner cette fiche' : "Fermer l'import"} onClick={imp.closeDraft} className="-my-3 -mr-3" />}
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
              <Button variant="tonal" onClick={imp.handleExtract} disabled={!imp.hasGemini} aria-describedby={!imp.hasGemini ? keysNoteId : undefined} className="flex-1 max-sm:h-12">
                <Sparkles className="w-4 h-4" aria-hidden="true" /> Analyser avec l'IA
              </Button>
              <Button variant="text" onClick={imp.toReviewing} className="max-sm:h-12">
                <PenLine className="w-4 h-4" aria-hidden="true" /> Saisir à la main
              </Button>
            </div>
            <p className="text-xs text-on-surface-variant">L'analyse utilise votre quota Gemini, à chaque clic.</p>
            {draft.localFile && (
              <p className="text-xs text-on-surface-variant">Fiche lue sur cet appareil : elle n'est pas copiée sur votre Drive. Seuls son nom et les montants vérifiés sont enregistrés.</p>
            )}
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
                    <Button variant="tonal" onClick={imp.handleExtract} className="mt-3 max-sm:h-12">
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
              <TextField label="Employeur" value={draft.fields.employer ?? ''} onChange={e => imp.patchDraftField('employer', e.target.value)} />
              <TextField label="Mois de la paie (AAAA-MM)" value={draft.fields.period ?? ''} onChange={e => imp.patchDraftField('period', e.target.value)} placeholder="ex. 2026-08" />
              {AMOUNT_FIELDS.map(f => {
                const v = draft.fields[f.key];
                return (
                  <TextField
                    key={f.key}
                    label={f.label}
                    suffix="€"
                    inputMode="decimal"
                    defaultValue={v === undefined ? '' : toInputAmount(v)}
                    onBlur={e => imp.patchAmount(f.key, e.target.value)}
                    supporting={suspect.has(f.key) ? 'À relire : voir l\'avertissement ci-dessous.' : f.supporting}
                    error={badFields[f.key] ? 'Montant non reconnu (exemple : 1 234,56) : la valeur précédente est gardée.' : undefined}
                  />
                );
              })}
            </div>
            {warnings.length > 0 && (
              <div role="status" className="rounded-xl bg-tertiary-container text-on-tertiary-container p-3 text-sm flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                <div className="min-w-0 space-y-1">
                  <p className="font-medium">Ces montants ne se recoupent pas : relisez-les sur la fiche.</p>
                  {warnings.map(w => <p key={w.id}>{w.message}</p>)}
                  <p className="text-xs">Vous pouvez enregistrer quand même.</p>
                </div>
              </div>
            )}
            {samePeriod.length > 0 && (
              <p role="status" className="text-sm text-on-surface-variant flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-tertiary" aria-hidden="true" />
                <span>
                  {samePeriod.length > 1 ? `${samePeriod.length} fiches existent déjà` : 'Une fiche existe déjà'} pour {periodLabel}.
                  {' '}Fiche rectificative ou déjà importée : remplacez. Deuxième employeur ou rappel de salaire : ajoutez, les montants seront additionnés dans la déclaration et le revenu estimé pour le LEP.
                </span>
              </p>
            )}
            <div className="flex flex-wrap justify-end gap-2 pt-2">
              <Button variant="text" onClick={imp.closeDraft} className="max-sm:h-12">Annuler</Button>
              {samePeriod.length > 0 ? (
                <>
                  <Button variant="tonal" onClick={() => imp.saveDraft('add')} className="max-sm:h-12">Ajouter (deux fiches ce mois-ci)</Button>
                  <Button onClick={() => imp.saveDraft('replace')} className="max-sm:h-12">
                    <Check className="w-4 h-4" aria-hidden="true" /> Remplacer {samePeriod.length > 1 ? `les ${samePeriod.length} fiches` : 'la fiche'} {deMonth(periodLabel)}
                  </Button>
                </>
              ) : (
                <Button onClick={() => imp.saveDraft('new')} className="max-sm:h-12"><Check className="w-4 h-4" aria-hidden="true" /> Enregistrer la fiche</Button>
              )}
            </div>
          </>
        )}
      </div>
    </Card>
  );
};
