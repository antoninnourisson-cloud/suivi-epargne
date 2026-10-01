// ================================================
// FILE: src/components/PayChecklist.tsx
// La paie du mois, virement par virement, à cocher au fur et à mesure. Cocher une ligne
// d'épargne ENREGISTRE le versement sur le compte (montant modifiable si le virement réel
// diffère du plan) ; la décocher l'annule. Le plan est figé au premier virement coché :
// sinon, chaque versement enregistré modifierait les soldes, donc le plan lui-même.
// ================================================
import React, { useEffect, useState } from 'react';
import { PayChecklist as PayChecklistData, PayChecklistLine } from '../types';
import { PayTransfer, PlacementStep, buildPayLines, payPeriodOf } from '../lib/finance';
import { formatEUR, toInputAmount, formatRate } from '../lib/format';
import { parseFrenchNumber } from '../lib/numbers';
import { Wallet, Info, CheckCircle2, RotateCcw, PiggyBank } from 'lucide-react';

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
  children?: React.ReactNode; // réglage du rappel du jour de paie
  paydayDay?: number;          // la liste suit la paie, pas le mois calendaire
}

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const monthKeyOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

export const PayChecklist: React.FC<PayChecklistProps> = ({
  superNet, transfers, steps, totalToInvest, shortfall, checklist, onChange, onRecordDeposit, onCancelDeposit, children, paydayDay,
}) => {
  const now = new Date();
  const period = payPeriodOf(paydayDay, now);
  const month = period.key;
  const periodLabel = MONTHS[period.payDate.getMonth()];

  // Liste créée avant ce correctif, au 1er du mois calendaire suivant (ex. « octobre »
  // pour la paie du 27 septembre) : on la rattache à la bonne paie, une seule fois.
  useEffect(() => {
    if (checklist && checklist.month > month) onChange({ ...checklist, month });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checklist?.month, month]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

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
    if (!alreadyRecorded && l.kind === 'saving' && l.accountId && amount > 0) movementId = onRecordDeposit(l.accountId, amount);
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

  const renderLine = (l: PayChecklistLine & { detail?: string }) => {
    const entry = done[l.key];
    const isDone = !!entry;
    const varied = isDone && Math.abs(entry.amount - l.amount) >= 0.005;
    const invalid = !isDone && draftAmount(l) === null;
    return (
      <div key={l.key} className={`flex items-center gap-3 text-sm p-2 rounded-lg ${isDone ? 'bg-emerald-50 dark:bg-emerald-950/30' : 'bg-slate-50 dark:bg-slate-900'}`}>
        <input
          type="checkbox"
          checked={isDone}
          disabled={invalid}
          onChange={() => (isDone ? uncheck(l) : check(l))}
          aria-label={`${l.label} : ${isDone ? 'fait' : 'à faire'}`}
          className="w-5 h-5 flex-shrink-0 accent-emerald-600"
        />
        <div className="flex-1 min-w-0">
          <p className={`font-bold truncate ${isDone ? 'text-emerald-800 dark:text-emerald-300' : 'text-slate-700 dark:text-slate-200'}`}>{l.label}</p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            {l.detail && <>{l.detail} · </>}
            {isDone
              ? `${entry.alreadyRecorded ? 'déjà enregistré' : l.kind === 'saving' ? 'versement enregistré' : 'fait'}${varied ? ` : ${formatEUR(entry.amount)} (prévu ${formatEUR(l.amount)})` : ''}`
              : (l.kind === 'saving' ? 'cocher enregistre le versement sur le compte' : 'à faire')}
            {!isDone && l.kind === 'saving' && !invalid && (
              <button type="button" onClick={() => check(l, true)} className="ml-2 font-bold text-indigo-600 dark:text-indigo-300 hover:underline">Déjà enregistré ?</button>
            )}
          </p>
        </div>
        {isDone ? (
          <span className="font-mono font-bold text-emerald-700 dark:text-emerald-300 flex-shrink-0">{formatEUR(entry.amount)}</span>
        ) : (
          <label className="flex items-center gap-1 flex-shrink-0">
            <span className="sr-only">Montant réel de {l.label}</span>
            <input
              type="text"
              inputMode="decimal"
              value={drafts[l.key] ?? toInputAmount(l.amount)}
              onChange={e => setDrafts(d => ({ ...d, [l.key]: e.target.value }))}
              onKeyDown={e => { if (e.key === 'Enter') check(l); }}
              className={`w-24 p-1.5 text-right font-mono font-bold bg-white dark:bg-slate-800 border rounded-lg ${invalid ? 'border-rose-400' : 'border-slate-200 dark:border-slate-700'} text-slate-700 dark:text-slate-200`}
            />
            <span className="text-slate-500 dark:text-slate-400 font-bold">€</span>
          </label>
        )}
      </div>
    );
  };

  const totalLines = lines.length;
  return (
    <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm lg:col-span-2">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-1">
        <h3 className="text-lg font-black text-slate-800 dark:text-slate-100 flex items-center gap-2"><Wallet className="w-5 h-5 text-indigo-600" /> Votre paie, virement par virement</h3>
        {totalLines > 0 && (
          <span className={`text-xs font-black px-2.5 py-1 rounded-full ${doneCount === totalLines ? 'bg-emerald-600 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'}`}>
            {doneCount === totalLines ? <span className="inline-flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> Tout est fait</span> : `${doneCount}/${totalLines} faits`}
          </span>
        )}
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
        Paie de {periodLabel} : {formatEUR(superNet)}. Cochez chaque virement une fois fait ; si le montant réel diffère, corrigez-le avant de cocher.
        {' '}Ajoutez une charge fixe par virement sortant (ex. « Revolut commun »), sans détailler ce qu'elle paie.
      </p>

      <div className="space-y-2">
        {transferLines.map(renderLine)}
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="text-sm font-black text-emerald-700 dark:text-emerald-300 flex items-center gap-2"><PiggyBank className="w-4 h-4" /> Épargne</p>
        <p className="font-mono font-black text-emerald-700 dark:text-emerald-300">{formatEUR(frozen ? savingLines.reduce((s, l) => s + l.amount, 0) : totalToInvest)}</p>
      </div>
      <div className="space-y-2 mt-2">
        {savingLines.map(renderLine)}
        {!frozen && suggestions.map(st => (
          <p key={st.accountName} className="text-xs font-bold text-amber-700 dark:text-amber-300 p-2 rounded-lg bg-amber-50 dark:bg-amber-950/40">{st.hint}</p>
        ))}
        {savingLines.length === 0 && suggestions.length === 0 && <p className="text-sm text-slate-500 dark:text-slate-400 italic">Rien à placer ce mois-ci.</p>}
      </div>

      {shortfall > 0 && (
        <p className="mt-3 text-xs font-bold text-rose-600 flex items-center gap-1"><Info className="w-3.5 h-3.5" /> Il manque {formatEUR(shortfall)} : les virements dépassent la paie.</p>
      )}
      {frozen && doneCount === 0 && (
        <button type="button" onClick={() => onChange(undefined)} className="mt-3 text-xs font-bold text-indigo-600 hover:underline flex items-center gap-1">
          <RotateCcw className="w-3 h-3" /> Recalculer le plan sur les soldes actuels
        </button>
      )}
      {frozen && doneCount > 0 && (
        <p className="mt-3 text-[11px] text-slate-500 dark:text-slate-400">Plan figé pour la paie de {periodLabel} depuis le premier virement coché. Il repartira des soldes du moment à la prochaine paie.</p>
      )}

      {children}
    </div>
  );
};
