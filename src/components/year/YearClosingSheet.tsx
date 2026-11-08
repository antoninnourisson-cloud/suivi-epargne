// « Clôture de l'année » (phase 8, rituel 4) : la liste de lib/yearClosing dans une seule
// feuille, plein écran sur téléphone, chargée à la demande depuis la tâche de l'Accueil
// (janvier-février) et la carte de l'Historique. On y saisit sur place :
//  - les soldes au 31 décembre, les intérêts crédités par la banque (avec l'écart au calcul de
//    Pécule), les relevés annuels des placements et le taux servi du fonds euros ;
//  - l'objectif de l'année qui commence (prérempli avec le rythme prévu par le plan de l'app).
// Un seul « Enregistrer mes saisies » pour toutes ces saisies (une commande, un seul « Annuler ») :
// la feuille reste ouverte, sur la même étape. Une étape faite se replie en une ligne ; le compteur
// avance dès qu'une étape est complète à l'écran. Les autres étapes (restitution, « Votre année »,
// déclaration, paramètres fiscaux, archive, clôture) gardent leurs boutons, dans l'ordre de la
// liste. Calculs dans lib/yearClosingSheet.
import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CalendarCheck, Check, CheckCircle2, ChevronDown, Circle, Loader2, ScanText, X } from 'lucide-react';
import type { FiscalConfig, GlobalAppData } from '../../types';
import type { View } from '../../navigation';
import {
  addClosingChecks, remainingSteps, setClosingCheck, setYearClosed, yearArchiveCsv, CLOSING_CHECKS,
  type YearClosingAction, type YearClosingButton, type YearClosingStep,
} from '../../lib/yearClosing';
import {
  buildClosingSheet, closingSheetInput, creditedText, interestGap, readGoal, stepFilledOnScreen,
  type ClosingDrafts, type ClosingSheetModel, type ClosingValueLine,
} from '../../lib/yearClosingSheet';
import { yearClosingSummary, type YearClosingInput } from '../../lib/commands';
import { applyTaxScale, findFiscalReview } from '../../lib/finance';
import { formatISODay } from '../../lib/dates';
import { formatEUR, formatRate, toInputAmount } from '../../lib/format';
import { parseFrenchNumber } from '../../lib/numbers';
import { downloadCsv, downloadJSON } from '../../services/fileDownload';
import { extractAnnualStatement, fileToBase64 } from '../../services/geminiService';
import { checkAnnualStatement } from '../../lib/annualStatement';
import { revealElementById } from '../revealElement';
import { Modal } from '../Modal';
import { NumberInput } from '../NumberInput';
import { Button, IconButton, TextField } from '../ui';

/** Objectif de l'année modifié : montant, ou `null` pour le retirer. */
export interface YearGoalChange { year: number; amount: number | null }

interface YearClosingSheetProps {
  /** Année clôturée (l'année écoulée). */
  year: number;
  data: GlobalAppData;
  /** Toutes les saisies en une fois ; refus renvoyé, sinon `null`. */
  onRecord: (input: YearClosingInput, goal: YearGoalChange | null) => string | null;
  onPatchConfig: (patch: Partial<GlobalAppData['config']>) => void;
  /** Nouveau barème appliqué, paramètres fiscaux de l'année confirmés. */
  onUpdateFiscalConfig: (update: (prev: FiscalConfig) => FiscalConfig) => void;
  onNavigate: (view: View) => void;
  /** Ce qui part dans l'archive JSON : le fichier sans ce qui reste propre à l'appareil. */
  getArchiveData: () => GlobalAppData;
  confirm: (title: string, message: string, onConfirm: () => void, danger?: boolean, confirmLabel?: string) => void;
  onClose: () => void;
  /** Clé Gemini de l'appareil : sans elle, pas de bouton « Lire le relevé ». Par défaut, celle des réglages. */
  geminiApiKey?: string;
  /** Date du jour (tests). */
  now?: Date;
}

const eur0 = (n: number) => formatEUR(n, 0);
const eur2 = (n: number) => formatEUR(n, 2);
const rateText = (n: number) => String(n).replace('.', ',');
const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;
const EMPTY: ClosingDrafts = { credited: {}, values: {}, deposits: {}, unchanged: [], rates: {} };
/** Étapes saisies dans la feuille. */
const INLINE = new Set(['balances', 'interest', 'statements']);

const StepStatus: React.FC<{ done: boolean; small?: boolean }> = ({ done, small }) => {
  const size = small ? 'w-4 h-4' : 'w-6 h-6';
  return done
    ? <><CheckCircle2 className={`${size} shrink-0 text-primary`} aria-hidden="true" /><span className="sr-only">Fait : </span></>
    : <><Circle className={`${size} shrink-0 text-outline`} aria-hidden="true" /><span className="sr-only">À faire : </span></>;
};

/** Ligne d'un compte : nom, état, puis ses champs. */
const Line: React.FC<{ name: string; done: boolean; status?: string; children?: React.ReactNode }> = ({ name, done, status, children }) => (
  <li className="py-3 first:pt-1" data-account={name}>
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      <StepStatus done={done} small />
      <span className="font-medium text-on-surface">{name}</span>
      {status && <span className="basis-full pl-6 text-on-surface-variant">{status}</span>}
    </p>
    {children && <div className="mt-2 space-y-2">{children}</div>}
  </li>
);

/**
 * Montant saisi, affiché comme ailleurs dans l'app (« 15 392,69 € ») : NumberInput, sur le
 * texte tapé gardé en brouillon. `name` : nom accessible complet (le même libellé revient pour
 * chaque compte). Une valeur rendue sans changement (sortie du champ) ne crée pas de saisie :
 * un solde proposé n'est « tapé » que si l'on y touche vraiment. `touchSame` : y toucher sans rien
 * changer compte comme une saisie (les intérêts crédités : passer sur le champ, c'est le confirmer).
 */
const MoneyField: React.FC<{
  label: string; name: string; text: string; onText: (text: string) => void; className?: string; supporting?: React.ReactNode; touchSame?: boolean;
}> = ({ label, name, text, onText, className, supporting, touchSame }) => {
  const current = parseFrenchNumber(text) ?? 0;
  return (
    <TextField className={className} label={label} supporting={supporting} render={p => (
      <NumberInput
        id={p.id} describedBy={p.describedBy} invalid={p.invalid} value={current} min={0} suffix="€" className={`${p.className} tabular-nums`}
        inputRef={el => el?.setAttribute('aria-label', name)}
        onChange={n => { if (touchSame || n !== current) onText(toInputAmount(n)); }}
      />
    )} />
  );
};

export const YearClosingSheet: React.FC<YearClosingSheetProps> = ({
  year, data, onRecord, onPatchConfig, onUpdateFiscalConfig, onNavigate, getArchiveData, confirm, onClose, geminiApiKey, now: nowProp,
}) => {
  const now = useMemo(() => nowProp ?? new Date(), [nowProp]);
  const today = formatISODay(now);
  const model: ClosingSheetModel = useMemo(() => buildClosingSheet(data, year, now), [data, year, now]);
  const { closing } = model;
  const closings = data.config?.yearClosings;
  const accounts = data.accounts || [];
  const [drafts, setDrafts] = useState<ClosingDrafts>(EMPTY);
  const [goalText, setGoalText] = useState(() => String(model.goal.current ?? model.goal.suggested));
  const [error, setError] = useState<string | null>(null);
  /** Ce que le dernier « Enregistrer » a enregistré (une phrase), jusqu'à la prochaine saisie. */
  const [savedNote, setSavedNote] = useState<string | null>(null);
  /** Étapes ouvertes ou repliées à la main (sinon : repliée dès qu'elle est faite). */
  const [opened, setOpened] = useState<Record<string, boolean>>({});
  // Lecture d'un relevé par Gemini : compte en cours, et ce qui a été lu (résumé + avertissements) par compte.
  const apiKey = geminiApiKey ?? data.config?.geminiApiKey ?? '';
  const [reading, setReading] = useState<string | null>(null);
  const [readNotes, setReadNotes] = useState<Record<string, { summary: string; warnings: string[] }>>({});
  const fileRef = useRef<HTMLInputElement>(null);
  const readFor = useRef<ClosingValueLine | null>(null);
  // Aucun champ n'a le focus à l'ouverture (pas de clavier d'office) : c'est le titre.
  const titleRef = useRef<HTMLHeadingElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  /** Étape en vue au moment d'enregistrer : les étapes faites se replient, on la garde à l'écran. */
  const anchor = useRef<{ id: string; model: ClosingSheetModel } | null>(null);

  const edit = <K extends 'credited' | 'values' | 'deposits' | 'rates'>(field: K, id: string, value: string) => {
    setError(null);
    setSavedNote(null);
    setDrafts(d => ({ ...d, [field]: { ...d[field], [id]: value } }));
  };
  const toggleUnchanged = (id: string, on: boolean) => {
    setError(null);
    setSavedNote(null);
    setDrafts(d => ({ ...d, unchanged: on ? [...d.unchanged.filter(x => x !== id), id] : d.unchanged.filter(x => x !== id) }));
  };

  // Ce que « Enregistrer » ferait : rien de grisé si une saisie est illisible (le message le dit).
  const prepared = closingSheetInput(model, accounts, drafts, today);
  const goal = readGoal(goalText);
  const goalChange: YearGoalChange | null = goal === undefined || goal === (model.goal.current ?? null) ? null : { year: model.goal.year, amount: goal };
  const somethingToSave = 'error' in prepared || prepared.input.updates.length > 0 || prepared.input.rates.length > 0 || !!goalChange;

  const save = () => {
    if ('error' in prepared) { setError(prepared.error); return; }
    if (goal === undefined) { setError(`Objectif ${model.goal.year} non reconnu (exemple : 9 000).`); return; }
    const inView = Array.from(listRef.current?.children ?? []).find(li => li.getBoundingClientRect().bottom > 120)?.getAttribute('data-step');
    const refused = onRecord(prepared.input, goalChange);
    if (refused) { setError(refused); return; }
    // La feuille reste ouverte, sur la même étape ; les saisies sont devenues des données.
    const said = [
      yearClosingSummary(prepared.input),
      goalChange ? (goalChange.amount === null ? `Objectif ${goalChange.year} retiré` : `Objectif ${goalChange.year} enregistré`) : null,
    ].filter(Boolean).join(' · ');
    setSavedNote(said || 'Enregistré');
    setDrafts(EMPTY);
    setReadNotes({});
    setError(null);
    anchor.current = inView ? { id: inView, model } : null;
  };
  // Les étapes faites se replient une fois les données à jour : l'étape en vue reste en vue.
  useLayoutEffect(() => {
    const a = anchor.current;
    if (!a || a.model === model) return;
    anchor.current = null;
    (listRef.current?.querySelector(`[data-step="${a.id}"]`) as HTMLElement | null)?.scrollIntoView?.({ block: 'start' });
  }, [model]);

  const leave = (view: View) => { onClose(); onNavigate(view); };
  const run = (a: YearClosingAction) => {
    switch (a.type) {
      case 'navigate': leave(a.view); break;
      // L'aide est en bas de l'écran « Dons et impôts » : on l'amène à l'écran.
      case 'show-tax-return': leave('donations'); revealElementById('tax-return'); break;
      case 'open-review':
        // « Votre année » (Analyses › Évolution) s'ouvre sur l'année, comme depuis sa notification.
        if (!closings?.[String(year)]?.checked?.includes(CLOSING_CHECKS.review)) onPatchConfig({ yearClosings: setClosingCheck(closings, year, CLOSING_CHECKS.review) });
        window.history.replaceState(window.history.state, '', `${window.location.pathname}?year=${year}`);
        window.dispatchEvent(new CustomEvent('pecule:open-year', { detail: year }));
        leave('history');
        break;
      case 'download-json':
        downloadJSON(`pecule-archive-${year}.json`, getArchiveData());
        onPatchConfig({ yearClosings: addClosingChecks(closings, year, [CLOSING_CHECKS.archiveJson]), lastExportAt: today });
        break;
      case 'download-csv': {
        const csv = yearArchiveCsv(data, year);
        downloadCsv(csv.fileName, csv.rows);
        onPatchConfig({ yearClosings: addClosingChecks(closings, year, [CLOSING_CHECKS.archiveCsv]) });
        break;
      }
      // Le taux servi se saisit dans la feuille (« Taux inchangé » remplit le champ).
      case 'confirm-rate': break;
      case 'apply-tax-scale': onUpdateFiscalConfig(prev => { const scale = findFiscalReview(prev, now).newScale; return scale ? applyTaxScale(prev, scale, now) : prev; }); break;
      case 'confirm-fiscal-params': onUpdateFiscalConfig(prev => ({ ...prev, paramsReviewedYear: Math.max(prev.paramsReviewedYear ?? 0, a.year) })); break;
      case 'close': {
        const close = () => onPatchConfig({ yearClosings: setYearClosed(closings, year, today) });
        const left = remainingSteps(closing);
        if (left.length === 0) { close(); break; }
        confirm(
          `Clôturer l'année ${year} ?`,
          `Il reste ${left.length > 1 ? `${left.length} étapes` : 'une étape'} :\n${left.map(t => `• ${t}`).join('\n')}\nLes rappels de clôture s'arrêteront quand même ; vous pourrez rouvrir l'année.`,
          close, false, `Clôturer ${year}`,
        );
        break;
      }
      case 'reopen': onPatchConfig({ yearClosings: setYearClosed(closings, year, null) }); break;
    }
  };
  // « Clôturer » est le seul bouton plein de la feuille.
  const button = (b: YearClosingButton, variant: 'tonal' | 'outlined' | 'text' | 'filled', key?: string) => (
    <Button key={key ?? b.label} variant={variant} className="max-sm:h-12" onClick={() => run(b.action)}>{b.label}</Button>
  );

  /** Lit le relevé choisi et préremplit les champs du compte ; l'utilisateur relit et enregistre comme d'habitude. */
  const readStatement = async (line: ClosingValueLine, file: File) => {
    const note = (summary: string, warnings: string[]) => setReadNotes(n => ({ ...n, [line.accountId]: { summary, warnings } }));
    if (file.size > 15 * 1024 * 1024) { note('', ['Fichier trop lourd (15 Mo au plus).']); return; }
    setReading(line.accountId);
    try {
      const read = await extractAnnualStatement(apiKey, await fileToBase64(file), file.type || 'application/pdf');
      const { fill, warnings } = checkAnnualStatement(read, year);
      const said: string[] = [];
      if (fill.valueAtYearEnd !== undefined) { edit('values', line.accountId, toInputAmount(fill.valueAtYearEnd)); said.push(`valeur ${eur2(fill.valueAtYearEnd)}`); }
      if (fill.deposits !== undefined && line.depositsOfYear !== undefined) { edit('deposits', line.accountId, toInputAmount(fill.deposits)); said.push(`versements ${eur2(fill.deposits)}`); }
      if (fill.rate !== undefined && line.rate && !line.rate.done) { edit('rates', line.accountId, rateText(fill.rate)); said.push(`taux ${formatRate(fill.rate)}`); }
      if (fill.interest !== undefined) {
        const due = model.interest.find(i => i.accountId === line.accountId && !i.done);
        if (due) edit('credited', line.accountId, toInputAmount(fill.interest));
        said.push(`intérêts ${eur2(fill.interest)}${due ? '' : ' (non reportés : à noter si besoin)'}`);
      }
      note(said.length ? `Lu sur le relevé : ${said.join(', ')}. Vérifiez avant d'enregistrer.` : '', warnings);
    } catch (err) {
      note('', [err instanceof Error ? `Lecture impossible : ${err.message.slice(0, 160)}` : 'Lecture impossible.']);
    } finally {
      setReading(null);
    }
  };
  const onStatementFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    const line = readFor.current;
    if (file && line) void readStatement(line, file);
  };

  const creditedOf = (id: string, computed: number) => drafts.credited[id] ?? creditedText(computed);
  /**
   * Solde au 31 décembre proposé : celui de Pécule, plus les intérêts crédités ce jour-là, tels
   * que saisis à l'étape 2 (corriger l'intérêt corrige le solde proposé). Un solde tapé à la main
   * (`drafts.values`) n'est jamais écrasé.
   */
  const valueDefault = (id: string, atYearEnd: number) => {
    const line = model.interest.find(l => l.accountId === id && !l.done);
    const credited = line ? parseFrenchNumber(creditedOf(id, line.computed)) ?? 0 : 0;
    return toInputAmount(Math.round((atYearEnd + credited) * 100) / 100);
  };
  const stepItem = (s: YearClosingStep, key: string) => s.items.find(i => i.key === key);

  // --- Étapes saisies dans la feuille ---
  const unchangedBox = (l: ClosingValueLine) => (
    <label className="flex items-center gap-2 h-14 text-sm text-on-surface cursor-pointer shrink-0">
      <input type="checkbox" className="w-5 h-5 accent-primary" checked={drafts.unchanged.includes(l.accountId)} onChange={e => toggleUnchanged(l.accountId, e.target.checked)}
        aria-label={`Inchangé, ${l.name}`} />
      Inchangé
    </label>
  );

  const balancesBody = (s: YearClosingStep) => (
    <ul className="mt-2 divide-y divide-outline-variant" aria-label={s.title}>
      {model.balances.map(l => (
        <Line key={l.accountId} name={l.name} done={l.done} status={stepItem(s, l.accountId)?.detail}>
          <div className="flex items-end gap-3">
            <MoneyField className="flex-1 min-w-0" label="Solde au 31 décembre" name={`Solde au 31 décembre, ${l.name}`}
              text={drafts.values[l.accountId] ?? valueDefault(l.accountId, l.atYearEnd)} onText={t => edit('values', l.accountId, t)} />
            {!l.done && unchangedBox(l)}
          </div>
        </Line>
      ))}
    </ul>
  );

  const interestBody = (s: YearClosingStep) => (
    <ul className="mt-2 divide-y divide-outline-variant" aria-label={s.title}>
      {model.interest.map(l => {
        // Intérêts déjà enregistrés (le montant saisi, quel qu'il soit) : fait, jamais d'écart reproposé.
        if (l.done) return <Line key={l.accountId} name={l.name} done status={`${eur2(l.recorded || l.computed)} enregistrés`} />;
        const text = creditedOf(l.accountId, l.computed);
        const credited = parseFrenchNumber(text);
        const gap = credited !== null && credited >= 0 ? interestGap(l.computed, credited) : null;
        return (
          <Line key={l.accountId} name={l.name} done={false}>
            <p className="text-sm text-on-surface-variant">Calculé par Pécule : <span className="font-medium text-on-surface tabular-nums">{eur2(l.computed)}</span></p>
            <MoneyField label="Crédité par la banque" name={`Crédité par la banque, ${l.name}`} text={text} onText={t => edit('credited', l.accountId, t)} touchSame />
            {gap?.text && (
              <p className="text-sm text-on-surface" aria-live="polite" data-gap={l.accountId}>
                <span className="font-medium">{gap.text}.</span>{gap.causes && <span className="text-on-surface-variant"> {gap.causes}</span>}
              </p>
            )}
          </Line>
        );
      })}
    </ul>
  );

  const statementsBody = (s: YearClosingStep) => (
    <ul className="mt-2 divide-y divide-outline-variant" aria-label={s.title}>
      {model.statements.map(l => (
        <Line key={l.accountId} name={l.name} done={l.done} status={stepItem(s, l.accountId)?.detail}>
          <div className="grid grid-cols-2 gap-3">
            <MoneyField label="Valeur au 31 décembre" name={`Valeur au 31 décembre, ${l.name}`}
              text={drafts.values[l.accountId] ?? toInputAmount(l.atYearEnd)} onText={t => edit('values', l.accountId, t)} />
            {l.depositsOfYear !== undefined && (
              <MoneyField label={`Versements ${year}`} name={`Versements ${year}, ${l.name}`}
                text={drafts.deposits[l.accountId] ?? toInputAmount(l.depositsOfYear)} onText={t => edit('deposits', l.accountId, t)} />
            )}
          </div>
          {!l.done && unchangedBox(l)}
          {apiKey && (
            <div>
              <Button variant="text" className="-ml-3 max-sm:h-12" disabled={reading !== null} aria-label={`Lire le relevé, ${l.name}`}
                onClick={() => { readFor.current = l; fileRef.current?.click(); }}>
                {reading === l.accountId ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <ScanText className="w-4 h-4" aria-hidden="true" />}
                {reading === l.accountId ? 'Lecture du relevé…' : 'Lire le relevé'}
              </Button>
            </div>
          )}
          {readNotes[l.accountId] && (
            <div aria-live="polite" data-read-note={l.accountId} className="space-y-1">
              {readNotes[l.accountId].summary && <p className="text-sm text-on-surface">{readNotes[l.accountId].summary}</p>}
              {readNotes[l.accountId].warnings.map(w => <p key={w} role="alert" className="text-sm font-medium text-error">{w}</p>)}
            </div>
          )}
          {l.rate && (l.rate.done ? (
            <p className="text-sm text-on-surface-variant flex items-center gap-2"><StepStatus done small /> Taux servi {year} vérifié</p>
          ) : (
            <div className="flex items-end gap-2">
              <TextField className="flex-1 min-w-0" label={`Taux servi ${year}`} aria-label={`Taux servi ${year}, ${l.name}`} suffix="%" inputMode="decimal"
                placeholder={rateText(l.rate.current)} value={drafts.rates[l.accountId] ?? ''}
                supporting={`Actuel : ${formatRate(l.rate.current)}. Vide : rien ne change.`}
                onChange={e => edit('rates', l.accountId, e.target.value)} />
              <Button variant="text" className="h-14 shrink-0" onClick={() => edit('rates', l.accountId, rateText(l.rate!.current))}>Taux inchangé</Button>
            </div>
          ))}
        </Line>
      ))}
    </ul>
  );

  const restitutionBody = () => model.restitution && (
    <div className="mt-2 space-y-1 text-sm">
      <p className="text-on-surface" data-restitution-accounts>{model.restitution.accounts.map(a => `${a.name} : ${eur0(a.amount)}`).join(' · ')}</p>
      <p className="text-on-surface">Total à rendre : <span className="font-medium tabular-nums">{eur0(model.restitution.total)}</span></p>
      {model.restitution.parentalInterest >= 1 && (
        <p className="text-on-surface-variant">Les intérêts {year} vous restent, y compris les {eur0(model.restitution.parentalInterest)} produits par le capital de vos parents.</p>
      )}
    </div>
  );

  const goalBody = () => {
    const { saved, monthly, suggested } = model.goal;
    return (
      <MoneyField className="mt-3" label={`Objectif ${model.goal.year}`} name={`Objectif ${model.goal.year}`} text={goalText}
        onText={t => { setError(null); setSavedNote(null); setGoalText(t); }}
        supporting={model.goal.current === undefined
          ? `${monthly !== undefined
            ? `Prérempli avec le rythme prévu par votre plan : ${eur0(monthly)} par mois, soit ${eur0(suggested)} sur l'année. `
            : 'Prérempli avec ce que vous avez mis de côté. '}En ${year} : ${eur0(saved)} mis de côté. Il s'affichera sur l'Accueil.`
          : `En ${year} : ${eur0(saved)} mis de côté. Saisissez 0 pour retirer l'objectif.`} />
    );
  };

  // Textes des étapes saisies ici (la liste renvoie vers Actualiser).
  const detailOf = (s: YearClosingStep): string => {
    if (s.done) return s.detail;
    switch (s.id) {
      case 'balances': return 'Comparez avec votre banque et corrigez au besoin. Même sans changement, cochez « Inchangé » : le solde est noté comme vérifié.';
      case 'interest': return 'Ces comptes ont reçu leurs intérêts le 31 décembre. Saisissez ce que la banque a crédité : Pécule ne les compte pas comme de l\'argent mis de côté.';
      case 'statements': return `Reportez la valeur au 31 décembre et les versements de chaque relevé : les plus-values restent justes. Cochez « Inchangé » si les chiffres de Pécule sont déjà bons.${model.statements.some(l => l.rate) ? ` Le taux servi ${year} du fonds euros est publié par l'assureur en janvier.` : ''}`;
      default: return s.detail;
    }
  };

  /** Une étape faite se replie en une ligne : ce qui a été fait, en peu de mots. */
  const doneSummary = (s: YearClosingStep): string => {
    switch (s.id) {
      case 'balances': return plural(model.balances.length, 'solde vérifié', 'soldes vérifiés');
      case 'interest': return model.interest.every(l => l.done)
        ? `Intérêts enregistrés : ${eur2(model.interest.reduce((sum, l) => sum + (l.recorded || l.computed), 0))}`
        : 'Intérêts déjà enregistrés';
      case 'statements': return plural(model.statements.length, 'relevé reporté', 'relevés reportés');
      case 'review': return `Votre année ${year} a été consultée`;
      case 'tax-return': return 'C\'est noté';
      case 'fiscal-params': return `Paramètres vérifiés pour ${year + 1}`;
      case 'archive': return 'JSON et CSV téléchargés';
      default: return s.detail;
    }
  };

  const renderStep = (s: YearClosingStep, index: number) => {
    const inline = INLINE.has(s.id);
    const collapsible = s.done && s.id !== 'close';
    const expanded = !collapsible || (opened[s.id] ?? false);
    const buttons = inline ? [] : s.id === 'restitution' && model.restitution
      ? [{ label: 'Préparer la restitution', action: { type: 'navigate', view: 'parental' } } as YearClosingButton]
      : s.buttons;
    return (
      <li key={s.id} className="relative py-4 first:pt-2 flex gap-3" data-step={s.id}>
        {/* Pastille en direct, comme le compteur ; le repli, lui, attend l'enregistrement. */}
        <StepStatus done={s.done || (inline && stepFilledOnScreen(model, s.id, drafts))} />
        <div className="min-w-0 flex-1">
          <h4 className="text-sm font-medium text-on-surface">
            {collapsible ? (
              // Toute la ligne se touche (la zone du bouton couvre la ligne, sous les champs de l'étape ouverte).
              <button type="button" aria-expanded={expanded} onClick={() => setOpened(o => ({ ...o, [s.id]: !expanded }))}
                className="text-left rounded-xs outline-offset-4 after:absolute after:inset-0 after:content-['']">
                {index + 1}. {s.title}
              </button>
            ) : <>{index + 1}. {s.title}</>}
          </h4>
          <p className="mt-0.5 text-sm text-on-surface-variant">{expanded ? detailOf(s) : doneSummary(s)}</p>
          {expanded && (
            <div className="relative">
              {s.id === 'balances' && balancesBody(s)}
              {s.id === 'interest' && interestBody(s)}
              {s.id === 'statements' && statementsBody(s)}
              {s.id === 'restitution' && restitutionBody()}
              {!inline && s.items.length > 0 && (
                <ul className="mt-2 space-y-1" aria-label={s.title}>
                  {s.items.map(it => (
                    <li key={it.key} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                      <StepStatus done={it.done} small />
                      <span className="font-medium text-on-surface">{it.label}</span>
                      <span className="basis-full pl-6 text-on-surface-variant">{it.detail}</span>
                      {it.button && <span className="ml-auto">{button(it.button, 'text')}</span>}
                    </li>
                  ))}
                </ul>
              )}
              {(buttons.length > 0 || s.check) && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {buttons.map((b, i) => button(b, s.id === 'close' && !closing.closedOn ? 'filled' : i === 0 && !s.done ? 'tonal' : 'outlined', `${s.id}-${i}`))}
                  {s.check && (
                    <div className={s.check.hint ? 'basis-full' : undefined}>
                      <label className="flex items-center gap-2 min-h-12 px-2 text-sm text-on-surface cursor-pointer">
                        <input
                          type="checkbox" className="w-5 h-5 shrink-0 accent-primary" checked={s.check.checked}
                          aria-describedby={s.check.hint ? `${s.id}-check-hint` : undefined}
                          onChange={e => onPatchConfig({ yearClosings: setClosingCheck(closings, year, s.check!.key, e.target.checked) })}
                        />
                        {s.check.label}
                      </label>
                      {s.check.hint && <p id={`${s.id}-check-hint`} className="px-2 pl-9 -mt-2 text-xs text-on-surface-variant">{s.check.hint}</p>}
                    </div>
                  )}
                </div>
              )}
              {s.id === 'review' && goalBody()}
            </div>
          )}
        </div>
        {collapsible && <ChevronDown className={`w-5 h-5 shrink-0 text-on-surface-variant transition-transform ${expanded ? 'rotate-180' : ''}`} aria-hidden="true" />}
      </li>
    );
  };

  const title = `Clôture de l'année ${year}`;
  // Compteur : une étape compte dès qu'elle est complète à l'écran (avant « Enregistrer »), et
  // l'étape « Clôturer » est comptée.
  const total = closing.steps.length;
  const filled = closing.steps.filter(s => s.id !== 'close' && (s.done || (INLINE.has(s.id) && stepFilledOnScreen(model, s.id, drafts)))).length + (closing.closedOn ? 1 : 0);
  const summary = closing.closedOn
    ? 'Année clôturée : plus de rappel de clôture.'
    : `${filled} étape${filled > 1 ? 's' : ''} sur ${total} faite${filled > 1 ? 's' : ''}`;

  return (
    <Modal open onClose={onClose} label={title} variant="page" closeOnScrim={false} className="sm:max-w-xl p-0" initialFocusRef={titleRef}>
      {apiKey && <input ref={fileRef} type="file" accept="application/pdf,image/*" onChange={onStatementFile} className="hidden" tabIndex={-1} aria-hidden="true" data-statement-input />}
      <div className="px-4 sm:px-6 pt-4 sm:pt-6">
        <div className="flex items-start justify-between gap-2">
          <h2 ref={titleRef} tabIndex={-1} className="text-xl font-normal text-on-surface flex items-center gap-2 outline-hidden">
            <CalendarCheck className="w-5 h-5 shrink-0 text-primary" aria-hidden="true" /> {title}
          </h2>
          <IconButton icon={X} label="Fermer" onClick={onClose} className="-mr-3 -mt-2" />
        </div>
        <p className="mt-1 text-sm text-on-surface-variant" aria-live="polite">{summary}</p>
        {!closing.closedOn && total > 0 && (
          <div className="mt-3 h-1.5 rounded-full bg-surface-container-highest overflow-hidden" aria-hidden="true">
            <div className="h-full bg-primary rounded-full" style={{ width: `${Math.round((filled / total) * 100)}%` }} />
          </div>
        )}
        <ol ref={listRef} aria-label={`Étapes de la clôture ${year}`} className="mt-2 divide-y divide-outline-variant">
          {closing.steps.map(renderStep)}
        </ol>
      </div>
      <div className="sticky bottom-0 px-4 sm:px-6 py-3 border-t border-outline-variant bg-surface-container-high">
        {error && <p role="alert" className="mb-3 bg-error-container text-on-error-container p-3 rounded-xl text-sm font-medium">{error}</p>}
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-on-surface-variant" aria-live="polite" data-saved-note={savedNote ? '' : undefined}>
            {savedNote ?? 'Soldes, intérêts, relevés et objectif : enregistrés ensemble.'}
          </p>
          <Button variant="tonal" onClick={save} disabled={!somethingToSave} className="max-sm:h-12 shrink-0">
            <Check className="w-4 h-4" aria-hidden="true" /> Enregistrer mes saisies
          </Button>
        </div>
      </div>
    </Modal>
  );
};
