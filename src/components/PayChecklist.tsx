// ================================================
// FILE: src/components/PayChecklist.tsx
// La paie du mois, virement par virement, à cocher au fur et à mesure. Cocher une ligne
// d'épargne ENREGISTRE le versement sur le compte (montant modifiable si le virement réel
// diffère du plan) ; la décocher l'annule. Le plan est figé au premier virement coché :
// sinon, chaque versement enregistré modifierait les soldes, donc le plan lui-même.
// ================================================
import React, { useId, useState } from 'react';
import { PayChecklist as PayChecklistData, PayChecklistLine } from '../types';
import { PayTransfer, PlacementStep, buildPayLines, payPeriodOf } from '../lib/finance';
import type { PayCalendarData } from '../lib/payCalendar';
import { elideDe, formatEUR, toInputAmount } from '../lib/format';
import { parseFrenchNumber } from '../lib/numbers';
import { Info, CheckCircle2, RotateCcw, PiggyBank, ArrowRightLeft } from 'lucide-react';
import { Button, Card, MoneyText } from './ui';
import { placementReason } from '../lib/pilotView';

interface PayChecklistProps {
  superNet: number;
  transfers: PayTransfer[];
  steps: PlacementStep[];
  totalToInvest: number;
  shortfall: number; // > 0 : les virements dépassent la paie
  checklist?: PayChecklistData;
  onChange: (next: PayChecklistData | undefined) => void;
  // Enregistre un versement réel sur un compte de l'app ; renvoie l'id du mouvement créé.
  onRecordDeposit: (accountId: string, amount: number) => string | undefined;
  onCancelDeposit: (accountId: string, movementId: string) => void;
  customSplit?: boolean;       // répartition personnalisée : change le « pourquoi » de chaque compte
  paydayDay?: number;          // la liste suit la paie, pas le mois calendaire
  payCalendar?: Omit<PayCalendarData, 'paydayDay'>; // fiches et paies déclarées (même fenêtre que l'Accueil)
}

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

export const PayChecklist: React.FC<PayChecklistProps> = ({
  superNet, transfers, steps, totalToInvest, shortfall, checklist, onChange, onRecordDeposit, onCancelDeposit, paydayDay, payCalendar, customSplit = false,
}) => {
  const now = new Date();
  const period = payPeriodOf(paydayDay, now, payCalendar);
  const month = period.key;
  // Mois de versement de la paie (la fiche d'une semaine avant le jour de paie peut ouvrir
  // la fenêtre le mois d'avant). La liste figée vit sur la paie déclarée (lib/payRecords).
  const periodLabel = MONTHS[Number(month.slice(5, 7)) - 1];
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const idBase = useId();

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
    const base: PayChecklistData = frozen ?? { month, lines: liveLines, done: {} };
    let movementId: string | undefined;
    if (!alreadyRecorded && l.kind === 'saving' && l.accountId && amount > 0) {
      movementId = onRecordDeposit(l.accountId, amount);
      // Compte supprimé depuis (ou versement refusé) : on ne coche pas un virement fantôme.
      if (!movementId) return;
    }
    onChange({ ...base, done: { ...base.done, [l.key]: { amount, movementId, alreadyRecorded: alreadyRecorded || undefined } } });
  };

  const uncheck = (l: PayChecklistLine) => {
    if (!frozen) return;
    const entry = frozen.done[l.key];
    if (entry?.movementId && l.accountId) onCancelDeposit(l.accountId, entry.movementId);
    const { [l.key]: _removed, ...rest } = frozen.done;
    onChange({ ...frozen, done: rest });
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
  return (
    <Card id="pay-checklist" title="Où le placer" icon={PiggyBank} action={progress}>
      <p className="text-sm text-on-surface-variant -mt-2 mb-4">
        Paie {elideDe(periodLabel)} : <MoneyText value={superNet} />. Cochez chaque virement une fois fait ; si le montant réel diffère, corrigez-le avant de cocher.
      </p>

      <div className="flex items-baseline justify-between gap-3 border-b border-outline-variant pb-2">
        <h4 className="text-sm font-medium text-on-surface">Sur vos comptes d'épargne</h4>
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
            <h4 className="text-sm font-medium text-on-surface flex items-center gap-2"><ArrowRightLeft className="w-4 h-4 text-on-surface-variant" aria-hidden="true" /> Avant l'épargne : les virements de la paie</h4>
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
        <Button variant="text" onClick={() => onChange(undefined)} className="mt-4 -ml-3 max-sm:h-12">
          <RotateCcw className="w-4 h-4" aria-hidden="true" /> Recalculer le plan sur les soldes actuels
        </Button>
      )}
      {frozen && doneCount > 0 && (
        <p className="mt-4 text-xs text-on-surface-variant">Plan figé pour la paie {elideDe(periodLabel)} depuis le premier virement coché. Il repartira des soldes du moment à la prochaine paie.</p>
      )}
    </Card>
  );
};
