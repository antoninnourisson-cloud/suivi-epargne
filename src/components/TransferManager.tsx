// src/components/TransferManager.tsx
// Comptes › Mouvements, au-dessus du journal (ex-écran Virements) : « Faire un virement », qui
// ouvre le bouton « Mouvement » sur Virement (seul formulaire de virement de l'app, voir
// QuickAddModal), et les échéances qui reviennent chaque mois, dans un panneau repliable.
import React from 'react';
import { SavingsAccount, RecurringMovement } from '../types';
import { ArrowRightLeft, Repeat } from 'lucide-react';
import { RecurringManager } from './RecurringManager';
import { Button } from './ui';
import { Disclosure } from './pilot/Disclosure';

interface TransferManagerProps {
  accounts: SavingsAccount[];
  /** Ouvre la feuille « Ajouter un mouvement » sur Virement. */
  onOpenTransfer: () => void;
  recurringMovements: RecurringMovement[];
  onUpdateRecurring: React.Dispatch<React.SetStateAction<RecurringMovement[]>>;
}

export const TransferManager: React.FC<TransferManagerProps> = ({ accounts, onOpenTransfer, recurringMovements, onUpdateRecurring }) => {
  // Sans compte : rien à virer ni à programmer (le journal dit déjà quoi faire).
  if (accounts.length === 0) return null;
  const activeCount = recurringMovements.filter(r => r.active).length;
  return (
    <div className="space-y-3">
      {/* Un virement demande deux comptes. */}
      {accounts.length >= 2 && (
        <Button variant="tonal" onClick={onOpenTransfer} className="pointer-coarse:h-12"><ArrowRightLeft className="w-4 h-4" aria-hidden="true" /> Faire un virement</Button>
      )}
      <Disclosure title="Échéances récurrentes" icon={Repeat}
        summary={recurringMovements.length > 0 ? `${activeCount} active${activeCount > 1 ? 's' : ''}` : undefined}>
        <RecurringManager accounts={accounts} recurringMovements={recurringMovements} onUpdate={onUpdateRecurring} />
      </Disclosure>
    </div>
  );
};
