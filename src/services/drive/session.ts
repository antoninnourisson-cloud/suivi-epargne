// ================================================
// FILE: src/services/drive/session.ts
// Session Google : SDK chargés à la demande, jeton, connexion, déconnexion, requêtes Drive authentifiées.
// Découpé de googleDriveService.ts sans changement de comportement.
// ================================================
import { isBackendEnabled, hasBackendSession, fetchAccessToken, startBackendLogin, backendLogout, consumeLoginCode, saveBackendSession, type LoginOptions } from '../backendService';
import { storageKey } from '../../lib/storageKeys';
import { NetworkError, asNetworkError } from '../../lib/networkError';

const TOKEN_KEY = storageKey('googleToken');
const TOKEN_EXPIRY_KEY = storageKey('googleTokenExpiry');
const AUTH_PERSISTENCE_KEY = storageKey('googleAuthPersistence');

export const CLIENT_ID = '763862877733-hl1an9vcn0ibnoq2iq035927528mimd5.apps.googleusercontent.com';
const SCOPES = 'https://www.googleapis.com/auth/drive.file';


// Types minimaux des SDK Google (gapi pour le Picker, GIS pour la connexion sans serveur) :
// uniquement ce que l'app utilise. Ils sont chargés à la demande (voir loadScript).
interface TokenResponse { access_token?: string; expires_in?: number; error?: string }
type TokenCallback = ((resp: TokenResponse) => void) | '';
interface TokenClient { callback: TokenCallback; requestAccessToken: (opts: { prompt: string }) => void }
interface Gapi {
  load: (lib: string, cb: (() => void) | { callback: () => void; onerror: (e?: unknown) => void }) => void;
}
export interface PickerCallbackData { action: string; docs?: { id: string; name: string; mimeType: string }[] }
interface PickerDocsView {
  setMimeTypes: (types: string) => PickerDocsView;
  setIncludeFolders: (on: boolean) => PickerDocsView;
  setSelectFolderEnabled: (on: boolean) => PickerDocsView;
}
interface PickerBuilder {
  addView: (view: PickerDocsView) => PickerBuilder;
  setOAuthToken: (token: string) => PickerBuilder;
  setAppId: (id: string) => PickerBuilder;
  setDeveloperKey: (key: string) => PickerBuilder;
  setCallback: (cb: (data: PickerCallbackData) => void) => PickerBuilder;
  build: () => { setVisible: (on: boolean) => void };
}
export interface PickerApi {
  DocsView: new (viewId: string) => PickerDocsView;
  ViewId: { DOCS: string };
  PickerBuilder: new () => PickerBuilder;
  Action: { PICKED: string; CANCEL: string };
}
interface GoogleSdk {
  accounts: { oauth2: {
    initTokenClient: (opts: { client_id: string; scope: string; callback: TokenCallback; include_granted_scopes?: boolean }) => TokenClient;
    revoke: (token: string, done: () => void) => void;
  } };
  picker: PickerApi;
}
interface GoogleGlobals { gapi: Gapi; google: GoogleSdk }
export const googleWindow = () => window as unknown as Partial<GoogleGlobals>;

let tokenClient: TokenClient | undefined;

// Callback déclenché quand la session est définitivement perdue (401 + refresh KO).
// L'UI s'y abonne pour afficher une bannière de reconnexion.
let onAuthLost: (() => void) | null = null;
export const setOnAuthLost = (cb: (() => void) | null) => { onAuthLost = cb; };

// --- SDK GOOGLE, CHARGÉS À LA DEMANDE ---
// Plus aucun <script> Google dans index.html : toutes les requêtes Drive passent par fetch.
// En mode serveur, rien n'en a besoin au démarrage (environ 260 Kio et 1 à 2 s gagnés à
// chaque ouverture, et l'app démarre hors ligne). GIS ne sert qu'à la connexion sans serveur,
// api.js qu'au Google Picker (dons, fiches de paie). La CSP d'index.html (script-src)
// autorise toujours ces deux origines.
const GIS_SRC = 'https://accounts.google.com/gsi/client';
export const GAPI_SRC = 'https://apis.google.com/js/api.js';
// Délai maximal de chargement d'un SDK : au-delà, on échoue avec un message plutôt que de
// laisser l'écran en attente.
const SDK_WAIT_TIMEOUT_MS = 20_000;

/** Échec de chargement d'un SDK Google : traité comme un problème réseau (NetworkError). */
const sdkUnavailable = (what: string) => new NetworkError(`GOOGLE_SDK_UNAVAILABLE:${what}`);

const scriptLoads = new Map<string, Promise<void>>();
/** Insère le script une seule fois ; un échec (hors ligne, bloqueur) laisse réessayer plus tard. */
export const loadScript = (src: string): Promise<void> => {
  const pending = scriptLoads.get(src);
  if (pending) return pending;
  const loading = new Promise<void>((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    el.async = true;
    const timer = setTimeout(() => fail(), SDK_WAIT_TIMEOUT_MS);
    const fail = () => { clearTimeout(timer); el.remove(); reject(sdkUnavailable(src)); };
    el.onload = () => { clearTimeout(timer); resolve(); };
    el.onerror = fail;
    document.head.appendChild(el);
  });
  scriptLoads.set(src, loading);
  loading.catch(() => { if (scriptLoads.get(src) === loading) scriptLoads.delete(src); });
  return loading;
};

/** Attend qu'un objet défini par un SDK soit disponible (il l'est d'ordinaire dès le chargement). */
export const waitFor = <T,>(get: () => T | undefined, what: string, timeoutMs = SDK_WAIT_TIMEOUT_MS): Promise<T> =>
  new Promise((resolve, reject) => {
    const existing = get();
    if (existing) { resolve(existing); return; }
    const startedAt = Date.now();
    const timer = setInterval(() => {
      const value = get();
      if (value) { clearInterval(timer); resolve(value); return; }
      if (Date.now() - startedAt >= timeoutMs) { clearInterval(timer); reject(sdkUnavailable(what)); }
    }, 100);
  });

let tokenClientLoad: Promise<TokenClient> | null = null;
/** Client de jeton de Google Identity Services (connexion sans serveur), chargé au premier besoin. */
const ensureTokenClient = (): Promise<TokenClient> => {
  if (tokenClient) return Promise.resolve(tokenClient);
  if (!tokenClientLoad) {
    tokenClientLoad = (async () => {
      await loadScript(GIS_SRC);
      const oauth2 = await waitFor(() => googleWindow().google?.accounts?.oauth2, 'gis');
      tokenClient = oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        // Seulement drive.file : sans ça, Google rajoute les autorisations accordées autrefois
        // (gmail.send) et affiche « Google n'a pas validé cette application ».
        include_granted_scopes: false,
        callback: '',
      });
      return tokenClient;
    })();
    tokenClientLoad.catch(() => { tokenClientLoad = null; });
  }
  return tokenClientLoad;
};

/**
 * Prépare le bouton de connexion. Mode serveur : rien à charger (la connexion est une
 * redirection vers le Worker). Sans serveur : charge Google Identity Services.
 */
export const initGoogleApi = async (): Promise<void> => {
  if (isBackendEnabled()) return;
  await ensureTokenClient();
};

// --- GESTION DU TOKEN ---
const storeToken = (resp: TokenResponse) => {
  localStorage.setItem(TOKEN_KEY, JSON.stringify(resp));
  // Les expires_in de GIS valent ~3600s ; on garde une marge.
  const ttl = (resp.expires_in ? resp.expires_in : 3500) * 1000;
  localStorage.setItem(TOKEN_EXPIRY_KEY, (Date.now() + ttl - 60_000).toString());
  localStorage.setItem(AUTH_PERSISTENCE_KEY, 'true');
};

export const isTokenValid = (): boolean => {
  const expiry = localStorage.getItem(TOKEN_EXPIRY_KEY);
  return expiry ? parseInt(expiry) > Date.now() : false;
};

// Demande un token. prompt='' réutilise le consentement déjà accordé (pas de
// ré-affichage de l'écran de consentement) ; prompt='none' = refresh silencieux.
//
// `tokenClient.callback` est un champ UNIQUE et partagé : deux requestToken concurrents
// se marchent dessus, le second écrasant le callback du premier, dont la promesse ne se
// règle alors jamais (ni resolve ni reject). Symptôme observé : une sauvegarde figée
// indéfiniment, `isSaving` collé à true, sans aucune erreur remontée. On ajoute donc un
// timeout pour qu'une promesse orpheline échoue au lieu de pendre pour toujours.
const TOKEN_TIMEOUT_MS = 30_000;
const requestToken = async (prompt: '' | 'none' | 'consent' | 'select_account consent'): Promise<void> => {
  // GIS chargé au premier besoin ; un échec de chargement remonte en NetworkError (« hors ligne »).
  const client = await ensureTokenClient();
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('TOKEN_REQUEST_TIMEOUT'));
    }, TOKEN_TIMEOUT_MS);
    client.callback = (resp: TokenResponse) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (resp.error) { reject(resp); return; }
      // storeToken fait des localStorage.setItem qui PEUVENT jeter (mode privé Safari,
      // quota plein, stockage désactivé). `settled` étant déjà true et le timer annulé,
      // une exception qui s'échapperait ici laisserait la promesse pendante à jamais —
      // login gelé et tous les appels Drive suivants bloqués derrière refreshInFlight.
      try {
        storeToken(resp);
      } catch {
        reject(new Error('TOKEN_STORAGE_FAILED'));
        return;
      }
      resolve();
    };
    client.requestAccessToken({ prompt });
  });
};

// Connexion manuelle (bouton). prompt='' évite de redemander le consentement à
// chaque fois une fois qu'il a été donné. `chooseAccount` (réinitialisation du verrou de
// l'appareil) : choix du compte et consentement toujours affichés, jamais de connexion
// silencieuse au compte déjà ouvert dans le navigateur.
export const handleAuthClick = async (silent: boolean = false, opts: LoginOptions = {}): Promise<void> => {
  if (isBackendEnabled()) {
    // Mode serveur : silencieux = le Worker émet un jeton frais à partir du refresh token ;
    // sinon, redirection vers la connexion Google (la page quitte l'app, d'où la promesse
    // jamais résolue — le retour recharge tout).
    if (silent) return refreshTokenSilently();
    startBackendLogin(opts);
    return new Promise<void>(() => {});
  }
  await requestToken(silent ? 'none' : opts.chooseAccount ? 'select_account consent' : '');
};

/** Cet appareil garde-t-il de quoi accéder à Drive (jeton Google ou session serveur) ? */
export const hasStoredSession = (): boolean => {
  try { if (localStorage.getItem(TOKEN_KEY)) return true; } catch { /* stockage bloqué */ }
  return isBackendEnabled() && hasBackendSession();
};

/**
 * Mode serveur : finalise une connexion si l'URL porte le code de retour du Worker.
 * Renvoie true si une session vient d'être ouverte.
 */
export const completeBackendLoginIfPresent = async (): Promise<boolean> => {
  if (!isBackendEnabled()) return false;
  const result = await consumeLoginCode();
  if (!result) return false;
  storeToken({ access_token: result.access_token, expires_in: result.expires_in });
  saveBackendSession(result.session);
  // Notifications déjà activées sur cet appareil : rattachées à la nouvelle session (sinon
  // elles s'arrêteraient avec l'ancienne). En arrière-plan, sans bloquer la connexion.
  void import('../pushService').then(m => m.refreshPushRegistration()).catch(() => undefined);
  return true;
};

// Rafraîchissement mutualisé : plusieurs appels concurrents (ex. une sauvegarde Drive et
// une lecture qui partent ensemble sur un token expiré) doivent partager UNE seule
// requête en vol, sinon ils s'écrasent mutuellement le callback ci-dessus.
let refreshInFlight: Promise<void> | null = null;
const refreshTokenSilently = (): Promise<void> => {
  if (!refreshInFlight) {
    // Mode serveur : le jeton vient du Worker (refresh token longue durée), plus de l'iframe
    // silencieuse de GIS — celle qui échouait régulièrement en PWA et forçait à se reconnecter.
    const pending = isBackendEnabled() ? fetchAccessToken().then(storeToken) : requestToken('none');
    refreshInFlight = pending.finally(() => { refreshInFlight = null; });
  }
  return refreshInFlight;
};

/**
 * Au démarrage, la session de cet appareil est-elle utilisable ?
 * - 'ready' : jeton valide (ou rafraîchi), Drive peut être chargé ;
 * - 'offline' : session gardée, mais réseau ou serveur injoignable : l'app s'ouvre sur la
 *   dernière copie connue (voir usePortfolioData) et recharge Drive au retour du réseau ;
 * - 'signed-out' : aucune session, ou session refusée : écran de connexion.
 * Aucun SDK Google n'est attendu en mode serveur, et rien n'est tenté hors ligne.
 * Lève une TypeError si le code de retour de connexion n'a pas pu être échangé faute de
 * réseau alors qu'aucune session n'existait.
 * `onNewLogin` : appelé quand une connexion vient d'aboutir (code de retour du Worker),
 * peut-être avec un autre compte Google que la session précédente.
 */
export type SessionStart = 'ready' | 'offline' | 'signed-out';
export const resumeSession = async (opts: { onNewLogin?: () => void } = {}): Promise<SessionStart> => {
  if (isBackendEnabled()) {
    try {
      if (await completeBackendLoginIfPresent()) { opts.onNewLogin?.(); return 'ready'; }
    } catch (e) {
      // Code de connexion refusé ou serveur injoignable : une session plus ancienne reste utilisable.
      if (!hasBackendSession()) throw e;
    }
    if (!hasBackendSession()) return 'signed-out';
  } else {
    let persisted = false;
    try { persisted = !!localStorage.getItem(TOKEN_KEY) && localStorage.getItem(AUTH_PERSISTENCE_KEY) === 'true'; } catch { /* stockage bloqué */ }
    if (!persisted) return 'signed-out';
  }
  if (isTokenValid()) return 'ready';
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline';
  try {
    await refreshTokenSilently();
    return 'ready';
  } catch (e) {
    // Réseau, serveur ou SDK injoignable : la session n'est pas en cause.
    return e instanceof TypeError ? 'offline' : 'signed-out';
  }
};

// Exporté pour le Google Picker (voir openDrivePicker), qui a besoin du token courant
// pour n'afficher/autoriser que ce à quoi le compte connecté a accès.
export const getAccessToken = async (): Promise<string> => {
  const stored = localStorage.getItem(TOKEN_KEY);
  if (!stored && !(isBackendEnabled() && hasBackendSession())) throw new Error('NO_TOKEN');
  if (!stored || !isTokenValid()) {
    // Tente un refresh silencieux avant d'échouer.
    await refreshTokenSilently();
  }
  // Relecture APRÈS l'await : si handleAuthLost/handleSignOut a purgé le token dans
  // l'intervalle, JSON.parse(null) jetait un TypeError — que le chemin de sauvegarde
  // classait à tort comme "hors ligne" (il réserve TypeError aux échecs réseau de fetch),
  // gelant l'autosave sans aucune bannière. On lève une erreur explicitement typée.
  const fresh = localStorage.getItem(TOKEN_KEY);
  if (!fresh) throw new Error('SESSION_EXPIRED');
  return JSON.parse(fresh).access_token;
};

const handleAuthLost = () => {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(TOKEN_EXPIRY_KEY);
  localStorage.removeItem(AUTH_PERSISTENCE_KEY);
  if (onAuthLost) onAuthLost();
};

// Erreur d'API portant le statut HTTP : permet aux appelants de réagir différemment à un
// 404 (fichier supprimé côté Drive → re-résolution) qu'à un 500 (bannière d'erreur).
// `reason` : la raison donnée par Drive (`error.errors[0].reason`, ex. storageQuotaExceeded,
// userRateLimitExceeded) : elle distingue une panne passagère d'un blocage durable (voir
// src/lib/syncErrors.ts).
export class ApiError extends Error {
  status: number;
  reason?: string;
  constructor(message: string, status: number, reason?: string) { super(message); this.name = 'ApiError'; this.status = status; this.reason = reason; }
}

/** Raison d'erreur dans le corps d'une réponse Drive (`{ error: { errors: [{ reason }] } }`). */
export const driveErrorReason = (body: string): string | undefined => {
  try {
    const err = (JSON.parse(body) as { error?: { errors?: { reason?: unknown }[]; status?: unknown } }).error;
    const reason = err?.errors?.[0]?.reason ?? err?.status;
    return typeof reason === 'string' && reason ? reason : undefined;
  } catch { return undefined; }
};

const ensureOk = async (res: Response): Promise<Response> => {
  if (res.ok) return res;
  const body = await res.text().catch(() => '');
  throw new ApiError(`Google API ${res.status} ${res.statusText} — ${body.slice(0, 300)}`, res.status, driveErrorReason(body));
};

// Toute requête a un délai maximal : sans lui, un fetch qui pend (portail captif, TLS
// bloqué) laisserait le mutex de sauvegarde occupé POUR TOUJOURS — plus aucune écriture
// Drive ne partirait, isSaving resterait allumé, zéro message. Tout échec du fetch lui-même
// (réseau coupé, DNS, délai dépassé) est enveloppé en NetworkError : c'est la SEULE erreur que
// la synchronisation classe « hors ligne » (voir lib/networkError).
const FETCH_TIMEOUT_MS = 30_000;
const fetchWithTimeout = async (url: string, options: RequestInit = {}): Promise<Response> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (e: unknown) {
    if ((e as { name?: string } | null)?.name === 'AbortError') throw new NetworkError('NETWORK_TIMEOUT', { cause: e });
    throw asNetworkError(e);
  } finally {
    clearTimeout(timer);
  }
};

// Fetch authentifié : injecte le token, retente une fois après refresh sur 401,
// et lève une erreur claire sinon (jamais de réponse d'erreur traitée comme data).
export const authedFetch = async (url: string, options: RequestInit = {}): Promise<Response> => {
  const build = async () => {
    const token = await getAccessToken();
    return fetchWithTimeout(url, { ...options, headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` } });
  };
  let res = await build();
  if (res.status === 401) {
    try {
      await refreshTokenSilently();
    } catch (e) {
      // Réseau/serveur injoignable (TypeError) : c'est « hors ligne », pas une session
      // perdue — sinon une simple coupure pendant un rafraîchissement déconnectait.
      if (e instanceof TypeError) throw e;
      handleAuthLost();
      throw new Error('SESSION_EXPIRED', { cause: e });
    }
    res = await build();
    if (res.status === 401) { handleAuthLost(); throw new Error('SESSION_EXPIRED'); }
  }
  return ensureOk(res);
};

// --- DÉCONNEXION ---
export const handleSignOut = async () => {
  const stored = localStorage.getItem(TOKEN_KEY);
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(TOKEN_EXPIRY_KEY);
  localStorage.removeItem(AUTH_PERSISTENCE_KEY);
  if (isBackendEnabled()) {
    // Surtout PAS de révocation Google ici : révoquer un jeton d'accès révoque tout
    // l'accord, refresh token du serveur compris — ce qui déconnecterait aussi les AUTRES
    // appareils. On ferme uniquement la session de cet appareil.
    await backendLogout();
    return;
  }
  try {
    if (stored) {
      const token = JSON.parse(stored).access_token as string;
      const oauth2 = googleWindow().google?.accounts?.oauth2;
      if (oauth2) oauth2.revoke(token, () => {});
      // GIS pas chargé dans cette page (jeton encore valide à l'ouverture) : révocation
      // directe, sans attendre ni charger le SDK. L'adresse n'accepte pas CORS, d'où
      // `no-cors` (réponse illisible, mais la demande part) ; le jeton voyage dans le corps.
      else void fetch('https://oauth2.googleapis.com/revoke', {
        method: 'POST', mode: 'no-cors',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token }).toString(),
      }).catch(() => { /* hors ligne : le jeton expire seul dans l'heure */ });
    }
  } catch { /* no-op */ }
};
