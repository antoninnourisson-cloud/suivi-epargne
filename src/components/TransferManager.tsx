// src/components/TransferManager.tsx
// Virements : dépôt sur un compte, virement entre deux comptes, échéances mensuelles.
import React, { useRef, useState } from 'react';
import { SavingsAccount, RecurringMovement } from '../types';
import { ArrowDown, CheckCircle, AlertCircle, Wallet } from 'lucide-react';
import { RecurringManager } from './RecurringManager';
import { useSaveFeedback } from '../hooks/useSaveFeedback';
import { useToast } from './Toast';
import { parseFrenchNumber, safeNumber } from '../lib/numbers';
import { localTodayISO } from '../lib/dates';
import { linkedTransfer, quickAdd, type CommandPatch } from '../lib/commands';
import { Button, Card, EmptyState, PageHeader, Tabs, TextField } from './ui';

interface TransferManagerProps {
  accounts: SavingsAccount[];
  /** Applique le résultat d'une commande (`commit` de useAccountActions) : dépôt et virement s'annulent. */
  onCommit: (patch: CommandPatch) => void;
  recurringMovements: RecurringMovement[];
  onUpdateRecurring: React.Dispatch<React.SetStateAction<RecurringMovement[]>>;
}

type Tab = 'deposit' | 'transfer' | 'recurring';
// Libellés seuls (sans icône) : les trois onglets tiennent sur un écran de 320 px.
const TABS: { value: Tab; label: string }[] = [
  { value: 'deposit', label: 'Dépôt' },
  { value: 'transfer', label: 'Virement' },
  { value: 'recurring', label: 'Récurrents' },
];

export const TransferManager: React.FC<TransferManagerProps> = ({ accounts, onCommit, recurringMovements, onUpdateRecurring }) => {
  const today = localTodayISO();
  const addToast = useToast();
  // État le plus récent pour l'annulation (le toast survit à ce rendu).
  const accountsRef = useRef(accounts);
  accountsRef.current = accounts;
  const [activeTab, setActiveTab] = useState<Tab>('deposit');
  const [opDate, setOpDate] = useState<string>(today);
  // Seule une écriture Drive CONFIRMÉE est annoncée comme réussie (voir useSaveFeedback).
  const { status: saveStatus, markPending } = useSaveFeedback();
  const [formError, setFormError] = useState<string | null>(null);

  // Deposit State
  const [depositAccountId, setDepositAccountId] = useState<string>('');
  const [depositAmount, setDepositAmount] = useState<string>('');

  // Transfer State
  const [sourceAccountId, setSourceAccountId] = useState<string>('');
  const [destAccountId, setDestAccountId] = useState<string>('');
  const [transferAmount, setTransferAmount] = useState<string>('');

  // Les échecs de validation étaient de simples `return` silencieux (ou une `alert()`
  // native) : l'utilisateur cliquait et rien ne se passait, sans explication. On remonte
  // désormais la raison dans le formulaire lui-même.
  // Dépôt : même commande que l'ajout rapide (arrondi, versements cumulés, annulation exacte).
  const handleDeposit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!depositAccountId) { setFormError('Choisissez un compte de destination.'); return; }
    const amount = parseFrenchNumber(depositAmount);
    if (amount === null) { setFormError('Montant non reconnu : saisissez par exemple 150 ou 150,50.'); return; }
    if (amount <= 0) { setFormError('Saisissez un montant supérieur à 0.'); return; }

    const r = quickAdd({ accounts }, { accountId: depositAccountId, amount, type: 'IN', label: 'Dépôt', date: opDate });
    if (!r.ok) { setFormError(r.code === 'not-found' ? 'Ce compte est introuvable.' : r.error); return; }

    markPending();
    onCommit(r.next);
    addToast?.({ message: r.message, kind: 'success', action: { label: 'Annuler', onClick: () => onCommit(r.undo({ accounts: accountsRef.current })) } });
    setDepositAmount('');
  };

  const handleTransfer = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!sourceAccountId || !destAccountId) { setFormError('Choisissez les comptes source et destination.'); return; }
    if (sourceAccountId === destAccountId) { setFormError('Source et destination doivent être différentes.'); return; }

    const amount = safeNumber(transferAmount, 0);
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

  const header = <PageHeader title="Virements" subtitle="Dépôt sur un compte, virement entre deux comptes, ou échéances qui reviennent chaque mois." />;

  // Auparavant `return null` : l'onglet Virements de la barre du bas s'ouvrait sur une zone
  // entièrement vide, sans explication ni porte de sortie.
  if (accounts.length === 0) {
    return (
      <div className="animate-fade-in pb-20">
        {header}
        <Card>
          <EmptyState icon={Wallet} title="Aucun compte pour l'instant">
            Ajoutez au moins un compte depuis l'écran « Mes comptes » pour pouvoir enregistrer des dépôts et des virements.
          </EmptyState>
        </Card>
      </div>
    );
  }

  const accountSelect = (id: string, label: string, value: string, onChange: (v: string) => void, placeholder: string, disabledId?: string, withInstitution = false) => (
    <TextField
      id={id} label={label}
      render={p => (
        <select id={p.id} className={p.className} value={value} onChange={e => onChange(e.target.value)} required>
          <option value="">{placeholder}</option>
          {accounts.map(acc => <option key={acc.id} value={acc.id} disabled={acc.id === disabledId}>{withInstitution ? `${acc.name} (${acc.institution})` : acc.name}</option>)}
        </select>
      )}
    />
  );

  return (
    <div className="animate-fade-in pb-20">
      {header}
      <Tabs label="Type d'opération" tabs={TABS} value={activeTab} onChange={t => { setActiveTab(t); setFormError(null); }}>
        <Card className="max-w-xl">
          <div className="space-y-5">
            {activeTab !== 'recurring' && (
              <TextField id="op-date" label="Date de l'opération" type="date" value={opDate} onChange={e => setOpDate(e.target.value)} />
            )}

            {activeTab !== 'recurring' && saveStatus === 'saved' && (
              <p role="status" className="bg-secondary-container text-on-secondary-container p-3 rounded-xl text-sm font-medium flex items-center gap-2">
                <CheckCircle className="w-4 h-4 shrink-0" aria-hidden="true" /> Enregistré sur Drive
              </p>
            )}

            {activeTab !== 'recurring' && formError && (
              <p role="alert" className="bg-error-container text-on-error-container p-3 rounded-xl text-sm font-medium flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" /> {formError}
              </p>
            )}

            {activeTab === 'deposit' ? (
              <form onSubmit={handleDeposit} className="space-y-5">
                {accountSelect('dep-account', 'Compte de destination', depositAccountId, setDepositAccountId, 'Choisir un compte', undefined, true)}
                <TextField id="dep-amount" label="Montant du dépôt" suffix="€" inputMode="decimal" placeholder="0,00" value={depositAmount} onChange={e => setDepositAmount(e.target.value)} />
                <Button type="submit" isLoading={saveStatus === 'pending'} className="w-full h-12!">Valider le dépôt</Button>
              </form>
            ) : activeTab === 'transfer' ? (
              <form onSubmit={handleTransfer} className="space-y-5">
                {accountSelect('tr-from', 'Compte de départ', sourceAccountId, setSourceAccountId, 'Choisir un compte', destAccountId)}
                <div className="flex justify-center -my-2"><ArrowDown className="w-5 h-5 text-on-surface-variant" aria-hidden="true" /></div>
                {accountSelect('tr-to', "Compte d'arrivée", destAccountId, setDestAccountId, 'Choisir un compte', sourceAccountId)}
                <TextField id="tr-amount" label="Montant du virement" suffix="€" inputMode="decimal" placeholder="0,00" value={transferAmount} onChange={e => setTransferAmount(e.target.value)} />
                <Button type="submit" isLoading={saveStatus === 'pending'} className="w-full h-12!">Enregistrer le virement</Button>
              </form>
            ) : (
              <RecurringManager accounts={accounts} recurringMovements={recurringMovements} onUpdate={onUpdateRecurring} />
            )}
          </div>
        </Card>
      </Tabs>
    </div>
  );
};
