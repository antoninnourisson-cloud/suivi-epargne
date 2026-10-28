// ================================================
// FILE: src/components/AppLockScreen.tsx
// Écran plein écran affiché tant que le verrou de cet appareil (biométrie et/ou PIN) n'a
// pas été validé (voir src/services/appLockService.ts pour la nature exacte, et les
// limites, de ce verrou ; src/hooks/useAppLock.ts pour « Code oublié »).
//
// Accessibilité : repère <main>, touche « effacer » nommée, nombre de chiffres saisis
// annoncé (région polie), refus et délai d'attente annoncés (role="alert", présent dès
// l'affichage), saisie au clavier physique, focus déplacé à chaque étape, touches jamais
// désactivées (aria-disabled) pour que le focus ne se perde pas après un refus.
// ================================================
import React, { useEffect, useRef, useState } from 'react';
import { Fingerprint, Loader2, AlertTriangle, Delete, LockKeyhole, Clock } from 'lucide-react';
import {
  isBiometricEnabled, isPinEnabled, verifyBiometric, verifyPin, getPinCooldownSeconds, type LockResetRequest,
} from '../services/appLockService';
import { Button } from './ui';

export interface ForgotOptions {
  /** Effacer aussi les modifications pas encore sur Drive (choix explicite). */
  discardUnsynced: boolean;
}

interface AppLockScreenProps {
  onUnlock: () => void;
  /**
   * Retrait confirmé, délai de la demande écoulé : ferme la session de l'appareil et efface
   * ce qu'il garde, puis suspend le verrou jusqu'à une reconnexion Google (voir useAppLock).
   * Rejette si la session n'a pas pu être fermée : le verrou reste alors affiché.
   */
  onForgot: (opts: ForgotOptions) => Promise<void>;
  /** Des modifications ne sont pas encore sur Drive : on le dit et on laisse choisir. */
  hasUnsyncedChanges?: boolean;
  /** Demande de retrait en cours (« Code oublié »), ou `null`. */
  resetRequest?: LockResetRequest | null;
  /** « Code oublié » : enregistre la demande de retrait. Peut lever (stockage refusé). */
  onRequestReset?: () => void;
  /** Annule la demande de retrait en cours. */
  onCancelRequest?: () => void;
}

// « mardi 20 octobre à 14:05 »
const formatWhen = (d: Date) =>
  d.toLocaleString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

// Les anciens codes à 4 ou 5 chiffres restent acceptés (voir appLockService).
const PIN_MIN_LENGTH = 4;
const PIN_MAX_LENGTH = 8;
const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

const digitsStatus = (n: number) =>
  n === 0 ? 'Aucun chiffre saisi.' : `${n} chiffre${n > 1 ? 's' : ''} saisi${n > 1 ? 's' : ''}.`;

const keyClass = 'h-14 rounded-2xl bg-surface-container-high text-on-surface text-xl font-medium hover:bg-surface-container-highest aria-disabled:opacity-50 aria-disabled:cursor-not-allowed transition-colors';

export const AppLockScreen: React.FC<AppLockScreenProps> = ({
  onUnlock, onForgot, hasUnsyncedChanges = false, resetRequest = null, onRequestReset, onCancelRequest,
}) => {
  const biometricOn = isBiometricEnabled();
  const pinOn = isPinEnabled();
  // unlock : code ou biométrie ; request : explication, puis demande de retrait ;
  // confirm : retrait (délai écoulé), avec le choix pour les modifications pas sur Drive.
  const [stage, setStage] = useState<'unlock' | 'request' | 'confirm'>('unlock');
  const hasRequest = !!resetRequest;
  // Message d'erreur annoncé (role="alert") ; vidé avant chaque essai pour qu'un même
  // message soit annoncé de nouveau.
  const [alert, setAlert] = useState('');
  const [info, setInfo] = useState('');
  const [checkingBiometric, setCheckingBiometric] = useState(false);
  const [pin, setPin] = useState('');
  const pinRef = useRef('');
  pinRef.current = pin;
  const [checkingPin, setCheckingPin] = useState(false);
  const [cooldown, setCooldown] = useState(() => getPinCooldownSeconds());
  const [discardUnsynced, setDiscardUnsynced] = useState(false);
  const [forgetting, setForgetting] = useState(false);

  const titleRef = useRef<HTMLHeadingElement>(null);
  const forgotTitleRef = useRef<HTMLHeadingElement>(null);
  const forgotButtonRef = useRef<HTMLButtonElement>(null);
  const requestTitleRef = useRef<HTMLHeadingElement>(null);

  // Focus : le titre à l'affichage (un lecteur d'écran annonce « Pécule verrouillé »), puis
  // le titre de chaque étape, puis, au retour, l'encadré de la demande s'il y en a une, sinon
  // le lien « Code oublié ». État précédent noté : un effet rejoué (StrictMode) ne déplace
  // pas le focus une 2e fois.
  const prevFocusRef = useRef<{ stage: typeof stage; hasRequest: boolean } | null>(null);
  useEffect(() => {
    const prev = prevFocusRef.current;
    prevFocusRef.current = { stage, hasRequest };
    if (prev && prev.stage === stage && prev.hasRequest === hasRequest) return;
    if (prev === null) titleRef.current?.focus();
    else if (stage !== 'unlock') forgotTitleRef.current?.focus();
    else (requestTitleRef.current ?? forgotButtonRef.current)?.focus();
  }, [stage, hasRequest]);

  const attemptBiometric = async () => {
    if (checkingBiometric) return;
    setCheckingBiometric(true);
    setAlert('');
    const ok = await verifyBiometric().catch(() => false);
    setCheckingBiometric(false);
    if (ok) { onUnlock(); return; }
    setAlert(pinOn ? 'Vérification annulée ou refusée. Réessayez, ou saisissez votre code.' : 'Vérification annulée ou refusée. Réessayez.');
  };

  // Tentative automatique à l'affichage si la biométrie est configurée : Face ID/Touch ID
  // se déclenchent immédiatement la plupart du temps, évitant un clic superflu. Le PIN
  // reste disponible en repli si elle échoue ou est annulée.
  // Valeurs du premier rendu figées dans une ref : la tentative n'a lieu qu'au montage, une
  // seule fois (la ref est vidée : un effet rejoué par StrictMode ne relance rien).
  const autoAttemptRef = useRef(biometricOn ? attemptBiometric : null);
  useEffect(() => {
    const attempt = autoAttemptRef.current;
    autoAttemptRef.current = null;
    if (attempt) void attempt();
  }, []);

  const submitPin = async (value: string) => {
    if (checkingPin) return;
    const wait = getPinCooldownSeconds();
    setAlert('');
    if (wait > 0) {
      setCooldown(wait);
      setAlert(`Patientez encore ${wait} seconde${wait > 1 ? 's' : ''} avant de réessayer.`);
      return;
    }
    setCheckingPin(true);
    setInfo('');
    const ok = await verifyPin(value).catch(() => false);
    setCheckingPin(false);
    if (ok) { onUnlock(); return; }
    const next = getPinCooldownSeconds();
    setCooldown(next);
    setPin('');
    setAlert(next > 0 ? `Code incorrect. Réessayez dans ${next} seconde${next > 1 ? 's' : ''}.` : 'Code incorrect. Réessayez.');
  };

  // Décompte visible du délai anti-essais (voir appLockService.getPinCooldownSeconds). La
  // fin du délai est annoncée une fois (région polie), pas chaque seconde.
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => {
      const left = getPinCooldownSeconds();
      setCooldown(left);
      if (left === 0) setInfo('Vous pouvez réessayer.');
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const pressDigit = (d: string) => {
    if (checkingPin) return;
    setPin(p => (p.length >= PIN_MAX_LENGTH ? p : p + d));
  };
  const pressBackspace = () => { if (!checkingPin) setPin(p => p.slice(0, -1)); };
  const canValidate = pin.length >= PIN_MIN_LENGTH && !checkingPin && cooldown <= 0;
  const pressValidate = () => {
    const value = pinRef.current;
    if (value.length >= PIN_MIN_LENGTH) void submitPin(value);
  };

  // Clavier physique : chiffres (rangée du haut ou pavé numérique), retour arrière, Entrée.
  // Entrée sur un bouton reste l'action de ce bouton ; les raccourcis (Ctrl, Cmd, Alt) ne
  // sont pas interceptés.
  useEffect(() => {
    if (!pinOn || stage !== 'unlock') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;
      if (/^[0-9]$/.test(e.key)) { e.preventDefault(); pressDigit(e.key); }
      else if (e.key === 'Backspace') { e.preventDefault(); pressBackspace(); }
      else if (e.key === 'Enter' && tag !== 'BUTTON' && tag !== 'A') { e.preventDefault(); pressValidate(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const openForgot = () => { setAlert(''); setInfo(''); setStage('request'); };
  const openConfirm = () => { setAlert(''); setInfo(''); setStage('confirm'); };
  const closeForgot = () => { setAlert(''); setStage('unlock'); };

  const submitRequest = () => {
    setAlert('');
    try {
      onRequestReset?.();
      setStage('unlock');
    } catch {
      setAlert('La demande n\'a pas pu être enregistrée sur cet appareil. Réessayez, ou rechargez Pécule.');
    }
  };

  const cancelRequest = () => {
    setAlert('');
    onCancelRequest?.();
    setInfo('Demande de retrait annulée.');
  };

  const confirmForgot = async () => {
    if (forgetting) return;
    setForgetting(true);
    setAlert('');
    try {
      await onForgot({ discardUnsynced: hasUnsyncedChanges && discardUnsynced });
    } catch (e) {
      const reason = e instanceof Error ? e.message : '';
      setAlert(reason === 'NOT_READY'
        ? 'Le retrait du verrou n\'est pas encore possible : le verrou reste en place.'
        // Les autres appareils doivent être prévenus avant tout retrait (useAppLock).
        : reason === 'ALERT_NOT_SENT'
          ? 'Vos autres appareils n\'ont pas pu être prévenus : connectez cet appareil à Internet, puis réessayez. Le verrou reste en place.'
          : 'La session de cet appareil n\'a pas pu être fermée : le verrou reste en place. Réessayez, ou rechargez Pécule.');
      setForgetting(false);
    }
  };

  return (
    <main className="min-h-screen bg-sapin flex flex-col items-center justify-center p-4" aria-labelledby="lock-title">
      <div className="bg-surface-container-low text-on-surface p-6 sm:p-8 rounded-3xl shadow-xl max-w-md w-full text-center">
        <div className="w-16 h-16 bg-sapin rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg">
          <LockKeyhole className="w-8 h-8 text-white" aria-hidden="true" />
        </div>
        <h1 id="lock-title" ref={titleRef} tabIndex={-1} className="text-2xl font-bold text-on-surface mb-2 outline-none">Pécule verrouillé</h1>
        <p className="text-on-surface-variant mb-4">Vérifiez votre identité pour accéder à vos données.</p>

        {/* Toujours présente dans la page : un lecteur d'écran annonce chaque nouveau message. */}
        <p role="alert" className="min-h-5 mb-4 text-sm font-medium text-error flex items-center justify-center gap-2">
          {alert && <><AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" /> {alert}</>}
        </p>
        <p role="status" className="sr-only">{info}</p>

        {stage === 'unlock' ? (
          <>
            {resetRequest && (
              <section aria-labelledby="lock-request-title" className="text-left rounded-2xl bg-secondary-container text-on-secondary-container p-4 mb-6 text-sm">
                <h2 id="lock-request-title" ref={requestTitleRef} tabIndex={-1} className="font-medium mb-1 flex items-center gap-2 outline-none">
                  <Clock className="w-4 h-4 shrink-0" aria-hidden="true" /> Retrait du verrou demandé
                </h2>
                <p className="mb-1">Demandé le {formatWhen(resetRequest.requestedAt)}.</p>
                <p className="mb-2">
                  {resetRequest.ready
                    ? `Vous pouvez maintenant retirer le verrou, jusqu'au ${formatWhen(resetRequest.expiresAt)}.`
                    : `Le retrait sera possible à partir du ${formatWhen(resetRequest.availableAt)}.`}
                </p>
                <p className="mb-2">Ce n'est pas vous ? Déverrouillez Pécule normalement : la demande sera annulée.</p>
                <div className="flex flex-wrap gap-2 -ml-1">
                  {resetRequest.ready && <Button variant="tonal" onClick={openConfirm}>Retirer le verrou</Button>}
                  <Button variant="text" onClick={cancelRequest}>Annuler la demande</Button>
                </div>
              </section>
            )}

            {biometricOn && (
              <Button
                variant="filled"
                className="w-full h-14!"
                onClick={() => { void attemptBiometric(); }}
                aria-busy={checkingBiometric || undefined}
              >
                {checkingBiometric
                  ? <><Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Vérification…</>
                  : <><Fingerprint className="w-4 h-4" aria-hidden="true" /> Déverrouiller</>}
              </Button>
            )}

            {biometricOn && pinOn && (
              <div className="flex items-center gap-3 my-6" aria-hidden="true">
                <div className="flex-1 h-px bg-outline-variant" />
                <span className="text-xs font-medium text-on-surface-variant">ou code PIN</span>
                <div className="flex-1 h-px bg-outline-variant" />
              </div>
            )}

            {pinOn && (
              <div>
                <p id="lock-pin-label" className="sr-only">Code PIN : tapez les chiffres au clavier ou avec les touches ci-dessous, puis validez.</p>
                <div className="flex justify-center gap-2 mb-2" aria-hidden="true">
                  {Array.from({ length: Math.max(PIN_MIN_LENGTH, pin.length) }).map((_, i) => (
                    <div key={i} className={`w-3 h-3 rounded-full ${i < pin.length ? 'bg-primary' : 'bg-surface-container-highest'}`} />
                  ))}
                </div>
                <p role="status" className="sr-only">{digitsStatus(pin.length)}</p>
                <p className="min-h-5 mb-2 text-xs text-on-surface-variant" aria-hidden="true">
                  {cooldown > 0 ? `Nouvel essai possible dans ${cooldown} s.` : ''}
                </p>
                <div role="group" aria-labelledby="lock-pin-label" className="grid grid-cols-3 gap-2 max-w-[240px] mx-auto">
                  {DIGITS.map(d => (
                    <button key={d} type="button" onClick={() => pressDigit(d)} aria-disabled={checkingPin || undefined} className={keyClass}>{d}</button>
                  ))}
                  <button type="button" onClick={pressBackspace} aria-label="Effacer le dernier chiffre" aria-disabled={checkingPin || pin.length === 0 || undefined} className={`${keyClass} flex items-center justify-center text-on-surface-variant`}>
                    <Delete className="w-5 h-5" aria-hidden="true" />
                  </button>
                  <button type="button" onClick={() => pressDigit('0')} aria-disabled={checkingPin || undefined} className={keyClass}>0</button>
                  <button
                    type="button"
                    onClick={pressValidate}
                    aria-disabled={!canValidate || undefined}
                    className="h-14 rounded-2xl bg-primary text-on-primary font-medium aria-disabled:opacity-40 aria-disabled:cursor-not-allowed flex items-center justify-center"
                  >
                    {checkingPin ? <><Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" /><span className="sr-only">Vérification…</span></> : 'OK'}
                  </button>
                </div>
              </div>
            )}

            {!resetRequest && (
              <div className="mt-6">
                <button
                  ref={forgotButtonRef}
                  type="button"
                  onClick={openForgot}
                  className="text-sm font-medium text-on-surface-variant hover:text-on-surface underline underline-offset-2"
                >
                  Code oublié ou biométrie indisponible ?
                </button>
              </div>
            )}
          </>
        ) : stage === 'request' ? (
          <section aria-labelledby="lock-forgot-title" className="text-left">
            <h2 id="lock-forgot-title" ref={forgotTitleRef} tabIndex={-1} className="text-lg font-medium text-on-surface mb-2 outline-none">
              Code oublié ou biométrie indisponible
            </h2>
            <p className="text-sm text-on-surface-variant mb-3">
              Pour protéger vos données, le verrou n'est jamais retiré sur place. Voici comment faire :
            </p>
            <ol className="list-decimal pl-5 space-y-1.5 text-sm text-on-surface mb-3">
              <li>Vous demandez le retrait. Il sera possible dans 24 heures, et pendant 7 jours. Vos autres appareils qui reçoivent les notifications de Pécule en sont prévenus. Si quelqu'un d'autre le demande à votre place, il suffit de déverrouiller Pécule pour l'annuler.</li>
              <li>Le moment venu, avec une connexion Internet (vos autres appareils doivent avoir été prévenus), Pécule ferme la session de cet appareil et efface ce qu'il y garde (clé Gemini, préférences d'affichage).</li>
              <li>Vous vous reconnectez avec Google : il faudra choisir votre compte et redonner votre accord.</li>
              <li>Une fois vos données chargées depuis Drive, le verrou est retiré. Vous pourrez en définir un nouveau dans Paramètres.</li>
            </ol>
            <p className="text-sm text-on-surface-variant mb-4">Vos données restent intactes sur votre Drive.</p>
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="text" onClick={closeForgot}>Annuler</Button>
              <Button variant="filled" onClick={submitRequest}>Demander le retrait</Button>
            </div>
          </section>
        ) : (
          <section aria-labelledby="lock-forgot-title" className="text-left">
            <h2 id="lock-forgot-title" ref={forgotTitleRef} tabIndex={-1} className="text-lg font-medium text-on-surface mb-2 outline-none">
              Retirer le verrou
            </h2>
            <p className="text-sm text-on-surface-variant mb-3">
              Voici ce qui va se passer :
            </p>
            <ol className="list-decimal pl-5 space-y-1.5 text-sm text-on-surface mb-3">
              <li>Pécule ferme la session de cet appareil et efface ce qu'il y garde (clé Gemini, préférences d'affichage).</li>
              <li>Vous vous reconnectez avec Google : il faudra choisir votre compte et redonner votre accord.</li>
              <li>Une fois vos données chargées depuis Drive, le verrou est retiré. Vous pourrez en définir un nouveau dans Paramètres.</li>
            </ol>
            <p className="text-sm text-on-surface-variant mb-4">Vos données restent intactes sur votre Drive.</p>

            {hasUnsyncedChanges && (
              <div role="radiogroup" aria-labelledby="lock-unsynced-title" className="mb-4 rounded-2xl bg-tertiary-container text-on-tertiary-container p-4 text-sm">
                <p id="lock-unsynced-title" className="font-medium mb-3 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
                  Des modifications faites sur cet appareil ne sont pas encore sur Drive.
                </p>
                <label className="flex items-start gap-3 mb-2 cursor-pointer">
                  <input type="radio" name="lock-unsynced" className="mt-1 accent-current" checked={!discardUnsynced} onChange={() => setDiscardUnsynced(false)} />
                  <span><span className="font-medium">Les garder sur cet appareil</span><br />Dans une copie chiffrée, proposée après votre reconnexion avec ce compte Google.</span>
                </label>
                <label className="flex items-start gap-3 cursor-pointer">
                  <input type="radio" name="lock-unsynced" className="mt-1 accent-current" checked={discardUnsynced} onChange={() => setDiscardUnsynced(true)} />
                  <span><span className="font-medium">Les effacer</span><br />Elles seront perdues.</span>
                </label>
              </div>
            )}

            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="text" onClick={() => { if (!forgetting) closeForgot(); }} aria-disabled={forgetting || undefined}>Annuler</Button>
              <Button variant="danger" onClick={() => { void confirmForgot(); }} aria-busy={forgetting || undefined}>
                {forgetting && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
                {hasUnsyncedChanges && discardUnsynced ? 'Effacer et me déconnecter' : 'Me déconnecter'}
              </Button>
            </div>
          </section>
        )}
      </div>
    </main>
  );
};
