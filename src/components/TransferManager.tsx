// src/components/TransferManager.tsx
// Comptes › Mouvements, au-dessus du journal (ex-écran Virements) : « Faire un virement », qui
// ouvre le bouton « Mouvement » sur Virement (seul formulaire de virement de l'app, voir
// QuickAddModal), le lien « J'ai besoin d'argent : où le prendre ? » (retrait guidé), et les
// échéances qui reviennent chaque mois, dans un panneau repliable.
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
  /** « J'ai besoin d'argent : où le prendre ? » : le retrait guidé. */
  onOpenNeed?: () => void;
  recurringMovements: RecurringMovement[];
  onUpdateRecurring: React.Dispatch<React.SetStateAction<RecurringMovement[]>>;
}

export const TransferManager: React.FC<TransferManagerProps> = ({ accounts, onOpenTransfer, onOpenNeed, recurringMovements, onUpdateRecurring }) => {
  // Sans compte : rien à virer ni à programmer (le journal dit déjà quoi faire).
  if (accounts.length === 0) return null;
  const activeCount = recurringMovements.filter(r => r.active).length;
  return (
    <div className="space-y-3">
      {/* Un virement demande deux comptes. */}
      {(accounts.length >= 2 || onOpenNeed) && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {accounts.length >= 2 && (
            <Button variant="tonal" onClick={onOpenTransfer} className="pointer-coarse:h-12"><ArrowRightLeft className="w-4 h-4" aria-hidden="true" /> Faire un virement</Button>
          )}
          {onOpenNeed && (
            <button type="button" onClick={onOpenNeed} className="min-h-12 text-sm font-medium text-primary underline underline-offset-4 decoration-primary/40 hover:decoration-primary text-left">
              J'ai besoin d'argent : où le prendre ?
            </button>
          )}
        </div>
      )}
      <Disclosure title="Échéances récurrentes" icon={Repeat}
        summary={recurringMovements.length > 0 ? `${activeCount} active${activeCount > 1 ? 's' : ''}` : undefined}>
        <RecurringManager accounts={accounts} recurringMovements={recurringMovements} onUpdate={onUpdateRecurring} />
      </Disclosure>
    </div>
  );
};
