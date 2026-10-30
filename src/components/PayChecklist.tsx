// ================================================
// FILE: src/components/PayChecklist.tsx
// Carte « Ma paie », en tête du Pilotage budgétaire : la paie du mois d'épargne en cours.
//  - Pas encore déclarée : la paie attendue et l'estimation de ce qu'il y aura à placer
//    (l'ancien en-tête « À placer ce mois »), et « J'ai reçu ma paie », qui ouvre le rituel
//    (pilot/PayReceivedSheet, chargé à la demande).
//  - Déclarée : la paie reçue, son mois d'épargne, ce qu'il y a à placer, « 3/5 faits » et
//    « Modifier la paie ».
// Dans les deux cas, la répartition se coche ligne à ligne. Cocher une ligne d'épargne
// ENREGISTRE le versement sur le compte (montant modifiable si le virement réel diffère du
// plan) ; la décocher l'annule. Le plan est figé au premier virement coché : sinon, chaque
// versement enregistré modifierait les soldes, donc le plan lui-même.
// ================================================
import React, { Suspense, useCallback, useEffect, useId, useState } from 'react';
import { PayChecklist as PayChecklistData, PayChecklistLine, PayRecord } from '../types';
import { PayTransfer, PlacementStep, buildPayLines, payPeriodOf } from '../lib/finance';
import { currentSavingsMonth, savingsMonthOfPay, validPayday, type PayCalendarData } from '../lib/payCalendar';
import { formatISODay, parseISODate } from '../lib/dates';
import { elideDe, formatEUR, formatMonth, frenchDay, toInputAmount } from '../lib/format';
import { parseFrenchNumber } from '../lib/numbers';
import { Info, CheckCircle2, RotateCcw, Wallet, ArrowRightLeft, PiggyBank, PenLine, Plus } from 'lucide-react';
import { Button, Card, MoneyText, StatTile } from './ui';
import { placementReason } from '../lib/pilotView';
import { lazyWithRetry } from './ErrorBoundary';
import { OPEN_PAY_SHEET_EVENT, takePaySheetRequest } from './pilot/paySheetRequest';
import type { PayRitualProps } from './pilot/PayReceivedSheet';

// Le rituel n'est chargé qu'à l'ouverture : le Pilotage reste léger.
const PayReceivedSheet = lazyWithRetry(() => import('./pilot/PayReceivedSheet'));

/** L'estimation, tant que la paie n'est pas déclarée (Mes paramètres). */
export interface PayEstimate {
  pay: number;
  spending: number;
  toSave: number;
  /** La phrase qui explique le montant (pilotView.heroContext). */
  sentence: string;
  /** Même précision pour les trois montants : « paie − dépenses = à placer » tombe juste. */
  decimals: 0 | 2;
  payLabel?: string;
}

interface PayChecklistProps {
  estimate: PayEstimate;
  /** Paie déclarée du mois d'épargne en cours (lib/payRecords, openPay). */
  pay?: PayRecord;
  transfers: PayTransfer[];
  steps: PlacementStep[];
  /** À placer : estimation, ou répartition conseillée pour la paie reçue. */
  totalToInvest: number;
  shortfall: number; // > 0 : les virements dépassent la paie
  checklist?: PayChecklistData;
  // Coche une ligne (commande recordPay : la paie du mois d'épargne, créée au besoin, fige
  // `lines` et enregistre le versement d'une ligne d'épargne) ; false si c'est refusé.
  onCheck: (lines: PayChecklistLine[], line: PayChecklistLine, amount: number, alreadyRecorded: boolean) => boolean;
  // Décoche une ligne et annule son versement (commande uncheckPayLine).
  onUncheck: (line: PayChecklistLine) => void;
  // « Recalculer le plan » : défige la liste (rien n'est coché).
  onReset: () => void;
  customSplit?: boolean;       // répartition personnalisée : change le « pourquoi » de chaque compte
  paydayDay?: number;          // la liste suit la paie, pas le mois calendaire
  payCalendar?: Omit<PayCalendarData, 'paydayDay'>; // fiches et paies déclarées (même fenêtre que l'Accueil)
  /** Le rituel « J'ai reçu ma paie » (absent : pas de bouton, la liste seule). */
  ritual?: PayRitualProps;
}

const sameYear = (iso: string, today: string) => iso.slice(0, 4) === today.slice(0, 4);
const dayLabel = (iso: string, today: string) => `${frenchDay(parseISODate(iso))}${sameYear(iso, today) ? '' : ` ${iso.slice(0, 4)}`}`;

export const PayChecklist: React.FC<PayChecklistProps> = ({
  estimate, pay, transfers, steps, totalToInvest, shortfall, checklist, onCheck, onUncheck, onReset, paydayDay, payCalendar, customSplit = false, ritual,
}) => {
  const now = new Date();
  const today = formatISODay(now);
  const period = payPeriodOf(paydayDay, now, payCalendar);
  const month = period.key;
  const payWindow = currentSavingsMonth({ ...payCalendar, paydayDay }, today);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const idBase = useId();
  // Rituel ouvert : nouvelle paie, ou paie déclarée à modifier.
  const [sheet, setSheet] = useState<{ editPayId?: string } | null>(null);

  // Lien direct (`?action=pay`, notification, routine) : la feuille s'ouvre d'elle-même,
  // sur la paie déclarée s'il y en a une (pour finir ses virements), sinon sur une nouvelle.
  const openFromRequest = useCallback(() => {
    if (!ritual || !takePaySheetRequest()) return;
    setSheet(pay ? { editPayId: pay.id } : {});
  }, [ritual, pay]);
  useEffect(() => {
    openFromRequest();
    window.addEventListener(OPEN_PAY_SHEET_EVENT, openFromRequest);
    return () => window.removeEventListener(OPEN_PAY_SHEET_EVENT, openFromRequest);
  }, [openFromRequest]);

  const liveLines = buildPayLines(transfers, steps);
  const suggestions = steps.filter(st => st.alert && st.hint);

  const frozen = checklist && checklist.month === month ? checklist : undefined;
  const lines = frozen ? frozen.lines : liveLines;
  const done = frozen?.done ?? {};
  const doneCount = lines.filter(l => done[l.key]).length;
  const transferLines = lines.filter(l => l.kind === 'transfer');
  const savingLines = lines.filter(l => l.kind === 'saving');

  const draftAmount = (l: PayChecklistLine) => {
    const raw = drafts[l.key];
    if (raw === undefined) return l.amount;
    const v = parseFrenchNumber(raw);
    return v !== null && v >= 0 ? v : null;
  };

  // `alreadyRecorded` : le versement a déjà été saisi ailleurs (Actualiser, ajout rapide…) ;
  // on le marque fait, avec son vrai montant, sans l'enregistrer une seconde fois.
  const check = (l: PayChecklistLine, alreadyRecorded = false) => {
    const amount = draftAmount(l);
    if (amount === null) return;
    // Compte supprimé depuis (ou versement refusé) : la commande refuse, la ligne reste à faire.
    onCheck(lines, l, amount, alreadyRecorded);
  };

  const uncheck = (l: PayChecklistLine) => {
    if (!frozen) return;
    const entry = frozen.done[l.key];
    onUncheck(l);
    setDrafts(d => ({ ...d, [l.key]: toInputAmount(entry?.amount ?? l.amount) }));
  };

  const reasonFor = (l: PayChecklistLine) => {
    if (l.kind !== 'saving') return undefined;
    const step = steps.find(st => !st.alert && st.accountId === l.accountId);
    return step ? placementReason(step, customSplit) : undefined;
  };

  const renderLine = (l: PayChecklistLine & { detail?: string }) => {
    const entry = done[l.key];
    const isDone = !!entry;
    const varied = isDone && Math.abs(entry.amount - l.amount) >= 0.005;
    const invalid = !isDone && draftAmount(l) === null;
    const reason = reasonFor(l);
    // « Livret A · Livret A · 1,7 % » : le type répète souvent le nom du compte.
    const detail = l.detail === l.label ? undefined : l.detail?.startsWith(`${l.label} · `) ? l.detail.slice(l.label.length + 3) : l.detail;
    const status = isDone
      ? `${entry.alreadyRecorded ? 'Déjà enregistré' : l.kind === 'saving' ? 'Versement enregistré' : 'Fait'}${varied ? ` : ${formatEUR(entry.amount)} (prévu ${formatEUR(l.amount)})` : ''}`
      : (l.kind === 'saving' ? 'Cocher enregistre le versement sur le compte' : 'À faire');
    const statusId = `${idBase}-${l.key.replace(/\s/g, '_')}`;
    return (
      <li key={l.key} className="py-1">
        <div className="flex items-start gap-2">
          {/* Toute la ligne (case, nom, raison) se coche : une cible d'au moins 48 px de haut. */}
          <label className="flex-1 min-w-0 flex items-start gap-3 min-h-12 py-2 pl-2 -ml-2 pr-1 rounded-xl cursor-pointer hover:bg-on-surface/8 has-disabled:cursor-not-allowed">
            <input
              type="checkbox"
              checked={isDone}
              disabled={invalid}
              onChange={() => (isDone ? uncheck(l) : check(l))}
              aria-label={l.label}
              aria-describedby={statusId}
              className="mt-0.5 w-5 h-5 shrink-0 accent-primary cursor-pointer disabled:cursor-not-allowed"
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-on-surface break-words">
                {l.label}
                {detail && <span className="ml-2 text-xs font-normal text-on-surface-variant">{detail}</span>}
              </span>
              {reason && <span className="block text-xs text-on-surface-variant mt-0.5">{reason}</span>}
              {/* État de la ligne, juste sous son nom (relié à la case par aria-describedby). */}
              <span id={statusId} className={`mt-0.5 text-xs flex flex-wrap items-center gap-x-1.5 ${isDone ? 'text-primary' : invalid ? 'text-error' : 'text-on-surface-variant'}`}>
                {isDone && <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />}
                {invalid ? 'Montant non reconnu : corrigez-le pour pouvoir cocher' : status}
              </span>
            </span>
          </label>
          {isDone ? (
            <MoneyText value={entry.amount} className="shrink-0 text-sm font-medium text-on-surface pt-2.5" />
          ) : (
            <label className="flex items-center gap-1 shrink-0">
              <span className="sr-only">Montant réel {elideDe(l.label)}</span>
              <input
                type="text"
                inputMode="decimal"
                value={drafts[l.key] ?? toInputAmount(l.amount)}
                onChange={e => setDrafts(d => ({ ...d, [l.key]: e.target.value }))}
                onKeyDown={e => { if (e.key === 'Enter') check(l); }}
                aria-invalid={invalid || undefined}
                className="w-24 h-12 sm:h-10 px-2 text-right text-sm tabular-nums font-medium rounded-xs bg-transparent border border-outline text-on-surface hover:border-on-surface focus:border-primary focus:border-2 outline-none aria-[invalid=true]:border-error aria-[invalid=true]:border-2"
              />
              <span className="text-sm text-on-surface-variant" aria-hidden="true">€</span>
            </label>
          )}
        </div>
        {/* Hors du <label> : un bouton ne se place pas dans la zone qui coche la ligne. */}
        {!isDone && l.kind === 'saving' && !invalid && (
          <button type="button" onClick={() => check(l, true)} className="ml-6 -mt-1 px-2 min-h-12 sm:min-h-8 rounded-full text-xs font-medium text-primary hover:bg-primary/8">
            Déjà enregistré ?{' '}<span className="sr-only">({l.label} : cocher sans l'enregistrer une seconde fois)</span>
          </button>
        )}
      </li>
    );
  };

  const totalLines = lines.length;
  const savingTotal = frozen ? savingLines.reduce((s, l) => s + l.amount, 0) : totalToInvest;
  const transferTotal = transferLines.reduce((s, l) => s + l.amount, 0);
  const progress = totalLines > 0 && (
    <span className={`inline-flex items-center gap-1 h-7 px-2.5 rounded-sm text-xs font-medium tabular-nums ${doneCount === totalLines ? 'bg-primary-container text-on-primary-container' : 'bg-secondary-container text-on-secondary-container'}`}>
      {doneCount === totalLines ? <><CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" /> Tout est fait</> : `${doneCount}/${totalLines} faits`}
    </span>
  );
  const fmt = (n: number) => formatEUR(n, estimate.decimals);
  // Paie attendue (pas encore déclarée) : date du jour de paie, sinon rien à annoncer.
  const expectedOn = validPayday(paydayDay) !== undefined && payWindow.source !== 'received' ? payWindow.start : undefined;
  const savingsMonth = pay ? savingsMonthOfPay(pay) : payWindow.key;
  const monthName = formatMonth(savingsMonth, !sameYear(`${savingsMonth}-01`, today));

  return (
    <Card id="pay-checklist" title="Ma paie" icon={Wallet} action={progress}>
      {pay ? (
        // La paie déclarée : reçue quand, combien, pour quel mois d'épargne, et ce qu'il y a à placer.
        <section aria-label="Paie reçue" className="-mt-1 mb-6 rounded-3xl bg-secondary-container p-5 sm:p-6">
          <p className="text-sm text-on-secondary-container">
            Paie reçue le {dayLabel(pay.receivedOn, today)} : <MoneyText value={pay.amount} /> · Épargne {elideDe(monthName)}
          </p>
          <StatTile size="hero" className="mt-3" label="À placer sur cette paie" value={<MoneyText value={savingTotal} />} />
          {!!pay.bonus && <p className="mt-1 text-sm text-on-secondary-container">Dont prime placée en entier : <MoneyText value={pay.bonus} /></p>}
          {ritual && (
            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="outlined" onClick={() => setSheet({ editPayId: pay.id })} className="max-sm:h-12"><PenLine className="w-4 h-4" aria-hidden="true" /> Modifier la paie</Button>
              <Button variant="text" onClick={() => setSheet({})} className="max-sm:h-12"><Plus className="w-4 h-4" aria-hidden="true" /> Autre paie ou prime</Button>
            </div>
          )}
        </section>
      ) : (
        // La réponse avant la paie : combien placer, d'après l'estimation.
        <section aria-label="À placer ce mois" className="-mt-1 mb-6 rounded-3xl bg-secondary-container p-5 sm:p-6">
          <p className="text-sm text-on-secondary-container mb-3">
            {expectedOn ? `Paie attendue vers le ${dayLabel(expectedOn, today)}` : 'Paie pas encore déclarée'}
            {' · '}environ {fmt(estimate.pay)} · environ {fmt(estimate.toSave)} à placer
          </p>
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6">
            <StatTile size="hero" label="À placer ce mois" value={<MoneyText value={estimate.toSave} decimals={estimate.decimals} />} />
            {/* Une paire dt/dd par montant : le lecteur d'écran annonce chaque libellé avec sa valeur. */}
            <dl className="grid grid-cols-2 gap-x-8 gap-y-1 text-sm">
              <div>
                <dt className="text-on-surface-variant">{estimate.payLabel ?? 'Paie nette après impôt'}</dt>
                <dd className="text-lg text-on-surface"><MoneyText value={estimate.pay} decimals={estimate.decimals} /></dd>
              </div>
              <div>
                <dt className="text-on-surface-variant">Dépenses prévues</dt>
                <dd className="text-lg text-on-surface"><MoneyText value={estimate.spending} decimals={estimate.decimals} /></dd>
              </div>
            </dl>
          </div>
          <p className="mt-4 text-sm text-on-surface-variant max-w-2xl">{estimate.sentence}</p>
          {ritual && (
            <Button onClick={() => setSheet({})} className="mt-4 max-sm:h-12"><Wallet className="w-4 h-4" aria-hidden="true" /> J'ai reçu ma paie</Button>
          )}
        </section>
      )}

      <p className="text-sm text-on-surface-variant mb-4">
        {pay
          ? 'Cochez chaque virement une fois fait ; si le montant réel diffère, corrigez-le avant de cocher.'
          : 'Répartition prévue sur la paie estimée. Déclarez votre paie pour l\'adapter au montant reçu, ou cochez chaque virement une fois fait.'}
      </p>

      <div className="flex items-baseline justify-between gap-3 border-b border-outline-variant pb-2">
        <h4 className="text-sm font-medium text-on-surface flex items-center gap-2"><PiggyBank className="w-4 h-4 text-on-surface-variant" aria-hidden="true" /> Sur vos comptes d'épargne</h4>
        <MoneyText value={savingTotal} className="text-sm font-medium text-on-surface" />
      </div>
      <ul className="divide-y divide-outline-variant">
        {savingLines.map(renderLine)}
      </ul>
      {!frozen && suggestions.length > 0 && (
        <div className="mt-2 space-y-2">
          {suggestions.map(st => (
            <p key={st.accountName} className="text-sm text-on-tertiary-container bg-tertiary-container rounded-xl p-3 flex items-start gap-2">
              <Info className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />{st.hint}
            </p>
          ))}
        </div>
      )}
      {savingLines.length === 0 && suggestions.length === 0 && <p className="text-sm text-on-surface-variant py-3">Rien à placer ce mois-ci.</p>}

      {transferLines.length > 0 && (
        <>
          <div className="mt-6 flex items-baseline justify-between gap-3 border-b border-outline-variant pb-2">
            <h4 className="text-sm font-medium text-on-surface flex items-center gap-2"><ArrowRightLeft className="w-4 h-4 text-on-surface-variant" aria-hidden="true" /> Virements de la paie, déduits avant l'épargne</h4>
            <MoneyText value={transferTotal} className="text-sm font-medium text-on-surface" />
          </div>
          <ul className="divide-y divide-outline-variant">
            {transferLines.map(renderLine)}
          </ul>
          <p className="text-xs text-on-surface-variant mt-1">Ajoutez une charge fixe par virement sortant (ex. « Revolut commun »), sans détailler ce qu'elle paie.</p>
        </>
      )}

      {shortfall > 0 && (
        <p role="status" className="mt-4 text-sm font-medium text-error flex items-center gap-2"><Info className="w-4 h-4 shrink-0" aria-hidden="true" /> Il manque {formatEUR(shortfall)} : les virements et l'épargne prévus dépassent la paie.</p>
      )}
      {frozen && doneCount === 0 && (
        <Button variant="text" onClick={onReset} className="mt-4 -ml-3 max-sm:h-12">
          <RotateCcw className="w-4 h-4" aria-hidden="true" /> Recalculer le plan sur les soldes actuels
        </Button>
      )}
      {frozen && doneCount > 0 && (
        <p className="mt-4 text-xs text-on-surface-variant">Plan figé pour l'épargne {elideDe(monthName)} depuis le premier virement coché. Il repartira des soldes du moment à la prochaine paie.</p>
      )}

      {sheet && ritual && (
        <Suspense fallback={null}>
          <PayReceivedSheet {...ritual} editPayId={sheet.editPayId} onClose={() => setSheet(null)} />
        </Suspense>
      )}
    </Card>
  );
};
