// ================================================
// FILE: src/components/PayChecklist.tsx
// Carte « Ma paie », en tête de Pilotage › Ce mois : ce que devient la paie, en trois états.
//  1. Avant la paie : « Paie attendue vers le 27 novembre · environ 2 000 € », la barre du
//     plan habituel (virements fixes, épargne, épargne projets, plaisir) et « J'ai reçu ma
//     paie », qui ouvre le rituel (pilot/PayReceivedSheet, chargé à la demande). Rien à cocher :
//     le rituel est la seule porte.
//  2. Paie déclarée : la paie reçue, la barre de cette paie, « 3/7 faits » et la liste « À
//     faire » (seulement les lignes restantes, dans l'ordre des virements) ; « Modifier la
//     paie » et « Autre argent reçu » (versement en plus, même rituel).
//  3. Tout est fait : ce qui a été placé, ce qui reste sur le compte courant, « Voir le détail ».
// Cocher une ligne d'épargne ENREGISTRE le versement sur le compte (montant modifiable si le
// virement réel diffère du plan) ; la décocher l'annule. La ligne Plaisir n'est pas une case :
// rien à virer, c'est ce qui reste sur le compte courant. « Comment c'est calculé » est le seul
// texte d'explication (règle des 2/3 comprise).
// ================================================
import React, { Suspense, useCallback, useEffect, useId, useState } from 'react';
import { PayChecklist as PayChecklistData, PayChecklistLine, PayRecord, SavingsAccount } from '../types';
import { PAY_LEISURE_LINE, PlacementStep, buildPayLines, isPayTodoLine, payPeriodOf } from '../lib/finance';
import { currentSavingsMonth, savingsMonthOfPay, validPayday, type PayCalendarData } from '../lib/payCalendar';
import { formatISODay, parseISODate } from '../lib/dates';
import { elideDe, formatEUR, formatMonth, frenchDay, toInputAmount } from '../lib/format';
import { parseFrenchNumber } from '../lib/numbers';
import { round2 } from '../lib/money';
import { Info, CheckCircle2, RotateCcw, Wallet, PenLine, Plus, Sigma, ListChecks } from 'lucide-react';
import { Button, Card, MoneyText } from './ui';
import { allocationSentence, payBalanceBefore, type PayAllocation, type PayDistribution } from '../lib/payDistribution';
import { barDecimals, howItsComputed, livePayBar, payBarParts, payRuleSentence, placementReason, planSentence, savingsNoteOf, type PayBarKey } from '../lib/pilotView';
import { findMovement } from '../lib/payRecords';
import { lazyWithRetry } from './ErrorBoundary';
import { OPEN_PAY_SHEET_EVENT, takePaySheetRequest } from './pilot/paySheetRequest';
import { PayBar } from './pilot/PayBar';
import { Disclosure } from './pilot/Disclosure';
import { BudgetWaterfall } from './pilot/BudgetWaterfall';
import type { PayRitualProps } from './pilot/PayReceivedSheet';

// Le rituel n'est chargé qu'à l'ouverture : le Pilotage reste léger.
const PayReceivedSheet = lazyWithRetry(() => import('./pilot/PayReceivedSheet'));

const PROJECTS_LINE = 't:projects';

/** Groupe d'une ligne, dans l'ordre des virements : fixes, épargne, projets, plaisir. */
const groupOf = (l: PayChecklistLine): PayBarKey =>
  l.kind === 'saving' ? 'savings' : l.key === PROJECTS_LINE ? 'projects' : l.key === PAY_LEISURE_LINE ? 'leisure' : 'fixed';
const GROUP_RANK: Record<PayBarKey, number> = { fixed: 0, savings: 1, projects: 2, leisure: 3 };

interface PayChecklistProps {
  /** Plan de la paie habituelle (lib/payDistribution, allocatePay, sans reste du mois dernier). */
  plan: PayAllocation;
  /** Comptes du plan habituel : leurs conseils (ouvrir un LDDS…) s'affichent avant la paie. */
  planSteps?: PlacementStep[];
  /** Libellé de la paie dans « Comment c'est calculé » (fiche de paie de référence ou estimation). */
  payLabel?: string;
  /** Paie déclarée du mois d'épargne en cours (lib/payRecords, openPay). */
  pay?: PayRecord;
  /** Répartition conseillée pour la paie déclarée (recommendPayDistribution). */
  received?: PayDistribution;
  /** Comptes : nom et date des versements faits (« Voir le détail »). */
  accounts?: Pick<SavingsAccount, 'id' | 'name' | 'movements'>[];
  checklist?: PayChecklistData;
  // Coche une ligne (commande checkPayLine : fige `lines` et enregistre le versement d'une
  // ligne d'épargne) ; false si c'est refusé.
  onCheck: (lines: PayChecklistLine[], line: PayChecklistLine, amount: number, alreadyRecorded: boolean) => boolean;
  // Décoche une ligne et annule son versement (commande uncheckPayLine).
  onUncheck: (line: PayChecklistLine) => void;
  // « Recalculer le plan » : défige la liste (rien n'est coché).
  onReset: () => void;
  paydayDay?: number;          // la liste suit la paie, pas le mois calendaire
  payCalendar?: Omit<PayCalendarData, 'paydayDay'>; // fiches et paies déclarées (même fenêtre que l'Accueil)
  /** Le rituel « J'ai reçu ma paie » (absent : pas de bouton). */
  ritual?: PayRitualProps;
}

const sameYear = (iso: string, today: string) => iso.slice(0, 4) === today.slice(0, 4);
const dayLabel = (iso: string, today: string) => `${frenchDay(parseISODate(iso))}${sameYear(iso, today) ? '' : ` ${iso.slice(0, 4)}`}`;

export const PayChecklist: React.FC<PayChecklistProps> = ({
  plan, planSteps = [], payLabel, pay, received, accounts = [], checklist, onCheck, onUncheck, onReset, paydayDay, payCalendar, ritual,
}) => {
  const now = new Date();
  const today = formatISODay(now);
  const period = payPeriodOf(paydayDay, now, payCalendar);
  const month = period.key;
  const payWindow = currentSavingsMonth({ ...payCalendar, paydayDay }, today);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const idBase = useId();
  // Rituel ouvert : nouvelle paie (ou versement en plus), ou paie déclarée à modifier.
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

  const declared = !!pay && !!received;
  const frozen = declared && checklist && checklist.month === month ? checklist : undefined;
  const lines = !declared ? [] : frozen ? frozen.lines : buildPayLines(received!.transfers, received!.steps);
  const done = frozen?.done ?? {};
  // La ligne Plaisir n'est pas une case : seules les autres comptent dans « 3/7 faits ».
  const checkable = lines.filter(isPayTodoLine)
    .map((l, i) => ({ l, i })).sort((a, b) => GROUP_RANK[groupOf(a.l)] - GROUP_RANK[groupOf(b.l)] || a.i - b.i).map(x => x.l);
  const todo = checkable.filter(l => !done[l.key]);
  const doneLines = checkable.filter(l => done[l.key]);
  const allDone = declared && checkable.length > 0 && todo.length === 0;

  const allocation = received?.allocation ?? plan;
  // La barre : le plan habituel, ou la paie reçue avec ce qui est fait (montant réel) ou prévu ;
  // le plaisir est ce qui reste de l'argent à répartir.
  const bar = (() => {
    const advised = payBarParts(allocation);
    if (!declared) return advised;
    const valueOf = (l: PayChecklistLine) => done[l.key]?.amount ?? l.amount;
    const sumOf = (key: PayBarKey) => round2(lines.filter(l => groupOf(l) === key).reduce((s, l) => s + valueOf(l), 0));
    const fixed = sumOf('fixed');
    const savings = sumOf('savings');
    const projects = sumOf('projects');
    return livePayBar(advised, { fixed, savings, projects, leisure: round2(allocation.available - fixed - savings - projects) });
  })();
  const leisureLeft = bar.parts.find(p => p.key === 'leisure')?.amount ?? 0;
  const savingsPart = bar.parts.find(p => p.key === 'savings')?.amount ?? 0;
  const decimals = barDecimals(bar);
  // « dont prime 500 € » tant que l'épargne faite ou prévue tient l'épargne conseillée.
  const savingsNote = savingsPart >= allocation.savings - 0.005 ? savingsNoteOf(allocation) : undefined;
  const steps = declared ? (frozen ? [] : received!.steps) : planSteps;
  const suggestions = steps.filter(st => st.alert && st.hint);
  // Tout est fait : la ligne d'en-tête dit déjà ce qui est placé et ce qui reste.
  const cutSentence = allDone ? undefined : allocationSentence(allocation);

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
    if (l.kind !== 'saving' || !received) return undefined;
    const step = received.steps.find(st => !st.alert && st.accountId === l.accountId);
    return step ? placementReason(step, received.customSplit) : undefined;
  };

  /** « sur Livret A · le 27 octobre » : compte réellement crédité et date du versement. */
  const doneWhere = (l: PayChecklistLine) => {
    const entry = done[l.key];
    if (!entry || l.kind !== 'saving') return undefined;
    const accountId = entry.accountId ?? l.accountId;
    const name = accounts.find(a => a.id === accountId)?.name;
    const date = entry.movementId ? findMovement(accounts, entry.movementId)?.movement.date : undefined;
    return [name && name !== l.label ? `sur ${name}` : undefined, date ? `le ${dayLabel(date, today)}` : undefined].filter(Boolean).join(' · ') || undefined;
  };

  const renderLine = (l: PayChecklistLine & { detail?: string }) => {
    const entry = done[l.key];
    const isDone = !!entry;
    const varied = isDone && Math.abs(entry.amount - l.amount) >= 0.005;
    const invalid = !isDone && draftAmount(l) === null;
    const reason = isDone ? doneWhere(l) : reasonFor(l);
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

  const progress = declared && checkable.length > 0 && (
    <span className={`inline-flex items-center gap-1 h-7 px-2.5 rounded-sm text-xs font-medium tabular-nums ${allDone ? 'bg-primary-container text-on-primary-container' : 'bg-secondary-container text-on-secondary-container'}`}>
      {allDone ? <><CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" /> Tout est fait</> : `${doneLines.length}/${checkable.length} faits`}
    </span>
  );
  // Paie attendue (pas encore déclarée) : date du jour de paie, sinon rien à annoncer.
  const expectedOn = validPayday(paydayDay) !== undefined && payWindow.source !== 'received' ? payWindow.start : undefined;
  const savingsMonth = pay ? savingsMonthOfPay(pay) : payWindow.key;
  const monthName = formatMonth(savingsMonth, !sameYear(`${savingsMonth}-01`, today));
  const before = payBalanceBefore(pay);

  const headline = !declared ? (
    <>{expectedOn ? `Paie attendue vers le ${dayLabel(expectedOn, today)}` : 'Paie pas encore déclarée'} · environ <MoneyText value={plan.expectedPay} decimals={0} /></>
  ) : allDone ? (
    <>Tout est fait · <MoneyText value={savingsPart} decimals={decimals} /> placés · le compte courant démarre à <MoneyText value={leisureLeft} decimals={decimals} /></>
  ) : (
    <>
      Paie reçue le {dayLabel(pay!.receivedOn, today)} : <MoneyText value={pay!.amount} />
      {before > 0 && <> + <MoneyText value={before} /> déjà sur le compte</>}
      {before < 0 && <> · découvert de <MoneyText value={-before} /> avant la paie</>}
      {' · '}Épargne {elideDe(monthName)}
    </>
  );

  return (
    <Card id="pay-checklist" title="Ma paie" icon={Wallet} action={progress}>
      <p className="text-sm text-on-surface -mt-1">{headline}</p>
      <PayBar bar={bar} decimals={decimals} notes={{ savings: savingsNote }} className="mt-4" />
      {cutSentence && <p className="mt-3 text-sm text-on-surface-variant max-w-2xl">{cutSentence}</p>}
      {suggestions.length > 0 && (
        <div className="mt-3 space-y-2">
          {suggestions.map(st => (
            <p key={st.accountName} className="text-sm text-on-tertiary-container bg-tertiary-container rounded-xl p-3 flex items-start gap-2">
              <Info className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />{st.hint}
            </p>
          ))}
        </div>
      )}

      {declared && todo.length > 0 && (
        <section aria-labelledby={`${idBase}-todo`} className="mt-5">
          <h4 id={`${idBase}-todo`} className="text-sm font-medium text-on-surface border-b border-outline-variant pb-2">À faire</h4>
          <ul className="divide-y divide-outline-variant">
            {todo.map(renderLine)}
          </ul>
          <p className="text-xs text-on-surface-variant mt-1">Cochez chaque virement une fois fait ; si le montant réel diffère, corrigez-le avant de cocher.</p>
        </section>
      )}

      {declared && doneLines.length > 0 && (
        <div className="mt-3">
          <Disclosure appearance="inline" headingLevel={4} title="Voir le détail" icon={ListChecks}
            summary={`${doneLines.length} ${doneLines.length > 1 ? 'lignes faites' : 'ligne faite'}`}>
            <ul className="divide-y divide-outline-variant">
              {doneLines.map(renderLine)}
            </ul>
          </Disclosure>
        </div>
      )}

      {frozen && doneLines.length === 0 && (
        <Button variant="text" onClick={onReset} className="mt-2 -ml-3 max-sm:h-12">
          <RotateCcw className="w-4 h-4" aria-hidden="true" /> Recalculer le plan sur les soldes actuels
        </Button>
      )}
      {frozen && doneLines.length > 0 && !allDone && (
        <p className="mt-2 text-xs text-on-surface-variant">Plan figé pour l'épargne {elideDe(monthName)} depuis le premier virement coché. Il repartira des soldes du moment à la prochaine paie.</p>
      )}

      <div className="mt-3">
        <Disclosure appearance="inline" headingLevel={4} title="Comment c'est calculé" icon={Sigma}>
          <p className="text-sm text-on-surface-variant mb-2">{planSentence(allocation)}</p>
          <BudgetWaterfall rows={howItsComputed(allocation, payLabel)} />
          <p className="mt-3 text-sm text-on-surface-variant">{payRuleSentence(allocation)}</p>
          <p className="mt-2 text-xs text-on-surface-variant">Ces montants se règlent dans « Réglages de la paie », plus bas.</p>
        </Disclosure>
      </div>

      {ritual && (
        <div className="mt-4 flex flex-wrap gap-2">
          {declared ? (
            <>
              <Button variant="outlined" onClick={() => setSheet({ editPayId: pay!.id })} className="max-sm:h-12"><PenLine className="w-4 h-4" aria-hidden="true" /> Modifier la paie</Button>
              <Button variant="text" onClick={() => setSheet({})} className="max-sm:h-12"><Plus className="w-4 h-4" aria-hidden="true" /> Autre argent reçu</Button>
            </>
          ) : (
            <Button onClick={() => setSheet({})} className="max-sm:h-12"><Wallet className="w-4 h-4" aria-hidden="true" /> J'ai reçu ma paie</Button>
          )}
        </div>
      )}

      {sheet && ritual && (
        <Suspense fallback={null}>
          <PayReceivedSheet {...ritual} editPayId={sheet.editPayId} onClose={() => setSheet(null)} />
        </Suspense>
      )}
    </Card>
  );
};
