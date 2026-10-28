// Mode solo : les textes qui parlent des parents ne s'affichent que tant que leur capital (ou
// sa restitution) compte. Après la restitution, plus aucun compte n'a de part parentale et les
// écrans passent d'eux-mêmes aux formulations en solo : janvier devient un simple changement
// de données, sans nouvelle version de l'app. Les fonctions et données parentales, elles,
// restent en place (historique, relevé de restitution, annulation).
import type { AccountMovement, ParentalRestitution, SavingsAccount } from '../types';

/** Un compte au moins porte encore du capital des parents. */
export const hasParentalCapital = (accounts: readonly Pick<SavingsAccount, 'parentalCapital'>[]): boolean =>
  accounts.some(a => a.parentalCapital > 0);

/**
 * Les parents ont compté à un moment : capital encore présent, mouvement de leur part dans
 * l'historique ou restitution enregistrée. Sert aux écrans qui montrent le passé (Journal).
 */
export const hasParentalHistory = (
  accounts: readonly (Pick<SavingsAccount, 'parentalCapital'> & { movements: Pick<AccountMovement, 'kind'>[] })[],
  restitution?: Pick<ParentalRestitution, 'done'>,
): boolean =>
  hasParentalCapital(accounts) || !!restitution?.done || accounts.some(a => a.movements.some(m => m.kind === 'parental'));
