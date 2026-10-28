// ================================================
// FILE: src/hooks/useSaveFeedback.ts
// ================================================
import { createContext, useContext, useEffect, useRef, useState } from 'react';

export type SaveStatus = 'idle' | 'pending' | 'saved';

/** Dernière écriture Drive confirmée (null : aucune pendant cette session). */
export const LastSavedAtContext = createContext<Date | null>(null);

/**
 * Retour visuel HONNÊTE pour un bouton d'enregistrement.
 *
 * Piège évité : annoncer la réussite dès la mise à jour de l'état LOCAL, avant toute écriture
 * sur Drive. Si la sauvegarde échoue ensuite (conflit, session expirée, hors ligne),
 * l'utilisateur aurait déjà lu que c'était bon. Le statut se fonde donc sur `lastSavedAt`,
 * horodatage écrit UNIQUEMENT après une écriture Drive confirmée, et non sur la retombée de
 * `isSaving`.
 *
 * Usage : appeler `markPending()` au clic, puis afficher `status`. Le passage à 'saved'
 * n'intervient que lorsque `lastSavedAt` avance réellement. `lastSavedAt` vient du contexte
 * LastSavedAtContext (fourni par App) : seuls les écrans qui l'utilisent sont re-rendus à
 * chaque écriture, pas tous les écrans.
 */
export const useSaveFeedback = (resetAfterMs = 3000) => {
  const lastSavedAt = useContext(LastSavedAtContext);
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
