// ================================================
// FILE: src/services/appLockService.ts
// Verrou LOCAL À L'APPAREIL, deux méthodes possibles (indépendantes, activables ensemble) :
// - Biométrie (WebAuthn, authenticateur "platform" — Face ID / Touch ID / empreinte
//   Android / Windows Hello).
// - Code PIN (repli si le matériel biométrique n'est pas disponible, ou par préférence).
//
// Important à comprendre : ceci n'est PAS une authentification serveur. Personne ne
// vérifie la signature WebAuthn à distance : on se contente de la promesse
// resolve/reject de `navigator.credentials.get()` — elle est authentique (l'OS gère la
// vérification biométrique lui-même, aucune donnée biométrique ne transite en JS), mais
// quelqu'un capable d'exécuter du JS arbitraire sur la page (devtools) peut contourner ce
// verrou. C'est un frein contre l'accès occasionnel (téléphone déverrouillé ramassé par
// quelqu'un d'autre), pas une garantie cryptographique absolue.
//
// Le credential est stocké en localStorage, donc PROPRE À CHAQUE APPAREIL/NAVIGATEUR —
// jamais synchronisé sur Drive (une empreinte enregistrée sur un téléphone n'a aucun
// sens sur un autre appareil).
//
// « Code oublié » ne retire JAMAIS le verrou sur place : demande, 24 heures d'attente, puis
// reconnexion Google (voir « Réinitialisation » en bas de ce fichier et src/hooks/useAppLock.ts).
// ================================================
import { lsDel, lsGet, lsSet } from '../lib/storage';

const CREDENTIAL_ID_KEY = 'app_lock_credential_id';
const PIN_HASH_KEY = 'app_lock_pin_hash';
const PIN_SALT_KEY = 'app_lock_pin_salt';
const RP_NAME = 'Pécule';

const bufferToBase64 = (buf: ArrayBuffer): string =>
  btoa(String.fromCharCode(...new Uint8Array(buf)));

const base64ToBuffer = (b64: string): ArrayBuffer => {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
};

/** Le matériel/navigateur de cet appareil supporte-t-il un authenticateur biométrique local ? */
export const isLockAvailable = async (): Promise<boolean> => {
  if (!window.PublicKeyCredential || !PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable) {
    return false;
  }
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
};

// Lectures sans exception : un stockage bloqué ne doit pas faire planter le démarrage.
export const isBiometricEnabled = (): boolean => !!lsGet(CREDENTIAL_ID_KEY);
export const isPinEnabled = (): boolean => !!lsGet(PIN_HASH_KEY);
// Verrouillé dès qu'AU MOINS une méthode est configurée sur cet appareil (biométrie et/ou
// PIN peuvent être actives en même temps ; le PIN sert de repli si le matériel biométrique
// n'est pas disponible, ou simplement par préférence).
export const isLockEnabled = (): boolean => isBiometricEnabled() || isPinEnabled();

/** Enregistre une empreinte/Face ID pour cet appareil. Lève si l'utilisateur annule. */
export const enableLock = async (): Promise<void> => {
  const credential = await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: RP_NAME },
      user: {
        id: crypto.getRandomValues(new Uint8Array(16)),
        name: 'verrou-local',
        displayName: 'Verrou de l\'app',
      },
      pubKeyCredParams: [
        { alg: -7, type: 'public-key' },   // ES256
        { alg: -257, type: 'public-key' }, // RS256 (compat élargie)
      ],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required' },
      timeout: 60000,
      attestation: 'none',
    },
  }) as PublicKeyCredential | null;

  if (!credential) throw new Error('LOCK_SETUP_FAILED');
  // Nouveau verrou pendant une réinitialisation (on n'atteint Paramètres qu'après la
  // reconnexion Google) : les anciennes méthodes partent d'abord, la nouvelle reste.
  completeLockReset();
  localStorage.setItem(CREDENTIAL_ID_KEY, bufferToBase64(credential.rawId));
};

/** Désactive la biométrie sur cet appareil (le credential côté OS reste, inoffensif, orphelin). */
export const disableBiometric = (): void => {
  localStorage.removeItem(CREDENTIAL_ID_KEY);
};

/**
 * Demande la vérification biométrique. Résout `true` si l'OS confirme l'identité,
 * `false` si l'utilisateur annule/échoue — jamais d'exception qui romprait l'écran de
 * verrouillage.
 */
export const verifyBiometric = async (): Promise<boolean> => {
  const storedId = localStorage.getItem(CREDENTIAL_ID_KEY);
  if (!storedId) return false; // biométrie non configurée sur cet appareil

  try {
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        allowCredentials: [{ id: base64ToBuffer(storedId), type: 'public-key' }],
        userVerification: 'required',
        timeout: 60000,
      },
    });
    return !!assertion;
  } catch {
    return false; // annulation, échec biométrique, ou credential introuvable sur cet appareil
  }
};

// --- PIN (repli si la biométrie n'est pas disponible, ou par préférence) ---
// Seul un hash salé est stocké — jamais le PIN en clair. Dérivation PBKDF2 (SHA-256,
// 310 000 itérations, reco OWASP) et non un simple SHA-256 : un PIN de 4-8 chiffres ne
// couvre que ~10⁴ à 10⁸ candidats, un hash "une passe" se casse donc instantanément
// hors-ligne depuis le localStorage. PBKDF2 rend l'énumération coûteuse ; verifyPin
// ajoute en plus un délai croissant après échecs. Rappel des limites (voir l'en-tête du
// fichier) : quelqu'un qui exécute du JS sur la page contourne le verrou de toute façon —
// ceci protège le CODE lui-même (souvent réutilisé ailleurs par son propriétaire : carte
// bleue, téléphone...), pas seulement l'accès à l'app.
const PIN_ITERATIONS = 310_000;
// Hashs d'avant cette migration (SHA-256 une passe, sans compteur d'itérations stocké) :
// encore vérifiables, puis migrés vers PBKDF2 au premier déverrouillage réussi.
const PIN_ITERATIONS_KEY = 'app_lock_pin_iterations';
const PIN_FAILS_KEY = 'app_lock_pin_fails';

const legacyHashPin = async (pin: string, saltB64: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(saltB64 + ':' + pin));
  return bufferToBase64(digest);
};

const pbkdf2Pin = async (pin: string, saltB64: string, iterations: number): Promise<string> => {
  const keyMaterial = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: new Uint8Array(base64ToBuffer(saltB64)), iterations },
    keyMaterial,
    256
  );
  return bufferToBase64(bits);
};

export const enablePin = async (pin: string): Promise<void> => {
  if (!/^\d{6,8}$/.test(pin)) throw new Error('PIN_INVALID_FORMAT');
  // Comme enableLock : un nouveau code termine une réinitialisation en attente.
  completeLockReset();
  await storePin(pin);
};

const storePin = async (pin: string): Promise<void> => {
  const salt = bufferToBase64(crypto.getRandomValues(new Uint8Array(16)).buffer);
  const hash = await pbkdf2Pin(pin, salt, PIN_ITERATIONS);
  localStorage.setItem(PIN_SALT_KEY, salt);
  localStorage.setItem(PIN_HASH_KEY, hash);
  localStorage.setItem(PIN_ITERATIONS_KEY, String(PIN_ITERATIONS));
  localStorage.removeItem(PIN_FAILS_KEY);
};

export const disablePin = (): void => {
  localStorage.removeItem(PIN_HASH_KEY);
  localStorage.removeItem(PIN_SALT_KEY);
  localStorage.removeItem(PIN_ITERATIONS_KEY);
  localStorage.removeItem(PIN_FAILS_KEY);
};

/**
 * Secondes à attendre avant le prochain essai (0 = essai autorisé). Backoff après échecs
 * consécutifs : 2^(n-3) s à partir du 4e, plafonné à 60 s — freine l'énumération manuelle
 * sans jamais verrouiller définitivement (le lien "Code oublié" reste la vraie sortie).
 */
export const getPinCooldownSeconds = (): number => {
  try {
    const raw = localStorage.getItem(PIN_FAILS_KEY);
    if (!raw) return 0;
    const { count, at } = JSON.parse(raw);
    if (!count || count < 4) return 0;
    const waitMs = Math.min(60_000, 2 ** (count - 3) * 1000);
    return Math.max(0, Math.ceil((at + waitMs - Date.now()) / 1000));
  } catch { return 0; }
};

/**
 * Désactive TOUTES les méthodes de verrouillage sur cet appareil (biométrie + PIN).
 * Jamais appelé directement par l'écran de verrouillage : seulement par
 * `completeLockReset`, une fois la réinitialisation prouvée (voir plus bas).
 */
export const resetAllLocks = (): void => {
  disableBiometric();
  disablePin();
};

export const verifyPin = async (pin: string): Promise<boolean> => {
  const storedHash = localStorage.getItem(PIN_HASH_KEY);
  const salt = localStorage.getItem(PIN_SALT_KEY);
  if (!storedHash || !salt) return false;
  if (getPinCooldownSeconds() > 0) return false;

  const storedIterations = parseInt(localStorage.getItem(PIN_ITERATIONS_KEY) || '0', 10);
  const candidate = storedIterations > 0
    ? await pbkdf2Pin(pin, salt, storedIterations)
    : await legacyHashPin(pin, salt); // format d'avant la migration PBKDF2

  const ok = candidate === storedHash;
  if (ok) {
    localStorage.removeItem(PIN_FAILS_KEY);
    // Migration transparente de l'ancien format au premier déverrouillage réussi.
    // Un ancien code à 4-5 chiffres ne respecte plus le format : il reste à l'ancien format.
    if (storedIterations === 0 && /^\d{6,8}$/.test(pin)) await storePin(pin).catch(() => { /* le legacy reste valide */ });
  } else {
    try {
      const prev = JSON.parse(localStorage.getItem(PIN_FAILS_KEY) || '{"count":0}');
      localStorage.setItem(PIN_FAILS_KEY, JSON.stringify({ count: (prev.count || 0) + 1, at: Date.now() }));
    } catch { /* stockage plein : le backoff ne fonctionne juste pas */ }
  }
  return ok;
};

// --- Réinitialisation (« Code oublié ») ---
// Menace visée par ce verrou : quelqu'un qui ramasse l'appareil DÉVERROUILLÉ. « Code
// oublié » ne doit donc pas suffire à entrer, même sur un téléphone où le compte Google du
// propriétaire est ouvert (Android : quelques touches suffisent pour se reconnecter). D'où :
//   0. une DEMANDE de retrait (`requestLockReset`), utilisable seulement 24 heures plus tard
//      et pendant 7 jours. Pendant ce temps le verrou reste affiché, avec la demande et ses
//      dates ; tout déverrouillage réussi (code ou biométrie) l'annule
//      (`cancelLockResetRequest`) et le propriétaire en est averti ;
//   1. puis la session de cet appareil est fermée (serveur compris) et ce qu'il garde effacé ;
//   2. le verrou est seulement SUSPENDU (`markLockResetPending`) : les méthodes restent
//      enregistrées, rien n'est lisible tant qu'on ne s'est pas reconnecté ;
//   3. reconnexion Google complète, avec choix du compte et nouveau consentement ;
//   4. le verrou n'est retiré (`completeLockReset`) qu'après un chargement Drive réussi.
// Retrouver son code entre-temps : `cancelLockReset` réactive le verrou tel quel.
// Limites connues (SECURITY.md) : ce verrou vit dans le stockage du navigateur. Effacer les
// données du site, ou avancer l'horloge de l'appareil, contourne le délai ; et quiconque
// peut se connecter au compte Google lit de toute façon le fichier sur Drive.
const RESET_REQUESTED_KEY = 'app_lock_reset_requested';
const RESET_PENDING_KEY = 'app_lock_reset_pending';
const LAST_RESET_KEY = 'app_lock_last_reset';
const HOUR_MS = 60 * 60 * 1000;
/** Délai entre la demande de retrait et le moment où il devient possible. */
export const LOCK_RESET_DELAY_MS = 24 * HOUR_MS;
/** Durée de validité d'une demande, comptée depuis la demande. */
export const LOCK_RESET_REQUEST_LIFETIME_MS = 7 * 24 * HOUR_MS;
// Une demande datée de plus de 5 minutes dans le futur (horloge reculée depuis) est
// ignorée, plutôt que de faire attendre sans fin.
const CLOCK_TOLERANCE_MS = 5 * 60 * 1000;

export interface LockResetRequest {
  requestedAt: Date;
  /** Le retrait est possible à partir de cette date. */
  availableAt: Date;
  /** La demande n'est plus valable à partir de cette date. */
  expiresAt: Date;
  /** Délai écoulé : le retrait peut commencer. */
  ready: boolean;
}

/** Demande de retrait encore valable, ou `null`. */
export const getLockResetRequest = (now: Date = new Date()): LockResetRequest | null => {
  const raw = lsGet(RESET_REQUESTED_KEY);
  const at = raw ? Date.parse(raw) : NaN;
  if (!Number.isFinite(at)) return null;
  const t = now.getTime();
  if (at > t + CLOCK_TOLERANCE_MS || t >= at + LOCK_RESET_REQUEST_LIFETIME_MS) return null;
  return {
    requestedAt: new Date(at),
    availableAt: new Date(at + LOCK_RESET_DELAY_MS),
    expiresAt: new Date(at + LOCK_RESET_REQUEST_LIFETIME_MS),
    ready: t >= at + LOCK_RESET_DELAY_MS,
  };
};

/**
 * « Code oublié » : enregistre la demande, le délai démarre. Une demande encore valable est
 * gardée telle quelle (redemander ne repousse rien). Lève si le stockage refuse l'écriture.
 */
export const requestLockReset = (now: Date = new Date()): LockResetRequest => {
  const existing = getLockResetRequest(now);
  if (existing) return existing;
  localStorage.setItem(RESET_REQUESTED_KEY, now.toISOString());
  const created = getLockResetRequest(now);
  if (!created) throw new Error('LOCK_RESET_REQUEST_NOT_SAVED');
  return created;
};

/**
 * Annule la demande (déverrouillage réussi, ou annulation explicite). Renvoie la demande
 * qui était en cours, pour en avertir le propriétaire, ou `null`.
 */
export const cancelLockResetRequest = (now: Date = new Date()): LockResetRequest | null => {
  const request = getLockResetRequest(now);
  lsDel(RESET_REQUESTED_KEY);
  return request;
};

/** Une réinitialisation attend la reconnexion Google (le verrou est suspendu). */
export const isLockResetPending = (): boolean => !!lsGet(RESET_PENDING_KEY);

/** Le verrou doit-il être affiché ? (Configuré, et pas suspendu par une réinitialisation.) */
export const isLockActive = (): boolean => isLockEnabled() && !isLockResetPending();

/**
 * Suspend le verrou. À appeler seulement APRÈS avoir fermé la session de l'appareil, et
 * une fois le délai de la demande écoulé (sinon lève `LOCK_RESET_NOT_READY`). Consomme la
 * demande. Lève si le stockage refuse l'écriture (le verrou reste alors affiché).
 */
export const markLockResetPending = (now: Date = new Date()): void => {
  if (!getLockResetRequest(now)?.ready) throw new Error('LOCK_RESET_NOT_READY');
  localStorage.setItem(RESET_PENDING_KEY, now.toISOString());
  lsDel(RESET_REQUESTED_KEY);
};

/** Code retrouvé : le verrou reprend tel qu'il était. */
export const cancelLockReset = (): void => lsDel(RESET_PENDING_KEY);

/**
 * Après une reconnexion Google et un chargement Drive réussis : retire le verrou si une
 * réinitialisation attendait, et note la date (affichée dans Paramètres, pour repérer un
 * retrait qu'on n'aurait pas fait soi-même). Renvoie `true` si le verrou vient d'être retiré.
 */
export const completeLockReset = (now: Date = new Date()): boolean => {
  if (!isLockResetPending()) return false;
  resetAllLocks();
  lsDel(RESET_PENDING_KEY);
  lsSet(LAST_RESET_KEY, now.toISOString());
  return true;
};

/** Date (ISO) du dernier retrait du verrou par « Code oublié », ou `null`. */
export const getLastLockReset = (): string | null => lsGet(LAST_RESET_KEY);
