// ================================================
// FILE: src/components/Payslips.tsx
// Import de fiches de paie depuis le Drive de l'utilisateur (Google Picker — le fichier
// original n'est jamais copié, on ne stocke que sa référence) et extraction des montants
// via l'API Gemini, à la demande explicite (chaque clic consomme le quota de l'utilisateur).
// Une fiche choisie sur l'appareil (« Choisir sur l'appareil ») ou reçue par « Partager vers
// Pécule » est lue depuis l'appareil : elle n'est pas copiée sur Drive, la fiche enregistrée
// garde seulement son nom (sans lien Drive).
// ================================================
import React, { useEffect, useMemo, useRef } from 'react';
import { PayslipRecord } from '../types';
import { FileText, Trash2, ExternalLink, AlertTriangle, KeyRound, TrendingUp, Wand2 } from 'lucide-react';
import { elideDe, formatEUR, formatPeriod } from '../lib/format';
import { useIsDark, chartTheme } from '../lib/chartTheme';
import { describeEvolution } from '../lib/chartData';
import { AreaSeriesChart, type AreaRow } from './charts/AreaSeriesChart';
import { ChartFrame } from './charts/ChartFrame';
import { Button, Card, DataTable, EmptyState, IconButton, ListItem, MoneyText, PageHeader, type Column } from './ui';
import { detectPayslipAnomalies } from '../lib/motivation';
import { describeAnomaly } from './motivation/text';
import { usePayslipImport, withSavedPayslip } from './payslips/usePayslipImport';
import { PayslipDraftCard, PayslipPickButtons } from './payslips/PayslipImportParts';
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
  /** Fiche reçue par « Partager vers Pécule » : ouverte comme un import, puis rendue (`onSharedFileTaken`). */
  sharedFile?: File | null;
  onSharedFileTaken?: () => void;
  /**
   * Fiche enregistrée depuis cet écran : rattachée à la paie déclarée du même mois, qui
   * propose d'ajuster le montant reçu s'il diffère (useAccountActions, attachPayslip).
   */
  onPayslipSaved?: (record: PayslipRecord) => void;
}

const fmt = (n: number | undefined) =>
  n === undefined ? '—' : formatEUR(n);

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

export const Payslips: React.FC<PayslipsProps> = ({ payslips, onUpdatePayslips, geminiApiKey, pickerApiKey, onApplyToPilotage, activePayslipId, onClearActivePayslip, onOpenKeys, sharedFile, onSharedFileTaken, onPayslipSaved }) => {
  const t = chartTheme(useIsDark());
  const listRef = useRef<HTMLUListElement>(null);
  const importRef = useRef<HTMLButtonElement>(null);
  const deviceRef = useRef<HTMLButtonElement>(null);
  const removeWithUndo = useUndoableRemove();

  // Import d'une fiche (partagé avec le rituel « J'ai reçu ma paie ») : la fiche relue
  // s'ajoute à la liste ; celle qu'elle remplace servait peut-être de référence au Pilotage,
  // qui revient alors à l'estimation.
  const imp = usePayslipImport({
    payslips, geminiApiKey, pickerApiKey,
    onSave: (record, replaced) => {
      onUpdatePayslips(prev => withSavedPayslip(prev, record, replaced));
      if (activePayslipId && replaced.has(activePayslipId)) onClearActivePayslip();
      onPayslipSaved?.(record);
    },
  });
  const { draft, openFile } = imp;

  const keysMissing = !geminiApiKey || !pickerApiKey;

  // Fiche partagée vers Pécule : elle devient l'import en cours (sans référence Drive).
  useEffect(() => {
    if (!sharedFile) return;
    openFile(sharedFile);
    onSharedFileTaken?.();
    // openFile change à chaque rendu : seule l'arrivée d'un fichier compte.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sharedFile, onSharedFileTaken]);

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

  const sorted = useMemo(
    () => [...payslips].sort((a, b) => (b.extracted.period || '').localeCompare(a.extracted.period || '')),
    [payslips]
  );
  // Retrait annulable (le fichier reste sur le Drive, s'il y était) ; le focus va sur la fiche
  // voisine, sinon sur « Importer depuis Drive » (s'il est actif), sinon sur « Choisir sur
  // l'appareil », sinon (bouton absent) sur le titre.
  const removePayslip = (p: PayslipRecord) => {
    removeWithUndo(payslips, p, onUpdatePayslips, `Fiche ${elideDe(periodName(p))} retirée de la liste${p.fileId ? ' (le fichier reste sur votre Drive)' : ''}`);
    focusAfterRemoval(() => listRef.current, sorted.findIndex(x => x.id === p.id), () => (importRef.current?.disabled ? deviceRef.current : importRef.current));
  };
  return (
    <div className="space-y-6 animate-fade-in pb-20">
      <PageHeader
        title="Fiches de paie"
        subtitle="Importez une fiche depuis cet appareil ou depuis votre Drive : l'IA en lit les montants, vous les vérifiez avant d'enregistrer."
        actions={!draft && <PayslipPickButtons imp={imp} keysNoteId={KEYS_NOTE_ID} deviceRef={deviceRef} importRef={importRef} />}
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
      <PayslipDraftCard imp={imp} keysNoteId={KEYS_NOTE_ID} />

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
            Importez une fiche avec « Choisir sur l'appareil » ou « Importer depuis Drive ». Une fois vérifiée, le Pilotage peut s'en servir à la place de son estimation.
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
                        <Wand2 className="w-4 h-4" aria-hidden="true" /> Utiliser pour le Pilotage{' '}<span className="sr-only">(fiche {elideDe(name)})</span>
                      </Button>
                    )}
                    {/* Fiche reçue par partage : pas de fichier sur Drive, donc pas de lien. */}
                    {p.fileId && (
                      <a
                        href={driveUrl(p.fileId)}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`Ouvrir la fiche ${elideDe(name)} sur Drive (nouvel onglet)`}
                        title="Ouvrir sur Drive"
                        className={iconLink}
                        data-focus-after-removal
                      >
                        <ExternalLink className="w-5 h-5" aria-hidden="true" />
                      </a>
                    )}
                    <IconButton icon={Trash2} tone="danger" label={`Retirer la fiche ${elideDe(name)} de la liste`} onClick={() => removePayslip(p)}
                      data-focus-after-removal={p.fileId ? undefined : true} />
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
