// Mouvements d'un compte (fiche dépliée de « Mes comptes ») : une ligne sur deux niveaux
// (libellé et montant, puis la date courte), lisible à 412 px. La liste suit le défilement de
// la page (pas de zone défilante imbriquée) : 20 lignes, puis « Voir plus ». Renommer et
// supprimer sont dans un menu « ⋮ » sur téléphone, en boutons-icônes sur ordinateur.
import React, { useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import type { AccountMovement } from '../types';
import { isRestitutionMovement } from '../lib/accountOps';
import { parseISODate } from '../lib/dates';
import { formatEUR } from '../lib/format';
import { Button, IconButton, OverflowMenu } from './ui';

export type DisplayMovement = AccountMovement & { grouped?: boolean };

/** Lignes montrées d'abord, puis à chaque « Voir plus ». */
const MOVEMENTS_PAGE = 20;

const SHORT_DAY = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
/** « 28 sept. 2026 ». */
const shortDay = (iso: string) => SHORT_DAY.format(parseISODate(iso));

interface AccountMovementListProps {
  movements: DisplayMovement[];
  onRename: (movementId: string, currentLabel: string) => void;
  onDelete: (movementId: string) => void;
}

export const AccountMovementList: React.FC<AccountMovementListProps> = ({ movements, onRename, onDelete }) => {
  const [limit, setLimit] = useState(MOVEMENTS_PAGE);
  const shown = movements.slice(0, limit);
  const rest = movements.length - shown.length;
  if (movements.length === 0) return null;
  return (
    <>
      <ul aria-label="Mouvements" className="rounded-xl border border-outline-variant divide-y divide-outline-variant bg-surface-container-lowest dark:bg-surface-container-low">
        {shown.map(m => {
          const editable = !m.grouped && !isRestitutionMovement(m);
          return (
            <li key={m.id} className={`flex items-center gap-1 pl-3 pr-1 py-1 min-h-14 ${m.grouped ? 'italic' : ''}`}>
              <div className="flex-1 min-w-0 py-1.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm font-medium text-on-surface break-words min-w-0">{m.label}</span>
                  <span className={`shrink-0 tabular-nums whitespace-nowrap text-sm font-medium ${m.type === 'IN' ? 'text-gain' : 'text-loss'}`}>
                    {m.type === 'IN' ? '+' : '−'}{formatEUR(m.amount)}
                  </span>
                </div>
                <time dateTime={m.date} className="block text-xs text-on-surface-variant">{shortDay(m.date)}</time>
              </div>
              {editable ? (
                <>
                  <OverflowMenu
                    className="md:hidden"
                    label={`Actions pour « ${m.label} »`}
                    actions={[
                      { label: 'Renommer', icon: Pencil, onClick: () => onRename(m.id, m.label) },
                      { label: 'Supprimer', icon: Trash2, tone: 'danger', onClick: () => onDelete(m.id) },
                    ]}
                  />
                  <span className="max-md:hidden flex shrink-0">
                    <IconButton icon={Pencil} label={`Renommer « ${m.label} »`} onClick={() => onRename(m.id, m.label)} />
                    <IconButton icon={Trash2} tone="danger" label={`Supprimer « ${m.label} »`} onClick={() => onDelete(m.id)} />
                  </span>
                </>
              ) : (
                // Même largeur d'actions sur toutes les lignes : les montants restent alignés.
                <span className="w-12 md:w-24 shrink-0" aria-hidden="true" />
              )}
            </li>
          );
        })}
      </ul>
      {rest > 0 && (
        <Button variant="text" onClick={() => setLimit(l => l + MOVEMENTS_PAGE)} className="-ml-3">
          Voir plus{' '}<span className="text-on-surface-variant font-normal">({rest} autre{rest > 1 ? 's' : ''})</span>
        </Button>
      )}
    </>
  );
};
