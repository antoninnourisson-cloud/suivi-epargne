// État du verrou de l'appareil (biométrie et/ou code PIN, voir src/services/appLockService.ts) :
// verrouillé à l'ouverture (rechargement et nouvel onglet compris), et au retour d'un passage
// en arrière-plan plus long que le délai choisi sur l'appareil (« Immédiatement » : dès la mise
// en arrière-plan). Un choix de fichier lancé par l'app ne verrouille pas (suspension bornée).
// Réinitialisation sûre en cas de code oublié.
//
// Une fois l'app affichée, le verrou se pose PAR-DESSUS (App.tsx) sans rien démonter : saisies,
// fenêtres et imports en cours sont retrouvés au déverrouillage. `revealed` dit si l'app a
// déjà été affichée dans cette page ; avant (ouverture), rien d'autre que le verrou n'est rendu.
//
// « Code oublié » ne déverrouille jamais. D'abord une DEMANDE de retrait, utilisable 24 heures
// plus tard seulement : le verrou reste affiché entre-temps, et tout déverrouillage réussi
// l'annule (le propriétaire en est averti). Les autres appareils du propriétaire reçoivent
// une notification (useLockResetAlert) ; le retrait est REFUSÉ tant qu'elle n'est pas
// partie (garder l'appareil hors ligne ne permet pas de l'éviter). Seule exception : plus de
// session serveur valable sur l'appareil ; l'alerte part alors avec la session suivante, dès
// la reconnexion (usePendingLockResetAlert). Ensuite seulement, la session de l'appareil est
// fermée et ce qu'il garde effacé, PUIS le verrou est suspendu (l'écran de connexion
// s'affiche, sans aucune donnée). Il n'est retiré qu'après une reconnexion Google complète
// suivie d'un chargement Drive réussi (`completeReset`). Si la session ne peut pas être
// fermée, le verrou reste affiché.
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import {
  isLockActive, getLockDelayMs, isLockResetPending, markLockResetPending, cancelLockReset, completeLockReset,
  getLockResetRequest, requestLockReset, cancelLockResetRequest, isLockResetAlertSent, markLockResetAlertSent,
  getPendingLockResetAlert, clearPendingLockResetAlert,
  type LockResetRequest,
} from '../services/appLockService';
import { hasStoredSession } from '../services/googleDriveService';
import { hasBackendSession, isBackendEnabled, notifyLockResetRequested } from '../services/backendService';

/**
 * Alerte des AUTRES appareils quand une demande de retrait est en cours sur celui-ci : le
 * serveur leur envoie une notification générique (date, type d'appareil), une seule fois par
 * demande. Hors ligne, nouvel essai au retour du réseau (ou à la prochaine ouverture).
 */
const useLockResetAlert = (request: LockResetRequest | null): void => {
  const requestedAt = request ? request.requestedAt.toISOString() : null;
  useEffect(() => {
    if (!requestedAt) return;
    let active = true;
    let sending = false;
    const trySend = async () => {
      const current = getLockResetRequest();
      if (!active || sending || !current || isLockResetAlertSent(current)) return;
      sending = true;
      try {
        if (await notifyLockResetRequested(current.requestedAt) === 'sent') markLockResetAlertSent(current);
      } finally { sending = false; }
    };
    void trySend();
    const onOnline = () => { void trySend(); };
    window.addEventListener('online', onOnline);
    return () => { active = false; window.removeEventListener('online', onOnline); };
  }, [requestedAt]);
};

/** Délai entre deux essais d'une alerte gardée à travers le retrait (session serveur attendue). */
export const PENDING_ALERT_RETRY_MS = 30_000;

/**
 * Alerte gardée à travers le retrait faute de session serveur : envoyée dès qu'une session
 * existe de nouveau (après la reconnexion Google), avec la date de la demande d'origine.
 * Lectures locales toutes les 30 s tant qu'elle attend, et au retour du réseau.
 */
const usePendingLockResetAlert = (pending: boolean): void => {
  useEffect(() => {
    if (!pending) return;
    let active = true;
    let sending = false;
    const trySend = async () => {
      const at = getPendingLockResetAlert();
      if (!active || sending || !at) return;
      if (!isBackendEnabled()) { clearPendingLockResetAlert(); return; }
      if (!hasBackendSession()) return;
      sending = true;
      try {
        if (await notifyLockResetRequested(at) === 'sent') clearPendingLockResetAlert();
      } finally { sending = false; }
    };
    void trySend();
    const timer = setInterval(() => { void trySend(); }, PENDING_ALERT_RETRY_MS);
    const onOnline = () => { void trySend(); };
    window.addEventListener('online', onOnline);
    return () => { active = false; clearInterval(timer); window.removeEventListener('online', onOnline); };
  }, [pending]);
};

/** Durée maximale de la suspension du verrou pendant un choix de fichier lancé par l'app. */
export const FILE_PICKER_GRACE_MS = 3 * 60 * 1000;

/** Instant noté au passage en arrière-plan : horloge du système et horloge monotone de la page. */
export interface HiddenStamp { wall: number; mono: number }

/**
 * Règle du retour au premier plan : verrouiller si l'app est restée en arrière-plan au moins
 * `delayMs`, sauf pendant un choix de fichier lancé par l'app (suspension bornée, encore
 * valable au retour). Durée : la plus longue des deux horloges (l'horloge monotone ne peut pas
 * être reculée ; celle du système compte aussi la mise en veille). Une horloge du système
 * reculée pendant l'absence verrouille.
 */
export const shouldLockOnReturn = (
  { hidden, now, delayMs, suspendedUntil }: { hidden: HiddenStamp | null; now: HiddenStamp; delayMs: number; suspendedUntil: number },
): boolean => {
  if (hidden === null) return false;
  if (now.wall <= suspendedUntil) return false;
  if (now.wall < hidden.wall) return true;
  return Math.max(now.wall - hidden.wall, now.mono - hidden.mono) >= delayMs;
};

const stampNow = (): HiddenStamp => ({ wall: Date.now(), mono: performance.now() });

/** Élément focalisable à retrouver au déverrouillage (encore dans la page, hors du verrou). */
const restorableFocus = (el: Element | null): HTMLElement | null =>
  el instanceof HTMLElement && el !== document.body && el.isConnected ? el : null;

export class LockResetError extends Error {
  constructor(readonly reason: 'SESSION_STILL_OPEN' | 'NOT_READY' | 'ALERT_NOT_SENT' = 'SESSION_STILL_OPEN') {
    super(reason);
    this.name = 'LockResetError';
  }
}

export const useAppLock = () => {
  // Verrouillé dès l'ouverture si une méthode est configurée sur CET appareil (jamais
  // synchronisé) et qu'aucune réinitialisation n'attend la reconnexion Google.
  const [locked, setLocked] = useState<boolean>(() => isLockActive());
  // L'app a déjà été affichée déverrouillée dans cette page : le verrou se pose alors
  // par-dessus, sans démonter les écrans (voir App.tsx).
  const [revealed, setRevealed] = useState(!locked);
  if (!locked && !revealed) setRevealed(true);
  // Élément qui avait le focus au verrouillage : il le retrouve au déverrouillage.
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  // La réinitialisation en attente et la demande de retrait sont relues à chaque rendu (des
  // lectures locales) : définir un nouveau verrou dans Paramètres termine aussi la première
  // (voir appLockService.enablePin).
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const resetPending = isLockResetPending();
  const resetRequest = getLockResetRequest();
  useLockResetAlert(resetRequest);
  usePendingLockResetAlert(getPendingLockResetAlert() !== null);

  // La demande change d'état avec le temps (retrait possible, puis expirée) : un rendu à
  // chacune de ces dates, pour un écran de verrouillage resté ouvert.
  const nextChange = resetRequest ? (resetRequest.ready ? resetRequest.expiresAt : resetRequest.availableAt).getTime() : null;
  useEffect(() => {
    if (nextChange === null) return;
    // setTimeout est borné à ~24,8 jours : bien au-delà des 7 jours d'une demande.
    const timer = setTimeout(rerender, Math.max(0, nextChange - Date.now()) + 1000);
    return () => clearTimeout(timer);
  }, [nextChange]);

  // Re-verrouille après un passage en arrière-plan (bouton Home, changement d'appli, écran
  // éteint...). Sur mobile, quitter l'app ne recharge pas la page — le process JS reste vivant
  // tant que l'OS ne le tue pas — donc sans ceci, un simple aller-retour laisserait l'app
  // déverrouillée indéfiniment. Délai lu à chaque fois (un changement dans Paramètres compte
  // tout de suite). « Immédiatement » verrouille dès la mise en arrière-plan, comme avant.
  //
  // Choix de fichier lancé par l'app (tout <input type="file"> de la page : relevé, fiche de
  // paie, avis d'imposition, import d'une sauvegarde…) : sur Android, le sélecteur met la page
  // en arrière-plan. Le verrou est suspendu du clic jusqu'au choix ou à l'annulation, ou au
  // retour de la page, et 3 minutes au plus (FILE_PICKER_GRACE_MS).
  useEffect(() => {
    let hidden: HiddenStamp | null = null;
    let suspendedUntil = 0;
    const lockNow = () => {
      if (lockedRef.current) return;
      lockedRef.current = true;
      returnFocusRef.current = restorableFocus(document.activeElement);
      // Rendu synchrone : au retour au premier plan, la surcouche doit être en place avant
      // la prochaine image, pas une image plus tard.
      flushSync(() => setLocked(true));
    };
    const endSuspension = () => {
      // Le choix peut être signalé avant le retour au premier plan : la suspension couvre
      // alors ce retour, qui la termine.
      if (document.visibilityState === 'visible') suspendedUntil = 0;
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hidden ??= stampNow();
        if (isLockActive() && getLockDelayMs() === 0 && Date.now() > suspendedUntil) lockNow();
        return;
      }
      const now = stampNow();
      const lock = isLockActive() && shouldLockOnReturn({ hidden, now, delayMs: getLockDelayMs(), suspendedUntil });
      hidden = null;
      suspendedUntil = 0;
      if (lock) lockNow();
    };
    // Page rendue depuis le cache de navigation (retour arrière) : même règle qu'un retour.
    const onPageShow = (e: PageTransitionEvent) => { if (e.persisted) onVisibility(); };
    const onClick = (e: MouseEvent) => {
      const input = e.target;
      if (!(input instanceof HTMLInputElement) || input.type !== 'file') return;
      suspendedUntil = Date.now() + FILE_PICKER_GRACE_MS;
      input.addEventListener('change', endSuspension, { once: true });
      input.addEventListener('cancel', endSuspension, { once: true });
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pageshow', onPageShow);
    document.addEventListener('click', onClick, true);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pageshow', onPageShow);
      document.removeEventListener('click', onClick, true);
    };
  }, []);

  // Déverrouillé : le focus revient là où il était (champ en cours de saisie, fenêtre ouverte).
  useEffect(() => {
    if (locked) return;
    const el = returnFocusRef.current;
    returnFocusRef.current = null;
    if (el?.isConnected) el.focus({ preventScroll: true });
  }, [locked]);

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
   * NOT_READY, sans rien effacer). Les autres appareils doivent d'abord avoir été prévenus :
   * sinon l'alerte est envoyée maintenant, et si elle ne part pas (hors ligne, serveur
   * injoignable) : `LockResetError` ALERT_NOT_SENT, sans rien effacer. Sans session serveur
   * valable, elle est gardée pour la session suivante. `wipeDevice` ferme ensuite la session
   * et efface ce que l'appareil garde ; le verrou n'est suspendu qu'après, et seulement si
   * plus aucune session ne reste (sinon la suite chargerait les données sans reconnexion) :
   * `LockResetError`. Toute erreur laisse le verrou affiché.
   */
  const forgetCode = useCallback(async (wipeDevice: () => Promise<void>) => {
    const request = getLockResetRequest();
    if (!request?.ready) throw new LockResetError('NOT_READY');
    let carryAlert = false;
    if (isBackendEnabled() && !isLockResetAlertSent(request)) {
      const result = await notifyLockResetRequested(request.requestedAt);
      if (result === 'failed') throw new LockResetError('ALERT_NOT_SENT');
      if (result === 'sent') markLockResetAlertSent(request);
      else carryAlert = true;
    }
    await wipeDevice();
    if (hasStoredSession()) throw new LockResetError('SESSION_STILL_OPEN');
    markLockResetPending(new Date(), { carryAlert });
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
    locked, revealed, resetPending, resetRequest, unlock, requestReset, cancelResetRequest, forgetCode, cancelReset, completeReset,
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
