// « Clôture de l'année » (phase 8, rituel 4) : la liste de lib/yearClosing dans une seule
// feuille, plein écran sur téléphone, chargée à la demande depuis la tâche de l'Accueil
// (janvier-février) et la carte de l'Historique. On y saisit sur place :
//  - les soldes au 31 décembre, les intérêts crédités par la banque (avec l'écart au calcul de
//    Pécule), les relevés annuels des placements et le taux servi du fonds euros ;
//  - l'objectif de l'année qui commence (prérempli avec le mis de côté de « Votre année »).
// Un seul « Enregistrer » pour toutes ces saisies (une commande, un seul « Annuler »). Les autres
// étapes (restitution, « Votre année », déclaration, paramètres fiscaux, archive, clôture)
// gardent leurs boutons, dans l'ordre de la liste. Calculs dans lib/yearClosingSheet.
import React, { useMemo, useState } from 'react';
import { CalendarCheck, Check, CheckCircle2, Circle, X } from 'lucide-react';
import type { FiscalConfig, GlobalAppData } from '../../types';
import type { View } from '../../navigation';
import {
  addClosingChecks, remainingSteps, setClosingCheck, setYearClosed, yearArchiveCsv, CLOSING_CHECKS,
  type YearClosingAction, type YearClosingButton, type YearClosingStep,
} from '../../lib/yearClosing';
import {
  buildClosingSheet, closingSheetInput, creditedText, interestGap, readGoal, type ClosingDrafts, type ClosingSheetModel,
} from '../../lib/yearClosingSheet';
import type { YearClosingInput } from '../../lib/commands';
import { applyTaxScale, findFiscalReview } from '../../lib/finance';
import { formatISODay } from '../../lib/dates';
import { formatEUR, formatRate, toInputAmount } from '../../lib/format';
import { parseFrenchNumber } from '../../lib/numbers';
import { downloadCsv, downloadJSON } from '../../services/fileDownload';
import { revealElementById } from '../revealElement';
import { Modal } from '../Modal';
import { Button, IconButton, TextField } from '../ui';

/** Objectif de l'année modifié : montant, ou `null` pour le retirer. */
export interface YearGoalChange { year: number; amount: number | null }

export interface YearClosingSheetProps {
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
  /** Date du jour (tests). */
  now?: Date;
}

const eur0 = (n: number) => formatEUR(n, 0);
const eur2 = (n: number) => formatEUR(n, 2);
const rateText = (n: number) => String(n).replace('.', ',');
const EMPTY: ClosingDrafts = { credited: {}, values: {}, deposits: {}, unchanged: [], rates: {} };

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
      {status && <span className="text-on-surface-variant">· {status}</span>}
    </p>
    {children && <div className="mt-2 space-y-2">{children}</div>}
  </li>
);

export const YearClosingSheet: React.FC<YearClosingSheetProps> = ({
  year, data, onRecord, onPatchConfig, onUpdateFiscalConfig, onNavigate, getArchiveData, confirm, onClose, now: nowProp,
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

  const edit = <K extends 'credited' | 'values' | 'deposits' | 'rates'>(field: K, id: string, value: string) => {
    setError(null);
    setDrafts(d => ({ ...d, [field]: { ...d[field], [id]: value } }));
  };
  const toggleUnchanged = (id: string, on: boolean) => {
    setError(null);
    setDrafts(d => ({ ...d, unchanged: on ? [...d.unchanged, id] : d.unchanged.filter(x => x !== id) }));
  };

  // Ce que « Enregistrer » ferait : rien de grisé si une saisie est illisible (le message le dit).
  const prepared = closingSheetInput(model, accounts, drafts, today);
  const goal = readGoal(goalText);
  const goalChange: YearGoalChange | null = goal === undefined || goal === (model.goal.current ?? null) ? null : { year: model.goal.year, amount: goal };
  const somethingToSave = 'error' in prepared || prepared.input.updates.length > 0 || prepared.input.rates.length > 0 || !!goalChange;

  const save = () => {
    if ('error' in prepared) { setError(prepared.error); return; }
    if (goal === undefined) { setError(`Objectif ${model.goal.year} non reconnu (exemple : 9 000).`); return; }
    const refused = onRecord(prepared.input, goalChange);
    if (refused) { setError(refused); return; }
    onClose();
  };

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
          `Il reste ${left.length > 1 ? `${left.length} étapes` : 'une étape'} : ${left.join(' ; ')}. Les rappels de clôture s'arrêteront quand même ; vous pourrez rouvrir l'année.`,
          close, false, `Clôturer ${year}`,
        );
        break;
      }
      case 'reopen': onPatchConfig({ yearClosings: setYearClosed(closings, year, null) }); break;
    }
  };
  const button = (b: YearClosingButton, variant: 'tonal' | 'outlined' | 'text' | 'filled', key?: string) => (
    <Button key={key ?? b.label} variant={variant} className="max-sm:h-12" onClick={() => run(b.action)}>{b.label}</Button>
  );

  const creditedOf = (id: string, computed: number) => drafts.credited[id] ?? creditedText(computed);
  /** Solde au 31 décembre proposé : celui de Pécule, plus les intérêts crédités ce jour-là. */
  const valueDefault = (id: string, atYearEnd: number) => {
    const line = model.interest.find(l => l.accountId === id && !l.done);
    const credited = line ? parseFrenchNumber(creditedOf(id, line.computed)) ?? 0 : 0;
    return toInputAmount(Math.round((atYearEnd + credited) * 100) / 100);
  };
  const stepItem = (s: YearClosingStep, key: string) => s.items.find(i => i.key === key);

  // --- Étapes saisies dans la feuille ---
  const balancesBody = (s: YearClosingStep) => (
    <ul className="mt-2 divide-y divide-outline-variant" aria-label={s.title}>
      {model.balances.map(l => {
        const unchanged = drafts.unchanged.includes(l.accountId);
        return (
          <Line key={l.accountId} name={l.name} done={l.done} status={stepItem(s, l.accountId)?.detail}>
            <div className="flex items-end gap-3">
              <TextField className="flex-1 min-w-0" label="Solde au 31 décembre" aria-label={`Solde au 31 décembre, ${l.name}`} suffix="€" inputMode="decimal"
                value={drafts.values[l.accountId] ?? valueDefault(l.accountId, l.atYearEnd)} onChange={e => edit('values', l.accountId, e.target.value)} />
              {!l.done && (
                <label className="flex items-center gap-2 h-14 text-sm text-on-surface cursor-pointer shrink-0">
                  <input type="checkbox" className="w-5 h-5 accent-primary" checked={unchanged} onChange={e => toggleUnchanged(l.accountId, e.target.checked)}
                    aria-label={`Inchangé, ${l.name}`} />
                  Inchangé
                </label>
              )}
            </div>
          </Line>
        );
      })}
    </ul>
  );

  const interestBody = (s: YearClosingStep) => (
    <ul className="mt-2 divide-y divide-outline-variant" aria-label={s.title}>
      {model.interest.map(l => {
        if (l.done) return <Line key={l.accountId} name={l.name} done status={`${eur2(l.computed)} : enregistrés`} />;
        const text = creditedOf(l.accountId, l.computed);
        const credited = parseFrenchNumber(text);
        const gap = credited !== null && credited >= 0 ? interestGap(l.computed, credited) : null;
        return (
          <Line key={l.accountId} name={l.name} done={false}>
            <p className="text-sm text-on-surface-variant">Calculé par Pécule : <span className="font-medium text-on-surface tabular-nums">{eur2(l.computed)}</span></p>
            <TextField label="Crédité par la banque" aria-label={`Crédité par la banque, ${l.name}`} suffix="€" inputMode="decimal" value={text}
              error={credited === null || credited < 0 ? 'Montant non reconnu (exemple : 168,40)' : undefined}
              onChange={e => edit('credited', l.accountId, e.target.value)} />
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
            <TextField label="Valeur au 31 décembre" aria-label={`Valeur au 31 décembre, ${l.name}`} suffix="€" inputMode="decimal"
              value={drafts.values[l.accountId] ?? toInputAmount(l.atYearEnd)} onChange={e => edit('values', l.accountId, e.target.value)} />
            {l.depositsOfYear !== undefined && (
              <TextField label={`Versements ${year}`} aria-label={`Versements ${year}, ${l.name}`} suffix="€" inputMode="decimal"
                value={drafts.deposits[l.accountId] ?? toInputAmount(l.depositsOfYear)} onChange={e => edit('deposits', l.accountId, e.target.value)} />
            )}
          </div>
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

  const goalBody = () => (
    <TextField className="mt-3" label={`Objectif ${model.goal.year}`} aria-label={`Objectif ${model.goal.year}`} suffix="€" inputMode="decimal"
      value={goalText} onChange={e => { setError(null); setGoalText(e.target.value); }}
      error={goal === undefined ? 'Montant non reconnu (exemple : 9 000)' : undefined}
      supporting={model.goal.current === undefined
        ? `Prérempli avec ce que vous avez mis de côté en ${year} (${eur0(model.goal.suggested)}). Il s'affichera sur l'Accueil.`
        : `Mis de côté en ${year} : ${eur0(model.goal.suggested)}. Vide : pas d'objectif.`} />
  );

  // Textes des étapes saisies ici (la liste renvoie vers Actualiser).
  const detailOf = (s: YearClosingStep): string => {
    if (s.done) return s.detail;
    switch (s.id) {
      case 'balances': return 'Comparez avec votre banque et corrigez au besoin. Même sans changement, cochez « Inchangé » : le solde est noté comme vérifié.';
      case 'interest': return 'Ces comptes ont reçu leurs intérêts le 31 décembre. Saisissez ce que la banque a crédité : Pécule les compte hors épargne.';
      case 'statements': return `Reportez la valeur au 31 décembre et les versements de chaque relevé : les plus-values restent justes.${model.statements.some(l => l.rate) ? ` Le taux servi ${year} du fonds euros est publié par l'assureur en janvier.` : ''}`;
      default: return s.detail;
    }
  };
  const INLINE = new Set(['balances', 'interest', 'statements']);

  const renderStep = (s: YearClosingStep, index: number) => {
    const inline = INLINE.has(s.id);
    const buttons = inline ? [] : s.id === 'restitution' && model.restitution
      ? [{ label: 'Préparer la restitution', action: { type: 'navigate', view: 'parental' } } as YearClosingButton]
      : s.buttons;
    return (
      <li key={s.id} className="py-4 first:pt-2 flex gap-3" data-step={s.id}>
        <StepStatus done={s.done} />
        <div className="min-w-0 flex-1">
          <h4 className="text-sm font-medium text-on-surface">{index + 1}. {s.title}</h4>
          <p className="mt-0.5 text-sm text-on-surface-variant">{detailOf(s)}</p>
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
                  <span className="text-on-surface-variant">· {it.detail}</span>
                  {it.button && <span className="ml-auto">{button(it.button, 'text')}</span>}
                </li>
              ))}
            </ul>
          )}
          {(buttons.length > 0 || s.check) && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {buttons.map((b, i) => button(b, s.id === 'close' && !closing.closedOn ? 'filled' : i === 0 && !s.done ? 'tonal' : 'outlined', `${s.id}-${i}`))}
              {s.check && (
                <label className="flex items-center gap-2 min-h-12 px-2 text-sm text-on-surface cursor-pointer">
                  <input
                    type="checkbox" className="w-5 h-5 shrink-0 accent-primary" checked={s.check.checked}
                    onChange={e => onPatchConfig({ yearClosings: setClosingCheck(closings, year, s.check!.key, e.target.checked) })}
                  />
                  {s.check.label}
                </label>
              )}
            </div>
          )}
          {s.id === 'review' && goalBody()}
        </div>
      </li>
    );
  };

  const title = `Clôture de l'année ${year}`;
  const summary = closing.closedOn
    ? 'Année clôturée : plus de rappel de clôture.'
    : `${closing.done} étape${closing.done > 1 ? 's' : ''} sur ${closing.total} faite${closing.done > 1 ? 's' : ''}`;

  return (
    <Modal open onClose={onClose} label={title} variant="page" closeOnScrim={false} className="sm:max-w-xl p-0">
      <div className="px-4 sm:px-6 pt-4 sm:pt-6">
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-xl font-normal text-on-surface flex items-center gap-2">
            <CalendarCheck className="w-5 h-5 shrink-0 text-primary" aria-hidden="true" /> {title}
          </h2>
          <IconButton icon={X} label="Fermer" onClick={onClose} className="-mr-3 -mt-2" />
        </div>
        <p className="mt-1 text-sm text-on-surface-variant" aria-live="polite">{summary}</p>
        {!closing.closedOn && closing.total > 0 && (
          <div className="mt-3 h-1.5 rounded-full bg-surface-container-highest overflow-hidden" aria-hidden="true">
            <div className="h-full bg-primary rounded-full" style={{ width: `${Math.round((closing.done / closing.total) * 100)}%` }} />
          </div>
        )}
        <ol aria-label={`Étapes de la clôture ${year}`} className="mt-2 divide-y divide-outline-variant">
          {closing.steps.map(renderStep)}
        </ol>
      </div>
      <div className="sticky bottom-0 px-4 sm:px-6 py-3 border-t border-outline-variant bg-surface-container-high">
        {error && <p role="alert" className="mb-3 bg-error-container text-on-error-container p-3 rounded-xl text-sm font-medium">{error}</p>}
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-on-surface-variant">Soldes, intérêts, relevés et objectif : enregistrés ensemble.</p>
          <Button onClick={save} disabled={!somethingToSave} className="max-sm:h-12 shrink-0">
            <Check className="w-4 h-4" aria-hidden="true" /> Enregistrer
          </Button>
        </div>
      </div>
    </Modal>
  );
};
