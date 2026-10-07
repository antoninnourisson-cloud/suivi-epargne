// Contrat commun des commandes métier (src/lib/commands) : fonctions PURES qui reçoivent
// l'état utile et une demande, et renvoient soit le nouvel état (avec de quoi l'annuler),
// soit un refus. Elles ne touchent ni à React ni au stockage : l'écran affiche le message,
// applique `next`, et rejoue `undo` sur l'état du moment si l'utilisateur annule.
import type { GlobalAppData } from '../../types';

/** Ce que les commandes lisent et modifient. */
export type CommandState = Pick<GlobalAppData, 'accounts' | 'parentalRestitution'>;

/** Champs modifiés : seuls les champs présents sont à appliquer (`parentalRestitution: undefined` = l'effacer). */
export type CommandPatch = Partial<CommandState>;

/**
 * Raison d'un refus :
 * - `not-found` : compte ou mouvement disparu entre-temps (l'écran reste silencieux) ;
 * - `forbidden` : interdit par une règle (capital des parents, restitution) ;
 * - `invalid` : saisie incohérente ;
 * - `already-done` / `nothing-to-do` : rien à faire dans l'état actuel.
 */
export type CommandErrorCode = 'not-found' | 'forbidden' | 'invalid' | 'already-done' | 'nothing-to-do';

export interface CommandError { ok: false; code: CommandErrorCode; error: string }

export type CommandOk<Extra = unknown> = {
  ok: true;
  next: CommandPatch;
  message: string;
  /**
   * Annulation exacte, à appliquer à l'état AU MOMENT de l'annulation : les soldes touchés
   * reviennent à l'instantané pris avant la commande, et ce qui a été fait depuis sur ces
   * comptes est conservé (voir restoreBalances).
   */
  undo: (current: CommandState) => CommandPatch;
} & Extra;

export type CommandResult<Extra = unknown> = CommandOk<Extra> | CommandError;

export const fail = (code: CommandErrorCode, error: string): CommandError => ({ ok: false, code, error });

/** Applique un patch à un état (tests, enchaînement de commandes). */
export const applyPatch = (state: CommandState, patch: CommandPatch): CommandState => ({ ...state, ...patch });
