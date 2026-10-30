// ================================================
// FILE: src/components/pilot/PayReceivedSheet.tsx
// Le rituel « J'ai reçu ma paie » : une feuille en trois temps, chargée à la demande.
//  0. Bilan du mois d'épargne précédent (la carte « Point de paie »), s'il n'est pas validé :
//     « Continuer » le valide.
//  1. Votre paie : montant reçu (net payé de la fiche du mois si elle est importée, sinon la
//     paie estimée), date, prime éventuelle, mois d'épargne (règle du 15, « Changer »), et
//     l'import de la fiche de paie sur place (mêmes composants et mêmes contrôles que l'écran
//     Fiches de paie : la fiche y apparaît ensuite).
//  2. Répartition conseillée pour CE montant (lib/payDistribution) : chaque ligne se coche,
//     son montant et son compte se corrigent, « + Autre compte » ; « Tout est fait comme
//     conseillé » ou « Enregistrer » (seulement les cases cochées) passent par UNE commande
//     (recordPay), avec un seul « Annuler ».
// « Modifier la paie » rouvre la même feuille sur la paie déclarée (étapes 1 et 2) : les
// lignes déjà faites restent faites, le plan reste figé s'il l'est.
// ================================================
import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRightLeft, CalendarDays, CheckCheck, FileText, Info, KeyRound, PenLine, PiggyBank, Plus, Trash2, Wallet, X } from 'lucide-react';
import { AccountType, type GlobalAppData, type PayChecklistLine, type PayslipRecord } from '../../types';
import type { RecordPayInput } from '../../lib/commands';
import { computeMonthlyPay, computeMonthlySavingsCapacity } from '../../lib/finance';
import { recommendPayDistribution, payGapSentence } from '../../lib/payDistribution';
import { savingsMonthOf, shiftMonth } from '../../lib/payCalendar';
import { isPayReviewDone, liveDone, payslipForMonth, payslipPeriodOf, suggestedPayKind } from '../../lib/payRecords';
import { computeGoodMonths, computePayReview, motivationSettings } from '../../lib/motivation';
import { localTodayISO, parseISODate } from '../../lib/dates';
import { parseFrenchNumber } from '../../lib/numbers';
import { elideDe, formatEUR, formatMonth, frenchDay, toInputAmount } from '../../lib/format';
import { placementReason } from '../../lib/pilotView';
import { Modal } from '../Modal';
import { Button, IconButton, MoneyText, TextField, fieldClass } from '../ui';
import { PayReviewCard } from '../motivation/PayReviewCard';
import { usePayslipImport } from '../payslips/usePayslipImport';
import { PayslipDraftCard, PayslipPickButtons } from '../payslips/PayslipImportParts';

/** Ce que le rituel lit et écrit (passé par le Pilotage, depuis ScreenRouter). */
export interface PayRitualProps {
  /** Données complètes : répartition pour le montant reçu, fiches, paies, bilan. */
  doc: GlobalAppData;
  geminiApiKey: string;
  pickerApiKey: string;
  /** Commande recordPay (useAccountActions) : le refus est renvoyé, sinon `null`. */
  onRecordPay: (input: RecordPayInput) => string | null;
  /** « Supprimer cette paie » (fenêtre de confirmation, versements gardés ou non). */
  onDeletePay: (payId: string) => void;
  /** Bilan du mois d'épargne `key` validé (étape 0). */
  onValidateReview: (key: string) => void;
  /** Fiche de paie relue dans le rituel : enregistrée dans la liste des fiches. */
  onSavePayslip: (record: PayslipRecord, replacedIds: ReadonlySet<string>) => void;
  /** Clé manquante : Paramètres, rubrique « Clés et services ». */
  onOpenKeys?: () => void;
}

interface SheetProps extends PayRitualProps {
  onClose: () => void;
  /** Paie à modifier (« Modifier la paie ») ; absent : nouvelle paie. */
  editPayId?: string;
}

type Step = 0 | 1 | 2;
interface RowState { checked: boolean; amount: string; accountId?: string; already: boolean }
interface AddedRow { id: string; accountId: string; amount: string; checked: boolean }

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const parseAmount = (text: string): number | null => {
  const v = parseFrenchNumber(text);
  return v !== null && v >= 0 ? v : null;
};
/** « 27 octobre » (avec l'année si ce n'est pas celle d'aujourd'hui). */
const dayLabel = (iso: string, today: string) => {
  const d = parseISODate(iso);
  return `${frenchDay(d)}${iso.slice(0, 4) !== today.slice(0, 4) ? ` ${iso.slice(0, 4)}` : ''}`;
};
/** Mois d'épargne en toutes lettres (avec l'année si ce n'est pas celle d'aujourd'hui). */
const monthLabel = (key: string, today: string) => formatMonth(key, key.slice(0, 4) !== today.slice(0, 4));

export const PayReceivedSheet: React.FC<SheetProps> = ({ doc, geminiApiKey, pickerApiKey, onRecordPay, onDeletePay, onValidateReview, onSavePayslip, onOpenKeys, onClose, editPayId }) => {
  const today = localTodayISO();
  const pays = useMemo(() => doc.pays ?? [], [doc.pays]);
  const existing = editPayId ? pays.find(p => p.id === editPayId) : undefined;
  const ids = useId();

  // --- Étape 0 : bilan du mois précédent, s'il reste à valider (même calcul que l'Accueil) ---
  const review = useMemo(() => {
    if (existing) return undefined;
    const c = doc.config;
    const motivation = motivationSettings(c);
    if (!motivation.enabled) return undefined;
    const goodMonths = computeGoodMonths({ accounts: doc.accounts, today, paydayDay: c.paydayDay, payslips: doc.payslips, pays, threshold: motivation.threshold, trackingStartISO: c.trackingStartDate });
    const plan = c.paydayAmount ?? computeMonthlySavingsCapacity(doc);
    const r = computePayReview({ accounts: doc.accounts, goodMonths, today, plan, trackingStartISO: c.trackingStartDate, pays });
    return r && !isPayReviewDone(r.key, c.payReviewsDone, pays) ? r : undefined;
    // Calculé à l'ouverture : valider le bilan ne doit pas faire disparaître l'étape en cours.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [step, setStep] = useState<Step>(review ? 0 : 1);

  // --- Étape 1 : la paie ---
  const expected = useMemo(() => {
    const v = computeMonthlyPay(doc);
    return Number.isFinite(v) ? Math.max(0, v) : 0;
  }, [doc]);
  const [receivedOn, setReceivedOn] = useState(existing?.receivedOn ?? today);
  const [monthChoice, setMonthChoice] = useState<string | undefined>(existing && existing.savingsMonth !== savingsMonthOf(existing.receivedOn) ? existing.savingsMonth : undefined);
  const [changingMonth, setChangingMonth] = useState(false);
  const dateOk = ISO_DAY.test(receivedOn) && !Number.isNaN(parseISODate(receivedOn).getTime());
  const month = monthChoice ?? (dateOk ? savingsMonthOf(receivedOn) : savingsMonthOf(today));
  // Deuxième paie sur un mois qui en a déjà une : proposée comme versement en plus.
  const suggestion = existing ? existing.kind : suggestedPayKind(pays, month);
  const [kindChoice, setKindChoice] = useState<'extra' | 'regular' | undefined>(undefined);
  const kind: 'extra' | undefined = existing ? existing.kind : (kindChoice ?? (suggestion === 'extra' ? 'extra' : 'regular')) === 'extra' ? 'extra' : undefined;
  // Fiche relue dans le rituel : gardée ici aussi (la liste des fiches suit au rendu suivant).
  const [savedSlip, setSavedSlip] = useState<PayslipRecord | undefined>(undefined);
  const payslip = kind === 'extra' ? undefined : savedSlip ?? payslipForMonth(doc.payslips, month, existing?.payslipId);
  const slipPeriod = payslipPeriodOf(month);
  const initialAmount = existing?.amount ?? payslipForMonth(doc.payslips, savingsMonthOf(today))?.extracted.netPaid ?? expected;
  const [amountText, setAmountText] = useState(toInputAmount(Math.round(initialAmount * 100) / 100));
  const [bonusOpen, setBonusOpen] = useState(!!existing?.bonus);
  const [bonusText, setBonusText] = useState(existing?.bonus ? toInputAmount(existing.bonus) : '');
  const amount = parseAmount(amountText);
  const bonusRaw = bonusText.trim() === '' ? 0 : parseAmount(bonusText);
  const bonusTooHigh = amount !== null && bonusRaw !== null && bonusRaw > amount;
  const step1Ok = amount !== null && bonusRaw !== null && !bonusTooHigh && dateOk;

  // Fiche de paie sur place : relue, enregistrée dans la liste des fiches, puis son net payé
  // devient le montant reçu.
  const imp = usePayslipImport({
    payslips: doc.payslips ?? [], geminiApiKey, pickerApiKey, defaultPeriod: slipPeriod,
    onSave: (record, replaced) => {
      onSavePayslip(record, replaced);
      setSavedSlip(record);
      if (record.extracted.netPaid !== undefined) setAmountText(toInputAmount(record.extracted.netPaid));
    },
  });
  const slipNet = payslip?.extracted.netPaid;
  const slipGap = slipNet !== undefined ? Math.round((slipNet - expected) * 100) / 100 : undefined;

  // --- Étape 2 : la répartition ---
  const [toSave, setToSave] = useState<number | undefined>(existing?.toSave);
  const bonus = bonusRaw ?? 0;
  const dist = useMemo(
    () => recommendPayDistribution(doc, { amount: amount ?? 0, bonus, toSave, kind, receivedOn: dateOk ? receivedOn : today }),
    [doc, amount, bonus, toSave, kind, receivedOn, dateOk, today]);
  const doneBefore = useMemo(() => (existing ? liveDone(existing.done, doc.accounts) : {}), [existing, doc.accounts]);
  const frozen = !!existing && existing.lines.length > 0 && Object.keys(doneBefore).length > 0;
  const lines: PayChecklistLine[] = frozen ? existing!.lines : dist.lines;
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [added, setAdded] = useState<AddedRow[]>([]);
  const [transferDate, setTransferDate] = useState(today);
  const [toSaveText, setToSaveText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const savingAccounts = doc.accounts.filter(a => a.type !== AccountType.COMPTE_COURANT && a.type !== AccountType.IMMOBILIER);
  const rowOf = (l: PayChecklistLine): RowState => rows[l.key] ?? { checked: false, amount: toInputAmount(l.amount), accountId: l.accountId, already: false };
  const patchRow = (l: PayChecklistLine, patch: Partial<RowState>) => setRows(r => ({ ...r, [l.key]: { ...rowOf(l), ...patch } }));
  const suggestions = frozen ? [] : dist.steps.filter(st => st.alert && st.hint);
  const gapSentence = frozen ? undefined : payGapSentence(dist, { toSave, kind });

  // « À placer » saisi : il remplace le calcul (prime comprise, comme le total affiché).
  const commitToSave = (text: string) => {
    const v = parseAmount(text);
    if (v === null) return;
    setToSave(Math.max(0, Math.round((v - dist.bonus) * 100) / 100));
    setToSaveText(null);
    setRows({});
  };

  // Le titre de chaque étape reçoit le focus (annoncé par les lecteurs d'écran).
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    headingRef.current?.focus();
  }, [step]);

  const goToPlan = () => {
    if (!step1Ok) return;
    setRows({});
    setError(null);
    setStep(2);
  };

  const submit = (all: boolean) => {
    setError(null);
    if (!ISO_DAY.test(transferDate)) { setError('Date des virements invalide.'); return; }
    const done: RecordPayInput['done'] = [];
    for (const l of lines) {
      if (doneBefore[l.key]) continue;
      const row = rowOf(l);
      if (!all && !row.checked) continue;
      const v = parseAmount(row.amount);
      if (v === null) { setError(`Montant non reconnu pour « ${l.label} ».`); return; }
      done.push({ key: l.key, amount: v, ...(row.accountId && row.accountId !== l.accountId ? { accountId: row.accountId } : {}), ...(row.already ? { alreadyRecorded: true } : {}) });
    }
    const extraLines: PayChecklistLine[] = [];
    for (const a of added) {
      const account = savingAccounts.find(x => x.id === a.accountId);
      if (!account) continue;
      const v = parseAmount(a.amount);
      if (v === null) { setError(`Montant non reconnu pour « ${account.name} ».`); return; }
      let key = `a:${account.id}`;
      for (let n = 2; [...lines, ...extraLines].some(l => l.key === key); n++) key = `a:${account.id}-${n}`;
      extraLines.push({ key, label: account.name, amount: v, kind: 'saving', accountId: account.id, added: true });
      if (all || a.checked) done.push({ key, amount: v });
    }
    const input: RecordPayInput = {
      pay: {
        ...(existing ? { id: existing.id } : {}),
        receivedOn, savingsMonth: month, amount: amount!,
        bonus: kind === 'extra' ? undefined : bonus,
        ...(kind === 'extra' ? { kind } : {}),
        // Modifier la paie : sans montant saisi, retour au calcul.
        toSave: existing ? (toSave ?? null) : toSave,
        ...(payslip ? { payslipId: payslip.id } : {}),
      },
      lines: [...lines, ...extraLines],
      done,
      transferDate,
    };
    const refused = onRecordPay(input);
    if (refused) { setError(refused); return; }
    onClose();
  };

  const monthName = monthLabel(month, today);
  const savingLines = lines.filter(l => l.kind === 'saving');
  const transferLines = lines.filter(l => l.kind === 'transfer');
  const stepCount = review ? 3 : 2;
  const stepIndex = review ? step + 1 : step;

  const renderLine = (l: PayChecklistLine) => {
    const before = doneBefore[l.key];
    const row = rowOf(l);
    const invalid = !before && parseAmount(row.amount) === null;
    const checkId = `${ids}-c-${l.key}`;
    const statusId = `${ids}-s-${l.key}`;
    const placement = l.kind === 'saving' ? dist.steps.find(st => !st.alert && st.accountId === l.accountId) : undefined;
    const reason = placement && !frozen ? placementReason(placement, dist.customSplit) : undefined;
    return (
      <li key={l.key} className="py-2">
        <div className="flex items-start gap-3">
          <input
            id={checkId}
            type="checkbox"
            checked={!!before || row.checked}
            disabled={!!before}
            onChange={e => patchRow(l, { checked: e.target.checked })}
            aria-describedby={statusId}
            className="mt-3 w-5 h-5 shrink-0 accent-primary cursor-pointer disabled:cursor-not-allowed"
          />
          <div className="flex-1 min-w-0">
            <label htmlFor={checkId} className="block min-h-12 py-2.5 text-sm font-medium text-on-surface cursor-pointer break-words">
              {l.label}
              {reason && <span className="block text-xs font-normal text-on-surface-variant mt-0.5">{reason}</span>}
            </label>
            <p id={statusId} className={`text-xs ${before ? 'text-primary' : invalid ? 'text-error' : 'text-on-surface-variant'}`}>
              {before
                ? <>Déjà fait : <MoneyText value={before.amount} /></>
                : invalid ? 'Montant non reconnu (exemple : 1 234,56)'
                  : <>Conseillé : <MoneyText value={l.amount} /></>}
            </p>
            {!before && l.kind === 'saving' && (
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
                {savingAccounts.length > 1 && (
                  <label className="flex items-center gap-2 text-sm text-on-surface-variant">
                    sur
                    <select
                      value={row.accountId ?? ''}
                      onChange={e => patchRow(l, { accountId: e.target.value })}
                      aria-label={`Compte crédité pour ${l.label}`}
                      className="h-12 sm:h-10 px-2 rounded-xs bg-transparent border border-outline text-sm text-on-surface"
                    >
                      {savingAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  </label>
                )}
                <label className="inline-flex items-center gap-2 min-h-12 sm:min-h-8 text-xs text-on-surface-variant cursor-pointer">
                  <input type="checkbox" checked={row.already} onChange={e => patchRow(l, { already: e.target.checked })} className="w-4 h-4 accent-primary" />
                  Déjà enregistré (ne pas l'ajouter une seconde fois)
                </label>
              </div>
            )}
          </div>
          {!before && (
            <label className="flex items-center gap-1 shrink-0 pt-1">
              <span className="sr-only">Montant fait pour {l.label}</span>
              <input
                type="text"
                inputMode="decimal"
                value={row.amount}
                onChange={e => patchRow(l, { amount: e.target.value })}
                aria-invalid={invalid || undefined}
                className="w-24 h-12 sm:h-10 px-2 text-right text-sm tabular-nums font-medium rounded-xs bg-transparent border border-outline text-on-surface hover:border-on-surface focus:border-primary focus:border-2 outline-none aria-[invalid=true]:border-error aria-[invalid=true]:border-2"
              />
              <span className="text-sm text-on-surface-variant" aria-hidden="true">€</span>
            </label>
          )}
        </div>
      </li>
    );
  };

  const heading = (text: string) => (
    <div className="flex items-start justify-between gap-3 mb-4">
      <div className="min-w-0">
        <p className="text-xs font-medium text-on-surface-variant">Étape {stepIndex} sur {stepCount}</p>
        <h2 ref={headingRef} tabIndex={-1} className="text-xl font-normal text-on-surface outline-none">{text}</h2>
      </div>
      <IconButton icon={X} label="Fermer sans enregistrer" onClick={onClose} className="-mr-2 -mt-1" />
    </div>
  );

  return (
    <Modal open onClose={onClose} label={existing ? 'Modifier la paie' : "J'ai reçu ma paie"} variant="page" closeOnScrim={false} className="sm:max-w-2xl p-4 sm:p-6">
      {step === 0 && review && (
        <>
          {heading(`Bilan ${elideDe(formatMonth(review.key))}`)}
          <p className="text-sm text-on-surface-variant mb-4">Avant de répartir la nouvelle paie : ce que le mois qui s'achève a donné.</p>
          <PayReviewCard review={review} onValidate={() => { onValidateReview(review.key); setStep(1); }} validateLabel="Continuer" />
        </>
      )}

      {step === 1 && (
        <>
          {heading(existing ? 'Modifier la paie' : 'Votre paie')}
          <div className="space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <TextField
                label="Montant reçu"
                suffix="€"
                inputMode="decimal"
                className="tabular-nums"
                value={amountText}
                onChange={e => setAmountText(e.target.value)}
                error={amount === null ? 'Montant non reconnu (exemple : 2 512,40).' : undefined}
                supporting={kind === 'extra' ? 'Prime ou autre versement, placé en entier.' : <>Net arrivé sur votre compte, prime comprise. Paie estimée : <MoneyText value={expected} decimals={0} />.</>}
              />
              <TextField
                label="Reçue le"
                type="date"
                value={receivedOn}
                onChange={e => setReceivedOn(e.target.value)}
                error={!dateOk ? 'Date non reconnue.' : undefined}
              />
            </div>

            {kind !== 'extra' && (
              <div>
                <Button variant="text" size="sm" onClick={() => setBonusOpen(o => !o)} aria-expanded={bonusOpen} aria-controls={`${ids}-bonus`} className="-ml-3">
                  {bonusOpen ? 'Masquer la prime' : 'Dont prime ou exceptionnel'}
                </Button>
                <div id={`${ids}-bonus`} hidden={!bonusOpen} className="mt-2 max-w-xs">
                  <TextField
                    label="Dont prime ou exceptionnel"
                    suffix="€"
                    inputMode="decimal"
                    className="tabular-nums"
                    value={bonusText}
                    onChange={e => setBonusText(e.target.value)}
                    error={bonusRaw === null ? 'Montant non reconnu.' : bonusTooHigh ? 'La prime ne peut pas dépasser le montant reçu.' : undefined}
                    supporting="Placée en entier, en plus de l'épargne habituelle."
                  />
                </div>
              </div>
            )}

            <div className="rounded-2xl bg-surface-container p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-on-surface">
                  <CalendarDays className="inline w-4 h-4 mr-1.5 -mt-0.5 text-on-surface-variant" aria-hidden="true" />
                  Épargne {elideDe(monthName)}
                </p>
                <Button variant="text" size="sm" onClick={() => setChangingMonth(c => !c)} aria-expanded={changingMonth} aria-controls={`${ids}-month`}>Changer</Button>
              </div>
              <p className="mt-1 text-xs text-on-surface-variant">
                {monthChoice ? 'Choisi par vous pour cette paie.' : 'Une paie reçue à partir du 15 finance l\'épargne du mois suivant, avant le 15 celle du mois même.'}
              </p>
              <div id={`${ids}-month`} hidden={!changingMonth} className="mt-3 max-w-xs">
                <label htmlFor={`${ids}-month-select`} className="block text-sm font-medium text-on-surface-variant mb-1.5">Mois d'épargne</label>
                <select
                  id={`${ids}-month-select`}
                  value={month}
                  onChange={e => setMonthChoice(e.target.value === savingsMonthOf(receivedOn) ? undefined : e.target.value)}
                  className={fieldClass}
                >
                  {[-1, 0, 1].map(d => shiftMonth(dateOk ? savingsMonthOf(receivedOn) : month, d)).map(k => (
                    <option key={k} value={k}>{monthLabel(k, today).replace(/^./, c => c.toUpperCase())}</option>
                  ))}
                </select>
              </div>
            </div>

            {!existing && suggestion === 'extra' && (
              <fieldset className="rounded-2xl border border-outline-variant p-4">
                <legend className="px-1 text-sm font-medium text-on-surface">Une paie est déjà déclarée pour l'épargne {elideDe(monthName)}</legend>
                {([['extra', 'Versement en plus (prime, deuxième employeur) : tout est placé'], ['regular', 'Paie régulière (elle remplace la précédente comme début du mois)']] as const).map(([v, label]) => (
                  <label key={v} className="flex items-start gap-3 min-h-12 py-2 text-sm text-on-surface cursor-pointer">
                    <input type="radio" name={`${ids}-kind`} value={v} checked={(kindChoice ?? 'extra') === v} onChange={() => setKindChoice(v)} className="mt-0.5 w-5 h-5 accent-primary" />
                    {label}
                  </label>
                ))}
              </fieldset>
            )}

            {kind !== 'extra' && (
              <section aria-labelledby={`${ids}-slip`} className="rounded-2xl border border-outline-variant p-4">
                <h3 id={`${ids}-slip`} className="text-sm font-medium text-on-surface flex items-center gap-2">
                  <FileText className="w-4 h-4 text-on-surface-variant" aria-hidden="true" /> Fiche de paie {elideDe(formatMonth(slipPeriod))}
                </h3>
                {payslip ? (
                  <p role="status" className="mt-2 text-sm text-on-surface-variant">
                    {slipNet !== undefined
                      ? <>Net payé : <MoneyText value={slipNet} className="text-on-surface font-medium" />{slipGap !== undefined && Math.abs(slipGap) >= 0.5 && <>, <MoneyText value={Math.abs(slipGap)} decimals={0} /> de {slipGap > 0 ? 'plus' : 'moins'} que prévu</>}.</>
                      : 'Fiche enregistrée, sans net payé.'}
                    {slipNet !== undefined && amount !== null && Math.abs(slipNet - amount) >= 0.005 && (
                      <Button variant="text" size="sm" onClick={() => setAmountText(toInputAmount(slipNet))} className="ml-1">Reprendre ce montant</Button>
                    )}
                  </p>
                ) : imp.draft ? (
                  <div className="mt-3"><PayslipDraftCard imp={imp} keysNoteId={`${ids}-keys`} variant="outlined" /></div>
                ) : (
                  <>
                    <p className="mt-1 text-sm text-on-surface-variant">Facultatif : importez-la pour partir du net payé exact. Elle rejoint vos fiches de paie.</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <PayslipPickButtons imp={imp} keysNoteId={`${ids}-keys`} />
                      <Button variant="text" onClick={imp.startManual} className="max-sm:h-12"><PenLine className="w-4 h-4" aria-hidden="true" /> Saisir à la main</Button>
                    </div>
                    {(!geminiApiKey || !pickerApiKey) && (
                      <p id={`${ids}-keys`} className="mt-2 text-xs text-on-surface-variant flex items-start gap-1.5">
                        <KeyRound className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
                        <span>
                          {!pickerApiKey ? 'Sans clé Google Picker, choisissez la fiche sur l\'appareil. ' : ''}
                          {!geminiApiKey ? 'Sans clé Gemini, saisissez ses montants à la main, ou passez cette étape. ' : ''}
                          {onOpenKeys && <button type="button" onClick={onOpenKeys} className="underline text-primary">Clés et services</button>}
                        </span>
                      </p>
                    )}
                  </>
                )}
              </section>
            )}
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-end gap-2">
            {existing && (
              <Button variant="text" onClick={() => { onClose(); onDeletePay(existing.id); }} className="mr-auto -ml-3 text-error! max-sm:h-12">
                <Trash2 className="w-4 h-4" aria-hidden="true" /> Supprimer cette paie
              </Button>
            )}
            <Button variant="text" onClick={onClose} className="max-sm:h-12">Annuler</Button>
            <Button onClick={goToPlan} disabled={!step1Ok || !!imp.draft} className="max-sm:h-12">Voir la répartition</Button>
          </div>
        </>
      )}

      {step === 2 && (
        <>
          {heading('Répartition conseillée')}
          <div className="rounded-2xl bg-secondary-container text-on-secondary-container p-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm">Paie reçue le {dayLabel(receivedOn, today)} : <MoneyText value={amount ?? 0} /> · Épargne {elideDe(monthName)}</p>
                {frozen ? (
                  <p className="mt-2 text-sm">Plan figé : une partie est déjà faite. Les lignes restantes se cochent ci-dessous.</p>
                ) : (
                  <div className="mt-2 max-w-48">
                    <TextField
                      label="À placer"
                      suffix="€"
                      inputMode="decimal"
                      className="tabular-nums"
                      value={toSaveText ?? toInputAmount(dist.toSave)}
                      onChange={e => setToSaveText(e.target.value)}
                      onBlur={e => commitToSave(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') commitToSave((e.target as HTMLInputElement).value); }}
                    />
                  </div>
                )}
              </div>
              {!frozen && toSave !== undefined && (
                <Button variant="text" size="sm" onClick={() => { setToSave(undefined); setToSaveText(null); setRows({}); }}>Revenir au conseil</Button>
              )}
            </div>
            {gapSentence && <p className="mt-3 text-sm">{gapSentence}</p>}
            {!frozen && dist.bonus > 0 && <p className="mt-1 text-sm">Dont prime placée en entier : <MoneyText value={dist.bonus} />.</p>}
          </div>

          {savingLines.length > 0 && (
            <>
              <h3 className="mt-6 flex items-center gap-2 border-b border-outline-variant pb-2 text-sm font-medium text-on-surface"><PiggyBank className="w-4 h-4 text-on-surface-variant" aria-hidden="true" /> Sur vos comptes d'épargne</h3>
              <ul className="divide-y divide-outline-variant">{savingLines.map(renderLine)}</ul>
            </>
          )}
          {suggestions.map(st => (
            <p key={st.accountName} className="mt-2 text-sm text-on-tertiary-container bg-tertiary-container rounded-xl p-3 flex items-start gap-2">
              <Info className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />{st.hint}
            </p>
          ))}
          {savingLines.length === 0 && suggestions.length === 0 && <p className="mt-4 text-sm text-on-surface-variant">Rien à placer sur cette paie.</p>}

          {added.length > 0 && (
            <ul aria-label="Autres comptes" className="divide-y divide-outline-variant">
              {added.map(a => {
                const invalid = parseAmount(a.amount) === null;
                const patch = (p: Partial<AddedRow>) => setAdded(list => list.map(x => (x.id === a.id ? { ...x, ...p } : x)));
                return (
                  <li key={a.id} className="py-2 flex flex-wrap items-center gap-3">
                    <input type="checkbox" checked={a.checked} onChange={e => patch({ checked: e.target.checked })} aria-label="Versement fait sur l'autre compte" className="w-5 h-5 accent-primary" />
                    <select value={a.accountId} onChange={e => patch({ accountId: e.target.value })} aria-label="Autre compte crédité" className="h-12 sm:h-10 px-2 rounded-xs bg-transparent border border-outline text-sm text-on-surface flex-1 min-w-0">
                      {savingAccounts.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
                    </select>
                    <label className="flex items-center gap-1">
                      <span className="sr-only">Montant versé sur l'autre compte</span>
                      <input type="text" inputMode="decimal" value={a.amount} onChange={e => patch({ amount: e.target.value })} aria-invalid={invalid || undefined}
                        className="w-24 h-12 sm:h-10 px-2 text-right text-sm tabular-nums rounded-xs bg-transparent border border-outline text-on-surface aria-[invalid=true]:border-error aria-[invalid=true]:border-2" />
                      <span className="text-sm text-on-surface-variant" aria-hidden="true">€</span>
                    </label>
                    <IconButton icon={X} label="Retirer cet autre compte" onClick={() => setAdded(list => list.filter(x => x.id !== a.id))} />
                  </li>
                );
              })}
            </ul>
          )}
          {savingAccounts.length > 0 && (
            <Button variant="text" size="sm" className="mt-1 -ml-3" onClick={() => setAdded(list => [...list, { id: `${Date.now()}-${list.length}`, accountId: (savingAccounts.find(a => !lines.some(l => l.accountId === a.id)) ?? savingAccounts[0]).id, amount: '', checked: true }])}>
              <Plus className="w-4 h-4" aria-hidden="true" /> Autre compte
            </Button>
          )}

          {transferLines.length > 0 && (
            <>
              <h3 className="mt-6 flex items-center gap-2 border-b border-outline-variant pb-2 text-sm font-medium text-on-surface"><ArrowRightLeft className="w-4 h-4 text-on-surface-variant" aria-hidden="true" /> Avant l'épargne : les virements de la paie</h3>
              <ul className="divide-y divide-outline-variant">{transferLines.map(renderLine)}</ul>
            </>
          )}
          {!frozen && dist.shortfall > 0 && (
            <p role="status" className="mt-4 text-sm font-medium text-error flex items-center gap-2"><Info className="w-4 h-4 shrink-0" aria-hidden="true" /> Il manque {formatEUR(dist.shortfall)} : les virements et l'épargne prévus dépassent la paie.</p>
          )}

          <div className="mt-6 max-w-xs">
            <TextField label="Virements faits le" type="date" value={transferDate} onChange={e => setTransferDate(e.target.value)} supporting="Date des versements enregistrés sur vos comptes." />
          </div>

          {error && <p role="alert" className="mt-4 text-sm text-error flex items-start gap-2"><Info className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />{error}</p>}

          <div className="mt-6 flex flex-wrap items-center justify-end gap-2">
            <Button variant="text" onClick={() => setStep(1)} className="mr-auto -ml-3 max-sm:h-12"><ArrowLeft className="w-4 h-4" aria-hidden="true" /> Retour</Button>
            <Button variant="tonal" onClick={() => submit(false)} className="max-sm:h-12"><Wallet className="w-4 h-4" aria-hidden="true" /> Enregistrer</Button>
            <Button onClick={() => submit(true)} className="max-sm:h-12"><CheckCheck className="w-4 h-4" aria-hidden="true" /> Tout est fait comme conseillé</Button>
          </div>
          <p className="mt-2 text-xs text-on-surface-variant text-right">« Enregistrer » garde seulement les cases cochées ; le reste reste à faire dans la carte « Ma paie ».</p>
        </>
      )}
    </Modal>
  );
};

export default PayReceivedSheet;
