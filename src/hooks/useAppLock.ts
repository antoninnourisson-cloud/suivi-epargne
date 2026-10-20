// État du verrou de l'appareil (biométrie et/ou code PIN, voir src/services/appLockService.ts) :
// verrouillé à l'ouverture et à chaque passage en arrière-plan, et réinitialisation sûre en
// cas de code oublié.
//
// « Code oublié » ne déverrouille jamais. D'abord une DEMANDE de retrait, utilisable 24 heures
// plus tard seulement : le verrou reste affiché entre-temps, et tout déverrouillage réussi
// l'annule (le propriétaire en est averti). Ensuite seulement, la session de l'appareil est
// fermée et ce qu'il garde effacé, PUIS le verrou est suspendu (l'écran de connexion
// s'affiche, sans aucune donnée). Il n'est retiré qu'après une reconnexion Google complète
// suivie d'un chargement Drive réussi (`completeReset`). Si la session ne peut pas être
// fermée, le verrou reste affiché.
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import {
  isLockActive, isLockResetPending, markLockResetPending, cancelLockReset, completeLockReset,
  getLockResetRequest, requestLockReset, cancelLockResetRequest, type LockResetRequest,
} from '../services/appLockService';
import { hasStoredSession } from '../services/googleDriveService';

export class LockResetError extends Error {
  constructor(readonly reason: 'SESSION_STILL_OPEN' | 'NOT_READY' = 'SESSION_STILL_OPEN') {
    super(reason);
    this.name = 'LockResetError';
  }
}

export const useAppLock = () => {
  // Verrouillé dès l'ouverture si une méthode est configurée sur CET appareil (jamais
  // synchronisé) et qu'aucune réinitialisation n'attend la reconnexion Google.
  const [locked, setLocked] = useState<boolean>(() => isLockActive());
  // La réinitialisation en attente et la demande de retrait sont relues à chaque rendu (des
  // lectures locales) : définir un nouveau verrou dans Paramètres termine aussi la première
  // (voir appLockService.enablePin).
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const resetPending = isLockResetPending();
  const resetRequest = getLockResetRequest();

  // La demande change d'état avec le temps (retrait possible, puis expirée) : un rendu à
  // chacune de ces dates, pour un écran de verrouillage resté ouvert.
  const nextChange = resetRequest ? (resetRequest.ready ? resetRequest.expiresAt : resetRequest.availableAt).getTime() : null;
  useEffect(() => {
    if (nextChange === null) return;
    // setTimeout est borné à ~24,8 jours : bien au-delà des 7 jours d'une demande.
    const timer = setTimeout(rerender, Math.max(0, nextChange - Date.now()) + 1000);
    return () => clearTimeout(timer);
  }, [nextChange]);

  // Re-verrouille dès que l'app passe en arrière-plan (bouton Home, changement d'appli,
  // écran éteint...). Sur mobile, quitter l'app ne recharge pas la page — le process JS
  // reste vivant tant que l'OS ne le tue pas — donc sans ceci, un simple aller-retour
  // laisserait l'app déverrouillée indéfiniment.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden' && isLockActive()) setLocked(true);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  /**
   * Déverrouillage réussi (code ou biométrie) : le propriétaire est là, une demande de
   * retrait en cours est annulée. Renvoie cette demande (pour l'en avertir), ou `null`.
   */
  const unlock = useCallback((): LockResetRequest | null => {
    const cancelled = cancelLockResetRequest();
    if (cancelled) rerender();
    setLocked(false);
    return cancelled;
  }, []);

  /** « Code oublié » : demande de retrait (le verrou reste affiché). Lève si le stockage refuse. */
  const requestReset = useCallback((): LockResetRequest => {
    const request = requestLockReset();
    rerender();
    return request;
  }, []);

  /** Annulation explicite de la demande, depuis l'écran de verrouillage. */
  const cancelResetRequest = useCallback(() => {
    cancelLockResetRequest();
    rerender();
  }, []);

  /**
   * Retrait confirmé, une fois le délai de la demande écoulé (sinon `LockResetError`
   * NOT_READY, sans rien effacer). `wipeDevice` ferme la session et efface ce que l'appareil
   * garde ; le verrou n'est suspendu qu'ensuite, et seulement si plus aucune session ne reste
   * (sinon la suite chargerait les données sans reconnexion) : `LockResetError`. Toute
   * erreur laisse le verrou affiché.
   */
  const forgetCode = useCallback(async (wipeDevice: () => Promise<void>) => {
    if (!getLockResetRequest()?.ready) throw new LockResetError('NOT_READY');
    await wipeDevice();
    if (hasStoredSession()) throw new LockResetError('SESSION_STILL_OPEN');
    markLockResetPending();
    rerender();
    setLocked(false);
  }, []);

  /** Code retrouvé avant de se reconnecter : le verrou reprend tel qu'il était. */
  const cancelReset = useCallback(() => {
    cancelLockReset();
    rerender();
    setLocked(isLockActive());
  }, []);

  /** Après un chargement Drive réussi. `true` si le verrou vient d'être retiré. */
  const completeReset = useCallback((): boolean => {
    const done = completeLockReset();
    if (done) rerender();
    return done;
  }, []);

  return {
    locked, resetPending, resetRequest, unlock, requestReset, cancelResetRequest, forgetCode, cancelReset, completeReset,
  };
};

/** État du chargement des données, vu par la fin d'une réinitialisation du verrou. */
export interface LockResetLoadState {
  /** Un chargement Drive était en cours au rendu précédent. */
  wasLoading: boolean;
  /** Un chargement Drive est en cours. */
  isLoading: boolean;
  isAuthenticated: boolean;
  /** Le dernier chargement a échoué (posé AVANT que le chargement ne se termine). */
  loadFailed: boolean;
}

/**
 * Règle de sécurité de « Code oublié » : le verrou suspendu n'est retiré qu'à la FIN d'un
 * chargement Drive (transition en cours -> terminé), réussi, avec une session ouverte.
 * Jamais après un échec, ni déconnecté (chargement abandonné à la déconnexion), ni sans
 * chargement qui vient de se terminer.
 */
export const shouldCompleteLockReset = (s: LockResetLoadState): boolean =>
  s.wasLoading && !s.isLoading && s.isAuthenticated && !s.loadFailed;

/**
 * Termine une réinitialisation en attente à la fin d'un chargement Drive réussi, quel que
 * soit le chemin (connexion, reconnexion, « Réessayer ») : voir `shouldCompleteLockReset`.
 * `onCompleted` n'est appelé que si le verrou vient vraiment d'être retiré.
 */
export const useLockResetCompletion = (
  { isLoading, isAuthenticated, loadFailed }: Omit<LockResetLoadState, 'wasLoading'>,
  completeReset: () => boolean,
  onCompleted: () => void,
): void => {
  const wasLoadingRef = useRef(false);
  const onCompletedRef = useRef(onCompleted);
  useEffect(() => { onCompletedRef.current = onCompleted; }, [onCompleted]);
  useEffect(() => {
    const wasLoading = wasLoadingRef.current;
    wasLoadingRef.current = isLoading;
    if (!shouldCompleteLockReset({ wasLoading, isLoading, isAuthenticated, loadFailed })) return;
    if (completeReset()) onCompletedRef.current();
  }, [isLoading, isAuthenticated, loadFailed, completeReset]);
};
