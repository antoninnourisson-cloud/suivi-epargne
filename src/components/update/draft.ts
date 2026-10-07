// Brouillons de l'écran « Actualiser les soldes » (types partagés entre l'écran et ses lignes).
//
// `deposits` : versements cumulés des placements (PEA, AV…), '' = inconnus.
// `cashFlow` : argent réellement versé/retiré via l'ajustement rapide, pour distinguer
// un versement d'une simple variation de valeur à l'enregistrement.
// `touched` : champs saisis par l'utilisateur. Les champs NON modifiés suivent les comptes
// en direct (un ajout rapide fait pendant que l'écran est ouvert n'est plus écrasé par un
// ancien solde au moment d'enregistrer).
export type DraftField = 'owned' | 'parental' | 'date' | 'deposits' | 'cashFlow' | 'bankTotal';
export type Draft = { owned: string, parental: string, date: string, deposits: string, cashFlow: number, bankTotal?: string, touched?: DraftField[] };

// `isCash` (placements suivis) : l'ajustement est un versement/retrait d'argent, pas un
// gain ou une perte de valeur — il met alors à jour les versements cumulés.
export type Adjust = { sign: 1 | -1; amount: string; target: 'owned' | 'parental'; isCash: boolean };
export const DEFAULT_ADJUST: Adjust = { sign: 1, amount: '', target: 'owned', isCash: true };

/** Façon de saisir le nouveau solde d'un compte. */
export type EntryMode = 'balance' | 'bank' | 'adjust';
