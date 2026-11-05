// ================================================
// FILE: src/lib/commands/testHelpers.ts
// Aide pour les tests seulement : jamais importée par l'app.
// ================================================
import type { CommandPatch, CommandState } from './types';

/** Applique un patch à un état (enchaînement de commandes dans les tests). */
export const applyPatch = (state: CommandState, patch: CommandPatch): CommandState => ({ ...state, ...patch });
