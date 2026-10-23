// Ajout rapide d'un dépôt ou d'un retrait. Une fois la saisie commencée, un toucher hors de
// la feuille ne la ferme plus (Échap et « Fermer » restent) ; après l'ajout, le message de
// confirmation propose « Annuler » (voir useAccountActions).
import React, { useEffect, useRef, useState } from 'react';
import { lsGet, lsSet } from '../lib/storage';
import { SavingsAccount } from '../types';
import { X, ArrowUpCircle, ArrowDownCircle, Lightbulb } from 'lucide-react';
import { NumberInput } from './NumberInput';
import { localTodayISO, parseISODate } from '../lib/dates';
import { quinzaineWithdrawalTip } from '../lib/finance';
import { formatEUR, frenchDay } from '../lib/format';
import { Modal } from './Modal';
import { canWithdrawOwn } from '../lib/accountOps';
import { Button, Chip, IconButton, SegmentedButton, TextField } from './ui';

interface QuickAddModalProps {
  open: boolean;
  accounts: SavingsAccount[];
  onClose: () => void;
  onSubmit: (accountId: string, amount: number, type: 'IN' | 'OUT', label: string, date: string) => void;
}

type Direction = 'IN' | 'OUT';
const LAST_ACCOUNT_KEY = 'quickadd_last_account';
const DIRECTIONS: { value: Direction; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { value: 'IN', label: 'Dépôt', icon: ArrowUpCircle },
  { value: 'OUT', label: 'Retrait', icon: ArrowDownCircle },
];
const SUGGESTIONS: Record<Direction, string[]> = {
  IN: ['Virement de paie', 'Épargne du mois', 'Intérêts', 'Cadeau'],
  OUT: ['Retrait', 'Dépense imprévue', 'Projet'],
};

/** Puces de 32 px, zone tactile de 48 px (Material 3). */
const CHIP_TARGET = 'relative after:absolute after:inset-x-0 after:-inset-y-2';

export const QuickAddModal: React.FC<QuickAddModalProps> = ({ open, accounts, onClose, onSubmit }) => {
  const [accountId, setAccountId] = useState('');
  const [amount, setAmount] = useState(0);
  const [type, setType] = useState<Direction>('IN');
  const [label, setLabel] = useState('');
  const [date, setDate] = useState(localTodayISO());
  const amountRef = useRef<HTMLInputElement>(null);

  // Chaque ouverture repart d'un formulaire propre, sur le dernier compte utilisé (les
  // comptes ont pu être créés depuis le montage).
  useEffect(() => {
    if (!open) return;
    const last = lsGet(LAST_ACCOUNT_KEY) || '';
    setAccountId(accounts.some(a => a.id === last) ? last : accounts[0]?.id || '');
    setAmount(0);
    setType('IN');
    setLabel('');
    setDate(localTodayISO());
  }, [open, accounts]);

  const account = accounts.find(a => a.id === accountId);
  const tip = open && type === 'OUT' && account ? quinzaineWithdrawalTip(account, amount, parseISODate(date)) : null;
  const since = parseISODate(date).getDate() < 16 ? '1er' : '16';
  const tooMuch = type === 'OUT' && !!account && amount > 0 && !canWithdrawOwn(account, amount);
  const canSubmit = !!accountId && amount > 0 && !tooMuch;
  // Bouton grisé : la raison est écrite sous le bouton et lui est reliée (un montant trop
  // élevé est déjà expliqué sous le champ « Montant »).
  const whyDisabled = !accountId ? 'Choisissez un compte pour pouvoir ajouter.' : !(amount > 0) ? 'Indiquez un montant pour pouvoir ajouter.' : null;
  // Saisie commencée : un toucher sur le voile ne doit pas l'effacer.
  const dirty = amount > 0 || label.trim() !== '';

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    lsSet(LAST_ACCOUNT_KEY, accountId);
    onSubmit(accountId, amount, type, label.trim() || (type === 'IN' ? 'Dépôt' : 'Retrait'), date);
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} label="Ajouter un mouvement" variant="sheet" className="max-w-md p-6" initialFocusRef={amountRef} closeOnScrim={!dirty}>
      <form onSubmit={submit}>
        <div className="flex items-center justify-between gap-2 mb-5">
          <h2 className="text-2xl font-normal text-on-surface">Ajouter un mouvement</h2>
          <IconButton icon={X} label="Fermer" onClick={onClose} className="-mr-3" />
        </div>

        <div className="space-y-5">
          <TextField
            label="Compte"
            render={p => (
              <select id={p.id} className={p.className} value={accountId} onChange={e => setAccountId(e.target.value)}>
                {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            )}
          />

          <SegmentedButton
            label="Sens du mouvement" options={DIRECTIONS} value={type} onChange={setType}
            className="w-full [&>button]:flex-1 max-sm:[&>button]:h-12"
          />

          <div>
            <TextField
              label="Montant"
              error={!tooMuch ? undefined : account!.parentalCapital > 0
                ? `Votre part sur ce compte est de ${formatEUR(account!.ownedAmount)} : la part de vos parents ne peut pas être retirée.`
                : `Le solde de ce compte est de ${formatEUR(account!.ownedAmount)} : impossible de retirer davantage.`}
              render={p => (
                <NumberInput id={p.id} inputRef={amountRef} value={amount} onChange={setAmount} suffix="€" min={0}
                  describedBy={p.describedBy} invalid={p.invalid} className={`${p.className} text-2xl tabular-nums`} />
              )}
            />
            {tip && (
              <p className="mt-2 text-sm rounded-xl p-3 flex items-start gap-2 bg-tertiary-container text-on-tertiary-container">
                <Lightbulb className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                <span>Retiré à cette date, ce montant ne rapporte déjà plus rien depuis le {since}. En attendant le {frenchDay(parseISODate(tip.waitUntil))}, vous gardez environ {formatEUR(tip.gain, 0)} d'intérêts.</span>
              </p>
            )}
          </div>

          <div>
            <TextField label="Libellé (facultatif)" value={label} onChange={e => setLabel(e.target.value)} placeholder={SUGGESTIONS[type][0]} />
            <div role="group" aria-label="Libellés proposés" className="flex flex-wrap gap-x-2 gap-y-4 mt-3 py-1">
              {SUGGESTIONS[type].map(sug => (
                <Chip key={sug} selected={label === sug} className={CHIP_TARGET} onClick={() => setLabel(label === sug ? '' : sug)}>{sug}</Chip>
              ))}
            </div>
          </div>

          <TextField label="Date" type="date" value={date} onChange={e => setDate(e.target.value)} />
        </div>

        <Button type="submit" disabled={!canSubmit} aria-describedby={whyDisabled ? 'quick-add-why' : undefined} className="w-full mt-6 h-12!">Ajouter</Button>
        {whyDisabled && <p id="quick-add-why" className="mt-2 text-sm text-on-surface-variant text-center">{whyDisabled}</p>}
      </form>
    </Modal>
  );
};
