// ================================================
// FILE: src/components/AccountTotal.tsx
// Solde TOTAL d'un compte partagé entre part propre et capital parental : c'est le montant
// qu'affiche la banque, qui ne fait pas la distinction. Rien si le compte n'a qu'une part.
// ================================================
import React from 'react';
import { formatEUR } from '../lib/format';

const hasTwoShares = (a: { ownedAmount: number; parentalCapital: number }) =>
  a.ownedAmount > 0 && a.parentalCapital > 0;

export const AccountTotal: React.FC<{ account: { ownedAmount: number; parentalCapital: number }; className?: string }> = ({ account, className }) =>
  hasTwoShares(account) ? (
    // Sur un écran étroit, le montant passe sous « Total banque : » plutôt que d'élargir
    // la colonne ; il n'est jamais coupé.
    <div className={`text-xs text-on-surface-variant ${className ?? ''}`} title="Montant affiché par la banque (votre part + celle de vos parents)">
      Total banque : <span className="whitespace-nowrap">{formatEUR(account.ownedAmount + account.parentalCapital, 2)}</span>
    </div>
  ) : null;
