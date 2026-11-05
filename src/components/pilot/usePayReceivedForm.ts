// ================================================
// FILE: src/components/pilot/usePayReceivedForm.ts
// État et calculs de la feuille « J'ai reçu ma paie » (PayReceivedSheet) : étapes, montants,
// solde du compte courant, répartition, lignes cochées, enregistrement. Extrait tel quel de la
// feuille, qui ne garde que l'affichage ; voir l'en-tête de PayReceivedSheet pour le déroulé.
// ================================================
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { AccountType, type ExtraNature, type GlobalAppData, type PayBalance, type PayChecklistLine, type PayslipRecord } from '../../types';
import { extraNatureOf } from '../../lib/extraNature';
import type { RecordPayInput } from '../../lib/commands';
import { computeMonthlyPay, computeMonthlySavingsCapacity } from '../../lib/finance';
import { allocationSentence, balanceIncludesPay, currentAccountPrefill, recommendPayDistribution } from '../../lib/payDistribution';
import { savingsMonthOf } from '../../lib/payCalendar';
import { isPayReviewDone, liveDone, payslipForMonth, payslipPeriodOf, suggestedPayKind } from '../../lib/payRecords';
import { computeGoodMonths, computePayReview, motivationSettings } from '../../lib/motivation';
import { localTodayISO, parseISODate } from '../../lib/dates';
import { parseFrenchNumber } from '../../lib/numbers';
import { round2 } from '../../lib/money';
import { formatEUR, formatMonth, frenchDay, toInputAmount } from '../../lib/format';
import { livePayBar, payBarParts, savingsNoteOf } from '../../lib/pilotView';
import { usePayslipImport } from '../payslips/usePayslipImport';

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

export interface SheetProps extends PayRitualProps {
  onClose: () => void;
  /** Paie à modifier (« Modifier la paie ») ; absent : nouvelle paie. */
  editPayId?: string;
}

type Step = 0 | 1 | 2;
interface RowState { checked: boolean; amount: string; accountId?: string; already: boolean }
export interface AddedRow { id: string; accountId: string; amount: string; checked: boolean }

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
export const parseAmount = (text: string): number | null => {
  const v = parseFrenchNumber(text);
  return v !== null && v >= 0 ? v : null;
};
/** « 27 octobre » (avec l'année si ce n'est pas celle d'aujourd'hui). */
export const dayLabel = (iso: string, today: string) => {
  const d = parseISODate(iso);
  return `${frenchDay(d)}${iso.slice(0, 4) !== today.slice(0, 4) ? ` ${iso.slice(0, 4)}` : ''}`;
};
/** Mois d'épargne en toutes lettres (avec l'année si ce n'est pas celle d'aujourd'hui). */
export const monthLabel = (key: string, today: string) => formatMonth(key, key.slice(0, 4) !== today.slice(0, 4));
/** Solde du compte courant : peut être négatif (« −50 », signe moins typographique accepté). */
const parseBalance = (text: string): number | null => parseFrenchNumber(text.replace(/[−–]/g, '-'));
const ageLabel = (days: number) => (days <= 0 ? "aujourd'hui" : days === 1 ? 'hier' : `il y a ${days} jours`);

const isFixedLine = (l: PayChecklistLine) => l.kind === 'transfer' && l.key !== 't:projects' && l.key !== 't:leisure';
const LEISURE_LINE = 't:leisure';
const LEISURE_LABEL = 'Argent plaisir (reste sur le compte courant)';


export const usePayReceivedForm = ({ doc, geminiApiKey, pickerApiKey, onRecordPay, onSavePayslip, onClose, editPayId }: SheetProps) => {
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
  // Versement en plus : sa nature, choisie en premier (un ancien versement sans nature : « Autre »).
  const [natureChoice, setNatureChoice] = useState<ExtraNature | undefined>(existing?.kind === 'extra' ? extraNatureOf(existing) : undefined);
  const nature = kind === 'extra' ? natureChoice : undefined;
  // Cadeau : pour une occasion (anniversaire, fêtes, mariage) ? Pas enregistré, il ne sert qu'à la phrase.
  const [occasion, setOccasion] = useState<boolean | undefined>(undefined);
  // Fiche relue dans le rituel : gardée ici aussi (la liste des fiches suit au rendu suivant).
  const [savedSlip, setSavedSlip] = useState<PayslipRecord | undefined>(undefined);
  const payslip = kind === 'extra' ? undefined : savedSlip ?? payslipForMonth(doc.payslips, month, existing?.payslipId);
  const slipPeriod = payslipPeriodOf(month);
  const initialAmount = existing?.amount ?? payslipForMonth(doc.payslips, savingsMonthOf(today))?.extracted.netPaid ?? expected;
  // Argent reçu en plus : le montant part vide (la paie estimée n'a rien à voir avec un remboursement de 40 €).
  const [amountText, setAmountText] = useState(!existing && suggestion === 'extra' ? '' : toInputAmount(Math.round(initialAmount * 100) / 100));
  const [bonusOpen, setBonusOpen] = useState(!!existing?.bonus);
  const [bonusText, setBonusText] = useState(existing?.bonus ? toInputAmount(existing.bonus) : '');
  const amount = parseAmount(amountText);
  const bonusRaw = bonusText.trim() === '' ? 0 : parseAmount(bonusText);
  const bonusTooHigh = amount !== null && bonusRaw !== null && bonusRaw > amount;

  // Compte courant : solde lu maintenant, paie comprise (prérempli si le solde connu est
  // récent). `null` : pas touché, la proposition suit le montant ; '' : « Je ne sais pas ».
  const prefill = useMemo(
    () => currentAccountPrefill(doc, { receivedOn: dateOk ? receivedOn : today, amount: amount ?? 0, today }),
    [doc, receivedOn, dateOk, amount, today]);
  const savedBalance = existing?.balance;
  const savedSeenText = savedBalance && savedBalance.source !== 'unknown' && savedBalance.seen !== undefined ? toInputAmount(savedBalance.seen) : '';
  // Paie déjà déclarée : son solde (une ancienne paie sans solde reste à « Je ne sais pas » : même répartition).
  const [balanceText, setBalanceText] = useState<string | null>(existing ? savedSeenText : null);
  const [includesPay, setIncludesPay] = useState(savedBalance ? balanceIncludesPay(savedBalance) : true);
  const balanceShown = balanceText ?? (prefill.seen !== undefined ? toInputAmount(prefill.seen) : '');
  const seenRaw = balanceShown.trim() === '' ? undefined : parseBalance(balanceShown);
  const balanceInvalid = kind !== 'extra' && seenRaw === null;
  const seen = seenRaw ?? undefined;
  const balance: PayBalance = seen === undefined
    ? { before: 0, source: 'unknown' }
    : {
        seen,
        before: round2(includesPay ? seen - (amount ?? 0) : seen),
        source: balanceText === null ? prefill.source ?? 'typed'
          : existing && savedBalance && balanceText === savedSeenText ? savedBalance.source : 'typed',
      };
  const before = kind === 'extra' ? 0 : balance.before;
  // D'où vient le chiffre proposé, et son âge (un solde trop ancien n'est pas proposé).
  const balanceHelp = seen === undefined
    ? (balanceText === '' || existing
        ? 'Sans votre solde, Pécule suppose que le compte courant était vide avant la paie.'
        : prefill.checkedOn && prefill.days !== undefined
          ? `Dernier solde connu ${ageLabel(prefill.days)} : trop ancien. Regardez votre banque.`
          : 'Le solde affiché par votre banque, maintenant.')
    : balanceText === null && prefill.source === 'known' && prefill.checkedOn
      ? `Solde enregistré le ${dayLabel(prefill.checkedOn, today)}.`
      : balanceText === null && prefill.source === 'estimated' && prefill.checkedOn && prefill.days !== undefined && prefill.known !== undefined
        ? `Estimation : ${formatEUR(prefill.known)} le ${dayLabel(prefill.checkedOn, today)} (${ageLabel(prefill.days)}), plus votre paie. Vérifiez dans votre banque.`
        : 'Le solde affiché par votre banque, maintenant.';
  const step1Ok = amount !== null && bonusRaw !== null && !bonusTooHigh && dateOk && !balanceInvalid && (kind !== 'extra' || nature !== undefined);

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
  const bonus = bonusRaw ?? 0;
  // L'ancien « À placer » d'une paie déjà déclarée est toujours lu (le rituel ne l'écrit plus).
  const dist = useMemo(
    () => recommendPayDistribution(doc, { amount: amount ?? 0, bonus, toSave: existing?.toSave, kind, nature, before, receivedOn: dateOk ? receivedOn : today }),
    [doc, amount, bonus, existing?.toSave, kind, nature, before, receivedOn, dateOk, today]);
  const doneBefore = useMemo(() => (existing ? liveDone(existing.done, doc.accounts) : {}), [existing, doc.accounts]);
  const frozen = !!existing && existing.lines.length > 0 && Object.keys(doneBefore).length > 0;
  const lines: PayChecklistLine[] = frozen ? existing!.lines : dist.lines;
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [added, setAdded] = useState<AddedRow[]>([]);
  const [transferDate, setTransferDate] = useState(today);
  const [error, setError] = useState<string | null>(null);
  const savingAccounts = doc.accounts.filter(a => a.type !== AccountType.COMPTE_COURANT && a.type !== AccountType.IMMOBILIER);
  const rowOf = (l: PayChecklistLine): RowState => rows[l.key] ?? { checked: false, amount: toInputAmount(l.amount), accountId: l.accountId, already: false };
  const patchRow = (l: PayChecklistLine, patch: Partial<RowState>) => setRows(r => ({ ...r, [l.key]: { ...rowOf(l), ...patch } }));
  const suggestions = frozen ? [] : dist.steps.filter(st => st.alert && st.hint);
  const allocation = dist.allocation;
  const gapSentence = frozen ? undefined : allocationSentence(allocation);

  // Groupes, dans l'ordre des virements ; le plaisir est la ligne d'équilibre.
  const fixedLines = lines.filter(isFixedLine);
  const savingLines = lines.filter(l => l.kind === 'saving');
  const projectLine = lines.find(l => l.key === 't:projects');
  const leisureLine = lines.find(l => l.key === LEISURE_LINE);
  const valueOf = (l: PayChecklistLine) => doneBefore[l.key]?.amount ?? parseAmount(rowOf(l).amount) ?? 0;
  const sum = (ls: PayChecklistLine[]) => round2(ls.reduce((s, l) => s + valueOf(l), 0));
  const fixedSum = sum(fixedLines);
  const savingSum = round2(sum(savingLines) + added.reduce((s, a) => s + (parseAmount(a.amount) ?? 0), 0));
  const projectsSum = projectLine ? valueOf(projectLine) : 0;
  const available = round2((amount ?? 0) + before);
  const leisureLive = round2(available - fixedSum - savingSum - projectsSum);
  const bar = useMemo(() => livePayBar(payBarParts(allocation), {
    ...(kind === 'extra' ? {} : { fixed: fixedSum, projects: projectsSum }),
    savings: savingSum, leisure: leisureLive,
  }), [allocation, kind, fixedSum, projectsSum, savingSum, leisureLive]);
  const modified = added.length > 0 || lines.some(l => l.key !== LEISURE_LINE && !doneBefore[l.key]
    && (rowOf(l).amount !== toInputAmount(l.amount) || (rowOf(l).accountId ?? '') !== (l.accountId ?? '')));
  const resetAmounts = () => {
    setRows(r => Object.fromEntries(Object.entries(r).map(([k, v]) => {
      const l = lines.find(x => x.key === k);
      return [k, l ? { ...v, amount: toInputAmount(l.amount), accountId: l.accountId } : v];
    })));
    setAdded([]);
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
    // Le plaisir : ce qui reste vraiment, d'après les montants saisis (pas de case : fait avec le reste).
    const leisureAmount = round2(Math.max(0, leisureLive));
    const sentLines = frozen || kind === 'extra' ? lines : [
      ...lines.filter(l => l.key !== LEISURE_LINE),
      ...(leisureAmount > 0 ? [{ ...(leisureLine ?? { key: LEISURE_LINE, label: LEISURE_LABEL, kind: 'transfer' as const }), amount: leisureAmount }] : []),
    ];
    for (const l of sentLines) {
      if (doneBefore[l.key]) continue;
      if (l.key === LEISURE_LINE) {
        if (all) done.push({ key: l.key, amount: leisureAmount });
        continue;
      }
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
      for (let n = 2; [...sentLines, ...extraLines].some(l => l.key === key); n++) key = `a:${account.id}-${n}`;
      extraLines.push({ key, label: account.name, amount: v, kind: 'saving', accountId: account.id, added: true });
      if (all || a.checked) done.push({ key, amount: v });
    }
    const input: RecordPayInput = {
      pay: {
        ...(existing ? { id: existing.id } : {}),
        receivedOn, savingsMonth: month, amount: amount!,
        bonus: kind === 'extra' ? undefined : bonus,
        // Ancienne paie sans solde, laissée à « Je ne sais pas » : rien n'est ajouté.
        ...(kind === 'extra' ? { kind, ...(nature ? { nature } : {}) } : existing && !savedBalance && balance.source === 'unknown' ? {} : { balance }),
        ...(payslip ? { payslipId: payslip.id } : {}),
      },
      lines: [...sentLines, ...extraLines],
      done,
      transferDate,
      // « Tout est fait » : Pécule note ce qui reste vraiment sur le compte courant.
      ...(all && kind !== 'extra' && balance.source !== 'unknown' && prefill.account ? { currentAccountId: prefill.account.id } : {}),
    };
    const refused = onRecordPay(input);
    if (refused) { setError(refused); return; }
    onClose();
  };

  const monthName = monthLabel(month, today);
  const stepCount = review ? 3 : 2;
  const stepIndex = review ? step + 1 : step;

  // Ce que l'épargne conseillée contient de plus que l'épargne visée (calculé sur le résultat).
  const savingsNote = savingsNoteOf(allocation);

  return {
    today, existing, ids, review, step, setStep, expected, receivedOn, setReceivedOn, monthChoice, setMonthChoice,
    changingMonth, setChangingMonth, dateOk, month, suggestion, kindChoice, setKindChoice, kind, natureChoice, setNatureChoice,
    nature, occasion, setOccasion, payslip, slipPeriod, amountText, setAmountText, bonusOpen, setBonusOpen, bonusText,
    setBonusText, amount, bonusRaw, bonusTooHigh, prefill, balanceShown, setBalanceText, includesPay, setIncludesPay, seen,
    balanceInvalid, balance, before, balanceHelp, step1Ok, imp, slipNet, slipGap, dist, doneBefore, frozen, lines, rowOf,
    patchRow, setAdded, added, transferDate, setTransferDate, error, savingAccounts, suggestions, allocation, gapSentence,
    fixedLines, savingLines, projectLine, fixedSum, savingSum, projectsSum, available, leisureLive, bar, modified,
    resetAmounts, headingRef, goToPlan, submit, monthName, stepCount, stepIndex, savingsNote,
  };
};
