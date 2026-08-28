// ================================================
// FILE: src/hooks/useSaveFeedback.ts
// ================================================
import { useEffect, useRef, useState } from 'react';

export type SaveStatus = 'idle' | 'pending' | 'saved';

/**
 * Retour visuel HONNÊTE pour un bouton d'enregistrement.
 *
 * Le piège corrigé ici : `AccountUpdate` et `TransferManager` affichaient
 * « ...avec succès ! » dès la mise à jour de l'état LOCAL, avant toute écriture sur Drive.
 * Si la sauvegarde échouait ensuite (conflit, session expirée, hors-ligne), l'utilisateur
 * avait déjà lu que c'était bon. C'est exactement la raison pour laquelle le toast global
 * d'App.tsx se base sur `lastSavedAt` — horodatage écrit UNIQUEMENT après une écriture
 * Drive confirmée — et non sur la retombée de `isSaving`.
 *
 * Usage : appeler `markPending()` au clic, puis afficher `status`. Le passage à 'saved'
 * n'intervient que lorsque `lastSavedAt` avance réellement.
 */
export const useSaveFeedback = (lastSavedAt: Date | null | undefined, resetAfterMs = 3000) => {
  const [status, setStatus] = useState<SaveStatus>('idle');
  // Horodatage observé au moment du clic : tout `lastSavedAt` strictement postérieur
  // constitue la preuve que NOTRE écriture est bien partie et a été acceptée.
  const awaitedFrom = useRef<number | null>(null);

  const markPending = () => {
    awaitedFrom.current = lastSavedAt ? lastSavedAt.getTime() : 0;
    setStatus('pending');
  };

  useEffect(() => {
    if (status !== 'pending' || awaitedFrom.current === null) return;
    if (!lastSavedAt) return;
    if (lastSavedAt.getTime() > awaitedFrom.current) {
      setStatus('saved');
      awaitedFrom.current = null;
    }
  }, [lastSavedAt, status]);

  useEffect(() => {
    if (status !== 'saved') return;
    const timer = setTimeout(() => setStatus('idle'), resetAfterMs);
    return () => clearTimeout(timer);
  }, [status, resetAfterMs]);

  return { status, markPending };
};
