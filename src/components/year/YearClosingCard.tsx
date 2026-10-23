// « Clôture de l'année » (Historique) : les étapes de lib/yearClosing dans l'ordre, chacune
// faite ou à faire d'après les données, ou cochée à la main. Ouverte d'office de janvier à fin
// février tant que l'année n'est pas clôturée ; repliée sinon. Aucun calcul ici : l'écran relie
// les actions nommées de la liste à la navigation, aux téléchargements et au fichier.
import React, { useMemo, useState } from 'react';
import { CalendarCheck, CheckCircle2, ChevronDown, Circle } from 'lucide-react';
import type { FiscalConfig, GlobalAppData, SavingsAccount } from '../../types';
import type { View } from '../../navigation';
import {
  addClosingChecks, buildYearClosing, closingApplies, closingYearOf, isClosingSeason, remainingSteps, setClosingCheck, setYearClosed,
  yearArchiveCsv, CLOSING_CHECKS, type YearClosingAction, type YearClosingButton, type YearClosingStep,
} from '../../lib/yearClosing';
import { applyTaxScale, confirmRatesUnchanged, findFiscalReview } from '../../lib/finance';
import { formatISODay } from '../../lib/dates';
import { downloadCsv, downloadJSON } from '../../services/fileDownload';
import { revealElementById } from '../revealElement';
import { Button } from '../ui';

export interface YearClosingCardProps {
  /** Données complètes (comptes, dons, restitution, réglages). */
  data: GlobalAppData;
  onPatchConfig: (patch: Partial<GlobalAppData['config']>) => void;
  /** « Taux inchangé » d'une assurance vie : noté sur le compte, comme depuis l'Accueil. */
  onUpdateAccounts: (update: (prev: SavingsAccount[]) => SavingsAccount[]) => void;
  /** Nouveau barème appliqué, paramètres fiscaux de l'année confirmés. */
  onUpdateFiscalConfig: (update: (prev: FiscalConfig) => FiscalConfig) => void;
  onNavigate: (view: View) => void;
  /** Ce qui part dans l'archive JSON : le fichier sans ce qui reste propre à l'appareil. */
  getArchiveData: () => GlobalAppData;
  confirm: (title: string, message: string, onConfirm: () => void, danger?: boolean, confirmLabel?: string) => void;
  /** Date du jour (tests). */
  now?: Date;
}

const StepStatus: React.FC<{ done: boolean; small?: boolean }> = ({ done, small }) => {
  const size = small ? 'w-4 h-4' : 'w-6 h-6';
  return done
    ? <><CheckCircle2 className={`${size} shrink-0 text-primary`} aria-hidden="true" /><span className="sr-only">Fait : </span></>
    : <><Circle className={`${size} shrink-0 text-outline`} aria-hidden="true" /><span className="sr-only">À faire : </span></>;
};

export const YearClosingCard: React.FC<YearClosingCardProps> = ({ data, onPatchConfig, onUpdateAccounts, onUpdateFiscalConfig, onNavigate, getArchiveData, confirm, now: nowProp }) => {
  const now = useMemo(() => nowProp ?? new Date(), [nowProp]);
  const year = closingYearOf(now);
  const closing = useMemo(() => buildYearClosing(data, year, now), [data, year, now]);
  const inSeason = isClosingSeason(now);
  const [open, setOpen] = useState(() => inSeason && !closing.closedOn);
  const closings = data.config?.yearClosings;
  const today = formatISODay(now);

  const run = (a: YearClosingAction) => {
    switch (a.type) {
      case 'navigate': onNavigate(a.view); break;
      // L'aide est en bas de l'écran « Dons et impôts » : on l'amène à l'écran.
      case 'show-tax-return': onNavigate('donations'); revealElementById('tax-return'); break;
      case 'open-review':
        // « Votre année » (même écran) ouvre sa feuille sur l'année demandée.
        window.dispatchEvent(new CustomEvent('pecule:open-year', { detail: year }));
        if (!closings?.[String(year)]?.checked?.includes(CLOSING_CHECKS.review)) onPatchConfig({ yearClosings: setClosingCheck(closings, year, CLOSING_CHECKS.review) });
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
      case 'confirm-rate': onUpdateAccounts(prev => confirmRatesUnchanged(prev, [a.accountId], today)); break;
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

  // Rien à clôturer (aucun compte suivi l'an dernier : tout premier usage) : pas de carte.
  if (!closingApplies(data, year)) return null;

  const summary = closing.closedOn
    ? 'Année clôturée : plus de rappel de clôture.'
    : `${closing.done} étape${closing.done > 1 ? 's' : ''} sur ${closing.total} faite${closing.done > 1 ? 's' : ''}`;

  const renderStep = (s: YearClosingStep, index: number) => (
    <li key={s.id} className="py-4 first:pt-2 flex gap-3" data-step={s.id}>
      <StepStatus done={s.done} />
      <div className="min-w-0 flex-1">
        <h4 className="text-sm font-medium text-on-surface">{index + 1}. {s.title}</h4>
        <p className="mt-0.5 text-sm text-on-surface-variant">{s.detail}</p>
        {s.items.length > 0 && (
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
        {(s.buttons.length > 0 || s.check) && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {s.buttons.map((b, i) => button(b, s.id === 'close' && !closing.closedOn ? 'filled' : i === 0 && !s.done ? 'tonal' : 'outlined', `${s.id}-${i}`))}
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
      </div>
    </li>
  );

  return (
    <section id="year-closing" aria-labelledby="year-closing-title" className="rounded-2xl p-5 sm:p-6 bg-surface-container-lowest dark:bg-surface-container-low border border-outline-variant text-on-surface">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id="year-closing-title" className="text-base font-medium flex items-center gap-2">
            <CalendarCheck className="w-5 h-5 shrink-0 text-primary" aria-hidden="true" /> Clôture de l'année {year}
          </h3>
          <p className="mt-1 text-sm text-on-surface-variant" aria-live="polite">{summary}</p>
        </div>
        <Button variant="text" className="max-sm:h-12" onClick={() => setOpen(o => !o)} aria-expanded={open} aria-controls="year-closing-steps">
          {open ? 'Masquer les étapes' : 'Voir les étapes'}
          <ChevronDown className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
        </Button>
      </div>
      {!closing.closedOn && closing.total > 0 && (
        <div className="mt-3 h-1.5 rounded-full bg-surface-container-highest overflow-hidden" aria-hidden="true">
          <div className="h-full bg-primary rounded-full" style={{ width: `${Math.round((closing.done / closing.total) * 100)}%` }} />
        </div>
      )}
      {open && (
        <ol id="year-closing-steps" aria-label={`Étapes de la clôture ${year}`} className="mt-2 divide-y divide-outline-variant">
          {closing.steps.map(renderStep)}
        </ol>
      )}
    </section>
  );
};
