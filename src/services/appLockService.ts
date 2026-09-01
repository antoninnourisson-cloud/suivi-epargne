// ================================================
// FILE: src/services/appLockService.ts
// Verrou LOCAL À L'APPAREIL, deux méthodes possibles (indépendantes, activables ensemble) :
// - Biométrie (WebAuthn, authenticateur "platform" — Face ID / Touch ID / empreinte
//   Android / Windows Hello).
// - Code PIN (repli si le matériel biométrique n'est pas disponible, ou par préférence).
//
// Important à comprendre : ceci n'est PAS une authentification serveur. L'app est un
// site statique sans backend (GitHub Pages) : il n'existe personne pour vérifier
// cryptographiquement la signature WebAuthn à distance. On se contente donc de la
// promesse resolve/reject de `navigator.credentials.get()` — elle est authentique (l'OS
// gère la vérification biométrique lui-même, aucune donnée biométrique ne transite en
// JS), mais quelqu'un capable d'exécuter du JS arbitraire sur la page (devtools) peut
// contourner ce verrou. C'est un frein contre l'accès occasionnel (téléphone déverrouillé
// ramassé par quelqu'un d'autre), pas une garantie cryptographique absolue.
//
// Le credential est stocké en localStorage, donc PROPRE À CHAQUE APPAREIL/NAVIGATEUR —
// jamais synchronisé sur Drive (une empreinte enregistrée sur un téléphone n'a aucun
// sens sur un autre appareil).
// ================================================

const CREDENTIAL_ID_KEY = 'app_lock_credential_id';
const PIN_HASH_KEY = 'app_lock_pin_hash';
const PIN_SALT_KEY = 'app_lock_pin_salt';
const RP_NAME = 'Suivi Épargne';

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

export const isBiometricEnabled = (): boolean => !!localStorage.getItem(CREDENTIAL_ID_KEY);
export const isPinEnabled = (): boolean => !!localStorage.getItem(PIN_HASH_KEY);
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
  if (!/^\d{4,8}$/.test(pin)) throw new Error('PIN_INVALID_FORMAT');
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
 * Utilisé par l'écran de verrouillage lui-même en cas de code oublié / biométrie
 * indisponible : puisque ce verrou n'est qu'un frein de confort local (voir l'en-tête de
 * ce fichier) et non une protection cryptographique des données (qui restent sur Drive,
 * inaccessibles sans le vrai compte Google), il n'y a pas de risque de sécurité à l'ouvrir
 * après confirmation explicite de l'utilisateur — l'alternative serait un verrouillage
 * définitif de l'app sur cet appareil, bien pire.
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
    if (storedIterations === 0) await enablePin(pin).catch(() => { /* le legacy reste valide */ });
  } else {
    try {
      const prev = JSON.parse(localStorage.getItem(PIN_FAILS_KEY) || '{"count":0}');
      localStorage.setItem(PIN_FAILS_KEY, JSON.stringify({ count: (prev.count || 0) + 1, at: Date.now() }));
    } catch { /* stockage plein : le backoff ne fonctionne juste pas */ }
  }
  return ok;
};
