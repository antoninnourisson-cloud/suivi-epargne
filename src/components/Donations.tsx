// ================================================
// FILE: src/components/Donations.tsx
// Dons aux associations, notés au fil de l'année pour la déclaration de revenus : total
// par taux (66 % / 75 %), réduction d'impôt estimée, reçus fiscaux (joignables depuis le
// Drive). Rappel en avril côté serveur (voir worker/src/reminders.ts).
// ================================================
import React, { useMemo, useRef, useState } from 'react';
import { Donation } from '../types';
import { HandHeart, Plus, Trash2, AlertCircle, Pencil, FileDown, Paperclip, CheckCircle2, Info, ExternalLink, X, ClipboardCheck } from 'lucide-react';
import { parseFrenchNumber } from '../lib/numbers';
import { localTodayISO, parseISODate } from '../lib/dates';
import { computeDonationSummary, DONATION_75_CEILING_BEFORE_RAISE, DONATION_75_RAISE_DATE } from '../lib/finance';
import { openDrivePicker } from '../services/googleDriveService';
import { formatEUR, toInputAmount } from '../lib/format';
import { csvAmount } from '../lib/csv';
import { downloadCsv } from '../services/fileDownload';
import { useUndoableRemove } from './Toast';
import { revealElementById } from './revealElement';
import { Button, Card, EmptyState, IconButton, MoneyText, PageHeader, StatTile, TextField } from './ui';
import { focusAfterRemoval } from './focusAfterRemoval';

interface DonationsProps {
  // Aide à la déclaration (composée par App).
  taxHelper?: React.ReactNode;
  /** Impôt estimé par année de revenus (cette année et l'an passé) : plafonne la réduction. */
  taxEstimates?: Readonly<Record<number, { taxDue: number; taxableIncome: number }>>;
  ceiling75?: number;
  donations: Donation[];
  onUpdate: React.Dispatch<React.SetStateAction<Donation[]>>;
  pickerApiKey?: string;
}

const fmt = (n: number) => formatEUR(n);
const driveUrl = (id: string) => `https://drive.google.com/file/d/${encodeURIComponent(id)}/view`;
const ORG_FIELD_ID = 'donation-org';
const focusOrgField = () => document.getElementById(ORG_FIELD_ID)?.focus();

const checkboxRow = 'flex items-start gap-3 min-h-12 py-2 text-sm text-on-surface cursor-pointer';

type Draft = { date: string; amount: string; organization: string; rate: 66 | 75; receiptReceived: boolean; receiptFileId?: string; receiptFileName?: string; note: string };
const emptyDraft = (): Draft => ({ date: localTodayISO(), amount: '', organization: '', rate: 66, receiptReceived: false, note: '' });

export const Donations: React.FC<DonationsProps> = ({ donations, onUpdate, pickerApiKey, taxEstimates, ceiling75, taxHelper }) => {
  const thisYear = new Date().getFullYear();
  // Jusqu'en juin, c'est l'année écoulée qu'on déclare : on l'affiche par défaut.
  const [year, setYear] = useState(() => new Date().getMonth() < 6 && donations.some(d => d.date.startsWith(`${thisYear - 1}-`)) ? thisYear - 1 : thisYear);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pickerBusy, setPickerBusy] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);

  const years = useMemo(() => {
    const set = new Set<number>([thisYear, ...donations.map(d => Number(d.date.slice(0, 4)))]);
    return [...set].filter(y => y > 2000).sort((a, b) => b - a);
  }, [donations, thisYear]);
  // Estimation de l'année affichée ; plus ancienne : celle de l'année en cours, à défaut de mieux.
  const taxEstimate = taxEstimates?.[year] ?? taxEstimates?.[thisYear];
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
    setDraft({ date: d.date, amount: toInputAmount(d.amount), organization: d.organization, rate: d.rate, receiptReceived: d.receiptReceived, receiptFileId: d.receiptFileId, receiptFileName: d.receiptFileName, note: d.note || '' });
    setError(null);
    // Le formulaire est en bas de l'écran : on y emmène le focus (et la vue).
    setTimeout(focusOrgField, 0);
  };
  const cancelEdit = () => { setEditingId(null); setDraft(emptyDraft()); setError(null); };
  const removeWithUndo = useUndoableRemove();
  const remove = (id: string) => {
    const don = donations.find(d => d.id === id);
    if (!don) return;
    removeWithUndo(donations, don, onUpdate, `Don à ${don.organization} supprimé`);
    if (editingId === id) cancelEdit();
    // Focus sur le don voisin, ou sur le formulaire si la liste de l'année est vide.
    focusAfterRemoval(() => listRef.current, rows.findIndex(d => d.id === id), () => document.getElementById(ORG_FIELD_ID));
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

  // Format d'Excel en français (voir lib/csv).
  const exportCsv = () => downloadCsv(`dons-${year}.csv`, [
    ['Date', 'Association', 'Montant (€)', 'Réduction (%)', 'Reçu fiscal', 'Fichier du reçu', 'Note'],
    ...rows.map(d => [d.date, d.organization, csvAmount(d.amount), d.rate, !!d.receiptReceived, d.receiptFileName, d.note]),
  ]);

  return (
    <div className="space-y-6 animate-fade-in pb-20">
      <PageHeader
        title="Dons et impôts"
        subtitle="Notez vos dons au fil de l'année : au printemps, tout est prêt pour la déclaration. Rappel début avril."
        actions={
          <TextField label="Année" className="w-32" render={p => (
            <select id={p.id} value={year} onChange={e => setYear(Number(e.target.value))} className={p.className}>
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          )} />
        }
      />

      <Card title={`Dons ${year} et réduction d'impôt`} icon={HandHeart}>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-5">
          <StatTile label={`Total ${year}`} value={<MoneyText value={summary.total} />} />
          <StatTile
            label="Réduction estimée"
            value={<MoneyText value={summary.reduction} className="text-primary" />}
            hint={summary.cappedByTax ? `Limitée à votre impôt estimé : ${fmt(summary.reductionUncapped)} en théorie, l'excédent n'est pas remboursé.` : undefined}
          />
          <StatTile label="À déclarer à 75 %" value={<MoneyText value={summary.total75} />}
            hint={summary.boxes75.length > 1 ? summary.boxes75.map(b => `case ${b.box} : ${fmt(b.amount)}`).join(' · ') : `case ${summary.boxes75[0]?.box ?? '7UD'}`} />
          <StatTile label="À déclarer à 66 %" value={<MoneyText value={summary.total66} />} hint="case 7UF" />
        </div>
        {summary.missingReceipts.length > 0 && (
          <p className="mt-5 text-sm text-on-tertiary-container bg-tertiary-container rounded-xl p-3 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
            <span>Reçu fiscal manquant : {summary.missingReceipts.map(d => d.organization).join(', ')}. Il n'est pas à envoyer, mais à garder en cas de contrôle.</span>
          </p>
        )}
        <p className="mt-4 text-xs text-on-surface-variant flex items-start gap-1.5">
          <Info className="w-3.5 h-3.5 shrink-0 mt-px" aria-hidden="true" />
          <span>Estimation : 75 % jusqu'à {year === Number(DONATION_75_RAISE_DATE.slice(0, 4))
            ? `${fmt(DONATION_75_CEILING_BEFORE_RAISE)} pour les dons faits jusqu'au 13 octobre ${year} et ${fmt(summary.ceiling75)} au total sur l'année`
            : fmt(summary.ceiling75)} de dons aux organismes d'aide aux personnes en difficulté (l'excédent passe à 66 %), 66 % pour les autres, dans la limite de 20 % du revenu imposable. Les cases et plafonds peuvent changer chaque année : vérifiez sur impots.gouv.</span>
        </p>
        {(rows.length > 0 || taxHelper) && (
          <div className="mt-4 flex flex-wrap gap-2">
            {rows.length > 0 && <Button variant="tonal" onClick={exportCsv} className="max-sm:h-12"><FileDown className="w-4 h-4" aria-hidden="true" /> Exporter {year} (CSV)</Button>}
            {taxHelper && (
              <Button variant="text" onClick={() => revealElementById('tax-return', { delayMs: 0 })} className="max-sm:h-12">
                <ClipboardCheck className="w-4 h-4" aria-hidden="true" /> Voir l'aide à la déclaration
              </Button>
            )}
          </div>
        )}
      </Card>

      {rows.length > 0 ? (
        <Card title="Détail des dons" padding="none">
          <ul ref={listRef} className="divide-y divide-outline-variant border-t border-outline-variant">
            {rows.map(d => (
              <li key={d.id} className="flex items-center gap-1 pl-5 sm:pl-6 pr-2 py-2">
                <div className="flex-1 min-w-0 py-1">
                  <p className="text-sm font-medium text-on-surface truncate">
                    {d.organization} · <MoneyText value={d.amount} /> <span className="ml-1 text-xs font-normal text-on-surface-variant">{d.rate} %</span>
                  </p>
                  <div className="text-xs text-on-surface-variant flex flex-wrap items-center gap-x-3">
                    <span>{parseISODate(d.date).toLocaleDateString('fr-FR')}</span>
                    {d.receiptFileId
                      ? (
                        <a href={driveUrl(d.receiptFileId)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 min-h-12 sm:min-h-8 font-medium text-primary underline underline-offset-2 hover:no-underline">
                          <Paperclip className="w-3.5 h-3.5" aria-hidden="true" /> {d.receiptFileName || 'reçu'} <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" /><span className="sr-only"> (nouvel onglet)</span>
                        </a>
                      ) : (
                        <button type="button" onClick={() => toggleReceipt(d.id)} className={`inline-flex items-center gap-1 min-h-12 sm:min-h-8 font-medium hover:underline ${d.receiptReceived ? 'text-primary' : 'text-tertiary'}`}>
                          {d.receiptReceived
                            ? <><CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" /> reçu fiscal reçu</>
                            : <><AlertCircle className="w-3.5 h-3.5" aria-hidden="true" /> reçu à recevoir</>}
                        </button>
                      )}
                    {d.note && <span className="truncate">{d.note}</span>}
                  </div>
                </div>
                <IconButton label={`Modifier le don à ${d.organization}`} icon={Pencil} onClick={() => edit(d)} data-focus-after-removal />
                <IconButton label={`Supprimer le don à ${d.organization}`} icon={Trash2} tone="danger" onClick={() => remove(d.id)} />
              </li>
            ))}
          </ul>
        </Card>
      ) : (
        <Card variant="filled" padding="none">
          <EmptyState
            icon={HandHeart}
            title={`Aucun don noté pour ${year}`}
            action={<Button variant="tonal" onClick={focusOrgField}><Plus className="w-4 h-4" aria-hidden="true" /> Noter un don</Button>}
          >
            Notez-le ci-dessous dès qu'il est fait : la réduction d'impôt et les cases de la déclaration se calculent toutes seules.
          </EmptyState>
        </Card>
      )}

      <Card
        title={editingId ? 'Modifier le don' : 'Nouveau don'}
        icon={editingId ? Pencil : Plus}
        action={editingId ? <Button variant="text" onClick={cancelEdit}><X className="w-4 h-4" aria-hidden="true" /> Annuler</Button> : undefined}
      >
        <form onSubmit={submit} noValidate className="space-y-4">
          <TextField
            id={ORG_FIELD_ID}
            label="Association"
            list="donation-orgs"
            autoComplete="off"
            value={draft.organization}
            onChange={e => set({ organization: e.target.value })}
            placeholder="ex. Restos du cœur"
          />
          <datalist id="donation-orgs">{knownOrgs.map(o => <option key={o} value={o} />)}</datalist>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <TextField label="Montant" suffix="€" inputMode="decimal" value={draft.amount} onChange={e => set({ amount: e.target.value })} placeholder="ex. 50" />
            <TextField label="Date du don" type="date" value={draft.date} onChange={e => set({ date: e.target.value })} />
          </div>
          <label className={checkboxRow}>
            <input type="checkbox" className="mt-0.5 w-5 h-5 shrink-0 accent-primary" checked={draft.rate === 75} onChange={e => set({ rate: e.target.checked ? 75 : 66 })} />
            <span><span className="font-medium">Aide aux personnes en difficulté</span> (repas, soins, logement : Restos du cœur, Secours populaire…) : réduction de 75 % au lieu de 66 %.</span>
          </label>
          <div className="flex flex-wrap items-center gap-x-4">
            <label className="flex items-center gap-3 min-h-12 text-sm text-on-surface cursor-pointer">
              <input type="checkbox" className="w-5 h-5 shrink-0 accent-primary" checked={draft.receiptReceived || !!draft.receiptFileId} disabled={!!draft.receiptFileId} onChange={e => set({ receiptReceived: e.target.checked })} />
              Reçu fiscal reçu
            </label>
            {draft.receiptFileId ? (
              <span className="text-sm font-medium text-primary inline-flex items-center gap-1">
                <Paperclip className="w-4 h-4" aria-hidden="true" /> {draft.receiptFileName || 'reçu'}
                <IconButton label="Retirer le reçu" icon={X} tone="danger" onClick={() => set({ receiptFileId: undefined, receiptFileName: undefined })} />
              </span>
            ) : (
              <Button type="button" variant="text" onClick={attachReceipt} disabled={pickerBusy} className="-ml-3 max-sm:h-12">
                <Paperclip className="w-4 h-4" aria-hidden="true" /> Joindre le reçu depuis Drive
              </Button>
            )}
          </div>
          <TextField label="Note (facultative)" value={draft.note} onChange={e => set({ note: e.target.value })} />
          {error && (
            <p role="alert" className="text-sm font-medium text-error flex items-center gap-2"><AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" /> {error}</p>
          )}
          <Button type="submit" className="w-full max-sm:h-12">
            <Plus className="w-4 h-4" aria-hidden="true" /> {editingId ? 'Enregistrer' : 'Ajouter le don'}
          </Button>
        </form>
      </Card>
      {taxHelper}
    </div>
  );
};
