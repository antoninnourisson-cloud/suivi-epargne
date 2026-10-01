// ================================================
// FILE: src/components/AccountTotal.tsx
// Solde TOTAL d'un compte partagé entre part propre et capital parental : c'est le montant
// qu'affiche la banque, qui ne fait pas la distinction. Rien si le compte n'a qu'une part.
// ================================================
import React from 'react';
import { formatEUR } from '../lib/format';

export const hasTwoShares = (a: { ownedAmount: number; parentalCapital: number }) =>
  a.ownedAmount > 0 && a.parentalCapital > 0;

export const AccountTotal: React.FC<{ account: { ownedAmount: number; parentalCapital: number }; className?: string }> = ({ account, className }) =>
  hasTwoShares(account) ? (
    <div className={`text-[11px] font-bold text-slate-500 dark:text-slate-400${className ?? ''}`} title="Montant affiché par la banque (votre part + celle de vos parents)">
      Total banque : {formatEUR(account.ownedAmount + account.parentalCapital, 2)}
    </div>
  ) : null;
