// Une ligne de l'écran « Actualiser les soldes » : résumé compact (nom, solde, écart en
// cours de saisie) qui se déplie sur les trois façons de saisir le nouveau solde.
// Aucun calcul d'enregistrement ici : la ligne affiche le brouillon et remonte les saisies.
import React, { useId, useState } from 'react';
import { ChevronDown, Lightbulb, Users, User, Pencil } from 'lucide-react';
import { SavingsAccount } from '../../types';
import { Button } from '../Button';
import { DeltaBadge, MoneyText, SegmentedButton, TextField } from '../ui';
import { safeNumber, parseFrenchNumber } from '../../lib/numbers';
import { tracksDeposits, quinzaineWithdrawalTip } from '../../lib/finance';
import { parseISODate } from '../../lib/dates';
import { formatEUR, toInputAmount, frenchDay } from '../../lib/format';
import type { Adjust, Draft, EntryMode } from './draft';

interface AccountUpdateRowProps {
  account: SavingsAccount;
  draft: Draft;
  adjust: Adjust;
  adjustError?: string | null;
  /** Plus aucun compte n'a de part parentale : son champ n'est montré que s'il est non nul. */
  soloMode: boolean;
  today: string;
  expanded: boolean;
  onToggle: () => void;
  onOwnedChange: (val: string) => void;
  onParentalChange: (val: string) => void;
  onBankTotalChange: (val: string) => void;
  onDepositsChange: (val: string) => void;
  onDateChange: (val: string) => void;
  onPatchAdjust: (patch: Partial<Adjust>) => void;
  onApplyAdjust: () => void;
}

const parseDeposits = (val: string): number | undefined | null =>
  val.trim() === '' ? undefined : parseFrenchNumber(val);

/** Ligne « libellé ……… montant (écart) » du récapitulatif déplié. */
const SummaryLine: React.FC<{ label: string; icon: React.ComponentType<{ className?: string }>; value: number; diff?: number; className?: string }> = ({ label, icon: Icon, value, diff, className = '' }) => (
  <div className={`flex items-center justify-between gap-3 py-1.5 ${className}`}>
    <dt className="flex items-center gap-2 text-sm min-w-0">
      <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
      <span className="truncate">{label}</span>
    </dt>
    <dd className="flex items-center gap-2 text-sm font-medium">
      <MoneyText value={value} decimals={2} />
      {diff !== undefined && Math.abs(diff) > 0.004 && (
        <MoneyText value={diff} decimals={2} signed tone="auto" className="text-xs" />
      )}
    </dd>
  </div>
);

export const AccountUpdateRow: React.FC<AccountUpdateRowProps> = ({
  account, draft: u, adjust: a, adjustError, soloMode, today, expanded, onToggle,
  onOwnedChange, onParentalChange, onBankTotalChange, onDepositsChange, onDateChange, onPatchAdjust, onApplyAdjust,
}) => {
  const panelId = useId();
  const [mode, setMode] = useState<EntryMode>('balance');

  const owned = safeNumber(u.owned, 0);
  const parental = safeNumber(u.parental, 0);
  const newTotal = owned + parental;
  const diffOwned = Math.round((owned - account.ownedAmount) * 100) / 100;
  const diffParental = Math.round((parental - account.parentalCapital) * 100) / 100;
  const diffTotal = Math.round((diffOwned + diffParental) * 100) / 100;
  const depositsDraft = parseDeposits(u.deposits);
  const tracked = tracksDeposits(account.type);
  const depositsChanged = tracked && depositsDraft !== null && depositsDraft !== account.totalDeposits;
  const isChanged = diffOwned !== 0 || diffParental !== 0 || depositsChanged;

  const showParental = !soloMode || parental > 0;
  // « Total affiché par la banque » n'a de sens que s'il y a une part parentale à déduire.
  const bankAvailable = parental > 0;
  const activeMode: EntryMode = mode === 'bank' && !bankAvailable ? 'balance' : mode;
  const modes: { value: EntryMode; label: React.ReactNode }[] = [
    { value: 'balance', label: <span className="whitespace-nowrap"><span className="sm:hidden">Solde</span><span className="max-sm:hidden">Nouveau solde</span></span> },
    ...(bankAvailable ? [{ value: 'bank' as const, label: <span className="whitespace-nowrap">Total banque</span> }] : []),
    { value: 'adjust', label: <span className="whitespace-nowrap">Ajuster</span> },
  ];

  // Baisse de solde sur un livret en cours de quinzaine : conseil d'attendre.
  const when = parseISODate(u.date || today);
  const tip = diffOwned < 0 ? quinzaineWithdrawalTip(account, -diffOwned, when) : null;
  const since = when.getDate() < 16 ? '1er' : '16';

  const bankTooLow = u.bankTotal !== undefined && (parseFrenchNumber(u.bankTotal) ?? Infinity) < parental;

  return (
    <li className={`transition-colors ${expanded ? 'bg-surface-container-low dark:bg-surface-container' : ''}`}>
      <h3>
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={panelId}
          onClick={onToggle}
          className="w-full flex items-center gap-3 sm:gap-4 px-4 sm:px-6 py-3.5 min-h-[72px] text-left hover:bg-on-surface/5 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-indigo-600 dark:focus-visible:outline-indigo-300"
        >
          <span className="flex-1 min-w-0">
            <span className="block text-base font-medium text-on-surface truncate">{account.name}</span>
            <span className="block text-sm text-on-surface-variant truncate">
              {account.institution}
              {isChanged && (
                <span className="inline-flex items-center gap-1 ml-2 text-indigo-700 dark:text-indigo-300 font-medium">
                  <Pencil className="w-3.5 h-3.5" aria-hidden="true" /> Modifié
                </span>
              )}
            </span>
          </span>
          <span className="flex flex-col items-end gap-1 shrink-0">
            {diffTotal !== 0 ? (
              <>
                <span className="text-base font-medium text-on-surface">
                  <span className="sr-only">Nouveau solde : </span><MoneyText value={newTotal} decimals={2} />
                </span>
                <DeltaBadge value={diffTotal} />
              </>
            ) : (
              <span className="text-base font-medium text-on-surface">
                <span className="sr-only">Solde actuel : </span><MoneyText value={account.totalAmount} decimals={2} />
              </span>
            )}
          </span>
          <ChevronDown className={`w-5 h-5 shrink-0 text-on-surface-variant transition-transform ${expanded ? 'rotate-180' : ''}`} aria-hidden="true" />
        </button>
      </h3>

      <div id={panelId} hidden={!expanded} className="px-4 sm:px-6 pb-5 pt-1 space-y-5">
        <SegmentedButton<EntryMode>
          label={`Façon de saisir le solde de ${account.name}`}
          options={modes}
          value={activeMode}
          onChange={setMode}
          className="max-sm:w-full max-sm:[&>button]:flex-1 max-sm:[&>button]:px-2"
        />

        {activeMode === 'balance' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="rounded-xl border border-outline-variant p-3">
            <TextField
              label="Ma part"
              suffix="€"
              type="text"
              inputMode="decimal"
              value={u.owned}
              aria-label={`Ma part sur ${account.name}`}
              onChange={e => onOwnedChange(e.target.value)}
              supporting={`Actuellement ${formatEUR(account.ownedAmount, 2)}`}
            />
            </div>
            {showParental && (
              <div className="rounded-xl bg-tertiary-container text-on-tertiary-container p-3">
                <TextField
                  label="Part des parents"
                  suffix="€"
                  type="text"
                  inputMode="decimal"
                  value={u.parental}
                  aria-label={`Part des parents sur ${account.name}`}
                  onChange={e => onParentalChange(e.target.value)}
                  supporting={`Actuellement ${formatEUR(account.parentalCapital, 2)}`}
                />
              </div>
            )}
          </div>
        )}

        {activeMode === 'bank' && (
          <TextField
            label="Total affiché par la banque"
            suffix="€"
            type="text"
            inputMode="decimal"
            value={u.bankTotal ?? toInputAmount(newTotal)}
            aria-label={`Total affiché par la banque pour ${account.name}`}
            onChange={e => onBankTotalChange(e.target.value)}
            className="sm:max-w-sm"
            error={bankTooLow ? `Ce total est inférieur à la part de vos parents (${formatEUR(parental)}) : vérifiez la saisie.` : undefined}
            supporting="Saisissez le solde de l'app bancaire : votre part est recalculée, celle de vos parents ne change pas."
          />
        )}

        {activeMode === 'adjust' && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-end gap-3">
              <SegmentedButton<'plus' | 'minus'>
                label={`Sens de l'ajustement sur ${account.name}`}
                options={[{ value: 'plus', label: '+ Ajouter' }, { value: 'minus', label: '− Retirer' }]}
                value={a.sign === 1 ? 'plus' : 'minus'}
                onChange={v => onPatchAdjust({ sign: v === 'plus' ? 1 : -1 })}
              />
              <SegmentedButton<'owned' | 'parental'>
                label={`Part concernée sur ${account.name}`}
                options={[{ value: 'owned', label: 'Ma part' }, { value: 'parental', label: 'Parents' }]}
                value={a.target}
                onChange={v => onPatchAdjust({ target: v })}
              />
            </div>
            <div className="flex flex-wrap items-start gap-3">
              <TextField
                label="Montant"
                suffix="€"
                type="text"
                inputMode="decimal"
                value={a.amount}
                placeholder="0,00"
                aria-label={`Montant de l'ajustement sur ${account.name}`}
                onChange={e => onPatchAdjust({ amount: e.target.value })}
                onKeyDown={e => { if (e.key === 'Enter') onApplyAdjust(); }}
                error={adjustError || undefined}
                className="w-48"
              />
              <Button type="button" variant="tonal" onClick={onApplyAdjust} className="mt-7 h-14 sm:h-10 sm:mt-[34px]">Appliquer</Button>
            </div>
            {tracked && typeof depositsDraft === 'number' && a.target === 'owned' && (
              <label className="flex items-center gap-2 text-sm text-on-surface">
                <input type="checkbox" className="w-4 h-4 accent-indigo-600" checked={a.isCash} onChange={e => onPatchAdjust({ isCash: e.target.checked })} />
                {a.sign > 0 ? 'Versement' : 'Retrait'} d'argent (et non une variation de valeur)
              </label>
            )}
            <p className="text-xs text-on-surface-variant">L'écart s'ajoute au montant en cours de saisie, et n'est enregistré qu'avec le reste.</p>
          </div>
        )}

        {/* Récapitulatif : ce qui sera enregistré, quelle que soit la façon de saisir. */}
        <dl className="rounded-xl border border-outline-variant px-4 py-2 text-on-surface">
          <SummaryLine label="Ma part" icon={User} value={owned} diff={diffOwned} />
          {showParental && (
            <SummaryLine label="Part des parents" icon={Users} value={parental} diff={diffParental}
              className="-mx-2 px-2 rounded-lg bg-tertiary-container text-on-tertiary-container" />
          )}
          <div className="flex items-center justify-between gap-3 pt-2 mt-1 border-t border-outline-variant">
            <dt className="text-sm font-medium">Nouveau total</dt>
            <dd className="text-base font-medium"><MoneyText value={newTotal} decimals={2} /></dd>
          </div>
        </dl>

        {tip && (
          <p className="flex items-start gap-2 text-sm text-on-surface rounded-xl bg-secondary-container/60 p-3">
            <Lightbulb className="w-4 h-4 shrink-0 mt-0.5 text-indigo-700 dark:text-indigo-300" aria-hidden="true" />
            <span>Retiré le {frenchDay(when)}, ce montant ne rapporte déjà plus rien depuis le {since}. En attendant le {frenchDay(parseISODate(tip.waitUntil))}, vous gardez ~{formatEUR(tip.gain, 0)} d'intérêts.</span>
          </p>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {tracked && (
            <TextField
              label="Versements cumulés"
              suffix="€"
              type="text"
              inputMode="decimal"
              value={u.deposits}
              placeholder="Inconnu"
              aria-label={`Versements cumulés sur ${account.name}`}
              onChange={e => onDepositsChange(e.target.value)}
              error={depositsDraft === null ? 'Montant non reconnu.' : undefined}
              supporting={depositsDraft === undefined
                ? 'Renseignez-les une fois : ensuite, les versements de l’ajustement les mettent à jour, et le reste de l’écart compte comme gain ou perte de valeur.'
                : depositsDraft !== null ? <>Plus-value latente : <MoneyText value={newTotal - depositsDraft} decimals={0} className="font-medium" /></> : undefined}
            />
          )}
          <TextField
            label="Date du relevé"
            type="date"
            value={u.date}
            aria-label={`Date du relevé de ${account.name}`}
            onChange={e => onDateChange(e.target.value)}
          />
        </div>
      </div>
    </li>
  );
};
