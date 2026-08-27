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
// Seul un hash salé (SHA-256, Web Crypto native) est stocké — jamais le PIN en clair.
// Sur un site sans backend, un attaquant capable d'exécuter du JS sur la page pourrait de
// toute façon contourner cette vérification (même limite que la biométrie ci-dessus) ;
// le hash évite au moins qu'une simple lecture du localStorage révèle le PIN directement.
const hashPin = async (pin: string, saltB64: string): Promise<string> => {
  const encoder = new TextEncoder();
  const data = encoder.encode(saltB64 + ':' + pin);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return bufferToBase64(digest);
};

export const enablePin = async (pin: string): Promise<void> => {
  if (!/^\d{4,8}$/.test(pin)) throw new Error('PIN_INVALID_FORMAT');
  const salt = bufferToBase64(crypto.getRandomValues(new Uint8Array(16)).buffer);
  const hash = await hashPin(pin, salt);
  localStorage.setItem(PIN_SALT_KEY, salt);
  localStorage.setItem(PIN_HASH_KEY, hash);
};

export const disablePin = (): void => {
  localStorage.removeItem(PIN_HASH_KEY);
  localStorage.removeItem(PIN_SALT_KEY);
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
  const candidateHash = await hashPin(pin, salt);
  return candidateHash === storedHash;
};
