// src/components/TransferManager.tsx
// Virements : virement entre deux de vos comptes, échéances mensuelles. Un dépôt ou un
// retrait sur un seul compte passe par l'ajout rapide (« Ajouter un mouvement »), seul
// chemin pour ce geste : même libellé, même « Annuler », où qu'on soit dans l'app.
import React, { useRef, useState } from 'react';
import { SavingsAccount, RecurringMovement } from '../types';
import { ArrowDown, CheckCircle, AlertCircle, Plus, Wallet } from 'lucide-react';
import { RecurringManager } from './RecurringManager';
import { useSaveFeedback } from '../hooks/useSaveFeedback';
import { useToast } from './Toast';
import { parseFrenchNumber } from '../lib/numbers';
import { localTodayISO } from '../lib/dates';
import { linkedTransfer, type CommandPatch } from '../lib/commands';
import { Button, Card, EmptyState, PageHeader, Tabs, TextField } from './ui';

interface TransferManagerProps {
  accounts: SavingsAccount[];
  /** Applique le résultat d'une commande (`commit` de useAccountActions) : le virement s'annule. */
  onCommit: (patch: CommandPatch) => void;
  recurringMovements: RecurringMovement[];
  onUpdateRecurring: React.Dispatch<React.SetStateAction<RecurringMovement[]>>;
  /** Ouvre l'ajout rapide (dépôt ou retrait sur un seul compte). */
  onQuickAdd?: () => void;
}

type Tab = 'transfer' | 'recurring';
const TABS: { value: Tab; label: string }[] = [
  { value: 'transfer', label: 'Virement' },
  { value: 'recurring', label: 'Récurrents' },
];

export const TransferManager: React.FC<TransferManagerProps> = ({ accounts, onCommit, recurringMovements, onUpdateRecurring, onQuickAdd }) => {
  const today = localTodayISO();
  const addToast = useToast();
  // État le plus récent pour l'annulation (le toast survit à ce rendu).
  const accountsRef = useRef(accounts);
  accountsRef.current = accounts;
  const [activeTab, setActiveTab] = useState<Tab>('transfer');
  const [opDate, setOpDate] = useState<string>(today);
  // Seule une écriture Drive CONFIRMÉE est annoncée comme réussie (voir useSaveFeedback).
  const { status: saveStatus, markPending } = useSaveFeedback();
  // Saisie refusée : la raison est écrite dans le formulaire, jamais un clic sans effet.
  const [formError, setFormError] = useState<string | null>(null);

  const [sourceAccountId, setSourceAccountId] = useState<string>('');
  const [destAccountId, setDestAccountId] = useState<string>('');
  const [transferAmount, setTransferAmount] = useState<string>('');

  const handleTransfer = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!sourceAccountId || !destAccountId) { setFormError('Choisissez les comptes source et destination.'); return; }
    if (sourceAccountId === destAccountId) { setFormError('Source et destination doivent être différentes.'); return; }

    const amount = parseFrenchNumber(transferAmount);
    if (amount === null) { setFormError('Montant non reconnu : saisissez par exemple 150 ou 150,50.'); return; }
    if (amount <= 0) { setFormError('Saisissez un montant supérieur à 0.'); return; }

    // Même règle pour tout appelant (commande pure) : part propre seulement, le capital des
    // parents n'est pas mobilisable ; montant au centime ; annulation exacte des deux côtés.
    const r = linkedTransfer({ accounts }, { sourceId: sourceAccountId, destId: destAccountId, amount, date: opDate });
    if (!r.ok) { setFormError(r.code === 'not-found' ? 'Le compte source ou destination est introuvable.' : r.error); return; }

    markPending();
    onCommit(r.next);
    addToast?.({ message: r.message, kind: 'success', action: { label: 'Annuler', onClick: () => onCommit(r.undo({ accounts: accountsRef.current })) } });
    setTransferAmount('');
  };

  const header = (
    <PageHeader
      title="Virements"
      subtitle="Virement entre deux de vos comptes, ou échéances qui reviennent chaque mois."
      actions={onQuickAdd && accounts.length > 0
        ? <Button variant="tonal" onClick={onQuickAdd}><Plus className="w-4 h-4" aria-hidden="true" /> Dépôt ou retrait</Button>
        : undefined}
    />
  );

  // Sans compte : un état vide qui dit quoi faire (pas une zone blanche sans issue).
  if (accounts.length === 0) {
    return (
      <div className="animate-fade-in pb-20">
        {header}
        <Card>
          <EmptyState icon={Wallet} title="Aucun compte pour l'instant">
            Ajoutez au moins un compte depuis l'écran « Mes comptes » pour pouvoir enregistrer des virements.
          </EmptyState>
        </Card>
      </div>
    );
  }

  const accountSelect = (id: string, label: string, value: string, onChange: (v: string) => void, disabledId: string) => (
    <TextField
      id={id} label={label}
      render={p => (
        <select id={p.id} className={p.className} value={value} onChange={e => onChange(e.target.value)} required>
          <option value="">Choisir un compte</option>
          {accounts.map(acc => <option key={acc.id} value={acc.id} disabled={acc.id === disabledId}>{acc.name}</option>)}
        </select>
      )}
    />
  );

  return (
    <div className="animate-fade-in pb-20">
      {header}
      <Tabs label="Type d'opération" tabs={TABS} value={activeTab} onChange={t => { setActiveTab(t); setFormError(null); }}>
        <Card className="max-w-xl">
          {activeTab === 'transfer' ? (
            <div className="space-y-5">
              <TextField id="op-date" label="Date de l'opération" type="date" value={opDate} onChange={e => setOpDate(e.target.value)} />

              {saveStatus === 'saved' && (
                <p role="status" className="bg-secondary-container text-on-secondary-container p-3 rounded-xl text-sm font-medium flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 shrink-0" aria-hidden="true" /> Enregistré sur Drive
                </p>
              )}

              {formError && (
                <p role="alert" className="bg-error-container text-on-error-container p-3 rounded-xl text-sm font-medium flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" /> {formError}
                </p>
              )}

              <form onSubmit={handleTransfer} className="space-y-5">
                {accountSelect('tr-from', 'Compte de départ', sourceAccountId, setSourceAccountId, destAccountId)}
                <div className="flex justify-center -my-2"><ArrowDown className="w-5 h-5 text-on-surface-variant" aria-hidden="true" /></div>
                {accountSelect('tr-to', "Compte d'arrivée", destAccountId, setDestAccountId, sourceAccountId)}
                <TextField id="tr-amount" label="Montant du virement" suffix="€" inputMode="decimal" placeholder="0,00" value={transferAmount} onChange={e => setTransferAmount(e.target.value)} />
                <Button type="submit" isLoading={saveStatus === 'pending'} className="w-full h-12!">Enregistrer le virement</Button>
              </form>
            </div>
          ) : (
            <RecurringManager accounts={accounts} recurringMovements={recurringMovements} onUpdate={onUpdateRecurring} />
          )}
        </Card>
      </Tabs>
    </div>
  );
};
