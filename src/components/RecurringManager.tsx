// ================================================
// FILE: src/components/RecurringManager.tsx
// Déclaration des versements/retraits qui reviennent chaque mois. Rien n'est jamais écrit
// automatiquement : le Dashboard PROPOSE l'écriture à l'échéance (voir findDueRecurring),
// l'utilisateur confirme d'un clic.
// ================================================
import React, { useRef, useState } from 'react';
import { SavingsAccount, RecurringMovement } from '../types';
import { Repeat, Plus, Trash2, AlertCircle, Pause, Play } from 'lucide-react';
import { safeNumber } from '../lib/numbers';
import { useUndoableRemove } from './Toast';
import { focusAfterRemoval } from './focusAfterRemoval';
import { Button, IconButton, ListItem, MoneyText, SegmentedButton, TextField } from './ui';

interface RecurringManagerProps {
  accounts: SavingsAccount[];
  recurringMovements: RecurringMovement[];
  onUpdate: React.Dispatch<React.SetStateAction<RecurringMovement[]>>;
}

export const RecurringManager: React.FC<RecurringManagerProps> = ({ accounts, recurringMovements, onUpdate }) => {
  const [accountId, setAccountId] = useState('');
  const [amount, setAmount] = useState('');
  const [type, setType] = useState<'IN' | 'OUT'>('IN');
  const [label, setLabel] = useState('');
  const [day, setDay] = useState('5');
  const [error, setError] = useState<string | null>(null);

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!accountId) { setError('Choisissez un compte.'); return; }
    const value = safeNumber(amount, 0);
    if (value <= 0) { setError('Saisissez un montant supérieur à 0.'); return; }
    const dayOfMonth = Math.round(safeNumber(day, 0));
    if (dayOfMonth < 1 || dayOfMonth > 31) { setError('Le jour doit être compris entre 1 et 31.'); return; }
    const next: RecurringMovement = {
      id: crypto.randomUUID(),
      accountId, amount: value, type, dayOfMonth, active: true,
      label: label.trim() || (type === 'IN' ? 'Versement mensuel' : 'Retrait mensuel'),
    };
    onUpdate([...recurringMovements, next]);
    setAmount(''); setLabel('');
  };

  const toggle = (id: string) => onUpdate(recurringMovements.map(r => r.id === id ? { ...r, active: !r.active } : r));
  const removeWithUndo = useUndoableRemove();
  const listRef = useRef<HTMLUListElement>(null);
  // Le focus va sur l'échéance voisine, sinon sur le titre « Nouvelle échéance » (WCAG 2.4.3).
  const remove = (id: string) => {
    const r = recurringMovements.find(x => x.id === id);
    if (!r) return;
    removeWithUndo(recurringMovements, r, onUpdate, `Échéance « ${r.label} » supprimée`);
    focusAfterRemoval(() => listRef.current, recurringMovements.indexOf(r), () => document.getElementById('recurring-new-title'));
  };

  const accountName = (id: string) => accounts.find(a => a.id === id)?.name;

  return (
    <div className="space-y-6">
      <p className="text-sm text-on-surface-variant flex items-start gap-2">
        <Repeat className="w-4 h-4 shrink-0 mt-0.5 text-primary" aria-hidden="true" />
        À l'échéance, l'Accueil vous proposera d'enregistrer le mouvement en un clic. Rien n'est jamais ajouté sans votre confirmation.
      </p>

      {recurringMovements.length > 0 && (
        <ul ref={listRef} className="divide-y divide-outline-variant border-y border-outline-variant">
          {recurringMovements.map(r => {
            const name = accountName(r.accountId);
            return (
              <ListItem
                key={r.id}
                headline={r.label}
                supporting={<>
                  le {r.dayOfMonth} du mois · {name ?? <span className="text-error font-medium">compte supprimé</span>}
                  {!r.active && <> · <span className="font-medium">en pause</span></>}
                </>}
                trailing={<MoneyText value={r.type === 'IN' ? r.amount : -r.amount} signed tone={r.active ? 'auto' : 'neutral'} />}
                actions={<>
                  <IconButton icon={r.active ? Pause : Play} label={r.active ? `Mettre en pause ${r.label}` : `Réactiver ${r.label}`} onClick={() => toggle(r.id)} data-focus-after-removal />
                  <IconButton icon={Trash2} tone="danger" label={`Supprimer ${r.label}`} onClick={() => remove(r.id)} />
                </>}
              />
            );
          })}
        </ul>
      )}

      <form onSubmit={add} className="space-y-4" aria-labelledby="recurring-new-title">
        <h3 id="recurring-new-title" className="text-base font-medium text-on-surface outline-none">Nouvelle échéance</h3>
        <TextField
          label="Compte"
          render={p => (
            <select id={p.id} className={p.className} value={accountId} onChange={e => setAccountId(e.target.value)}>
              <option value="">Choisir un compte</option>
              {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          )}
        />
        <SegmentedButton
          label="Sens de l'échéance" value={type} onChange={setType}
          className="w-full [&>button]:flex-1 max-sm:[&>button]:h-12"
          options={[{ value: 'IN', label: 'Versement' }, { value: 'OUT', label: 'Retrait' }]}
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <TextField label="Montant" suffix="€" inputMode="decimal" placeholder="0,00" value={amount} onChange={e => setAmount(e.target.value)} />
          <TextField label="Jour du mois" supporting="De 1 à 31" inputMode="numeric" value={day} onChange={e => setDay(e.target.value)} />
        </div>
        <TextField label="Libellé (facultatif)" placeholder={type === 'IN' ? 'Versement mensuel' : 'Retrait mensuel'} value={label} onChange={e => setLabel(e.target.value)} />
        {error && (
          <p role="alert" className="text-sm font-medium text-error flex items-center gap-2"><AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" /> {error}</p>
        )}
        <Button type="submit" className="w-full h-12!">
          <Plus className="w-4 h-4" aria-hidden="true" /> Ajouter l'échéance
        </Button>
      </form>
    </div>
  );
};
